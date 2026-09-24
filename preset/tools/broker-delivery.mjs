/**
 * dsh-my-go — continue/forward 投递链共用件（0.3.0-tisitan.12 棒② B4 手术 M1-M5；
 * 5.2 波自 broker.mjs 抽出）。
 *
 * 两工具原本是「找目标 → 门面 steer → abort 掐断 → queued 投递 → 投递后复籍」
 * 这条链抄两遍（continue 独有三档 urgency，forward 只有 queued），差异全靠行号
 * 相邻的注释维持——E6 类改动的同步段协议在两处各存一份，漏改一处就静默失守。
 *
 * **同步段承诺**（本组 helper 的存在理由，改动前请先读 0.2.3-tisitan.18 /
 * 0.3.0-tisitan.2 / 0.3.0-tisitan.7 N6 的教训注释）：
 *   ① 每个 helper 内的 await 次数与原分支逐一对应（resolveContinueTarget 1 次、
 *      tryFacadeSteer 1 次、interruptForAbort 0 次、deliverWithQueueFallback 1 次、
 *      rearmAfterDelivery 0 次）——多一个 await 就多开一个真空期；
 *   ② interruptForAbort 里的 abortExpected.add 与 notifyParent 全在同步段，
 *      且**必须先于** queued 投递（护航登记早于 end 可能到达的那一秒）；
 *   ③ 复籍（revive/rearmChild）只在投递成功后发生——投递失败留下假 running
 *      比留下假 finished 更难收拾。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：本簇是「准模块」
 * 形态——决策逻辑自洽，但每件事都要碰编排会话的活状态与兄弟簇产物。依赖全部显式
 * 注入，本模块自身零 ctx、零服务解析：
 *   - getAgents / getSubagents：逐调用现取（与原实现 `ctx.get('agents')` /
 *     `ctx.subagents` 的读取时点一致，绝不在工厂期捕获一次——门面方法的特性探测
 *     必须看到当下那枚对象）；
 *   - orchestrations / abortExpected / childRegistry：broker.mjs 持有的活状态句柄
 *     （Map / Set 本体不复制，abortExpected 与 childRegistry 是同一枚登记表的引用，
 *     childRegistry 只取 rearmChild 一件事）；
 *   - findRecordWithLedgerFallback / resolveParentAgent / notifyParent：兄弟簇实例
 *     （./broker-ledger.mjs 与 ./broker-notify.mjs 的工厂产物）。它们是工厂产物而非
 *     模块级导出，跨模块 import 拿不到（要 ledgerPath / getAgents 才能构造），故由
 *     broker.mjs 的 apply() 一次接线后注入——依赖单向 broker → delivery，本模块
 *     绝不 import broker.mjs，成环面为零。
 * 纯函数层（deliverToAdjacent / canQueueAdjacent / laneOf / HISTORY_CAP）直引
 * ../shared/，与 broker 半同一份实现，不复制第二份判定。
 *
 * 形态：createDeliveryOps({ getAgents, getSubagents, orchestrations, abortExpected,
 * childRegistry, findRecordWithLedgerFallback, resolveParentAgent, notifyParent })
 * → { resolveContinueTarget, tryFacadeSteer, interruptForAbort,
 * deliverWithQueueFallback, rearmAfterDelivery }。
 */

import { HISTORY_CAP } from '../shared/constants.mjs'
import { laneOf } from '../shared/orchestration.mjs'
import { deliverToAdjacent, canQueueAdjacent } from '../shared/adjacent.mjs'

