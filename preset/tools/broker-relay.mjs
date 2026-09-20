/**
 * dsh-my-go — 接力链 dispatcher 簇（三期 3.2-3.6；5.3 波自 broker.mjs 抽出）。
 *
 * 决策逻辑在 shared/relay-chain.mjs（纯函数出 decision/patch/ops/notices/facts），
 * 本簇只做 dispatcher 落地：链记录的 patch/ops 写回、通知转发、台账 bump/save、
 * 队列驱动、hop 占位键反查表（chainHopsByWork）的登记与回收。调用方协议三条
 * （先匹配后决策 / 决策显式登记 / 同步段零 await）随簇写在该模块头，改动前先读。
 *
 * 形态与纪律同 5.1/5.2 各簇（对齐 broker-delivery.mjs 先例）：
 *   - 本模块自身零 ctx、零服务解析——跨簇协作件全部经 broker.mjs 接线注入：
 *     notifyOwner / resolveParentAgent（./broker-notify.mjs 工厂产物）、
 *     bump / scheduleLedgerSave / advanceQueue / persistReportBoard（broker 本体
 *     侧的快照广播、台账防抖、队列推进、落板兜底），注入即单向依赖，
 *     本模块绝不回 import broker.mjs，也零互引兄弟簇模块（成环面为零）；
 *   - 纯函数层（advanceChain / matchChainForEnd / matchChainForWork /
 *     reconcileHopDispatch / reconcileWorkEnqueued ← relay-chain；readBoardSlice ←
 *     board；RELAY_CLAUSE ← report-format）直引 ../shared/，与 broker 半同一份实现。
 *
 * chainHopsByWork 是本簇持有的状态（work 占位键 → 链引用，§4.2-① 上岗回填反查
 * 表）。broker 侧的三个消费点（dispatchWork 登记同步段回填、scheduleQueueRetry
 * 放弃落账、session/disposed 队列销毁）不外泄 Map 本体，各以一个语义操作承接：
 *   - backfillHopOnArrival：真 childId 回填 + 条目即删（调用点必须物理先于
 *     claimBufferedEnd——R11 探针锁此位置，host-parity 5.3 钉新调用名）；
 *   - handleQueueWorkDropped：hop work 重试放弃的链感知落账（T14，终局真空防线）；
 *   - releaseHopHolds：属主会话销毁时该流水线的悬挂占位键逐条摘除（3.5 移交①）；
 *   - clearChainHops：插件卸载收尾（卸载走 clear* 的簇纪律；条目与实例同寿，
 *     清理本身行为中性，守的是「簇状态只经簇口回收」这条线）。
 *
 * 形态：createRelayOps({ notifyOwner, resolveParentAgent, bump, scheduleLedgerSave,
 * advanceQueue, metrics, persistReportBoard }) → { relayChainOnEnd,
 * runChainTransition, chainDeclarationError, resolveChainFallback,
 * backfillHopOnArrival, handleQueueWorkDropped, releaseHopHolds, clearChainHops }。
 */

import { RELAY_CLAUSE } from '../shared/report-format.mjs'
import { readBoardSlice } from '../shared/board.mjs'
import { advanceChain, matchChainForEnd, matchChainForWork, reconcileHopDispatch, reconcileWorkEnqueued } from '../shared/relay-chain.mjs'

