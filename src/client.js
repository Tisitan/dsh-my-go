/**
 * dsh-my-go — Sisyphus agent orchestration (CLIENT half).
 *
 *  - `sidebar.footer.action` "🧭" entry: toggles the orchestration panel.
 *  - `shell.overlay` "dsh-my-go-panel": tree panel showing sub-agent status
 *    (current / queue / help / history), with click-to-jump via
 *    `sessions.openSubagent`.
 *  - `settings.section` "dsh-my-go": per-agent model/effort/DSV4P0813 config.
 *  - Auto-jump: while a sub-agent is running, follow it; on settle, jump back
 *    to the Sisyphus parent session.
 *
 * Built by scripts/build-client.mjs into dist/client.js (a
 * `__ModuleLoader__.load` wrapper around the esbuild CJS bundle). React is
 * external in the bundle and resolved through the loader's require, so we
 * import it here — NOT the dynamic-plugin Builtin (that path has no
 * import and relies on an ambient global, which breaks under esbuild).
 */

import * as React from 'react'

export const name = 'dsh-my-go'

export const inject = ['slots', 'settingsScope', 'connection']

const AGENT_TYPES = ['sisyphus', 'hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']
const AGENT_LABELS = { sisyphus: 'Sisyphus', hermes: 'Hermes', explore: 'Explore', librarian: 'Librarian', looker: 'Looker', hephaestus: 'Hephaestus', prometheus: 'Prometheus', oracle: 'Oracle' }

