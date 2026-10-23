/**
 * dsh-my-go — configuration card.
 *
 * The plugin's single configuration entry, rendered inside the official plugin
 * page through the `plugins.bundle.config` slot. It reads and writes the
 * 'dsh-my-go' namespace over the host's `configForms` (0.1.7: `settingsScope`
 * retired — the entry's form comes from `configForms.get(entryId)`, whose
 * snapshot is field-for-field the one `settingsScope.bind` used to answer, so
 * nothing below this line changed with the migration). The private
 * `loadSettings` / `saveSettings` RPC pair stays retired, so nothing about the
 * stored shape is decided twice.
 *
 * Information architecture: two blocks, each a two-column master/detail grid
 * with its own full-width annotation strip, plus a save bar.
 *   1. 模型与角色 — one row per role (8 built-ins + the custom roster), the
 *      selected role edited on the right (model priority chain, effort,
 *      persona override, card JSON).
 *   2. 用量单价表 — one row per "{provider}/{model}" key, four buckets on the
 *      right, one currency knob for the whole table.
 *
 * Draft discipline (what the previous page could not promise):
 *  - nothing reaches the wire until 保存;
 *  - the write carries the revision the draft was *opened* at, not the latest;
 *  - an external change never overwrites the draft — it raises a drift notice;
 *  - a save is only reported as saved when the namespace answers back with the
 *    intended section (the official channel rejects silently).
 *
 * The pane renderers (roles-editor.js, usage-prices-editor.js) and all row math
 * (chain-rows.js, roster-rows.js, usage-price-rows.js) stay as they were: pure,
 * state-free, driven from here.
 */

import * as React from 'react'

import { PRICE_KEY_PATTERN, ROLE_KEY_PATTERN, KEEP_ALIVE_DEFAULTS, KEEP_ALIVE_CALC, PANEL_RPC_CHANNEL, PANEL_ENDPOINTS, PRICE_BUCKETS, PRICE_BUCKET_LABELS } from '../preset/shared/constants.mjs'
import { composeChain, decomposeChain } from './chain-rows.js'
import { AGENT_LABELS, AGENT_TYPES } from './client-constants.js'
import { mountSettingsStyles } from './client-styles.js'
import { formatDurationHuman, intervalMsFromTtl, lookaheadMs, parseCalcNumber } from './keepalive-calc.js'
import { normalizeRoleRows, personaOverrideSource, resolveBuiltinPersonaResult, withPersonaOverride } from './roster-rows.js'
import { attachBeforeUnloadGuard, describeSaveOutcome, hostServesSection, resolveCardView, UNSERVED_SECTION_HINT, unservedSections } from './settings-guard.js'
import { buildSettingsOps, compareKey, draftFromSection, dirtyLabels, keepAliveFrom, summaryLine, writeLanded } from './settings-ops.js'
import { renderRolesPane } from './roles-editor.js'
import { renderPricesPane } from './usage-prices-editor.js'

const el = React.createElement

/**
 * The slot component. `view` comes from the plugin page: `summary` is the line a
 * collapsed row shows, `page` is the editor.
 */
export function SettingsCard({ view = 'page', scope, face, catalog, connection }) {
  const snapshot = useScopeSnapshot(scope)
  if (view === 'summary') {
    const card = resolveCardView(snapshot)
    return el('span', { className: 'mygo-summary' }, card.kind === 'ready' ? summaryLine(snapshot.value) : (snapshot === undefined ? '配置读取中…' : '命名空间未就绪'))
  }
  return el(SettingsPage, { snapshot, scope, face, catalog, connection })
}

/** Subscribe to the scope mirror; the card's stylesheet rides the same lifetime. */
function useScopeSnapshot(scope) {
  const subscribe = React.useCallback((emit) => {
    const off = typeof scope?.subscribe === 'function' ? scope.subscribe(emit) : null
    const styleOff = mountSettingsStyles()
    return () => {
      if (typeof off === 'function') off()
      styleOff()
    }
  }, [scope])
  const get = React.useCallback(() => (scope?.getSnapshot ? scope.getSnapshot() : undefined), [scope])
  const snapshot = React.useSyncExternalStore(subscribe, get, get)
  // 首次挂载拉一次 describe（bind 不会自己发请求），失败由镜像自己变成
  // unavailable 态，页面据此出「重试」而不是转圈。
  React.useEffect(() => {
    if (typeof scope?.ensure === 'function') void scope.ensure()
    else if (typeof scope?.load === 'function') void scope.load()
  }, [scope])
  return snapshot
}

