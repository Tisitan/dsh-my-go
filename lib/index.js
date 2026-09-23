/**
 * dsh-my-go — Sisyphus agent orchestration (HOST half, npm bundle).
 *
 * The host plugin of the `dsh-my-go` npm package. Registered through the
 * package's own `cordis.patch.yml` (dsh.bundle.patch), so `dsh plugin add
 * dsh-my-go` activates it automatically as a profile layer.
 *
 * 0.3.0-tisitan.0 起本半只做存储/面板 RPC 面，编排实现唯一归属 preset 半
 * （preset/tools/broker.mjs，0.1.7 起经 preset/agent.patch.yml 的声明行挂载）。
 * 本半提供：
 *   - settings 配置面：顶层 `Config` 声明（lib/config.js）——roles / sisyphus /
 *     usagePrices / usageCurrency 四个 volatile 顶层字段，宿主据此生成官方插件页
 *     表单、把行 config 挂成 composition base，并热更 volatile 字段
 *   - roles dict 迁移与合并（broker 半经全局桥只读本半解析出的段）
 *   - 面板 RPC 端点：snapshot / listTools / getBuiltinPersona / getUsage
 *     （0.5.0-tisitan.3 起 loadSettings / saveSettings / listModels 退役：设置面
 *     走宿主 configForms，模型目录走 remote.session.modelCatalog）；snapshot 经 Symbol.for
 *     快照桥读 broker 实况，桥不存在 = preset 未装配（lib-only 降级形态），
 *     回落空态 + 花名册常驻
 *
 * 0.1.7 起 preset/ 不再整拷到 $DSH_HOME/.agent-presets（该目录已无任何代码读取，
 * 见 preset/agent.patch.yml 头注），安装同步机制整体退役——包内 preset/ 与
 * prompts/ 就地生效。
 *
 * 编排工具（go_work/continue/need_help/forward/orchestration_status/
 * list_subagents）、编排台账、备选链重派与生命周期钩子全部归属 broker 半；
 * preset 未装配时这些工具不存在、面板降级空态——本半零编排面。
 */

export const name = 'dsh-my-go'

// 0.1.7 契约：配置面由顶层 `Config` 声明（lib/config.js），宿主据此生成官方插件页
// 表单并热更 volatile 字段。settings 服务因此**不必**入 inject——配置段由宿主经
// `apply(ctx, config)` 交进来，`config.<field>.get()` 现读。本半只在需要 settings
// 服务的两个动作（关自动页、legacy roles 迁移落盘）上走子 fiber 的 inject。
// 行 config 的 settings 形状部分由宿主自动挂成 composition base，本半不再自算。
export { Config } from './config.js'

// inject 面随 0.3.0-tisitan.0 半截肢收敛，0.5.0-tisitan.3 再削一刀，0.1.7 三削：
// RPC 端点读 tools（listTools）；settings 随配置面改声明式而摘除（见上）；llm 曾
// 只服务 listModels，端点退役后一并摘掉（模型目录改走浏览器侧
// remote.session.modelCatalog）；编排面服务（subagents/agents/sessions/
// systemPrompt）随编排实现整体迁往 preset 半 broker.mjs，本半不再声明依赖。
export const inject = ['tools']

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── shared 源（0.2.3-tisitan.15）：与 broker 半共用的纯函数单一源 ────────────────
// lib 以包内路径 import（../preset/shared/），broker 以 preset 内相对路径
// import（../shared/）——两种路径都落在同一个已安装包内（0.1.7 起不再有安装拷贝，
// 两种拼法指向同一批文件）。
// 0.3.0-tisitan.0 起本半只引入存储/面板面依赖的符号：名册键集（renderRosterLines
// 消费）、settings 迁移/合并、内置工种清单与键名 pattern；编排面符号
// （Orchestration/failure/archive/备选链合并等）一律不引入。
import { AGENT_TYPES, PRICE_KEY_PATTERN, ROLE_KEY_PATTERN, RUN_CODE_TOOL, SETTINGS_NAMESPACE, PANEL_RPC_CHANNEL, PANEL_ENDPOINTS } from '../preset/shared/constants.mjs'
import { migrateLegacyRolesOps, mergeRoleBindings, rosterKeys as sharedRosterKeys, rosterEntries, formatRosterRow } from '../preset/shared/roles.mjs'
import { defaultBindings } from '../preset/shared/misc.mjs'
import { createUsageAggregator } from './usage-aggregator.mjs'

