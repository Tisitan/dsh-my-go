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
 *
 * 0.1.7 契约改造（本次）：settings 命名空间注册整块退役，配置面由插件顶层 `Config`
 * 声明，宿主经 `apply(ctx, config)` 把**已解析的段**交进来。替身随之改三处：
 *   - `resolvedHostConfig(row)`：用真 cordis resolveConfig + 真 lib/config.js 复现
 *     宿主挂载期那一步，测试里的 config 与宿主交进 apply 的 config 逐字段同形；
 *   - `settings` 选项语义从「带 get(ns) 的存储面」改为「settings 服务替身」
 *     （configure / mutate），并补上 `ctx.inject`（宿主半经子 fiber 的 inject 才
 *     拿 settings 服务）；
 *   - `setHostBindings(section)`：宿主半配置桥（Symbol.for('dsh-my-go.bindings')）
 *     的替身。broker 半逐调用现读它，改 section 即等价于一次热更——旧
 *     `settings.get` + `settings/updated` 那套驱动方式随之退役。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '@deepseek-ai/cordis'

import { Config as HostConfig } from '../../lib/config.js'

const BINDINGS_BRIDGE = Symbol.for('dsh-my-go.bindings')
const REVISION_BRIDGE = Symbol.for('dsh-my-go.bindings-revision')

/**
 * 宿主半的行 config 解析（0.1.7 契约）：真宿主在挂载期经
 * `resolveConfig(fiber.runtime, raw)` 把 Config 声明的 volatile 顶层字段换成活访问器
 * （`config.<field>.get()`），schema 不认的键（bindings / installPreset / legacy 顶级
 * 工种键）原样带出。替身走**同一份真代码 + 同一份真 schema**，于是测试里的 config
 * 与宿主交给 apply 的 config 逐字段同形，不是手抄的形状近似。
 */
export const resolvedHostConfig = (row = {}) => resolveConfig({ Config: HostConfig }, row)

/** settings 服务替身：宿主半只用它两件事——关自动页（configure）与 legacy roles 迁移落盘（mutate）。 */
export const createSettingsStub = (overrides = {}) => ({
  configure: () => () => {},
  mutate: async () => {},
  ...overrides,
})

/**
 * 宿主半配置桥的替身（两个符号一对）：段访问器 + 段版本号。每次 setHostBindings
 * 等价于宿主半的一次 volatile 提交（版本号自增），broker 半逐调用比对版本号——
 * 所以「再调一次 setHostBindings」就是一次热更，无需任何事件。
 * @param source 段值或返回段的函数。
 * @returns 卸载函数（用例结束还原，避免跨文件串味）。
 */
let hostBindingsRevision = 0
export const setHostBindings = (source) => {
  const read = typeof source === 'function' ? source : () => source
  const previousSection = globalThis[BINDINGS_BRIDGE]
  const previousRevision = globalThis[REVISION_BRIDGE]
  hostBindingsRevision += 1
  globalThis[BINDINGS_BRIDGE] = read
  globalThis[REVISION_BRIDGE] = () => hostBindingsRevision
  return () => {
    if (previousSection === undefined) delete globalThis[BINDINGS_BRIDGE]
    else globalThis[BINDINGS_BRIDGE] = previousSection
    if (previousRevision === undefined) delete globalThis[REVISION_BRIDGE]
    else globalThis[REVISION_BRIDGE] = previousRevision
  }
}

/** 清掉配置桥（模拟宿主半未装配/旧宿主：broker 必须优雅降级，不许裸炸）。 */
export const clearHostBindings = () => {
  delete globalThis[BINDINGS_BRIDGE]
  delete globalThis[REVISION_BRIDGE]
}

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
 * @param options.sectionOrders   宿主代开关：传入 SECTION_ORDERS 表（如
 *                                 { DEPLOYMENT_PERSONA_PREFIX: 0,
 *                                   DEPLOYMENT_PERSONA_SUFFIX: 10200 }）即 0.1.5+
 *                                 新宿主形态，替身带上 getSectionOrder（与真宿主
 *                                 同为纯查表：未知键返回 undefined、不抛）；不传
 *                                 保持旧宿主形态（方法缺席），persona 双代分支
 *                                 两代都能覆盖
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
  sectionOrders,
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
  // ctx.inject 替身：0.1.7 起宿主半经子 fiber 的 inject 才拿 settings 服务
  // （配置面已改声明式，settings 不入 entry inject）。替身按依赖名交出子 ctx，
  // effect / on 与父 ctx 同源（清理函数照旧进 captureEffects）。
  const inject = (deps, cb) => {
    const wanted = Array.isArray(deps) ? deps : [deps]
    const child = {
      settings: wanted.includes('settings') ? settingsView : undefined,
      get: (name) => (wanted.includes(name) ? ctx.get(name) : undefined),
      on,
      effect: (fn, name) => ctx.effect(fn, name),
    }
    return cb(child)
  }
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
    inject,
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
      // 宿主代开关（见 options.sectionOrders）：真宿主的 getSectionOrder 就是
      // SECTION_ORDERS 纯查表——未知键返回 undefined、绝不抛，替身同形，
      // 否则「旧宿主键缺席」这一代根本测不出来。
      ...(sectionOrders === undefined
        ? {}
        : { getSectionOrder: (name) => sectionOrders[name] }),
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
// 二期 2.5（D20）：snapshot.current 单条已由 currentRecords 全量数组取代。
// currentOf 取首条，仅供「至多一条在飞」的历史断言形态沿用；多条在飞的场景
// 必须直接断言 currentAll(...)（并行语义下首条不等于「那条唯一的」）。
export const currentOf = (pid) => snapOf(pid)?.currentRecords?.[0] ?? null
export const currentAll = (pid) => snapOf(pid)?.currentRecords ?? []

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

