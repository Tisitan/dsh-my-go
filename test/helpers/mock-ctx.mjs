/**
 * dsh-my-go — broker.apply 集成测试的统一 ctx 替身（健康度批收敛）。
 *
 * 六个 broker 级测试文件（bridge / multi-session / roster-route /
 * failure-notice / compat-alpha4 / anti-bypass）原本各抄一份 cordis ctx mock，
 * 差异只在「注入哪几个服务、要不要捕获 section/restrict、台账目录前缀」三档——
 * 抄本各自漂移过一次：bridge 的 mock 忘了 tools 服务，liveToolNames 的降级路径
 * 因此在该文件里从未被真正覆盖过。收敛成一处后，新能力只需给各文件补 options。
 *
 * 契约保持（与迁移前逐字段对齐，断言零改动的前提）：
 *   - 服务解析只认显式传入项，未传的 ctx.get(name) 一律 undefined（broker 的
 *     降级分支照旧触发）；
 *   - 台账隔离：每次调用默认换一枚全新临时 DSH_HOME（keepHome=true 时不动，
 *     由台账 round-trip 用例自管）——用例间 history 不串档靠的就是这一条。
 *
 * 0.3.0-tisitan.11 C-09 起替身**变严**（保真度对齐真宿主），以下五条都是刻意
 * 的：它们各自关掉一类「替身比宿主宽容」造成的假绿。
 *   - `listeners` 是 Map<event, fn[]>：真 cordis 一个事件可挂 N 个 handler，
 *     旧的单槽写法让「重复注册」静默覆盖（第二个赢），谁也不知道自己注册了两遍。
 *     点火一律走 `dispatch(event, payload, next)`，它按注册序把 handler 串成
 *     waterfall（最外层的返回值即本次结果，链尾接 next）；原始数组仍可读，
 *     `registeredHandlers()` 给出每事件注册数，用于「这件事只能注册一次」的断言。
 *   - `systemPrompt.section` 重名抛错（真宿主同名段重复注册即抛，靠这个才能证明
 *     名册/编排/persona 三段互不撞名）。
 *   - `effect(fn)` 不再吞异常：吞过一次，section 注册的真错就永远看不见。
 *   - `settings.get(ns)` 返回 structuredClone + 深度冻结的副本：写变异宿主存储
 *     在真宿主上要么被 schema 拒、要么污染别人，替身里必须当场红。
 *   - `tools.register` 重名抛错（同一 scope 注册两次是实打实的冲突）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/**
 * @param options.startContinuable ctx.subagents.startContinuable 替身
 * @param options.agents      ctx.get('agents') 返回值
 * @param options.llm         ctx.get('llm')
 * @param options.settings    ctx.get('settings')
 * @param options.sessions    ctx.get('sessions')
 * @param options.toolsRegistry ctx.get('tools')（liveToolNames 的数据源）
 * @param options.subagentsExtra 追加进 ctx.subagents 的成员（followup/
 *                               sendMessage/interrupt/[queuePrompt] 等）
 * @param options.keepHome    不改写 process.env.DSH_HOME
 * @param options.homePrefix  临时台账目录前缀（各文件保留自己的前缀便于排查）
 * @param options.captureSections 捕获 systemPrompt.section 注册项
 * @param options.captureRestrict 捕获 tools.restrict 调用（工具面具闸断言用）
 * @param options.captureEffects  捕获 effect 作用域返回的清理函数（卸载路径
 *                                 断言用，如台账防抖窗 flush）：真实 cordis 要
 *                                 等 scope Dispose 才调它，替身默认丢弃
 * @returns ctx + { listeners: Map<event, fn[]>, dispatch(event, ...args),
 *           registeredHandlers(): {event: n} 每事件注册数, ... }
 */
