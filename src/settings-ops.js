/**
 * dsh-my-go — browser-side settings ops.
 *
 * The single place that knows how the configuration page's draft maps onto the
 * 'dsh-my-go' namespace: section → draft projection (built-in roles promoted
 * back to top-level keys, exactly what the page renders), draft → wire ops
 * (explicit-carry discipline, dirty-key fail-closed, whole-key deletions), and
 * the read-back verdict that decides whether a write actually landed.
 *
 * It used to live in the host half's `saveSettings` RPC closure. Moving it here
 * is what lets the page write through the official `configForms` — the host
 * keeps no second copy, so the two halves can never drift. Zero dependencies
 * beyond the sibling pure modules, so node --test covers it without a DOM.
 */

import { AGENT_TYPES } from './client-constants.js'
import { normalizeChainRows, stripEmptyFallbackRows } from './chain-rows.js'
import { KEEP_ALIVE_DEFAULTS } from '../preset/shared/constants.mjs'
import { ROLE_KEY_PATTERN } from './roster-rows.js'
import { PRICE_KEY_PATTERN, sanitizePriceRow } from './usage-price-rows.js'

/** The five per-role binding fields the page edits (persona is role-only). */
export const BINDING_FIELDS = ['provider', 'model', 'reasoningEffort', 'fallbacks']

/** 心跳四字段（写面显式携带口径与 BINDING_FIELDS 同款）。 */
export const KEEP_ALIVE_FIELDS = ['enabled', 'orchestratorIntervalMs', 'childPingAfterMs', 'escalateAfterPings']

/** 心跳时长项的下限（毫秒）——与卡上两个时长输入框的 `min: 1`（秒）同源。 */
export const KEEP_ALIVE_MIN_MS = 1000
/** 升级梯连拍数的下限（卡上 `min: 1`）。 */
export const KEEP_ALIVE_MIN_PINGS = 1

/**
 * 心跳单字段的**写面意图值**——脏比对与 op 生成共用这一枚口径（两侧分头解释同一
 * 个输入框是同一个病根的两处口子）：
 *   - 不可用原文（清空 / 只有个减号 / 'abc' / '1e'）→ `null` = **未触碰**：用户还
 *     没表达出一个值。未触碰的含义由调用方按语境落地——比对侧回填基线侧的值
 *     （于是清空输入框不会被当成一次改动），写面侧跳过（不写盘、也不把默认值钉进
 *     用户层）。
 *   - 可解析但越界（'0' / '0.5' / 负数）→ 夹到下限（**min(1) 回落口径**）：旧口径下
 *     它被 keepAliveFrom 读成「回到默认」，于是给一个已有覆盖的字段发 unset——用户
 *     只是打了个 0，用户层那条覆盖却被悄悄删了。夹到下限后走正常 set 通路。
 *   - 其余照收（数字毫秒原样；数字串按 keepAliveFrom 同读法——n≥1 当毫秒，n<1 才
 *     是「手打的秒值残留」，按秒换算后夹下限）。
 * @param field KEEP_ALIVE_FIELDS 之一
 * @param raw 草稿里的原值（页面交回的可能是字符串）
 * @returns enabled 恒为布尔；三个数值项为整数，或 null（未触碰）
 */
export function keepAliveIntent(field, raw) {
  if (field === 'enabled') return raw === true
  const min = field === 'escalateAfterPings' ? KEEP_ALIVE_MIN_PINGS : KEEP_ALIVE_MIN_MS
  const clamp = (n) => Math.max(min, Math.trunc(n))
  // 数字（毫秒/连拍数）：≥1 照收（与读面 keepAliveFrom 同读法——域内的值不受下限
  // 干扰，否则写回之后的现值会被这层再夹一次而判成「没落盘」）；<1 才夹下限。
  if (typeof raw === 'number') return Number.isFinite(raw) ? (raw >= 1 ? Math.trunc(raw) : clamp(raw)) : null
  if (typeof raw !== 'string') return null
  const typed = raw.trim()
  if (typed === '') return null
  const n = Number(typed)
  if (!Number.isFinite(n)) return null
  // 字符串：n≥1 与 keepAliveFrom 同读法（毫秒原样，settings.yaml 手改形态）；
  // n<1 才是页面手打留下的**秒值**残片（toMillis 只把 n≥1 的输入换算成毫秒，
  // 否则原样留在草稿里），按秒换算后夹到 min(1 秒)。
  return n >= 1 ? Math.trunc(n) : clamp(n * 1000)
}

