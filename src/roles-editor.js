/**
 * dsh-my-go — role detail pane.
 *
 * The right-hand column of the 模型与角色 block: everything you can change about
 * the *selected* role. Built-in and custom roles share the pane; a custom row
 * additionally gets card JSON export/overwrite and delete controls.
 *
 * Pure render function: no state, no draft knowledge beyond what it is handed.
 * Every mutation leaves through a callback the page owns (which is what stamps
 * the draft and its revision fence), and row math stays in roster-rows.js /
 * chain-rows.js.
 */

import * as React from 'react'

import { addChainEntry, composeChain, moveChainEntry, removeChainEntry, updateChainEntry } from './chain-rows.js'
import { personaOverrideSource } from './roster-rows.js'

const el = React.createElement

const EFFORTS = ['', 'low', 'high', 'max']
export const effortLabel = (value) => (value === ''
  ? '跟随模型默认（不单独指定）'
  : { low: '低（low）', high: '高（high）', max: '最高（max）' }[value] ?? value)

/**
 * @param deps.role - `{ key, label, builtin }`, the selected row.
 * @param deps.current - the page draft (promoted shape).
 * @param deps.writable - false disables every control and every callback.
 * @param deps.catalog - `{ providers, models, errors }` model-catalog snapshot.
 * @returns the pane tree.
 */
export function renderRolesPane(deps) {
  const {
    role,
    current,
    writable,
    catalog,
    importError,
    personaFileErr = {},
    setBinding,
    setChain,
    setPersona,
    loadBuiltinPersona,
    onExportRole,
    onImportOverwrite,
    onDeleteRole,
    onRenameRole,
    // 自定义角色「角色键名」输入框的受控草稿与写入口（P2，见下方输入框注释）。
    // 内置角色不渲染该输入框，故两者对内置行是无关参数。
    roleKeyDraft,
    onRoleKeyDraftChange,
  } = deps
  const key = role.key
  const builtin = role.builtin === true
  const row = builtin ? (current[key] ?? {}) : (current.roles?.[key] ?? {})
  const disabled = !writable
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const modelMap = catalog.models && typeof catalog.models === 'object' ? catalog.models : {}
  const modelsFor = (providerId) => (providerId
    ? (Array.isArray(modelMap[providerId]) ? modelMap[providerId] : [])
    : [...new Set(Object.values(modelMap).flat())].filter((id) => typeof id === 'string' && id !== ''))
  // 渠道级失败标记：清单读取失败与「该渠道真的没有模型」必须可分——否则用户只
  // 能对着一张空下拉猜 provider 是不是坏了。
  const listErrorFor = (providerId) => {
    if (!providerId) return ''
    const errors = catalog.errors && typeof catalog.errors === 'object' ? catalog.errors : {}
    const detail = errors[providerId]
    return typeof detail === 'string' && detail !== '' ? detail : ''
  }
  return el('div', { className: 'mygo-col', 'data-pane': 'role' },
    el('div', { className: 'mygo-colHead' },
      el('span', { className: 'mygo-label' }, `正在编辑：${role.label}`),
      builtin ? null : el('span', { className: 'mygo-rowBadge' }, '自定义'),
    ),

    renderChainEditor(row, providers, modelsFor, listErrorFor, disabled, (shape) => setChain(key, shape)),

    el('div', { className: 'mygo-fields' },
      el('div', { className: 'mygo-field' },
        el('label', { className: 'mygo-label' }, '思考档位（Reasoning Effort）'),
        el('select', {
          className: 'mygo-select',
          value: row.reasoningEffort ?? '',
          disabled,
          onChange: (event) => setBinding(key, 'reasoningEffort', event.target.value),
        }, EFFORTS.map((option) => el('option', { key: option, value: option }, effortLabel(option)))),
        el('div', { className: 'mygo-hint' }, '推理强度：越高越聪明，也越贵。'),
      ),
      key === 'sisyphus'
        ? el('div', { className: 'mygo-field mygo-fieldWide' },
          el('div', { className: 'mygo-hint' }, 'Sisyphus 的编排纪律人设不提供面板覆盖；总调度只认对话框所选模型，此处配置为兜底/补丁位（仅当插件配置 bindSisyphus 开启时生效）。'),
        )
        : el('div', { className: 'mygo-field mygo-fieldWide' },
          el('label', { className: 'mygo-label' }, '人设覆盖（Persona）'),
          el('div', { className: 'mygo-hint' }, `当前来源：${personaOverrideSource(current.roles?.[key])}；留空保存 = 恢复 prompts/${key}.md 文件默认`),
          el('textarea', {
            className: 'mygo-textarea',
            value: current.roles?.[key]?.persona ?? '',
            rows: 3,
            disabled,
            placeholder: `留空 = 使用 prompts/${key}.md 文件默认人设`,
            onChange: (event) => setPersona(key, event.target.value),
          }),
          el('div', { className: 'mygo-colFoot' },
            builtin
              ? el('button', {
                className: 'mygo-btn mygo-btnMini',
                disabled,
                title: `读取 prompts/${key}.md 原文填入上方编辑框（草稿态，点保存才生效）`,
                onClick: () => loadBuiltinPersona(key),
              }, '载入文件默认')
              : null,
            personaFileErr[key] ? el('span', { className: 'mygo-statusError' }, personaFileErr[key]) : null,
          ),
        ),
    ),


    builtin ? null : el('div', { className: 'mygo-field' },
      el('label', { className: 'mygo-label' }, '角色键名'),
      // 受控草稿（P2）：value 必须是页面持有的草稿，不能直接绑 `key`——绑 key 时
      // 每敲一个字符都会被下一次渲染刷回旧键名，输入框实际只读，失焦改名永不触发。
      // 失焦三态：未改/清空 → 回落到原键名；被拒（renameRole 返回 false，非法或
      // 重名，提示走 importError）→ 回滚到原键名；成功 → renameRole 已 setPicked(next)，
      // 选中换人 ⇒ 草稿自动回落到新键名（无需在这里再写一次）。
      el('input', {
        className: 'mygo-input mygo-inputMono',
        'data-role': 'role-key',
        value: roleKeyDraft,
        disabled,
        spellCheck: false,
        onChange: (event) => onRoleKeyDraftChange?.(event.target.value),
        onBlur: (event) => {
          const next = String(event.target.value ?? '').trim()
          if (disabled) return
          if (next === '' || next === key) {
            if (next !== key) onRoleKeyDraftChange?.(key)
            return
          }
          const renamed = onRenameRole?.(key, next) !== false
          if (!renamed) onRoleKeyDraftChange?.(key)
        },
        title: '失焦即尝试改名：合法且未重名的键名立即生效（草稿态，点「立即保存」才落盘）',
      }),
    ),

    builtin ? null : el('div', { className: 'mygo-colFoot' },
      el('button', { className: 'mygo-btn mygo-btnMini', disabled, title: '把该角色的完整 JSON 复制到剪贴板', onClick: () => onExportRole?.(key) }, '导出 JSON'),
      el('button', { className: 'mygo-btn mygo-btnMini', disabled, title: '粘贴 JSON 覆盖该角色', onClick: () => onImportOverwrite?.(key) }, '从 JSON 覆盖'),
      el('button', {
        className: 'mygo-btn mygo-btnMini',
        disabled,
        onClick: () => onDeleteRole?.(key),
        title: '从草稿里删掉这个角色（保存后整键从 roles 字典移除）',
      }, `删除「${key}」`),
      importError ? el('span', { className: 'mygo-statusError' }, importError) : null,
    ),


  )
}

