/**
 * dsh-my-go — Sisyphus agent orchestration (HOST half, npm bundle).
 *
 * The host plugin of the `dsh-my-go` npm package. Registered through the
 * package's own `cordis.patch.yml` (dsh.bundle.patch), so `dsh plugin add
 * dsh-my-go` activates it automatically as a profile layer.
 *
 * 0.3.0-tisitan.0 起本半只做存储/安装/面板 RPC 面，编排实现唯一归属 preset 半
 * （preset/tools/broker.mjs）。本半提供：
 *   - preset/ + prompts/ 的一次性安装同步（ensurePresetInstalled）
 *   - settings 命名空间 `dsh-my-go` 注册、roles dict 迁移与合并（broker 半
 *     对本命名空间只读，不重复注册）
 *   - 面板 RPC 端点：snapshot / listTools / getBuiltinPersona / getUsage
 *     （0.5.0-tisitan.3 起 loadSettings / saveSettings / listModels 退役：设置面
 *     走宿主 settingsScope，模型目录走 remote.session.modelCatalog）；snapshot 经 Symbol.for
 *     快照桥读 broker 实况，桥不存在 = preset 未装配（lib-only 降级形态），
 *     回落空态 + 花名册常驻
 *
 * 编排工具（go_work/continue/need_help/forward/orchestration_status/
 * list_subagents）、编排台账、备选链重派与生命周期钩子全部归属 broker 半；
 * preset 未装配时这些工具不存在、面板降级空态——本半零编排面。
 */

export const name = 'dsh-my-go'

/**
 * Composition base for the 'dsh-my-go' settings namespace: the settings-shaped
 * part of the cordis row config. `installPreset` and `bindings` are
 * orchestration-plane knobs and never enter the namespace, so a settings-page
 * reset returns to whatever the patch row declared (usually nothing → schema
 * defaults) instead of wiping it.
 * @param config - the plugin's cordis row config.
 * @returns a partial settings section.
 */
export function compositionBase(config = {}) {
  const picked = {}
  for (const key of ['sisyphus', 'roles', 'usagePrices', 'usageCurrency']) {
    if (config?.[key] !== undefined) picked[key] = config[key]
  }
  return picked
}

// inject 面随 0.3.0-tisitan.0 半截肢收敛，0.5.0-tisitan.3 再削一刀：RPC 端点读
// tools（listTools）、settings（存储面注册与读盘）。llm 曾只服务 listModels，
// 端点退役后一并摘掉（模型目录改走浏览器侧 remote.session.modelCatalog）；
// 编排面服务（subagents/agents/sessions/systemPrompt）随编排实现整体迁往
// preset 半 broker.mjs，本半不再声明依赖。
export const inject = ['tools', 'settings']

import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── shared 源（0.2.3-tisitan.15）：与 broker 半共用的纯函数单一源 ────────────────
// lib 以包内路径 import（../preset/shared/），broker 以 preset 内相对路径
// import（../shared/）——两种部署形态下路径均成立（preset/ 由
// ensurePresetInstalled 整拷，shared/ 随拷且安装后有存在性校验）。
// 0.3.0-tisitan.0 起本半只引入存储/面板面依赖的符号：名册键集（renderRosterLines
// 消费）、settings 迁移/合并、内置工种清单与键名 pattern；编排面符号
// （Orchestration/failure/archive/备选链合并等）一律不引入。
import { AGENT_TYPES, PRICE_KEY_PATTERN, ROLE_KEY_PATTERN, RUN_CODE_TOOL, SETTINGS_NAMESPACE, PANEL_RPC_CHANNEL, PANEL_ENDPOINTS } from '../preset/shared/constants.mjs'
import { dshHome as resolveDshHome } from '../preset/shared/paths.mjs'
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

// ── 一次性安装同步（见 ensurePresetInstalled）──────────────────────────────
// DSH_HOME/.agent-presets 这条路径原先在三处手抄（安装同步 / getBuiltinPersona
// / 注释），语义是「用户侧 preset 根」——抽成一枚函数，参数即注入点。
export function presetInstallRoot(dshHome = resolveDshHome()) {
  return join(dshHome, '.agent-presets')
}

