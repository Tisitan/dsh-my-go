/**
 * dsh-my-go — usage price table editor (contract D1, usage-stats design doc
 * §5 settings-page seam).
 *
 * Pure render function for the settings-page usage-prices section: one card,
 * one row per "{provider}/{model}" key with four bucket inputs (USD / 1M
 * tokens), create-by-key input, per-row validation hints. All state (draft,
 * card open-map, new-key input) is injected by settings-core via the explicit
 * `deps` object — this module holds no state. Row mutations go through the
 * usage-price-rows.js pure functions; the save boundary in settings-core
 * drops invalid rows, so validation here is advisory red text, never a gate
 * that eats keystrokes.
 */

import * as React from 'react'

import { addPriceRow, removePriceRow, updatePriceRow, validatePriceRow, priceKeyHint, priceKeyOptions, PRICE_BUCKETS, REQUIRED_BUCKETS } from './usage-price-rows.js'
import { currencySymbol } from './usage-views.js'
import { MONO_FONT } from './client-constants.js'

// Chinese labels for the four buckets (D1a UX pass); the schema keys stay
// English — these name the inputs only.
const BUCKET_LABELS = { input: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入' }
// One global currency knob drives the whole table's unit (D1a) — the select
// mirrors settings-core's makeSelect look by receiving it through deps.
const CURRENCY_OPTIONS = ['USD', 'CNY']
const currencyLabel = (v) => (v === 'CNY' ? '人民币（CNY）' : '美元（USD）')
const unitHintFor = (currency) => (currency === 'CNY' ? '元 / 1M tokens（人民币）' : '美元 / 1M tokens（USD）')

export function renderUsagePricesEditor(deps) {
  const {
    draft,
    setDraft,
    newPriceKey,
    setNewPriceKey,
    openCards,
    setOpenCards,
    makeSelect,
    makeCombobox,
    available,
    styles,
  } = deps
  const { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle } = styles

  // Raw draft table on purpose: rows persisted dirty (hand-edited settings.yaml)
  // must stay visible with their error hint, not vanish from the editor.
  const rows = draft?.usagePrices && typeof draft.usagePrices === 'object' && !Array.isArray(draft.usagePrices)
    ? draft.usagePrices
    : {}
  // Same fallback as the aggregator (D1a): an absent/unknown currency renders
  // as USD instead of a bare unqualified figure.
  const currency = draft?.usageCurrency === 'CNY' ? 'CNY' : 'USD'
  const setCurrency = (value) => {
    if (!draft) return
    setDraft((prev) => (prev ? { ...prev, usageCurrency: value } : prev))
  }
  const applyRows = (next) => {
    if (!draft) return
    setDraft((prev) => (prev ? { ...prev, usagePrices: next } : prev))
  }
  const createRow = () => {
    if (!draft) return
    const key = newPriceKey.trim()
    if (key in rows) return
    const next = addPriceRow(rows, key)
    if (next === rows) return
    applyRows(next)
    setNewPriceKey('')
    setOpenCards((prev) => ({ ...prev, 'usage-prices': true }))
  }
  const toggleCard = (id) => setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }))
  const cardOpen = (id) => openCards[id] === true
  const open = cardOpen('usage-prices')
  const count = Object.keys(rows).length
  const keyHint = priceKeyHint(newPriceKey)

  const bucketInputStyle = { ...selectStyle, fontFamily: MONO_FONT, padding: '4px 6px', fontSize: 12 }

  return React.createElement('div', { style: cardStyle },
    React.createElement('div', {
      style: { cursor: 'pointer', marginBottom: open ? 8 : 0 },
      onClick: () => toggleCard('usage-prices'),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
        React.createElement('span', { style: glyphStyle }, open ? '▾' : '▸'),
        React.createElement('span', { style: { fontWeight: 600 } }, '用量单价表（Usage Prices）'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary, #888)' } }, '按模型计价，用量面板的成本列由单价实时折算'),
      ),
      React.createElement('div', { style: summaryStyle }, count === 0 ? '未配置单价' : `已定价 ${count} 个模型`),
    ),
    open ? React.createElement(React.Fragment, null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
        React.createElement('span', { style: labelStyle }, '计价币种'),
        makeSelect
          ? makeSelect(currency, CURRENCY_OPTIONS, currencyLabel, setCurrency, !draft)
          : React.createElement('span', { style: { fontSize: 12, color: 'var(--text-secondary, #888)' } }, currencyLabel(currency)),
        React.createElement('span', { style: hintStyle }, `单价单位：${unitHintFor(currency)}；成本列符号 ${currencySymbol(currency)}`),
      ),
      React.createElement('div', { style: { ...hintStyle, marginBottom: 8 } },
        '全局币种对整张单价表生效（不按行混币种），改完点「立即保存」生效；价格热更不影响统计，成本在展示层实时折算。未定价的模型只记 token、成本列显示「—」。',
      ),
      count === 0
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--text-secondary, #888)', marginBottom: 8 } },
            '未配置单价，仅统计 token 用量，不计成本。每行含：输入 / 输出 / 缓存读取 / 缓存写入 四档单价；用下方模型选框（可直接手填 provider/model）添加单价。')
        : null,
      Object.entries(rows).map(([key, row]) => {
        const error = validatePriceRow(row)
        return React.createElement('div', { key: `price-${key}`, style: { border: '1px solid var(--separator, #333)', borderRadius: 6, padding: 8, marginBottom: 6 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
            React.createElement('span', { style: { fontWeight: 600, fontFamily: MONO_FONT, fontSize: 12, overflowWrap: 'anywhere' } }, key),
            React.createElement('button', {
              style: { ...miniBtnStyle, marginLeft: 'auto' },
              title: `删除 ${key} 的单价（保存后生效）`,
              disabled: !draft,
              onClick: () => applyRows(removePriceRow(rows, key)),
            }, '删除'),
          ),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 } },
            PRICE_BUCKETS.map((bucket) => React.createElement('label', { key: `${key}-${bucket}`, style: { display: 'block', minWidth: 0 } },
              React.createElement('div', { style: labelStyle }, BUCKET_LABELS[bucket]),
              React.createElement('input', {
                type: 'text',
                inputMode: 'decimal',
                value: row?.[bucket] ?? '',
                placeholder: REQUIRED_BUCKETS.includes(bucket) ? '必填' : '留空=未定价',
                disabled: !draft,
                spellCheck: false,
                onChange: (e) => applyRows(updatePriceRow(rows, key, bucket, e.target.value)),
                style: bucketInputStyle,
              }),
            )),
          ),
          error
            ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, `⚠ ${error}（该行将被跳过，不会保存）`)
            : null,
        )
      }),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        makeCombobox
          ? makeCombobox(newPriceKey, priceKeyOptions(available, rows), 'usage-price-new-key',
              '选择模型（可直接手填 provider/model）', setNewPriceKey, !draft)
          : React.createElement('input', {
              value: newPriceKey,
              placeholder: 'provider/model，如 newapi/k3-256k…',
              disabled: !draft,
              onChange: (e) => setNewPriceKey(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') createRow() },
              style: { ...selectStyle, fontFamily: MONO_FONT },
            }),
        React.createElement('button', {
          style: miniBtnStyle,
          disabled: !draft || newPriceKey.trim() === '' || keyHint !== null || newPriceKey.trim() in rows,
          title: `为所选模型添加一行单价（${unitHintFor(currency)}）`,
          onClick: createRow,
        }, '+ 添加单价'),
      ),
      keyHint !== null
        ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, keyHint)
        : null,
      newPriceKey.trim() !== '' && keyHint === null && newPriceKey.trim() in rows
        ? React.createElement('div', { style: { fontSize: 12, color: '#f44336', marginTop: 4 } }, '该模型的单价行已存在')
        : null,
    ) : null,
  )
}