export function apply(ctx) {
  const client = ctx

  const slots = client.get('slots')
  if (!slots) return

  const connection = client.connection
  const sessions = client.get('sessions')
  const timer = client.get('timer')

  // ── shared state ────────────────────────────────────────────────────────
  let panelOpen = false
  let snapshot = { seq: 0, current: null, queue: [], helpRequests: [], history: [] }
  const listeners = new Set()
  const emit = () => { for (const l of [...listeners]) { try { l() } catch { /* noop */ } } }

  async function refresh() {
    if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') return
    try {
      const res = await connection.rpc.call('/dsh-my-go', 'snapshot', {})
      if (res && res.ok) {
        const next = res.value
        const changed = next && next.seq !== snapshot.seq
        if (next) snapshot = next
        if (changed) emit()
      }
    } catch { /* host not ready */ }
  }

  const stopPolling = timer && typeof timer.interval === 'function'
    ? timer.interval(() => { void refresh() }, 600)
    : undefined

  // ── tree panel component (overlay) ──────────────────────────────────────
  function statusGlyph(status) {
    switch (status) {
      case 'running': return '●'
      case 'waiting': return '❓'
      case 'spawning': return '◐'
      case 'queued': return '⏳'
      case 'done': return '✓'
      case 'failed': return '✗'
      default: return '○'
    }
  }

  function TreePanel(_props) {
    const [, force] = React.useState(0)

    React.useEffect(() => {
      const rerender = () => force((c) => c + 1)
      listeners.add(rerender)
      return () => listeners.delete(rerender)
    }, [])

    if (!panelOpen) return null
    const s = snapshot

    const node = (label, status, childId, onClick) =>
      React.createElement('div', {
        style: { padding: '2px 8px', cursor: onClick ? 'pointer' : 'default', display: 'flex', gap: 8, alignItems: 'center' },
        onClick,
      },
        React.createElement('span', null, status),
        React.createElement('span', null, label),
        childId ? React.createElement('span', { style: { color: '#888', fontSize: 11 } }, childId) : null,
      )

    const jump = (childId) => {
      if (sessions && typeof sessions.openSubagent === 'function') {
        sessions.openSubagent({ parentSessionId: '', childSessionId: childId, mode: 'continuable' })
      }
    }

    const current = s.current
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 64,
        right: 16,
        width: 320,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'var(--surface, #1e1e1e)',
        border: '1px solid var(--separator, #333)',
        borderRadius: 8,
        padding: 12,
        zIndex: 9999,
        fontFamily: 'var(--font, sans-serif)',
        fontSize: 13,
      },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
        React.createElement('strong', null, 'Sisyphus 编排'),
        React.createElement('button', { onClick: () => { panelOpen = false; emit() } }, '×'),
      ),

      React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '运行中'),
        current
          ? node(current.agentType ?? '?', statusGlyph(current.status), current.childId, () => current.childId && jump(current.childId))
          : React.createElement('div', { style: { color: '#888' } }, '○ 空闲'),
      ),

      React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `队列 (${s.queue.length})`),
        s.queue.map((w) => node(String(w.agentType ?? '?'), '⏳')),
      ),

      React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `求助 (${s.helpRequests.length})`),
        s.helpRequests.map((h) => node(`[${h.intent ?? '?'}]`, '❓', h.childId, () => h.childId && jump(h.childId))),
      ),

      React.createElement('div', null,
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `历史 (${s.history.length})`),
        s.history.slice(-8).map((r) => {
          const rec = r
          return node(`${rec.agentType ?? '?'} — ${String(rec.conclusion ?? '').replace(/\s+/g, ' ').slice(0, 60)}`, statusGlyph(rec.status), rec.childId, () => rec.childId && jump(rec.childId))
        }),
      ),
    )
  }

  // ── register overlay panel ──────────────────────────────────────────────
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'dsh-my-go-panel' },
    (props) => React.createElement(TreePanel, props),
  ))

  // ── register sidebar footer action (toggle) ─────────────────────────────
  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-my-go-toggle' },
    (props) => React.createElement('button', {
      onClick: () => {
        panelOpen = !panelOpen
        emit()
      },
      title: 'Sisyphus 编排面板',
      style: { width: props && props.wide ? '100%' : 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' },
    }, '🧭'),
  ))

  // ── settings page ───────────────────────────────────────────────────────
  const scope = client.get('settingsScope')
    ? client.get('settingsScope').bind({ namespace: 'dsh-my-go' })
    : null

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'dsh-my-go', order: 30, label: 'MyGO 编排' },
    (props) => React.createElement(SettingsPage, { ...props, scope }),
  ))

  function SettingsPage({ scope: sp, close }) {
    const [draft, setDraft] = React.useState(null)
    const [saving, setSaving] = React.useState(false)
    const [msg, setMsg] = React.useState(null)
    const [available, setAvailable] = React.useState({ providers: [], models: {} })

    React.useEffect(() => {
      if (!sp) return
      // Load settings via host RPC (DSH SettingsScope doesn't support nested reads)
      if (connection && connection.rpc && typeof connection.rpc.call === 'function') {
        connection.rpc.call('/dsh-my-go', 'loadSettings', {}).then((res) => {
          // 加载失败保持 draft=null 并禁用保存：空 draft 保存会清空全部配置
          if (res && res.ok) setDraft(res.value ?? {})
          else setDraft(null)
        }).catch(() => setDraft(null))
        connection.rpc.call('/dsh-my-go', 'listModels', {}).then((res) => {
          if (res && res.ok && res.value && Array.isArray(res.value.providers)) setAvailable(res.value)
        }).catch(() => {})
      }
    }, [sp])

    if (!sp) return React.createElement('div', { style: { padding: 16, color: '#888' } }, '设置服务不可用')

    const set = (type, field, value) => {
      setDraft((prev) => {
        const next = { ...prev, [type]: { ...prev?.[type], [field]: value } }
        // When provider changes, clear model if it's not in the new provider's model list
        if (field === 'provider') {
          const currentModel = next[type]?.model ?? ''
          const validModels = modelsForProvider(value)
          if (currentModel && !validModels.includes(currentModel)) {
            next[type] = { ...next[type], model: '' }
          }
        }
        return next
      })
    }

    // Manual save only — auto-save risks infinite loops with settings/updated events
    const save = async () => {
      if (!draft) { setMsg('配置尚未加载成功，已禁止保存以避免覆盖'); return }
      setSaving(true); setMsg(null)
      try {
        if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
          setMsg('连接不可用'); setSaving(false); return
        }
        const res = await connection.rpc.call('/dsh-my-go', 'saveSettings', draft)
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
    const cardStyle = { border: '1px solid var(--separator, #333)', borderRadius: 8, padding: 12, marginBottom: 12 }
    const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }

    const EFFORTS = ['', 'low', 'high', 'max']
    const providers = available.providers
    const providerLabel = (v) => v === '' ? '跟随 Sisyphus' : v
    const modelLabel = (v) => v === '' ? '跟随 Sisyphus' : v
    const effortLabel = (v) => v === '' ? '跟随模型默认' : v

    const makeSelect = (value, options, labelFn, onChange) =>
      React.createElement('select', { style: selectStyle, value: value ?? '', onChange: (e) => onChange(e.target.value) },
        ...options.map((opt) =>
          React.createElement('option', { key: opt, value: opt }, labelFn(opt))
        )
      )

    // Compute per-type model list: when provider is set, filter to that provider's models; otherwise show all
    const modelsForProvider = (providerId) => {
      if (!providerId) return [...new Set(Object.values(available.models).flat())]
      const specific = available.models[providerId]
      return Array.isArray(specific) ? specific : []
    }

    const fetchFailed = available.providers.length === 0

    return React.createElement('div', { style: { padding: 16, maxWidth: 600 } },
      React.createElement('h2', { style: { margin: '0 0 4px' } }, 'MyGO 编排配置'),
      React.createElement('p', { style: { margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary, #888)' } }, '每个子智能体的模型 / Provider / 思考程度 / DSV4P0813 补丁开关。修改后点保存，下次派发生效。'),
      fetchFailed ? React.createElement('div', {
        style: { padding: 12, marginBottom: 16, borderRadius: 6, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', fontSize: 13 },
      }, '⚠ 无法从 DSH 获取 Provider/Model 列表。请确认：1) 已重启 dsh web；2) LLM 插件已配置并激活。下拉框仍可手动输入自定义值。') : null,
      ...AGENT_TYPES.map((type) => {
        const cfg = draft?.[type] || {}
        return React.createElement('div', { key: type, style: cardStyle },
          React.createElement('div', { style: { fontWeight: 600, marginBottom: 8 } }, AGENT_LABELS[type] || type),
          React.createElement('div', { style: rowStyle },
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, 'Provider'),
              makeSelect(cfg.provider ?? '', ['', ...providers], providerLabel, (v) => set(type, 'provider', v)),
            ),
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, 'Model'),
              makeSelect(cfg.model ?? '', ['', ...modelsForProvider(cfg.provider ?? '')], modelLabel, (v) => set(type, 'model', v)),
            ),
          ),
          React.createElement('div', { style: rowStyle },
            React.createElement('div', null,
              React.createElement('div', { style: labelStyle }, 'Reasoning Effort'),
              makeSelect(cfg.reasoningEffort ?? '', EFFORTS, effortLabel, (v) => set(type, 'reasoningEffort', v)),
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 8 } },
              React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, paddingTop: 18 } },
                React.createElement('input', { type: 'checkbox', checked: cfg.dsv4p0813 === true, onChange: (e) => set(type, 'dsv4p0813', e.target.checked) }),
                'DSV4P0813',
              ),
            ),
          ),
        )
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

  // ── auto-jump: follow running sub-agent, jump back on settle ────────────
  let lastJumpedTo = null
  const unsub = () => { listeners.delete(refresh) }
  listeners.add(refresh)

  const stopAutoJump = timer && typeof timer.interval === 'function'
    ? timer.interval(() => {
        const current = snapshot.current
        if (current && current.childId && current.status === 'running' && lastJumpedTo !== current.childId && sessions) {
          lastJumpedTo = current.childId
          const parentSessionId = snapshot.parentSessionId
          if (parentSessionId) {
            try {
              sessions.openSubagent({
                parentSessionId,
                childSessionId: current.childId,
                mode: 'continuable',
              })
            } catch { /* fallback: just open the child session directly */ }
          }
        } else if (!current && lastJumpedTo && sessions) {
          lastJumpedTo = null
        }
      }, 800)
    : undefined

  // ── cleanup ─────────────────────────────────────────────────────────────
  return () => {
    if (stopPolling) stopPolling()
    if (stopAutoJump) stopAutoJump()
    unsub()
  }
}