// 本包安装根（lib/ 的上一级）：包内 preset/ 与 prompts/ 的父目录。
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// 装机哨兵清单（5.3 波 J-2）：broker.mjs 在 preset/tools/ 内的同目录相对 import
// 目标全集（本体 + metrics + 批次 5 各拆分波落位的 broker-*.mjs 簇模块）。
// ensurePresetInstalled 整拷后逐名核验在册（缺任一名 warn 留痕）；测试桩
// （host-lib-fixes fakePackage）从同一清单生成装机形态，哨兵与夹具永不漂移。
// 新增簇模块时必须同步登记——漏登记的后果正是本哨兵要防的形态：挂载期
// import 当场失败、安装器侧无痕迹。
export const BROKER_CLUSTER_ROSTER = [
  'broker.mjs',
  'metrics.mjs',
  'broker-ledger.mjs',
  'broker-notify.mjs',
  'broker-capability.mjs',
  'broker-dispose.mjs',
  'broker-endbuffer.mjs',
  'broker-delivery.mjs',
  'broker-relay.mjs',
  'broker-bootstrap.mjs',
  'broker-tools.mjs',
  'broker-scheduler.mjs',
  'broker-ending.mjs',
]

// 安装副本根：DSH_HOME/.agent-presets/dsh-my-go
function installedPresetRoot(dshHome) {
  return join(presetInstallRoot(dshHome), 'dsh-my-go')
}

// 递归收集一棵树下的普通文件（相对路径，'/' 分隔，排序稳定）。目录缺席
// 交由调用方 try/catch——摘要与同步对「没有这棵树」的处理方式不同。
async function collectTreeFiles(root, rel = '', out = []) {
  const entries = await readdir(join(root, rel), { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await collectTreeFiles(root, childRel, out)
    else if (entry.isFile()) out.push(childRel)
  }
  return out
}

/**
 * Content digest of everything the installer copies (preset/ + prompts/):
 * per file `路径\u0000字节数\u0000sha256 前 12 位`，按路径排序拼接后再取总 sha256
 * 前 16 位。只含「路径 + 内容」两要素 ⇒ 同一棵树在任何机器/任何时刻摘要
 * 相同（mtime/inode 一律不参与），而包内任何一次真实内容改动都会换摘要。
 */
async function presetTreeDigest(packageRoot) {
  const sum = createHash('sha256')
  for (const tree of ['preset', 'prompts']) {
    let files = []
    try {
      files = await collectTreeFiles(join(packageRoot, tree))
    } catch { /* 树缺席：该树贡献零条目 */ }
    for (const rel of files.sort()) {
      let content = null
      try {
        content = await readFile(join(packageRoot, tree, rel))
      } catch { /* 读不到：以哨兵计入，绝不静默跳过（跳过 = 漂移不可见） */ }
      const fileHash = content === null ? 'unreadable' : createHash('sha256').update(content).digest('hex').slice(0, 12)
      sum.update(`${tree}/${rel}\u0000${content === null ? -1 : content.length}\u0000${fileHash}\n`)
    }
  }
  return sum.digest('hex').slice(0, 16)
}

/**
 * Byte-for-byte mirror of `source` into `target`, skipping files whose current
 * content already matches (0.3.0-tisitan.8 B-09): the write window shrinks from the
 * whole tree to the files that actually changed, so a running preset half is
 * no longer truncated-and-rewritten on every same-content reload.
 */
async function syncTreeFilewise(source, target) {
  const files = await collectTreeFiles(source)
  for (const rel of files.sort()) {
    const content = await readFile(join(source, rel))
    const dest = join(target, rel)
    try {
      const installed = await readFile(dest)
      if (installed.equals(content)) continue // 字节相同：不打开写窗口
    } catch { /* 目标缺席 → 必写 */ }
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, content)
  }
}

