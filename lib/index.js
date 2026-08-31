/**
 * dsh-my-go — Sisyphus agent orchestration (HOST half, npm bundle).
 *
 * The host plugin of the `dsh-my-go` npm package. Registered through the
 * package's own `cordis.patch.yml` (dsh.bundle.patch), so `dsh plugin add
 * dsh-my-go` activates it automatically as a profile layer.
 *
 * tisitan.21 起本半只做存储/安装/面板 RPC 面，编排实现唯一归属 preset 半
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

// inject 面随 tisitan.21 半截肢收敛：RPC 端点读 tools（listTools）、llm
// （listModels）、settings（存储面注册与读写）。编排面服务（subagents/
// agents/sessions/systemPrompt）随编排实现整体迁往 preset 半 broker.mjs，
// 本半不再声明依赖。
export const inject = ['tools', 'llm', 'settings']

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// ── shared 源（tisitan.15）：与 broker 半共用的纯函数单一源 ────────────────
// lib 以包内路径 import（../preset/shared/），broker 以 preset 内相对路径
// import（../shared/）——两种部署形态下路径均成立（preset/ 由
// ensurePresetInstalled 整拷，shared/ 随拷且安装后有存在性校验）。
// tisitan.21 起本半只引入存储/面板面依赖的符号：名册键集（renderRosterLines
// 消费）、settings 迁移/合并、内置工种清单与键名 pattern；编排面符号
// （Orchestration/failure/archive/备选链合并等）一律不引入。
import { AGENT_TYPES, ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'
import { migrateLegacyRolesOps, mergeRoleBindings, rosterKeys as sharedRosterKeys } from '../preset/shared/roles.mjs'
import { defaultBindings } from '../preset/shared/misc.mjs'

// 保持 lib 存储面导出面（roster-roles 等测试与外部消费者经由 lib 入口引用
// 共享实现）。编排面符号（Orchestration / failure / archive / misc 养护函数）
// 的 re-export 已随 tisitan.21 切除——消费方直引 preset/shared/。
export { ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'
export { migrateLegacyRolesOps, mergeRoleBindings } from '../preset/shared/roles.mjs'

/**
 * Install the bundled agent preset into the user preset root once, so the
 * "MyGO!!!!! 模式" preset appears in the session picker after `dsh plugin
 * add dsh-my-go`. DSH discovers presets only from configured roots
 * (~/.dsh/.agent-presets/), never from node_modules, so the npm bundle must
 * copy its preset/ directory there. Idempotent: synced only when the package
 * version changes (marker file `.dsh-my-go-version`), so manual tweaks to the
 * installed preset survive same-version reloads.
 * Failures are logged and swallowed — the host plugin must keep working even
 * when the preset copy is not possible.
 */
async function ensurePresetInstalled() {
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // .../dsh-my-go/lib
    const packageRoot = dirname(here) // .../dsh-my-go
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const userPresetRoot = join(dshHome, '.agent-presets')
    const target = join(userPresetRoot, 'dsh-my-go')
    const markerPath = join(target, '.dsh-my-go-version')
    // Version marker: skip sync when the installed copy matches this package
    let version = '0.0.0'
    try {
      const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf-8'))
      version = String(pkg.version ?? version)
    } catch { /* fall through with default */ }
    try {
      const installed = (await readFile(markerPath, 'utf-8')).trim()
      if (installed === version) return // already synced for this version
    } catch { /* no marker → first install or legacy copy: sync below */ }
    await mkdir(userPresetRoot, { recursive: true })
    // Sync preset/ directory (composition + tools + shared/)
    const presetSource = join(packageRoot, 'preset')
    await access(presetSource)
    await cp(presetSource, target, { recursive: true, force: true })
    // shared/ 是两半共享源（tisitan.15）：broker.mjs 以相对路径 import 它，
    // 整拷后必须存在——校验缺失只 warn 不阻断（fail-observable），防未来
    // 「选择性拷贝」把 broker 的 import 静默断链。
    const sharedTarget = join(target, 'shared')
    try {
      await access(sharedTarget)
    } catch {
      console.warn(`[dsh-my-go] preset sync: shared/ missing at ${sharedTarget} — broker.mjs imports would fail; check preset/ copy completeness`)
    }
    // Sync prompts/ directory (persona markdown files)
    const promptsSource = join(packageRoot, 'prompts')
    const promptsTarget = join(target, 'prompts')
    try {
      await access(promptsSource)
      await cp(promptsSource, promptsTarget, { recursive: true, force: true })
    } catch { /* prompts/ optional — degrade gracefully */ }
    await writeFile(markerPath, version, 'utf-8')
    console.log(`[dsh-my-go] preset synced to ${target} (v${version})`)
  } catch (error) {
    console.error(`[dsh-my-go] could not sync preset: ${String(error)}`)
  }
}

