/**
 * dsh-my-go — custom role (roles dict) state transitions (settings page editor).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module dependency-free (no react, no @deepseek-ai/*).
 *
 * A role row is `{ key, provider, model, reasoningEffort, dsv4p0813,
 * fallbacks, persona, allow, deny }` (the toolFilter object is flattened to
 * two name lists for the editors). Role keys must match ROLE_KEY_PATTERN —
 * the same constraint the host settings schema enforces fail-closed — so an
 * invalid name is rejected client-side before any save attempt. All
 * functions are pure: inputs are never mutated, new arrays/objects returned.
 */

export const ROLE_KEY_PATTERN = /^[a-z][a-z-]*$/

/** Whether `key` is a saveable custom-role name (lowercase start, [a-z-] body). */
export function isValidRoleKey(key) {
  return typeof key === 'string' && ROLE_KEY_PATTERN.test(key)
}

function normalizeNameList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '' || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out
}

/**
 * Normalize a persisted roles dict into editor rows. `builtinKeys` (the
 * eight built-in specialists, sisyphus included) are NOT custom roles —
 * they keep their own top-level cards, so rows carrying those keys are
 * dropped here.
 */
export function normalizeRoleRows(value, builtinKeys = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const builtin = new Set(Array.isArray(builtinKeys) ? builtinKeys : [])
  return Object.entries(value)
    .filter(([key, row]) => isValidRoleKey(key) && !builtin.has(key) && row !== null && typeof row === 'object')
    .map(([key, row]) => ({
      key,
      provider: typeof row.provider === 'string' ? row.provider : '',
      model: typeof row.model === 'string' ? row.model : '',
      reasoningEffort: typeof row.reasoningEffort === 'string' ? row.reasoningEffort : '',
      dsv4p0813: row.dsv4p0813 === true,
      fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks : [],
      persona: typeof row.persona === 'string' ? row.persona : '',
      allow: normalizeNameList(row.toolFilter?.allow),
      deny: normalizeNameList(row.toolFilter?.deny),
    }))
}

export function normalizeRoleToolNames(value) {
  return normalizeNameList(value)
}

/**
 * Rebuild the persisted roles dict from editor rows (tisitan.20 Z2'): rows
 * touched by the editor are re-projected to the storage shape, while every
 * key the row-normalizer rejected (invalid key / non-object value) is
 * carried through VERBATIM — an untouched dirty row must not be silently
 * deleted by an unrelated save. Built-in rows pass through untouched as
 * well (partial persona-override rows keep their other fields).
 */
export function mergeRoleRowsIntoRoles(oldRoles, nextRows, builtinKeys = []) {
  const source = oldRoles && typeof oldRoles === 'object' ? oldRoles : {}
  const builtin = new Set(Array.isArray(builtinKeys) ? builtinKeys : [])
  const builtinPart = {}
  for (const key of Object.keys(source)) {
    if (builtin.has(key) && source[key] && typeof source[key] === 'object') builtinPart[key] = source[key]
  }
  const touchedKeys = new Set(nextRows.map((row) => row.key))
  // 透传范围收窄到「投影会拒绝的脏行」（与 normalizeRoleRows 的剔除谓词
  // 逐字对齐）：合法但被用户从 rows 删除的自定义键不在此列——它随 dict
  // 重建消失，保存时 host 半整键 unset，删除语义得以成立
  const dirtyPart = {}
  for (const key of Object.keys(source)) {
    if (builtin.has(key) || touchedKeys.has(key)) continue
    if (isValidRoleKey(key) && source[key] !== null && typeof source[key] === 'object') continue
    dirtyPart[key] = source[key]
  }
  const customPart = {}
  for (const row of nextRows) {
    customPart[row.key] = {
      provider: row.provider,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      dsv4p0813: row.dsv4p0813,
      fallbacks: row.fallbacks,
      persona: row.persona,
      toolFilter: { allow: row.allow, deny: row.deny },
    }
  }
  return { ...builtinPart, ...dirtyPart, ...customPart }
}

/** Append one empty role with `key`; invalid or duplicate keys return the rows unchanged. */
export function addRoleRow(rows, key) {
  if (!isValidRoleKey(key)) return rows
  if (rows.some((row) => row.key === key)) return rows
  return [...rows, { key, provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: [], deny: [] }]
}

