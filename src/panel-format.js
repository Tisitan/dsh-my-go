/**
 * dsh-my-go — tree panel display formatting helpers.
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module dependency-free (no react, no @deepseek-ai/*).
 */

/** First `len` chars of an identifier, '' for empty input (display chip text). */
export function shortId(id, len = 8) {
  return String(id ?? '').slice(0, Math.max(1, len))
}

/** Collapse all whitespace runs to single spaces and trim (conclusion one-liner). */
export function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Relative time in Chinese for a millisecond epoch timestamp.
 * Returns null for missing/invalid timestamps so the caller can hide the
 * element instead of showing a bogus label. Future timestamps (clock skew)
 * read as 刚刚. Beyond 30 days falls back to an absolute YYYY-MM-DD date.
 */
export function formatRelativeTime(ts, now = Date.now()) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return null
  const n = Number(now)
  if (!Number.isFinite(n)) return null
  let diff = Math.floor((n - t) / 1000)
  if (diff < 0) diff = 0
  if (diff < 10) return '刚刚'
  if (diff < 60) return `${diff} 秒前`
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const d = new Date(t)
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Extract the fallback redispatch marker written by the broker when a failed
 * run is re-queued on its fallback chain ("[备选 n/m] 失败 → 自动切换备选 …").
 * Returns `{ note, text }`: `note` is the normalized marker label
 * ("备选 n/m") or null when absent; `text` is the conclusion with the first
 * marker removed, whitespace-collapsed — suitable for one-line display.
 */
export function extractFallbackNote(conclusion) {
  const raw = String(conclusion ?? '')
  const m = raw.match(/\[备选\s*(\d+)\s*\/\s*(\d+)\]/)
  if (!m) return { note: null, text: oneLine(raw) }
  return {
    note: `备选 ${m[1]}/${m[2]}`,
    text: oneLine(raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length)),
  }
}
