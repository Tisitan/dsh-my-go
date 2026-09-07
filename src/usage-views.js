/**
 * dsh-my-go — usage panel view derivations (contract D4/D5, usage-stats
 * design doc §5 panel seam).
 *
 * Pure functions shared by the client bundle (inlined by esbuild via
 * src/panel-tree.js → usage-panel.js) and the node --test suite (imported
 * directly) — keep this module dependency-free (no react, no @deepseek-ai/*),
 * same split as panel-format.js / usage-price-rows.js.
 *
 * Everything derives from ONE getUsage response (D4): byModel rows carry the
 * server-side price join, children rows carry none — the price index below is
 * rebuilt from byModel so per-child segment costs use exactly the same
 * priced/unpriced verdict the models view shows (one source of truth, no
 * client-side re-matching against settings, which the client cannot even see).
 */

// Three views over the same response (D4); `key` is the tab state value.
export const USAGE_TABS = [
  { key: 'models', label: '按模型' },
  { key: 'children', label: '按子代' },
  { key: 'totals', label: '合计' },
]

// Four consumed buckets (D1: totalTokens/reasoningTokens deliberately not
// consumed) in fixed column order; `label` is the narrow panel header text.
export const BUCKET_COLUMNS = [
  { bucket: 'inputTokens', label: '入' },
  { bucket: 'outputTokens', label: '出' },
  { bucket: 'cacheReadTokens', label: '读' },
  { bucket: 'cacheWriteTokens', label: '写' },
]

// Bucket → PriceInfo key. TokenUsage names and price-bucket names differ by
// design (dsh-llm types vs settings schema), so the pairing is written once.
const COST_TERMS = [
  ['inputTokens', 'input'],
  ['outputTokens', 'output'],
  ['cacheReadTokens', 'cacheRead'],
  ['cacheWriteTokens', 'cacheWrite'],
]

export const priceKey = (provider, model) => `${provider}/${model}`

/**
 * `{ "{provider}/{model}": PriceInfo }` rebuilt from byModel rows. Rows with
 * a null side or null price (unmatched/unpriced, Z3/Z5) are skipped, so a
 * missing key means exactly "this segment shows no cost", same as the models
 * view's price=null row.
 */
export function priceIndexFrom(byModel) {
  const index = {}
  if (!Array.isArray(byModel)) return index
  for (const row of byModel) {
    if (!row || typeof row !== 'object') continue
    const { provider, model, price } = row
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') continue
    if (!price || typeof price !== 'object') continue
    index[priceKey(provider, model)] = price
  }
  return index
}

/**
 * D4 cost rule (the render layer is the only billing point): sum priced AND
 * known buckets only. Known tokens under an unpriced bucket make the figure a
 * lower bound (partial, Z4); null tokens never fabricate money — their
 * incompleteness arrives separately as the row's own usage `partial` flag
 * (Z1). Returns null when unpriced → caller shows '—' (Z3).
 */
export function computeCost(buckets, price) {
  if (!price || typeof price !== 'object') return null
  let value = 0
  let partial = false
  for (const [bucket, priceBucket] of COST_TERMS) {
    const tokens = buckets?.[bucket]
    if (typeof tokens !== 'number' || !Number.isFinite(tokens)) continue
    const unit = price[priceBucket]
    if (typeof unit === 'number' && Number.isFinite(unit)) value += (tokens / 1_000_000) * unit
    else if (tokens > 0) partial = true
  }
  return { value, partial }
}

/** Sum several cost figures, OR-ing partial; null only when all inputs are null. */
export function combineCosts(costs) {
  let value = 0
  let partial = false
  let seen = false
  if (!Array.isArray(costs)) return null
  for (const cost of costs) {
    if (!cost) continue
    seen = true
    value += cost.value
    if (cost.partial) partial = true
  }
  return seen ? { value, partial } : null
}

/**
 * One child's cost = sum over its segments, each priced through the byModel
 * index. A child priced only partially contributes only its priced segments —
 * which is exactly the D4 lower-bound semantics once `partial` is OR-ed in by
 * the caller.
 */
export function computeChildCost(child, priceIndex) {
  const segments = Array.isArray(child?.segments) ? child.segments : []
  return combineCosts(segments.map((segment) => (
    computeCost(segment?.buckets, priceIndex[priceKey(segment?.provider, segment?.model)])
  )))
}

/** Global cost = sum over byModel rows (they cover every segment of every child). */
export function computeTotalCost(report) {
  const byModel = Array.isArray(report?.byModel) ? report.byModel : []
  return combineCosts(byModel.map((row) => computeCost(row?.buckets, row?.price)))
}

/** Hide-the-cost-column verdict: no priced row anywhere → token-only panel (D5 Z3/Z13). */
export function hasAnyPrice(byModel) {
  return Array.isArray(byModel) && byModel.some((row) => !!row?.price)
}

/** Row label for a segment/byModel pair; unknown sinks stay honest (Z5). */
export function modelDisplayKey(provider, model) {
  if ((provider === null || provider === undefined) && (model === null || model === undefined)) return '未知模型'
  return `${provider ?? '?'}/${model ?? '?'}`
}

