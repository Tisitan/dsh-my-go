/**
 * dsh-my-go — model priority chain row state transitions (settings page editor).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module dependency-free (no react, no @deepseek-ai/*).
 *
 * The priority chain (tisitan.19) merges the former primary binding selects
 * and the fallback chain list into ONE editor: a chain is
 * `[{ provider: string, model: string }...]` where #1 IS the primary binding
 * (attempt 0) and #2..N are the fallback chain in order. Storage shape is
 * unchanged — `composeChain` projects `{ provider, model, fallbacks }` into
 * the chain view for rendering, `decomposeChain` splits the chain view back
 * for writing into the draft. The chain always keeps at least one entry: #1
 * is the primary slot (empty values = follow Sisyphus, a valid persisted
 * state), so deleting the last remaining entry is refused — unlike the old
 * fallback-only list, which could legitimately be emptied (empty = feature
 * off). All functions are pure: inputs are never mutated, new
 * arrays/objects are returned.
 */

/** Normalize any persisted value into a clean row array (dirty entries dropped). */
export function normalizeChainRows(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      provider: typeof r.provider === 'string' ? r.provider : '',
      model: typeof r.model === 'string' ? r.model : '',
    }))
}

/**
 * Project the stored shape `{ provider, model, fallbacks }` into the editor
 * chain: primary binding first, then the normalized fallback rows. Dirty
 * input degrades to a single empty primary row (all-follow-Sisyphus).
 */
export function composeChain(row) {
  const r = row && typeof row === 'object' ? row : {}
  return [
    {
      provider: typeof r.provider === 'string' ? r.provider : '',
      model: typeof r.model === 'string' ? r.model : '',
    },
    ...normalizeChainRows(r.fallbacks),
  ]
}

/**
 * Split the editor chain back into the stored shape: #1 → provider/model,
 * #2..N → fallbacks. An empty chain yields the canonical all-empty shape
 * (`{ provider: '', model: '', fallbacks: [] }`); the UI never produces one
 * (removeChainEntry refuses to empty the chain).
 */
export function decomposeChain(chain) {
  const rows = normalizeChainRows(chain)
  const [primary, ...rest] = rows
  return {
    provider: primary?.provider ?? '',
    model: primary?.model ?? '',
    fallbacks: rest,
  }
}

/**
 * Save-boundary normalization (tisitan.20 D1): drop fallback entries whose
 * provider AND model are both empty. A fully-empty fallback has zero runtime
 * semantics — the host pickFallbackEntry warns and skips it, while attempt/
 * total counters still count it — so half-filled placeholder rows never
 * persist. Deliberately NOT folded into decomposeChain: the editor chain
 * must round-trip losslessly through compose/decompose (an added empty row
 * vanishing on the next keystroke would break the editing flow); callers
 * apply this right before persisting. Non-object inputs return unchanged.
 */
export function stripEmptyFallbackRows(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return shape
  if (!Array.isArray(shape.fallbacks)) return shape
  const kept = shape.fallbacks.filter((e) => {
    if (!e || typeof e !== 'object') return false
    const provider = typeof e.provider === 'string' ? e.provider : ''
    const model = typeof e.model === 'string' ? e.model : ''
    return provider !== '' || model !== ''
  })
  if (kept.length === shape.fallbacks.length) return shape
  return { ...shape, fallbacks: kept }
}

/** Append one entry at the end of the chain (lowest priority); non-object entries become an empty row. */
export function addChainEntry(chain, entry) {
  const e = entry && typeof entry === 'object' ? entry : {}
  return [
    ...normalizeChainRows(chain),
    {
      provider: typeof e.provider === 'string' ? e.provider : '',
      model: typeof e.model === 'string' ? e.model : '',
    },
  ]
}

/**
 * Remove the entry at `index`; removing #1 promotes #2 into the primary
 * slot. The chain keeps at least one entry (the primary slot always
 * exists), so removing the last remaining entry is refused; out-of-range
 * index returns the normalized chain unchanged.
 */
export function removeChainEntry(chain, index) {
  const next = normalizeChainRows(chain)
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next
  if (next.length <= 1) return next
  return next.filter((_, i) => i !== index)
}

/** Swap the entry at `index` with its neighbor at `index + dir`; clamped moves are no-ops. */
export function moveChainEntry(chain, index, dir) {
  const next = normalizeChainRows(chain)
  if (!Number.isInteger(index) || !Number.isInteger(dir)) return next
  const target = index + dir
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  const out = [...next]
  const [row] = out.splice(index, 1)
  out.splice(target, 0, row)
  return out
}

/**
 * Update one field of the entry at `index`. Changing `provider` resets that
 * entry's `model` (same semantics as the primary binding: avoid dangling
 * model names that no longer exist on the new provider).
 */
export function updateChainEntry(chain, index, field, value) {
  const next = normalizeChainRows(chain)
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next
  if (field !== 'provider' && field !== 'model') return next
  const v = typeof value === 'string' ? value : ''
  return next.map((row, i) => {
    if (i !== index) return row
    if (field === 'provider') return { provider: v, model: '' }
    return { ...row, model: v }
  })
}
