/**
 * dsh-my-go — usage aggregation engine (usage-stats contract step 4/7,
 * docs/usage-stats-design.md).
 *
 * Ledger-driven (F6) aggregate of per-parent token usage across child
 * sessions. Everything is on-demand: getUsage(parentSessionId) walks each
 * child's event stream through a per-child cursor cache (D2) — live store
 * first (ctx.get('sessions') + Session.snapshotEvents(fromSeq), F4), the
 * persisted zstd archive as main path once the live store removed the child
 * (invariant: at end time the live store is already gone,
 * so live absence is expected, not an error).
 *
 * The parent session's own stream rides the same machinery through a
 * dedicated per-bucket `self` slot (D6, parent-usage contract): no ledger
 * row, no enumeration, scanned every unfrozen round — its usage joins
 * byModel/totals and surfaces as a synthetic isSelf row ahead of the
 * children (injected only when the stream actually holds assistant usage).
 *
 * Why a module instead of a lib/index.js closure (§5): the cache + reducer +
 * R1-R7 rules are pure dependency-injected state, unit-testable without a
 * host; lib/index.js only wires real services into it. The Symbol.for
 * snapshot bridge is deliberately not consulted — the lib-only degraded
 * deployment (no broker half) must aggregate just the same.
 *
 * Prices never enter the cache (R6): token facts and money stay decoupled,
 * so a price edit never invalidates aggregated state. The LRU keeps the four
 * most recently polled parents (R2); a terminal child freezes after one full
 * scan (R3) and unfreezes when it comes back resident (R4 — revival is a new
 * generation, F7, so frozen must be reversible or revived usage would be
 * silently lost).
 */

import { readFile } from 'node:fs/promises'

import { sessionEvents } from '../preset/shared/adjacent.mjs'
import { readArchivedUsage } from '../preset/shared/archive.mjs'
import { mygoHome } from '../preset/shared/paths.mjs'
import { HISTORY_CAP, LEDGER_PARENTS_CAP, PRICE_OPTIONAL_BUCKETS } from '../preset/shared/constants.mjs'

// v1 consumes exactly these four buckets (D1): totalTokens is a derived
// redundant field whose own spec allows it to disagree with the buckets, and
// reasoningTokens has no disjointness promise — consuming either would
// double-count. Field name mirrors TokenUsage (dsh-llm types.d.ts:123-133).
const BUCKET_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

// R2: 30+ children × hundreds of frames stays bounded when only the four
// most recently polled parents keep caches; the panel polls one parent at a
// time, so four slots absorb tab switches without rescans (R1).
const PARENT_CACHE_CAP = 4

const UNKNOWN_KEY = Object.freeze({ provider: null, model: null })
const EMPTY_BUCKETS = () => ({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })

const isTerminalStatus = (status) => status === 'done' || status === 'failed'
const keyPart = (value) => (typeof value === 'string' && value !== '' ? value : null)

// Numbers only, finite, non-negative: anything else (missing bucket, NaN /
// Infinity smuggled through a hand-edited log, negative garbage) is treated
// as "not reported" → null → partial, never a fabricated 0 (Z1/D3).
function normalizeLlmNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

const defaultLedgerPath = () => mygoHome('orchestration-ledger.json')

/**
 * @param deps.getSessions       () => live session store (Map-like `get`), or undefined
 * @param deps.getSubagents      () => subagents runtime exposing listChildren, or undefined
 * @param deps.listRunningChildren () => [{ childId, agentType }] — broker-memory
 *        supplement (childOwner/sessionTypes shape, F6). Unreachable from the
 *        lib half, so the real wiring omits it; kept as an injection point so
 *        hosts that can reach broker memory (and tests) can supply it.
 * @param deps.loadLedger        async () => parsed ledger file, or undefined (default: DSH_HOME path)
 * @param deps.ledgerPath        explicit ledger file path for the default loader
 * @param deps.getUsagePrices    () => usagePrices dict (settings join, R6), or undefined
 * @param deps.getUsageCurrency  () => 'USD'|'CNY' global price-table currency (D1a, R6), or undefined
 * @param deps.readArchive       (childId, fromSeq) => { events, complete } (default: shared zstd reader)
 * @param deps.archiveRoot / deps.archiveCwd  root/cwd for the default archive reader
 * @param deps.now               () => number clock (touchedAt + generatedAt)
 */
