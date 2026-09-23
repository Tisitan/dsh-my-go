/**
 * dsh-my-go — 调度核（dispatchWork / advanceQueue / scheduleQueueRetry / 队列重试
 * 定时器 + 名册路由薄壳 + spawnChild 派发组合子 + 挂起停摆可观测；5.4 波自
 * broker.mjs 抽出）。
 *
 * 拆分动机：这一族是「派发面」——从 go_work 直派、队列补位、备选转正共用的
 * 上岗判定与派发执行，连同它的名册路由输入（rosterKeys/rolePersona/
 * resolveRoleToolFilter）与 spawnChild 唯一 spawn 出口。**互递归环
 * advanceQueue↔dispatchWork 整体随迁、环内聚在本模块**（5.4 裁决）：
 * advanceQueue 的派发失败回补 catch 调 scheduleQueueRetry，scheduleQueueRetry 的
 * 放弃支与定时器回调再调 advanceQueue，dispatchWork 的 D19 补位与 catch 清槽也
 * 调 advanceQueue——三向环全部是模块内函数声明的相互调用（提升语义与原 broker
 * 逐字节一致），不产生任何跨模块环。反向的两条跨簇边（dispatchWork 登记同步段
 * 的 processEnd 认领重放、scheduleQueueRetry 的 handleQueueWorkDropped 链感知）
 * 与正向的一条（advanceQueue 被 end 管线 / relay / dispose / endbuffer 消费）
 * 全部经 broker.mjs 接线注入，与本簇对 end/relay 簇构成**相互回调注入**——
 * 两侧都是包壳闭包、调用时点恒晚于接线段，成环面为零。
 *
 * 形态：createSchedulerOps({ childRegistry, getBindings, getAgents, getTools,
 * getSubagents, orchFor, bump, metrics, notifyParent, modelExists, promptCache,
 * loadPrompt, claimBufferedEnd, processEnd, backfillHopOnArrival,
 * handleQueueWorkDropped, REPORT_EXT, SUBAGENT_PROMPT_MAX, HELP_CONTENT_MAX,
 * QUEUE_RETRY_BASE_MS }) →
 *   { dispatchWork, advanceQueue, rosterKeys, liveToolNames, spawnChild,
 *     buildStallNotice, clearQueueRetryTimers, cancelQueueRetryTimer }。
 *   - dispatchWork / advanceQueue / rosterKeys / liveToolNames：tools 注册块与
 *     broker 生命周期的既有消费名，逐名转注。
 *   - spawnChild / buildStallNotice：end 管线的重派路与 T1 停摆通报消费。
 *   - clearQueueRetryTimers / cancelQueueRetryTimer：卸载收尾（ctx.effect 与
 *     session/disposed 的「表本体随簇、收尾走簇口」口径，同 clearChainHops 先例；
 *     原 session/disposed 里裸操作 queueRetryTimers 的三行换成本簇同语义调用）。
 *   - scheduleQueueRetry / stallHolder / rolePersona / resolveRoleToolFilter：
 *     簇内私有（实读无簇外消费点），不出口。
 *
 * 依赖注入面（对齐既有九簇范式）：零 ctx（agents/tools 注册表、subagents 门面
 * 经回调逐调用现取，与原读 ctx 的时点一致）；bindings 是 broker 侧闭包可变值
 * （宿主配置桥逐调用现读）经 getBindings 转出；childRegistry / bump /
 * metrics / notifyParent / modelExists / promptCache / loadPrompt 传活句柄或
 * 工厂产物；claimBufferedEnd / processEnd / backfillHopOnArrival /
 * handleQueueWorkDropped 是兄弟簇件的包壳闭包（工厂产物不可 import）。
 * 纯函数层（laneOf / agentLabel / describeAgent / shared 名册三件 /
 * SELF_REGISTERED_TOOLS / RUN_CODE_TOOL / REPORT_CLAUSE）直引 ../shared/。
 * 配置常量（REPORT_EXT / SUBAGENT_PROMPT_MAX / HELP_CONTENT_MAX /
 * QUEUE_RETRY_BASE_MS）在 broker 侧读 config 后按值注入，簇不碰 config。
 */