export function createRelayOps({
  notifyOwner,
  resolveParentAgent,
  bump,
  scheduleLedgerSave,
  advanceQueue,
  metrics,
  persistReportBoard,
}) {
  // ── 接力链工具对（三期 3.3/3.4，D11：声明结构全部由 schema 扛，绝不塞 prompt 字符串）──
  // 决策在 shared/relay-chain.mjs（纯函数），本簇是 dispatcher：校验 R-a~R-l 中
  // 需要 live roster / config / 编排实例的面由调用方（工具块）扛，落地
  // patch/ops/notices 在本簇。
  // 同步段协议（relay-chain.mjs 文件头第 3 条的 3.4 精化版）：advanceChain 决策
  // 与 patch/notices 落地零 await（guard 类语义不允许被 await 隔开）；链 op 词表
  // 唯一成员 enqueue-hop 非 guard 类，其落地允许 await（board 直投 I/O，§3.1
  // 时序），但必须在本函数这条异步链内顺序完成，enqueued 后立即 advanceQueue。
  // 链是账本不是槽位持有者：链状态不参与 laneCount/isBusy，占槽的永远是 hop
  // 子代世代自身（设计文档 §2.1）。

  // 数据面直投的 prompt 组装（INV-2 + §3.2 形态）：指令在前（主编预写或闸门
  // 现场），上一棒全文以不可信数据块身份居中（闭合串转义防容器击穿——M2/M3
  // 教训的写侧对称落法），全程不经过主编上下文。首跳（cursor=0 / prevHopChildId
  // 缺席）无上一棒产出，instruction 原文即 prompt。D29：全文直投零 cap。
  async function composeRelayPrompt(chain, op, { fullText } = {}) {
    const prev = chain.prevHopChildId
    if (chain.cursor === 0 || typeof prev !== 'string' || prev === '') return op.instruction
    if (typeof fullText === 'string' && fullText !== '') {
      // §3.1 第 1 步：await 落板兜底（幂等：report_submit 已落则跳过）——不先
      // 等它就会与 finalize 分支的 void persist 赛跑，读到 not-found 误判 input-missing。
      await persistReportBoard(chain.parentSessionId, prev, fullText)
    }
    const slice = await readBoardSlice(chain.parentSessionId, prev, 0, undefined)
    if (slice.error === 'not-found') return null // → input-missing（绝不发空输入 prompt）
    if (slice.error) throw new Error(`board read failed: ${slice.error}`)
    const escaped = String(slice.text).replaceAll('</mygo_relay_input', '<\\/mygo_relay_input')
    // 下游验收条款随数据块注入（三期 3.6）：子代层验收打回（need_help）的依据，
    // 只在有数据块的 hop prompt 上（首跳无上游可验收，不注入）；REPORT_CLAUSE
    // 仍由 spawnChild 尾注照常追加在本条款之后。
    return [
      op.instruction,
      '',
      `<mygo_relay_input trusted="false" source="board/${chain.parentSessionId}/${prev}.md">`,
      escaped,
      '</mygo_relay_input>',
      '',
      RELAY_CLAUSE,
    ].join('\n')
  }

  // enqueue-hop op 的统一落地（3.4 起链 hop 的 prompt 一律经直投组装；T2/T5/T6/T9
  // 共用）。返回最后一个 workId（单 op 词表下即本次 workId）；input-missing 挂起
  // 返回 undefined 并已把链转为 suspended('input-missing')。
  async function landHopOps(orch, chain, ops, { fullText, parentHint } = {}) {
    let workId
    for (const op of ops) {
      if (op.op !== 'enqueue-hop') {
        // P1 探针锁死词表 ⊆ {enqueue-hop}——此分支理论不可达，防脱节留痕
        console.warn(`[dsh-my-go] relay chain: 未知链 op ${String(op.op)}（决策表与执行表脱节，请修）`)
        continue
      }
      const prompt = await composeRelayPrompt(chain, op, { fullText })
      if (prompt === null) {
        const r = advanceChain(chain, { type: 'input-missing' }, Date.now())
        if (r.patch) Object.assign(chain, r.patch)
        for (const notice of r.notices) notifyOwner(chain.parentSessionId, notice.text)
        bump()
        scheduleLedgerSave()
        return undefined
      }
      workId = orch.enqueue(op.agent, prompt, chain.parentSessionId)
      const wp = reconcileWorkEnqueued(chain, workId, Date.now())
      if (wp) Object.assign(chain, wp)
      // 上岗回填的反查表（§4.2-①）：work 占位键 → 链引用，dispatchWork 登记
      // 同步段回填即删（backfillHopOnArrival）。
      chainHopsByWork.set(workId, chain)
      bump()
      scheduleLedgerSave()
      // 派发类迁移（T1/T2/T5/T6/T9）入队即驱动上岗——复用 D19 直派补位通路，
      // 满池/队列无匹配时本调用是 no-op（泳道锁在 advanceQueue 内判定，INV-1；
      // readPoolSize=1 退化全局单线，链 hop 与人派 work 同队串行）。
      advanceQueue(orch, parentHint ?? resolveParentAgent(chain.parentSessionId))
    }
    return workId
  }

  // processEnd 链回调的异步包装（§4.2-①）：patch/notices 已在同步段落地，op
  // 落地的任何异常显式收口为 input-missing 挂起——绝不静默滞留 running（真空防线）。
  function relayAdvanceHops(orch, chain, ops, { fullText } = {}) {
    landHopOps(orch, chain, ops, { fullText }).catch((error) => {
      console.warn(`[dsh-my-go] relay chain ${chain.id} hop dispatch failed: ${String(error)}`)
      const r = advanceChain(chain, { type: 'input-missing' }, Date.now())
      if (r.patch) Object.assign(chain, r.patch)
      for (const notice of r.notices) notifyOwner(chain.parentSessionId, notice.text)
      bump()
      scheduleLedgerSave()
    })
  }

  // hop 终局的链匹配回调（三期 3.4 接线、3.5 抽出复用）：processEnd 主体之外，
  // E9 补发失败转裁决（attemptReportRepair 兜底 finalize）等「不经 attributeEnd
  // 决策分支的落账路径」也必须喂链——否则 T16 挂起永不发生，链滞留 running
  // （真空）。事件口径与 processEnd 内联段完全一致。
  function relayChainOnEnd(orch, ownerPid, childId, { endDecision, failed, reportGatePhase, conclusionExcerpt, fullText } = {}) {
    const relayChain = matchChainForEnd(orch.chains, childId)
    if (!relayChain) return
    const cr = advanceChain(relayChain, {
      type: 'hop-end',
      childId,
      endDecision,
      failed: failed === true,
      reportGatePhase,
      conclusionExcerpt: typeof conclusionExcerpt === 'string' ? conclusionExcerpt : '',
    })
    if (cr.decision === 'idle') return
    if (cr.patch) Object.assign(relayChain, cr.patch)
    for (const notice of cr.notices) notifyOwner(relayChain.parentSessionId, notice.text)
    metrics.record({ kind: 'relay-chain', phase: cr.decision, chainId: relayChain.id, cursor: relayChain.cursor, sessionId: ownerPid ?? null })
    const hopOps = cr.ops.filter((op) => op.op === 'enqueue-hop')
    if (hopOps.length > 0) {
      // T2 直投落地（§3.1 时序）：await 落板兜底（幂等）→ 读板 → 数据块
      // 组装 → enqueue → advanceQueue；not-found/异常 → input-missing 挂起。
      relayAdvanceHops(orch, relayChain, hopOps, { fullText })
    } else {
      bump()
      scheduleLedgerSave()
    }
  }

  // 工具入口（chain_start/chain_resolve）的迁移执行：同步段（决策+patch+notices）
  // 后 await op 落地——execute 本就是 async 上下文，主编等得起一次 board 读。
  async function runChainTransition(orch, chain, event, parent) {
    const result = advanceChain(chain, event, Date.now())
    if (result.decision === 'idle') return result
    if (result.patch) Object.assign(chain, result.patch)
    for (const notice of result.notices) {
      notifyOwner(chain.parentSessionId, notice.text)
    }
    const workId = await landHopOps(orch, chain, result.ops, { parentHint: parent })
    return { ...result, workId }
  }

  // 链记录校验失败 → 主编可读报错（错误码指路，同 go_work 的 roster 报错风格）。
  function chainDeclarationError(errors) {
    return new Error(`invalid chain declaration: ${errors.join('; ')} — hops = ordered [{ agent, prompt?, gate? }]; gate ∈ {auto(读→读免审, prompt 必填预写), review(挂起待审), sync(不可逆跳强制同步门, 指令必须现场给)}; 2-8 hops; first hop gate must be auto`)
  }

  // hop 占位键 → 链记录引用（3.4）：dispatchWork 上岗登记同步段按 workId 反查
  // 链做 hopChildId 回填（§4.2-①）。条目生命周期：回填即删 / dropQueuedFailed
  // 链感知即删；spawn 悬挂的残余条目随占位审计回收的已知边界留待 3.5 统一清理
  // （量级：cap 32 链 × 单跳派发窗口，无累积面）。
  const chainHopsByWork = new Map()

  // 上岗回填（dispatchWork 登记同步段消费）：真 id 回填 + 条目即删。位置契约：
  // 必须锁在 E2 认领（claimBufferedEnd）之前——认领重放走全归因管线后查链时
  // 回填必已就位，重放查不到链的时序窗口结构性消失（R11 探针锁此位置约束：
  // 挪到认领之后必红）。同步段零 await（协议第 3 条）。
  function backfillHopOnArrival(queuedWork, childId) {
    const hopChain = chainHopsByWork.get(queuedWork.id)
    if (!hopChain) return
    const rp = reconcileHopDispatch(hopChain, { workId: queuedWork.id, childId, now: Date.now() })
    if (rp) Object.assign(hopChain, rp)
    chainHopsByWork.delete(queuedWork.id)
  }

  // 链感知（T14，§四矩阵外落账点）：链 hop 的 work 重试放弃 → 链 failed，
  // 绝不留 running 滞留（终局真空防线）。matchChainForWork 的键 = hopWorkId
  // （未上岗窗口），放弃只可能发生在该窗口内。scheduleQueueRetry 的放弃支
  // 调用；本函数只负责链侧落地，队列推进仍由调用方自持。
  function handleQueueWorkDropped(orch, work, error) {
    const droppedChain = matchChainForWork(orch.chains, work.id)
    if (!droppedChain) return
    const cr = advanceChain(droppedChain, { type: 'queue-dropped', workId: work.id, reason: String(error) })
    if (cr.decision !== 'idle') {
      if (cr.patch) Object.assign(droppedChain, cr.patch)
      for (const notice of cr.notices) notifyOwner(droppedChain.parentSessionId, notice.text)
      metrics.record({ kind: 'relay-chain', phase: cr.decision, chainId: droppedChain.id, cursor: droppedChain.cursor, sessionId: droppedChain.parentSessionId })
    }
    chainHopsByWork.delete(work.id)
    bump()
    scheduleLedgerSave()
  }

  // 移交①（3.4 → 3.5）：spawn 悬挂残余的回填表项同点清理——该 orch 排队
  // work 的占位键还在 chainHopsByWork 里挂着（dispatchWork 未走到回填），
  // 实例销毁后永远不会被消费，逐条摘除防累积（session/disposed 消费）。
  function releaseHopHolds(orch) {
    for (const work of orch.queue) chainHopsByWork.delete(work.id)
  }

  // 卸载收尾：簇持有的反查表整体清空（与 dispose/endbuffer 的 clear* 同律）。
  function clearChainHops() {
    chainHopsByWork.clear()
  }

  // 备选链 × 接力链的感知点（三期 3.4，D10/T11/T12）：pending-fallback 态的链按
  // 亡棒 childId 精确查找，评估终局喂给状态机（重派成功 → 换绑挂起等裁决；
  // 失败落账 → 链 failed）。非链棒（绝大多数）查不到链，零开销直落。
  function resolveChainFallback(orch, childId, event) {
    const relayChain = orch.chains.find((c) => c.state === 'pending-fallback' && c.hopChildId === childId)
    if (!relayChain) return
    const cr = advanceChain(relayChain, event)
    if (cr.decision === 'idle') return
    if (cr.patch) Object.assign(relayChain, cr.patch)
    for (const notice of cr.notices) notifyOwner(relayChain.parentSessionId, notice.text)
    metrics.record({ kind: 'relay-chain', phase: cr.decision, chainId: relayChain.id, cursor: relayChain.cursor, sessionId: relayChain.parentSessionId })
    bump()
    scheduleLedgerSave()
  }

  return { relayChainOnEnd, runChainTransition, chainDeclarationError, resolveChainFallback, backfillHopOnArrival, handleQueueWorkDropped, releaseHopHolds, clearChainHops }
}