/** Remove the role with `key`; unknown keys return the rows unchanged. */
export function removeRoleRow(rows, key) {
  return rows.filter((row) => row.key !== key)
}

const ROLE_FIELDS = new Set(['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'persona', 'fallbacks', 'allow', 'deny'])

/**
 * Update one field of the role with `key`. Provider changes reset that
 * row's model (avoid dangling model names from the old provider); lists
 * (fallbacks/allow/deny) replace wholesale — row transitions stay in the
 * dedicated helpers, this is the scalar/replacement setter.
 */
export function updateRoleRow(rows, key, field, value) {
  if (!ROLE_FIELDS.has(field)) return rows
  return rows.map((row) => {
    if (row.key !== key) return row
    if (field === 'provider') {
      return { ...row, provider: typeof value === 'string' ? value : '', model: '' }
    }
    if (field === 'dsv4p0813') {
      return { ...row, dsv4p0813: value === true }
    }
    if (field === 'fallbacks' || field === 'allow' || field === 'deny') {
      return { ...row, [field]: Array.isArray(value) ? value : [] }
    }
    return { ...row, [field]: typeof value === 'string' ? value : '' }
  })
}

/** Add one tool name to the role's allow/deny list; empty names and duplicates are no-ops. */
export function addRoleToolEntry(rows, key, side, name) {
  if (side !== 'allow' && side !== 'deny') return rows
  if (typeof name !== 'string' || name.trim() === '') return rows
  const clean = name.trim()
  return rows.map((row) => {
    if (row.key !== key || row[side].includes(clean)) return row
    return { ...row, [side]: [...row[side], clean] }
  })
}

/** Remove the tool name at `index` from the role's allow/deny list; out-of-range is a no-op. */
export function removeRoleToolEntry(rows, key, side, index) {
  if (side !== 'allow' && side !== 'deny') return rows
  return rows.map((row) => {
    if (row.key !== key || !Number.isInteger(index) || index < 0 || index >= row[side].length) return row
    return { ...row, [side]: row[side].filter((_, i) => i !== index) }
  })
}

/**
 * One-line card summary: `provider·model（未配显示跟随环境）| 备选n |
 * toolFilter 摘要 | persona 首行` — mirrors the panel roster rendering so
 * the settings card and the orchestration_status roles section read alike.
 */
export function roleSummaryText(row) {
  const model = row.provider && row.model ? `${row.provider}·${row.model}` : row.model ? `?·${row.model}` : row.provider ? `${row.provider}·跟随环境` : '跟随环境'
  const chain = Array.isArray(row.fallbacks) ? row.fallbacks.length : 0
  let tf = '全量（除全局掩码）'
  if (row.allow.length > 0 || row.deny.length > 0) {
    const parts = []
    if (row.allow.length > 0) parts.push(`仅 ${row.allow.join(', ')}`)
    if (row.deny.length > 0) parts.push(`除 ${row.deny.join(', ')}`)
    tf = parts.join('；')
  }
  const personaFirstLine = row.persona.split('\n').map((s) => s.trim()).find(Boolean) ?? ''
  return `${model} | 备选${chain} | ${tf}${personaFirstLine ? ` | ${personaFirstLine.slice(0, 60)}` : ''}`
}

export function builtinSummaryText(cfg) {
  const row = cfg && typeof cfg === 'object' ? cfg : {}
  const provider = typeof row.provider === 'string' ? row.provider : ''
  const model = typeof row.model === 'string' ? row.model : ''
  const binding = provider && model
    ? `${provider}·${model}`
    : provider
      ? `${provider}·跟随 Sisyphus`
      : model
        ? `跟随 Sisyphus·${model}`
        : '跟随 Sisyphus'
  const effort = typeof row.reasoningEffort === 'string' && row.reasoningEffort !== '' ? row.reasoningEffort : '跟随模型默认'
  const chain = Array.isArray(row.fallbacks) ? row.fallbacks.length : 0
  return `${binding} | ${effort} | 备选 ${chain} 条`
}

/**
 * Persona override row for a built-in specialist (tisitan.15): keep any
 * existing fields of the stored roles row and touch ONLY `persona` — the
 * host save loop treats absent fields as "don't touch", so a partial row
 * never clears a configured binding. Empty text = cleared override (the
 * host stores an explicit unset on save, restoring the prompts/ file).
 */
export function withPersonaOverride(existingRow, text) {
  const base = existingRow && typeof existingRow === 'object' && !Array.isArray(existingRow) ? existingRow : {}
  return { ...base, persona: typeof text === 'string' ? text : '' }
}

/** Card status line: has the roles row an explicit (non-empty) persona override? */
export function personaOverrideSource(existingRow) {
  const hasOverride = existingRow !== null && typeof existingRow === 'object'
    && typeof existingRow.persona === 'string' && existingRow.persona.length > 0
  return hasOverride ? '已覆盖（保存后替换文件默认）' : '文件默认'
}

/**
 * Normalize the host `getBuiltinPersona` RPC result (tisitan.16b) into an
 * editor action: `{ ok: true, persona }` fills the override textarea as an
 * unsaved draft; anything else becomes a red inline message. The host
 * endpoint never throws across the RPC, but the transport still can — the
 * caller's catch path passes `undefined`/arbitrary shapes through here too.
 */
export function resolveBuiltinPersonaResult(res) {
  const persona = res?.value?.persona
  if (res && res.ok === true && typeof persona === 'string') return { ok: true, persona }
  const message = typeof res?.error?.message === 'string' && res.error.message !== ''
    ? res.error.message
    : '人设文件读取失败'
  return { ok: false, message }
}

/**
 * Serialize one editor row (flattened allow/deny) into a portable role-card
 * JSON string: full field set, nested toolFilter, pretty-printed.
 */
export function buildRoleCardJson(row) {
  if (!row || typeof row !== 'object') return '{}'
  return JSON.stringify({
    key: typeof row.key === 'string' ? row.key : '',
    provider: row.provider ?? '',
    model: row.model ?? '',
    reasoningEffort: row.reasoningEffort ?? '',
    dsv4p0813: row.dsv4p0813 === true,
    fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks : [],
    persona: row.persona ?? '',
    toolFilter: { allow: Array.isArray(row.allow) ? row.allow : [], deny: Array.isArray(row.deny) ? row.deny : [] },
  }, null, 2)
}

/**
 * Parse pasted role-card JSON into an editor row. Strictness: valid JSON,
 * object top level, key matching ROLE_KEY_PATTERN, key not in `existingKeys`
 * (built-ins + live custom keys), unknown fields stripped, scalar types
 * kept only when string/boolean, fallback entries kept only with string
 * provider/model, tool lists deduped. Returns `{ ok: true, row }` or
 * `{ ok: false, error }`.
 */
export function parseRoleCardJson(text, existingKeys = []) {
  const fail = (error) => ({ ok: false, error })
  let raw
  try {
    raw = JSON.parse(typeof text === 'string' ? text : '')
  } catch {
    return fail('不是合法 JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('顶层必须是 JSON 对象')
  const key = typeof raw.key === 'string' ? raw.key : ''
  if (!isValidRoleKey(key)) return fail(`key 不合法：须小写字母开头、只含小写与连字符（收到 ${JSON.stringify(raw.key ?? null)}）`)
  if (existingKeys.includes(key)) return fail(`key「${key}」已存在（内置工种或已有自定义角色不可覆盖，先删除再导入）`)
  const fallbacks = Array.isArray(raw.fallbacks)
    ? raw.fallbacks.filter((e) => e !== null && typeof e === 'object' && typeof e.provider === 'string' && typeof e.model === 'string')
    : []
  const filter = raw.toolFilter !== null && typeof raw.toolFilter === 'object' ? raw.toolFilter : {}
  const names = (v) => Array.isArray(v) ? [...new Set(v.filter((n) => typeof n === 'string' && n !== ''))] : []
  return {
    ok: true,
    row: {
      key,
      provider: typeof raw.provider === 'string' ? raw.provider : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      reasoningEffort: typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort : '',
      dsv4p0813: raw.dsv4p0813 === true,
      fallbacks,
      persona: typeof raw.persona === 'string' ? raw.persona : '',
      allow: names(filter.allow),
      deny: names(filter.deny),
    },
  }
}
