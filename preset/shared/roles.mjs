/**
 * dsh-my-go — role roster data + routing helpers (both halves).
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx.
 * The former closure dependencies are now explicit injection parameters:
 * `bindings` (mutable per-half state), `promptCache`/`loadPrompt` (prompt
 * loading chain — broker uses its own preset root, lib uses the
 * .agent-presets install root; that Δ is the essential one and stays
 * per-half), and `knownTools` (live tool catalog snapshot).
 */

import { AGENT_TYPES } from './constants.mjs'

// 旧形态迁移（顶级七工种键 → roles dict）：输入 settings resolved 值，输出
// settingsService.mutate 的 ops（无需迁移时返回 null）。语义：
//   - sisyphus 与 toolMask 恒为顶级键，永不迁移；
//   - 顶级行无损整行搬入 roles（含 fallbacks 等全字段），同名覆盖 roles
//     已有行（旧顶级是迁移前唯一权威来源）；
//   - 旧键 unset（废弃不再消费），roles 中既有其他键不受影响；
//   - 幂等：迁移后无顶级工种键 → 再次调用返回 null，不产生任何 ops。
export function migrateLegacyRolesOps(stored) {
  if (!stored || typeof stored !== 'object') return null
  const legacy = []
  for (const key of AGENT_TYPES) {
    const row = stored[key]
    if (row && typeof row === 'object') legacy.push(key)
  }
  if (legacy.length === 0) return null
  const ops = legacy.map((key) => ({ op: 'set', path: ['roles', key], value: stored[key] }))
  ops.push(...legacy.map((key) => ({ op: 'unset', path: [key] })))
  return ops
}

// settings → bindings 合并：基线 + sisyphus（顶级）+ 内置工种与 roles dict
// 自定义键（roles 行）。角色行可携带 persona/toolFilter（自定义角色数据层，
// 内置七工种人设仍走 prompts/*.md，故 baseBindings 无此二字段）。缺字段
// 回落基线，与旧逐字段 ?? 链同语义；每次整表重建，WebUI unset 正确回落。
export function mergeRoleBindings(baseBindings, stored) {
  const merged = { ...baseBindings }
  if (!stored || typeof stored !== 'object') return merged
  const roles = stored.roles && typeof stored.roles === 'object' ? stored.roles : {}
  // roles dict 键排除 sisyphus（棒2-L1）：sisyphus 恒为顶级键（与
  // migrateLegacyRolesOps「永不迁移」、rosterKeys「永不可派」同口径），dict 里
  // 的 sisyphus 行是 schema 字符集约束拦不住的死数据——合并不消费它，避免
  // 「两处来源、一处生效」的错觉；排除而非并入，不让 sisyphus 绑定出现双权威。
  for (const key of ['sisyphus', ...new Set([...AGENT_TYPES, ...Object.keys(roles).filter((k) => k !== 'sisyphus')])]) {
    const row = key === 'sisyphus' ? stored.sisyphus : roles[key]
    if (row && typeof row === 'object') {
      merged[key] = {
        provider: row.provider || merged[key]?.provider,
        model: row.model || merged[key]?.model,
        reasoningEffort: row.reasoningEffort || merged[key]?.reasoningEffort,
        dsv4p0813: row.dsv4p0813 ?? merged[key]?.dsv4p0813 ?? false,
        fallbacks: row.fallbacks ?? merged[key]?.fallbacks,
        persona: row.persona ?? merged[key]?.persona,
        toolFilter: row.toolFilter ?? merged[key]?.toolFilter,
      }
    }
  }
  return merged
}

// 可派角色 = 内置工种 ∪ bindings 自定义键（sisyphus 是编排者单例，永不可派）。
// go_work/forward 的运行时校验都以这份活名单为准。
export function rosterKeys(bindings) {
  const custom = Object.keys(bindings).filter((k) => k !== 'sisyphus' && !AGENT_TYPES.includes(k))
  return [...AGENT_TYPES, ...custom]
}