export async function apply(ctx, config = {}) {
  void ensurePresetInstalled()
  // 合并基线：默认值 + 插件 config。settings 覆盖永远从基线起算，
  // 这样 WebUI 取消某字段后能正确回落默认，而不是残留旧的已合并值。
  const baseBindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  let bindings = { ...baseBindings }

  // ── settings-backed bindings (WebUI configurable) ───────────────────────
  // bindings 在本半的消费面只有 renderRosterLines（RPC snapshot 花名册区）；
  // 编排执行面消费（派发/waterfall/备选链）已全部归属 broker 半（tisitan.21）。
  const settings = ctx.get('settings')
  let settingsScope
  if (settings !== undefined) {
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
      settingsScope = settings.register(
        'dsh-my-go',
        z.object({
          sisyphus: agentSchema,
          roles: z.dict(roleSchema, z.string().pattern(ROLE_KEY_PATTERN)),
          // 工具屏蔽（tisitan.13）：deny 为工具名数组；preset 半 tool-mask.mjs
          // 在会话组装时读取。空数组=不屏蔽（saveSettings 转 unset）。
          toolMask: z.object({ deny: z.array(z.string()) }),
        }),
        {},
      )
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
      const stored = settings.get('dsh-my-go')
      bindings = mergeRoleBindings(baseBindings, stored)
      await migrateLegacyRoles(stored)
      ctx.on('settings/updated', (ns) => {
        if (ns !== 'dsh-my-go') return
        const next = settings.get('dsh-my-go')
        bindings = mergeRoleBindings(baseBindings, next)
        void migrateLegacyRoles(next)
      })
    } catch {
      // Settings optional — defaults apply.
    }
  }

  // ── 名册渲染辅助（RPC snapshot 的 rosterLines 数据源）────────────────────
  // 核心逻辑在 shared/roles.mjs，这里是注入本半可变 bindings 的薄壳。
  const rosterKeys = () => sharedRosterKeys(bindings)

  // 活花名册区（tisitan.14）：与 broker 半 orchestration_status 的 roles 区
  // 同源同格式，本半供 snapshot RPC 的花名册常驻渲染（客户端不另造摘要格式）。
  function renderRosterLines() {
    const lines = ['── 角色名册（roster） ──']
    for (const type of rosterKeys()) {
      const b = bindings[type] ?? {}
      const model = b.provider && b.model ? `${b.provider}·${b.model}` : b.model ? `?·${b.model}` : b.provider ? `${b.provider}·跟随环境` : '跟随环境'
      const chain = Array.isArray(b.fallbacks) ? b.fallbacks.length : 0
      let tf = '全量（除全局掩码）'
      if (b.toolFilter && typeof b.toolFilter === 'object') {
        const parts = []
        if (Array.isArray(b.toolFilter.allow) && b.toolFilter.allow.length > 0) parts.push(`仅 ${b.toolFilter.allow.join(', ')}`)
        if (Array.isArray(b.toolFilter.deny) && b.toolFilter.deny.length > 0) parts.push(`除 ${b.toolFilter.deny.join(', ')}`)
        if (parts.length > 0) tf = parts.join('；')
      }
      const persona = typeof b.persona === 'string' && b.persona.length > 0 ? '自定义人设' : AGENT_TYPES.includes(type) ? '内置文件' : '无（跟随环境）'
      lines.push(`- ${type} | ${model} | 备选${chain} | ${tf} | ${persona}`)
    }
    return lines
  }

  // ── client bridge via connection.rpc (bundle plugins use connection.rpc,
  // NOT harness.handle, which is reserved for dynamic cordis plugins) ──────
  ctx.inject(['connection'], (webContext) => {
    if (webContext.connection === undefined) return
    const rpc = webContext.connection.rpc
    if (!rpc || typeof rpc.handle !== 'function') return

    // Single channel with endpoint dispatch (same pattern as dsh-mnemon):
    // channel = "/dsh-my-go", endpoints = "snapshot" | "listModels" | "listTools"
    //   | "getBuiltinPersona" | "loadSettings" | "saveSettings"
    rpc.handle('/dsh-my-go', async (endpoint, payload) => {
      if (endpoint === 'snapshot') {
        // 编排快照唯一来源：agent 平面 broker 经 Symbol.for 全局桥发布的实时
        // 快照。tisitan.21 起本半不再维护编排状态机——桥不存在 = preset 未
        // 装配（lib-only 降级形态），回落降级空态 { seq: 0, parents: {} }。
        // 两侧形状必须一致：{ seq, parents: { [parentSessionId]: {...} } }。
        const shared = globalThis[Symbol.for('dsh-my-go.snapshot')]
        const value = typeof shared === 'function' ? shared() : null
        // 花名册常驻（tisitan.15）：与编排状态无关，preset 未装配也产出——
        // 客户端面板花名册区直接渲染行文本（复用本半 renderRosterLines）。
        return { ok: true, value: { ...(value ?? { seq: 0, parents: {} }), rosterLines: renderRosterLines() } }
      }
      if (endpoint === 'listModels') {
        const llm = ctx.get('llm')
        if (!llm) return { ok: true, value: { providers: [], models: {} } }
        let providers = []
        try {
          // Use listProviders() — returns only ACTIVE/configured providers,
          // NOT listConfigurableProviders() which includes unconfigured ones
          const active = await llm.listProviders()
          providers = active.map((p) => p.id)
        } catch { /* llm not available */ }
        const models = {}
        for (const pid of providers) {
          try {
            const list = await llm.listModels(pid)
            models[pid] = list.map((m) => m.id)
          } catch { /* provider may not support listing */ }
        }
        return { ok: true, value: { providers, models } }
      }
      // 工具花名册（tisitan.13）：供设置页「工具屏蔽」双列表的「当前可用」
      // 列使用。tools.schemas() 无参 = 全局层视图（MCP 已连上的工具、DSH 内建
      // 工具、preset 半编排工具），恰是 tool-mask restrict 能 deny 的面。保留名
      // run_code 不在过滤层注册（Code Mode 保留传输），从名单剔除。花名册是
      // 快照：MCP 动态连接后需重开设置页刷新。服务缺席/异常回落空名单——
      // 设置页降级为纯编辑器（已屏蔽条目带「未连接」徽章），不阻塞保存。
      if (endpoint === 'listTools') {
        try {
          const toolsService = ctx.get('tools')
          const schemas = typeof toolsService?.schemas === 'function' ? toolsService.schemas() : []
          const names = schemas
            .map((schema) => schema?.name)
            .filter((name) => typeof name === 'string' && name !== '' && name !== 'run_code')
          return { ok: true, value: [...new Set(names)].sort() }
        } catch (e) {
          console.warn(`[dsh-my-go] listTools failed, returning empty roster: ${String(e)}`)
          return { ok: true, value: [] }
        }
      }
      // 内置人设原文（tisitan.16b）：设置页内置卡「载入文件默认」按钮的数据
      // 源。直读磁盘不走缓存——启动期缺档不能挡住后续同步落盘的文件。type 过
      // ROLE_KEY_PATTERN 防目录穿越；非法 type/文件缺失结构化空返回，绝不抛穿 RPC。
      if (endpoint === 'getBuiltinPersona') {
        const type = typeof payload?.type === 'string' ? payload.type : ''
        if (!ROLE_KEY_PATTERN.test(type)) {
          return { ok: false, error: { code: 'bad-request', message: `invalid agent type: ${JSON.stringify(payload?.type ?? null)}` } }
        }
        try {
          const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
          const persona = await readFile(join(dshHome, '.agent-presets', 'dsh-my-go', 'prompts', `${type}.md`), 'utf-8')
          return { ok: true, value: { type, persona } }
        } catch {
          return { ok: false, error: { code: 'not-found', message: `prompts/${type}.md 不存在（preset 未安装或未同步）` } }
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
          return { ok: true, value: { ...value, ...promoted } }
        } catch (e) {
          return { ok: true, value: {} }
        }
      }
      if (endpoint === 'saveSettings') {
        const draft = payload
        if (!draft || typeof draft !== 'object') return { ok: false, error: { code: 'bad-request', message: 'payload must be an object' } }
        const settingsService = ctx.get('settings')
        if (!settingsService) return { ok: false, error: { code: 'unavailable', message: 'settings service not available' } }
        try {
          // sisyphus 恒为顶级键；工种角色统一写 roles dict。draft 兼容两种
          // 形状：前端旧形状（顶级工种键，loadSettings 提升后原样回传，用户
          // 编辑发生在顶级卡片上，故取值顶级优先）与 roles 形状。
          // 全字段统一「显式携带才写」（ tisitan.15）：字段缺失=完全不触碰
          // （ tisitan.14 只对 persona/toolFilter 这样，5 字段循环仍无条件
          // set/unset——persona 覆盖编辑会发只带 persona 的部分行，无条件
          // 循环会把该角色已配的 provider/model 等误清）。显式空值仍 = unset
          // （WebUI 把字段选回「跟随环境」的清除路径不变）。
          const fields = ['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'fallbacks']
          const draftRoles = draft.roles && typeof draft.roles === 'object' && !Array.isArray(draft.roles) ? draft.roles : {}
          // roles dict 键排除 sisyphus（棒2-L1）：sisyphus 恒为顶级键（与
          // migrateLegacyRolesOps「永不迁移」同口径），draft.roles.sisyphus 是
          // schema 拦不住的死数据——写面直接不落，存量的靠下方删除面自然清出
          const roleKeys = [...new Set([...AGENT_TYPES, ...Object.keys(draftRoles).filter((k) => k !== 'sisyphus')])]
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
          // 工具屏蔽（tisitan.13）：deny 空数组/缺失 → unset（=不屏蔽），
          // 非空 → 原样 set（条目统一转 string，防手改 settings.yaml 塞进脏值）。
          const deny = draft.toolMask?.deny
          if (Array.isArray(deny) && deny.length > 0) {
            ops.push({ op: 'set', path: ['toolMask', 'deny'], value: deny.map(String) })
          } else {
            ops.push({ op: 'unset', path: ['toolMask', 'deny'] })
          }
          if (ops.length > 0) await settingsService.mutate('dsh-my-go', ops)
          return { ok: true, value: null }
        } catch (e) {
          return { ok: false, error: { code: 'settings-rejected', message: String(e) } }
        }
      }
      return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}` } }
    }, { authority: 'trusted-host' })
  })
}