export function createDeliveryOps({
  getAgents,
  getSubagents,
  orchestrations,
  abortExpected,
  childRegistry,
  findRecordWithLedgerFallback,
  resolveParentAgent,
  notifyParent,
}) {
  const coordinatorSource = (parent) => ({ kind: 'plugin:dsh-my-go', form: 'relay', senderSessionId: parent.id })

  // M1：record 定位（内存全实例 → 台账文件兜底）+ 三道闸。
  // queuedHintOnly 与 spawningGate 是 continue 独有的两道（forward 无 urgency 概念，
  // 也不接受占位记录）——本批保持两工具行为差异原样，不做“顺手补齐”。
  async function resolveContinueTarget(rawId, { callerOrch, parent, verb, queuedHint = false, spawningGate = false }) {
    const id = String(rawId)
    const found = await findRecordWithLedgerFallback(id, callerOrch, parent.id)
    if (!found) {
      if (queuedHint) {
        for (const orch of [callerOrch, ...orchestrations.values()]) {
          const queued = orch.snapshot().queue.find((w) => w.id === id)
          if (queued) {
            throw new Error(`task ${id} (${queued.agentType}) is still queued — wait for dispatch, then use its real childId (see orchestration_status)`)
          }
        }
      }
      throw new Error(`unknown sub-agent id: ${id} — 该 id 不在编排台账；若进程重启过且台账持久化未覆盖该记录（或已被每桶 ${HISTORY_CAP} 条历史上限挤出），请用 go_work 重新派发`)
    }
    const { orch, parentId: ownerPid, record } = found
    // 跨会话抢属主防线（棒2-L2）：记录属主仍是活会话时拒绝跨会话操作——复活/续聊
    // 会落进属主流水线（结论落账与单线阻塞都归属主），调用方却拿到 accepted。
    // 属主已不在注册表（进程重启后的台账桶 / legacy 桶）才允许现调用方收养。
    if (ownerPid !== parent.id && resolveParentAgent(ownerPid)) {
      throw new Error(`sub-agent ${id} belongs to another live orchestration session (${String(ownerPid)}); ${verb} it from that session`)
    }
    const isFinished = !orch.currentMap.has(id)
    // 复活闸泳道化（二期 2.3，原 isBusy 判定迁移）：复活/转发把记录放回其 lane
    // 的槽，判定「目标 lane 有没有空位」而非「实例是否全忙」——容量 ≥2 时一条
    // explore 的复活不再被在飞的写平面任务挡住，也不得挤爆已满的读池。
    // readPoolSize=1 时退化口径 = 全局空，与旧判定逐字节等价。
    if (isFinished && !orch.isLaneFree(laneOf(record.agentType))) {
      const lane = laneOf(record.agentType)
      throw new Error(`no free slot in the ${lane} lane (capacity ${orch.capacityOf(lane)}); wait for a slot before ${verb === 'continue' ? 'reviving' : 'forwarding to'} a completed sub-agent`)
    }
    // spawning 占位记录友好闸（0.3.0-tisitan.7 N18）：record 在册而 childId 还是
    // beginSpawning 造的占位（真身未 resolve），此时既无 turn 可 steer/abort，投递
    // 目标也不是任何存在的会话——旧路径会一路走完并回 accepted:true，把主流程的
    // 指令投进空气。与上面 queued 占位 id 同款口径：明确拒绝 + 指路真 childId。
    if (spawningGate && record.status === 'spawning') {
      throw new Error(`sub-agent ${id} is still spawning (placeholder id, no live child session yet) — wait for the dispatch to resolve, then use its real childId (see orchestration_status)`)
    }
    return { orch, ownerPid, record, id, isFinished, isRunning: !isFinished && record.status === 'running' }
  }

  // M2：steer 档尝试。返回 messageId（调用方自己记账），undefined = 未走成 steer
  // （非 running / 注册表无活体 / 门面拒收），调用方照常落 queued 通路。
  // 注册表探测只做「活 agent 才允许 steer」的门槛，投递一律经 subagents 门面：
  // 直调 Agent.steer 绕过 authority 校验、source 推导与唤醒记账，还得自造 messageId
  // （终审批 U1 收口的就是这条）。
  async function tryFacadeSteer({ parent, targetId, prompt, signal, isRunning, isFinished, status }) {
    if (!isRunning) {
      // 非 running（waiting/finished/spawning）给 steer 一律按 queued 投递：steer
      // 语义要求活 turn 的 step 边界，而 queued 通路自带 resume/revive 等正确状态
      // 迁移——语义防呆优先于结构化报错（报错只会让主流程多花一轮重试 queued）。
      console.warn(`[dsh-my-go] continue urgency=steer: ${String(targetId)} is ${isFinished ? 'finished' : String(status)} (not running); delivering as queued followup`)
      return undefined
    }
    const childAgent = getAgents()?.get?.(targetId)
    if (!childAgent) {
      // running 但活体不在注册表（非驻留/冷态）：拿不到 sender 就不可能过门面校验
      console.warn(`[dsh-my-go] continue urgency=steer: live agent ${String(targetId)} not in registry (non-resident/cold); falling back to queued followup`)
      return undefined
    }
    try {
      return await deliverToAdjacent(getSubagents(), parent, targetId, [{ type: 'text', text: prompt }], {
        source: coordinatorSource(parent),
        signal,
        delivery: 'steer',
      })
    } catch (error) {
      // 门面拒收（冷态竞态/authority 变更等）：绝不静默，warn 后落回 queued 重试一次
      console.warn(`[dsh-my-go] continue urgency=steer: facade steer rejected for ${String(targetId)} (${String(error)}); delivering as queued followup`)
      return undefined
    }
  }

  // M3：abort 档掐断。**全同步**（interrupt 本身是同步受理，Agent.cancel 才异步）。
  // 活体门槛（0.3.0-tisitan.7 N6）：alpha.4 的 interrupt 对缺席目标是 accepted
  // no-op，拿不到活体就不登记护航——否则 guard 会吞掉儿童真正那一轮以任何终局
  // 上报的 end（E6），记录挂着、队列冻结。
  // 返回 true = 已掐断（调用方置 mode='abort'）；false = 降级 queued。
  function interruptForAbort({ parent, targetId }) {
    const abortChildAgent = getAgents()?.get?.(targetId)
    if (!abortChildAgent) {
      console.warn(`[dsh-my-go] continue urgency=abort: live agent ${String(targetId)} not in registry (non-resident/cold); skipping interrupt and degrading to queued followup`)
      return false
    }
    try {
      getSubagents().interrupt(targetId, { kind: 'ancestor', agent: parent })
      // 被掐轮的 end（stopReason='aborted'）是编排方自造的预期事件：登记护航，
      // end handler 见 guard 跳过落史/失败通知/队列推进（续轮仍占槽）
      abortExpected.add(targetId)
      // harness 原生中断通知随后必到（硬编码模板插件无法抑制）：同步 inject 一句
      // 预告，防主流程把预期掐断误当失败处置（0.2.3-tisitan.18 预告同款动机）
      notifyParent(parent, `[dsh-my-go] 已按 urgency=abort 掐断 ${String(targetId)} 当前轮，新指令已排队（当前轮 drain 后自动开跑）；随后的中断通知属预期噪音，无需失败处置`)
      return true
    } catch (error) {
      // interrupt 的 ancestry 校验仍可能抛 UNAUTHORIZED（如收养的跨会话记录不在
      // ancestry）：掐不动就降级 queued，投递语义不丢
      console.warn(`[dsh-my-go] continue urgency=abort: interrupt ${String(targetId)} rejected (${String(error)}); degrading to queued followup`)
      return false
    }
  }

  // M4：queued 档投递（三档最终都汇到这里）。返回 { messageId, delivery }，
  // **由调用方**同步自己的 mode 口径（continue 的 mode 还带 abort/steer 语义，
  // 不是本 helper 该懂的东西）。
  async function deliverWithQueueFallback({ parent, targetId, prompt, signal, label }) {
    // 投递档位（R4）：queued 意图必须落在真 FIFO 通路上——alpha.2/3 的 followup
    // 天然排队、alpha.4 走 internal 符号队列。两条都没有（alpha.4 sendMessage
    // 固定 steer 而符号缺席的变体 runtime）才退化为 steer，并把实际档位如实回传，
    // 绝不静默塌档。
    let delivery = 'queued'
    if (!canQueueAdjacent(getSubagents())) {
      console.warn(`[dsh-my-go] ${label}: no FIFO queue route on this runtime (alpha.4 sendMessage is steer-only); ${label === 'continue' ? 'urgency=queued' : 'delivery'} degraded to steer`)
      delivery = 'steer'
    }
    const messageId = await deliverToAdjacent(getSubagents(), parent, targetId, [{ type: 'text', text: prompt }], {
      source: coordinatorSource(parent),
      signal,
      delivery,
    })
    return { messageId, delivery }
  }

  // M5：投递成功后的状态复籍 + 台账照记。
  // **时序差异用参数保留**：continue 先复籍再记账（followupPrompt 之后），
  // forward 先记账再复籍（ledgerFirst=true）。两处的 followupPrompt 都是按
  // childId 找活记录，而复籍（revive）恰好就是把记录放回活槽——顺序换过来会
  // 让其中一侧的台账照记落空，故本批只合并不分叉的部分，分叉点显式传参。
  function rearmAfterDelivery({ orch, record, targetId, ownerPid, isFinished, prompt, urgency, resolvePendingHelp = false, ledgerFirst = false }) {
    const writeLedger = () => orch.followupPrompt(targetId, prompt, urgency)
    if (ledgerFirst) writeLedger()
    if (record.status === 'waiting') {
      // 求助单随续轮失效：先销自己名下未处置的求助，再恢复运行态
      if (resolvePendingHelp) {
        for (const help of orch.snapshot().helpRequests) {
          if (help.childId === targetId) orch.resolveHelp(help.id)
        }
      }
      orch.resume(targetId)
    } else if (isFinished) {
      // 已结束的子智能体重新入册并恢复类型登记，否则它游离在单线阻塞之外、
      // 再次结束时结论会被静默丢弃；三张表与 continue 复活路径同一实现
      // （漏一张就是「复活后 conclusion 静默丢失」或「备选回跳主模型」）
      orch.revive(targetId)
      childRegistry.rearmChild(targetId, record, ownerPid)
    }
    if (!ledgerFirst) writeLedger()
  }

  return { resolveContinueTarget, tryFacadeSteer, interruptForAbort, deliverWithQueueFallback, rearmAfterDelivery }
}
