/**
 * dsh-my-go — usage statistics section for the orchestration overlay panel
 * (usage-stats contract step 6/7, D4 three views from ONE getUsage response).
 *
 * Pure presentation: every figure comes from the injected `usage` snapshot
 * ({ state, report, detail }) maintained by panel-tree.js's shared 600ms poll
 * — this component never issues RPCs, so polling stays single-beat and
 * session-follow remains the state machine's job. All derivations go through
 * usage-views.js pure functions (node --test covers them; this DOM half is
 * not unit-tested, per the smoke-test precedent).
 */

import * as React from 'react'

import { MONO_FONT, AGENT_COLORS, ACCENT_RUNNING, ACCENT_HELP, ACCENT_QUEUE, typeLabel, typeName } from './client-constants.js'
import { shortId } from './panel-format.js'
import {
  USAGE_TABS,
  BUCKET_COLUMNS,
  priceIndexFrom,
  priceKey,
  computeCost,
  computeChildCost,
  computeTotalCost,
  hasAnyPrice,
  modelDisplayKey,
  formatBucketCell,
  formatCost,
  currencySymbol,
  formatFullTokens,
  usageEmptyState,
  globalPartial,
  sumMessageCount,
  childRowCount,
} from './usage-views.js'

// 320px panel minus padding leaves ~296px: name column flexes, the four
// bucket columns fit the compact figures (≤6 mono chars at 10px), cost is
// dropped entirely when nothing is priced ("不填就不记录").
const GRID_WITH_COST = 'minmax(0,1fr) 40px 40px 40px 40px 54px'
const GRID_NO_COST = 'minmax(0,1fr) 40px 40px 40px 40px'
// 30+ children must scroll inside the section instead of stretching the
// whole overlay (Z18): the list body caps at roughly four card heights.
const LIST_MAX_HEIGHT = 260

function childGlyph(status) {
  switch (status) {
    case 'running': return '●'
    case 'failed': return '✗'
    case 'done': return '✓'
    default: return '○'
  }
}

function childGlyphColor(status) {
  switch (status) {
    case 'running': return ACCENT_RUNNING
    case 'failed': return ACCENT_HELP
    default: return '#888'
  }
}

