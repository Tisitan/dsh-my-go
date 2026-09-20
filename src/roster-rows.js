/**
 * dsh-my-go — custom role (roles dict) projections for the settings page.
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module free of react and @deepseek-ai/* imports (preset/shared/constants
 * is plain ESM constants, safe for both consumers).
 *
 * Scope note (0.5.0-tisitan.3 批次 3): this module is the persisted-roles
 * projection layer — key validation, stored-dict → editor-row normalization,
 * persona overrides and the getBuiltinPersona RPC result interpreter. The
 * row-level editing transitions (add/remove/update rows, tool entries,
 * summary lines, card JSON import/export) now live with the 0.5.0 settings
 * page in src/settings-core.js / src/roles-editor.js; the retired copies
 * that used to sit here were deleted as orphaned exports.
 *
 * A role row is `{ key, provider, model, reasoningEffort, dsv4p0813,
 * fallbacks, persona, allow, deny }` (the toolFilter object is flattened to
 * two name lists for the editors). Role keys must match ROLE_KEY_PATTERN —
 * the same constraint the host settings schema enforces fail-closed — so an
 * invalid name is rejected client-side before any save attempt. All
 * functions are pure: inputs are never mutated, new arrays/objects returned.
 */

import { ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'

export { ROLE_KEY_PATTERN }

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
