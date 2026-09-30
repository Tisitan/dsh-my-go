/**
 * dsh-my-go — 主编缓存心跳（keep-alive heartbeat）。
 *
 * 要解决的问题：LLM 提供方的 prompt 缓存 TTL 属短 TTL 档（约 5 分钟）。主编派发
 * 子代之后进入「跨 turn 静默等待」，期间主编侧不再有任何请求——缓存冷掉，被唤醒
 * 时是一次全量冷 prefill（长上下文下最贵的一笔）。机制：broker 侧挂**一个主编会话
 * 一枚**的定时器，周期性用 followup 唤醒主编跑一个极便宜的维护回合，让下一次真实
 * 唤醒落在热缓存上；顺带把「长期无信号的子代」浮上主编台面（探活 + 复活 + 困境
 * 上浮），免得一个卡死的子代把整条流水线静默冻住。
 *
 * 三条不变量（改动前先读）：
 *   1. **per-owner 单定时器**：键是属主编排会话 id，绝不 per-child。N 个子代共享
 *      一拍，摘要里每个子代一行；per-child 定时器会让 N 个子代把主编唤醒 N 次。
 *   2. **只唤醒，不注入**：投递走 parent.followup（waking 档）。parent.inject 是
 *      非唤醒档（notify 簇的补充通知用它），对「续缓存」这个目的毫无作用——它是
 *      本模块唯一的投递原语，不许换成 inject。
 *   3. **空闲才唤醒**：parent.status === 'running' 时跳拍（主编正在真实工作，
 *      缓存本来就热，再投一条只会插队）；无在飞子代即停表（没有等待，就没有
 *      需要续的缓存）。
 *
 * 停表条件（任一成立，定时器不再重排）：
 *   - 配置关闭（enabled=false，含运行期热更关）；
 *   - 主编会话已不在 agents 注册表；
 *   - 该会话的流水线无在飞子代（currentMap 空）；
 *   - 门面不提供 followup（本版 runtime 无法唤醒 → 空转无意义，留痕停表）。
 * 「主编 running」是**跳拍**而非停表：真实回合结束后缓存仍需续，下一拍照常。
 *
 * 摘要口径（buildHeartbeatSummary，纯函数、可单测）：主编每拍收到的就是这一条
 * 紧凑文本，目标 ≤ HEARTBEAT_SUMMARY_MAX_BYTES（500B）。头行除三个计数外还给
 * **界限**——`｜界限≈Xm` = HEARTBEAT_LIMIT_TICKS × 本拍生效拍距（主编「界限裁决」
 * 那一节要用的数，随拍距热更自动跟随；口径见 constants.mjs 该常量注释）。每个
 * 在飞子代一行：childId / 工种 / 本轮已运行 / 距上次信号 / 未回应 ping 数；距上次
 * 信号 ≥ childPingAfterMs 的标「建议ping」，pingsUnanswered ≥ escalateAfterPings
 * 的标红请主编当场裁决。超限时**按「需要动作优先」排序保留**（标红 → 建议ping →
 * 静默最久），放不下的折成一行 `+N 条见 orchestration_status`：排序让先被折进计数的
 * 通常是最不需要主编当下看的那些，但这是**概率性优先而非硬保证**（同时标红的条数
 * 多到装不下时，照样有标红行被折进 `+N`——`+N` 就是让读者去查全量的那根指针）。
 *
 * pingsUnanswered 语义（与「任何信号都清零」的分工）：它是「心跳连着几拍判定该
 * 子代该被 ping、而这期间该子代与它的事务没得到任何动作」的计数。子代自身的信号
 * （spawn / continue / need_help / report_submit / end）由桥侧 noteHeartbeatSignal
 * 清零；本模块在判定 stale 的那一拍 +1。于是主编只要照摘要发一次 continue(steer)
 * 询问，计数即归零（信号已刷新）；连续多拍不理，才会升到标红——这正是「主编
 * 把一条卡死的线忘了」的现场，也正是标红要求当场裁决的用意。
 *
 * 形态（对齐既有簇范式）：createHeartbeatOps({ readConfig, resolveParentAgent,
 * orchestrations, childRegistry, metrics, now, setTimer, clearTimer,
 * summaryMaxBytes }) → { ensure, syncAll, stop, stopAll, tickOnce, runningOwners,
 * pause, resume, status }。后三件是**主编自助面**（工具 heartbeat 的落点，语义见
 * 下方「主编自助闸」一段）——它们不新增任何判定，只把既有两个口（stop / ensure）
 * 与一次纯查表包成语义名；「暂停」本身不落状态，故本模块仍只有 timers/ticks 两张表。
 * 零 ctx：agents 注册表经 resolveParentAgent 回调逐调用现取（与原读 ctx 的时点
 * 一致）；时间与定时器可注入（now / setTimer / clearTimer），单测据此拿到确定性
 * 时钟，不必 patch 全局定时器（同进程里还有台账防抖与宽限期定时器，全局替换会把
 * 它们一起冻住）。配置经 readConfig **逐拍现读**——宿主 volatile 提交后下一拍即
 * 生效，无需订阅任何事件。
 *
 * syncAll 的职责（「起表」与「停表」的唯一全量对账口）：派发/复活点各自 ensure
 * 只解决「派了一跳」；**配置热更把 enabled 从假翻成真时，在飞会话身上没有任何
 * 派发事件可挂**——那条缺口由 syncAll 兜：逐流水线对账「有在飞且开启 → 起表，
 * 没有在飞 → 停表」。调用点两处：subagent/end 之后（broker.mjs 的注册点）与
 * 宿主配置桥的段版本推进处（broker.mjs 的 currentBindings）。
 *
 * ── 热更生效时点（已知边界，惰性对账）────────────────────────────────────────
 * 热更开启是**惰性**的：段版本推进只标记「配置变了」，真正补起表要等下一次 broker
 * 交互（派发 / continue·forward / 编排工具调用 / 子代理的 agent/request 瀑布——
 * 它们都会读一次配置段，于是顺手对账一次）。**完全无请求流量的窗口内不会自发起表**：
 * 子代卡在一条长工具调用上、主编侧零交互时，把 keepAlive 打开不会立刻有拍子，要等
 * 下一次流量。这是刻意的：要让它自发起表就得在 broker 侧新起一类「配置观察定时器」，
 * 那既越出「per-owner 单定时器」的形态，也与「默认关 = 零盘触零事件」冲突；而挂到
 * 既有 bump() 上是零增益（`bump` 只在编排状态变化时触发，缺口窗口恰恰没有状态变化）。
 * 关的一侧不受此限：已起的拍子下一拍即停（tickOnce 首查 enabled）。
 *
 * ── 主编自助闸（工具 heartbeat：pause / resume / status）────────────────────────
 * 上面一切判定都是自动的；唯有一个窗口是**只有主编自己知道**的：他明知接下来要长
 * 时间静默、且不希望被维护回合打扰（等一个不可中断的外部动作、等维护者回话）。此时
 * 主编用工具 heartbeat(action='pause') 把本会话的拍子停掉，静默期结束后 resume。
 *
 * pause 的语义就是 stop(parentId,'paused')——**零新增状态、不记「为谁停过」**：
 * 它撤掉的只是「当下这一枚定时器」，不是一道闸。于是三条推论天然成立：
 *   1. 真事件照来：子代完工的 end、求助单、信号由别的通道投递，与拍子在不在无关；
 *   2. 下一次真实活动自动复活：派发 / continue 两档 / forward / 备选重派 / end 后
 *      syncAll 这些 ensure 点（见模块头 A5 口径）本就会把拍子点起来——「暂停」的
 *      生命期最长到下一个真事件为止，不需要任何人来收尸；
 *   3. 没有「暂停标志」可泄漏：没有 flag 就没有「忘了恢复」这种故障形态，也就没有
 *      per-owner 之外的任何状态需要随会话销毁清理。
 * resume 就是 ensure(parentId,'manual')（幂等：已有拍子不重排、配置关不起表）；
 * status 是纯查表快照（running / tick / 生效配置），零副作用、不出事件。三件都只
 * 作用于调用者自己的 parentId（工具面从 exec.agent.id 取，不经参数面）。
 */