// ── 面板 RPC 通道替身（F1：lib 半改为 webServer 直注册后的唯一驱动入口）──────────
// 真实形态逐件对齐：connection 只暴露 requestRejection 公开面（并保留一枚会抛的
// rpc.handle，把 0.1.5-alpha.1 的宿主缺陷原样搬进替身——谁退回 rpc.handle 谁当场
// 红），webServer.register 收 prefix route，驱动侧走 node:http 的 req/res。于是
// 鉴权直出、信封封装、endpoint 解析全部在替身里真跑一遍，用例拿到的 result 与
// 浏览器 connection.rpc.call 解析后的东西同形。

const fakeRequest = ({ method = 'POST', url, headers = {}, body = '', streamError }) => ({
  method,
  url,
  headers: { 'content-type': 'application/json', ...headers },
  destroyed: false,
  destroy() { this.destroyed = true },
  [Symbol.asyncIterator]: async function* () {
    if (body !== '') yield Buffer.from(body)
    // 客户端中途断开：node:http 的请求流在迭代中抛穿（AbortError / ECONNRESET）
    if (streamError) throw streamError
  },
})

const fakeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  ended: false,
  writeHead(status, headers) {
    this.statusCode = status
    if (headers) Object.assign(this.headers, headers)
  },
  end(chunk) {
    this.body = chunk === undefined ? '' : String(chunk)
    this.ended = true
  },
})

/**
 * 直接驱动一枚 node:http route handler：造 req（异步可迭代 + destroy）与 res（记录
 * 状态/头/正文），回 HTTP 现场 + 解出的信封。通道壳自身的抛穿支路也走这里，不必
 * 先注册一条路由。
 */
export async function callWebRouteHandler(handler, spec = {}) {
  const req = fakeRequest({
    method: spec.httpMethod ?? 'POST',
    url: spec.url ?? '/',
    headers: spec.headers ?? {},
    body: spec.body ?? '',
    streamError: spec.streamError,
  })
  const res = fakeResponse()
  await handler(req, res)
  let frame
  try {
    frame = JSON.parse(res.body)
  } catch { /* 非 JSON 响应（404/415/400 一类纯文本）本就没有信封 */ }
  return { status: res.statusCode, headers: res.headers, body: res.body, req, frame, result: frame?.result }
}

export function createPanelRpcTransport({ rejection, channel = '/dsh-my-go' } = {}) {
  const routes = new Map()
  const webServer = {
    register: (route) => {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`duplicate webServer route: ${key}`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
  }
  const connection = {
    requestRejection: () => rejection,
    rpc: {
      handle: () => { throw new Error('cannot get property "webServer" without inject') },
      call: () => { throw new Error('connection.rpc is a host-side registry, not a caller') },
    },
  }
  // 子 fiber 替身：0.1.7 起宿主半经 ctx.inject(['settings'], child => ...) 关自动页，
  // 故 child 必须带 settings 服务（configure 返回清理函数，effect 收下它）。
  const childCtx = {
    settings: createSettingsStub(),
    effect: (fn) => fn(),
  }
  const inject = (_deps, cb) => cb(childCtx)
  /** 低层驱动：自定义 method / url / headers / 原始 body，回 HTTP 现场 + 解出的信封。 */
  const request = async (spec = {}) => {
    const ch = spec.channel ?? channel
    const route = routes.get(`prefix ${ch}`)
    if (!route) throw new Error(`no webServer route registered for prefix ${ch}`)
    const body = spec.body !== undefined
      ? (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body))
      : JSON.stringify({
        type: 'client-request',
        rpcId: spec.rpcId ?? 'rpc-test',
        method: spec.method ?? spec.endpoint,
        payload: spec.payload,
      })
    return callWebRouteHandler(route.handler, {
      httpMethod: spec.httpMethod,
      url: spec.url ?? `${ch}/${spec.endpoint}`,
      headers: spec.headers,
      body,
    })
  }
  /** 高层驱动：等价浏览器 rpc.call(channel, endpoint, payload)，回 result 信封。 */
  const rpc = async (ch, endpoint, payload) => (await request({ channel: ch, endpoint, payload })).result
  return { connection, webServer, routes, inject, request, rpc }
}

