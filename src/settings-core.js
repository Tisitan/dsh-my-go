/**
 * dsh-my-go — settings page core (tisitan.15 split).
 *
 * SettingsPage skeleton + draft lifecycle (load/null-gate/save), the eight
 * built-in specialist cards (model priority chain, persona override) and
 * the save row. The custom-roles section and the tool-mask
 * dual-list render through roles-editor.js / tool-mask-editor.js, which
 * receive every piece of state explicitly via their deps objects — no
 * module-level mutable state anywhere.
 */

import * as React from 'react'

import { composeChain, decomposeChain, addChainEntry, removeChainEntry, moveChainEntry, updateChainEntry, stripEmptyFallbackRows } from './chain-rows.js'
import { builtinSummaryText, withPersonaOverride, personaOverrideSource, resolveBuiltinPersonaResult } from './roster-rows.js'
import { renderRolesEditor } from './roles-editor.js'
import { renderToolMaskEditor } from './tool-mask-editor.js'
import { AGENT_TYPES, AGENT_LABELS, AGENT_BLURBS } from './client-constants.js'

export function SettingsPage({ scope: sp, connection, close }) {
  const [draft, setDraft] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState(null)
  const [available, setAvailable] = React.useState({ providers: [], models: {} })
  // 加载态三分（tisitan.20）：draft=null 时靠 loadError 区分「加载中」与「加载
  // 失败」——初始渲染不再误报失败横幅；modelsReady 区分 listModels 未返回与
  // 确实拉不到 Provider 列表（fetchFailed 提示只在确认失败后出现）
  const [loadError, setLoadError] = React.useState(false)
  const [modelsReady, setModelsReady] = React.useState(false)
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
    // Load settings via host RPC (DSH SettingsScope doesn't support nested reads)
    if (connection && connection.rpc && typeof connection.rpc.call === 'function') {
      connection.rpc.call('/dsh-my-go', 'loadSettings', {}).then((res) => {
        // 加载失败保持 draft=null 并禁用保存：空 draft 保存会清空全部配置；
        // 失败经 loadError 亮红字横幅，不再完全静默
        if (res && res.ok) { setDraft(res.value ?? {}); setLoadError(false) }
        else { setDraft(null); setLoadError(true) }
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
  }, [sp])

  if (!sp) return React.createElement('div', { style: { padding: 16, color: '#888' } }, '设置服务不可用')

  // 标量编辑（reasoningEffort / dsv4p0813）：draft 为 null（尚未加载/加载
  // 失败）时拒绝编辑——与 setDeny/setPersonaOverride 同款 null-gate，外层
  // 拦截 + 函数式 prev 守卫双保险，避免从 null 造出半截 draft 后保存清空配置
  const set = (type, field, value) => {
    if (!draft) return
    setDraft((prev) => {
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
    setDraft((prev) => prev ? { ...prev, [type]: { ...prev?.[type], provider: chainRow.provider, model: chainRow.model, fallbacks: chainRow.fallbacks } } : prev)
  }

  // 工具屏蔽编辑：deny 始终以数组提交；空数组提交 []，host 半转 unset。
  // draft 为 null（尚未加载/加载失败）时拒绝编辑：避免从 null 造出只有
  // toolMask 的半截 draft，保存时把其余配置全部 unset 清空。
  const setDeny = (rows) => {
    if (!draft) return
    setDraft((prev) => prev ? { ...prev, toolMask: { deny: rows } } : prev)
  }

  // 内置工种人设覆盖（tisitan.15）：写 roles 形状部分行（只带 persona
  // 字段，透传既有字段），host 端显式字段才写——绝不清掉已配的绑定
  const setPersonaOverride = (type, text) => {
    if (!draft) return
    setDraft((prev) => prev ? { ...prev, roles: { ...(prev.roles ?? {}), [type]: withPersonaOverride(prev.roles?.[type], text) } } : prev)
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
  const save = async () => {
    if (!draft) { setMsg('配置尚未加载成功，已禁止保存以避免覆盖'); return }
    setSaving(true); setMsg(null)
    try {
      if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
        setMsg('连接不可用'); setSaving(false); return
      }
      const res = await connection.rpc.call('/dsh-my-go', 'saveSettings', buildPersistDraft(draft))
      if (res && res.ok) {
        setMsg('已保存')
      } else {
        setMsg('保存失败: ' + (res?.error?.message || '未知错误'))
      }
    } catch (e) {
      setMsg('保存失败: ' + String(e))
    } finally { setSaving(false) }
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
  const providerLabel = (v) => v === '' ? '跟随 Sisyphus（对话框所选模型）' : v
  const modelLabel = (v) => v === '' ? '跟随 Sisyphus（对话框所选模型）' : v
  const effortLabel = (v) => v === '' ? '跟随模型默认（不单独指定）' : ({ low: '低（low）', high: '高（high）', max: '最高（max）' }[v] ?? v)
  // 备选条目（链 #2..N）专用 label：空值语义与主选不同（未选择 vs 跟随 Sisyphus）
  const fbProviderLabel = (v) => v === '' ? '（选择渠道）' : v
  const fbModelLabel = (v) => v === '' ? '（选择模型）' : v

  // disabled 参数（tisitan.20）：draft=null 时所有下拉一并锁定（调用方传
  // !draft），与保存禁用同口径——控件可交互但改动被 null-gate 静默吞掉只会
  // 造成「点了没反应」的困惑，不如直接禁用
  const makeSelect = (value, options, labelFn, onChange, disabled = false) =>
    React.createElement('select', { style: selectStyle, value: value ?? '', disabled, onChange: (e) => onChange(e.target.value) },
      ...options.map((opt) =>
        React.createElement('option', { key: opt, value: opt }, labelFn(opt))
      )
    )

  // Compute per-type model list: when provider is set, filter to that provider's models; otherwise show all
  const modelsForProvider = (providerId) => {
    // models 缺席/非对象时归空：listModels 畸形响应不炸渲染（tisitan.20 D5）
    const modelsMap = available.models && typeof available.models === 'object' ? available.models : {}
    if (!providerId) return [...new Set(Object.values(modelsMap).flat())]
    const specific = modelsMap[providerId]
    return Array.isArray(specific) ? specific : []
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
      chain.map((row, i) =>
        React.createElement('div', { key: `${keyPrefix}-chain-${i}`, style: chainRowStyle },
          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-secondary, #888)', display: 'flex', alignItems: 'center', gap: 4 } },
            `#${i + 1}`,
            i === 0 ? React.createElement('span', { style: primaryBadgeStyle }, '主选') : null,
          ),
          makeSelect(row.provider, ['', ...providers], i === 0 ? providerLabel : fbProviderLabel, (v) => apply(updateChainEntry(chain, i, 'provider', v)), disabled),
          makeSelect(row.model, ['', ...modelsForProvider(row.provider)], i === 0 ? modelLabel : fbModelLabel, (v) => apply(updateChainEntry(chain, i, 'model', v)), disabled),
          React.createElement('div', { style: { display: 'flex', gap: 4 } },
            React.createElement('button', { style: miniBtnStyle, disabled: disabled || i === 0, title: '上移（#2 到顶即扶正为主选）', onClick: () => apply(moveChainEntry(chain, i, -1)) }, '↑'),
            React.createElement('button', { style: miniBtnStyle, disabled: disabled || i === chain.length - 1, title: '下移（更后尝试）', onClick: () => apply(moveChainEntry(chain, i, 1)) }, '↓'),
            React.createElement('button', { style: miniBtnStyle, disabled: disabled || chain.length <= 1, title: '删除该行（至少保留主选位；删 #1 则 #2 扶正）', onClick: () => apply(removeChainEntry(chain, i)) }, '×'),
          ),
        ),
      ),
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
    }, '⚠ 暂时读不到 DSH 的 Provider/Model 列表——确认 dsh web 已重启、LLM 插件已配置并激活后，回来刷新即可。不影响手填：下拉框也可以直接输入自定义值。') : null,
    // 加载失败红字横幅（tisitan.20 Z1'）：与「加载中」可区分，保存已被禁用
    loadError ? React.createElement('div', {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', fontSize: 13 },
    }, '⚠ 配置加载失败（loadSettings 不可用或返回错误）——为防清空配置已禁用全部编辑与保存，请确认插件已激活后刷新重试。') : null,
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
      setDraft,
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
    renderToolMaskEditor({
      React,
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
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 } },
      React.createElement('button', {
        onClick: save,
        disabled: saving || !draft,
        style: { padding: '6px 20px', borderRadius: 6, border: '1px solid var(--separator, #333)', background: 'transparent', color: 'var(--text, #e0e0e0)', cursor: saving ? 'wait' : 'pointer', fontSize: 13 },
      }, saving ? '保存中…' : '立即保存'),
      msg ? React.createElement('span', { style: { fontSize: 13, color: msg.startsWith('已') ? '#4caf50' : '#f44336' } }, msg) : null,
    ),
  )
}