import {
  HEARTBEAT_LIMIT_TICKS,
  HEARTBEAT_SUMMARY_MAX_BYTES,
  KEEP_ALIVE_DEFAULTS,
} from '../shared/constants.mjs'

// 非负整数归一：非法（NaN/负数/非数值串）一律回落 fallback。
// 上限不设——配置项本身就是节流参数，用户给 10 秒一拍是他的选择。
function normalizeDuration(value, fallback) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : fallback
}

/**
 * 心跳配置归一（两层合并：插件 mount-time config 为基线，宿主 settings 段覆盖）。
 * 逐字段净化，非法值回落默认——配置面写坏一个数字不该让心跳变成每毫秒唤醒一次。
 * @param base 插件 config.keepAlive（可缺）
 * @param section 宿主桥交出的 settings.keepAlive 段（可缺）
 */
export function normalizeKeepAlive(base, section) {
  const lower = base !== null && typeof base === 'object' ? base : {}
  const upper = section !== null && typeof section === 'object' ? section : {}
  const pick = (key) => (upper[key] !== undefined ? upper[key] : lower[key])
  return {
    enabled: pick('enabled') === true,
    orchestratorIntervalMs: normalizeDuration(pick('orchestratorIntervalMs'), KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs),
    childPingAfterMs: normalizeDuration(pick('childPingAfterMs'), KEEP_ALIVE_DEFAULTS.childPingAfterMs),
    escalateAfterPings: normalizeDuration(pick('escalateAfterPings'), KEEP_ALIVE_DEFAULTS.escalateAfterPings),
  }
}

