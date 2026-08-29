/**
 * dsh-my-go — tool mask dual-list state transitions (settings page editor).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module dependency-free (no react, no @deepseek-ai/*).
 *
 * The deny list is `string[]` of tool names persisted at settings key
 * `toolMask.deny`. `roster` is the current registry snapshot fetched via the
 * host `listTools` RPC (reserved transports like run_code already filtered
 * server-side); it is presentation-only — a deny entry missing from the
 * roster stays in the list (marked "未连接") so an MCP tool blocked while
 * disconnected is re-masked as soon as it reconnects. All functions are
 * pure: inputs are never mutated.
 */

/** Normalize any persisted value into a clean deny array (dirty entries dropped). */
export function normalizeDenyList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') continue
    if (seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out
}

/** Add `name` to the deny list; empty names and duplicates are no-ops. */
export function blockTool(deny, name) {
  const next = normalizeDenyList(deny)
  if (typeof name !== 'string' || name === '' || next.includes(name)) return next
  return [...next, name]
}

/** Remove `name` from the deny list; unknown names return the list unchanged. */
export function unblockTool(deny, name) {
  return normalizeDenyList(deny).filter((entry) => entry !== name)
}

/**
 * Left column of the editor: roster entries minus denied, filtered by a
 * case-insensitive substring `filter`. `roster` may contain anything; only
 * non-empty strings that are not denied survive.
 */
export function availableTools(roster, deny, filter) {
  const blocked = new Set(normalizeDenyList(deny))
  const needle = typeof filter === 'string' ? filter.trim().toLowerCase() : ''
  const seen = new Set()
  const out = []
  for (const name of Array.isArray(roster) ? roster : []) {
    if (typeof name !== 'string' || name === '' || blocked.has(name) || seen.has(name)) continue
    if (needle !== '' && !name.toLowerCase().includes(needle)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * Right column of the editor: deny entries as `{ name, connected }` —
 * `connected` is false (「未连接」badge) when the name is absent from the
 * current roster snapshot.
 */
export function denyEntries(deny, roster) {
  const known = new Set((Array.isArray(roster) ? roster : []).filter((n) => typeof n === 'string'))
  return normalizeDenyList(deny).map((name) => ({ name, connected: known.has(name) }))
}
