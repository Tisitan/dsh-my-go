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

import {
  PRICE_KEY_PATTERN,
  PRICE_BUCKETS,
  PRICE_REQUIRED_BUCKETS as REQUIRED_BUCKETS,
  PRICE_OPTIONAL_BUCKETS as OPTIONAL_BUCKETS,
} from '../preset/shared/constants.mjs'

// 桶常量单源在 preset/shared/constants.mjs，此处仅保持既有导出面（消费者与
// 对拍测试经本模块引用同一数组实例）。
export { PRICE_KEY_PATTERN, PRICE_BUCKETS, REQUIRED_BUCKETS, OPTIONAL_BUCKETS }

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