/**
 * Compact token figure for the 320px panel: 980 → '980', 12345 → '12.3k',
 * 1234567 → '1.2M'. Compactness rounds — the exact figure belongs in the
 * cell's title tooltip, not on the grid.
 */
export function formatCompactTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const round1 = (v) => {
    const s = (Math.round(v * 10) / 10).toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (n >= 1_000_000) return `${round1(n / 1_000_000)}M`
  if (n >= 10_000) return `${round1(n / 1_000)}k`
  return String(n)
}

/** Exact figure for tooltips (thousands separators), null for absent values. */
export function formatFullTokens(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : null
}

/**
 * One token cell: null → '—' (unreported, never a fabricated 0, §4); a
 * partial row prefixes every known figure with '≥' (null-contagion display).
 */
export function formatBucketCell(tokens, partial) {
  const text = formatCompactTokens(tokens)
  if (text === null) return '—'
  return partial ? `≥${text}` : text
}

/** Currency symbol for cost figures (D1a global currency); anything but the
 *  known CNY token falls back to USD — an unknown currency must never render
 *  a bare unqualified figure. */
export function currencySymbol(currency) {
  return currency === 'CNY' ? '¥' : '$'
}

/** D4 display format: '$0.1234' ('¥…' when the report says CNY, D1a), '≥'
 *  prefix when the figure is a lower bound. */
export function formatCost(cost, currency = 'USD') {
  if (!cost) return null
  return `${cost.partial ? '≥' : ''}${currencySymbol(currency)}${cost.value.toFixed(4)}`
}

/**
 * Which parent session the usage poll should query this round: the currently
 * open session when identifiable; otherwise — and only when the orchestration
 * snapshot holds exactly one real parent — that parent's own id (the auto-jump
 * single-parent degenerate gate, panel-tree.js precedent). The 'legacy' ghost
 * bucket (ledger v1 compat) is not a real orchestration and is never borrowed.
 * Null means unattributable (0 or ≥2 real parents): showing another
 * orchestration's usage would be worse than showing none.
 */
export function usageSessionTarget(currentPid, parents) {
  if (typeof currentPid === 'string' && currentPid !== '') return currentPid
  const values = parents && typeof parents === 'object' ? Object.values(parents) : []
  const real = values.filter((p) => p && typeof p.parentSessionId === 'string' && p.parentSessionId !== '' && p.parentSessionId !== 'legacy')
  return real.length === 1 ? real[0].parentSessionId : null
}

/**
 * Session-list arrival phase ('pending' | 'ready', host SessionListPhase),
 * read defensively: null when the service is absent or its shape drifted.
 * Drives the usage section's empty-state split — a still-loading list is not
 * an identification failure.
 */
export function sessionsListPhase(sessions) {
  try {
    const list = sessions?.list
    if (list && typeof list.getSnapshot === 'function') {
      const phase = list.getSnapshot()?.phase
      return phase === 'pending' || phase === 'ready' ? phase : null
    }
  } catch { /* store shape drift */ }
  return null
}

/**
 * Which empty/degraded message the section shows (D5/Z8/Z17), or null when
 * there is a live report to render. `kind` splits plain empties (body text)
 * from errors (banner with a retry note) so the component stays dumb.
 */
export function usageEmptyState(usage) {
  const loading = { kind: 'plain', message: '正在读取用量…' }
  if (!usage || typeof usage !== 'object') return loading
  if (usage.state === 'loading' || usage.state === 'idle') return loading
  if (usage.state === 'session-pending') return { kind: 'plain', message: '会话列表加载中…' }
  if (usage.state === 'no-session') return { kind: 'plain', message: '无法确定当前会话，打开一个会话后这里显示其编排用量' }
  if (usage.state === 'error') {
    const detail = usage.detail ? `：${usage.detail}` : ''
    return { kind: 'error', message: `用量数据读取失败${detail}`, hint: '将随面板轮询按退避节奏自动重试' }
  }
  const report = usage.report
  if (!report || typeof report !== 'object') return loading
  if (report.found === false) return { kind: 'plain', message: '当前会话无编排记录' }
  if (!Array.isArray(report.children) || report.children.length === 0) return { kind: 'plain', message: '本会话暂无用量' }
  return null
}

/** Global partial = OR over children (falls back to byModel), drives '≥' on totals. */
export function globalPartial(report) {
  const children = Array.isArray(report?.children) ? report.children : []
  if (children.some((c) => c?.partial === true)) return true
  const byModel = Array.isArray(report?.byModel) ? report.byModel : []
  return byModel.some((row) => row?.partial === true)
}

/** Message totals across children; counts are facts, 0 is real (§4). */
export function sumMessageCount(report) {
  const children = Array.isArray(report?.children) ? report.children : []
  return children.reduce((sum, c) => sum + (typeof c?.messageCount === 'number' ? c.messageCount : 0), 0)
}

/** Child rows only — the parent-self row (isSelf, parent-usage contract D6)
 *  is usage on the books, not a child; drives the totals footer count. */
export function childRowCount(report) {
  const children = Array.isArray(report?.children) ? report.children : []
  return children.filter((c) => c && c.isSelf !== true).length
}
