/**
 * dsh-my-go — settings page core (tisitan.15 split).
 *
 * SettingsPage skeleton + draft lifecycle (load/null-gate/save), the eight
 * built-in specialist cards (model priority chain, persona override) and
 * the save row. The custom-roles section and the tool-mask
 * dual-list render through roles-editor.js / tool-mask-editor.js, which
 * receive every piece of state explicitly via their deps objects — no
 * module-level mutable state anywhere.
 *
 * Unsaved-work / concurrent-write defense (tisitan.9 E6/A-03): every draft
 * mutation goes through mutateDraft (dirty flag), the dirty flag arms a
 * beforeunload guard, the host revision travels load → save and a conflict
 * response locks saving until an explicit reload. The interpretation helpers
 * live in settings-guard.js so they are unit-testable without a DOM.
 */

import * as React from 'react'

import { composeChain, decomposeChain, addChainEntry, removeChainEntry, moveChainEntry, updateChainEntry, stripEmptyFallbackRows } from './chain-rows.js'
import { builtinSummaryText, withPersonaOverride, personaOverrideSource, resolveBuiltinPersonaResult } from './roster-rows.js'
import { interpretLoadResult, interpretSaveResult, attachBeforeUnloadGuard } from './settings-guard.js'
import { renderRolesEditor } from './roles-editor.js'
import { renderToolMaskEditor } from './tool-mask-editor.js'
import { AGENT_TYPES, AGENT_LABELS, AGENT_BLURBS, ACCENT_QUEUE, MONO_FONT } from './client-constants.js'

