/**
 * dsh-my-go — usage price table state transitions (contract D1, usage-stats
 * design doc §5 settings-page seam).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module free of react and @deepseek-ai/* imports (preset/shared/constants
 * is plain ESM constants, safe for both consumers).
 *
 * Editing-state shape: draft.usagePrices is `{ [key]: row }` where row
 * buckets hold `number | string | undefined` — number inputs hand us raw
 * strings ("", "-", "1.5") and rejecting them at keystroke level would make
 * the box fight the user, so row operations below preserve mid-state rows
 * verbatim, validation is surfaced per-row, and the save boundary drops
 * invalid rows (same edit-loose/save-strict split as stripEmptyFallbackRows).
 * Persisted shape is numbers only; lib-half saveSettings re-sanitizes before
 * compiling ops (defense in depth, same rule both halves — dirty rows are
 * dropped fail-closed so one bad row can never poison the atomic mutate,
 * E7/B-05 precedent).
 */

import { PRICE_KEY_PATTERN } from '../preset/shared/constants.mjs'

export { PRICE_KEY_PATTERN }

export const REQUIRED_BUCKETS = ['input', 'output']
export const OPTIONAL_BUCKETS = ['cacheRead', 'cacheWrite']
export const PRICE_BUCKETS = [...REQUIRED_BUCKETS, ...OPTIONAL_BUCKETS]

/**
 * Model-picker options for the create-key input (0.5.0 UX pass 2): flat
 * `provider/model` strings assembled from the listModels projection — the
 * exact PRICE_KEY_PATTERN key format, so a picked option IS a valid row key,
 * no re-formatting step that could drift from the pattern. Keys already in
 * the table are excluded (duplicate rows are guarded downstream too, but not
 * offering them is the honest UI). listModels order is preserved — same
 * presentation order as the chain editor's provider/model pickers. A missing
 * or malformed models map degrades to [] and the combobox stays hand-fillable.
 */
export function priceKeyOptions(available, existingKeys) {
  const existing = existingKeys instanceof Set ? existingKeys : new Set(Object.keys(existingKeys ?? {}))
  const modelsMap = available?.models && typeof available.models === 'object' && !Array.isArray(available.models)
    ? available.models
    : {}
  const out = []
  const seen = new Set()
  for (const [provider, models] of Object.entries(modelsMap)) {
    if (typeof provider !== 'string' || provider === '' || !Array.isArray(models)) continue
    for (const model of models) {
      if (typeof model !== 'string' || model === '') continue
      const key = `${provider}/${model}`
      if (seen.has(key) || existing.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

const isRowMap = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Coerce one bucket value (number, numeric string, or anything else) into a
 * finite non-negative number, or null. This is the single funnel for the
 * "reject NaN/Infinity/negative at write time" contract rule: schemastery's
 * .min(0) cannot see NaN/Infinity (NaN < 0 is false), so both halves filter
 * with this rule before anything reaches storage.
 */
export function sanitizeBucket(value) {
  const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

/**
 * Build the persisted row (numbers only, absent optional buckets omitted) or
 * null when required buckets are missing/invalid — callers drop the row
 * fail-closed instead of feeding a schema-rejecting value into an atomic
 * mutate.
 */
export function sanitizePriceRow(row) {
  if (!isRowMap(row)) return null
  const out = {}
  for (const bucket of REQUIRED_BUCKETS) {
    const num = sanitizeBucket(row[bucket])
    if (num === null) return null
    out[bucket] = num
  }
  for (const bucket of OPTIONAL_BUCKETS) {
    const num = sanitizeBucket(row[bucket])
    if (num !== null) out[bucket] = num
  }
  return out
}

/**
 * Per-row editing-state error message (Chinese, matching the settings-page
 * voice) or null when the row is savable. Purely advisory: the save boundary
 * enforces the same rule by dropping, and persisted-but-dirty rows (hand-edited
 * settings.yaml) stay visible here instead of vanishing — what the user
 * configured must never silently disappear from the editor.
 */
export function validatePriceRow(row) {
  if (!isRowMap(row)) return '行数据不合法'
  for (const bucket of REQUIRED_BUCKETS) {
    const raw = row[bucket]
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      return `「${bucket}」为必填单价`
    }
    if (sanitizeBucket(raw) === null) return `「${bucket}」须为非负数字`
  }
  for (const bucket of OPTIONAL_BUCKETS) {
    const raw = row[bucket]
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) continue
    if (sanitizeBucket(raw) === null) return `「${bucket}」须为非负数字或留空`
  }
  return null
}

/** Key input live hint (create-row guard), mirroring the roles-editor pattern. */
export function priceKeyHint(key) {
  const trimmed = typeof key === 'string' ? key.trim() : ''
  if (trimmed === '') return null
  if (!PRICE_KEY_PATTERN.test(trimmed)) return '键格式：provider/model（第一个 / 切分，model 可含 /），两段都不能为空'
  return null
}

/** Add an empty editable row under `key`; bad keys and duplicates are no-ops. */
export function addPriceRow(rows, key) {
  const trimmed = typeof key === 'string' ? key.trim() : ''
  if (!PRICE_KEY_PATTERN.test(trimmed)) return isRowMap(rows) ? rows : {}
  if (isRowMap(rows) && trimmed in rows) return rows
  return { ...(isRowMap(rows) ? rows : {}), [trimmed]: {} }
}

/** Remove the row under `key`; unknown keys return the table unchanged. */
export function removePriceRow(rows, key) {
  const table = isRowMap(rows) ? { ...rows } : {}
  delete table[key]
  return table
}

/**
 * Patch one bucket of one row. Mid-state friendly: the row is kept as-is
 * (never normalized) so half-typed numbers survive re-renders; empty input
 * deletes the bucket so optional buckets can return to "unpriced".
 */
export function updatePriceRow(rows, key, bucket, value) {
  const table = isRowMap(rows) ? { ...rows } : {}
  const row = isRowMap(table[key]) ? { ...table[key] } : {}
  if (value === '' || value === undefined || value === null) delete row[bucket]
  else row[bucket] = value
  table[key] = row
  return table
}