/** UTF-8 字节数（摘要上限按字节算：中文一个字 3 字节，按字符算会超一倍）。 */
export function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? '')).length
}

/** 时长紧凑格式：45s / 12m / 2h05m（摘要里每一拍都要出现，越短越好）。 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000)
  if (total < 60) return `${Math.round(total)}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// 排序权重：需要动作的排前面（标红 → 建议ping → 静默最久）。截断按这个序丢尾，
// 于是「余下 N 行」里丢掉的永远是此刻最不需要主编看的那几条。
function actionRank(child) {
  if (child.escalate === true) return 0
  if (child.stale === true) return 1
  return 2
}

function childLine(child, at) {
  const gap = at - Number(child.lastSignalAt ?? at)
  const run = at - Number(child.roundStartAt ?? at)
  const pings = Math.max(0, Number(child.pingsUnanswered) || 0)
  const marks = []
  if (child.stale === true) marks.push('建议ping')
  if (child.escalate === true) marks.push(`⚠连续${pings}轮无回应→当场裁决`)
  return `- ${child.childId} ${child.agentType} run${formatDuration(run)} sig${formatDuration(gap)} ping${pings}${marks.length > 0 ? ` ${marks.join(' ')}` : ''}`
}

/**
 * 心跳摘要（纯函数）。子代行按「需要动作优先」排序，超限丢尾并折成一行计数。
 * @param input.children - [{ childId, agentType, roundStartAt, lastSignalAt,
 *   pingsUnanswered, stale, escalate }]（stale/escalate 由调用方按配置判定）
 * @param input.at - 本拍时间戳（ms）
 * @param input.limitMs - 本拍界限（= HEARTBEAT_LIMIT_TICKS × 生效拍距，由调用方
 *   逐拍现读配置算出）；缺席时按默认拍距算，直测不传也拿得到合理头行
 * @returns 恰好一条 ≤ maxBytes 的文本
 */
export function buildHeartbeatSummary({
  tick,
  children = [],
  queueLen = 0,
  helpCount = 0,
  at = Date.now(),
  limitMs = HEARTBEAT_LIMIT_TICKS * KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs,
  maxBytes = HEARTBEAT_SUMMARY_MAX_BYTES,
}) {
  const ordered = [...children].sort((a, b) => {
    const byRank = actionRank(a) - actionRank(b)
    if (byRank !== 0) return byRank
    return Number(a.lastSignalAt ?? 0) - Number(b.lastSignalAt ?? 0)
  })
  const head = `[dsh-my-go] 心跳维护回合 #${tick}｜在飞 ${ordered.length} 排队 ${queueLen} 待决求助 ${helpCount}｜界限≈${formatDuration(limitMs)}`
  const foot = '处置见 sisyphus.md「心跳维护回合」；无增值即一行收尾，本回合禁新派工。'
  const lines = ordered.map((child) => childLine(child, at))
  const render = (kept) => {
    const omitted = lines.length - kept
    const tail = omitted > 0 ? [`+${omitted} 条见 orchestration_status`] : []
    return [head, ...lines.slice(0, kept), ...tail, foot].join('\n')
  }
  let kept = lines.length
  let text = render(kept)
  while (kept > 0 && utf8Bytes(text) > maxBytes) {
    kept -= 1
    text = render(kept)
  }
  return text
}