// 保持 lib 存储面导出面（roster-roles 等测试与外部消费者经由 lib 入口引用
// 共享实现）。编排面符号（Orchestration / failure / archive / misc 养护函数）
// 的 re-export 已随 0.3.0-tisitan.0 切除——消费方直引 preset/shared/。
export { PRICE_KEY_PATTERN, ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'
export { migrateLegacyRolesOps, mergeRoleBindings } from '../preset/shared/roles.mjs'

// ── 面板快照裁剪（0.3.0-tisitan.8 E5/A-02）──────────────────────────────────────
// 600ms 轮询把整棵编排状态搬过一遍线：history 每桶最多 200 条（HISTORY_CAP），
// 而面板历史区只渲染全局末 8 条；每条记录里最贵的字段是 `prompt`（派发全文 /
// 驳回全文都挂在它上面），面板一个字节都不消费。本函数在 RPC 出口做无损可见
// 性的瘦身：
//   · history → 每桶末 8 条（各桶末 8 的并集恒 ⊇ 全局末 8，可见内容不变）
//   · prompt → 从 current / queue / history 条目剔除（helpRequests 的 content
//     是面板要显示的求助正文，原样保留）
const PANEL_HISTORY_TAIL = 8

function stripPrompt(row) {
  if (row === null || typeof row !== 'object' || !('prompt' in row)) return row
  const { prompt: _prompt, ...rest } = row
  return rest
}

// 链行的面板投影（三期 3.5）：chains 桶透传，但每跳的 prompt（主编预写指令
// 全文 / 闸门现场指令）与 stripPrompt 同纪律剥除——面板只消费状态面（id/state/
// cursor/挂起原因/工种/gate），一个字节的 prompt 都不过线。
function stripChainPrompts(chain) {
  if (chain === null || typeof chain !== 'object' || !Array.isArray(chain.hops)) return chain
  return { ...chain, hops: chain.hops.map((h) => (h && typeof h === 'object' ? { agent: h.agent, gate: h.gate } : h)) }
}

export function trimSnapshotForPanel(snapshot) {
  const parents = snapshot?.parents
  if (parents === null || typeof parents !== 'object') return snapshot
  const trimmed = {}
  for (const [pid, bucket] of Object.entries(parents)) {
    if (bucket === null || typeof bucket !== 'object') {
      trimmed[pid] = bucket
      continue
    }
    trimmed[pid] = {
      ...bucket,
      // 二期 2.5（D20）：current 单条 → currentRecords 全量数组（并行在飞列表）
      currentRecords: Array.isArray(bucket.currentRecords) ? bucket.currentRecords.map(stripPrompt) : bucket.currentRecords,
      queue: Array.isArray(bucket.queue) ? bucket.queue.map(stripPrompt) : bucket.queue,
      history: Array.isArray(bucket.history) ? bucket.history.slice(-PANEL_HISTORY_TAIL).map(stripPrompt) : bucket.history,
      // 三期 3.5（D13 可观测兜底的面板半）：suspended 链行原样可见，prompt 剥除
      chains: Array.isArray(bucket.chains) ? bucket.chains.map(stripChainPrompts) : bucket.chains,
    }
  }
  return { ...snapshot, parents: trimmed }
}

// ── 面板 RPC 通道壳（F1）：webServer 直注册 + 手工信封 ────────────────────────────
// 0.1.5-alpha.1 的 connection.rpc.handle 注册时读 owner.webServer，而 owner 被钉死在
// client-connection 自己的 apply fiber（该 fiber 只 inject 了 credentials），cordis 的
// inject 门禁当场拒读 → /dsh-my-go 通道从未注册，Web 面板全量 RPC 吃 405。宿主缺陷不
// 在本半修，这里照宿主自身 /api 的写法直接 webServer.register(prefix route)，并把
// rpc.handle 原本代做的两件事在 handler 内补回：
//   ① 鉴权直出：connection.requestRejection(req)（未认证先 401/403，绝不进业务分发）
//   ② 信封封装：请求 {type:'client-request', rpcId, method, payload} /
//      响应 {type:'server-response', rpcId, result}，与 client-connection 的
//      clientRequestSchema / fullResponse 逐字段同形，浏览器侧 connection.rpc.call
//      的解析（rpcId 回显 + result 形状）零改动。
const PANEL_CHANNEL = PANEL_RPC_CHANNEL
const PANEL_ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/
const PANEL_MAX_BODY_BYTES = 32 * 1024 * 1024
const PANEL_INVALID_RPC_ID = 'invalid-request'

// endpoint = pathname 去掉 `/dsh-my-go/` 前缀后的剩余段（含点号段在内的一切非法
// 形态一律 undefined，交给外层 404）——判定表与宿主 endpointFromPath 同构。
function panelEndpointFromPath(channel, rawUrl) {
  let pathname
  try {
    pathname = new URL(rawUrl ?? '/', 'http://dsh.internal').pathname
  } catch {
    return undefined
  }
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'
    || !PANEL_ENDPOINT_SEGMENT_PATTERN.test(segment))) return undefined
  return endpoint
}

