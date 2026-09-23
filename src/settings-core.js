/**
 * dsh-my-go — configuration card (0.5.0-tisitan.3).
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
 *      selected role edited on the right (model priority chain, effort, DSV
 *      patch, persona override, tool allow/deny, card JSON).
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

import { PRICE_KEY_PATTERN, ROLE_KEY_PATTERN, PANEL_RPC_CHANNEL, PANEL_ENDPOINTS, PRICE_BUCKETS, PRICE_BUCKET_LABELS } from '../preset/shared/constants.mjs'
import { composeChain, decomposeChain } from './chain-rows.js'
import { AGENT_LABELS, AGENT_TYPES } from './client-constants.js'
import { mountSettingsStyles } from './client-styles.js'
import { normalizeRoleRows, personaOverrideSource, resolveBuiltinPersonaResult, withPersonaOverride } from './roster-rows.js'
import { attachBeforeUnloadGuard, describeSaveOutcome, resolveCardView } from './settings-guard.js'
import { buildSettingsOps, compareKey, draftFromSection, dirtyLabels, summaryLine, writeLanded } from './settings-ops.js'
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
  const [fence, setFence] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState(null)
  const [picked, setPicked] = React.useState(AGENT_TYPES[0])
  const [pickedPrice, setPickedPrice] = React.useState(null)
  const [newRoleKey, setNewRoleKey] = React.useState('')
  const [toolDrafts, setToolDrafts] = React.useState({})
  const [importError, setImportError] = React.useState('')
  const [newPriceKey, setNewPriceKey] = React.useState('')
  const [personaFileErr, setPersonaFileErr] = React.useState({})

  const card = resolveCardView(snapshot)
  const ready = card.kind === 'ready'
  const layers = ready ? { value: snapshot.value, base: snapshot.base, user: snapshot.user } : { value: {}, base: {}, user: {} }
  const stored = ready ? draftFromSection(snapshot.value) : null
  const current = draft ?? stored ?? emptyDraft()
  const dirty = draft !== null && compareKey(draft) !== compareKey(stored ?? emptyDraft())
  const pending = draft === null ? [] : dirtyLabels(draft, snapshot?.value ?? {})
  const drifted = draft !== null && typeof fence === 'number' && typeof snapshot?.revision === 'number' && fence !== snapshot.revision
  const writable = ready && snapshot.writable !== false && snapshot.mode !== 'memory'

  const models = useCatalog(catalog)
  const tools = useToolRoster(connection)

  React.useEffect(() => {
    if (!dirty) return undefined
    return attachBeforeUnloadGuard(typeof window === 'undefined' ? undefined : window)
  }, [dirty])

  // 草稿建立只在「第一次打开编辑」时记栅栏（那一刻的 revision）；此后外部提交
  // 一律走漂移提示，绝不动用户手里的东西。
  const stage = (updater) => {
    setDraft((prev) => updater(prev ?? stored ?? emptyDraft()))
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
    setFence(null)
    setMessage(null)
    reload()
  }

  const save = async () => {
    if (!draft || !writable || saving) return
    setSaving(true)
    setMessage(null)
    try {
      const ops = buildSettingsOps(draft, layers)
      const before = { value: snapshot.value, base: snapshot.base }
      await scope.mutate(ops, typeof fence === 'number' ? fence : undefined)
      const after = scope.getSnapshot()
      const landed = ready
        && after?.status === 'ready'
        && writeLanded(draft, before, ops)
        && compareKey(draftFromSection(after.value)) === compareKey(draft)
      setMessage(describeSaveOutcome(landed, after?.revision))
      if (landed) {
        setDraft(null)
        setFence(null)
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
  const selectedBuiltin = AGENT_TYPES.includes(selectedKey)

  const rowOf = (key) => (AGENT_TYPES.includes(key) ? { ...current[key], ...partialOf(key) } : { ...current.roles?.[key] })
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

  const setToolFilter = (key, filter) => stage((prev) => ({
    ...prev,
    roles: { ...prev.roles, [key]: { ...prev.roles?.[key], toolFilter: { allow: [...(filter.allow ?? [])], deny: [...(filter.deny ?? [])] } } },
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
    setPicked(key)
    setImportError('')
  }

  const deleteRole = (key) => {
    stage((prev) => {
      const roles = { ...prev.roles }
      delete roles[key]
      return { ...prev, roles }
    })
    setPicked(AGENT_TYPES[0])
  }

  const renameRole = (from, to) => {
    const next = String(to).trim()
    if (!isValidRoleKey(next, customRows)) {
      setImportError(`键名「${next}」非法或已存在（内置名与小写-规则同样拒收）`)
      return
    }
    stage((prev) => {
      const roles = { ...prev.roles }
      roles[next] = { ...roles[from], }
      delete roles[from]
      return { ...prev, roles }
    })
    setPicked(next)
    setImportError('')
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
    setPicked(key)
    setImportError('')
  }

  // ── 单价清单 ─────────────────────────────────────────────────────────────
  const priceKeys = Object.keys(current.usagePrices ?? {}).sort()
  const selectedPrice = priceKeys.includes(pickedPrice ?? '') ? pickedPrice : (priceKeys[0] ?? null)

  const setPrice = (key, bucket, value) => stage((prev) => ({
    ...prev,
    usagePrices: { ...prev.usagePrices, [key]: { ...prev.usagePrices?.[key], [bucket]: value } },
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
    el('p', { className: 'mygo-intro' }, '本页只是宿主里 dsh-my-go 命名空间的视图：不点保存不写任何字节；清空一个可空字段等于发 unset（回落到 cordis 行 config 或 schema 默认）；手改 settings.yaml 的 dsh-my-go 段与本面是同一层。'),

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
            onClick: () => setPicked(entry.key),
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
          tools: tools.names,
          rosterFailed: tools.failed,
          toolDrafts,
          setToolDrafts,
          importError,
          personaFileErr,
          setBinding,
          setChain,
          setPersona,
          setToolFilter,
          loadBuiltinPersona,
          onExportRole: exportRole,
          onImportOverwrite: importOverwrite,
          onDeleteRole: deleteRole,
          onRenameRole: renameRole,
          onRefreshTools: tools.refresh,
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

    el('div', { className: 'mygo-legend' },
      el('span', null, '链：#1 主选，#2..N 备选，失败按序降级'),
      el('span', null, '覆盖：persona 覆盖了 prompts 文件默认'),
      el('span', null, 'DSV：两阶段锚定注入，仅 DeepSeek V4 Pro 0813'),
      el('span', null, '未连接：工具名不在宿主花名册（MCP 未连或手填）'),
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

/** The tool roster (listTools RPC): a snapshot the user may re-pull by hand. */
function useToolRoster(connection) {
  const [names, setNames] = React.useState([])
  const [failed, setFailed] = React.useState(false)
  const load = React.useCallback(() => {
    if (!connection?.rpc?.call) return
    connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.listTools, {})
      .then((res) => {
        if (res && res.ok && Array.isArray(res.value)) {
          setNames(res.value.filter((name) => typeof name === 'string' && name !== ''))
          setFailed(false)
        } else {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
  }, [connection])
  React.useEffect(() => {
    load()
  }, [load])
  return { names, failed, refresh: load }
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
  if (row?.dsv4p0813 === true) badges.push({ text: 'DSV', tone: 'on' })
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
  const filter = row.toolFilter ?? {}
  const lines = [
    `${AGENT_LABELS[key] ?? key}（${key}）· ${builtin ? '内置工种' : '自定义角色'}`,
    `模型优先级：${chain.map((entry, index) => `#${index + 1} ${entry.provider || '—'}/${entry.model || '—'}`).join('  ')}`,
    `思考档位：${row.reasoningEffort || '跟随模型默认'}；DSV4P0813：${row.dsv4p0813 === true ? '开' : '关'}`,
  ]
  if (key !== 'sisyphus') lines.push(`人设来源：${personaOverrideSource(current.roles?.[key])}`)
  if (!builtin) {
    const allow = Array.isArray(filter.allow) ? filter.allow : []
    const deny = Array.isArray(filter.deny) ? filter.deny : []
    lines.push(`工具面：白名单 ${allow.length} 条${allow.length > 0 ? `（${allow.join(', ')}）` : ''}；黑名单 ${deny.length} 条${deny.length > 0 ? `（${deny.join(', ')}）` : ''}`)
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
  const filter = parsed.toolFilter && typeof parsed.toolFilter === 'object' ? parsed.toolFilter : {}
  const row = {
    provider: typeof parsed.provider === 'string' ? parsed.provider : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    reasoningEffort: typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : '',
    dsv4p0813: parsed.dsv4p0813 === true,
    fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
    persona: typeof parsed.persona === 'string' ? parsed.persona : '',
    toolFilter: {
      allow: Array.isArray(filter.allow) ? filter.allow.map(String).filter((name) => name !== '') : [],
      deny: Array.isArray(filter.deny) ? filter.deny.map(String).filter((name) => name !== '') : [],
    },
  }
  return { ok: true, key, row }
}

export function blankRole() {
  return { provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] } }
}

export function blankPriceRow() {
  return { input: '', output: '', cacheRead: '', cacheWrite: '' }
}

export function emptyDraft() {
  const draft = { roles: {}, usagePrices: {}, usageCurrency: 'USD' }
  for (const type of AGENT_TYPES) draft[type] = { provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [] }
  return draft
}