/**
 * @param options.readConfig 现读归一后的心跳配置（热更即生效）
 * @param options.resolveParentAgent (parentId) => Agent | undefined（agents 注册表）
 * @param options.orchestrations Map<parentId, Orchestration>（broker 活状态句柄）
 * @param options.childRegistry 子代理登记表（noteHeartbeatPing / heartbeatOf）
 * @param options.metrics 观测埋点（record，可省）
 * @param options.now / options.setTimer / options.clearTimer 时钟与定时器注入
 */
export function createHeartbeatOps({
  readConfig,
  resolveParentAgent,
  orchestrations,
  childRegistry,
  metrics,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  summaryMaxBytes = HEARTBEAT_SUMMARY_MAX_BYTES,
}) {
  // parentId → timer；parentId → 本会话的拍号（停表即清，重新起表从 #1 数）
  const timers = new Map()
  const ticks = new Map()

  const record = (event) => {
    try {
      metrics?.record?.(event)
    } catch { /* 观测永不打断编排热路径 */ }
  }

  function schedule(parentId) {
    const { orchestratorIntervalMs } = readConfig()
    // 防御性撤同名旧表：正常调用序下走到这里的会话只可能没有拍子（ensure 幂等 /
    // tick 先摘），但「表里那枚是上一代遗留」一旦发生就是双拍——把这条从调用序
    // 纪律升级为函数自身的保证（漏一所旧定时器的代价是每个拍距多醒一次）。
    const stale = timers.get(parentId)
    if (stale !== undefined) {
      clearTimer(stale)
      timers.delete(parentId)
    }
    // 回调不自己摘表：摘表与「这次停的是一枚真拍子」的留痕都在 tick 里做
    //（回调先摘会让 stop 判成空转，自停的原因事件整体蒸发）。
    const timer = setTimer(() => tick(parentId), orchestratorIntervalMs)
    // 定时器不应阻止进程退出（与队列重试/宽限期定时器同律）
    timer?.unref?.()
    timers.set(parentId, timer)
  }

  /**
   * 起表（幂等）：已有定时器的会话不重排，否则每派一个子代就把拍距推后一次。
   * @param via 起表来源（进观测事件的 via 字段：dispatch / revive / end-reevaluate /
   *   settings-revision …）——「谁把这条会话的拍子点着的」是排障第一问。
   */
  function ensure(parentId, via = 'dispatch') {
    if (typeof parentId !== 'string' || parentId === '') return false
    if (timers.has(parentId)) return false
    if (!readConfig().enabled) return false
    ticks.set(parentId, 0)
    schedule(parentId)
    record({ kind: 'heartbeat', phase: 'start', via, sessionId: parentId })
    return true
  }

  /**
   * 停表：撤定时器 + 清拍号。**唯一带观测的停表口**（每次真停表都落一条
   * `heartbeat/stop-<reason>` 事件）——「定时器还在不在」是纯内部状态，外部
   * （面板、测试、排障）只能靠这条事件看见它，故不能有静默停表的分支。
   * @param reason 停表原因（disposed / session-disposed / idle-registry /
   *   no-parent / disabled / no-followup / end-reevaluate …）
   * @param live 「这次停的是一枚真在跑的拍子吗」——默认按表里有没有定时器判；
   *   定时器回调路径必须显式传 true（那枚定时器已被回调自身摘掉，再按表判会
   *   把每一次自停都记成空转，`stop-idle-registry` 这类关键留痕就此蒸发）。
   */
  function stop(parentId, reason = 'manual', live = timers.has(parentId)) {
    const timer = timers.get(parentId)
    if (timer !== undefined) {
      clearTimer(timer)
      timers.delete(parentId)
    }
    ticks.delete(parentId)
    // 无拍子可撤 = 空转（agent/disposed 对子代 id 也会来一发），不记事件。
    if (live) record({ kind: 'heartbeat', phase: `stop-${reason}`, sessionId: parentId })
    return live
  }

  function stopAll() {
    for (const timer of timers.values()) clearTimer(timer)
    timers.clear()
    ticks.clear()
  }

  /**
   * 主编自助：暂停本会话拍子（工具 heartbeat(action='pause') 的唯一落点；幂等）。
   * 复用 stop 这唯一带观测的停表口（reason='paused' → 事件 heartbeat/stop-paused），
   * 故「主编亲手停的」与「自动停的」在观测面上可区分。幂等由 stop 自身成立：表里
   * 没有定时器时它返回 false 且**不记事件**（空转不留痕），连调两次不会出第二条。
   * @returns 真撤掉一枚拍子 = true；本来就没在跑 = false（语义不变，仍是成功调用）
   */
  function pause(parentId) {
    return stop(parentId, 'paused')
  }

  /**
   * 主编自助：恢复本会话拍子（工具 heartbeat(action='resume')；幂等）。
   * 就是既有的幂等起表口 ensure（via='manual' 进观测，与自动起表的原因可区分）：
   * 已有拍子不重排、配置关不起表——幂等性不从别处新造。
   * 刻意**不预置在飞判据**：本会话没有在飞子代时点起来的这一拍，下一拍会由 tickOnce
   * 的 idle-registry 支自行停掉（多留一条 start/stop 留痕，好过在心跳里复制一份
   * 「有没有在飞」的判据——那是流水线状态，唯一出处是 orchestrations）。
   * @returns 真起了表 = true；已有拍子或配置关 = false
   */
  function resume(parentId) {
    return ensure(parentId, 'manual')
  }

  /**
   * 主编自助：本会话拍子状态快照（纯查表：零副作用、不建表、不出事件）。
   *   running 表里有没有定时器（= 下一拍还会不会来）
   *   tick    当前拍号（stop 即清，故未起表/已停表恒 0；重新起表从 #1 数）
   *   config  生效的 keepAlive 配置快照（与 tickOnce 同一读法：逐调用现读，
   *           enabled 是此刻的宿主桥段值——「配置关着所以起不来」在主编侧可见）
   * 键就是调用者自己的 parentId：本函数没有第二个会话的读法。
   */
  function status(parentId) {
    return {
      running: timers.has(parentId),
      tick: ticks.get(parentId) ?? 0,
      config: readConfig(),
    }
  }

  /**
   * 一拍的全部判定（同步、无定时器副作用）。
   * @param liveBeat 本次判定是否来自一枚真在跑的拍子（定时器回调路径传 true；
   *   直调路径按表判）——只影响停表留痕，不影响任何行为分支。
   * @returns 'woken'（已唤醒主编）| 'skipped'（主编 running，跳拍）| 'stopped'（停表）
   */
  function tickOnce(parentId, { liveBeat = timers.has(parentId) } = {}) {
    const config = readConfig()
    if (!config.enabled) {
      stop(parentId, 'disabled', liveBeat)
      return 'stopped'
    }
    const parent = resolveParentAgent(parentId)
    if (!parent) {
      stop(parentId, 'no-parent', liveBeat)
      return 'stopped'
    }
    const orch = orchestrations.get(parentId)
    const records = orch ? [...orch.currentMap.values()] : []
    if (records.length === 0) {
      stop(parentId, 'idle-registry', liveBeat)
      return 'stopped'
    }
    // 主编正在真实回合：缓存本来就热，插一条只会打断它。重排等它安静下来。
    if (parent.status === 'running') {
      record({ kind: 'heartbeat', phase: 'skip-running', sessionId: parentId, children: records.length })
      return 'skipped'
    }
    const at = now()
    const children = records.map((rec) => {
      // 冷恢复/台账复活的儿童可能没有表项：读面补种（此刻起算，不制造假 stale）
      const entry = childRegistry.heartbeatOf(rec.childId, at)
      const stale = at - Number(entry.lastSignalAt ?? at) >= config.childPingAfterMs
      if (stale) childRegistry.noteHeartbeatPing(rec.childId, at)
      const pings = Math.max(0, Number(childRegistry.heartbeatOf(rec.childId, at).pingsUnanswered) || 0)
      return {
        childId: rec.childId,
        agentType: rec.agentType,
        roundStartAt: entry.roundStartAt,
        lastSignalAt: entry.lastSignalAt,
        pingsUnanswered: pings,
        stale,
        escalate: stale && pings >= config.escalateAfterPings,
      }
    })
    const tick = (ticks.get(parentId) ?? 0) + 1
    ticks.set(parentId, tick)
    const summary = buildHeartbeatSummary({
      tick,
      children,
      queueLen: orch?.queue?.length ?? 0,
      helpCount: orch?.helpRequests?.size ?? 0,
      at,
      // 界限逐拍现读：config 是本拍开头 readConfig() 的结果，热更下一拍即跟随。
      limitMs: HEARTBEAT_LIMIT_TICKS * config.orchestratorIntervalMs,
      maxBytes: summaryMaxBytes,
    })
    const delivered = wake(parent, summary)
    record({
      kind: 'heartbeat',
      phase: delivered ? 'wake' : 'wake-rejected',
      sessionId: parentId,
      children: children.length,
      queued: orch?.queue?.length ?? 0,
      bytes: utf8Bytes(summary),
      stale: children.filter((child) => child.stale).length,
      escalated: children.filter((child) => child.escalate).length,
    })
    if (!delivered) {
      // 门面拿不到 followup：本版 runtime 无法唤醒主编，继续拍只是空转
      stop(parentId, 'no-followup', liveBeat)
      return 'stopped'
    }
    return 'woken'
  }

  function tick(parentId) {
    // 定时器回调路径：表里那枚已触发，先摘（留 liveBeat=true 交给 tickOnce 留痕——
    // 按表判会把每一次自停都记成空转）。
    const live = timers.has(parentId)
    if (live) {
      clearTimer(timers.get(parentId))
      timers.delete(parentId)
    }
    const outcome = tickOnce(parentId, { liveBeat: live })
    if (outcome !== 'stopped') schedule(parentId)
  }

  /** 唤醒主编（唯一投递原语：followup = waking 档；inject 不唤醒，绝不可替代）。 */
  function wake(parent, summary) {
    if (typeof parent?.followup !== 'function') {
      console.warn(`[dsh-my-go] heartbeat: parent ${String(parent?.id)} exposes no followup() on this runtime; keep-alive stopped for this session`)
      return false
    }
    try {
      parent.followup({
        id: `mygo-heartbeat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text: summary }],
        source: {
          kind: 'plugin:dsh-my-go',
          // 语义面是 notice（一次性「刚发生了什么」的账），交付面是 followup：
          // 两者正交——MessageSource 的 form 词表是内容语义，不含「唤醒与否」。
          form: 'notice',
          summary: summary.split('\n', 1)[0].slice(0, 119),
        },
      })
      return true
    } catch (error) {
      console.warn(`[dsh-my-go] heartbeat: wake failed for parent ${String(parent?.id)}: ${String(error)}`)
      return false
    }
  }

  /**
   * 全量对账（「起表」与「停表」的唯一全量口）：逐流水线判定
   *   无在飞子代（或实例已消失）→ stop；
   *   有在飞 + 配置开启 + **属主活体在册** → ensure（无拍子才真起，幂等）。
   * 两个调用点各补一类缺口：① subagent/end 之后（无在飞即停，不为注定空转的拍子
   * 留定时器；end 里的 advanceQueue 已把下一跳占位落进 currentMap，不会误停）；
   * ② 宿主配置桥段版本推进处（**热更 enabled 假→真对在飞会话的生效路径**——
   * 在飞会话身上没有派发事件可挂，只靠 ensure 永远补不上表；注意这条路径是
   * **惰性对账**：完全无请求流量、无编排工具调用的窗口内不会自发起表，见模块头
   * 「热更生效时点」一段）。
   *
   * 属主活体判据（R-2）：`resolveParentAgent` 查不到这个 id 时不补起表——典型现场
   * 是 agent 已销毁而台账还留着在册记录等 disposed 宽限期，此时起表只会得到一拍
   * 「查不到会话 → 立即自停」的空转（tickOnce 的 no-parent 支），白落一条 start
   * 加一条 stop-no-parent。已存在的拍子不由本判据抢停（那是 tick 的 no-parent
   * 职责，两处不重复决策）。
   * @returns 本次真正起表/停表的 parentId 列表（观测与测试用）
   */
  function syncAll(reason = 'sync-idle') {
    const enabled = readConfig().enabled
    const started = []
    const stopped = []
    for (const [parentId, orch] of orchestrations) {
      const inflight = orch ? orch.currentMap.size > 0 : false
      if (!inflight) {
        if (stop(parentId, reason)) stopped.push(parentId)
        continue
      }
      // 有在飞但配置关：拍子在下一拍自停（tickOnce 首查 enabled），此处不抢停
      // ——留一拍余量，免得「关一下又开」的抖动把在飞会话的拍子连根拔掉。
      if (!enabled) continue
      if (resolveParentAgent(parentId) === undefined) continue
      if (ensure(parentId, reason)) started.push(parentId)
    }
    return { started, stopped }
  }

  return {
    ensure,
    stop,
    stopAll,
    tickOnce,
    syncAll,
    runningOwners: () => [...timers.keys()],
    // 主编自助三件（工具 heartbeat）：pause/resume 是既有 stop/ensure 的语义名，
    // status 是纯查表——三者都不引入新状态，见模块头「主编自助闸」。
    pause,
    resume,
    status,
  }
}