function panelContentType(req) {
  const value = req?.headers?.['content-type']
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
}

// 整体缓冲请求体，超上限返回 null（调用方据此出 413）。本通道只走面板小报文，
// 不需要宿主 /api 那套 300 MiB 附件额度；32 MiB 相对最坏的一次面板报文（整张
// 快照 + 花名册）仍是两个数量级的余量，纯防御而从不参与正常路径。
async function readPanelBody(req, maxBodyBytes) {
  const chunks = []
  let received = 0
  for await (const chunk of req) {
    received += chunk.length ?? 0
    if (received > maxBodyBytes) return null
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

// 请求信封校验（等价 clientRequestSchema.safeParse + method/endpoint 一致性检查）。
// 不 import 宿主的 schema：dsh-client-connection 是宿主的嵌套依赖，插件侧解析不到，
// 静态 import 会直接把本半挂载打死——字段形状在此本地声明，与宿主逐字对齐。
function parsePanelRequest(body, endpoint) {
  const rpcId = body !== null && typeof body === 'object' && typeof body.rpcId === 'string'
    ? body.rpcId
    : PANEL_INVALID_RPC_ID
  if (body === null || typeof body !== 'object' || body.type !== 'client-request'
    || typeof body.rpcId !== 'string' || typeof body.method !== 'string') {
    return { ok: false, rpcId, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: [] } } }
  }
  if (body.method !== endpoint) {
    return { ok: false, rpcId, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } }
  }
  return { ok: true, rpcId, payload: body.payload }
}

/**
 * Build the webServer route handler for one panel RPC channel.
 * @param options.connection - host Connection service (requestRejection provider).
 * @param options.dispatch - endpoint dispatcher returning an {ok,value}/{ok:false,error} envelope.
 * @param options.channel - URL prefix owning the channel.
 * @param options.maxBodyBytes - buffered request-body cap.
 * @returns node:http route handler owning the full response lifecycle.
 */