export function createUsageAggregator(deps = {}) {
  const now = () => (typeof deps.now === 'function' ? deps.now() : Date.now())
  const parents = new Map() // parentId → { touchedAt, children: Map<childId, ChildCache>, self: ChildCache }
  const warned = new Set() // once-per-key warnings: archive misses and bad price rows would otherwise spam every 600ms poll
  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    console.warn(`[dsh-my-go] usage-aggregator: ${message}`)
  }

  const loadLedger = deps.loadLedger ?? (async () => {
    try {
      return JSON.parse(await readFile(deps.ledgerPath ?? defaultLedgerPath(), 'utf-8'))
    } catch {
      return undefined // no/corrupt ledger: empty world, found:false (Z8)
    }
  })
  const readArchive = deps.readArchive ?? ((childId, fromSeq) => readArchivedUsage(childId, fromSeq, { root: deps.archiveRoot, cwd: deps.archiveCwd }))

  function touchBucket(parentId, ts) {
    let bucket = parents.get(parentId)
    if (!bucket) {
      bucket = { touchedAt: ts, children: new Map() }
      parents.set(parentId, bucket)
    }
    bucket.touchedAt = ts
    if (parents.size > PARENT_CACHE_CAP) {
      let oldestKey = null
      let oldestAt = Infinity
      for (const [key, entry] of parents) {
        if (entry.touchedAt < oldestAt) {
          oldestAt = entry.touchedAt
          oldestKey = key
        }
      }
      if (oldestKey !== null && oldestKey !== parentId) parents.delete(oldestKey)
    }
    return bucket
  }

  // ── enumeration (F6/F7): ledger bucket first (spawn-order authority for
  // finished children), then live enumerations for running newcomers the
  // ledger cannot know about yet. ──────────────────────────────────────────
  async function ledgerRowsFor(parentId) {
    let raw
    try {
      raw = await loadLedger()
    } catch {
      raw = undefined
    }
    const rawParents = raw && typeof raw === 'object' && (raw.version === 2 || raw.version === 3) && raw.parents && typeof raw.parents === 'object'
      ? raw.parents
      : undefined
    const bucket = rawParents?.[parentId]
    // 父桶整体淘汰的可见性（P23）：pruneLedgerParents 会把最旧的属主会话整桶删掉，
    // 被淘汰者的 ledgerRows 变成 [] 且不满足「>= HISTORY_CAP」，旧的 partial 判据
    // 于是谎报完整。这里把两件事实带出去给 getUsage 用：
    //   - parentsCount：台账当前父桶数（触顶 LEDGER_PARENTS_CAP ⇒ 已处于淘汰态）；
    //   - evictedHit：该 parentId 是否在淘汰痕迹里（broker 持久化的 evictedParents
    //     列表，或内存 pruned parents 上的不可枚举元数据）。
    const parentsCount = rawParents ? Object.keys(rawParents).length : 0
    const evictedHit = isEvictedParent(raw, rawParents, parentId)
    // ③ 粘滞裁剪标志（P22 收口）：台账**曾经**饱和/淘汰过就被永久记住（broker 随
    // payload 落盘）。痕迹表会溢出、旧台账迁移时痕迹为空、桶数还会因
    // session/disposed 从 200 掉到 199——只有这个标志能把「不可逆的漏算」钉住。
    const enumerationTruncated = isEnumerationTruncated(raw, rawParents)
    // 幸存桶白名单（v4 收口）：裁剪纪元那一刻已在场的父会话。名单外的在场桶可能
    // 是「被静默裁掉后又恢复重建」的旧会话——桶里只有重建后的新记录，旧子代历史
    // 早已不在台账里。已裁剪但缺名单的旧档同样按下界处理，直到第二源补全枚举。
    //
    // 「有没有名单」必须按**字段是否存在**判定，不能按 `length > 0`：空数组 `[]`
    // 表示没有可证明完整的桶（全部退场或旧档缺乏历史证据），此后任何在场桶都
    // 不在名单里，必须继续标下界；而完全没有该字段才是「无法判定」。
    const intact = intactParentsOfLedger(raw, rawParents)
    const intactKnown = intact.known
    const intactHit = intactKnown && intact.list.includes(parentId)
    if (!Array.isArray(bucket)) return { rows: [], exists: false, parentsCount, evictedHit, enumerationTruncated, intactKnown, intactHit }
    const rows = []
    const seen = new Set()
    for (const row of bucket) {
      if (!row || typeof row !== 'object' || typeof row.childId !== 'string' || seen.has(row.childId)) continue
      seen.add(row.childId)
      rows.push({
        childId: row.childId,
        agentType: typeof row.agentType === 'string' ? row.agentType : null, // Z9
        status: typeof row.status === 'string' ? row.status : null,
      })
    }
    return { rows, exists: true, parentsCount, evictedHit, enumerationTruncated, intactKnown, intactHit }
  }

  // 返回 { list, known }：known 只看**字段是否存在**（空数组也算已知），list 已过滤
  // 非字符串项；字段缺失时 known=false、list=[]（老档 / 未裁剪台账）。
  function intactParentsOfLedger(raw, rawParents) {
    const primary = raw?.intactParents
    const fallback = rawParents?.intactParents
    const listed = Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : undefined
    return { known: Array.isArray(listed), list: Array.isArray(listed) ? listed.filter((pid) => typeof pid === 'string') : [] }
  }

  function isEnumerationTruncated(raw, rawParents) {
    if (raw?.enumerationTruncated === true || rawParents?.enumerationTruncated === true) return true
    // 旧档缺标志时，已有淘汰记录也证明历史曾被裁剪。与 broker 加载口径一致，
    // 直接读档的 lib-only 路径不必等待一次迁移落盘才保守显示下界。
    const listed = raw?.evictedParents ?? rawParents?.evictedParents
    if (Array.isArray(listed)) return listed.some((pid) => typeof pid === 'string' && pid !== '')
    return Boolean(listed && typeof listed === 'object'
      && Object.entries(listed).some(([pid, evicted]) => pid !== '' && evicted === true))
  }

  // 淘汰痕迹读取：优先读台账顶层的 evictedParents（broker-ledger 持久化，
  // 跨重启有效），退回读 pruned parents 上的不可枚举元数据（调用方直接把
  // pruneLedgerParents 的返回值当台账喂进来时——例如隔离探针与部分测试）。
  function isEvictedParent(raw, rawParents, parentId) {
    const listed = raw?.evictedParents ?? rawParents?.evictedParents
    if (Array.isArray(listed)) return listed.includes(parentId)
    if (listed && typeof listed === 'object') return listed[parentId] === true
    return false
  }

  // 子代枚举的第二源（宿主 `subagents.listChildren` 的持久 subagentCatalog 投影）。
  // 返回 { rows, failed }：**failed 与「该会话真没子代」必须可分**（F6 降级标记的
  // 判据）。原实现两种失败都折成 []，于是「枚举不可用」与「枚举为空」在聚合器里
  // 长得一模一样——台账触顶 200 条时，报告会把「可能被裁掉的历史」当成完整数据。
  async function listedChildrenFor(parentId) {
    let subagents
    try {
      subagents = deps.getSubagents?.()
    } catch {
      return { rows: [], failed: true }
    }
    // 服务本身没接线（旧宿主 / lib-only 降级部署）：不是失败，是「这一源不存在」
    // ——是否算不完整由调用方按「台账是否触顶」判定（见 getUsage 的 partial 段）。
    if (typeof subagents?.listChildren !== 'function') return { rows: [], failed: false }
    try {
      const entries = await subagents.listChildren(parentId)
      // 形状漂移 = 这一源实际不可用（不是「没有子代」）
      if (!Array.isArray(entries)) return { rows: [], failed: true }
      const rows = []
      for (const entry of entries) {
        // 形状兼容（P23）：真实宿主 subagentCatalog 投影
        // （@deepseek-ai/dsh-subagent 0.1.7-alpha.2 的 lib/types/catalog.js）
        // 产出的行是 { id, createdAt, mode, label }，**没有 kind 字段**；旧判据
        // `entry.kind === 'child'` 在生产环境把第二源 100% 过滤成空，于是
        // 「枚举不可用」与「枚举为空」再次长得一样。kind 缺省即按 child 采纳；
        // 显式给了别的 kind（未来可能出现的非子代行）仍然跳过。id 必须是非空
        // 字符串（空串过不了后面的去重与台账对齐）。
        if (!entry || (entry.kind !== undefined && entry.kind !== 'child')) continue
        if (typeof entry.id !== 'string' || entry.id === '') continue
        rows.push({
          childId: entry.id,
          running: entry.activity === 'running',
          // MyGO children carry the agent type as their creation label (the
          // broker's cold-resume typeOfAgent falls back to the same label).
          agentType: typeof entry.label === 'string' && entry.label !== '' ? entry.label : null,
        })
      }
      return { rows, failed: false }
    } catch (error) {
      warnOnce(`listChildren:${parentId}`, `listChildren failed, running children unseen this round: ${String(error)}`)
      return { rows: [], failed: true }
    }
  }

  function runningExtras() {
    let rows
    try {
      rows = deps.listRunningChildren?.()
    } catch {
      return []
    }
    if (!Array.isArray(rows)) return []
    const out = []
    for (const row of rows) {
      if (!row || typeof row.childId !== 'string') continue
      out.push({ childId: row.childId, running: true, agentType: typeof row.agentType === 'string' && row.agentType !== '' ? row.agentType : null })
    }
    return out
  }

  // ── per-child cursor cache (D2) + event reducer (shared by live and
  // archive paths — one implementation so merge semantics cannot drift) ────
  function newCache() {
    return {
      lastSeq: -1, // highest consumed seq; -1 = nothing yet (seqs start at 0)
      frozen: false,
      frozenTerminal: false, // frozen via a ledger terminal row (R3) — drives the ledger-vanish unfreeze signal
      currentKey: { provider: null, model: null },
      segments: [],
      messageCount: 0,
      partial: false,
      retryFullScan: false,
    }
  }

  function childCacheFor(bucket, childId) {
    let cache = bucket.children.get(childId)
    if (!cache) {
      cache = newCache()
      bucket.children.set(childId, cache)
    }
    return cache
  }

  function segmentFor(cache, key) {
    let segment = cache.segments.find((s) => s.provider === key.provider && s.model === key.model)
    if (!segment) {
      segment = { provider: key.provider, model: key.model, messageCount: 0, buckets: EMPTY_BUCKETS(), partial: false }
      cache.segments.push(segment)
    }
    return segment
  }

  function addUsage(segment, usage) {
    for (const key of BUCKET_KEYS) {
      const value = normalizeLlmNumeric(usage[key])
      if (value === null) segment.partial = true // Z1: unreported bucket stays null, flags partial
      else segment.buckets[key] = (segment.buckets[key] ?? 0) + value
    }
  }

  function consumeEvents(cache, events) {
    let consumed = 0
    for (const ev of events) {
      const seq = ev?.seq
      if (typeof seq !== 'number' || !Number.isFinite(seq)) {
        // No numeric seq → cannot advance the cursor without risking a double
        // count on the next round; flag the child instead of guessing (Z6).
        cache.partial = true
        continue
      }
      if (seq <= cache.lastSeq) continue // cursor monotonicity: never re-consume (R7)
      if (ev.type === 'request/header') {
        // Actual event shape is data.header.config (EpochHeader wrapper;
        // precedent scripts/dump-session.mjs:36) — the contract's F3 names
        // the same LlmCallConfig through a shorter path. Absent fields stay
        // null → unknown segment (Z5); a repeated identical header is a no-op.
        const config = ev.data?.header?.config
        cache.currentKey = { provider: keyPart(config?.provider), model: keyPart(config?.model) }
      } else if (ev.type === 'assistant/message') {
        cache.messageCount += 1
        const usage = ev.data?.usage
        if (usage && typeof usage === 'object') {
          const segment = segmentFor(cache, cache.currentKey)
          segment.messageCount += 1
          addUsage(segment, usage)
        } else {
          // Z2: usage-less message counts toward the unknown segment only —
          // no bucket contribution, no partial (nothing was reported wrong).
          segmentFor(cache, UNKNOWN_KEY).messageCount += 1
        }
      }
      cache.lastSeq = seq
      consumed += 1
    }
    return consumed
  }

  function readLiveEvents(session, lastSeq) {
    // alpha.4 snapshotEvents takes an inclusive fromSeq (index.d.ts:184); the
    // legacy events getter has no cursor, so that path filters locally.
    if (typeof session?.snapshotEvents === 'function') {
      try {
        const events = session.snapshotEvents(lastSeq + 1)
        if (Array.isArray(events)) return events
      } catch {
        // closed/bad live store: fall through to the legacy getter, then to
        // the archive main path via live-miss
      }
    }
    return sessionEvents(session).filter((ev) => typeof ev?.seq === 'number' && Number.isFinite(ev.seq) && ev.seq > lastSeq)
  }

  function unfreezeIfNeeded(cache, info, sessions) {
    if (!cache.frozen) return
    let session
    try {
      session = sessions?.get?.(info.childId)
    } catch {
      session = undefined
    }
    // R4: frozen must melt when the child is active again — live residency is
    // the strongest signal (revival re-seats the session), the running flag
    // (listChildren/childOwner) arrives first, and a vanished terminal ledger
    // row means the record left history for currentMap.
    if (session || info.running || (cache.frozenTerminal && !info.ledgerRow)) cache.frozen = false
  }

  async function scanChild(cache, info, sessions) {
    if (cache.retryFullScan) Object.assign(cache, newCache())
    let complete = true
    let session
    try {
      session = sessions?.get?.(info.childId)
    } catch {
      session = undefined
    }
    if (session) {
      // Live hit: the live store is the current projection of the log; the
      // archive may lag behind it, so never mix both in one round.
      consumeEvents(cache, readLiveEvents(session, cache.lastSeq))
    } else {
      let scanned
      try {
        scanned = await readArchive(info.childId, cache.lastSeq + 1)
      } catch (error) {
        warnOnce(`archive:${info.childId}`, `archive read failed for ${info.childId}: ${String(error)}`)
        scanned = { events: [], complete: false }
      }
      complete = scanned?.complete === true
      if (!complete) {
        cache.retryFullScan = true
        cache.partial = true // Z6/Z7: bad frames / unreadable archive / torn tail
        warnOnce(`archive:${info.childId}`, `archive scan incomplete for ${info.childId}, child reported partial`)
      }
      const consumed = consumeEvents(cache, scanned?.events ?? [])
      // Idle-freeze: no live store + complete scan + nothing new + not
      // running ⇒ the stream cannot produce new events. Freezing keeps 600ms
      // polls zero-IO even when the terminal row was later capped out of the
      // ledger file (HISTORY_CAP); a revival re-melts it via R4.
      if (scanned?.complete && consumed === 0 && !info.running) {
        cache.frozen = true
        cache.frozenTerminal = Boolean(info.ledgerRow && isTerminalStatus(info.ledgerRow.status))
      }
    }
    // R3: ledger terminal row ⇒ this round's scan is the one full scan; from
    // now on the immutable archive is frozen and polls cost zero IO.
    if (complete && !session && !info.running && info.ledgerRow && isTerminalStatus(info.ledgerRow.status)) {
      cache.frozen = true
      cache.frozenTerminal = true
    }
  }

  // ── response assembly (D3/D4) ────────────────────────────────────────────
  // D1a: the price table is one global currency (mixed-currency totals are
  // meaningless), echoed into every response so the panel renders the right
  // symbol. Absent settings or an unknown value fall back to USD — the same
  // degraded form as Z13, never a bare unqualified figure.
  const currencyFor = () => (deps.getUsageCurrency?.() === 'CNY' ? 'CNY' : 'USD')

  function priceFor(provider, model) {
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return null
    let row
    try {
      row = deps.getUsagePrices?.()?.[`${provider}/${model}`]
    } catch {
      return null // Z13: settings service absent → pure token mode
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null // Z3: unmatched → '—'
    const input = normalizeLlmNumeric(row.input)
    const output = normalizeLlmNumeric(row.output)
    if (input === null || output === null) {
      warnOnce(`price:${provider}/${model}`, `usagePrices row "${provider}/${model}" has invalid required buckets, treated as unpriced`) // Z11
      return null
    }
    const price = { input, output }
    for (const key of PRICE_OPTIONAL_BUCKETS) {
      const value = normalizeLlmNumeric(row[key])
      if (value !== null) price[key] = value // absent/invalid optional bucket = unpriced, key omitted
    }
    return price
  }

  function childReport(childId, info, cache) {
    const segments = cache.segments.map((segment) => ({
      provider: segment.provider,
      model: segment.model,
      messageCount: segment.messageCount,
      buckets: { ...segment.buckets },
      partial: segment.partial,
    }))
    const totals = EMPTY_BUCKETS()
    let partial = cache.partial
    for (const segment of cache.segments) {
      for (const key of BUCKET_KEYS) {
        const value = segment.buckets[key]
        if (value !== null) totals[key] = (totals[key] ?? 0) + value
      }
      if (segment.partial) partial = true
    }
    return {
      childId,
      agentType: info.agentType,
      status: info.status,
      messageCount: cache.messageCount,
      segments,
      totals,
      partial,
      frozen: cache.frozen,
    }
  }

  function emptyReport(parentSessionId, generatedAt) {
    return {
      parentSessionId: typeof parentSessionId === 'string' ? parentSessionId : '',
      found: false,
      // Currency rides every response shape (D1a) — the panel reads it
      // unconditionally, and an empty report must not render unqualified.
      currency: currencyFor(),
      children: [],
      byModel: [],
      totals: EMPTY_BUCKETS(),
      // 空报告不主张「完整」也不主张「不完整」：没有输入可枚举（Z8 的退化形态），
      // 故与完整报告同形给 false，下游读到的是「没有下界证据」，不是「数据齐全」。
      partial: false,
      generatedAt,
    }
  }

  async function getUsage(parentSessionId) {
    const generatedAt = now()
    // Z8: empty/non-string input never throws — empty structure, cache untouched.
    if (typeof parentSessionId !== 'string' || parentSessionId === '') return emptyReport(parentSessionId, generatedAt)

    const bucket = touchBucket(parentSessionId, generatedAt)
    const sessions = (() => {
      try {
        return deps.getSessions?.()
      } catch {
        return undefined
      }
    })()
    const [{ rows: ledgerRows, exists: ledgerExists, parentsCount, evictedHit, enumerationTruncated, intactKnown, intactHit }, listedResult] = await Promise.all([ledgerRowsFor(parentSessionId), listedChildrenFor(parentSessionId)])
    const listed = listedResult.rows
    const running = runningExtras()
    // 枚举完整性（F6 降级下界，P2 修复）：报告上的 partial 只表达一件事——
    // 「本次聚合可能漏了子代」。两个来源任一出问题就算不完整：
    //   ① 宿主 listChildren 抛错 / 形状漂移（这一源不可用）；
    //   ② 台账已触顶 HISTORY_CAP（每父会话只留末 200 条）而 listChildren 没给出
    //      任何行——此时枚举只靠一张被裁过的表，更早的子代可能已被挤出。
    // 未被标记时下游 globalPartial / 合计行不会加「≥」，用户会把下界当完整值。
    //   ③ 父桶整体淘汰（P23）：pruneLedgerParents 触顶后整桶删掉最旧父会话，此时
    //      ledgerRows=[]（不满足 ② 的行数条件），缺失的历史没有任何痕迹。两枚判据：
    //      · 该 parentId 命中淘汰痕迹（持久化的 evictedParents，跨重启有效）；
    //      · 桶不存在但台账父桶数已触顶 LEDGER_PARENTS_CAP（处于淘汰态 ⇒ 无法证明
    //        这个 parentId 只是「真没子代」而不是「被整桶挤掉」，宁可标下界）；
    //      · 桶不存在且台账带**粘滞** enumerationTruncated 标志（P22 收口）：旧台账
    //        迁移后痕迹为空、痕迹表溢出后 victim 被挤掉、或桶数因 session/disposed
    //        从 200 掉到 199 —— 上面两条判据会同时失效，只有「曾饱和」这个持久事实
    //        还能证明「缺席 ≠ 没子代」。
    //      第二源在场也救不了：listChildren 只枚举**存活/持久 catalog** 里的子代，
    //      被整桶淘汰的父会话通常早已不在。
    //   ④ 父桶在场但历史有缺口（v4/v6 收口）：台账处于不可精确归因的裁剪态
    //      （`enumerationTruncated`）而该 parentId 无法被证明完整 ⇒ 这个桶可能是
    //      当年被静默裁掉、后来才恢复重建的旧父会话，桶里只有重建之后的新记录，
    //      旧子代历史永远回不来。只看「桶在不在」会把残缺合计当精确值报出去
    //      （recheck3 的 110 vs 1,000,110）。「无法被证明完整」的两种形态同权：
    //        · 有名单（`intactParents`）但不在名单里（`intactKnown && !intactHit`）；
    //        · 压根没有名单（`!intactKnown`）——先重建后升级的旧档，存量残缺桶
    //          与会话恢复重建的桶在形状上不可区分（v6）。这两种情况**不因该档
    //          是否先经过 `loadLedger`/`pruneLedgerParents`（会落成 `[]`）而改变。
    //      第二源能完整证明时例外：它按 catalog 枚举该父会话的子代，聚合会逐子代
    //      回读档案，漏算不再成立。但「给出部分名单」不算证明——必须覆盖台账里
    //      已知的每一个子代，否则等于用一份残缺 catalog 给残缺台账背书。
    const listedIds = new Set(listed.map((r) => r.childId))
    const secondSourceProves = listedResult.failed !== true
      && listed.length > 0
      && ledgerRows.every((r) => listedIds.has(r.childId))
    const enumerationIncomplete = listedResult.failed === true
      || (listed.length === 0 && ledgerRows.length >= HISTORY_CAP)
      || evictedHit === true
      || (ledgerExists === false && (parentsCount >= LEDGER_PARENTS_CAP || enumerationTruncated === true))
      || (ledgerExists === true && enumerationTruncated === true && (!intactKnown || !intactHit) && !secondSourceProves)

    // Merge enumeration sources; ledger order wins (contract: children in
    // ledger order), live sources append in their own order, dedup by childId.
    const order = []
    const infoByChild = new Map()
    const remember = (childId, fields) => {
      const existing = infoByChild.get(childId)
      if (existing) {
        if (fields.running) existing.running = true
        return
      }
      const info = { childId, agentType: null, status: null, ledgerRow: null, running: false, ...fields }
      infoByChild.set(childId, info)
      order.push(info)
    }
    for (const row of ledgerRows) {
      remember(row.childId, { agentType: row.agentType, status: row.status, ledgerRow: row })
    }
    for (const row of listed) {
      remember(row.childId, { agentType: row.agentType, status: row.running ? 'running' : null, running: row.running })
    }
    for (const row of running) {
      remember(row.childId, { agentType: row.agentType, status: 'running', running: true })
    }

    for (const info of order) {
      const cache = childCacheFor(bucket, info.childId)
      unfreezeIfNeeded(cache, info, sessions)
      if (!cache.frozen) await scanChild(cache, info, sessions)
    }

    // ── parent-self stream (parent-usage contract, D6): the orchestration
    // session's own event log is just another stream — same cursor cache,
    // same live-first/archive paths, same idle-freeze and R4 melt (a cold
    // parent's archive is as immutable as a terminal child's; live residency
    // melts it). No ledger row and no enumeration: scanned every unfrozen
    // round. An empty stream (no assistant message ever) injects nothing —
    // a synthetic zero row would flip Z8's found semantics for ghost ids.
    if (!bucket.self) bucket.self = newCache()
    const selfInfo = { childId: parentSessionId, agentType: null, status: null, ledgerRow: null, running: false }
    unfreezeIfNeeded(bucket.self, selfInfo, sessions)
    if (!bucket.self.frozen) await scanChild(bucket.self, selfInfo, sessions)

    const children = order.map((info) => childReport(info.childId, info, bucket.children.get(info.childId)))
    if (bucket.self.segments.length > 0) {
      // Self row rides first (it is the session's own bookkeeping, before the
      // spawn-ordered children), carrying the explicit isSelf identity mark.
      children.unshift({ ...childReport(parentSessionId, selfInfo, bucket.self), isSelf: true })
    }

    // byModel: server-side cross-child merge (D4) — one implementation of the
    // merge rules (first-appearance order, unknown sinks last, partial OR).
    const byModel = []
    const modelIndex = new Map()
    for (const child of children) {
      for (const segment of child.segments) {
        const key = `${segment.provider ?? '\u0000'}\u001f${segment.model ?? '\u0000'}`
        let row = modelIndex.get(key)
        if (!row) {
          row = { provider: segment.provider, model: segment.model, messageCount: 0, buckets: EMPTY_BUCKETS(), partial: false, childIds: new Set() }
          modelIndex.set(key, row)
          byModel.push(row)
        }
        row.messageCount += segment.messageCount
        for (const bucketKey of BUCKET_KEYS) {
          const value = segment.buckets[bucketKey]
          if (value !== null) row.buckets[bucketKey] = (row.buckets[bucketKey] ?? 0) + value
        }
        if (segment.partial) row.partial = true
        if (!child.isSelf) row.childIds.add(child.childId) // childCount counts children only — the parent-self row is usage on the books, not a child
      }
    }
    const knownRows = byModel.filter((row) => !(row.provider === null && row.model === null))
    const unknownRows = byModel.filter((row) => row.provider === null && row.model === null)
    const modelRows = [...knownRows, ...unknownRows].map((row) => ({
      provider: row.provider,
      model: row.model,
      messageCount: row.messageCount,
      buckets: row.buckets,
      partial: row.partial,
      childCount: row.childIds.size,
      price: priceFor(row.provider, row.model),
    }))

    const totals = EMPTY_BUCKETS()
    for (const child of children) {
      for (const key of BUCKET_KEYS) {
        const value = child.totals[key]
        if (value !== null) totals[key] = (totals[key] ?? 0) + value
      }
    }

    return {
      parentSessionId,
      found: ledgerExists || children.length > 0,
      currency: currencyFor(),
      children,
      byModel: modelRows,
      totals,
      // 枚举不完整（子代可能被漏）：下游 globalPartial 把它并进「≥」判定，
      // 合计行因此显示下界而不是假装完整（见 getUsage 顶部的 partial 段注释）。
      partial: enumerationIncomplete,
      generatedAt,
    }
  }

  return { getUsage }
}