export function createMockCtx({
  startContinuable,
  agents,
  llm,
  settings,
  sessions,
  toolsRegistry,
  subagentsExtra,
  keepHome = false,
  homePrefix = 'dsh-my-go-home-',
  captureSections = false,
  captureRestrict = false,
  captureEffects = false,
} = {}) {
  if (!keepHome) process.env.DSH_HOME = mkdtempSync(join(tmpdir(), homePrefix))
  const listeners = new Map()
  const tools = new Map()
  const sectionNames = new Set()
  const sections = []
  const restricted = []
  const effects = []
  const on = (event, fn) => {
    if (typeof fn !== 'function') throw new TypeError(`ctx.on('${event}') 需要一个函数 handler`)
    listeners.set(event, [...(listeners.get(event) ?? []), fn])
    return () => listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== fn))
  }
  // 点火 = 真 cordis 的 waterfall：handlers 按注册序串成链，最外层那位的返回值
  // 就是本次事件的结果，链尾接调用方给的 next。为什么不是「逐个调用取数组」——
  // agent/request / session/event 这类事件的 handler 靠 next 串联，各自都拿到同一个
  // next 会把语义彻底跑歪（等于每个 handler 都以为自己是最后一个）。
  // 单 handler 事件（subagent/end、agent/created、settings/updated…）行为与旧替身
  // 完全一致，因此既有 114 处点火点零改动。
  const dispatch = (event, payload, next) => {
    const handlers = listeners.get(event) ?? []
    let reached = -1
    const run = (i, data) => {
      if (i <= reached) throw new Error(`dispatch('${event}'): next() 被重复调用`)
      reached = i
      if (i >= handlers.length) return typeof next === 'function' ? next(data) : undefined
      return handlers[i](data, (nextData) => run(i + 1, nextData === undefined ? data : nextData))
    }
    return run(0, payload)
  }
  // 普通广播事件（宿主不期待返回值、也不串 next）：逐个调用，各拿同一份 data。
  // 与 dispatch 分开是因为两者语义真的不同——把 interceptor 链当成广播跑，或反之，
  // 都会让「两个互不相干的监听者」和「两层包装」这两种形状混为一谈。
  const dispatchEach = (event, data) => (listeners.get(event) ?? []).map((fn) => fn(data))
  const registeredHandlers = () => Object.fromEntries([...listeners].map(([event, fns]) => [event, fns.length]))
  // 宿主存储是纯数据：读出去的东西一律不可变（写变异 = 当场红），并且每次读
  // 都是新副本（不共享引用，杜绝「改读到的对象」被误当成「写回了存储」）。
  const settingsView = settings === undefined ? undefined : {
    ...settings,
    get: (name) => {
      const value = typeof settings.get === 'function' ? settings.get(name) : undefined
      if (value === undefined || value === null) return value
      if (typeof value !== 'object') return value
      try {
        return deepFreeze(structuredClone(value))
      } catch (err) {
        throw new Error(`settings.get('${name}') 返回值必须可 structuredClone（宿主存储是纯数据）：${err.message}`)
      }
    },
  }
  const subagents = { startContinuable, ...subagentsExtra }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return agents
      if (name === 'llm') return llm
      if (name === 'settings') return settingsView
      if (name === 'sessions') return sessions
      if (name === 'tools') return toolsRegistry
      if (name === 'subagents') return subagents
      return undefined
    },
    on,
    effect: (fn, name) => {
      // 不再吞异常（C-09）：真宿主里这段抛错就是 apply 失败，替身 swallow 一次
      // 就把「section 注册写错」这类真 bug 永久藏起来。
      const cleanup = fn()
      // 真实 cordis：effect(scope 工厂) 返回的 Dispose 只在 scope 卸载时才跑。
      // 替身默认丢弃返回值（若干注册型 effect 的清理会掐掉别的用例正在等的
      // 定时器）；captureEffects 时按名字收集，由卸载路径用例自己点火。
      if (captureEffects && typeof cleanup === 'function') effects.push({ name, dispose: cleanup })
    },
    systemPrompt: {
      section: (def) => {
        const name = def?.name
        if (!name) throw new TypeError('systemPrompt.section 需要一个带 name 的段定义')
        // 真宿主：同一 scope 内同名段重复注册直接抛错（覆盖顺序不可靠）
        if (sectionNames.has(name)) throw new Error(`duplicate systemPrompt.section: ${name}`)
        sectionNames.add(name)
        if (captureSections) sections.push(def)
      },
    },
    tools: {
      register: (tool) => {
        if (!tool?.name) throw new TypeError('tools.register 需要一个带 name 的工具定义')
        if (tools.has(tool.name)) throw new Error(`duplicate tool registration in this scope: ${tool.name}`)
        tools.set(tool.name, tool)
      },
      restrict: captureRestrict ? (filter) => { restricted.push(filter) } : () => {},
    },
    subagents,
  }
  return { ctx, listeners, tools, sections, restricted, effects, subagents, dispatch, dispatchEach, registeredHandlers, settingsView }
}