/**
 * keep-alive 段归一（读面）：缺席字段回落到 defaults 单源。草稿里恒有完整四字段
 * ——页面渲染、脏比对、保存回读三面看到同一形状，否则「字段缺席」会被当成一次真
 * 改动（每次保存都把 schema 默认钉进用户层，正是 usageCurrency 那条注释在防的事）。
 * 三个时长项接受数字串（页面输入框交回的原值）：比对与写面都经这里收口，
 * 「草稿存的是字符还是数字」不参与判据（与单价行的 sanitizePriceRow 同款）。
 */
export function keepAliveFrom(section) {
  const source = record(record(section).keepAlive)
  const positive = (value, fallback) => {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : fallback
  }
  return {
    enabled: source.enabled === true,
    orchestratorIntervalMs: positive(source.orchestratorIntervalMs, KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs),
    childPingAfterMs: positive(source.childPingAfterMs, KEEP_ALIVE_DEFAULTS.childPingAfterMs),
    escalateAfterPings: positive(source.escalateAfterPings, KEEP_ALIVE_DEFAULTS.escalateAfterPings),
  }
}

/** Layers of one namespace the ops layer reads (from the configForms snapshot). */
export function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * "Nothing to store": an absent/empty string, an empty list or an unchecked
 * boolean. A `false` checkbox is a default, not a fact worth a line of yaml —
 * the old save path persisted it, which pinned defaults into the user layer on
 * the first unrelated edit.
 */