function SettingsPage({ snapshot, scope, face, catalog, connection }) {
  const [draft, setDraft] = React.useState(null)
  // 最新草稿的**可变句柄**（P2）：draft state 在异步 save() 的闭包里会过期，而
  // 「落盘后该不该清草稿」取决于用户此刻手里有什么。只在真正改草稿的三处同步写：
  // stage（编辑）、save 成功清空、discardAndReload（丢弃）。
  // 用 useState 惰性初始化的稳定对象代替 useRef：语义与 useRef 完全一致（同一个
  // 对象跨渲染存活、写 .current 不触发重渲染），但不需要组件额外索要一个 hook——
  // 本仓与外部复现档的假 React 都只提供 useState/useCallback/useEffect/
  // useSyncExternalStore，多要一个 hook 会把整套验证档打死。
  const [draftCell] = React.useState(() => ({ current: null }))
  // 渲染顶层同步一次（B2 闸 F3）：stage 里在 updater 内写 cell 是「同帧可见」的快
  // 路径，但 React 严格模式会重复调用 updater、并发模式可能丢弃渲染——只在 updater
  // 里写会让 cell 与真正提交的 draft 失步。这里无条件对齐到**本次渲染的 draft**，
  // 使 cell 在任何一次渲染后都等于已提交的真值；save() 读它时不会拿到幻影草稿。
  draftCell.current = draft
  // 「角色键名」输入框的本地草稿（P2）：受控输入若直接绑 `value: key`，每次按键都
  // 被下一次渲染刷回旧值——用户打不出第二个字符，onBlur 里的 `next !== key` 永不
  // 成立，改名入口形同不存在。草稿只在**当前选中角色未变**时有效：`roleKeyDraftFor`
  // 记下草稿属于哪个角色，选中换人（含改名成功后 pickRole(next)）即自动回落到新
  // 键名，等价于「随 selectedKey 切换重置」，且不需要一枚 effect 去追选中态。
  const [roleKeyDraft, setRoleKeyDraft] = React.useState(null)
  const [roleKeyDraftFor, setRoleKeyDraftFor] = React.useState(null)
  const [fence, setFence] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState(null)
  const [picked, setPicked] = React.useState(AGENT_TYPES[0])
  // 选中角色统一入口（P2）：每次换人顺手清掉「角色键名」输入框的本地草稿，于是
  // 「改了名不提交、切走切回」也不会把半截草稿放回来——切换即重置是同步完成的，
  // 不依赖 effect 去追 picked。
  const pickRole = (key) => {
    setPicked(key)
    setRoleKeyDraft(null)
    setRoleKeyDraftFor(null)
  }
  const [pickedPrice, setPickedPrice] = React.useState(null)
  const [newRoleKey, setNewRoleKey] = React.useState('')
  const [importError, setImportError] = React.useState('')
  const [newPriceKey, setNewPriceKey] = React.useState('')
  const [personaFileErr, setPersonaFileErr] = React.useState({})
  // 心跳速算区的三个输入：**纯组件态**——既不进草稿也不落库，
  // 刷新即回到默认档。零持久化字段是本节的硬约束（schema 与 lib/config.js
  // 一行都不动）；它能写出的唯一值，是用户点「填入拍距」那一笔（走 setKeepAlive
  // 写进正式字段的草稿，仍是草稿，用户可继续手改）。
  const [calcTtl, setCalcTtl] = React.useState(String(KEEP_ALIVE_CALC.defaultTtlSeconds))
  const [calcInputPrice, setCalcInputPrice] = React.useState('')
  const [calcCachePrice, setCalcCachePrice] = React.useState('')

  const card = resolveCardView(snapshot)
  const ready = card.kind === 'ready'
  const layers = ready ? { value: snapshot.value, base: snapshot.base, user: snapshot.user } : { value: {}, base: {}, user: {} }
  const stored = ready ? draftFromSection(snapshot.value) : null
  const current = draft ?? stored ?? emptyDraft()
  // 脏比对：草稿侧带上现值当基线——半输入（清空 / 残字）的格子由基线值回填，
  // 不会凭空报脏。
  const dirty = draft !== null && compareKey(draft, stored ?? emptyDraft()) !== compareKey(stored ?? emptyDraft())
  const pending = draft === null ? [] : dirtyLabels(draft, snapshot?.value ?? {})
  const drifted = draft !== null && typeof fence === 'number' && typeof snapshot?.revision === 'number' && fence !== snapshot.revision
  const writable = ready && snapshot.writable !== false && snapshot.mode !== 'memory'

  const models = useCatalog(catalog)

  React.useEffect(() => {
    if (!dirty) return undefined
    return attachBeforeUnloadGuard(typeof window === 'undefined' ? undefined : window)
  }, [dirty])

  // 草稿建立只在「第一次打开编辑」时记栅栏（那一刻的 revision）；此后外部提交
  // 一律走漂移提示，绝不动用户手里的东西。
  const stage = (updater) => {
    setDraft((prev) => {
      const next = updater(prev ?? stored ?? emptyDraft())
      // 最新草稿跟踪（P2）：save() 的闭包拿到的 draft 是**发起保存那一刻**的快照，
      // 而 scope.mutate 是异步的——用户在飞行期间继续编辑时闭包看不见新值。落盘后
      // 靠这枚稳定句柄判断「最新草稿是否仍是提交时那一份」，再决定清不清草稿。
      draftCell.current = next
      return next
    })
    if (draft === null && typeof snapshot?.revision === 'number') setFence(snapshot.revision)
    setMessage(null)
  }

  const reload = () => {
    if (typeof face?.getSnapshot === 'function') void face.load?.()
    if (typeof scope?.load === 'function') void scope.load()
    else if (typeof scope?.ensure === 'function') void scope.ensure()
  }

  const discardAndReload = () => {
    setDraft(null)
    draftCell.current = null
    setFence(null)
    setMessage(null)
    reload()
  }

  const save = async () => {
    if (!draft || !writable || saving) return
    // 本次提交的草稿快照（P2）：落盘后用它判断用户在这期间是否又改了东西。
    const submittedDraft = draft
    setSaving(true)
    setMessage(null)
    try {
      const ops = buildSettingsOps(submittedDraft, layers)
      const before = { value: snapshot.value, base: snapshot.base }
      await scope.mutate(ops, typeof fence === 'number' ? fence : undefined)
      const after = scope.getSnapshot()
      const landed = ready
        && after?.status === 'ready'
        && writeLanded(submittedDraft, before, ops)
        // 第二道读回判据同样以「写入后的现值」为基线：半输入格子两侧同形，不再制造
        // 假红字（writeLanded 内部已经是同一口径，这里保持页面侧的判据与之一致）。
        && compareKey(submittedDraft, draftFromSection(after.value)) === compareKey(draftFromSection(after.value))
      // 被拒时尽量点名真凶：本次 ops 触及、而宿主现值里根本不存在的段 ⇒ 宿主 schema
      // 比本版本插件旧（宿主侧 volatile 闸拿旧 schema 判新段），不是「校验不过」也不是
      // 并发漂移。两义红字换成一句能照做的话（重启宿主）。
      const unserved = landed ? [] : unservedSections(ops, [before.value, after?.value])
      // 飞行期间的新输入（P2 修复的判据）：最新草稿 ≠ 提交快照 ⇒ 这份新草稿必须留下。
      // 旧实现在 landed 时无条件 setDraft(null)，把用户刚敲的内容静默蒸发、状态栏还
      // 显示「无改动」——用户以为已保存，实际那一笔改动从未上过盘。
      const latestDraft = draftCell.current
      const superseded = landed
        && latestDraft !== null
        && compareKey(latestDraft, submittedDraft) !== compareKey(submittedDraft, submittedDraft)
      const outcome = describeSaveOutcome(landed, after?.revision, unserved)
      setMessage(superseded
        ? { ...outcome, text: `${outcome.text}；保存期间的新改动尚未保存，请再保存一次` }
        : outcome)
      if (landed) {
        if (superseded) {
          // 前序保存已生效：栅栏挪到刚落盘的 revision（新草稿的脏判定以它为基线，
          // 状态栏照常报「待保存」），草稿与句柄都保持不动。
          setFence(typeof after?.revision === 'number' ? after.revision : null)
        } else {
          setDraft(null)
          draftCell.current = null
          setFence(null)
        }
      }
    } catch (error) {
      setMessage({ ok: false, text: `写入通道异常：${String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  // ── 角色清单（内置 + 自定义同列）─────────────────────────────────────────
  const customRows = normalizeRoleRows(current.roles, AGENT_TYPES)
  const roleList = [
    ...AGENT_TYPES.map((type) => roleEntry(type, AGENT_LABELS[type] ?? type, current[type], current.roles?.[type], true)),
    ...customRows.map((row) => roleEntry(row.key, row.key, row, current.roles?.[row.key], false)),
  ]
  const selectedKey = roleList.some((row) => row.key === picked) ? picked : AGENT_TYPES[0]
  const selectedRole = roleList.find((row) => row.key === selectedKey)

  const rowOf = (key) => (AGENT_TYPES.includes(key) ? { ...current[key], ...partialOf(key) } : { ...current.roles?.[key] })

  // 心跳块的两个读面：keepAliveStored 是归一后的值（开关状态与提示文案
  // 用它），keepAliveFieldValue 交**草稿原值**给输入框——归一值回填会让用户打不出
  // 「30」（刚敲一个 3 就被读成默认 300000）；与单价行「输入框原值进草稿」同款。
  // 两个时长旋钮在界面上以**秒**示人（列头写明单位），存量与 schema 仍是毫秒：
  // 显示时除 1000、写回时乘 1000，草稿里始终只有毫秒一种量纲。
  // 第三个读面：这一段**宿主声明了吗**。声明的段恒有值（schema 默认也
  // 解析进现值），故现值里没有 keepAlive 只可能是「宿主进程早于本版本插件」——
  // 此时写入必被宿主侧 volatile 闸拒（且会连累同一次点击里的其它改动），本块转只读
  // 并把出路写在块头，不再让用户走到那次注定失败的保存。
  const keepAliveServed = ready && hostServesSection(snapshot.value, 'keepAlive')
  const keepAliveStored = keepAliveFrom(current)
  const toSeconds = (raw) => (typeof raw === 'number' ? String(Math.round(raw / 1000)) : String(raw ?? ''))
  const toMillis = (raw) => {
    const n = Number(raw)
    return raw !== '' && Number.isFinite(n) && n >= 1 ? Math.trunc(n * 1000) : raw
  }
  const keepAliveFieldValue = (field) => {
    const raw = current.keepAlive?.[field]
    if (field === 'enabled') return String(raw === true)
    if (field === 'escalateAfterPings') return raw === undefined || raw === null ? '' : String(raw)
    return toSeconds(raw)
  }

  // 速算区：三个输入是组件态，两个结果是渲染期纯计算（无副作用、
  // 不写草稿）。可写性只认「宿主声明的段 + 可写」，**刻意不看心跳开关**：先把
  // 拍距算好、再打开开关是正常流，且「填入拍距」写的是草稿——草稿本来就允许
  // 在任意时刻编辑（拍距输入框在关闭态只是灰显，值照常显示与更新）。
  const calcReadonly = !writable || !keepAliveServed
  const calc = keepAliveCalcText({ ttlSeconds: calcTtl, inputPrice: calcInputPrice, cachePrice: calcCachePrice })
  const fillCalcInterval = () => {
    if (calc.intervalMs === null) return
    // 一键填入 = 走既有 setKeepAlive 通路，写的是**毫秒**（与手填框同量纲）；
    // 它只改草稿，保存与否仍归用户（速算区绝不碰 save 逻辑）。
    setKeepAlive('orchestratorIntervalMs', calc.intervalMs)
  }

  function partialOf(key) {
    const carried = current.roles?.[key]
    return carried && typeof carried === 'object' && Object.prototype.hasOwnProperty.call(carried, 'persona') ? { persona: carried.persona } : {}
  }

  const setBinding = (key, field, value) => stage((prev) => (AGENT_TYPES.includes(key)
    ? { ...prev, [key]: { ...prev[key], [field]: value } }
    : { ...prev, roles: { ...prev.roles, [key]: { ...prev.roles?.[key], [field]: value } } }))

  const setChain = (key, chain) => stage((prev) => {
    // 分解只在写回收口一处做（decomposeChain 顺带归一脏条目），pane 交出来的是链本体
    const split = decomposeChain(chain)
    const row = { provider: split.provider, model: split.model, fallbacks: split.fallbacks }
    if (AGENT_TYPES.includes(key)) return { ...prev, [key]: { ...prev[key], ...row } }
    return { ...prev, roles: { ...prev.roles, [key]: { ...prev.roles?.[key], ...row } } }
  })

  const setPersona = (key, text) => stage((prev) => ({
    ...prev,
    roles: { ...prev.roles, [key]: withPersonaOverride(rowOf(key), text) },
  }))

  const loadBuiltinPersona = async (key) => {
    if (!connection?.rpc?.call) {
      setPersonaFileErr((prev) => ({ ...prev, [key]: '连接不可用' }))
      return
    }
    try {
      const parsed = resolveBuiltinPersonaResult(await connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.getBuiltinPersona, { type: key }))
      if (parsed.ok) {
        setPersona(key, parsed.persona)
        setPersonaFileErr((prev) => ({ ...prev, [key]: '' }))
      } else {
        setPersonaFileErr((prev) => ({ ...prev, [key]: parsed.message }))
      }
    } catch (error) {
      setPersonaFileErr((prev) => ({ ...prev, [key]: String(error) }))
    }
  }

  const createRole = () => {
    const key = newRoleKey.trim()
    if (!writable || !isValidRoleKey(key, customRows)) return
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: blankRole() } }))
    setNewRoleKey('')
    pickRole(key)
    setImportError('')
  }

  const deleteRole = (key) => {
    stage((prev) => {
      const roles = { ...prev.roles }
      delete roles[key]
      return { ...prev, roles }
    })
    pickRole(AGENT_TYPES[0])
  }

  // 改名（P2）：**返回布尔**，调用方（roles-editor 的键名输入框失焦）据此决定
  // 是否把本地草稿回滚回原键名——false 表示这次改名被拒（非法键名/重名/内置名），
  // 提示已经由 importError 给出，输入框不该停在那个非法值上。
  const renameRole = (from, to) => {
    const next = String(to).trim()
    if (!isValidRoleKey(next, customRows)) {
      setImportError(`键名「${next}」非法或已存在（内置名与小写-规则同样拒收）`)
      return false
    }
    stage((prev) => {
      const roles = { ...prev.roles }
      roles[next] = { ...roles[from], }
      delete roles[from]
      return { ...prev, roles }
    })
    pickRole(next)
    setImportError('')
    return true
  }

  const exportRole = async (key) => {
    const json = JSON.stringify({ key, ...current.roles?.[key] }, null, 2)
    try {
      await navigator.clipboard.writeText(json)
    } catch {
      if (typeof window !== 'undefined') window.prompt('剪贴板不可用，请手动复制该角色 JSON：', json)
    }
  }

  const importOverwrite = (key) => {
    const text = typeof window === 'undefined' ? null : window.prompt(`粘贴 JSON 覆盖角色「${key}」（键名以当前行为准）：`)
    const parsed = parseRoleText(text)
    if (!parsed.ok) {
      setImportError(parsed.error)
      return
    }
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: parsed.row } }))
    setImportError('')
  }

  const importRole = () => {
    const text = typeof window === 'undefined' ? null : window.prompt('粘贴角色 JSON 导入（可先在别处导出，改 key 后导入）：')
    const parsed = parseRoleText(text)
    if (!parsed.ok) {
      setImportError(parsed.error)
      return
    }
    const key = parsed.key
    if (!isValidRoleKey(key, customRows)) {
      setImportError('键名缺失、非法或已存在（含内置名）')
      return
    }
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: parsed.row } }))
    pickRole(key)
    setImportError('')
  }

  // ── 单价清单 ─────────────────────────────────────────────────────────────
  const priceKeys = Object.keys(current.usagePrices ?? {}).sort()
  const selectedPrice = priceKeys.includes(pickedPrice ?? '') ? pickedPrice : (priceKeys[0] ?? null)

  const setPrice = (key, bucket, value) => stage((prev) => ({
    ...prev,
    usagePrices: { ...prev.usagePrices, [key]: { ...prev.usagePrices?.[key], [bucket]: value } },
  }))

  // 心跳四字段：与单价行同款「输入框原值进草稿、写面收口归一」（keepAliveFrom
  // 认数字串），故这里不做 Number() 转换——半输入不该被吃掉，也不该读成一个
  // 归一后的默认值回填进输入框（那会让用户打不出「30」）。
  const setKeepAlive = (field, value) => stage((prev) => ({
    ...prev,
    keepAlive: { ...keepAliveFrom(prev), ...prev.keepAlive, [field]: value },
  }))

  const createPrice = () => {
    const key = newPriceKey.trim()
    if (!writable || !isValidPriceKey(key, current)) return
    stage((prev) => ({ ...prev, usagePrices: { ...prev.usagePrices, [key]: blankPriceRow() } }))
    setNewPriceKey('')
    setPickedPrice(key)
  }

  const deletePrice = (key) => {
    stage((prev) => {
      const prices = { ...prev.usagePrices }
      delete prices[key]
      return { ...prev, usagePrices: prices }
    })
    setPickedPrice(null)
  }

  return el('section', { className: 'mygo-config', 'data-plugin': 'dsh-my-go' },
    el('p', { className: 'mygo-intro' }, '给每个工种单独指定模型优先级与思考档位；留空 = 跟随 Sisyphus（即对话框里选的模型）。改完点「立即保存」，下次派发生效。'),
    el('p', { className: 'mygo-intro' }, '本页只是宿主里 dsh-my-go 命名空间的视图：不点保存不写任何字节；清空一个可空字段 = 清除该项（回落到上级配置或默认值）；手改 settings.yaml 的 dsh-my-go 段与本面是同一层。'),

    ready ? null : el(BlockedNotice, { card, scope }),
    ready && !writable ? el('div', { className: 'mygo-notice mygo-noticeWarn' }, '这份文档当前只读（宿主拒绝写入）：编辑区照常可看，保存已禁用。') : null,
    drifted ? el('div', { className: 'mygo-notice mygo-noticeWarn', 'data-role': 'drift' },
      el('span', null, `外部已经改过这一命名空间（草稿建在 r${fence}，现在 r${snapshot?.revision}）：你的草稿还在，但保存会被拒。`),
      el('button', { className: 'mygo-btn mygo-btnMini', onClick: discardAndReload }, '丢弃草稿并重读'),
    ) : null,

    el('div', { className: 'mygo-block', 'data-block': 'roles' },
      el('div', { className: 'mygo-blockHead' },
        el('span', { className: 'mygo-blockTitle' }, '模型与角色'),
        el('span', { className: 'mygo-count' }, `${AGENT_TYPES.length} 内置 · ${customRows.length} 自定义`),
        el('span', { className: 'mygo-blockHint' }, '左列选角色，右列只改这一行。'),
      ),
      el('div', { className: 'mygo-grid' },
        el('div', { className: 'mygo-col' },
          el('div', { className: 'mygo-colHead' }, el('span', { className: 'mygo-label' }, '角色清单')),
          el('div', { className: 'mygo-list', role: 'listbox', 'aria-label': '角色清单' }, roleList.map((entry) => el('div', {
            key: entry.key,
            role: 'option',
            'aria-selected': entry.key === selectedKey,
            'data-selected': entry.key === selectedKey,
            className: 'mygo-listRow',
            title: `${entry.label} · ${entry.meta}`,
            onClick: () => pickRole(entry.key),
          },
            el('span', { className: 'mygo-rowName' }, entry.label),
            el('span', { className: 'mygo-rowMeta' }, entry.meta),
            entry.badges.map((badge) => el('span', { key: badge.text, className: 'mygo-rowBadge', 'data-tone': badge.tone ?? '' }, badge.text)),
          ))),
          el('div', { className: 'mygo-colFoot' },
            el('input', {
              className: 'mygo-input mygo-inputMono',
              value: newRoleKey,
              placeholder: '新角色键名（小写字母开头，可含 -）',
              disabled: !writable,
              spellCheck: false,
              'aria-label': '新角色键名',
              onChange: (event) => setNewRoleKey(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') createRole() },
            }),
            el('button', { className: 'mygo-btn', disabled: !writable || !isValidRoleKey(newRoleKey.trim(), customRows), onClick: createRole, title: '新建一个自定义角色并选中它' }, '+ 新建角色'),
            el('button', { className: 'mygo-btn', disabled: !writable, onClick: importRole, title: '粘贴角色 JSON 导入为新角色' }, '导入 JSON'),
          ),
        ),
        el('div', { className: 'mygo-col' }, selectedRole ? renderRolesPane({
          role: selectedRole,
          current,
          writable,
          catalog: models,
          importError,
          personaFileErr,
          setBinding,
          setChain,
          setPersona,
          loadBuiltinPersona,
          onExportRole: exportRole,
          onImportOverwrite: importOverwrite,
          onDeleteRole: deleteRole,
          onRenameRole: renameRole,
          // 键名输入框的受控草稿：只在「仍是同一个选中角色」时生效，否则回落到
          // 当前选中键名（切换/改名成功后自动重置）。
          roleKeyDraft: roleKeyDraftFor === selectedKey && roleKeyDraft !== null ? roleKeyDraft : selectedKey,
          onRoleKeyDraftChange: (value) => { setRoleKeyDraft(value); setRoleKeyDraftFor(selectedKey) },
        }) : null),
      ),
      el('div', { className: 'mygo-detail', 'data-role': 'role-detail' }, roleDetailText(selectedKey, current)),
    ),

    el('div', { className: 'mygo-block', 'data-block': 'prices' },
      el('div', { className: 'mygo-blockHead' },
        el('span', { className: 'mygo-blockTitle' }, '用量单价表'),
        el('span', { className: 'mygo-count' }, `${priceKeys.length} 条`),
        el('span', { className: 'mygo-blockHint' }, '按「渠道/模型」记四类 token 单价，用量面板据此折算成本；不配就只统计 token 数。'),
      ),
      el('div', { className: 'mygo-grid' },
        el('div', { className: 'mygo-col' },
          el('div', { className: 'mygo-colHead' }, el('span', { className: 'mygo-label' }, '计价键')),
          el('div', { className: 'mygo-list', role: 'listbox', 'aria-label': '计价键清单' }, priceKeys.length === 0
            ? el('div', { className: 'mygo-hint' }, '（还没有一条单价：在下方输入「渠道/模型」建第一条）')
            : priceKeys.map((key) => el('div', {
              key,
              role: 'option',
              'aria-selected': key === selectedPrice,
              'data-selected': key === selectedPrice,
              className: 'mygo-listRow',
              title: key,
              onClick: () => setPickedPrice(key),
            },
            el('span', { className: 'mygo-rowName' }, key),
            el('span', { className: 'mygo-rowMeta' }, priceMetaText(current.usagePrices[key])),
          ))),
          el('div', { className: 'mygo-colFoot' },
            el('input', {
              className: 'mygo-input mygo-inputMono',
              value: newPriceKey,
              placeholder: '渠道/模型，如 deepseek/deepseek-chat',
              disabled: !writable,
              list: 'mygo-price-keys',
              spellCheck: false,
              'aria-label': '新计价键',
              onChange: (event) => setNewPriceKey(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') createPrice() },
            }),
            el('datalist', { id: 'mygo-price-keys' }, priceSuggestions(models).map((key) => el('option', { key, value: key }))),
            el('button', { className: 'mygo-btn', disabled: !writable || !isValidPriceKey(newPriceKey.trim(), current), onClick: createPrice }, '+ 新建行'),
          ),
        ),
        el('div', { className: 'mygo-col' }, renderPricesPane({
          selectedPrice,
          current,
          writable,
          keys: priceSuggestions(models),
          setCurrency: (value) => stage((prev) => ({ ...prev, usageCurrency: value })),
          setPrice,
          onDeletePrice: deletePrice,
        })),
      ),
      el('div', { className: 'mygo-detail', 'data-role': 'price-detail' }, priceDetailText(selectedPrice, current, layers)),
    ),

    el('div', { className: 'mygo-block', 'data-block': 'keepAlive' },
      el('div', { className: 'mygo-blockHead' },
        el('span', { className: 'mygo-blockTitle' }, '主编缓存心跳'),
        el('span', { className: 'mygo-count' }, !keepAliveServed ? '宿主未声明' : keepAliveStored.enabled ? '已开启' : '默认关闭'),
        el('span', { className: 'mygo-blockHint' }, !keepAliveServed
          ? UNSERVED_SECTION_HINT
          : `编排会话空闲时按拍距自动唤醒一次低成本维护：保持模型缓存新鲜，并提示长时间无响应的子代理。每拍约占 130 token（默认拍距下约 ${Math.round(3600 / (KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs / 1000))} 拍/小时）——按缓存 TTL × 会话时长取舍。`),
      ),
      el('div', { className: 'mygo-fields' },
        el('div', { className: 'mygo-field' },
          el('label', { className: 'mygo-label' }, '开关'),
          el('label', { className: 'mygo-check' },
            el('input', {
              type: 'checkbox',
              checked: current.keepAlive?.enabled === true,
              disabled: !writable || !keepAliveServed,
              'aria-label': '缓存心跳开关',
              onChange: (event) => setKeepAlive('enabled', event.target.checked),
            }),
            keepAliveStored.enabled ? '启用' : '关闭',
          ),
          el('div', { className: 'mygo-hint' }, '关闭 = 不唤醒：派发后主编静默等待，跨 turn 期间不做任何唤醒。开启会真实唤醒主编，请按缓存 TTL 权衡。'),
        ),
        el('div', { className: 'mygo-field' },
          el('label', { className: 'mygo-label' }, '主编拍距（秒）'),
          el('input', {
            className: 'mygo-input mygo-inputMono',
            type: 'number',
            min: '1',
            value: keepAliveFieldValue('orchestratorIntervalMs'),
            disabled: !writable || !keepAliveServed || !keepAliveStored.enabled,
            'aria-label': '主编拍距（秒）',
            onChange: (event) => setKeepAlive('orchestratorIntervalMs', toMillis(event.target.value)),
          }),
          el('div', { className: 'mygo-hint' }, `空闲主编多久被唤醒一次；默认 ${KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs / 1000} 秒（5 分钟档 TTL 的 5/6，留 1/6 余量——比 prompt 缓存 TTL 还长的一拍等于白醒）。`),
        ),
        el('div', { className: 'mygo-field' },
          el('label', { className: 'mygo-label' }, '子代静默阈值（秒）'),
          el('input', {
            className: 'mygo-input mygo-inputMono',
            type: 'number',
            min: '1',
            value: keepAliveFieldValue('childPingAfterMs'),
            disabled: !writable || !keepAliveServed || !keepAliveStored.enabled,
            'aria-label': '子代静默阈值（秒）',
            onChange: (event) => setKeepAlive('childPingAfterMs', toMillis(event.target.value)),
          }),
          el('div', { className: 'mygo-hint' }, `多久没信号就在摘要里标「建议ping」；默认 ${KEEP_ALIVE_DEFAULTS.childPingAfterMs / 60000} 分钟。`),
        ),
        el('div', { className: 'mygo-field' },
          el('label', { className: 'mygo-label' }, '升级梯（连拍数）'),
          el('input', {
            className: 'mygo-input mygo-inputMono',
            type: 'number',
            min: '1',
            value: keepAliveFieldValue('escalateAfterPings'),
            disabled: !writable || !keepAliveServed || !keepAliveStored.enabled,
            'aria-label': '升级梯连拍数',
            onChange: (event) => setKeepAlive('escalateAfterPings', event.target.value),
          }),
          el('div', { className: 'mygo-hint' }, `连着多少拍建议 ping 而无任何信号即标红（默认 ${KEEP_ALIVE_DEFAULTS.escalateAfterPings}）——标红的子代要求主编当场裁决。`),
        ),
      ),
      // ── 速算区：只算数、只填数 ────────────────────────────────
      // 位置：三字段表单之下、通栏说明条之上——它在视觉上是从属于「主编拍距」
      // 那一行的填数助手（有边框 + 底色，与正式字段区分开）。
      // 硬约束：本节零持久化字段（不进 schema、不进 lib/config.js），三个输入是
      // 组件态；唯一的出口是「填入拍距」那一笔，走 setKeepAlive 写正式字段的草稿。
      el('div', { className: 'mygo-calc', 'data-role': 'keepalive-calc' },
        el('div', { className: 'mygo-calcHead' },
          el('span', { className: 'mygo-calcTitle' }, '速算区'),
          el('span', { className: 'mygo-calcNote' }, '只算数不落库：本节三个输入不写盘、刷新即回默认（填入拍距后才进草稿，仍是草稿，可继续手改）。'),
        ),
        el('div', { className: 'mygo-calcGrid' },
          el('div', { className: 'mygo-calcField' },
            el('label', { className: 'mygo-label' }, '缓存 TTL（秒）'),
            el('input', {
              className: 'mygo-input mygo-inputMono',
              type: 'number',
              min: '1',
              value: calcTtl,
              disabled: calcReadonly,
              'aria-label': '速算-缓存TTL（秒）',
              onChange: (event) => setCalcTtl(event.target.value),
            }),
            el('div', { className: 'mygo-hint' }, `provider 的 prompt 缓存存活多久（默认填 ${KEEP_ALIVE_CALC.defaultTtlSeconds} 秒；1 小时档填 3600）。`),
          ),
          el('div', { className: 'mygo-calcField' },
            el('label', { className: 'mygo-label' }, '输入价（$/M）'),
            el('input', {
              className: 'mygo-input mygo-inputMono',
              type: 'text',
              inputMode: 'decimal',
              value: calcInputPrice,
              placeholder: KEEP_ALIVE_CALC.pricePlaceholder.input,
              disabled: calcReadonly,
              'aria-label': '速算-输入价（$/M）',
              onChange: (event) => setCalcInputPrice(event.target.value),
            }),
            el('div', { className: 'mygo-hint' }, '未命中缓存时每百万输入 token 的价格（你的渠道实价）。'),
          ),
          el('div', { className: 'mygo-calcField' },
            el('label', { className: 'mygo-label' }, '缓存命中价（$/M）'),
            el('input', {
              className: 'mygo-input mygo-inputMono',
              type: 'text',
              inputMode: 'decimal',
              value: calcCachePrice,
              placeholder: KEEP_ALIVE_CALC.pricePlaceholder.cacheRead,
              disabled: calcReadonly,
              'aria-label': '速算-缓存命中价（$/M）',
              onChange: (event) => setCalcCachePrice(event.target.value),
            }),
            el('div', { className: 'mygo-hint' }, '命中缓存时每百万输入 token 的价格（通常便宜一个量级）。'),
          ),
        ),
        el('div', { className: 'mygo-calcOuts' },
          el('div', { className: 'mygo-calcOut', 'data-role': 'calc-interval' },
            el('label', { className: 'mygo-label' }, '建议拍距 = TTL × 5/6'),
            el('span', {
              className: 'mygo-calcValue',
              'data-tone': calc.intervalMs === null ? 'idle' : 'ready',
            }, calc.intervalText),
            el('div', { className: 'mygo-calcActions' },
              el('button', {
                className: 'mygo-btn',
                'data-role': 'calc-fill',
                disabled: calcReadonly || !calc.fillable,
                onClick: fillCalcInterval,
                title: '把建议拍距写进上面的「主编拍距」草稿；不点保存就不写盘',
              }, '填入拍距'),
            ),
          ),
          el('div', { className: 'mygo-calcOut', 'data-role': 'calc-lookahead' },
            el('label', { className: 'mygo-label' }, '前瞻窗口 H =（输入价 ÷ 缓存命中价 − 1）× 拍距'),
            el('span', {
              className: 'mygo-calcValue',
              'data-tone': calc.lookaheadMs === null ? 'idle' : 'ready',
            }, calc.lookaheadText),
            el('div', { className: 'mygo-hint' }, '用途：探过子代理的剩余等待时长后——剩余超过前瞻窗口 H 就暂停心跳，低于 H 则继续（缓存还热着，再等几拍不亏）。'),
            calc.lookaheadNote === null ? null : el('div', { className: 'mygo-hint', 'data-role': 'calc-lookaheadNote' }, calc.lookaheadNote),
          ),
        ),
      ),
      el('div', { className: 'mygo-detail', 'data-role': 'keepalive-detail' }, keepAliveDetailText(current, layers, keepAliveStored, keepAliveServed)),
    ),

    el('div', { className: 'mygo-legend' },
      el('span', null, '链：#1 主选，#2..N 备选，失败按序降级'),
      el('span', null, '覆盖：persona 覆盖了 prompts 文件默认'),
      el('span', null, '工具权限继承宿主；工种 allow/deny 已取消，旧 toolFilter 配置会被忽略。编排防递归约束保留。'),
    ),

    el('div', { className: 'mygo-footer' },
      el('button', {
        className: 'mygo-btnPrimary',
        'data-role': 'save',
        disabled: !writable || !ready || !dirty || saving,
        onClick: save,
        title: '把草稿编译成命名空间 ops，一次原子提交（保存前不写任何字节）',
      }, saving ? '保存中…' : '立即保存'),
      el('button', {
        className: 'mygo-btn',
        disabled: !dirty && !drifted,
        onClick: discardAndReload,
        title: '丢弃未保存草稿并重新读取宿主现值',
      }, '丢弃草稿并重读'),
      el('span', { className: 'mygo-status', 'data-role': 'status' }, statusText({ ready, dirty, pending, revision: snapshot?.revision })),
      message ? el('span', { className: message.ok ? 'mygo-statusOk' : 'mygo-statusError', 'data-role': 'receipt' }, message.text) : null,
    ),
  )
}

/* ── 目录与花名册 ───────────────────────────────────────────────────────── */

/** Model catalog from the host's own session face (lazy, signal-refreshed). */
function useCatalog(catalog) {
  const subscribe = React.useCallback((emit) => (catalog ? catalog.subscribe(emit) : () => {}), [catalog])
  const get = React.useCallback(() => (catalog ? catalog.get() : { status: 'idle', providers: [], models: {}, errors: {} }), [catalog])
  const state = React.useSyncExternalStore(subscribe, get, get)
  React.useEffect(() => {
    catalog?.load?.()
  }, [catalog])
  return state
}

/* ── 小组件与纯投影 ─────────────────────────────────────────────────────── */

function BlockedNotice({ card, scope }) {
  return el('div', { className: 'mygo-notice mygo-noticeError', 'data-role': 'blocked' },
    el('span', null, card.hint),
    card.retryable ? el('button', { className: 'mygo-btn mygo-btnMini', onClick: () => reloadScope(scope) }, '重试') : null,
  )
}

function reloadScope(scope) {
  if (typeof scope?.load === 'function') void scope.load()
  else if (typeof scope?.ensure === 'function') void scope.ensure()
}

export function statusText({ ready, dirty, pending, revision }) {
  const at = typeof revision === 'number' ? ` · r${revision}` : ''
  if (!ready) return `配置未就绪${at}`
  if (!dirty) return `无改动${at}`
  return `待保存：${pending.length > 0 ? pending.join(' · ') : '草稿与现值同形'}${at}`
}

export function roleEntry(key, label, row, carried, builtin) {
  const badges = []
  if (typeof carried?.persona === 'string' && carried.persona !== '') badges.push({ text: '覆盖', tone: 'warn' })
  if (!builtin) badges.push({ text: '自定义' })
  return { key, label, meta: chainText(row), badges, builtin }
}

export function chainText(row) {
  const chain = composeChain(row ?? {})
  const first = chain[0]
  const named = first && (first.provider !== '' || first.model !== '') ? `${first.provider}/${first.model}` : '跟随 Sisyphus'
  return chain.length > 1 ? `${named} →${chain.length - 1}` : named
}

export function roleDetailText(key, current) {
  if (!key) return '左列选一个角色来编辑。'
  const builtin = AGENT_TYPES.includes(key)
  const row = builtin ? (current[key] ?? {}) : (current.roles?.[key] ?? {})
  const chain = composeChain(row)
  const lines = [
    `${AGENT_LABELS[key] ?? key}（${key}）· ${builtin ? '内置工种' : '自定义角色'}`,
    `模型优先级：${chain.map((entry, index) => `#${index + 1} ${entry.provider || '—'}/${entry.model || '—'}`).join('  ')}`,
    `思考档位：${row.reasoningEffort || '跟随模型默认'}`,
  ]
  if (key !== 'sisyphus') lines.push(`人设来源：${personaOverrideSource(current.roles?.[key])}`)
  if (!builtin) {
    lines.push('工具权限继承宿主；旧工种 toolFilter 已忽略。')
    lines.push('派发时 go_work 用键名点名该角色；删除后下次保存整键从 roles 字典移除。')
  }
  return lines.join('\n')
}

export function priceMetaText(row) {
  if (!row) return ''
  const at = (bucket) => (row[bucket] === '' || row[bucket] === undefined || row[bucket] === null ? '—' : String(row[bucket]))
  return `入 ${at('input')} / 出 ${at('output')}`
}

export function priceDetailText(key, current, layers) {
  if (!key) return '还没有任何计价行：用量面板只报 token 数，不折算成本。'
  const row = current.usagePrices?.[key] ?? {}
  const storedRow = layers.value.usagePrices?.[key]
  const unit = current.usageCurrency === 'CNY' ? '人民币' : '美元'
  const lines = [
    `${key} · ${unit} / 1M tokens`,
    PRICE_BUCKETS.map((bucket) => `${PRICE_BUCKET_LABELS[bucket]}：${row[bucket] === '' || row[bucket] === undefined ? '未定价' : row[bucket]}`).join('  '),
    storedRow === undefined ? '该键在宿主现值里还不存在：保存后新增。' : `宿主现值：入 ${storedRow.input} / 出 ${storedRow.output}，缓存读 ${storedRow.cacheRead ?? '未定价'} / 写 ${storedRow.cacheWrite ?? '未定价'}。`,
    '输入/输出必填，缓存两桶可选；不完整的行保存时整行跳过（fail-closed），不会毒杀同批其它行。',
  ]
  return lines.join('\n')
}

export function priceSuggestions(catalog) {
  const map = catalog.models && typeof catalog.models === 'object' ? catalog.models : {}
  return [...new Set(Object.entries(map).flatMap(([provider, ids]) => (Array.isArray(ids) ? ids : []).map((id) => `${provider}/${id}`)))]
}

/**
 * 心跳速算区的只读投影（纯函数，可单测）：两个算式的展示文案 + 各自的可算判据。
 *
 * 为什么文案在这里而不是 keepalive-calc.js：算式与量纲归 calc 模块（那边不认识
 * 中文、也不认识「待填」这类界面态），面向用户的一句话归 settings-core（本文件
 * 一直是纯文本投影的落点：priceDetailText / keepAliveDetailText 同款）。
 *
 * 降级口径（半输入是常态，绝不让框跟用户较劲）：任一输入不可算就出「为什么算不了」
 * 的一句话，而不是 NaN/Infinity/0 这种看着像结果的假数。
 * @param input.ttlSeconds / input.inputPrice / input.cachePrice 用户手填原值
 * @returns { intervalMs, intervalText, fillable, lookaheadMs, lookaheadText, lookaheadNote }
 *   intervalText 里同时给人类可读与秒（正式字段的量纲是秒，填之前要对得上）；
 *   lookaheadNote 非 null 时是那一行下面的小字（降级原因，或 H=0 的口径解释）。
 */
export function keepAliveCalcText({ ttlSeconds, inputPrice, cachePrice } = {}) {
  const intervalMs = intervalMsFromTtl(ttlSeconds)
  const lookahead = lookaheadMs(inputPrice, cachePrice, intervalMs)
  const input = parseCalcNumber(inputPrice)
  const cache = parseCalcNumber(cachePrice)
  let lookaheadNote = null
  if (lookahead === null) {
    if (cache === null || cache === 0) lookaheadNote = '缓存命中价留空或为 0：比价算不出来（这里不做「默认 0.3」之类的兜底猜测）。'
    else if (input === null) lookaheadNote = '输入价留空或不是非负数：比价算不出来。'
    else lookaheadNote = '先把上面的缓存 TTL 填成一个大于 0 的数。'
  } else if (input !== null && cache !== null && input <= cache) {
    // 比价 ≤ 1：命中缓存不比不命中便宜，没有省头 → H 夹到 0（剩余量只要 >0 就该停跳）。
    lookaheadNote = '缓存命中价 ≥ 输入价：命中没有省头，前瞻窗口 H 记 0（剩余只要大于 0 就该暂停心跳）。'
  }
  return {
    intervalMs,
    intervalText: intervalMs === null
      ? '待填 TTL'
      : `${formatDurationHuman(intervalMs)}（${Math.round(intervalMs / 1000)} 秒）`,
    fillable: intervalMs !== null,
    lookaheadMs: lookahead,
    lookaheadText: lookahead === null ? '—' : formatDurationHuman(lookahead),
    lookaheadNote,
  }
}

/** 心跳块的说明条：三个时长的秒/人类可读对账 + 覆盖层说明（纯投影，可单测）。 */
export function keepAliveDetailText(current, layers, stored = keepAliveFrom(current), served = true) {
  const user = layers?.user?.keepAlive
  // fmt：现在与速算区共用同一枚实现（src/keepalive-calc.js）——两处各自维护一份
  // 「秒/分/时」梯子，改一处忘一处就是同一屏里两个口径。
  const fmt = formatDurationHuman
  const lines = [
    stored.enabled
      ? `心跳开启：主编每 ${fmt(stored.orchestratorIntervalMs)} 被唤醒一拍；子代静默超 ${fmt(stored.childPingAfterMs)} 标「建议ping」，连 ${stored.escalateAfterPings} 拍无信号标红。`
      : '心跳关闭：主编派发后静默等待，不做任何周期性唤醒。',
    '摘要是进主编上下文的一条短文本（目标 ≤500 字节）：每个在飞子代一行（childId / 工种 / 本轮已运行 / 距上次信号 / 未回应 ping 数），另附排队数与待决求助数。',
    `未回应 ping 数 = 连着几拍建议了 ping 而该子代仍无任何信号；主编照摘要发一次 continue(steer) 询问即清零。标红的子代要求当场裁决（继续 / 掐断 / 派 explore 验活）。`,
  ]
  if (!served) lines.push('宿主现值里根本没有这一段（宿主进程早于本版本插件）：这一块只读，重启宿主后才会出现这一段与它的保存面。')
  else if (user === undefined) lines.push('本段在宿主现值里还没有用户层覆盖：保存后按默认（关闭）起算，改哪个字段才写哪个字段。')
  else lines.push(`用户层已覆盖 ${Object.keys(user).length} 个字段；把某项改回默认值保存 = 撤销该项覆盖。`)
  return lines.join('\n')
}

export function isValidRoleKey(key, customRows) {
  return typeof key === 'string' && ROLE_KEY_PATTERN.test(key) && !AGENT_TYPES.includes(key) && !customRows.some((row) => row.key === key)
}

export function isValidPriceKey(key, current) {
  return typeof key === 'string' && PRICE_KEY_PATTERN.test(key) && current.usagePrices?.[key] === undefined
}

export function parseRoleText(text) {
  if (text === null || String(text).trim() === '') return { ok: false, error: '没有输入内容' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法 JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'JSON 必须是一个角色对象' }
  const key = typeof parsed.key === 'string' ? parsed.key : ''
  const row = {
    provider: typeof parsed.provider === 'string' ? parsed.provider : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    reasoningEffort: typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : '',
    fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
    persona: typeof parsed.persona === 'string' ? parsed.persona : '',
  }
  return { ok: true, key, row }
}

export function blankRole() {
  return { provider: '', model: '', reasoningEffort: '', fallbacks: [], persona: '' }
}

export function blankPriceRow() {
  return { input: '', output: '', cacheRead: '', cacheWrite: '' }
}

export function emptyDraft() {
  const draft = { roles: {}, usagePrices: {}, usageCurrency: 'USD', keepAlive: keepAliveFrom({}) }
  for (const type of AGENT_TYPES) draft[type] = { provider: '', model: '', reasoningEffort: '', fallbacks: [] }
  return draft
}