export function createPanelRpcHandler({ connection, dispatch, channel = PANEL_CHANNEL, maxBodyBytes = PANEL_MAX_BODY_BYTES }) {
  return async (req, res) => {
    let replied = false
    const respond = (status, body, headers) => {
      replied = true
      res.writeHead(status, headers)
      res.end(body)
    }
    const writeFrame = (rpcId, result) => {
      replied = true
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
    }
    try {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) return respond(rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
      const endpoint = panelEndpointFromPath(channel, req.url)
      if (req.method !== 'POST' || endpoint === undefined) return respond(404, 'not found')
      if (panelContentType(req) !== 'application/json') return respond(415, 'content type must be application/json')
      const declaredLength = Number(req?.headers?.['content-length'])
      if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
        respond(413, undefined, { connection: 'close' })
        req.destroy?.()
        return
      }
      const raw = await readPanelBody(req, maxBodyBytes)
      if (raw === null) {
        respond(413, undefined, { connection: 'close' })
        req.destroy?.()
        return
      }
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        return respond(400, 'body is not JSON')
      }
      const request = parsePanelRequest(body, endpoint)
      if (request.ok !== true) return writeFrame(request.rpcId, { ok: false, error: request.error })
      let result
      try {
        result = await dispatch(endpoint, request.payload)
      } catch (error) {
        // 分发体抛穿在这里收口成合法错误帧（宿主 rpcFetchHandler 回裸 500，面板只能
        // 显示「transport failure」）：状态码仍是 2xx + server-response，异常正文进
        // error.message，红字横幅拿得到原因而不是猜一次传输错。
        console.warn(`[dsh-my-go] panel endpoint ${endpoint} threw: ${String(error)}`)
        result = { ok: false, error: { code: 'gateway/internal', message: String(error), details: {} } }
      }
      return writeFrame(request.rpcId, result)
    } catch (error) {
      // 外层兜底：客户端中途断开会让请求体的异步迭代抛穿（AbortError/ECONNRESET），
      // 路由 handler 的 promise 一旦逃逸就是宿主进程里的 unhandledRejection。已出过
      // 响应的连接无从追加，只能静默弃；未响应的补一发 400。
      console.warn(`[dsh-my-go] panel channel request aborted: ${String(error)}`)
      if (!replied) respond(400, 'bad request')
    }
  }
}