function isVoidValue(value) {
  if (value === undefined || value === null || value === '' || value === false) return true
  return Array.isArray(value) && value.length === 0
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** One role row in storage shape, normalized enough for op generation. */
function bindingFieldsOf(row) {
  const source = record(row)
  const out = {}
  for (const field of BINDING_FIELDS) {
    if (!(field in source)) continue
    out[field] = source[field]
  }
  return out
}

/**
 * Resolved namespace section → page draft. Built-in rows live in the `roles`
 * dict on disk but the page renders one card per role, so those rows are
 * promoted to top-level keys (roles wins over a leftover legacy top-level key);
 * `roles` itself is carried through untouched for the custom-role editor.
 */
export function draftFromSection(value) {
  const section = record(value)
  const roles = record(section.roles)
  const draft = { roles: { ...roles } }
  for (const type of AGENT_TYPES) {
    // sisyphus 只认顶级键：roles.sisyphus 是 schema 拦不住的死数据，读面不复活它
    const carried = type === 'sisyphus' ? {} : record(roles[type])
    const row = Object.keys(carried).length > 0 ? { ...record(section[type]), ...carried } : record(section[type])
    draft[type] = {
      provider: text(row.provider),
      model: text(row.model),
      reasoningEffort: text(row.reasoningEffort),
      fallbacks: normalizeChainRows(row.fallbacks),
    }
    if (typeof row.persona === 'string') draft[type].persona = row.persona
  }
  const prices = {}
  for (const [key, row] of Object.entries(record(section.usagePrices))) {
    if (typeof key === 'string' && PRICE_KEY_PATTERN.test(key)) prices[key] = { ...record(row) }
  }
  draft.usagePrices = prices
  draft.usageCurrency = section.usageCurrency === 'CNY' ? 'CNY' : 'USD'
  draft.keepAlive = keepAliveFrom(section)
  return draft
}

/** Draft → the comparable projection used for dirty accounting and read-back. */
function normalizeForCompare(draft, baseline) {
  const source = record(draft)
  // 与写面同口径：内置工种的顶级行（页面编辑面）覆盖 roles 里的存量行，比对
  // 才看得见「改了 oracle 的模型」——否则草稿里那份陈旧 roles 行会赢。
  const roles = { ...record(source.roles) }
  for (const type of AGENT_TYPES) {
    if (type === 'sisyphus' || source[type] === undefined) continue
    roles[type] = { ...record(roles[type]), ...record(source[type]) }
  }
  const out = { roles: {} }
  for (const type of AGENT_TYPES) {
    const row = record(source[type])
    out[type] = {
      provider: text(row.provider).trim(),
      model: text(row.model).trim(),
      reasoningEffort: text(row.reasoningEffort),
      fallbacks: normalizeChainRows(stripEmptyFallbackRows({ fallbacks: normalizeChainRows(row.fallbacks) }).fallbacks),
    }
  }
  // 键序归一：两侧的来源不同（草稿按编辑顺序、存储按落盘顺序），不排序就会
  // 被 JSON.stringify 的插入序差异误判成「没落盘」。
  for (const key of Object.keys(roles).sort()) {
    if (typeof key !== 'string' || !ROLE_KEY_PATTERN.test(key) || key === 'sisyphus') continue
    const entry = record(roles[key])
    // 比对用规范形：absent 与 schema 解析出的空值同形（''/false/[]），否则
    // 「unset 掉一个空字段」会被读回比对误判成没落盘。
    const normalized = {}
    for (const field of BINDING_FIELDS) {
      normalized[field] = field === 'fallbacks'
        ? normalizeChainRows(stripEmptyFallbackRows({ fallbacks: normalizeChainRows(entry.fallbacks) }).fallbacks)
        : text(entry[field]).trim()
    }
    normalized.persona = text(entry.persona)
    out.roles[key] = normalized
  }
  const prices = {}
  for (const key of Object.keys(record(source.usagePrices)).sort()) {
    const row = record(source.usagePrices)[key]
    if (typeof key !== 'string' || !PRICE_KEY_PATTERN.test(key)) continue
    const price = sanitizePriceRow(row)
    if (price !== null) prices[key] = price
  }
  out.usagePrices = prices
  out.usageCurrency = source.usageCurrency === 'CNY' ? 'CNY' : 'USD'
  // 心跳段按读面同款归一后比对：草稿缺字段（老草稿、脚本直调）与归一后的现值
  // 同形，不会被误判成「改了配置」。**半输入例外**：某个时长框被清空/
  // 打成非数字残字时，这一侧没有「值」可投影——回填 baseline（= 对面的那一侧，
  // 脏比对是现值、读回判定是写入后的现值）的值，等价于「这一格没被碰过」。
  // 不回填的旧口径会把「清空」投影成默认值：现值里若是用户层钉过的非默认值，
  // 页面就报脏、发出零条 op、再把读回判成「没落盘」——一次纯属虚构的红字。
  out.keepAlive = keepAliveProjection(source, baseline)
  return out
}

/** 心跳段的比对投影：写面口径（intent）+ 未触碰回填（baseline 侧的值）。 */
function keepAliveProjection(section, baseline) {
  const raw = record(record(section).keepAlive)
  // baseline 也是草稿形状（其 keepAlive 已是归一后的数字）——keepAliveFrom 直接吃它。
  const fallback = baseline === undefined ? null : keepAliveFrom(baseline)
  const normalized = keepAliveFrom(section)
  const out = {}
  for (const field of KEEP_ALIVE_FIELDS) {
    const intent = keepAliveIntent(field, raw[field])
    out[field] = intent !== null ? intent : (fallback === null ? normalized[field] : fallback[field])
  }
  return out
}

/** True when the draft differs from the namespace's current resolved value. */
export function isDirty(draft, section) {
  const stored = draftFromSection(section)
  return compareKey(draft, stored) !== compareKey(stored)
}

/**
 * Stable comparison key. `baseline` (optional) is the *other* side of the
 * comparison in draft shape: it supplies the value for heartbeat fields whose
 * input box holds nothing usable yet (see keepAliveIntent). Both sides of a
 * comparison must be keyed with the same baseline discipline — the draft side
 * passes it, the stored side does not need it (its values are always usable).
 */
export function compareKey(draft, baseline) {
  return JSON.stringify(normalizeForCompare(draft, baseline))
}

/** Field labels the draft moved, for the save bar's pending list. */
export function dirtyLabels(draft, section) {
  const storedDraft = draftFromSection(section)
  const next = normalizeForCompare(draft, storedDraft)
  const stored = normalizeForCompare(storedDraft)
  const labels = []
  if (JSON.stringify(next.sisyphus) !== JSON.stringify(stored.sisyphus)) labels.push('总调度绑定')
  const changedRoles = []
  for (const type of AGENT_TYPES) {
    if (type === 'sisyphus') continue
    if (JSON.stringify(next[type]) !== JSON.stringify(stored[type])) changedRoles.push(type)
  }
  if (changedRoles.length > 0) labels.push(`内置工种 ${changedRoles.length} 项`)
  if (JSON.stringify(next.roles) !== JSON.stringify(stored.roles)) labels.push('角色名册')
  if (JSON.stringify(next.usagePrices) !== JSON.stringify(stored.usagePrices)) labels.push('单价表')
  if (next.usageCurrency !== stored.usageCurrency) labels.push('币种')
  if (KEEP_ALIVE_FIELDS.some((field) => next.keepAlive[field] !== stored.keepAlive[field])) labels.push('缓存心跳')
  return labels
}

/**
 * Compile the draft into namespace ops. Discipline inherited from the retired
 * host-side `saveSettings` verbatim:
 *  - explicit carry only: a field the draft does not carry is never touched
 *    (an empty *value* still means unset — that is the page's clear path);
 *  - sisyphus stays a top-level key and is skipped inside `roles`;
 *  - dirty role/price keys and invalid price rows drop fail-closed, so one
 *    hand-edited junk key can never poison the whole atomic write;
 *  - a draft carrying `roles` / `usagePrices` is the authoritative full view:
 *    stored entries missing from it are unset by whole key.
 * @param draft - the page draft (promoted shape).
 * @param stored - the namespace layers: resolved `value` plus the raw `user`
 *   layer (deletions are computed against what the user actually owns).
 * @returns the ordered ops for one `scope.mutate` call.
 */
export function buildSettingsOps(draft, stored = {}) {
  const source = record(draft)
  const section = record(stored.value)
  const userLayer = record(stored.user)
  const draftRoles = record(source.roles)
  const ops = []
  const push = (path, value) => {
    ops.push(isVoidValue(value) ? { op: 'unset', path } : { op: 'set', path, value: clone(value) })
  }

  const sisyphus = bindingFieldsOf(source.sisyphus)
  for (const field of BINDING_FIELDS) {
    if (!(field in sisyphus)) continue
    push(['sisyphus', field], cleanValue(field, sisyphus[field]))
  }

  // roles dict 键永不含 sisyphus（它与 lib 半 migrateLegacyRolesOps 同口径：
  // 恒为顶级键）。注意本模块的 AGENT_TYPES 是**页面渲染面**的九张卡（含
  // sisyphus），lib 半那份只有八个工种——照抄会写出 roles.sisyphus 死数据。
  const roleKeys = [...new Set([
    ...AGENT_TYPES.filter((type) => type !== 'sisyphus'),
    ...Object.keys(draftRoles).filter((key) => key !== 'sisyphus' && ROLE_KEY_PATTERN.test(key)),
  ])]
  const storedRoles = record(section.roles)
  for (const key of roleKeys) {
    const topRow = AGENT_TYPES.includes(key) ? bindingFieldsOf(source[key]) : {}
    const roleRow = bindingFieldsOf(draftRoles[key])
    const src = { ...roleRow, ...topRow }
    const carried = draftRoles[key]
    const fieldOps = []
    const collect = (path, value) => {
      fieldOps.push(isVoidValue(value) ? { op: 'unset', path } : { op: 'set', path, value: clone(value) })
    }
    for (const field of BINDING_FIELDS) {
      if (!(field in src)) continue
      collect(['roles', key, field], cleanValue(field, src[field]))
    }
    // persona only ever comes from the roles dict row: the promoted
    // top-level shape has no consumer for them.
    if (carried && typeof carried === 'object') {
      if ('persona' in carried) collect(['roles', key, 'persona'], text(carried.persona))
    }
    // 名册里还没有这一行、而草稿这行全是空值：一条 set 都没有，宿主不会凭空长出
    // 对象——「新建一个还没填完的角色」保存后静默消失（连读回都没有：宿主回
    // ok:true 就算「已保存」）。整行 set 让新建立刻可见；已有行或填了值的行照走字段
    // 级显式携带，不会因为「新建」就把没碰过的字段一并改写。
    // 「新建」的判据取行形状而非「有没有值」：页面建角色时写的是完整一行
    // （携带 fallbacks 数组），而只带 persona 的部分行是
    // 「清掉某个可能不存在的覆盖」——后者必须仍按 unset 走（空=不落地），
    // 否则改一次人设默认会给不存在的角色凭空造出一行。
    const looksLikeNewRow = carried !== null && typeof carried === 'object'
      && Array.isArray(carried.fallbacks)
    if (!(key in storedRoles) && looksLikeNewRow && !fieldOps.some((op) => op.op === 'set')) {
      ops.push({ op: 'set', path: ['roles', key], value: canonicalRole(src, carried) })
      continue
    }
    ops.push(...fieldOps)
  }

  // Deleted custom roles: only when the draft carries the dict at all (the
  // page always does); a draft without `roles` must never trim the roster.
  if (source.roles !== undefined && source.roles !== null && typeof source.roles === 'object') {
    for (const key of Object.keys(record(userLayer.roles))) {
      if (AGENT_TYPES.includes(key) || key in draftRoles) continue
      ops.push({ op: 'unset', path: ['roles', key] })
    }
  }

  if (source.usagePrices !== undefined && source.usagePrices !== null && typeof source.usagePrices === 'object') {
    const written = {}
    for (const [key, row] of Object.entries(source.usagePrices)) {
      if (typeof key !== 'string' || !PRICE_KEY_PATTERN.test(key)) continue
      const price = sanitizePriceRow(row)
      if (price === null) continue
      written[key] = price
      ops.push({ op: 'set', path: ['usagePrices', key], value: price })
    }
    if (Object.keys(written).length === 0) {
      // 清空整表就撤掉整键：逐行 unset 之后宿主仍会落下 `usagePrices: {}`
      // 一行空字典——那既不是「未配置」也挡不住 base 里的存量表，纯属噪声。
      ops.push({ op: 'unset', path: ['usagePrices'] })
    } else {
      for (const key of Object.keys(record(userLayer.usagePrices))) {
        if (key in written) continue
        ops.push({ op: 'unset', path: ['usagePrices', key] })
      }
    }
  }

  // 币种旋钮与宿主现值同形时不发 op：草稿里的 usageCurrency 恒有值（缺省归一成
  // USD），照原写法每次保存都会把 `usageCurrency: USD` 钉进用户层——那是 schema
  // 默认该待的地方，不该成为一条持久覆盖（覆盖会挡住 cordis 行 config 的 base）。
  const storedCurrency = section.usageCurrency === 'CNY' || section.usageCurrency === 'USD'
    ? section.usageCurrency
    : 'USD'
  if ((source.usageCurrency === 'USD' || source.usageCurrency === 'CNY')
    && source.usageCurrency !== storedCurrency) {
    ops.push({ op: 'set', path: ['usageCurrency'], value: source.usageCurrency })
  }

  // 心跳段（keepAlive）：与币种同一纪律——草稿恒带完整四字段（读面归一），
  // 逐字段只在**真变了**时才发 op，否则每次保存都会把 schema 默认钉进用户层。
  // 「改回默认值」= 撤销覆盖（unset，露出行 config 的 base）：用户把拍距调回 5 分钟
  // 的语义就是「我不要这条覆盖」，而不是「我要一条写着 300000 的覆盖」。
  //
  // **段在席才写**：宿主进程持有的 schema 可能早于本版本插件——插件由
  // Loader 经 `import()` 装配，Node 的 ESM 缓存按 URL 命中，改过的 lib/config.js
  // **不会**换掉已启动进程里的 `fiber.runtime.Config`（宿主侧 volatile 闸就在那份 schema
  // 上判 `Config field "keepAlive.enabled" is not volatile`）。此时 schema 默认不会解析进
  // 现值，`section.keepAlive` 缺席而我们又照常发 op —— 后果不是「这一段没保存」，而是
  // **整次原子写入被拒**：同一次点击里改过的角色/单价一并陪葬，页面只回一句两义红字。
  // 故读面缺席即视为「宿主没声明这一段」，一条 op 都不发。
  // 本闸只落在这一段上：roles / usagePrices / usageCurrency 比任何在跑的宿主
  // 都老（不存在「宿主没声明它们」的版本偏斜场景），它们的显式携带口径不在此改动面内。
  if (source.keepAlive !== undefined && source.keepAlive !== null && typeof source.keepAlive === 'object'
    && section.keepAlive !== undefined) {
    const rawKeepAlive = record(source.keepAlive)
    const storedKeepAlive = keepAliveFrom(section)
    const userKeepAlive = record(userLayer.keepAlive)
    for (const field of KEEP_ALIVE_FIELDS) {
      // 单一口径：keepAliveIntent（与脏比对共用）。null = 未触碰（清空 / 非数字残字）：
      // 收口丢弃，不写盘也不回退成默认值钉进用户层——与单价行的 fail-closed 同款。
      // 越界值（'0' / '0.5' / 负数）**不是**未触碰：intent 已把它夹到 min(1)，
      // 走下面的正常 set 通路，不再被读成「回到默认」而误发 unset。
      const intent = keepAliveIntent(field, rawKeepAlive[field])
      if (intent === null) continue
      if (intent === storedKeepAlive[field]) continue
      if (intent === KEEP_ALIVE_DEFAULTS[field] && field in userKeepAlive) {
        ops.push({ op: 'unset', path: ['keepAlive', field] })
        continue
      }
      ops.push({ op: 'set', path: ['keepAlive', field], value: intent })
    }
  }
  return ops
}

/** The stored shape of one role row, defaults filled — what a new row costs. */
function canonicalRole(src, carried) {
  const row = record(src)
  const out = {}
  for (const field of BINDING_FIELDS) {
    const value = field in row ? cleanValue(field, row[field]) : undefined
    if (value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0)) {
      out[field] = field === 'fallbacks' ? [] : ''
      continue
    }
    out[field] = clone(value)
  }
  const from = record(carried)
  out.persona = text(from.persona)
  return out
}

