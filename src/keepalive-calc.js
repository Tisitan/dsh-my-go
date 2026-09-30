/**
 * dsh-my-go — keep-alive quick-calc math.
 *
 * The third block of the configuration card carries a tiny calculator that helps
 * the user pick the heartbeat interval and understand what a cache hit is worth.
 * It is **pure UI**: nothing here is persisted, nothing enters the draft or the
 * schema — the only value that leaves this section is the interval the user
 * explicitly clicks into the real `orchestratorIntervalMs` field (through the
 * existing setKeepAlive path).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/client.js) and the node --test suite (imported directly) — keep this
 * module free of react and @deepseek-ai/* imports (preset/shared/constants is
 * plain ESM constants, safe for both consumers).
 *
 * Two formulas, both with the coefficients in preset/shared/constants.mjs
 * (KEEP_ALIVE_CALC — single source, never re-typed in the render layer):
 *   1. 拍距 = TTL × 5/6             — wake before the prompt cache expires.
 *   2. H = (输入价 ÷ 缓存命中价 − 1) × 拍距 — the look-ahead window: once the
 *      orchestrator has pinged a child for its remaining work, a remainder
 *      **above** H means the cache is already cold by the time the child
 *      answers (not worth waiting), below H means it is still worth another beat.
 *
 * Degradation discipline (mid-state input is normal, the box must not fight the
 * user): every parser returns `null` instead of NaN/Infinity, and every consumer
 * renders a "not yet computable" line rather than a bogus number. An empty price
 * box, a zero cache price (division by zero) and a negative/garbage value all
 * land on the same `null` — the calculator never throws.
 */

import { KEEP_ALIVE_CALC } from '../preset/shared/constants.mjs'

/**
 * Parse one user-typed number for the calculator: the empty string, non-numeric
 * text, NaN/Infinity and negative values all mean "no usable value yet" (null).
 * Deliberately permissive about partial input ("3." is 3) — same edit-loose
 * posture as the price rows: reject at compute time, never at keystroke time.
 * @param raw string | number | null | undefined
 * @returns non-negative finite number, or null when not computable
 */
export function parseCalcNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Formula 1: 建议拍距 = TTL(秒) × intervalRatio，单位毫秒（正式字段的量纲）。
 * TTL 必须为正：0 或非法一律 null（不做 0 秒拍距那种会把主编打进忙循环的取值）。
 * @param ttlSeconds string | number（用户手填原值）
 * @returns 毫秒整数，或 null（不可算）
 */
export function intervalMsFromTtl(ttlSeconds) {
  const ttl = parseCalcNumber(ttlSeconds)
  if (ttl === null || ttl <= 0) return null
  return Math.round(ttl * 1000 * KEEP_ALIVE_CALC.intervalRatio)
}

/**
 * Formula 2: 前瞻窗口 H = (输入价 ÷ 缓存命中价 − 1) × 拍距。
 * 任一项不可算（价格空/非法、拍距不可算）或缓存命中价为 0（除零）→ null。
 * 比价 ≤ 1（缓存命中价 ≥ 输入价，没有省头）→ 夹到 0：H=0 的读法是「剩余量
 * 只要 >0 就该暂停心跳」，与公式同义，且不会把负数端上界面。
 * @returns 毫秒整数（≥0），或 null（不可算）
 */
export function lookaheadMs(inputPrice, cachePrice, intervalMs) {
  const input = parseCalcNumber(inputPrice)
  const cache = parseCalcNumber(cachePrice)
  const interval = parseCalcNumber(intervalMs)
  if (input === null || cache === null || interval === null) return null
  if (cache <= 0) return null
  return Math.max(0, Math.round((input / cache - 1) * interval))
}

/**
 * Human-readable duration (same ladder the keepAlive annotation strip has always
 * used: 秒 / 分钟 / 小时 — this is now the single implementation of it, extracted
 * from keepAliveDetailText so the calculator and the strip cannot drift).
 *
 * **与 broker 侧那一枚 `formatDuration` 不是同一个东西，别合并**：
 * broker-heartbeat.mjs 的 `formatDuration` 服务的是**进主编上下文的摘要**——量纲
 * 必须压成 45s / 12m / 2h05m 这类紧凑记法（每拍都要出现的字，省一个字节是一个）；
 * 这一枚服务的是**配置卡里给人读的说明文字**，要的是「4.2 分钟 / 7.5 小时」这种
 * 一眼对上直觉的写法。两者输入相同、输出刻意不同：合并任一侧都是错。
 * @param ms number（非法/负值按 0 处理，绝不抛）
 */
export function formatDurationHuman(ms) {
  const total = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0
  const seconds = Math.round(total / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = seconds / 60
  if (minutes < 60) return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} 分钟`
  return `${(minutes / 60).toFixed(1)} 小时`
}