import { SELF_REGISTERED_TOOLS, RUN_CODE_TOOL } from '../shared/constants.mjs'
import {
  rosterKeys as sharedRosterKeys,
  rolePersona as sharedRolePersona,
  resolveRoleToolFilter as sharedResolveRoleToolFilter,
} from '../shared/roles.mjs'
import { agentLabel, describeAgent } from '../shared/misc.mjs'
import { laneOf } from '../shared/orchestration.mjs'
import { REPORT_CLAUSE } from '../shared/report-format.mjs'

export function createSchedulerOps({
  childRegistry,
  getBindings,
  getAgents,
  getTools,
  getSubagents,
  orchFor,
  bump,
  metrics,
  notifyParent,
  modelExists,
  promptCache,
  loadPrompt,
  claimBufferedEnd,
  processEnd,
  backfillHopOnArrival,
  handleQueueWorkDropped,
  REPORT_EXT,
  SUBAGENT_PROMPT_MAX,
  HELP_CONTENT_MAX,
  QUEUE_RETRY_BASE_MS,
}) {
  const { sessionTypes, childOwner } = childRegistry

  // ── 挂起停摆可观测性（本批）───────────────────────────────────────────────
  // E8（suspended-help-hold）把挂起轮那条 end 静默吞掉，代价是「槽位被一个不会
  // 自己醒的子代占着、后面的任务永无推进事件」这件事主编看不见。补两个触发点，
  // 同一份文案、同一枚守卫：
  //   T1 end 归因落到 E8 的那一刻（挂起瞬间）——队列里有货才报（没货就没有停摆，
  //      主编手里那张求助单已经足够）。
  //   T2 go_work 入队时槽主是 waiting——新任务派进了一条不会自己推进的流水线。
  // 防刷屏：每次停摆 episode 只报一次，标记打在占槽记录上（stallNotified），
  // T1/T2 共用以「谁先撞上谁报」为准；记录复籍（resume）/再次挂起（suspend）/
  // 落账（finish）时由状态机清除（见 shared/orchestration.mjs），故新 episode
  // 可再报。标记不入台账：episode 的生命周期与进程同寿，落档只会留下永不复位的
  // 死标记，让重启后的同一轮挂起哑掉通报。
  function buildStallNotice(orch, holder) {
    if (!orch || !holder || holder.status !== 'waiting') return undefined
    const queueLen = orch.queue.length
    if (queueLen <= 0) return undefined
    if (holder.stallNotified) return undefined
    const helps = [...orch.helpRequests.values()].filter((h) => h.childId === holder.childId)
    const help = helps.length > 0 ? helps.reduce((a, b) => ((Number(a.createdAt) || 0) >= (Number(b.createdAt) || 0) ? a : b)) : undefined
    const helpPart = help
      ? `求助单 ${help.id}（${help.intent}）: ${(help.content ?? '').replace(/\s+/g, ' ').slice(0, HELP_CONTENT_MAX)}`
      : '求助单: 名下已无在册单据'
    // 打标走「新对象换槽」而非原地改：占槽记录在别处（快照/求助单读路径）是共享
    // 引用，状态机的每一次迁移都是复制换键，本处守同一条规矩。只 bump 不 emit：
    // 标记刻意不落台账（episode 与进程同寿），不该为它触发一次无意义的档案写。
    orch.currentMap.set(holder.childId, { ...holder, stallNotified: true })
    bump()
    return `[dsh-my-go] 流水线停摆: ${holder.childId} (${holder.agentType}) 挂起占槽，队列压着 ${queueLen} 个任务无人推进；${helpPart}。处置: forward/continue 处置求助单后流水线自动恢复`
  }
  // T2 的槽主挑选：报的是「挡住这条新任务的那位」。读池开启（容量 ≥2）时只有同
  // 泳道的挂起记录才挡得住本任务，跨泳道去报等于把停摆记错了人头上；而默认的
  // 全局单线（readPoolSize=1，isLaneFree 退化为 size===0）下任何挂起记录都挡全场，
  // 同泳道挑不到就取任意一条挂起者。
  function stallHolder(orch, agentType) {
    const waiting = [...orch.currentMap.values()].filter((r) => r.status === 'waiting')
    if (waiting.length === 0) return undefined
    const lane = laneOf(agentType)
    return waiting.find((r) => (r.lane ?? laneOf(r.agentType)) === lane) ?? waiting[0]
  }

  // ── 队列推进与重试（原 broker「internal go_work implementation」段）────────
  // 队列推进：取出队首并派发；派发失败时回补队首——任务不蒸发、队列不停摆，
  // 失败原因进日志与控制台，Sisyphus 可通过 orchestration_status 看到它仍在排队。
  //
  // 回补之后没有任何事件源会再触发推进（0.2.3-tisitan.6 实战确认的队列停摆），
  // 因此回补时挂一个带线性退避的重试定时器；超过上限则放弃该任务——
  // 从队列移除并写 failed 历史 + console.error，绝不静默滞留。
  const QUEUE_RETRY_MAX = 3
  // 每条流水线各自的重试定时器（键为 Orchestration 实例），互不挤占
  const queueRetryTimers = new Map()

  function scheduleQueueRetry(orch, work, parentHint, error) {
    work.retries = (work.retries ?? 0) + 1
    if (work.retries > QUEUE_RETRY_MAX) {
      orch.dropQueuedFailed(work, error)
      // 链感知（T14，§四矩阵外落账点；本体在 relay 簇 handleQueueWorkDropped）：
      // 链 hop 的 work 重试放弃 → 链 failed，绝不留 running 滞留（终局真空防线）。
      handleQueueWorkDropped(orch, work, error)
      console.error(`[dsh-my-go] queued task ${work.id} (${work.agentType}) abandoned after ${QUEUE_RETRY_MAX} failed dispatch attempts:`, error)
      bump()
      // 继续消化后续排队任务
      advanceQueue(orch, parentHint)
      return
    }
    const prev = queueRetryTimers.get(orch)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      queueRetryTimers.delete(orch)
      advanceQueue(orch, parentHint)
    }, QUEUE_RETRY_BASE_MS * work.retries)
    // 重试定时器不应阻止进程退出
    timer.unref?.()
    queueRetryTimers.set(orch, timer)
  }
  // 卸载收尾：撤掉所有在飞的队列重试定时器并清表（与 dispose / endBuffer 的
  // clear* 同一枚 ctx.effect，注册点与旧「queueRetry」effect 逐字节同位）。
  function clearQueueRetryTimers() {
    for (const timer of queueRetryTimers.values()) clearTimeout(timer)
    queueRetryTimers.clear()
  }
  // 属主会话销毁时的同点摘除（session/disposed 消费）：原三行裸操作表体的簇口
  // 化，语义逐字不变。
  function cancelQueueRetryTimer(orch) {
    const retryTimer = queueRetryTimers.get(orch)
    if (retryTimer) {
      clearTimeout(retryTimer)
      queueRetryTimers.delete(orch)
    }
  }

  function advanceQueue(orch, parentHint) {
    if (!orch) return
    // 二期 2.3（D18 已裁决 global-scan，read-pool-semantics.md §2.1）：自队首扫描
    // 全队列，第一条其 lane 有空位的 work 上岗；满池 lane 的 work 原地保留——
    // skip 不重排队列序，lane 内 FIFO 与全局序可观测都不变。readPoolSize=1 时
    // isLaneFree 退化为全局单线（size===0 才 free），本循环与旧「队首一刀切」
    // 逐字节等价：上岗一条即满，扫描自然终止。
    // 终止性：每轮 picked 必然出队（dequeueById）或队空返回；派发是 void 异步链，
    // 其同步段（至 beginSpawning 占槽）先于下一轮扫描执行，laneCount 即时反映，
    // 循环填池到无空位为止。派发同步段抛错（unknown role/无 parent）时占位未入
    // 槽、work 已出队，由下方 catch 在微任务里 requeueHead 回补——本循环不会
    // 二次考察同一条 work（已不在队列），无死循环面。
    for (;;) {
      const queueSnapshot = orch.queue
      let picked = -1
      for (let i = 0; i < queueSnapshot.length; i++) {
        if (orch.isLaneFree(laneOf(queueSnapshot[i].agentType))) { picked = i; break }
      }
      if (picked < 0) return
      const work = orch.dequeueById(queueSnapshot[picked].id)
      if (!work) continue
      // 埋点（0.4.0-tisitan.0）：队列等待时长基线（work.createdAt 于 enqueue 时落账，
      // shared/orchestration.mjs）。只读快照，零时序影响。
      metrics.record({ kind: 'queue-pop', waitMs: Date.now() - work.createdAt })
      const agents = getAgents()
      // 父会话兜底：按 work.parentId 从 agents 注册表重解析（队列推进没有
      // 调用方 agent 对象可留存）；解析不到则由 dispatchWork 抛错走回补重试
      const parentAgent = (work.parentId && agents ? agents.get(work.parentId) : undefined) ?? parentHint
      void dispatchWork(work.agentType, work.prompt, parentAgent, undefined, work, orch).catch((error) => {
        orch.requeueHead(work)
        bump()
        console.error('[dsh-my-go] queued dispatch failed, task requeued:', error)
        scheduleQueueRetry(orch, work, parentAgent, error)
      })
    }
  }

  // ── 名册路由辅助（0.2.3-tisitan.14 数据层 roles dict 的消费面） ────────────────
  // 核心逻辑在 shared/roles.mjs，这里是注入每半可变状态的薄壳。bindings 经
  // getBindings 现读（宿主配置桥段变化后必须看到新值，与原闭包直读
  // `let bindings` 的时点逐调用一致）。
  const rosterKeys = () => sharedRosterKeys(getBindings())

  const rolePersona = (type) => sharedRolePersona(getBindings(), promptCache, loadPrompt, type)

  // 本插件注册的编排工具名：schemas() 无参只返回全局层视图（内建 + MCP），
  // preset 层的自产工具不在其中——toolFilter 合法引用它们时不能误杀。
  function liveToolNames() {
    try {
      const tools = getTools()
      const schemas = typeof tools?.schemas === 'function' ? tools.schemas() : []
      const names = schemas.map((s) => s?.name).filter((n) => typeof n === 'string' && n !== RUN_CODE_TOOL)
      return new Set([...names, ...SELF_REGISTERED_TOOLS])
    } catch {
      return undefined
    }
  }

  const resolveRoleToolFilter = (type, filter) => sharedResolveRoleToolFilter(type, filter, liveToolNames())

  /**
   * 派发一个儿童会话（go_work 直派与备选重派**共用**）。两条路的差异全部
   * 参数化：agentOptions（直派按工种绑定、重派按备选条目）、label（同一
   * agentLabel 公式，重派需要在 try 外先算好以便失败清理）、signal（直派带
   * 调用方信号、重派恒新合成一枚）。persona/toolFilter 两路同源——重派是
   * 「同角色换脑重新上岗」，人设与工具面必须跟着工种走，不随备选条目变。
   * 只负责 spawn 本身：占位换键（bindChild）、登记表写入、失败补偿都留在
   * 调用方，两路的收尾时机不同（重派成功要做备选转正，直派成功只登记工种）。
   * @returns 新儿童 childId
   */
  async function spawnChild({ agentType, prompt, parent, label, agentOptions, toolFilter, sig }) {
    const [persona, roleFilter] = await Promise.all([
      rolePersona(agentType),
      // toolFilter 由调用方按**进入本路径时**的绑定快照传入（直派取 entry-time
      // 的 `binding.toolFilter`，重派取当时的 `bindings[type]?.toolFilter`）——
      // 此处不重读 bindings，否则一次配置段热更夹在两次 await 之间
      // 就会改变本次派发已经定下的工具面。
      Promise.resolve(resolveRoleToolFilter(agentType, toolFilter)),
    ])
    const request = {
      label,
      // 提交条款注入（REPORT_CLAUSE，唯一出处）：此处是直派与备选重派唯一共用
      // 组装点（事实 C），一处追加两路同覆盖。continue 走 adjacent 不经 spawnChild
      // （条款随首派上下文自然存续，不另开接缝）。开关关 = prompt 数组保持单项，
      // 现状零变化。尾块是独立 text 项：任务原文保持首项原样，子代过程工具链
      // 对 prompt[0] 的既有假设不受扰。
      prompt: [
        { type: 'text', text: prompt },
        ...(REPORT_EXT ? [{ type: 'text', text: REPORT_CLAUSE }] : []),
      ],
      ...(persona !== undefined ? { persona } : {}),
      ...(roleFilter !== undefined ? { toolFilter: roleFilter } : {}),
      parent,
      ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
      signal: sig,
    }
    const { childId } = await getSubagents().startContinuable({
      provider: 'spawn',
      label,
      request,
      signal: sig,
    })
    return childId
  }

  async function dispatchWork(agentType, prompt, parent, signal, queuedWork, orchHint) {
    if (!rosterKeys().includes(agentType)) {
      const roster = rosterKeys().map((t) => `- ${t}: ${describeAgent(t, getBindings()[t]?.persona)}`).join('\n')
      throw new Error(`unknown agent role: ${String(agentType)} — not in the live roster. Re-run go_work with one of the available roles:\n${roster}\n(model bindings and tool filters: see the roles section of orchestration_status)`)
    }
    const binding = getBindings()[agentType] ?? {}
    // 队列路径的父会话兜底已上移到 advanceQueue（按 work.parentId 从
    // agents 注册表重解析）；此处 parent 缺失即抛错，由调用方回补重试。
    if (!parent) throw new Error('go_work requires a live parent agent to delegate from')
    const orch = orchHint ?? orchFor(parent.id)
    // startContinuable 无条件调用 spec.signal.throwIfAborted()（dsh-subagent
    // SubagentContinuationManager.startContinuable）：直发路径 exec.signal 恒在，
    // 队列路径（advanceQueue）没有调用方信号可传——必须合成一个永不中止的信号，
    // 否则队列派发必败 TypeError（0.2.3-tisitan.6 部署实测：重试 4 次全败后放弃）。
    const sig = signal ?? new AbortController().signal
    // 泳道容量分叉（二期 2.3，原 isBusy 判定迁移）：目标 lane 有空位即直接 spawn，
    // 满则入队等本 lane 释放。readPoolSize=1 时 isLaneFree 退化口径 = 全局空，
    // 与旧 isBusy() 判定逐字节等价（D5 默认关 = 现状）。
    if (!orch.isLaneFree(laneOf(agentType))) {
      const workId = orch.enqueue(agentType, prompt, parent?.id)
      bump()
      // T2 停摆期新派工（本批）：任务已入队，而占着本泳道槽位的是一位挂起等处置的
      // 子代——它不会自己结束，这条 work 也就永远不会被 end 驱动上岗。与 T1 共用
      // 同一份文案与同一枚 episode 守卫（谁先撞上谁报，另一处自然静默）。
      const stallNotice = buildStallNotice(orch, stallHolder(orch, agentType))
      if (stallNotice) notifyParent(parent, stallNotice)
      return { childId: workId, status: 'queued', label: agentLabel(agentType, prompt.slice(0, SUBAGENT_PROMPT_MAX)), queued: true }
    }
    const placeholder = orch.beginSpawning(agentType, prompt)
    try {
      // Resolve provider: use binding's explicit provider, or inherit from parent agent options
      const parentProvider = parent?.options?.provider
      const resolvedProvider = binding.provider ?? parentProvider
      // Build agentOptions: always pass provider so sub-agent doesn't fall back to DSH default
      const agentOpts = {}
      if (resolvedProvider) agentOpts.provider = resolvedProvider
      // Only set model if it exists on the resolved provider
      if (binding.model !== undefined && resolvedProvider) {
        if (await modelExists(resolvedProvider, binding.model)) {
          agentOpts.model = binding.model
        }
      } else if (binding.model !== undefined && !resolvedProvider) {
        // No provider available — set model anyway, agent/request handler will validate
        agentOpts.model = binding.model
      }
      // persona/toolFilter 走 DSH spawn 正统通道（SubagentStartRequest），
      // 首条 prompt 保持纯任务文本；内置工种人设经 rolePersona 复用
      // prompts/ 加载链，自定义角色读 settings roles 行。
      const label = agentLabel(agentType, prompt.slice(0, SUBAGENT_PROMPT_MAX))
      const childId = await spawnChild({ agentType, prompt, parent, label, agentOptions: agentOpts, toolFilter: binding.toolFilter, sig })
      sessionTypes.set(childId, agentType)
      orch.bindChild(placeholder.childId, childId)
      childOwner.set(childId, parent.id)
      bump()
      // 链 hop 回填（三期 3.4，§4.2-① 时序契约；回填本体在 relay 簇
      // backfillHopOnArrival）：位置锁死在下方 E2 认领（claimBufferedEnd）之前——
      // 认领重放走全归因管线后查链时回填必已就位，重放查不到链的时序窗口结构性
      // 消失（R11 探针锁此位置约束：挪到认领之后必红）。同步段零 await（协议第 3 条）。
      if (queuedWork) backfillHopOnArrival(queuedWork, childId)
      // E2 缓冲认领点（二期 2.4，方案 A）：登记已落地（type/台账/childOwner 三表
      // 就位），spawn resolve 前抢跑的那条 end 若在缓冲里，此刻按真 id 精确认领
      // 并同步重入归因管线（重放走全管线：E4/E5/E6/E7/E9 全量生效）。同步段零
      // await：认领与重放不引入任何新真空期。
      const buffered = claimBufferedEnd(childId)
      if (buffered !== undefined) processEnd(buffered)
      // 埋点（0.4.0-tisitan.0）：派发成功基线。spawn 已 resolve、登记已落位，
      // 此处即「成功处」——三条派发路（go_work 直派/队列补位/forward 转派工种）
      // 共用本出口，一处埋点全量覆盖。
      metrics.record({ kind: 'dispatch', agentType, promptBytes: prompt.length, ts: Date.now() })
      // 队列任务上岗映射推送：占位 work-* 与真身 childId 的对应关系低频高价值
      // （Sisyphus 手里的 go_work 返回值只有占位 id），注入一行短通知补齐。
      if (queuedWork) {
        notifyParent(parent, `[dsh-my-go] 队列任务上岗: ${queuedWork.id} → ${childId} (${agentType})`)
      }
      // D19 直派补位（二期 2.3，read-pool-semantics.md §2.2）：直派占槽后同 lane
      // 可能仍有空位，立即推进队列——否则读池 2~3 时队列中同 lane 等待任务无人
      // 驱动，饿死到下一个 end。满池/队列无匹配时本调用是 no-op（global-scan
      // 扫不到可上岗 work 即返回），容量 1 退化下恒 no-op（= 旧「直派后不推进」）。
      advanceQueue(orch, parent)
      return { childId, status: 'running', label, queued: false }
    } catch (error) {
      orch.abort(placeholder.childId)
      bump()
      // 槽位已腾出：立即推进队首，避免后续排队任务永久等待
      advanceQueue(orch, parent)
      throw new Error(`go_work failed: ${String(error)}`)
    }
  }

  return {
    dispatchWork,
    advanceQueue,
    rosterKeys,
    liveToolNames,
    spawnChild,
    buildStallNotice,
    clearQueueRetryTimers,
    cancelQueueRetryTimer,
  }
}