export function UsageSection({ usage, open, onToggle }) {
  const [tab, setTab] = React.useState('models')
  const [expanded, setExpanded] = React.useState({})

  const report = usage?.state === 'ok' ? usage.report : null
  const empty = usageEmptyState(usage)
  // Cost figures render in the response's own currency (D1a): the server
  // echoes the table's global knob, unknown/absent falls back to USD here too.
  const costSymbol = currencySymbol(report?.currency)
  const priceIndex = priceIndexFrom(report?.byModel)
  const costColumn = hasAnyPrice(report?.byModel)
  const partial = globalPartial(report)

  const toggleChild = (childId) => setExpanded((prev) => ({ ...prev, [childId]: !prev[childId] }))

  // 标识符一律等宽小字浅底圆角，与编排面板 chip 同款（panel-tree.js chip）
  const chip = (text, title, color) => React.createElement('span', {
    title,
    style: {
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontFamily: MONO_FONT,
      fontSize: 10,
      lineHeight: '15px',
      padding: '0 5px',
      borderRadius: 4,
      color: color ?? '#9e9e9e',
      background: color ? `${color}22` : 'rgba(255,255,255,0.07)',
    },
  }, text)

  const typeChip = (agentType) => chip(
    typeName(agentType),
    typeLabel(agentType),
    agentType ? (AGENT_COLORS[agentType] ?? '#9e9e9e') : undefined,
  )

  // 数字列：右对齐省略，title 携带精确值与 partial 解释（compact 是舍入展示）
  const tokenCell = (tokens, rowPartial) => {
    const absent = tokens === null || tokens === undefined
    return React.createElement('span', {
      title: absent ? '未上报（≠ 0）' : `精确值 ${formatFullTokens(tokens)}${rowPartial ? '（含未上报分桶，为下界）' : ''}`,
      style: {
        textAlign: 'right',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: absent ? '#666' : '#a0a0a0',
      },
    }, formatBucketCell(tokens, rowPartial))
  }

  const costCell = (cost) => {
    const text = formatCost(cost, report?.currency)
    return React.createElement('span', {
      title: cost ? `精确值 ${costSymbol}${cost.value.toFixed(6)}${cost.partial ? '（含未定价/未上报桶，为下界）' : ''}` : '未定价（不记录成本）',
      style: {
        textAlign: 'right',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: text === null ? '#666' : '#c8c8c8',
      },
    }, text ?? '—')
  }

  const nameCell = (text, title) => React.createElement('span', {
    title,
    style: {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: text === '未知模型' ? '#777' : '#c8c8c8',
    },
  }, text)

  const gridRow = (columns, key, opts = {}, ...children) => React.createElement('div', {
    key,
    onClick: opts.onClick,
    style: {
      display: 'grid',
      gridTemplateColumns: columns,
      columnGap: 6,
      alignItems: 'center',
      minWidth: 0,
      fontFamily: MONO_FONT,
      fontSize: 10,
      lineHeight: '16px',
      padding: opts.padding ?? '2px 6px',
      borderTop: opts.borderTop === false ? undefined : '1px solid rgba(255,255,255,0.04)',
      cursor: opts.onClick ? 'pointer' : 'default',
      borderLeft: opts.accent ? `2px solid ${opts.accent}` : '2px solid transparent',
    },
  }, ...children)

  const headerRow = (columns) => gridRow(columns, 'usage-head', { borderTop: false, padding: '0 6px 2px' },
    React.createElement('span', { style: { color: '#777' } }, '模型'),
    ...BUCKET_COLUMNS.map(({ label }) => React.createElement('span', { key: label, style: { textAlign: 'right', color: '#777' } }, label)),
    costColumn ? React.createElement('span', { style: { textAlign: 'right', color: '#777' }, title: `按 ${report?.currency === 'CNY' ? '人民币' : '美元'} 折算` }, `成本(${costSymbol})`) : null,
  )

  const renderModels = () => {
    const rows = Array.isArray(report.byModel) ? report.byModel : []
    return React.createElement('div', null,
      headerRow(costColumn ? GRID_WITH_COST : GRID_NO_COST),
      rows.map((row, i) => {
        const name = modelDisplayKey(row.provider, row.model)
        const rowPartial = row.partial === true
        const cost = computeCost(row.buckets, row.price)
        const costShown = cost ? { ...cost, partial: cost.partial || rowPartial } : null
        const extras = [
          rowPartial ? '含未上报分桶' : null,
          row.childCount ? `${row.childCount} 个子代` : null,
          `${row.messageCount ?? 0} 条消息`,
        ].filter(Boolean).join(' · ')
        return gridRow(costColumn ? GRID_WITH_COST : GRID_NO_COST, `m-${i}-${name}`,
          { onClick: undefined },
          nameCell(name, `${name}${extras ? `\n${extras}` : ''}`),
          ...BUCKET_COLUMNS.map(({ bucket }) => tokenCell(row.buckets?.[bucket], rowPartial)),
          costColumn ? costCell(costShown) : null,
        )
      }),
    )
  }

  const renderChildren = () => {
    const children = Array.isArray(report.children) ? report.children : []
    return React.createElement('div', null,
      children.map((child) => {
        const running = child.status === 'running'
        const rowPartial = child.partial === true
        const cost = computeChildCost(child, priceIndex)
        const costShown = cost ? { ...cost, partial: cost.partial || rowPartial } : null
        const segments = Array.isArray(child.segments) ? child.segments : []
        const isOpen = expanded[child.childId] === true
        const title = [
          child.isSelf ? '主编排（本会话）：会话自身的模型用量，不含子代' : typeLabel(child.agentType),
          child.childId,
          running ? '运行中（数字随轮询实时增长）' : null,
          child.frozen ? '终态已冻结（不再扫描）' : null,
          rowPartial ? '含未上报分桶，数字为下界' : null,
          `${child.messageCount ?? 0} 条消息`,
        ].filter(Boolean).join('\n')
        return React.createElement('div', { key: child.childId, style: { marginBottom: 2 } },
          // 行1：状态 + 工种 + 短 id + 锁标 + 成本（有点击时展开/收起分段明细）
          gridRow(costColumn ? 'minmax(0,1fr) 54px' : 'minmax(0,1fr)', `c1-${child.childId}`, {
            onClick: segments.length > 0 ? () => toggleChild(child.childId) : undefined,
            accent: running ? ACCENT_RUNNING : undefined,
          },
            React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' } },
              React.createElement('span', { style: { flexShrink: 0, width: 12, textAlign: 'center', color: childGlyphColor(child.status) } },
                childGlyph(child.status),
              ),
              // 父会话自身的合成行（D6）带明确身份标识，不冒充工种徽章
              child.isSelf ? chip('主编排', '主编排（本会话）：会话自身的模型用量，不含子代', ACCENT_QUEUE) : typeChip(child.agentType),
              chip(shortId(child.childId, 6), child.childId),
              child.frozen ? React.createElement('span', { title: '终态已冻结（不再扫描）', style: { flexShrink: 0, fontSize: 9 } }, '🔒') : null,
            ),
            costColumn ? costCell(costShown) : null,
          ),
          // 行2：该子代四桶合计（totals 是段间合计，§4）
          segments.length > 0
            ? gridRow(GRID_NO_COST, `c2-${child.childId}`, { accent: running ? ACCENT_RUNNING : undefined },
                ...BUCKET_COLUMNS.map(({ bucket, label }, index) => React.createElement('span', {
                  key: bucket,
                  style: {
                    textAlign: 'right',
                    color: '#888',
                    gridColumn: index === 0 ? '2' : undefined,
                  },
                },
                  `${label} `,
                  formatBucketCell(child.totals?.[bucket], rowPartial),
                )),
              )
            : React.createElement('div', { style: { color: '#666', fontSize: 10, padding: '0 6px 2px 18px', fontFamily: MONO_FONT } }, '无消息'),
          isOpen && segments.length > 0
            ? segments.map((segment, i) => {
                const segPartial = segment.partial === true
                const segCost = computeCost(segment.buckets, priceIndex[priceKey(segment.provider, segment.model)])
                const segCostShown = segCost ? { ...segCost, partial: segCost.partial || segPartial } : null
                const segName = modelDisplayKey(segment.provider, segment.model)
                return gridRow(costColumn ? GRID_WITH_COST : GRID_NO_COST, `s-${child.childId}-${i}`,
                  { padding: '1px 6px 1px 18px' },
                  nameCell(segName, segName),
                  ...BUCKET_COLUMNS.map(({ bucket }) => tokenCell(segment.buckets?.[bucket], segPartial)),
                  costColumn ? costCell(segCostShown) : null,
                )
              })
            : null,
        )
      }),
    )
  }

  const renderTotals = () => {
    const children = Array.isArray(report.children) ? report.children : []
    const byModel = Array.isArray(report.byModel) ? report.byModel : []
    const totalCost = computeTotalCost(report)
    const totalCostShown = totalCost ? { ...totalCost, partial: totalCost.partial || partial } : null
    const stat = (label, value, title) => React.createElement('div', { key: label, title, style: { padding: '2px 0' } },
      React.createElement('div', { style: { color: '#777', fontSize: 10 } }, label),
      React.createElement('div', { style: { color: '#c8c8c8', fontFamily: MONO_FONT, fontSize: 14 } }, value),
    )
    const bucketStat = ({ bucket, label }) => {
      const value = report.totals?.[bucket]
      return stat(label, formatBucketCell(value, partial), value === null || value === undefined
        ? '未上报（≠ 0）'
        : `精确值 ${formatFullTokens(value)}${partial ? '（含未上报分桶，为下界）' : ''}`)
    }
    return React.createElement('div', { style: { padding: '4px 6px' } },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', columnGap: 8 } },
        BUCKET_COLUMNS.map(bucketStat),
      ),
      costColumn
        ? React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' } },
            React.createElement('span', { style: { color: '#777', fontSize: 11 } }, '总成本'),
            React.createElement('span', { title: totalCostShown ? `精确值 ${costSymbol}${totalCostShown.value.toFixed(6)}${totalCostShown.partial ? '（含未定价/未上报桶，为下界）' : ''}` : undefined, style: { color: '#c8c8c8', fontFamily: MONO_FONT, fontSize: 13 } }, formatCost(totalCostShown, report?.currency) ?? '—'),
          )
        : null,
      React.createElement('div', { style: { color: '#888', fontSize: 11, marginTop: 6 } },
        `子代 ${childRowCount(report)} · 模型段 ${byModel.length} · 消息 ${sumMessageCount(report)} 条`,
      ),
      partial
        ? React.createElement('div', { style: { color: '#777', fontSize: 10, marginTop: 2 } }, '带 ≥ 的数字为下界：部分分桶未上报或扫描不完整，如实不计入。')
        : null,
    )
  }

  const renderBody = () => {
    if (empty !== null) {
      const bannerStyle = {
        marginBottom: 4,
        padding: '5px 8px',
        borderRadius: 6,
        background: 'rgba(244,67,54,0.1)',
        border: '1px solid rgba(244,67,54,0.3)',
        fontSize: 11,
      }
      if (empty.kind === 'error') {
        return React.createElement('div', null,
          React.createElement('div', { style: bannerStyle }, `⚠ ${empty.message}`),
          empty.hint ? React.createElement('div', { style: { color: '#888', fontSize: 10, padding: '0 6px' } }, empty.hint) : null,
        )
      }
      return React.createElement('div', { style: { color: '#888', fontSize: 12, padding: '2px 8px 4px' } }, empty.message)
    }
    const list = tab === 'models' ? renderModels() : tab === 'children' ? renderChildren() : renderTotals()
    // 合计是单卡无需滚动；两个列表视图 30+ 行自滚动（Z18）
    if (tab === 'totals') return list
    return React.createElement('div', { style: { maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto', minWidth: 0 } }, list)
  }

  const generatedAtTitle = () => {
    const ts = Number(report?.generatedAt)
    return Number.isFinite(ts) && ts > 0 ? `数据生成于 ${new Date(ts).toLocaleTimeString()}` : '当前会话的编排用量统计'
  }

  return React.createElement('div', { style: { marginBottom: 10 } },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: open ? 4 : 0 },
      onClick: onToggle,
      title: generatedAtTitle(),
    },
      React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, `${open ? '▾' : '▸'} 用量统计`),
      report
        ? React.createElement('span', { style: { fontSize: 11, lineHeight: '15px', padding: '0 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#999' } },
            String(Array.isArray(report.children) ? report.children.length : 0),
          )
        : null,
    ),
    open ? React.createElement(React.Fragment, null,
      React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 4 } },
        USAGE_TABS.map((t) => React.createElement('button', {
          key: t.key,
          onClick: () => setTab(t.key),
          style: {
            border: 'none',
            background: tab === t.key ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: tab === t.key ? '#e0e0e0' : '#999',
            fontSize: 11,
            lineHeight: '18px',
            padding: '1px 8px',
            borderRadius: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
          },
        }, t.label)),
      ),
      renderBody(),
    ) : null,
  )
}
