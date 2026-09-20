/**
 * dsh-my-go — role detail pane (0.5.0-tisitan.3).
 *
 * The right-hand column of the 模型与角色 block: everything you can change about
 * the *selected* role. Built-in and custom roles share the pane; a custom row
 * additionally gets the tool allow/deny lists, the card JSON export/overwrite and
 * the delete, because those fields only exist on custom rows of the roles dict.
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
 * @param deps.tools - the host tool roster (datalist suggestions only).
 * @returns the pane tree.
 */
export function renderRolesPane(deps) {
  const {
    role,
    current,
    writable,
    catalog,
    tools = [],
    toolDrafts = {},
    setToolDrafts,
    importError,
    personaFileErr = {},
    rosterFailed = false,
    setBinding,
    setChain,
    setPersona,
    setToolFilter,
    loadBuiltinPersona,
    onExportRole,
    onImportOverwrite,
    onDeleteRole,
    onRenameRole,
    onRefreshTools,
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
  const filter = row.toolFilter && typeof row.toolFilter === 'object' ? row.toolFilter : {}
  const namesOf = (side) => (Array.isArray(filter[side]) ? filter[side].map(String) : [])
  const toolList = (side) => {
    const names = namesOf(side)
    const pending = toolDrafts?.[key]?.[side] ?? ''
    const listId = `mygo-tf-${key}-${side}`
    const write = (next) => setToolFilter(key, { allow: side === 'allow' ? next : namesOf('allow'), deny: side === 'deny' ? next : namesOf('deny') })
    return el('div', { className: 'mygo-field' },
      el('label', { className: 'mygo-label' }, side === 'allow' ? '工具白名单（allow）' : '工具黑名单（deny）'),
      names.length === 0
        ? el('div', { className: 'mygo-hint' }, side === 'allow' ? '（空 = 全量，除全局掩码）' : '（空 = 不额外屏蔽）')
        : el('div', { className: 'mygo-chips' }, names.map((name, index) => el('span', { key: `${side}-${name}-${index}`, title: name, className: 'mygo-chip' },
          el('span', { className: 'mygo-chipName' }, name),
          el('span', {
            role: 'button',
            className: 'mygo-chipKill',
            title: '移除',
            'aria-label': `移除 ${name}`,
            onClick: () => { if (!disabled) write(names.filter((_, at) => at !== index)) },
          }, '×'),
        ))),
      el('div', { className: 'mygo-colFoot' },
        el('input', {
          className: 'mygo-input mygo-inputMono',
          value: pending,
          list: listId,
          placeholder: '工具名（可点选，也可手填未连接工具）',
          disabled,
          spellCheck: false,
          onChange: (event) => setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: event.target.value } })),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && pending.trim() !== '' && !disabled) add()
          },
        }),
        el('datalist', { id: listId }, tools.filter((name) => !names.includes(name)).map((name) => el('option', { key: name, value: name }))),
        el('button', {
          className: 'mygo-btn mygo-btnMini',
          disabled: disabled || pending.trim() === '',
          title: '加入名单',
          onClick: add,
        }, '+ 添加'),
      ),
    )

    function add() {
      const name = pending.trim()
      if (name === '' || names.includes(name)) {
        setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: '' } }))
        return
      }
      write([...names, name])
      setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: '' } }))
    }
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
      el('div', { className: 'mygo-field' },
        el('label', { className: 'mygo-label' }, 'DSV4P0813 补丁'),
        el('label', { className: 'mygo-check' },
          el('input', {
            type: 'checkbox',
            checked: row.dsv4p0813 === true,
            disabled: disabled || key === 'sisyphus',
            onChange: (event) => setBinding(key, 'dsv4p0813', event.target.checked),
          }),
          '启用',
        ),
        el('div', { className: 'mygo-hint' }, key === 'sisyphus'
          ? 'Sisyphus 会话不经过 DSV4P0813 注入识别面，勾选对其不生效，已置灰锁定。'
          : '两阶段锚定上下文注入，专为 DeepSeek V4 Pro 0813 调校，其他模型勿开；只对 MyGO preset 派发的子代理会话生效。'),
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

    builtin ? null : el('div', { className: 'mygo-fields' }, toolList('allow'), toolList('deny')),

    builtin ? null : el('div', { className: 'mygo-field' },
      el('label', { className: 'mygo-label' }, '角色键名'),
      el('input', {
        className: 'mygo-input mygo-inputMono',
        value: key,
        disabled,
        spellCheck: false,
        onBlur: (event) => {
          const next = event.target.value.trim()
          if (!disabled && next !== '' && next !== key) onRenameRole?.(key, next)
        },
        title: '改名请直接在角色清单里新建 + 删除；这里失焦即尝试重命名',
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

    builtin ? null : el('div', { className: 'mygo-colFoot' },
      rosterFailed
        ? el('span', { className: 'mygo-hint' }, '工具花名册拉取失败：名单只是不给提示，手填照常。')
        : el('span', { className: 'mygo-hint' }, `宿主花名册 ${tools.length} 个工具可点选。`),
      el('button', { className: 'mygo-btn mygo-btnMini', onClick: () => onRefreshTools?.(), title: 'MCP 刚连上新工具时重拉一次名单' }, '刷新花名册'),
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