function cleanValue(field, value) {
  if (field === 'fallbacks') return normalizeChainRows(value)
  if (typeof value === 'string') return value.trim()
  return value
}

/**
 * Apply ops to a copy of the resolved section — the browser-side mirror of what
 * the host's commit does, used only to predict the read-back. A `set` creates
 * the intermediates it needs (a brand-new role row has no `roles.<key>` object
 * yet, and dropping the write there made every first edit of a role read back
 * as "not landed"); an `unset` never creates anything and reveals the
 * composition base underneath, which is what the page promises on a clear.
 */
export function sectionAfterWrite(layers, ops) {
  const next = clone(record(layers.value))
  const base = record(layers.base)
  for (const op of ops) {
    const path = Array.isArray(op.path) ? op.path : []
    const leaf = path[path.length - 1]
    if (leaf === undefined || path.length === 0) continue
    if (op.op === 'set') {
      const parent = path.slice(0, -1).reduce((node, key) => {
        if (node === null || typeof node !== 'object') return node
        if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
        return node[key]
      }, next)
      if (parent !== null && typeof parent === 'object') parent[leaf] = clone(op.value)
      continue
    }
    const parent = path.slice(0, -1).reduce((node, key) => record(node)[key], next)
    if (parent !== null && typeof parent === 'object') delete parent[leaf]
    const baseParent = path.slice(0, -1).reduce((node, key) => record(node)[key], base)
    const fromBase = baseParent === null || baseParent === undefined ? undefined : record(baseParent)[leaf]
    if (fromBase !== undefined && parent !== null && typeof parent === 'object') parent[leaf] = clone(fromBase)
  }
  return next
}

