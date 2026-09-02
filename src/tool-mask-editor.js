/**
 * dsh-my-go — tool-mask dual-list editor (tisitan.15 split).
 *
 * Pure render function for the settings-page tool-mask section (tisitan.13):
 * left column = tools available in the roster snapshot, right column =
 * denied entries (with an「未连接」badge for names outside the roster).
 * All editable state (draft, roster snapshot, filter/selection/manual-input
 * state) is injected by settings-core via the explicit `deps` object — this
 * module holds no state of its own.
 */

import * as React from 'react'

import { normalizeDenyList, blockTool, unblockTool, availableTools, denyEntries } from './tool-mask-rows.js'
import { MONO_FONT } from './client-constants.js'

export function renderToolMaskEditor(deps) {
  const {
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
    styles,
  } = deps
  const { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle } = styles

  const denyList = normalizeDenyList(draft?.toolMask?.deny)
  const availTools = availableTools(roster, denyList, maskFilter)
  const maskedEntries = denyEntries(denyList, roster)
  const maskListBoxStyle = { border: '1px solid var(--separator, #333)', borderRadius: 4, height: 150, overflowY: 'auto', background: 'var(--surface, #1e1e1e)', marginBottom: 4 }
  const maskItemStyle = (selected) => ({
    padding: '3px 8px', fontSize: 12, fontFamily: MONO_FONT, cursor: 'pointer', wordBreak: 'break-all',
    background: selected ? 'rgba(100,181,246,0.18)' : 'transparent',
  })
  const maskBadge = (title) => React.createElement('span', {
    title,
    style: { flexShrink: 0, fontSize: 10, lineHeight: '15px', padding: '0 5px', borderRadius: 4, color: '#9e9e9e', background: 'rgba(255,255,255,0.07)' },
  }, '未连接')
  const blockSelected = () => {
    if (!draft || !maskSelL) return
    setDeny(blockTool(denyList, maskSelL))
    setMaskSelL(null)
  }
  const unblockSelected = () => {
    if (!draft || !maskSelR) return
    setDeny(unblockTool(denyList, maskSelR))
    setMaskSelR(null)
  }

  return React.createElement('div', { style: cardStyle },
    React.createElement('div', {
      style: { cursor: 'pointer', marginBottom: cardOpen('tool-mask') ? 8 : 0 },
      onClick: () => toggleCard('tool-mask'),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
        React.createElement('span', { style: glyphStyle }, cardOpen('tool-mask') ? '▾' : '▸'),
        React.createElement('span', { style: { fontWeight: 600 } }, '工具屏蔽（Tool Mask）'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary, #888)' } }, '从 MyGO 会话目录藏起指定工具（Sisyphus 与全部子代理）'),
      ),
      React.createElement('div', { style: summaryStyle }, `已屏蔽 ${denyList.length} 项`),
    ),
    cardOpen('tool-mask') ? React.createElement(React.Fragment, null,
      React.createElement('div', { style: { ...hintStyle, marginBottom: 8 } },
        '屏蔽仅对新会话生效，当前会话不受影响；保留工具（run_code 等）不可屏蔽，不在左列出现。花名册是快照：MCP 重连后重开设置页即可刷新。',
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'start' } },
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, `当前可用工具（${availTools.length}）`),
          React.createElement('input', {
            value: maskFilter,
            placeholder: '按名称过滤…',
            onChange: (e) => { setMaskFilter(e.target.value); setMaskSelL(null) },
            style: { ...selectStyle, marginBottom: 4 },
          }),
          React.createElement('div', { style: maskListBoxStyle },
            availTools.length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary, #888)' } }, roster.length === 0 ? '花名册不可用（host 未就绪）；可用下方手填添加' : '（无匹配项）')
              : availTools.map((name) => React.createElement('div', {
                  key: name,
                  title: name,
                  style: maskItemStyle(maskSelL === name),
                  onClick: () => setMaskSelL(maskSelL === name ? null : name),
                }, name)),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 20 } },
          React.createElement('button', { style: miniBtnStyle, disabled: !maskSelL, title: '屏蔽选中的工具', onClick: blockSelected }, '屏蔽 →'),
          React.createElement('button', { style: miniBtnStyle, disabled: !maskSelR, title: '取消屏蔽选中的条目', onClick: unblockSelected }, '← 解除'),
        ),
        React.createElement('div', null,
          React.createElement('div', { style: labelStyle }, `已屏蔽（${maskedEntries.length}）`),
          React.createElement('div', { style: maskListBoxStyle },
            maskedEntries.length === 0
              ? React.createElement('div', { style: { padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary, #888)' } }, '未屏蔽任何工具')
              : maskedEntries.map((entry) => React.createElement('div', {
                  key: entry.name,
                  title: entry.name,
                  style: { ...maskItemStyle(maskSelR === entry.name), display: 'flex', alignItems: 'center', gap: 6 },
                  onClick: () => setMaskSelR(maskSelR === entry.name ? null : entry.name),
                },
                  React.createElement('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, entry.name),
                  entry.connected ? null : maskBadge('不在当前花名册（未连接或已下线）；条目保留，重连后即被屏蔽'),
                )),
          ),
        ),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        React.createElement('input', {
          value: maskManual,
          placeholder: '手填工具名（花名册外的未连接工具）…',
          onChange: (e) => setMaskManual(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') { setDeny(blockTool(denyList, maskManual.trim())); setMaskManual('') } },
          style: selectStyle,
        }),
        React.createElement('button', {
          style: miniBtnStyle,
          disabled: !draft || maskManual.trim() === '',
          title: '加入已屏蔽清单',
          onClick: () => { setDeny(blockTool(denyList, maskManual.trim())); setMaskManual('') },
        }, '+ 添加'),
      ),
    ) : null,
  )
}