export function SettingsPage({ scope: sp, connection, close }) {
  const [draft, setDraft] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState(null)
  const [available, setAvailable] = React.useState({ providers: [], models: {}, errors: {} })
  // 加载态三分（tisitan.20）：draft=null 时靠 loadError 区分「加载中」与「加载
  // 失败」——初始渲染不再误报失败横幅；modelsReady 区分 listModels 未返回与
  // 确实拉不到 Provider 列表（fetchFailed 提示只在确认失败后出现）
  const [loadError, setLoadError] = React.useState(false)
  const [modelsReady, setModelsReady] = React.useState(false)
  // 未保存/并发写防线（tisitan.9 E6/A-03）：
  //  - dirty：任何一次草稿变更置位，保存成功即复位（配合 beforeunload 与角标）
  //  - revision：loadSettings 带回来的不透明版本凭据，保存时原样带回
  //  - conflict：host 判定「他处已改」后锁死保存，直到用户主动重新加载
  const [dirty, setDirty] = React.useState(false)
  const [revision, setRevision] = React.useState(null)
  const [conflict, setConflict] = React.useState(null)
  const [reloadNonce, setReloadNonce] = React.useState(0)
  // 工具屏蔽（tisitan.13）：花名册快照 + 左列过滤词 + 双列选中项 + 手填工具名
  const [roster, setRoster] = React.useState([])
  const [maskFilter, setMaskFilter] = React.useState('')
  const [maskSelL, setMaskSelL] = React.useState(null)
  const [maskSelR, setMaskSelR] = React.useState(null)
  const [maskManual, setMaskManual] = React.useState('')
  // 自定义角色（tisitan.14）：新建名输入 + 各角色 toolFilter 手填草稿
  const [newRoleKey, setNewRoleKey] = React.useState('')
  const [roleToolDrafts, setRoleToolDrafts] = React.useState({})
  const [importError, setImportError] = React.useState('')
  const [openCards, setOpenCards] = React.useState({})
  // 内置卡「载入文件默认」按工种记录红字错误（RPC 失败/文件缺失）
  const [personaFileErr, setPersonaFileErr] = React.useState({})

  React.useEffect(() => {
    if (!sp) return
    // 读写一律走 host RPC，不用注入的 settingsScope：设置页的写形状是 roles
    // dict 的 path-ops（set/unset 混合、脏键过滤、缺失键整删、旧顶级键迁移），
    // 这套编译规则与 bindings 合并逻辑同属 lib 半唯一权威，浏览器侧再抄一份就
    // 成了两处真相。sp 在这里只是「设置服务在不在」的门禁。
    // （旧注释写的「DSH SettingsScope doesn't support nested reads」是伪前提，
    // 宿主 scope.get() 返回整份命名空间值，嵌套读从来不是问题——tisitan.9 修正。
    // 真要迁到 scope 是另一件事：得先把 ops 编译面搬到浏览器侧，另立专项。）
    if (connection && connection.rpc && typeof connection.rpc.call === 'function') {
      connection.rpc.call('/dsh-my-go', 'loadSettings', {}).then((res) => {
        // 加载失败保持 draft=null 并禁用保存：空 draft 保存会清空全部配置；
        // 失败经 loadError 亮红字横幅，不再完全静默
        const loaded = interpretLoadResult(res)
        if (loaded.status === 'ok') {
          setDraft(loaded.draft)
          setRevision(loaded.revision)
          setDirty(false)
          setConflict(null)
          setLoadError(false)
        } else {
          setDraft(null); setLoadError(true)
        }
      }).catch(() => { setDraft(null); setLoadError(true) })
      connection.rpc.call('/dsh-my-go', 'listModels', {}).then((res) => {
        // models 字段一并校验：畸形响应（models 非对象）整体丢弃，不让
        // Object.values 在渲染期炸整页（tisitan.20 D5）
        if (res && res.ok && res.value && Array.isArray(res.value.providers)
          && res.value.models !== null && typeof res.value.models === 'object') setAvailable(res.value)
      }).catch(() => {}).finally(() => setModelsReady(true))
      connection.rpc.call('/dsh-my-go', 'listTools', {}).then((res) => {
        // 花名册拉取失败保持空数组：右列条目全部带「未连接」徽章，不阻塞编辑
        if (res && res.ok && Array.isArray(res.value)) setRoster(res.value)
      }).catch(() => {})
    } else {
      // 无可用 RPC 通道：等同加载失败，亮横幅而不是停在「加载中」
      setLoadError(true)
    }
  }, [sp, reloadNonce])

  // 一切草稿变更都经 mutateDraft：先置 dirty 再改 draft（E6/A-03）——dirty 是
  // 保守过近似（同值改写也算改），宁可多拦一次也不漏放一次未保存的关闭。
  // 唯一豁免是上面的 loadSettings 回写，它直接吃 setDraft，不该被当成用户编辑。
  const mutateDraft = (updater) => {
    setDirty(true)
    setDraft(updater)
  }

  // 关页签/刷新前拦一道（E6/A-03）：宿主 settings.section 只给 `close`（弹窗
  // 开合状态归 shell，没有 onClose/卸载时机可挂——见 dsh-client-ui-settings
  // SettingsSectionOwnerProps），所以页内用「保存并关闭」把 close 用起来，页外
  // 靠 beforeunload 兜住标签页关闭与刷新。hook 必须在下面的早退之前，
  // 否则 sp 有无会让 hook 数量变化（React 硬约束）。
  React.useEffect(() => {
    if (!dirty) return undefined
    const win = typeof window === 'undefined' ? undefined : window
    return attachBeforeUnloadGuard(win)
  }, [dirty])

  if (!sp) return React.createElement('div', { style: { padding: 16, color: '#888' } }, '设置服务不可用')

  // 标量编辑（reasoningEffort / dsv4p0813）：draft 为 null（尚未加载/加载
  // 失败）时拒绝编辑——与 setDeny/setPersonaOverride 同款 null-gate，外层
  // 拦截 + 函数式 prev 守卫双保险，避免从 null 造出半截 draft 后保存清空配置
  const set = (type, field, value) => {
    if (!draft) return
    mutateDraft((prev) => {
      if (!prev) return prev
      return { ...prev, [type]: { ...prev?.[type], [field]: value } }
    })
  }

  // 模型优先级编辑（tisitan.19）：编辑发生在合并链投影上，decompose 回
  // provider/model/fallbacks 三字段一次性写回——存储形状零变更。draft 里
  // fallbacks 始终以数组提交；空链提交为 []，host 半 saveSettings 会自动转
  // unset，前端无需特判。null-gate 同 set（tisitan.20）
  const setChain = (type, chainRow) => {
    if (!draft) return
    mutateDraft((prev) => prev ? { ...prev, [type]: { ...prev?.[type], provider: chainRow.provider, model: chainRow.model, fallbacks: chainRow.fallbacks } } : prev)
  }

  // 工具屏蔽编辑：deny 始终以数组提交；空数组提交 []，host 半转 unset。
  // draft 为 null（尚未加载/加载失败）时拒绝编辑：避免从 null 造出只有
  // toolMask 的半截 draft，保存时把其余配置全部 unset 清空。
  const setDeny = (rows) => {
    if (!draft) return
    mutateDraft((prev) => prev ? { ...prev, toolMask: { deny: rows } } : prev)
  }

  // 内置工种人设覆盖（tisitan.15）：写 roles 形状部分行（只带 persona
  // 字段，透传既有字段），host 端显式字段才写——绝不清掉已配的绑定
  const setPersonaOverride = (type, text) => {
    if (!draft) return
    mutateDraft((prev) => prev ? { ...prev, roles: { ...(prev.roles ?? {}), [type]: withPersonaOverride(prev.roles?.[type], text) } } : prev)
  }

  // 载入文件默认（tisitan.16b）：拉 prompts/<type>.md 原文填入 textarea，
  // 成为未保存草稿（点「立即保存」才落盘，沿用现有草稿流）；draft=null
  // 拒编辑沿用 setPersonaOverride 的 null-gate，RPC 失败按卡红字提示。
  const loadBuiltinPersona = async (type) => {
    if (!draft) return
    if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
      setPersonaFileErr((prev) => ({ ...prev, [type]: '连接不可用' }))
      return
    }
    try {
      const res = await connection.rpc.call('/dsh-my-go', 'getBuiltinPersona', { type })
      const parsed = resolveBuiltinPersonaResult(res)
      if (parsed.ok) {
        setPersonaOverride(type, parsed.persona)
        setPersonaFileErr((prev) => ({ ...prev, [type]: '' }))
      } else {
        setPersonaFileErr((prev) => ({ ...prev, [type]: parsed.message }))
      }
    } catch (e) {
      setPersonaFileErr((prev) => ({ ...prev, [type]: String(e) }))
    }
  }
  const toggleCard = (id) => setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }))
  const cardOpen = (id) => openCards[id] === true

  // 保存边界归一（tisitan.20 D1）：剔除 provider/model 全空的备选条目后提交。
  // 空备选行在 host 半 pickFallbackEntry（lib/index.js:1354）只会 warn+跳过、
  // 且虚增 attempt/total 计数，零正语义——不落盘。过滤放保存边界而非
  // decomposeChain：链视图写回须与 composeChain 往返无损（添加空行后立即
  // 消失会毁掉编辑流），编辑期空行照常保留。
  const buildPersistDraft = (source) => {
    const out = { ...source }
    for (const type of AGENT_TYPES) {
      const cfg = source[type]
      if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) out[type] = stripEmptyFallbackRows(cfg)
    }
    if (source.roles && typeof source.roles === 'object' && !Array.isArray(source.roles)) {
      const roles = { ...source.roles }
      for (const [key, row] of Object.entries(roles)) {
        if (row && typeof row === 'object' && !Array.isArray(row)) roles[key] = stripEmptyFallbackRows(row)
      }
      out.roles = roles
    }
    return out
  }

  // Manual save only — auto-save risks infinite loops with settings/updated events
  // 返回是否保存成功（「保存并关闭」据此决定要不要真的关页）
  const save = async () => {
    if (!draft) { setMsg('配置尚未加载成功，已禁止保存以避免覆盖'); return false }
    if (conflict) { setMsg(conflict); return false }
    setSaving(true); setMsg(null)
    try {
      if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
        setMsg('连接不可用'); return false
      }
      const body = buildPersistDraft(draft)
      // 并发写围栏（E6/A-03）：把加载时拿到的版本凭据原样带回。host 若在期间
      // 观测到别的提交，就回 conflict——旧写法是后写覆盖前写，谁也不知道自己
      // 洗掉了别人刚存的配置。revision=null（旧 host 半不回版本号）时不带键，
      // 语义退回无围栏写，绝不发明 0 之类的假凭据。
      if (typeof revision === 'number') body.revision = revision
      const outcome = interpretSaveResult(await connection.rpc.call('/dsh-my-go', 'saveSettings', body))
      if (outcome.status === 'saved') {
        setDirty(false)
        setConflict(null)
        // 保存即推进版本：不adopt 新凭据，用户接着改第二处就会自撞一次假冲突
        if (typeof outcome.revision === 'number') setRevision(outcome.revision)
        setMsg(outcome.message)
        return true
      }
      if (outcome.status === 'conflict') {
        // 手里这份 draft 的基线已作废：锁保存直到用户主动重新加载（不做静默
        // 重读合并——那等于替用户决定谁的改动赢）
        setConflict(outcome.message)
        setMsg(outcome.message)
        return false
      }
      setMsg(outcome.message)
      return false
    } catch (e) {
      setMsg('保存失败: ' + String(e))
      return false
    } finally { setSaving(false) }
  }

  // close 来自宿主 settings.section（唯一 shell affordance）：只在「保存并关闭」
  // 这条我们自己的路径上用——保存失败/冲突绝不关，未保存的草稿不会被静默丢弃
  const saveAndClose = async () => {
    if (await save() && typeof close === 'function') close()
  }

  const reloadDraft = () => {
    setConflict(null)
    setMsg(null)
    setDirty(false)
    setLoadError(false)
    setDraft(null)
    setReloadNonce((n) => n + 1)
  }

  const selectStyle = { background: 'var(--surface, #1e1e1e)', color: 'var(--text, #e0e0e0)', border: '1px solid var(--separator, #333)', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box' }
  const labelStyle = { fontSize: 12, color: 'var(--text-secondary, #888)', marginBottom: 2 }
  const hintStyle = { fontSize: 11, color: 'var(--text-secondary, #888)', marginTop: 2 }
  const cardStyle = { border: '1px solid var(--separator, #333)', borderRadius: 8, padding: 12, marginBottom: 12 }
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }
  const miniBtnStyle = { padding: '2px 8px', borderRadius: 4, border: '1px solid var(--separator, #333)', background: 'transparent', color: 'var(--text, #e0e0e0)', cursor: 'pointer', fontSize: 12 }
  const chainRowStyle = { display: 'grid', gridTemplateColumns: 'minmax(56px, auto) 1fr 1fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }
  const primaryBadgeStyle = { fontSize: 10, padding: '0 5px', borderRadius: 4, background: 'rgba(76,175,80,0.15)', color: '#4caf50', border: '1px solid rgba(76,175,80,0.4)', flexShrink: 0 }
  const glyphStyle = { fontSize: 10, color: 'var(--text-secondary, #888)', flexShrink: 0 }
  const summaryStyle = { fontSize: 11, color: 'var(--text-secondary, #888)', marginTop: 3, overflowWrap: 'anywhere' }

  const EFFORTS = ['', 'low', 'high', 'max']
  const providers = available.providers
  const effortLabel = (v) => v === '' ? '跟随模型默认（不单独指定）' : ({ low: '低（low）', high: '高（high）', max: '最高（max）' }[v] ?? v)

  // disabled 参数（tisitan.20）：draft=null 时所有下拉一并锁定（调用方传
  // !draft），与保存禁用同口径——控件可交互但改动被 null-gate 静默吞掉只会
  // 造成「点了没反应」的困惑，不如直接禁用
  const makeSelect = (value, options, labelFn, onChange, disabled = false) =>
    React.createElement('select', { style: selectStyle, value: value ?? '', disabled, onChange: (e) => onChange(e.target.value) },
      ...options.map((opt) =>
        React.createElement('option', { key: opt, value: opt }, labelFn(opt))
      )
    )

  // 可手填组合框（tisitan.9 A-06）：兑现页面顶部「下拉框也可以直接输入自定义
  // 值」的承诺。旧 makeSelect 是裸 `<select>`——LLM 清单拉不到或渠道没上报模型
  // 时，用户唯一能做的就是一路刷新碰运气，而文案早就许诺了手填。这里用
  // input + datalist（与 roles-editor 工具名输入同一模式）：清单在场时点选照旧，
  // 清单缺席/不全时直接键入，空值仍 = 跟随 Sisyphus（placeholder 说清楚）。
  // 每格包一层 div：chain 行是四列网格，input 与 datalist 得算一个网格项。
  const makeCombobox = (value, options, listId, placeholder, onChange, disabled = false) =>
    React.createElement('div', { style: { minWidth: 0 } },
      React.createElement('input', {
        style: { ...selectStyle, fontFamily: MONO_FONT },
        value: value ?? '',
        list: listId,
        placeholder,
        disabled,
        spellCheck: false,
        onChange: (e) => onChange(e.target.value),
      }),
      React.createElement('datalist', { id: listId },
        ...options.filter((opt) => opt !== '').map((opt) => React.createElement('option', { key: opt, value: opt })),
      ),
    )

  // Compute per-type model list: when provider is set, filter to that provider's models; otherwise show all
  const modelsForProvider = (providerId) => {
    // models 缺席/非对象时归空：listModels 畸形响应不炸渲染（tisitan.20 D5）
    const modelsMap = available.models && typeof available.models === 'object' ? available.models : {}
    if (!providerId) return [...new Set(Object.values(modelsMap).flat())]
    const specific = modelsMap[providerId]
    return Array.isArray(specific) ? specific : []
  }

  // 渠道级失败标记（tisitan.9 A-06）：lib 半 listModels 现在逐渠道回报错误，
  // 「清单读取失败」与「该渠道确实没有模型」从此可分——旧写法把失败渠道的键
  // 直接删掉，前端只能显示一张空清单，用户以为 provider 是坏的。
  const modelListErrorFor = (providerId) => {
    if (!providerId) return ''
    const errors = available.errors && typeof available.errors === 'object' ? available.errors : {}
    const detail = errors[providerId]
    return typeof detail === 'string' && detail !== '' ? detail : ''
  }

  // 模型优先级编辑器（tisitan.19，内置工种卡与自定义角色卡共用）：主选与
  // 备选链合并为单一列表——#1 即主选（带徽章，空值=跟随 Sisyphus），#2..N
  // 即备选链顺序。链视图为编辑期唯一真源：渲染经 composeChain 投影、编辑经
  // decomposeChain 写回存储形状（provider/model/fallbacks）。跨 #1/#2 边界
  // 移动即「一键扶正」（备选 ↑ 到顶换位成主选）；删除守卫：链至少保留主选
  // 位 1 条。keyPrefix 只是 React key 的行前缀（内置卡传工种名、角色卡传
  // `role-<key>`），避免同页两处链的行 key 撞车——不参与任何数据流。
  // disabled（tisitan.20）：draft=null 时整条链只读（select + 三按钮 + 添加行）
  const renderChainEditor = (keyPrefix, cfg, onChange, disabled = false) => {
    const chain = composeChain(cfg)
    const apply = (next) => onChange(decomposeChain(next))
    return React.createElement('div', { style: { marginBottom: 8 } },
      React.createElement('div', { style: labelStyle }, '模型优先级（主选 + 备选链）'),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary, #888)', marginBottom: 6 } },
        '#1 为主选；主模型失败（限流重试耗尽后）按序自动切换后续条目。备选 ↑ 到顶 = 一键扶正为主选；删除 #1 则 #2 自动扶正。',
      ),
      chain.map((row, i) => {
        const listError = modelListErrorFor(row.provider)
        return React.createElement(React.Fragment, { key: `${keyPrefix}-chain-${i}` },
          React.createElement('div', { style: chainRowStyle },
            React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary, #888)', display: 'flex', alignItems: 'center', gap: 4 } },
              `#${i + 1}`,
              i === 0 ? React.createElement('span', { style: primaryBadgeStyle }, '主选') : null,
            ),
            makeCombobox(row.provider, providers, `${keyPrefix}-${i}-providers`,
              i === 0 ? '跟随 Sisyphus（可点选或手填渠道）' : '（渠道：可点选或手填）',
              (v) => apply(updateChainEntry(chain, i, 'provider', v)), disabled),
            makeCombobox(row.model, modelsForProvider(row.provider), `${keyPrefix}-${i}-models`,
              i === 0 ? '跟随 Sisyphus（可点选或手填模型）' : '（模型：可点选或手填）',
              (v) => apply(updateChainEntry(chain, i, 'model', v)), disabled),
            React.createElement('div', { style: { display: 'flex', gap: 4 } },
              React.createElement('button', { style: miniBtnStyle, disabled: disabled || i === 0, title: '上移（#2 到顶即扶正为主选）', onClick: () => apply(moveChainEntry(chain, i, -1)) }, '↑'),
              React.createElement('button', { style: miniBtnStyle, disabled: disabled || i === chain.length - 1, title: '下移（更后尝试）', onClick: () => apply(moveChainEntry(chain, i, 1)) }, '↓'),
              React.createElement('button', { style: miniBtnStyle, disabled: disabled || chain.length <= 1, title: '删除该行（至少保留主选位；删 #1 则 #2 扶正）', onClick: () => apply(removeChainEntry(chain, i)) }, '×'),
            ),
          ),
          // 行内渠道失败提示（tisitan.9 A-06）：与「该渠道真的没有模型」区分——
          // 清单没拉上来，不是清单为空
          listError
            ? React.createElement('div', { style: { ...hintStyle, marginTop: -2, marginBottom: 6, color: ACCENT_QUEUE } },
                `⚠ 渠道 ${row.provider} 的模型清单读取失败：${listError}（可直接手填模型名，不影响保存）`)
            : null,
        )
      }),
      React.createElement('button', { style: miniBtnStyle, disabled, onClick: () => apply(addChainEntry(chain)) }, '+ 添加条目'),
    )
  }

  // 只在 listModels 确认返回（成败都算）后才允许亮「拉不到列表」提示——
  // 加载途中的空列表不再误报（tisitan.20 I4）
  const fetchFailed = modelsReady && available.providers.length === 0

  return React.createElement('div', { style: { padding: 16, maxWidth: 600 } },
    React.createElement('h2', { style: { margin: '0 0 4px' } }, 'MyGO 编排配置'),
    React.createElement('p', { style: { margin: '0 0 6px', fontSize: 13, color: 'var(--text-secondary, #888)' } }, '给每个工种单独指定模型；留空 = 跟随 Sisyphus（即您在对话框里选的模型）。改完点「立即保存」，下次派发生效。'),
    fetchFailed ? React.createElement('div', {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', fontSize: 13 },
    }, '⚠ 暂时读不到 DSH 的 Provider/Model 列表——确认 dsh web 已重启、LLM 插件已配置并激活后，回来刷新即可。不影响手填：渠道与模型两栏都是可手填输入框，清单在场时点选即可。') : null,
    // 加载失败红字横幅（tisitan.20 Z1'）：与「加载中」可区分，保存已被禁用
    loadError ? React.createElement('div', {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', fontSize: 13 },
    }, '⚠ 配置加载失败（loadSettings 不可用或返回错误）——为防清空配置已禁用全部编辑与保存，请确认插件已激活后刷新重试。') : null,
    // 并发写冲突横幅（tisitan.9 E6/A-03）：他处已经改过这份配置，保存被锁，
    // 唯一出路是显式重新加载（草稿会被丢弃——所以顺带把 beforeunload 的语义
    // 也说清楚，用户知道自己手里有未保存的东西）
    conflict ? React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 16, borderRadius: 6, background: 'rgba(230,162,60,0.12)', border: '1px solid rgba(230,162,60,0.45)', fontSize: 13 },
    },
      React.createElement('span', { style: { color: ACCENT_QUEUE, fontWeight: 600 } }, '⚠ ' + conflict),
      React.createElement('button', {
        style: miniBtnStyle,
        title: '丢弃当前草稿，重新读取最新配置（未保存的修改会丢失）',
        onClick: reloadDraft,
      }, '重新加载'),
    ) : null,
    !draft && !loadError ? React.createElement('div', {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, border: '1px solid var(--separator, #333)', fontSize: 13, color: 'var(--text-secondary, #888)' },
    }, '配置加载中…') : null,
    ...AGENT_TYPES.map((type) => {
      const cfg = draft?.[type] || {}
      const open = cardOpen(type)
      return React.createElement('div', { key: type, style: cardStyle },
        // 卡片标题行：工种中文名 + 英文名（AGENT_LABELS 已合并）+ 一句话角色说明
        React.createElement('div', {
          style: { cursor: 'pointer', marginBottom: open ? 8 : 0 },
          onClick: () => toggleCard(type),
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            React.createElement('span', { style: glyphStyle }, open ? '▾' : '▸'),
            React.createElement('span', { style: { fontWeight: 600 } }, AGENT_LABELS[type] || type),
            React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary, #888)' } }, AGENT_BLURBS[type] ?? ''),
          ),
          React.createElement('div', { style: summaryStyle }, builtinSummaryText(cfg)),
        ),
        open ? React.createElement(React.Fragment, null,
          // Sisyphus 卡片语义（broker.mjs:599,1580）：绑定仅当插件配置
          // bindSisyphus===true 才参与 agent/request 覆盖，默认完全跟随对话框模型
          type === 'sisyphus'
            ? React.createElement('div', { style: { ...hintStyle, marginBottom: 8 } }, '总调度只认对话框所选模型，此处配置为兜底/补丁位（仅当插件配置 bindSisyphus 开启时生效）。')
            : null,
          // 模型优先级列表（tisitan.19）：主选（#1）与备选链（#2..N）合并编辑
          renderChainEditor(type, cfg, (chainRow) => setChain(type, chainRow), !draft),
          React.createElement('div', { style: rowStyle },
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, '思考档位（Reasoning Effort）'),
              React.createElement('div', { style: hintStyle }, '推理强度：越高越聪明，也越贵'),
              makeSelect(cfg.reasoningEffort ?? '', EFFORTS, effortLabel, (v) => set(type, 'reasoningEffort', v), !draft),
            ),
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, 'DSV4P0813 补丁'),
              // 棒4-Z3（tisitan.20）：Sisyphus 卡置灰锁定——注入识别面
              // typeOfAgent（broker.mjs:527-534）恒不命中 sisyphus 会话，勾选
              // 永不生效，留可勾选只会误导
              React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: draft && type !== 'sisyphus' ? 'pointer' : 'not-allowed', fontSize: 13, paddingTop: 2 } },
                React.createElement('input', { type: 'checkbox', checked: cfg.dsv4p0813 === true, disabled: !draft || type === 'sisyphus', onChange: (e) => set(type, 'dsv4p0813', e.target.checked) }),
                '启用',
              ),
              React.createElement('div', { style: hintStyle },
                type === 'sisyphus'
                  ? 'Sisyphus 会话不经过 DSV4P0813 注入识别面，勾选对其不生效，已置灰锁定'
                  : '两阶段锚定上下文注入，专为 DeepSeek V4 Pro 0813 调校，其他模型勿开；仅对 MyGO preset 派发的子代理会话生效，lib-only 部署形态下不生效'),
            ),
          ),
          // 人设覆盖（tisitan.15）：内置工种走「roles 行 persona > prompts 文件」
          // 解析链；Sisyphus 的编排纪律人设是行为本体，不开放覆盖
          type === 'sisyphus'
            ? React.createElement('div', { style: { ...hintStyle, marginTop: 4 } }, 'Sisyphus 的编排纪律人设不提供面板覆盖。')
            : React.createElement('div', { style: { marginBottom: 8 } },
                React.createElement('div', { style: labelStyle }, '人设覆盖（Persona）'),
                React.createElement('div', { style: hintStyle, marginBottom: 4 }, `当前来源：${personaOverrideSource(draft?.roles?.[type])}；留空保存 = 恢复 prompts/${type}.md 文件默认`),
                React.createElement('textarea', {
                  value: draft?.roles?.[type]?.persona ?? '',
                  disabled: !draft,
                  rows: 3,
                  placeholder: `留空 = 使用 prompts/${type}.md 文件默认人设`,
                  onChange: (e) => setPersonaOverride(type, e.target.value),
                  style: { ...selectStyle, resize: 'vertical', fontFamily: 'inherit' },
                }),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
                  React.createElement('button', {
                    style: miniBtnStyle,
                    disabled: !draft,
                    title: `读取 prompts/${type}.md 原文填入上方编辑框（草稿态，点保存才生效）`,
                    onClick: () => loadBuiltinPersona(type),
                  }, '载入文件默认'),
                  personaFileErr[type]
                    ? React.createElement('span', { style: { fontSize: 12, color: '#f44336' } }, personaFileErr[type])
                    : null,
                ),
              ),
        ) : null,
      )
    }),
    // ── 自定义角色（tisitan.14/tisitan.15）：roles dict 里的非内置条目；渲染与行操作在 roles-editor.js
    renderRolesEditor({
      draft,
      // 角色区一切写操作都经 mutateDraft（E6/A-03）：dep 名不变（roles-editor
      // 仍按 deps.setDraft 消费），换的是实现——漏了这一处就会出现「改自定义
      // 角色不置 dirty」的偏心 dirty，比没有 dirty 更坏
      setDraft: mutateDraft,
      newRoleKey,
      setNewRoleKey,
      roleToolDrafts,
      setRoleToolDrafts,
      importError,
      setImportError,
      openCards,
      setOpenCards,
      EFFORTS,
      effortLabel,
      makeSelect,
      renderChainEditor,
      roster,
      styles: { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle, rowStyle },
    }),
    // ── 工具屏蔽（tisitan.13）：置于 8 工种卡片之后；渲染逻辑在 tool-mask-editor.js
    // React 由该模块自身 import（tisitan.8 A-12，与 roles-editor 对齐）
    renderToolMaskEditor({
      draft,
      roster,
      maskFilter,
      setMaskFilter,
      maskSelL,
      setMaskSelL,
      maskSelR,
      setMaskSelR,
      maskManual,
      setMaskManual,
      setDeny,
      cardOpen,
      toggleCard,
      styles: { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle },
    }),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
      React.createElement('button', {
        onClick: save,
        // 冲突后锁保存（E6/A-03）：draft 的基线已作废，放行就等于让用户拿旧
        // 快照盖掉新配置——正是围栏要拦的那件事。必须显式「重新加载」解锁。
        disabled: saving || !draft || conflict !== null,
        style: { padding: '6px 20px', borderRadius: 6, border: '1px solid var(--separator, #333)', background: 'transparent', color: 'var(--text, #e0e0e0)', cursor: saving ? 'wait' : 'pointer', fontSize: 13 },
      }, saving ? '保存中…' : '立即保存'),
      typeof close === 'function'
        ? React.createElement('button', {
          // close 的唯一使用点（E6/A-03）：保存成功才关设置页，失败/冲突绝不关
          onClick: saveAndClose,
          disabled: saving || !draft || conflict !== null,
          title: '保存成功后关闭设置页（保存失败或他处已改时不会关闭）',
          style: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--separator, #333)', background: 'transparent', color: 'var(--text, #e0e0e0)', cursor: 'pointer', fontSize: 13 },
        }, '保存并关闭')
        : null,
      dirty && conflict === null
        ? React.createElement('span', { style: { fontSize: 12, color: ACCENT_QUEUE }, title: '有未保存的修改：关页签/刷新前浏览器会拦一道' }, '● 未保存')
        : null,
      msg ? React.createElement('span', { style: { fontSize: 13, color: msg.startsWith('已') ? '#4caf50' : '#f44336' } }, msg) : null,
    ),
  )
}
