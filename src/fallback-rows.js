/**
 * dsh-my-go — fallback chain row state transitions (settings page editor).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module dependency-free (no react, no @deepseek-ai/*).
 *
 * A row is `{ provider: string, model: string }`; array order IS the
 * fallback priority: index 0 is attempted first (attempt 1), right after
 * the primary binding (attempt 0). All functions are pure: the input array
 * is never mutated, a new array is returned.
 */

/** Normalize any persisted value into a clean row array (dirty entries dropped). */
export function normalizeFallbackRows(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      provider: typeof r.provider === 'string' ? r.provider : '',
      model: typeof r.model === 'string' ? r.model : '',
    }))
}

/** Append one empty row at the end of the chain (lowest priority). */
export function addFallbackRow(rows) {
  return [...normalizeFallbackRows(rows), { provider: '', model: '' }]
}

/** Remove the row at `index`; out-of-range index returns the normalized rows unchanged. */
export function removeFallbackRow(rows, index) {
  const next = normalizeFallbackRows(rows)
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next
  return next.filter((_, i) => i !== index)
}

/** Swap the row at `index` with its neighbor at `index + delta`; clamped moves are no-ops. */
export function moveFallbackRow(rows, index, delta) {
  const next = normalizeFallbackRows(rows)
  if (!Number.isInteger(index) || !Number.isInteger(delta)) return next
  const target = index + delta
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  const out = [...next]
  const [row] = out.splice(index, 1)
  out.splice(target, 0, row)
  return out
}

/**
 * Update one field of the row at `index`. Changing `provider` resets that
 * row's `model` (same semantics as the primary binding: avoid dangling
 * model names that no longer exist on the new provider).
 */
export function updateFallbackRow(rows, index, field, value) {
  const next = normalizeFallbackRows(rows)
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next
  if (field !== 'provider' && field !== 'model') return next
  const v = typeof value === 'string' ? value : ''
  return next.map((row, i) => {
    if (i !== index) return row
    if (field === 'provider') return { provider: v, model: '' }
    return { ...row, model: v }
  })
}