// dsh-subagent 的真实契约包装：startContinuable 无条件解引用 spec.signal
// （undefined 时抛 TypeError）。旧式 mock 完全忽略 spec，会让「队列回补后重试
// 消化」在 signal=undefined 的路径上假通过——部署实测炸过一次，故固化为共享件。
export const withRealSignalContract = (fn) => async (spec) => {
  spec.signal.throwIfAborted()
  return fn(spec)
}

// 工具执行上下文：真实 harness 恒带 agent 与 AbortSignal
export const execOf = (agent) => ({ agent, signal: new AbortController().signal })

// 快照桥读取（broker.apply 发布）与多会话聚合下的分桶取数
export const snapshotNow = () => globalThis[Symbol.for('dsh-my-go.snapshot')]()
export const snapOf = (pid) => snapshotNow()?.parents?.[pid]

// 定时器类用例的让步（queueRetryBaseMs 已缩到毫秒级）。
// 只用于「等一会儿看有没有坏事发生」的负向窗口（宽限期/防抖窗未触发类断言）——
// 正向等待一律改用 waitFor：固定 sleep 是墙钟赌注，20 个测试文件并行时 CPU 抢
// 不过就假红（0.3.0-tisitan.11 C-12 实测：备选链尽与重试上限两例约 1/5 概率翻脸）。
export const drain = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

// 等到条件成立为止（有界）：把「等固定时长后断言」换成「等条件成立后断言」。
// 超时不静默放行而是抛错——否则它会替真 bug 打掩护，比固定 sleep 更坏。
export const waitFor = async (pred, { timeoutMs = 2000, intervalMs = 5, what = 'condition' } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pred()) return true
    if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

// 删除临时 DSH_HOME 的稳妥版：有界重试 ENOTEMPTY / EBUSY / EPERM。
// 存在理由（0.3.0-tisitan.12 实测）：插件带一枚台账防抖写（scheduleLedgerSave，
// 默认 50ms），用例结束裸 rm 时，那次迟到的写入正好把已删空的目录重新填满，rm
// 当场 ENOTEMPTY——并行 20 个文件抢 CPU 时最容易撞上（B5 把 end 决策搬进纯函数、
// 同步段多几微秒，第一次把它逼出来）。产品写自己的 HOME 是职责，不是 bug；错的
// 是测试跟自己的清理抢跑。正解是卸载插件（cleanup effect 会同步 flush 并撤表），
// 但多数用例没捕获 effect，故清理统一走这里。新增带临时 HOME 的用例请用本函数。
export const removeHomeWithRetry = async (path, { attempts = 8, delayMs = 25 } = {}) => {
  const { rm } = await import('node:fs/promises')
  for (let i = 0; ; i += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      const retriable = ['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)
      if (!retriable || i >= attempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

// 最小 live Agent 形状（broker 的星型闸与 sender 校验只认这三档字段）
export const agentOf = (id, header = {}) => ({ id, session: { header } })