// 本包安装根（lib/ 的上一级）：包内 prompts/ 的父目录。
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export async function apply(ctx, config = {}) {
  // 合并基线：默认值 + 插件 config。settings 覆盖永远从基线起算，
  // 这样 WebUI 取消某字段后能正确回落默认，而不是残留旧的已合并值。
  const baseBindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  let bindings = { ...baseBindings }

  // ── 段位 1 · 配置面（0.1.7 契约：顶层 Config 的 volatile 字段现读现用）────────
  // 宿主把行 config 里 schema 认得的那层挂成 composition base、用户层覆盖其上，
  // config.<field>.get() 拿到的就是已解析的段（defaults → base → 用户层）。
  // 自动页关掉：本插件的编辑面在官方插件页的 plugins.bundle.config 卡里，两页并存
  // 会给出两份编辑器。
  //
  // settings 不进 inject（配置面改声明式后 apply 不该被 settings 缺席挡下）；真要用
  // settings 服务的两个动作（关自动页 / legacy roles 迁移落盘）走子 fiber 的 inject，
  // 在 `child.settings` 必然在席的作用域里做。
  const sectionOf = () => {
    const section = {
      sisyphus: config.sisyphus?.get(),
      roles: config.roles?.get(),
      usagePrices: config.usagePrices?.get(),
      usageCurrency: config.usageCurrency?.get(),
    }
    // 旧形态存储（0.2.3-tisitan.13 及之前的顶级八工种键）**不在 schema 里**，因此
    // 不经访问器、以原始值留在行 config 上（schemastery 未知键透传）。迁移读面必须
    // 看见它们，否则老用户的绑定永远搬不进 roles dict——「schema 不声明」是刻意的
    // （它们不该出现在设置页），「读面仍可见」是迁移的必要条件，两件事不冲突。
    for (const key of AGENT_TYPES) {
      if (config?.[key] !== undefined) section[key] = config[key]
    }
    return section
  }
  const refreshBindings = () => {
    let value
    try {
      value = sectionOf()
    } catch (error) {
      console.error(`[dsh-my-go] settings readout failed, defaults apply: ${String(error)}`)
      return undefined
    }
    try {
      bindings = mergeRoleBindings(baseBindings, value)
    } catch (error) {
      console.error(`[dsh-my-go] bindings refresh failed, previous bindings kept: ${String(error)}`)
    }
    return value
  }

  // ── 跨平面配置桥（与 broker 半的 Symbol.for('dsh-my-go.snapshot') 同款）────────
  // broker 是 preset 面独立插件，没有自己的可配置条目（0.1.7 的 settings 只服务
  // profile 条目），它经这枚只读访问器拿本半解析出的段。交出的是**段**而不是合并后
  // 的 bindings：broker 侧的 mergeRoleBindings(base, stored) 只认 { sisyphus, roles }
  // 这个形状，喂合并结果会让 stored.roles 缺席 —— 每个工种的 provider/model 静默
  // 回落 defaultBindings()（= 空），编排模型绑定整体失效。访问器逐调用现读 config
  // 访问器，宿主的热更在桥的另一侧自动成立，broker 无需订阅任何事件。
  //
  // 段版本号是桥的第二半：broker 的能力缓存（modelCache / effortCache / epoch 三连）
  // 旧写法挂在 settings/updated 上，而 0.1.7 的 loader/volatile-update 只在**本半
  // 自己的** fiber 上发，broker 订阅不到。版本号在每次 volatile 提交时自增（与内容
  // 是否变化无关——旧 settings/updated 就是「每次保存都失效一次」，这条语义逐字保住），
  // broker 逐调用比对版本号即等价于旧事件驱动，且仍无需订阅任何通道。
  let sectionRevision = 0
  globalThis[Symbol.for('dsh-my-go.bindings')] = () => sectionOf()
  globalThis[Symbol.for('dsh-my-go.bindings-revision')] = () => sectionRevision

  const migrateLegacyRoles = async (settings, stored) => {
    if (settings === undefined || typeof settings.mutate !== 'function') return
    try {
      const ops = migrateLegacyRolesOps(stored)
      if (!ops) return
      await settings.mutate(SETTINGS_NAMESPACE, ops)
      console.log(`[dsh-my-go] migrated legacy top-level role keys into roles dict: ${ops.filter((op) => op.op === 'set').map((op) => op.path[1]).join(', ')}`)
    } catch (error) {
      console.warn(`[dsh-my-go] legacy roles migration failed; stored settings kept untouched: ${String(error)}`)
    }
  }
  // 热更监听先挂上：初始读盘/迁移失败不该让「WebUI 改完不生效」成为二次故障。
  // 0.1.7 只在**本插件自己的** volatile 字段变更时触发该事件（仅 volatile-only
  // 变更，不重挂插件），载荷是变更路径表，故不再需要命名空间过滤。
  ctx.on('loader/volatile-update', () => {
    sectionRevision += 1
    const next = refreshBindings()
    if (next !== undefined) void migrateLegacyRoles(ctx.get('settings'), next)
  })
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    // 初次读盘也走 refreshBindings：读面失败由它写成同一行 settings readout failed
    // 留痕（访问器抛错不炸装配），读到 undefined 时迁移自然跳过。
    const stored = refreshBindings()
    if (stored !== undefined) void migrateLegacyRoles(child.settings, stored)
  })

  // ── 名册渲染辅助（RPC snapshot 的 roster / rosterLines 数据源）───────────
  // 语义源唯一：shared/roles.mjs 的 rosterEntries（0.3.0-tisitan.9 A-05 收口）。本半
  // 只负责注入自己的可变 bindings 并选投影方式——结构化投影直接进 snapshot，
  // 文本投影只作 deprecated 兼容字段保留。旧写法在此另抄一份摘要逻辑，与 broker
  // 半、与 shared 简报三式并行，「同源同格式」名不副实。
  const rosterKeys = () => sharedRosterKeys(bindings)

  // 结构化花名册（面板消费）：[{ role, builtin, modelText, chain, toolFilterText,
  // personaSource, ... }]，表头/计数由客户端自持
  const renderRosterEntries = () => rosterEntries(bindings)

  // deprecated 文本镜像（保留一个兼容期：外部取证脚本与旧 dist 包仍读它）
  function renderRosterLines() {
    return ['── 角色名册（roster） ──', ...renderRosterEntries().map(formatRosterRow)]
  }

  // ── usage aggregation engine (contract step 4/7, docs/usage-stats-design.md) ──
  // Services resolve lazily at call time, not at apply time: the live store
  // and the subagents runtime mount in scopes this half only sees best-effort
  // (feature-detected inside the aggregator), so absence = archive/ledger
  // paths only — the lib-only degraded form must aggregate just the same.
  // getUsagePrices re-reads the config accessor on every response assembly (R6):
  // prices never touch the aggregator's cache, so a price edit cannot invalidate it.
  // getUsageCurrency rides the same call (D1a) for the response's currency echo.
  const usageAggregator = createUsageAggregator({
    getSessions: () => ctx.get('sessions'),
    getSubagents: () => ctx.get('subagents'),
    getUsagePrices: () => sectionOf().usagePrices,
    getUsageCurrency: () => sectionOf().usageCurrency,
  })

  // ── client bridge：面板 RPC 单通道（webServer 直注册，壳见上方 F1 注释）────────
  // 单通道 + 端点分发（与 dsh-mnemon 同款）：
  //   channel = PANEL_RPC_CHANNEL，endpoints = PANEL_ENDPOINTS 四枚
  //   （snapshot / listTools / getBuiltinPersona / getUsage，shared/constants 单源）
  // connection / webServer 两者都只经 ctx.get 取用（属性访问会撞 cordis 的 inject
  // 门禁，正是宿主那次塌方的位置；get 是门禁外的直读）。inject 声明仍列两者：它是
  // 「两个服务都挂齐了再动手」的点火条件。headless/CLI profile 没有 webServer，
  // 纤维根本不点火；万一在这个 scope 里读不到服务（隔离/降级形态），留痕后跳过注册
  // ——本半存储/安装面与此无关，照常挂载。
  ctx.inject(['connection', 'webServer'], (webContext) => {
    const connection = ctx.get('connection')
    const webServer = ctx.get('webServer')
    if (connection === undefined) return
    if (webServer === undefined || typeof webServer.register !== 'function') {
      console.warn(`[dsh-my-go] webServer service unavailable, ${PANEL_CHANNEL} panel channel not registered`)
      return
    }
    if (typeof connection.requestRejection !== 'function') {
      console.warn(`[dsh-my-go] connection.requestRejection unavailable, ${PANEL_CHANNEL} panel channel not registered`)
      return
    }

    const dispatchPanelEndpoint = async (endpoint, payload) => {
      if (endpoint === PANEL_ENDPOINTS.snapshot) {
        // 编排快照唯一来源：agent 平面 broker 经 Symbol.for 全局桥发布的实时
        // 快照。0.3.0-tisitan.0 起本半不再维护编排状态机——桥不存在 = preset 未
        // 装配（lib-only 降级形态），回落降级空态 { seq: 0, parents: {} }。
        // 两侧形状必须一致：{ seq, parents: { [parentSessionId]: { ... } } }。
        // 端点自带 try（0.3.0-tisitan.8 E10/B-03）：桥函数抛错（broker 侧状态被写坏、
        // 面板轮询撞进 apply 半途）旧写法直接把异常抛穿 RPC 框架，Web 侧拿到
        // 的是一个没有信封的传输错——现在回结构化 internal，面板据此区分
        // 「桥未注册」与「桥在但读挂了」两种提示。
        try {
          const shared = globalThis[Symbol.for('dsh-my-go.snapshot')]
          const value = typeof shared === 'function' ? shared() : null
          // 花名册常驻（0.2.3-tisitan.15）：与编排状态无关，preset 未装配也产出。
          // 0.3.0-tisitan.9 A-05 起主字段是**结构化** roster（单一源 rosterEntries），
          // 表头/计数由面板自持；rosterLines 是同数据的文本镜像，已 deprecated
          // （兼容期保留：旧 dist 包与取证脚本仍按行读，行首表头的位置约定不再
          // 是任何渲染逻辑的前提）。
          return {
            ok: true,
            value: {
              ...trimSnapshotForPanel(value ?? { seq: 0, parents: {} }),
              roster: renderRosterEntries(),
              rosterLines: renderRosterLines(),
            },
          }
        } catch (error) {
          console.warn(`[dsh-my-go] snapshot bridge read failed: ${String(error)}`)
          return { ok: false, error: { code: 'internal', message: String(error), details: {} } }
        }
      }
      // 工具花名册（0.2.3-tisitan.13）：供配置卡角色 toolFilter 编辑器的
      // datalist 使用。tools.schemas() 无参 = 全局层视图（MCP 已连上的工具、DSH
      // 内建工具、preset 半编排工具）。保留名 RUN_CODE_TOOL（'run_code'，Code
      // Mode 保留传输）不在过滤层注册，从名单剔除。花名册是快照：MCP 动态连接
      // 后需按面板上的「刷新花名册」重拉。服务缺席/异常回落空名单——角色编辑器 datalist 为空
      // 但手填不受影响。
      if (endpoint === PANEL_ENDPOINTS.listTools) {
        try {
          const toolsService = ctx.get('tools')
          const schemas = typeof toolsService?.schemas === 'function' ? toolsService.schemas() : []
          const names = schemas
            .map((schema) => schema?.name)
            .filter((name) => typeof name === 'string' && name !== '' && name !== RUN_CODE_TOOL)
          return { ok: true, value: [...new Set(names)].sort() }
        } catch (e) {
          console.warn(`[dsh-my-go] listTools failed, returning empty roster: ${String(e)}`)
          return { ok: true, value: [] }
        }
      }
      // 内置人设原文（0.2.3-tisitan.16b）：配置卡内置角色「载入文件默认」按钮的数据
      // 源。直读磁盘不走缓存——启动期缺档不能挡住后续同步落盘的文件。type 过
      // ROLE_KEY_PATTERN 防目录穿越；非法 type/文件缺失结构化空返回，绝不抛穿 RPC。
      if (endpoint === PANEL_ENDPOINTS.getBuiltinPersona) {
        const type = typeof payload?.type === 'string' ? payload.type : ''
        if (!ROLE_KEY_PATTERN.test(type)) {
          return { ok: false, error: { code: 'bad-request', message: `invalid agent type: ${JSON.stringify(payload?.type ?? null)}`, details: {} } }
        }
        // 单一来源：包内 prompts/（0.1.7 起 preset 不再整拷到 .agent-presets，
        // 安装副本这条候选随之退役）。
        try {
          const persona = await readFile(join(PACKAGE_ROOT, 'prompts', `${type}.md`), 'utf-8')
          return { ok: true, value: { type, persona } }
        } catch {
          return { ok: false, error: { code: 'not-found', message: `prompts/${type}.md 不存在（包内人设缺失）`, details: {} } }
        }
      }
      // Usage panel data (contract D3): { parentSessionId } in, full
      // UsageReport out — children/byModel/totals from one response (D4).
      // Any internal failure comes back as a structured envelope (Z17), the
      // panel keeps polling; bad input degrades to found:false, never throws.
      if (endpoint === PANEL_ENDPOINTS.getUsage) {
        try {
          const value = await usageAggregator.getUsage(payload?.parentSessionId)
          return { ok: true, value }
        } catch (error) {
          console.warn(`[dsh-my-go] getUsage failed: ${String(error)}`)
          return { ok: false, error: { code: 'internal', message: String(error), details: {} } }
        }
      }
      return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} } }
    }

    const route = {
      kind: 'prefix',
      path: PANEL_CHANNEL,
      handler: createPanelRpcHandler({ connection, dispatch: dispatchPanelEndpoint }),
    }
    webContext.effect(() => webServer.register(route), `dsh-my-go: ${PANEL_CHANNEL} rpc channel`)
  })
}