/**
 * Install the bundled agent preset into the user preset root, so the
 * "MyGO!!!!! 模式" preset appears in the session picker after `dsh plugin
 * add dsh-my-go`. DSH discovers presets only from configured roots
 * (~/.dsh/.agent-presets/), never from node_modules, so the npm bundle must
 * copy its preset/ directory there.
 *
 * Idempotence has two doors (0.3.0-tisitan.8 E8/B-08): the marker file
 * `.dsh-my-go-version` holds `<version>+<contentDigest>` — same version *and*
 * same preset/prompts content means the installed copy already equals this
 * package, so the sync is skipped and manual tweaks of the installed copy
 * survive same-version reloads; any content drift (a hand-edited file *in the
 * package*, a partially failed earlier copy, a same-version hot patch) changes
 * the digest and re-syncs. Version alone could not tell those apart.
 *
 * Failure anywhere is logged and swallowed — the host plugin must keep working
 * even when the preset copy is not possible.
 *
 * `packageRoot` / `dshHome` are injectable (0.3.0-tisitan.8 E3/B-01) so tests drive
 * the real sync against temp directories instead of racing the background copy
 * from `apply()`.
 */
export async function ensurePresetInstalled(options = {}) {
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT
  const dshHome = options.dshHome ?? resolveDshHome()
  try {
    const userPresetRoot = presetInstallRoot(dshHome)
    const target = installedPresetRoot(dshHome)
    const markerPath = join(target, '.dsh-my-go-version')
    let version = '0.0.0'
    try {
      const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf-8'))
      version = String(pkg.version ?? version)
    } catch { /* fall through with default */ }
    const digest = await presetTreeDigest(packageRoot)
    const marker = `${version}+${digest}`
    try {
      const installed = (await readFile(markerPath, 'utf-8')).trim()
      // 摘要一致才短路：内容漂移（包内手改、上次半拷）时 installed !== marker
      if (installed === marker) return
    } catch { /* no marker → first install or legacy copy: sync below */ }
    await mkdir(userPresetRoot, { recursive: true })
    // Sync preset/ directory (composition + tools + shared/)
    const presetSource = join(packageRoot, 'preset')
    await access(presetSource)
    // 逐文件内容比对（0.3.0-tisitan.8 B-09）：字节相同不重写。整拷 21 个文件等于
    // 把「正在被 mount 使用的 .mjs 原地截断重写」每天来一遍（Windows 上
    // EBUSY/半写风险面最大），现在写窗口只剩真正改过的文件。
    await syncTreeFilewise(presetSource, target)
    // shared/ 是两半共享源（0.2.3-tisitan.15）：broker.mjs 以相对路径 import 它，
    // 整拷后必须存在——校验缺失只 warn 不阻断（fail-observable），防未来
    // 「选择性拷贝」把 broker 的 import 静默断链。
    const sharedTarget = join(target, 'shared')
    try {
      await access(sharedTarget)
    } catch {
      console.warn(`[dsh-my-go] preset sync: shared/ missing at ${sharedTarget} — broker.mjs imports would fail; check preset/ copy completeness`)
    }
    // tools/ 侧关键件在册核验（5.3 波 J-2）：批次 5 拆分后 broker.mjs 的同目录
    // 相对 import 扇出到清单里的簇模块（broker-*.mjs + metrics.mjs）——漏拷/半拷
    // tools/ 时故障发生在会话组装期的挂载 import，当场炸且安装器侧零留痕。
    // 与 shared/ 同款 fail-observable 口径：逐名只 warn 不阻断（syncTreeFilewise
    // 本就逐文件写窗口，缺席多半伴随源侧问题，留痕点名缺哪个即可定位）。
    for (const file of BROKER_CLUSTER_ROSTER) {
      try {
        await access(join(target, 'tools', file))
      } catch {
        console.warn(`[dsh-my-go] preset sync: tools/${file} missing — broker.mjs imports would fail; check preset/ copy completeness`)
      }
    }
    // Sync prompts/ directory (persona markdown files). Resource mirror
    // semantics (0.3.0-tisitan.8 B-09): delete the target first so persona files
    // retired upstream do not linger in the install — a stale `foo.md` is a
    // roster card that keeps offering a persona nobody owns. The window where
    // the directory is gone is survivable by design: prompt reads are
    // fail-soft and never cached (broker 0.3.0-tisitan.7 N11).
    const promptsSource = join(packageRoot, 'prompts')
    const promptsTarget = join(target, 'prompts')
    try {
      await access(promptsSource)
      await rm(promptsTarget, { recursive: true, force: true })
      await syncTreeFilewise(promptsSource, promptsTarget)
    } catch { /* prompts/ optional — degrade gracefully */ }
    await writeFile(markerPath, marker, 'utf-8')
    console.log(`[dsh-my-go] preset synced to ${target} (v${version}+${digest})`)
  } catch (error) {
    console.error(`[dsh-my-go] could not sync preset: ${String(error)}`)
  }
}