/**
 * Read-back verdict. The official channel settles a rejected write silently
 * (it reloads instead of throwing), so a save is only real when the namespace
 * now answers with what the ops intended.
 *
 * The draft is keyed with the after-write value as its baseline: a field whose
 * box holds nothing usable counts as untouched on both sides, so clearing the
 * interval box can never manufacture a "did not land" verdict for a zero-op
 * save (那条红字纯属虚构).
 */
export function writeLanded(draft, layers, ops) {
  const after = draftFromSection(sectionAfterWrite(layers, ops))
  return compareKey(draft, after) === compareKey(after)
}

/** One-line state for the config slot's `summary` view. */
export function summaryLine(section) {
  const draft = draftFromSection(section)
  const bound = AGENT_TYPES.filter((type) => draft[type] && (text(draft[type].provider) !== '' || text(draft[type].model) !== '')).length
  const custom = Object.keys(record(draft.roles)).filter((key) => !AGENT_TYPES.includes(key) && ROLE_KEY_PATTERN.test(key)).length
  const prices = Object.keys(record(draft.usagePrices)).length
  const parts = [`编排 ${AGENT_TYPES.length} 角色（${bound} 个指定了模型）`]
  if (custom > 0) parts.push(`自定义 ${custom}`)
  if (prices > 0) parts.push(`单价 ${prices} 条（${draft.usageCurrency}）`)
  else parts.push('未配单价（只统计 token）')
  // 心跳只在开启时进摘要行：默认关是现状，不该在折叠行里占字数。
  if (keepAliveFrom(section).enabled) parts.push('缓存心跳开')
  return parts.join(' · ')
}
