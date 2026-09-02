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
 *   - 面板 RPC 端点全家：snapshot / listModels / listTools /
 *     getBuiltinPersona / loadSettings / saveSettings；snapshot 经 Symbol.for
 *     快照桥读 broker 实况，桥不存在 = preset 未装配（lib-only 降级形态），
 *     回落空态 + 花名册常驻
 *
 * 编排工具（go_work/continue/need_help/forward/orchestration_status/
 * list_subagents）、编排台账、备选链重派与生命周期钩子全部归属 broker 半；
 * preset 未装配时这些工具不存在、面板降级空态——本半零编排面。
 */

export const name = 'dsh-my-go'

// inject 面随 0.3.0-tisitan.0 半截肢收敛：RPC 端点读 tools（listTools）、llm
// （listModels）、settings（存储面注册与读写）。编排面服务（subagents/
// agents/sessions/systemPrompt）随编排实现整体迁往 preset 半 broker.mjs，
// 本半不再声明依赖。
export const inject = ['tools', 'llm', 'settings']

import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// ── shared 源（0.2.3-tisitan.15）：与 broker 半共用的纯函数单一源 ────────────────
// lib 以包内路径 import（../preset/shared/），broker 以 preset 内相对路径
// import（../shared/）——两种部署形态下路径均成立（preset/ 由
// ensurePresetInstalled 整拷，shared/ 随拷且安装后有存在性校验）。
// 0.3.0-tisitan.0 起本半只引入存储/面板面依赖的符号：名册键集（renderRosterLines
// 消费）、settings 迁移/合并、内置工种清单与键名 pattern；编排面符号
// （Orchestration/failure/archive/备选链合并等）一律不引入。
import { AGENT_TYPES, ROLE_KEY_PATTERN, RUN_CODE_TOOL } from '../preset/shared/constants.mjs'
import { migrateLegacyRolesOps, mergeRoleBindings, rosterKeys as sharedRosterKeys, rosterEntries, formatRosterRow } from '../preset/shared/roles.mjs'
import { defaultBindings } from '../preset/shared/misc.mjs'

// 保持 lib 存储面导出面（roster-roles 等测试与外部消费者经由 lib 入口引用
// 共享实现）。编排面符号（Orchestration / failure / archive / misc 养护函数）
// 的 re-export 已随 0.3.0-tisitan.0 切除——消费方直引 preset/shared/。
export { ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'
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
      current: stripPrompt(bucket.current),
      queue: Array.isArray(bucket.queue) ? bucket.queue.map(stripPrompt) : bucket.queue,
      history: Array.isArray(bucket.history) ? bucket.history.slice(-PANEL_HISTORY_TAIL).map(stripPrompt) : bucket.history,
    }
  }
  return { ...snapshot, parents: trimmed }
}

// ── 一次性安装同步（见 ensurePresetInstalled）──────────────────────────────
// DSH_HOME/.agent-presets 这条路径原先在三处手抄（安装同步 / getBuiltinPersona
// / 注释），语义是「用户侧 preset 根」——抽成一枚函数，参数即注入点。
export function presetInstallRoot(dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(dshHome, '.agent-presets')
}