// 名册简报渲染（tisitan.18）：Sisyphus 系统提示段「dsh-my-go:roster」的
// 纯渲染单一源（broker 半消费）。字节稳定铁律：工种键排序渲染、无时间戳/
// 无随机——同一份 bindings 两次渲染逐字节全等。头部一行失败通知协议提示
// （协议正文在 prompts/sisyphus.md「失败与备选通知协议」段，此处只做指路）。
export function renderRosterBriefing(bindings) {
  const lines = ['失败通知协议：harness 的 failed 通知先到是常态，不代表终局；有备选链的工种一律静默等待 broker 的备选处置通知（协议全文见下方「失败与备选通知协议」段）。']
  for (const type of rosterKeys(bindings).slice().sort()) {
    const b = bindings[type] ?? {}
    const model = b.provider && b.model ? `${b.provider}·${b.model}` : b.model ? `?·${b.model}` : b.provider ? `${b.provider}·跟随环境` : '跟随环境'
    const chain = Array.isArray(b.fallbacks) ? b.fallbacks : []
    const chainText = chain.length > 0
      ? `备选链 ${chain.length} 条（${chain.map((e) => `${typeof e?.provider === 'string' && e.provider ? e.provider : '?'}·${typeof e?.model === 'string' && e.model ? e.model : '?'}`).join(' → ')}）`
      : '无备选链'
    let tf = '全量（除全局掩码）'
    if (b.toolFilter && typeof b.toolFilter === 'object') {
      const parts = []
      if (Array.isArray(b.toolFilter.allow) && b.toolFilter.allow.length > 0) parts.push(`仅 ${b.toolFilter.allow.join(', ')}`)
      if (Array.isArray(b.toolFilter.deny) && b.toolFilter.deny.length > 0) parts.push(`除 ${b.toolFilter.deny.join(', ')}`)
      if (parts.length > 0) tf = parts.join('；')
    }
    const persona = typeof b.persona === 'string' && b.persona.length > 0 ? '自定义人设' : AGENT_TYPES.includes(type) ? '内置文件' : '无（跟随环境）'
    lines.push(`- ${type} → ${model} → ${chainText} → 工具: ${tf} → 人设: ${persona}`)
  }
  return lines.join('\n')
}

// 角色人设来源优先级：settings roles 行 persona（自定义/覆盖）→
// prompts/<type>.md（内置工种现成加载链，注入方决定路径根）→ 内置兜底文案；
// 自定义角色未配 persona 则不注入（undefined = 不传字段，由部署人设接管）。
export async function rolePersona(bindings, promptCache, loadPrompt, type) {
  const custom = bindings[type]?.persona
  if (typeof custom === 'string' && custom.length > 0) return custom
  const loaded = promptCache.has(type) ? promptCache.get(type) : await loadPrompt(type)
  if (typeof loaded === 'string' && loaded.length > 0) return loaded
  return AGENT_TYPES.includes(type) ? `You are a ${type} sub-agent in the dsh-my-go orchestration system. Execute one focused task and report results to Sisyphus.` : undefined
}

// toolFilter 透传前的缺名兜底（勘察 Q2 红线：restrict 校验遇到未注册名会
// 让整个 startContinuable 失败）：对照活目录过滤假名 + warn。knownTools 为
// undefined（目录不可知）时原样透传（宁可在 spawn 处显式报错，不静默改写
// 配置语义）。allow 被过滤至空 = 配置整体不可信，丢弃 allow 让子代理回落
// 全量目录，绝不让它殉葬。
export function resolveRoleToolFilter(type, filter, knownTools) {
  if (!filter || typeof filter !== 'object') return undefined
  const pick = (names) => {
    if (knownTools === undefined) {
      console.warn(`[dsh-my-go] toolFilter for ${type}: live tool catalog unavailable, passing through unfiltered`)
      return names
    }
    const kept = names.filter((n) => knownTools.has(n))
    const dropped = names.filter((n) => !knownTools.has(n))
    if (dropped.length > 0) console.warn(`[dsh-my-go] toolFilter for ${type}: skipped unknown tool(s): ${dropped.join(', ')}`)
    return kept
  }
  const out = {}
  if (Array.isArray(filter.allow) && filter.allow.length > 0) {
    const allow = pick(filter.allow.map(String))
    if (allow.length > 0) out.allow = allow
    else console.warn(`[dsh-my-go] toolFilter for ${type}: allow list emptied by catalog filter, dropping it (sub-agent falls back to the full catalog)`)
  }
  if (Array.isArray(filter.deny) && filter.deny.length > 0) {
    const deny = pick(filter.deny.map(String))
    if (deny.length > 0) out.deny = deny
  }
  return Object.keys(out).length > 0 ? out : undefined
}
