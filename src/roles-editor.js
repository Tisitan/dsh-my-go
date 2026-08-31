/**
 * dsh-my-go — custom roles editor (tisitan.15 split).
 *
 * Pure render function for the settings-page custom roles section
 * (tisitan.14/tisitan.15): role cards (model priority chain + persona +
 * tool lists), create-by-key input, JSON import/export buttons. All state
 * (draft, card open-map, new-key input, tool-name drafts, import error) is
 * injected by settings-core via the explicit `deps` object — this module
 * holds no state. Row mutations go through the roster-rows.js pure functions;
 * writes land in draft.roles with built-in keys passed through untouched.
 */

import * as React from 'react'

import {
  isValidRoleKey,
  normalizeRoleRows,
  mergeRoleRowsIntoRoles,
  addRoleRow,
  removeRoleRow,
  updateRoleRow,
  addRoleToolEntry,
  removeRoleToolEntry,
  roleSummaryText,
  buildRoleCardJson,
  parseRoleCardJson,
} from './roster-rows.js'
import { AGENT_TYPES, MONO_FONT } from './client-constants.js'

export function renderRolesEditor(deps) {
  const {
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
    styles,
  } = deps
  const { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle, rowStyle } = styles

  // ── 自定义角色（tisitan.14）：rows 视图为编辑期唯一真源 ────────────────
  // normalizeRoleRows 过滤内置键与脏数据；行操作全部走 roster-rows 纯函数，
  // 写回时内置键透传、自定义部分整体重建（删除角色=键从 draft.roles 消失，
  // 保存时 host 半按「draft 提供了 roles dict」语义整键 unset）。
  const roleRows = normalizeRoleRows(draft?.roles, AGENT_TYPES)
  // roles dict 重建走 roster-rows 纯函数 mergeRoleRowsIntoRoles（tisitan.20
  // Z2'）：内置键部分行透传、未触碰脏行原样保留、投影行重建
  const applyRoleRows = (nextRows) => {
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, roles: mergeRoleRowsIntoRoles(prev.roles, nextRows, AGENT_TYPES) }
    })
  }
  const editRole = (key, mutate) => {
    if (!draft) return
    applyRoleRows(mutate(roleRows))
  }
  // 创建守卫（tisitan.20 Z4）：内置键名（含 sisyphus）与导入路径同口径拒收
  // ——normalizeRoleRows 会把内置键滤出 rows，入库后 UI 不可见不可删
  const createRole = () => {
    if (!draft) return
    const key = newRoleKey.trim()
    if (!isValidRoleKey(key)) return
    if (AGENT_TYPES.includes(key)) return
    if (roleRows.some((row) => row.key === key)) return
    if (draft?.roles && typeof draft.roles === 'object' && draft.roles[key]) return
    applyRoleRows(addRoleRow(roleRows, key))
    setNewRoleKey('')
    setOpenCards((prev) => ({ ...prev, [key]: true }))
  }
  const roleToolDraft = (key, side) => roleToolDrafts?.[key]?.[side] ?? ''
  const setRoleToolDraft = (key, side, value) => {
    setRoleToolDrafts((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: value } }))
  }
  const exportRole = async (row) => {
    const json = buildRoleCardJson(row)
    try {
      await navigator.clipboard.writeText(json)
    } catch {
      window.prompt('剪贴板不可用，请手动复制该角色 JSON：', json)
    }
  }
  const importRole = () => {
    if (!draft) return
    const text = window.prompt('粘贴角色 JSON（可先在别处导出，改 key 后导入）：')
    if (text === null || text.trim() === '') return
    const existingKeys = [...AGENT_TYPES, ...roleRows.map((row) => row.key)]
    const parsed = parseRoleCardJson(text, existingKeys)
    if (!parsed.ok) {
      setImportError(parsed.error)
      return
    }
    setImportError('')
    applyRoleRows([...roleRows, parsed.row])
  }

  // 角色 toolFilter 名单编辑器（allow/deny 各一）：datalist 挂 listTools
  // 花名册快选，同时支持手填花名册外的未连接工具名（MCP 动态面）
  const renderRoleToolList = (row, side) => {
    const names = row[side]
    const draftValue = roleToolDraft(row.key, side)
    const listId = `role-tf-${row.key}-${side}`
    return React.createElement('div', null,
      React.createElement('div', { style: labelStyle }, side === 'allow' ? '工具白名单（allow）' : '工具黑名单（deny）'),
      names.length === 0
        ? React.createElement('div', { style: hintStyle }, side === 'allow' ? '（空 = 全量，除全局掩码）' : '（空 = 不额外屏蔽）')
        : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 } },
            names.map((name, i) => React.createElement('span', {
              key: `${row.key}-${side}-${name}`,
              title: name,
              style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: MONO_FONT, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: '#bbb' },
            },
              React.createElement('span', { style: { overflowWrap: 'anywhere' } }, name),
              React.createElement('span', {
                role: 'button',
                title: '移除',
                style: { cursor: draft ? 'pointer' : 'not-allowed', color: '#e57373' },
                onClick: () => { if (draft) editRole(row.key, (rows) => removeRoleToolEntry(rows, row.key, side, i)) },
              }, '×'),
            )),
        ),
      React.createElement('div', { style: { display: 'flex', gap: 6 } },
        React.createElement('input', {
          value: draftValue,
          list: listId,
          placeholder: '工具名（花名册可点选，也可手填未连接工具）…',
          disabled: !draft,
          onChange: (e) => setRoleToolDraft(row.key, side, e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && draftValue.trim() !== '') {
              editRole(row.key, (rows) => addRoleToolEntry(rows, row.key, side, draftValue.trim()))
              setRoleToolDraft(row.key, side, '')
            }
          },
          style: { ...selectStyle, fontFamily: MONO_FONT },
        }),
        React.createElement('datalist', { id: listId },
          deps.roster.map((name) => React.createElement('option', { key: name, value: name })),
        ),
        React.createElement('button', {
          style: miniBtnStyle,
          disabled: !draft || draftValue.trim() === '',
          title: '加入名单',
          onClick: () => {
            editRole(row.key, (rows) => addRoleToolEntry(rows, row.key, side, draftValue.trim()))
            setRoleToolDraft(row.key, side, '')
          },
        }, '+ 添加'),
      ),
    )
  }

  const toggleCard = (id) => setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }))
  const cardOpen = (id) => openCards[id] === true

  return React.createElement('div', { style: cardStyle },
    React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
      React.createElement('span', { style: { fontWeight: 600 } }, '自定义角色（Custom Roles）'),
      React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary, #888)' } }, '可被 go_work 派发的自建角色：独立人设与工具面，经 spawn 正统通道注入'),
    ),
    React.createElement('div', { style: { ...hintStyle, marginBottom: 8 } },
      '人设留空 = 子代理仅带部署基础人设；工具面留空 = 全量（除全局掩码）。名字创建后不可改（删除重建即可）；内置八工种（含 sisyphus）不在此列，用上方卡片配置。',
    ),
    roleRows.length === 0
      ? React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary, #888)', marginBottom: 8 } }, '还没有自定义角色')
      : roleRows.map((row) => {
          const open = cardOpen(`role-${row.key}`)
          return React.createElement('div', { key: `role-${row.key}`, style: { border: '1px solid var(--separator, #333)', borderRadius: 6, padding: 10, marginBottom: 8 } },
            React.createElement('div', {
              style: { cursor: 'pointer', marginBottom: open ? 8 : 0 },
              onClick: () => toggleCard(`role-${row.key}`),
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                React.createElement('span', { style: glyphStyle }, open ? '▾' : '▸'),
                React.createElement('span', { style: { fontWeight: 600, fontFamily: MONO_FONT } }, row.key),
                React.createElement('button', {
                  style: { ...miniBtnStyle, marginLeft: 'auto' },
                  title: `导出角色 ${row.key} 为 JSON 并复制到剪贴板`,
                  onClick: (e) => { e.stopPropagation(); void exportRole(row) },
                }, '导出'),
                React.createElement('button', {
                  style: miniBtnStyle,
                  title: `删除角色 ${row.key}（保存后生效）`,
                  disabled: !draft,
                  onClick: (e) => { e.stopPropagation(); editRole(row.key, (rows) => removeRoleRow(rows, row.key)) },
                }, '删除'),
              ),
              React.createElement('div', { style: summaryStyle }, roleSummaryText(row)),
            ),
            open ? React.createElement(React.Fragment, null,
              // 模型优先级列表（tisitan.19）：主选（#1）与备选链合并编辑，
              // 与内置工种卡共用 renderChainEditor；写回经 roster-rows 纯函数
              // （fallbacks 整组替换 → provider（重置 model）→ model 定序写入）
              renderChainEditor(`role-${row.key}`, row, ({ provider, model, fallbacks }) =>
                editRole(row.key, (rs) => updateRoleRow(updateRoleRow(updateRoleRow(rs, row.key, 'fallbacks', fallbacks), row.key, 'provider', provider), row.key, 'model', model)), !draft),
              React.createElement('div', { style: rowStyle },
                React.createElement('div', null,
                  React.createElement('div', { style: labelStyle }, '思考档位（Reasoning Effort）'),
                  makeSelect(row.reasoningEffort, EFFORTS, effortLabel, (v) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, 'reasoningEffort', v)), !draft),
                ),
                React.createElement('div', null,
                  React.createElement('div', { style: labelStyle }, 'DSV4P0813 补丁'),
                  React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: draft ? 'pointer' : 'not-allowed', fontSize: 13, paddingTop: 2 } },
                    React.createElement('input', { type: 'checkbox', checked: row.dsv4p0813 === true, disabled: !draft, onChange: (e) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, 'dsv4p0813', e.target.checked)) }),
                    '启用',
                  ),
                  React.createElement('div', { style: hintStyle }, '两阶段锚定上下文注入，专为 DeepSeek V4 Pro 0813 调校，其他模型勿开'),
                ),
              ),
              React.createElement('div', { style: { marginBottom: 8 } },
                React.createElement('div', { style: labelStyle }, '人设（Persona）'),
                React.createElement('div', { style: hintStyle, marginBottom: 4 }, '经 spawn 通道注入子代理系统提示，首行作为角色摘要展示'),
                React.createElement('textarea', {
                  value: row.persona,
                  disabled: !draft,
                  rows: 3,
                  placeholder: '留空 = 跟随部署基础人设',
                  onChange: (e) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, 'persona', e.target.value)),
                  style: { ...selectStyle, resize: 'vertical', fontFamily: 'inherit' },
                }),
              ),
              React.createElement('div', { style: rowStyle },
                renderRoleToolList(row, 'allow'),
                renderRoleToolList(row, 'deny'),
              ),
            ) : null,
          )
        }),
    React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      React.createElement('input', {
        value: newRoleKey,
        placeholder: '新角色名（小写字母开头，仅小写与连字符，如 coder-x）…',
        disabled: !draft,
        onChange: (e) => setNewRoleKey(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') createRole() },
        style: { ...selectStyle, fontFamily: MONO_FONT },
      }),
      React.createElement('button', {
        style: miniBtnStyle,
        disabled: !draft || !isValidRoleKey(newRoleKey.trim()) || AGENT_TYPES.includes(newRoleKey.trim()) || newRoleKey.trim() !== '' && (roleRows.some((row) => row.key === newRoleKey.trim()) || (draft?.roles && typeof draft.roles === 'object' && Boolean(draft.roles[newRoleKey.trim()]))),
        title: '创建自定义角色',
        onClick: createRole,
      }, '+ 新建角色'),
      React.createElement('button', {
        style: miniBtnStyle,
        disabled: !draft,
        title: '从粘贴的角色 JSON 导入（key 不可与内置工种或已有角色重名）',
        onClick: importRole,
      }, '导入 JSON'),
    ),
    importError !== ''
      ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, `导入失败：${importError}`)
      : null,
    newRoleKey.trim() !== '' && !isValidRoleKey(newRoleKey.trim())
      ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, '名字不合法：须小写字母开头，只含小写字母与连字符（大写 / 数字 / 下划线都会被保存端 schema 拒绝）')
      : null,
    newRoleKey.trim() !== '' && isValidRoleKey(newRoleKey.trim()) && AGENT_TYPES.includes(newRoleKey.trim())
      ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, `「${newRoleKey.trim()}」是内置工种名，不可用作自定义角色——请用上方对应卡片配置`)
      : null,
    newRoleKey.trim() !== '' && isValidRoleKey(newRoleKey.trim()) && !AGENT_TYPES.includes(newRoleKey.trim()) && (roleRows.some((row) => row.key === newRoleKey.trim()) || (draft?.roles && typeof draft.roles === 'object' && Boolean(draft.roles[newRoleKey.trim()])))
      ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, '该名字已存在')
      : null,
  )
}
