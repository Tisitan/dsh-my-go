/**
 * dsh-my-go — role roster data + routing helpers (both halves).
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx.
 * The former closure dependencies are now explicit injection parameters:
 * `bindings` (mutable per-half state), `promptCache`/`loadPrompt` (prompt
 * loading chain — each half owns its own cache instance).
 */

import { AGENT_TYPES } from './constants.mjs'

// 旧顶级工种只读兼容：缺少 roles 同名行时补写该行，不 unset 非 volatile 旧键。
// 显式 roles 行（包括空对象）优先；补写后幂等，失败仍可从旧键读取绑定。
export function migrateLegacyRolesOps(stored) {
  if (!stored || typeof stored !== 'object') return null
  const legacy = []
  for (const key of AGENT_TYPES) {
    const row = stored[key]
    if (row && typeof row === 'object' && !Object.hasOwn(stored.roles ?? {}, key)) legacy.push(key)
  }
  if (legacy.length === 0) return null
  const ops = legacy.map((key) => ({ op: 'set', path: ['roles', key], value: stored[key] }))
  return ops
}

// settings → bindings 合并：基线 + sisyphus（顶级）+ 内置工种与 roles dict
// 自定义键（roles 行）。角色行可携带 persona；旧 toolFilter 明确忽略（不进入运行时绑定）。缺字段
// 回落基线，与旧逐字段 ?? 链同语义；每次整表重建，WebUI unset 正确回落。
export function mergeRoleBindings(baseBindings, stored) {
  const merged = Object.fromEntries(Object.entries(baseBindings).map(([key, row]) => {
    const { toolFilter: _ignored, ...binding } = row ?? {}
    return [key, binding]
  }))
  if (!stored || typeof stored !== 'object') return merged
  const roles = stored.roles && typeof stored.roles === 'object' ? stored.roles : {}
  // roles dict 键排除 sisyphus：sisyphus 恒为顶级键（与
  // migrateLegacyRolesOps「永不迁移」、rosterKeys「永不可派」同口径），dict 里
  // 的 sisyphus 行是 schema 字符集约束拦不住的死数据——合并不消费它，避免
  // 「两处来源、一处生效」的错觉；排除而非并入，不让 sisyphus 绑定出现双权威。
  for (const key of ['sisyphus', ...new Set([...AGENT_TYPES, ...Object.keys(roles).filter((k) => k !== 'sisyphus')])]) {
    const row = key === 'sisyphus' ? stored.sisyphus
      : Object.hasOwn(roles, key) ? roles[key] : stored[key]
    if (row && typeof row === 'object') {
      merged[key] = {
        provider: row.provider || merged[key]?.provider,
        model: row.model || merged[key]?.model,
        reasoningEffort: row.reasoningEffort || merged[key]?.reasoningEffort,
        fallbacks: row.fallbacks ?? merged[key]?.fallbacks,
        persona: row.persona ?? merged[key]?.persona,
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

// 名册条目：花名册三处消费面（配置卡/面板、编排状态文本、Sisyphus 系统提示简报）
// 的**共同语义源**——三处都从这份条目投影：文本面经 formatRosterRow /
// formatRosterChainDetail，面板面直读结构化字段自持排版。同源是硬约束：各面各自
// 成形会让同一个角色在不同界面上长出不同摘要（分隔符 `|` vs `→`、有无备选链
// 明细都会飘）。
// 纯函数：同一 bindings 两次调用逐字节全等（排序与内容都不含时间与随机）。
export function rosterEntries(bindings) {
  const source = bindings && typeof bindings === 'object' ? bindings : {}
  return rosterKeys(source).map((role) => {
    const row = source[role] ?? {}
    const provider = typeof row.provider === 'string' ? row.provider : ''
    const model = typeof row.model === 'string' ? row.model : ''
    const chain = (Array.isArray(row.fallbacks) ? row.fallbacks : []).map((entry) => ({
      provider: typeof entry?.provider === 'string' ? entry.provider : '',
      model: typeof entry?.model === 'string' ? entry.model : '',
    }))
    const builtin = AGENT_TYPES.includes(role)
    return {
      role,
      builtin,
      provider,
      model,
      // 绑定摘要：只认 provider/model 的有无，空值语义与「跟随环境」一致
      modelText: provider && model ? `${provider}·${model}`
        : model ? `?·${model}`
        : provider ? `${provider}·跟随环境`
        : '跟随环境',
      chain,
      toolFilterText: '继承宿主（工种限制已取消）',
      personaSource: typeof row.persona === 'string' && row.persona.length > 0
        ? '自定义人设'
        : builtin ? '内置文件' : '无（跟随环境）',
    }
  })
}

// 文本投影：编排状态与 rosterLines（deprecated 兼容字段）的行格式
export function formatRosterRow(entry) {
  return `- ${entry.role} | ${entry.modelText} | 备选${entry.chain.length} | ${entry.toolFilterText} | ${entry.personaSource}`
}

// 备选链明细（系统提示简报专用；面板直读 entry.chain）
export function formatRosterChainDetail(entry) {
  return entry.chain.length > 0
    ? `备选链 ${entry.chain.length} 条（${entry.chain.map((e) => `${e.provider || '?'}·${e.model || '?'}`).join(' → ')}）`
    : '无备选链'
}

// 名册简报渲染：Sisyphus 系统提示段「dsh-my-go:roster」的
// 纯渲染单一源（broker 半消费）。字节稳定铁律：工种键排序渲染、无时间戳/
// 无随机——同一份 bindings 两次渲染逐字节全等。头部一行失败通知协议提示
// （协议正文在 prompts/sisyphus.md「失败与备选通知协议」段，此处只做指路）。
export function renderRosterBriefing(bindings) {
  const lines = ['失败通知协议：harness 的 failed 通知先到是常态，不代表终局；有备选链的工种一律静默等待 broker 的备选处置通知（协议全文见下方「失败与备选通知协议」段）。']
  for (const entry of rosterEntries(bindings).sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0))) {
    lines.push(`- ${entry.role} → ${entry.modelText} → ${formatRosterChainDetail(entry)} → 工具: ${entry.toolFilterText} → 人设: ${entry.personaSource}`)
  }
  return lines.join('\n')
}

// 角色人设来源优先级：settings roles 行 persona（自定义/覆盖）→
// prompts/<type>.md（内置工种现成加载链，注入方决定路径根）→ 内置兜底文案；
// 自定义角色未配 persona 返回 undefined，动态提示段使用通用工种兜底。
export async function rolePersona(bindings, promptCache, loadPrompt, type) {
  const custom = bindings[type]?.persona
  if (typeof custom === 'string' && custom.length > 0) return custom
  const loaded = promptCache.has(type) ? promptCache.get(type) : await loadPrompt(type)
  if (typeof loaded === 'string' && loaded.length > 0) return loaded
  return AGENT_TYPES.includes(type) ? `You are a ${type} sub-agent in the dsh-my-go orchestration system. Execute one focused task and report results to Sisyphus.` : undefined
}