/** 模型优先级编辑器（内置与自定义共用）：#1 主选 + #2..N 备选链。 */
function renderChainEditor(row, providers, modelsFor, listErrorFor, disabled, onChange) {
  const chain = composeChain(row)
  // 交给页面的是链本体（不是分解后的形状）：provider/model/fallbacks 的拆分
  // 只有写面需要，收在一处才不会两处各拆一遍再各错一遍。
  const apply = (next) => onChange(next)
  return el('div', { className: 'mygo-field' },
    el('div', { className: 'mygo-label' }, '模型优先级（主选 + 备选链）'),
    el('div', { className: 'mygo-hint' }, '#1 为主选；主模型失败（限流重试耗尽后）按序自动切换后续条目。备选 ↑ 到顶 = 一键扶正为主选；删除 #1 则 #2 自动扶正。'),
    el('div', { className: 'mygo-chain' }, chain.map((entry, index) => {
      const listError = listErrorFor(entry.provider)
      return el(React.Fragment, { key: `mygo-chain-${index}` },
        el('div', { className: 'mygo-chainRow' },
          el('span', { className: 'mygo-chainIndex' },
            `#${index + 1}`,
            index === 0 ? el('span', { className: 'mygo-rowBadge', 'data-tone': 'on' }, '主选') : null,
          ),
          combobox(entry.provider, providers, `mygo-chain-providers-${index}`,
            index === 0 ? '跟随 Sisyphus（点选或手填渠道）' : '（渠道：点选或手填）',
            disabled,
            (value) => apply(updateChainEntry(chain, index, 'provider', value))),
          combobox(entry.model, modelsFor(entry.provider), `mygo-chain-models-${index}`,
            index === 0 ? '跟随 Sisyphus（点选或手填模型）' : '（模型：点选或手填）',
            disabled,
            (value) => apply(updateChainEntry(chain, index, 'model', value))),
          el('div', { className: 'mygo-chainActors' },
            el('button', { className: 'mygo-btn mygo-btnMini', disabled: disabled || index === 0, title: '上移（#2 到顶即扶正为主选）', onClick: () => apply(moveChainEntry(chain, index, -1)) }, '↑'),
            el('button', { className: 'mygo-btn mygo-btnMini', disabled: disabled || index === chain.length - 1, title: '下移（更后尝试）', onClick: () => apply(moveChainEntry(chain, index, 1)) }, '↓'),
            el('button', { className: 'mygo-btn mygo-btnMini', disabled: disabled || chain.length <= 1, title: '删除该行（至少保留主选位；删 #1 则 #2 扶正）', onClick: () => apply(removeChainEntry(chain, index)) }, '×'),
          ),
        ),
        listError
          ? el('div', { className: 'mygo-hint' }, `⚠ 渠道 ${entry.provider} 的模型清单读取失败：${listError}（可直接手填模型名，不影响保存）`)
          : null,
      )
    })),
    el('div', { className: 'mygo-colFoot' },
      el('button', { className: 'mygo-btn mygo-btnMini', disabled, onClick: () => apply(addChainEntry(chain, { provider: '', model: '' })) }, '+ 添加条目'),
    ),
  )
}

function combobox(value, options, listId, placeholder, disabled, onChange) {
  return el('div', { className: 'mygo-field' },
    el('input', {
      className: 'mygo-input mygo-inputMono',
      value: value ?? '',
      list: listId,
      placeholder,
      disabled,
      spellCheck: false,
      onChange: (event) => onChange(event.target.value),
    }),
    el('datalist', { id: listId }, options.filter((option) => option !== '').map((option) => el('option', { key: option, value: option }))),
  )
}
