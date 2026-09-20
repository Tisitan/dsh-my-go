/**
 * dsh-my-go — usage price detail pane (0.5.0-tisitan.3).
 *
 * The right-hand column of the 用量单价表 block: the currency knob for the whole
 * table plus the four buckets of the selected "{provider}/{model}" key.
 *
 * Validation stays advisory (red hint, never a gate that eats keystrokes): the
 * save boundary in settings-ops.js drops an incomplete row fail-closed, so a
 * half-typed row cannot poison the rest of the batch — the same discipline the
 * retired host-side `saveSettings` closure enforced.
 */

import * as React from 'react'

import { PRICE_BUCKETS, PRICE_BUCKET_LABELS, PRICE_REQUIRED_BUCKETS } from '../preset/shared/constants.mjs'
import { validatePriceRow, priceKeyHint } from './usage-price-rows.js'
import { currencySymbol } from './usage-views.js'

const el = React.createElement

/**
 * @param deps.selectedPrice - the price key being edited (null = none selected).
 * @param deps.current - the page draft.
 * @param deps.writable - false disables every control.
 * @param deps.keys - catalog-derived "provider/model" suggestions.
 * @param deps.setCurrency / deps.setPrice / deps.onDeletePrice - page callbacks.
 * @returns the pane tree.
 */
export function renderPricesPane(deps) {
  const { selectedPrice, current, writable, keys = [], setCurrency, setPrice, onDeletePrice } = deps
  const currency = current.usageCurrency === 'CNY' ? 'CNY' : 'USD'
  const row = (selectedPrice && current.usagePrices?.[selectedPrice]) ? current.usagePrices[selectedPrice] : null
  const validation = row ? validatePriceRow(row) : null
  const unit = currency === 'CNY' ? '元 / 1M tokens（人民币）' : '美元 / 1M tokens（USD）'

  return el('div', { className: 'mygo-col', 'data-pane': 'price' },
    el('div', { className: 'mygo-colHead' },
      el('span', { className: 'mygo-label' }, selectedPrice ? `正在编辑：${selectedPrice}` : '正在编辑：（未选择计价键）'),
      selectedPrice ? null : el('span', { className: 'mygo-rowBadge' }, '空表'),
    ),
    el('div', { className: 'mygo-fields' },
      el('div', { className: 'mygo-field' },
        el('label', { className: 'mygo-label' }, '计价币种（全表一个）'),
        el('select', {
          className: 'mygo-select',
          value: currency,
          disabled: !writable,
          onChange: (event) => setCurrency(event.target.value),
        }, ['USD', 'CNY'].map((option) => el('option', { key: option, value: option }, option === 'CNY' ? '人民币（CNY）' : '美元（USD）'))),
        el('div', { className: 'mygo-hint' }, `单位：${unit}。混币种求和没有意义，所以整表共用一个旋钮。`),
      ),
      el('div', { className: 'mygo-field' },
        el('label', { className: 'mygo-label' }, '计价键'),
        el('input', {
          className: 'mygo-input mygo-inputMono',
          value: selectedPrice ?? '',
          disabled: true,
          list: 'mygo-price-suggest',
          placeholder: '形如 deepseek/deepseek-chat',
        }),
        el('datalist', { id: 'mygo-price-suggest' }, keys.map((key) => el('option', { key, value: key }))),
        el('div', { className: 'mygo-hint' }, selectedPrice ? '改键名请新建一行再删旧行。' : (priceKeyHint('') ?? '键格式：provider/model（第一个 / 切分，两段都非空）。')),
      ),
      PRICE_BUCKETS.map((bucket) => el('div', { key: bucket, className: 'mygo-field' },
        el('label', { className: 'mygo-label' }, `${PRICE_BUCKET_LABELS[bucket]}（${bucket}）`),
        el('input', {
          className: 'mygo-input mygo-inputMono',
          value: row ? String(row[bucket] ?? '') : '',
          type: 'number',
          min: '0',
          step: 'any',
          disabled: !writable || !selectedPrice,
          placeholder: PRICE_REQUIRED_BUCKETS.includes(bucket) ? '必填' : '可选（未定价）',
          'aria-label': `${selectedPrice ?? '价格'} ${bucket}`,
          onChange: (event) => setPrice(selectedPrice, bucket, event.target.value),
        }),
      )),
    ),
    el('div', { className: 'mygo-colFoot' },
      el('span', {
        className: validation ? 'mygo-statusError' : 'mygo-hint',
        'data-role': 'price-validation',
      }, row === null
        ? '左列选一条计价键来改，或在下方新建一行。'
        : validation ? `未就绪：${validation}（这一行保存时会被整行跳过，不影响其它行）` : '四桶合法，保存即生效。'),
      el('button', {
        className: 'mygo-btn mygo-btnMini',
        disabled: !writable || !selectedPrice,
        onClick: () => onDeletePrice?.(selectedPrice),
        title: '从草稿里删掉这一行（保存后整键移除）',
      }, selectedPrice ? `删除「${selectedPrice}」` : '删除行'),
      el('span', { className: 'mygo-hint' }, `当前币种符号：${currencySymbol(currency)}`),
    ),
  )
}

