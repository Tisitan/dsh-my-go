/**
 * dsh-my-go — browser-side settings ops (0.5.0-tisitan.3).
 *
 * The single place that knows how the configuration page's draft maps onto the
 * 'dsh-my-go' namespace: section → draft projection (built-in roles promoted
 * back to top-level keys, exactly what the page renders), draft → wire ops
 * (explicit-carry discipline, dirty-key fail-closed, whole-key deletions), and
 * the read-back verdict that decides whether a write actually landed.
 *
 * It used to live in the host half's `saveSettings` RPC closure. Moving it here
 * is what lets the page write through the official `settingsScope` — the host
 * keeps no second copy, so the two halves can never drift. Zero dependencies
 * beyond the sibling pure modules, so node --test covers it without a DOM.
 */

import { AGENT_TYPES } from './client-constants.js'
import { normalizeChainRows, stripEmptyFallbackRows } from './chain-rows.js'
import { ROLE_KEY_PATTERN } from './roster-rows.js'
import { PRICE_KEY_PATTERN, sanitizePriceRow } from './usage-price-rows.js'

/** The five per-role binding fields the page edits (persona/toolFilter are role-only). */
export const BINDING_FIELDS = ['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'fallbacks']

/** Layers of one namespace the ops layer reads (from the settingsScope snapshot). */
export function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * "Nothing to store": an absent/empty string, an empty list or an unchecked
 * boolean. A `false` checkbox is a default, not a fact worth a line of yaml —
 * the old save path persisted it, which pinned every role's dsv4p0813 into the
 * user layer on the first unrelated edit.
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
      dsv4p0813: row.dsv4p0813 === true,
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
  return draft
}

/** Draft → the comparable projection used for dirty accounting and read-back. */
function normalizeForCompare(draft) {
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
      dsv4p0813: row.dsv4p0813 === true,
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
        : field === 'dsv4p0813' ? entry[field] === true : text(entry[field]).trim()
    }
    normalized.persona = text(entry.persona)
    normalized.toolFilter = {
      allow: (Array.isArray(record(entry.toolFilter).allow) ? entry.toolFilter.allow : []).map(String).filter((n) => n !== ''),
      deny: (Array.isArray(record(entry.toolFilter).deny) ? entry.toolFilter.deny : []).map(String).filter((n) => n !== ''),
    }
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
  return out
}

/** True when the draft differs from the namespace's current resolved value. */
export function isDirty(draft, section) {
  return compareKey(draft) !== compareKey(draftFromSection(section))
}

export function compareKey(draft) {
  return JSON.stringify(normalizeForCompare(draft))
}

/** Field labels the draft moved, for the save bar's pending list. */
export function dirtyLabels(draft, section) {
  const next = normalizeForCompare(draft)
  const stored = normalizeForCompare(draftFromSection(section))
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
    // persona / toolFilter only ever come from the roles dict row: the promoted
    // top-level shape has no consumer for them.
    if (carried && typeof carried === 'object') {
      if ('persona' in carried) collect(['roles', key, 'persona'], text(carried.persona))
      const filter = record(carried.toolFilter)
      for (const side of ['allow', 'deny']) {
        if (!Array.isArray(filter[side])) continue
        collect(['roles', key, 'toolFilter', side], filter[side].map(String).filter((name) => name !== ''))
      }
    }
    // 名册里还没有这一行、而草稿这行全是空值：一条 set 都没有，宿主不会凭空长出
    // 对象——「新建一个还没填完的角色」保存后静默消失（旧写法连读回都没有，宿主回
    // ok:true 就说「已保存」）。整行 set 让新建立刻可见；已有行或填了值的行照走字段
    // 级显式携带，不会因为「新建」就把没碰过的字段一并改写。
    // 「新建」的判据取行形状而非「有没有值」：页面建角色时写的是完整一行
    // （fallbacks 数组 + toolFilter 对象都在），而只带 persona 的部分行是
    // 「清掉某个可能不存在的覆盖」——后者必须仍按 unset 走（空=不落地），
    // 否则改一次人设默认会给不存在的角色凭空造出一行。
    const looksLikeNewRow = carried !== null && typeof carried === 'object'
      && Array.isArray(carried.fallbacks)
      && carried.toolFilter !== null && typeof carried.toolFilter === 'object'
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
  return ops
}

/** The stored shape of one role row, defaults filled — what a new row costs. */
function canonicalRole(src, carried) {
  const row = record(src)
  const out = {}
  for (const field of BINDING_FIELDS) {
    const value = field in row ? cleanValue(field, row[field]) : undefined
    if (value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0)) {
      out[field] = field === 'dsv4p0813' ? false : field === 'fallbacks' ? [] : ''
      continue
    }
    out[field] = clone(value)
  }
  const from = record(carried)
  out.persona = text(from.persona)
  const filter = record(from.toolFilter)
  out.toolFilter = {
    allow: (Array.isArray(filter.allow) ? filter.allow : []).map(String).filter((name) => name !== ''),
    deny: (Array.isArray(filter.deny) ? filter.deny : []).map(String).filter((name) => name !== ''),
  }
  return out
}

function cleanValue(field, value) {
  if (field === 'fallbacks') return normalizeChainRows(value)
  if (field === 'dsv4p0813') return value === true
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
 */
export function writeLanded(draft, layers, ops) {
  return compareKey(draft) === compareKey(draftFromSection(sectionAfterWrite(layers, ops)))
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
  return parts.join(' · ')
}
