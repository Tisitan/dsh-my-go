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
 * `__ModuleLoader__.load` wrapper around the esbuild CJS bundle). React is a
 * Client Builtin — reference it directly, never via globalThis.
 */

export const name = 'dsh-my-go'

export const inject = ['slots']

export function apply(ctx) {
  const client = ctx

  const slots = client.get('slots')
  if (!slots) return

  const host = client.get('host')
  const sessions = client.get('sessions')
  const timer = client.get('timer')

  // ── shared state ────────────────────────────────────────────────────────
  let panelOpen = false
  let snapshot = { seq: 0, current: null, queue: [], helpRequests: [], history: [] }
  const listeners = new Set()
  const emit = () => { for (const l of [...listeners]) { try { l() } catch { /* noop */ } } }

  async function refresh() {
    if (!host || typeof host.call !== 'function') return
    try {
      const next = await host.call('dsh-my-go/snapshot')
      const changed = next && next.seq !== snapshot.seq
      if (next) snapshot = next
      if (changed) emit()
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
    const [open, setOpen] = React.useState(panelOpen)
    const [, force] = React.useState(0)

    React.useEffect(() => {
      const unsub = () => listeners.delete(force)
      listeners.add(force)
      return unsub
    }, [])

    if (!open) return null
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
        React.createElement('button', { onClick: () => setOpen(false) }, '×'),
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
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'dsh-my-go', order: 30, label: 'MyGO 编排' },
    (props) => React.createElement(SettingsPage, props),
  ))

  function SettingsPage(_props) {
    return React.createElement('div', { style: { padding: 16 } },
      React.createElement('h2', null, 'MyGO 编排配置'),
      React.createElement('p', null, '每个子智能体的模型 / 思考程度 / DSV4P0813 补丁开关。修改后通过 Settings 服务持久化。'),
      React.createElement('div', { style: { color: '#888', marginTop: 12 } }, '配置项由 host 侧 settings 命名空间 dsh-my-go 提供；修改后生效于下一次派发。'),
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
          sessions.openSubagent({ parentSessionId: '', childSessionId: current.childId, mode: 'continuable' })
        } else if (!current && lastJumpedTo && sessions) {
          // Child settled; jump back to the parent.
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