// 本包安装根（lib/ 的上一级）：包内 preset/ 与 prompts/ 的父目录。
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

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
  const dshHome = options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
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

  // ── 存储面 revision（0.3.0-tisitan.9 E6/A-03 并发写围栏）───────────────────────
  // 语义：设置页「读到的那一刻」的命名空间版本号，保存时原样带回；host 侧版本号
  // 已经前进 = 他处改过 → 回结构化 conflict，绝不让旧快照盖掉新配置。
  // 真源优先取宿主 `settings.describe()` 的 descriptor.revision（dsh-settings
  // 契约：raw user section 一变即单调递增，外部手改 settings.yaml 也算）；宿主
  // 不暴露 describe（旧版本 / 测试替身）时回落本半进程内计数器——由
  // settings/updated 事件驱动，语义退化为「本进程观测到的变更数」，够用且
  // 不自相矛盾（同一 host 进程内的多页签并发照样被拦住）。
  let localRevision = 0
  function currentRevision() {
    if (typeof settings?.describe === 'function') {
      try {
        const listed = settings.describe({ redactSecrets: true })
        const found = Array.isArray(listed) ? listed.find((d) => d && d.ns === 'dsh-my-go') : null
        if (found && typeof found.revision === 'number') return found.revision
      } catch { /* describe 形态漂移：回落本地计数器 */ }
    }
    return localRevision
  }
  // 宿主 mutate 是否吃第三参 expectedRevision（本机替身与旧宿主是两参签名）；
  // 注意 TS 可选形参不计入 Function.length，故不能拿它探测 describe 那侧的能力
  const hostTakesExpectedRevision = () => typeof settings?.mutate === 'function' && settings.mutate.length >= 3
  function settingsConflict(error) {
    return error !== null && typeof error === 'object'
      && (error.code === 'SETTINGS_CONFLICT' || error.name === 'SettingsConflictError')
  }

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
      settings.register(
        'dsh-my-go',
        z.object({
          sisyphus: agentSchema,
          roles: z.dict(roleSchema, z.string().pattern(ROLE_KEY_PATTERN)),
          // 工具屏蔽（0.2.3-tisitan.13）：deny 为工具名数组；preset 半 tool-mask.mjs
          // 在会话组装时读取。空数组=不屏蔽（saveSettings 转 unset）。
          toolMask: z.object({ deny: z.array(z.string()) }),
        }),
        {},
      )
    } catch (error) {
      console.error(`[dsh-my-go] settings namespace registration failed: ${String(error)}`)
    }
    try {
      const migrateLegacyRoles = async (stored) => {
        try {
          const ops = migrateLegacyRolesOps(stored)
          if (!ops) return
          await settings.mutate('dsh-my-go', ops)
          console.log(`[dsh-my-go] migrated legacy top-level role keys into roles dict: ${ops.filter((op) => op.op === 'set').map((op) => op.path[1]).join(', ')}`)
        } catch (error) {
          console.warn(`[dsh-my-go] legacy roles migration failed; stored settings kept untouched: ${String(error)}`)
        }
      }
      // 热更监听先挂上：初始读盘/迁移抛错不该让「WebUI 改完不生效」成为二次
      // 故障（下一次 settings/updated 仍会把最新值并进来）。
      ctx.on('settings/updated', (ns) => {
        if (ns !== 'dsh-my-go') return
        // 每一次观测到的提交都推进回落计数器（宿主 describe 可用时以它为准）
        localRevision += 1
        const next = settings.get('dsh-my-go')
        bindings = mergeRoleBindings(baseBindings, next)
        void migrateLegacyRoles(next)
      })
      const stored = settings.get('dsh-my-go')
      bindings = mergeRoleBindings(baseBindings, stored)
      await migrateLegacyRoles(stored)
    } catch (error) {
      console.error(`[dsh-my-go] settings readout failed, defaults apply: ${String(error)}`)
    }
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

  // ── client bridge via connection.rpc (bundle plugins use connection.rpc,
  // NOT harness.handle, which is reserved for dynamic cordis plugins) ──────
  ctx.inject(['connection'], (webContext) => {
    if (webContext.connection === undefined) return
    const rpc = webContext.connection.rpc
    if (!rpc || typeof rpc.handle !== 'function') return

    // 单通道 + 端点分发（与 dsh-mnemon 同款）：
    //   channel = "/dsh-my-go"，endpoints = "snapshot" | "listModels" | "listTools"
    //   | "getBuiltinPersona" | "loadSettings" | "saveSettings"
    // handle 的形参个数按宿主版本漂移（本机 dsh-client-connection 是
    // (channel, handler) 两参；更新版要求第三参 options.authority），故按
    // Function.length 探测：≥3 才带 options。注意 .length 不含带默认值的形参
    // 与 rest 形参，探测偏保守——最坏情况退回旧的两参调用，不会给旧宿主塞
    // 多余参数。写成单调用点 + spread：本半「RPC 单通道」的反向 parity 计数
    // needle 不必因为适配新版本而漂移。
    const rpcHandleExtras = typeof rpc.handle === 'function' && rpc.handle.length >= 3
      ? [{ authority: 'loopback' }]
      : []
    rpc.handle('/dsh-my-go', async (endpoint, payload) => {
      if (endpoint === 'snapshot') {
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
      if (endpoint === 'listModels') {
        const llm = ctx.get('llm')
        if (!llm) return { ok: true, value: { providers: [], models: {}, errors: {} } }
        let providers = []
        try {
          // Use listProviders() — returns only ACTIVE/configured providers,
          // NOT listConfigurableProviders() which includes unconfigured ones
          const active = await llm.listProviders()
          providers = active.map((p) => p.id)
        } catch { /* llm not available */ }
        // 逐渠道**并行**列举 + 失败显式化（0.3.0-tisitan.9 A-06/B-06 顺带面）：旧写法
        // 串行 await 且 catch 后静默丢键——N 个渠道就是 N 倍首屏延迟，而前端拿到
        // 的「键缺席」与「该渠道确实没有模型」完全同形，只能在下拉里显示一个空
        // 清单让用户以为配错了。现在缺席一律进 errors，前端按渠道行内提示。
        const settled = await Promise.allSettled(providers.map((pid) => llm.listModels(pid)))
        const models = {}
        const errors = {}
        settled.forEach((result, index) => {
          const pid = providers[index]
          if (result.status === 'fulfilled') {
            models[pid] = (result.value ?? []).map((m) => m.id)
          } else {
            models[pid] = []
            errors[pid] = String(result.reason ?? 'unknown error')
          }
        })
        return { ok: true, value: { providers, models, errors } }
      }
      // 工具花名册（0.2.3-tisitan.13）：供设置页「工具屏蔽」双列表的「当前可用」
      // 列使用。tools.schemas() 无参 = 全局层视图（MCP 已连上的工具、DSH 内建
      // 工具、preset 半编排工具），恰是 tool-mask restrict 能 deny 的面。保留名
      // RUN_CODE_TOOL（'run_code'，Code Mode 保留传输）不在过滤层注册，从名单
      // 剔除。花名册是快照：MCP 动态连接后需重开设置页刷新。服务缺席/异常回落
      // 空名单——设置页降级为纯编辑器（已屏蔽条目带「未连接」徽章），不阻塞保存。
      if (endpoint === 'listTools') {
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
      // 内置人设原文（0.2.3-tisitan.16b）：设置页内置卡「载入文件默认」按钮的数据
      // 源。直读磁盘不走缓存——启动期缺档不能挡住后续同步落盘的文件。type 过
      // ROLE_KEY_PATTERN 防目录穿越；非法 type/文件缺失结构化空返回，绝不抛穿 RPC。
      if (endpoint === 'getBuiltinPersona') {
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
      if (endpoint === 'loadSettings') {
        const settingsService = ctx.get('settings')
        if (!settingsService) return { ok: true, value: {} }
        try {
          // 存储已迁移为 roles dict，设置页（尚未感知 roles）仍按顶级工种键
          // 渲染：此处把 roles 内置工种行提升回顶级形状（roles 优先于可能
          // 残留的旧顶级键），roles 原样附带，sisyphus/toolMask 本就在顶级。
          const stored = settingsService.get('dsh-my-go')
          const value = stored && typeof stored === 'object' ? stored : {}
          const roles = value.roles && typeof value.roles === 'object' ? value.roles : {}
          const promoted = {}
          for (const type of AGENT_TYPES) {
            if (roles[type] && typeof roles[type] === 'object') promoted[type] = roles[type]
          }
          // revision 随读面下发（0.3.0-tisitan.9 E6/A-03）：设置页把它当不透明凭据
          // 存着，保存时原样带回——它与 draft 里的任何键都不冲突（saveSettings
          // 的 ops 只消费 sisyphus / roles / toolMask 三处，多余顶级键无消费面）
          return { ok: true, value: { ...value, ...promoted, revision: currentRevision() } }
        } catch (e) {
          // 谎报成功改判（0.3.0-tisitan.8 E4/B-04）：读盘/取值抛错曾回 ok:true + 空
          // 对象，前端把「读失败」当「没配置」渲染成一张干净空表单——用户改完
          // 点保存，未读到的真配置就被空值洗掉。现在回 unavailable，前端既有
          // loadError 红字横幅当场亮出（表单不渲染），误写路径消失。
          return { ok: false, error: { code: 'unavailable', message: String(e), details: {} } }
        }
      }
      if (endpoint === 'saveSettings') {
        const draft = payload
        if (!draft || typeof draft !== 'object') return { ok: false, error: { code: 'bad-request', message: 'payload must be an object', details: {} } }
        const settingsService = ctx.get('settings')
        if (!settingsService) return { ok: false, error: { code: 'unavailable', message: 'settings service not available', details: {} } }
        // 并发写围栏（0.3.0-tisitan.9 E6/A-03）：draft 带的 revision 是设置页读到的
        // 那一刻的版本号。他处（另一页签 / 外部手改 settings.yaml）已经写过，
        // 就直接拒绝——旧写法是后写覆盖前写，用户毫不知情地把别人刚改的配置
        // 洗成自己的旧快照。缺 revision（旧前端 / 脚本直调）= 无条件写，保持
        // 向后兼容，不发明默认值。
        const expectedRevision = typeof draft.revision === 'number' && Number.isFinite(draft.revision) ? draft.revision : null
        if (expectedRevision !== null && expectedRevision !== currentRevision()) {
          const actual = currentRevision()
          return { ok: false, error: { code: 'conflict', message: `settings changed since load (expected r${expectedRevision}, now r${actual})`, details: { expected: expectedRevision, actual } } }
        }
        try {
          // sisyphus 恒为顶级键；工种角色统一写 roles dict。draft 兼容两种
          // 形状：前端旧形状（顶级工种键，loadSettings 提升后原样回传，用户
          // 编辑发生在顶级卡片上，故取值顶级优先）与 roles 形状。
          // 全字段统一「显式携带才写」（ 0.2.3-tisitan.15）：字段缺失=完全不触碰
          // （ 0.2.3-tisitan.14 只对 persona/toolFilter 这样，5 字段循环仍无条件
          // set/unset——persona 覆盖编辑会发只带 persona 的部分行，无条件
          // 循环会把该角色已配的 provider/model 等误清）。显式空值仍 = unset
          // （WebUI 把字段选回「跟随环境」的清除路径不变）。
          const fields = ['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'fallbacks']
          const draftRoles = draft.roles && typeof draft.roles === 'object' && !Array.isArray(draft.roles) ? draft.roles : {}
          // roles dict 键排除 sisyphus（棒2-L1）：sisyphus 恒为顶级键（与
          // migrateLegacyRolesOps「永不迁移」同口径），draft.roles.sisyphus 是
          // schema 拦不住的死数据——写面直接不落，存量的靠下方删除面自然清出。
          // 再叠一道 ROLE_KEY_PATTERN 过滤（0.3.0-tisitan.8 E7/B-05）：脏键（手改
          // settings.yaml / 旧前端塞进来的大写或路径串）过去只要出现在 draft
          // 里，就会生成一条 schema 必拒的 ops，而 mutate 是**整批原子**——
          // 一枚脏键毒杀整次保存，用户在 WebUI 上改什么都不再能落盘。脏键
          // 就地丢弃（fail-closed），其余行照常写。
          const roleKeys = [...new Set([...AGENT_TYPES, ...Object.keys(draftRoles).filter((k) => k !== 'sisyphus' && ROLE_KEY_PATTERN.test(k))])]
          const ops = []
          for (const field of fields) {
            if (!draft.sisyphus || typeof draft.sisyphus !== 'object' || !(field in draft.sisyphus)) continue
            const val = draft.sisyphus[field]
            if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
              ops.push({ op: 'unset', path: ['sisyphus', field] })
            } else {
              ops.push({ op: 'set', path: ['sisyphus', field], value: val })
            }
          }
          for (const type of roleKeys) {
            const src = draft[type] && typeof draft[type] === 'object' ? draft[type] : draftRoles[type]
            for (const field of fields) {
              if (!src || typeof src !== 'object' || !(field in src)) continue
              const val = src[field]
              if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
                ops.push({ op: 'unset', path: ['roles', type, field] })
              } else {
                ops.push({ op: 'set', path: ['roles', type, field], value: val })
              }
            }
            // persona/toolFilter 只认 roles 形状的行：顶级形状（旧前端）永无
            // 这两个键的消费面，字段出现在顶级也不产生任何 ops
            const roleSrc = draftRoles[type]
            if (roleSrc && typeof roleSrc === 'object') {
              if ('persona' in roleSrc) {
                const persona = typeof roleSrc.persona === 'string' ? roleSrc.persona : ''
                if (persona === '') ops.push({ op: 'unset', path: ['roles', type, 'persona'] })
                else ops.push({ op: 'set', path: ['roles', type, 'persona'], value: persona })
              }
              if (roleSrc.toolFilter && typeof roleSrc.toolFilter === 'object') {
                for (const side of ['allow', 'deny']) {
                  if (!Array.isArray(roleSrc.toolFilter[side])) continue
                  const names = roleSrc.toolFilter[side].map(String).filter((n) => n !== '')
                  if (names.length === 0) ops.push({ op: 'unset', path: ['roles', type, 'toolFilter', side] })
                  else ops.push({ op: 'set', path: ['roles', type, 'toolFilter', side], value: names })
                }
              }
            }
          }
          // 角色删除语义：仅当 draft 显式提供 roles dict（新前端恒带，旧前端
          // 无此键）时，存储里 draft.roles 已不存在的非内置键整键 unset——
          // 旧前端没有 roles 键 → 本段不启用，存量自定义角色绝不被误删。
          const draftRolesProvided = draft.roles !== undefined && draft.roles !== null
            && typeof draft.roles === 'object' && !Array.isArray(draft.roles)
          let storedRoleKeys = []
          try {
            const current = settingsService.get('dsh-my-go')
            const cr = current?.roles
            if (draftRolesProvided && cr && typeof cr === 'object' && !Array.isArray(cr)) storedRoleKeys = Object.keys(cr)
          } catch { /* settings read failure: skip the deletion pass */ }
          for (const key of storedRoleKeys) {
            if (AGENT_TYPES.includes(key)) continue
            if (!(key in draftRoles)) ops.push({ op: 'unset', path: ['roles', key] })
          }
          // 工具屏蔽（0.2.3-tisitan.13）：deny 空数组/缺失 → unset（=不屏蔽），
          // 非空 → 原样 set（条目统一转 string，防手改 settings.yaml 塞进脏值）。
          const deny = draft.toolMask?.deny
          if (Array.isArray(deny) && deny.length > 0) {
            ops.push({ op: 'set', path: ['toolMask', 'deny'], value: deny.map(String) })
          } else {
            ops.push({ op: 'unset', path: ['toolMask', 'deny'] })
          }
          // 宿主支持 expectedRevision 时把围栏交给它执行（提交在命名空间写队列
          // 里串行，检查与写入之间无 TOCTOU 窗）；不支持时上面的预检就是唯一闸
          const writeExtras = expectedRevision !== null && hostTakesExpectedRevision() ? [expectedRevision] : []
          if (ops.length > 0) await settingsService.mutate('dsh-my-go', ops, ...writeExtras)
          // 提交后版本号必已前进：把新值回给前端当凭据，否则用户改第二处时
          // 手里还攥着第一次保存前的旧号，自撞一次假冲突
          return { ok: true, value: { revision: currentRevision() } }
        } catch (e) {
          if (settingsConflict(e)) {
            const actual = typeof e.actual === 'number' ? e.actual : currentRevision()
            return { ok: false, error: { code: 'conflict', message: `settings write refused: namespace moved (expected r${e.expected ?? expectedRevision}, now r${actual})`, details: { expected: typeof e.expected === 'number' ? e.expected : expectedRevision, actual } } }
          }
          return { ok: false, error: { code: 'settings-rejected', message: String(e), details: {} } }
        }
      }
      return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} } }
    }, ...rpcHandleExtras)
  })
}