export async function apply(ctx, config = {}) {
  // 一次性安装同步（marker 摘要短路，见 ensurePresetInstalled）。测试用
  // `installPreset: false` 真短路（0.3.0-tisitan.8 E3/B-01）：以前 lib 侧行为用例
  // 全靠「版本标记恰好已写」躲开这次后台拷贝，任何一次摘要变化都会让测试
  // 与安装器抢同一批文件——参数化 + 显式开关把它变成受控前提。
  if (config.installPreset !== false) void ensurePresetInstalled()
  // 合并基线：默认值 + 插件 config。settings 覆盖永远从基线起算，
  // 这样 WebUI 取消某字段后能正确回落默认，而不是残留旧的已合并值。
  const baseBindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  let bindings = { ...baseBindings }

  // ── settings-backed bindings (WebUI configurable) ───────────────────────
  // bindings 在本半的消费面只有 renderRosterLines（RPC snapshot 花名册区）；
  // 编排执行面消费（派发/waterfall/备选链）已全部归属 broker 半（0.3.0-tisitan.0）。
  const settings = ctx.get('settings')
  // 命名空间读面唯一入口：installSection 交出活源后指向它（provider 被摘时自动
  // 回落 composition base），注册没成功则退回 settings.get。它**会**照实抛出读盘
  // 异常——吞掉就等于把 E1/B-02 要求的那行留痕的因藏了；事件驱动路径走
  // refreshBindings，那里才吞。
  let sectionSource = () => settings?.get?.(SETTINGS_NAMESPACE)
  const refreshBindings = () => {
    let value
    try {
      value = sectionSource()
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

  // 并发写围栏交给宿主：浏览器半写 settingsScope 时带 describe 的 revision，
  // 本半不再自造版本号（0.5.0-tisitan.3 起 loadSettings/saveSettings 端点退役，
  // 本地计数器与 describe 探测随之删除——两处真相必然漂移）。

  if (settings !== undefined) {
    // 失败面隔离（0.3.0-tisitan.8 E1/B-02）：注册命名空间与「读盘 + 热更接线」分两
    // 个 try。旧写法一个 try 罩到底，schemastery 解析失败或 register 抛错会
    // 连带吞掉 ctx.on('settings/updated') ——热更监听根本没挂上，之后 WebUI
    // 改绑定全部无声失效，且 catch 体零日志、外面看不到任何原因。
    try {
      // Dynamic import so a loader without npm-package resolution for local
      // mjs files degrades to defaults instead of failing the preset mount.
      const mod = await import('@deepseek-ai/schemastery')
      const z = mod.default ?? mod
      const agentSchema = z.object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string(),
        dsv4p0813: z.boolean(),
        fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })),
      })
      const roleSchema = z.object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string(),
        dsv4p0813: z.boolean(),
        fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })),
        persona: z.string(),
        toolFilter: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }),
      })
      // usagePrices (contract D1, docs/usage-stats-design.md): per-model price
      // table, USD per 1M tokens. input/output are required; cache buckets
      // optional (absent = bucket unpriced). .min(0) rejects negatives —
      // schemastery has no isFinite guard, so NaN/Infinity are turned away at
      // save time (settings-core write path) instead, per D1. Empty dict =
      // tokens only, no cost.
      const priceSchema = z.object({
        input: z.number().min(0).required(),
        output: z.number().min(0).required(),
        cacheRead: z.number().min(0),
        cacheWrite: z.number().min(0),
      })
      const schema = z.object({
        sisyphus: agentSchema,
        roles: z.dict(roleSchema, z.string().pattern(ROLE_KEY_PATTERN)),
        usagePrices: z.dict(priceSchema, z.string().pattern(PRICE_KEY_PATTERN)),
        // Global currency for the price table (D1a): one knob, not per-row —
        // mixed-currency totals are meaningless. z.union members coerce
        // through Schema.const, so anything but 'USD'/'CNY' is rejected.
        usageCurrency: z.union(['USD', 'CNY']).default('USD'),
      })
      // 官方姿势（0.5.0-tisitan.3，与 dsh-web-search-deepseek / tool-guard 同款）：
      // installSection 把 cordis 行 config 的 settings 形状部分挂成 composition
      // base，并交出**活源**——宿主 settings provider 被摘时它回落到 base，本半
      // 读面不再依赖 settings.get 活着。老宿主不认识 installSection 才回落
      // register(ns, schema, {base})，分层语义一致。
      const base = compositionBase(config)
      if (typeof settings.installSection === 'function') {
        settings.installSection(ctx, SETTINGS_NAMESPACE, schema, base, {
          setSource: (get) => { sectionSource = get },
          onChange: () => { refreshBindings() },
        })
      } else {
        settings.register(SETTINGS_NAMESPACE, schema, { base })
      }
    } catch (error) {
      console.error(`[dsh-my-go] settings namespace registration failed: ${String(error)}`)
    }
    // 读盘/接线面不再需要 try/catch：唯一的抛出点（sectionSource）在
    // refreshBindings 里就地留痕并降级，迁移另有自己的 try——两处留痕各说各的因，
    // 不再叠第三层「readout failed」。
    const migrateLegacyRoles = async (stored) => {
      try {
        const ops = migrateLegacyRolesOps(stored)
        if (!ops) return
        await settings.mutate(SETTINGS_NAMESPACE, ops)
        console.log(`[dsh-my-go] migrated legacy top-level role keys into roles dict: ${ops.filter((op) => op.op === 'set').map((op) => op.path[1]).join(', ')}`)
      } catch (error) {
        console.warn(`[dsh-my-go] legacy roles migration failed; stored settings kept untouched: ${String(error)}`)
      }
    }
    // 热更监听先挂上：初始读盘/迁移失败不该让「WebUI 改完不生效」成为二次故障
    // （下一次 settings/updated 仍会把最新值并进来）。
    ctx.on('settings/updated', (ns) => {
      if (ns !== SETTINGS_NAMESPACE) return
      const next = refreshBindings()
      if (next !== undefined) void migrateLegacyRoles(next)
    })
    // 初次读盘也走 refreshBindings：读面失败由它写成与旧版同一行
    // settings readout failed 留痕（get 抛错不炸装配），读到 undefined 时迁移自然跳过。
    const stored = refreshBindings()
    if (stored !== undefined) await migrateLegacyRoles(stored)
  }
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
  // getUsagePrices re-reads settings on every response assembly (R6): prices
  // never touch the aggregator's cache, so a price edit cannot invalidate it.
  // getUsageCurrency rides the same call (D1a) for the response's currency echo.
  const usageAggregator = createUsageAggregator({
    getSessions: () => ctx.get('sessions'),
    getSubagents: () => ctx.get('subagents'),
    getUsagePrices: () => sectionSource()?.usagePrices,
    getUsageCurrency: () => sectionSource()?.usageCurrency,
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
        // 先读安装副本，缺席再回落包内原文（0.3.0-tisitan.8 B-10）：安装同步是 apply
        // 里的后台 fire-and-forget，冷启动早期副本还没落全——此前这里必报
        // not-found，用户看着「文件不存在」而包里那份人设明明就在。
        const candidates = [
          join(installedPresetRoot(), 'prompts', `${type}.md`),
          join(PACKAGE_ROOT, 'prompts', `${type}.md`),
        ]
        for (const [index, path] of candidates.entries()) {
          try {
            const persona = await readFile(path, 'utf-8')
            return { ok: true, value: { type, persona } }
          } catch {
            if (index + 1 === candidates.length) {
              return { ok: false, error: { code: 'not-found', message: `prompts/${type}.md 不存在（preset 未安装或未同步）`, details: {} } }
            }
          }
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
