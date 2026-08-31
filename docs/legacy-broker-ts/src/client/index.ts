/**
 * dsh-my-go broker — CLIENT half.
 *
 *  - `sidebar.footer.action` "编排" entry: toggles the orchestration panel.
 *  - `shell.overlay` "dsh-my-go-panel": tree panel showing sub-agent status
 *    (current / queue / help / history), with click-to-jump via
 *    `sessions.openSubagent`.
 *  - `settings.section` "dsh-my-go": per-agent model/effort/DSV4P0813 config.
 *  - Auto-jump: while a sub-agent is running, follow it; on settle, jump back
 *    to the Sisyphus parent session.
 */

// Client plugins are plain JavaScript function bodies returning a Cordis
// plugin; React is provided by the runtime as a Client Builtin global. This
// file is the TYPE-SAFE source form; the dynamic verification build inlines
// the same logic.
declare const React: {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown
  useState: <T>(init: T) => [T, (v: T) => void]
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => void
}

export function apply(ctx: unknown): (() => void) | void {
  const client = ctx as {
    on: (event: string, listener: (payload: unknown) => void) => () => void
    get: (name: string) => unknown
    provide: (name: string, value: unknown) => () => void
    timeout: (callback: () => void, delay: number) => () => void
    interval: (callback: () => void, delay: number) => () => void
  }

  const slots = client.get('slots') as {
    inject: (key: string, callback: () => unknown) => () => void
    register: (options: { name: string; id?: string; order?: number; label?: string | (() => string) }, component: (props: never) => unknown) => unknown
  } | undefined
  if (!slots) return

  const host = client.get('host') as {
    call: (method: string, args?: unknown) => Promise<unknown>
  } | undefined
  const sessions = client.get('sessions') as {
    openSubagent: (address: { parentSessionId: string; childSessionId: string; mode: string }) => void
  } | undefined

  // ── shared state ────────────────────────────────────────────────────────
  let panelOpen = false
  let snapshot: { seq: number; current: unknown; queue: unknown[]; helpRequests: unknown[]; history: unknown[] } = {
    seq: 0,
    current: null,
    queue: [],
    helpRequests: [],
    history: [],
  }
  const listeners = new Set<() => void>()
  const emit = () => { for (const l of [...listeners]) { try { l() } catch { /* noop */ } } }

  async function refresh(): Promise<void> {
    if (!host) return
    try {
      const next = (await host.call('dsh-my-go/snapshot')) as typeof snapshot
      const changed = next?.seq !== snapshot.seq
      if (next) snapshot = next
      if (changed) emit()
    } catch { /* host not ready */ }
  }

  // Poll snapshot every 600ms while the plugin is active.
  const timer = client.get('timer') as {
    interval: (callback: () => void, delay: number) => () => void
  } | undefined
  const stopPolling = timer
    ? timer.interval(() => { void refresh() }, 600)
    : undefined

  // ── tree panel component (overlay) ──────────────────────────────────────
  // React is a Client Builtin available as a global (React.createElement /
  // useState / useEffect). Do NOT read it from globalThis at runtime — the
  // dynamic-verification loop proved that path yields undefined and silently
  // skips registration; reference the Builtin directly, as the shipped
  // dsh-client-ui-* plugins do.

  function TreePanel(_props: unknown) {
    const [open, setOpen] = React.useState(panelOpen)
    const [, force] = React.useState(0)

    React.useEffect(() => {
      const unsub = () => listeners.delete(force as unknown as () => void)
      listeners.add(force as unknown as () => void)
      return unsub
    }, [])

    if (!open) return null
    const s = snapshot

    const node = (label: string, status: string, childId?: string, onClick?: () => void) =>
      React.createElement('div', {
        style: { padding: '2px 8px', cursor: onClick ? 'pointer' : 'default', display: 'flex', gap: 8, alignItems: 'center' },
        onClick,
      },
        React.createElement('span', null, status),
        React.createElement('span', null, label),
        childId ? React.createElement('span', { style: { color: '#888', fontSize: 11 } }, childId) : null,
      )

    const jump = (childId: string) => {
      if (sessions) sessions.openSubagent({ parentSessionId: '', childSessionId: childId, mode: 'continuable' })
    }

    const current = s.current as { agentType?: string; childId?: string; status?: string; prompt?: string } | null
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
          ? node(`${current.agentType ?? '?'}`, statusGlyph(current.status), current.childId, () => current.childId && jump(current.childId))
          : React.createElement('div', { style: { color: '#888' } }, '○ 空闲'),
      ),

      React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `队列 (${s.queue.length})`),
        s.queue.map((w) => node(String((w as { agentType?: string }).agentType ?? '?'), '⏳')),
      ),

      React.createElement('div', { style: { marginBottom: 8 } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `求助 (${s.helpRequests.length})`),
        s.helpRequests.map((h) => node(`[${(h as { intent?: string }).intent ?? '?'}]`, '❓', (h as { childId?: string }).childId, () => (h as { childId?: string }).childId && jump((h as { childId?: string }).childId as string))),
      ),

      React.createElement('div', null,
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, `历史 (${s.history.length})`),
        s.history.slice(-8).map((r) => {
          const rec = r as { agentType?: string; childId?: string; status?: string; conclusion?: string }
          return node(`${rec.agentType ?? '?'} — ${(rec.conclusion ?? '').replace(/\s+/g, ' ').slice(0, 60)}`, statusGlyph(rec.status), rec.childId, () => rec.childId && jump(rec.childId))
        }),
      ),
    )
  }

  function statusGlyph(status: string | undefined): string {
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

  // ── register overlay panel ──────────────────────────────────────────────
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'dsh-my-go-panel' },
    (props: never) => React.createElement(TreePanel, props as unknown as Record<string, unknown> | null),
  ))

  // ── register sidebar footer action (toggle) ─────────────────────────────
  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-my-go-toggle' },
    (props: never) => React.createElement('button', {
      onClick: () => {
        panelOpen = !panelOpen
        emit()
      },
      title: 'Sisyphus 编排面板',
      style: { width: (props as { wide?: boolean } | undefined)?.wide ? '100%' : 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' },
    }, '🧭'),
  ))

  // ── settings page ───────────────────────────────────────────────────────
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'dsh-my-go', order: 30, label: 'dsh-my-go 编排' },
    (props: never) => React.createElement(SettingsPage, props as unknown as Record<string, unknown> | null),
  ))

  function SettingsPage(_props: unknown) {
    return React.createElement('div', { style: { padding: 16 } },
      React.createElement('h2', null, 'dsh-my-go 编排配置'),
      React.createElement('p', null, '每个子智能体的模型 / 思考程度 / DSV4P0813 补丁开关。修改后通过 Settings 服务持久化。'),
      React.createElement('div', { style: { color: '#888', marginTop: 12 } }, '配置项由 host 侧 settings 命名空间 dsh-my-go.agents 提供；此处为占位渲染，完整表单见 broker 设置页。'),
    )
  }

  // ── auto-jump: follow running sub-agent, jump back on settle ────────────
  let lastJumpedTo: string | null = null
  const unsub = () => {
    listeners.delete(refresh as unknown as () => void)
  }
  listeners.add(refresh as unknown as () => void)

  // Poll-driven auto-jump: when a child starts running, open it; when the
  // current slot empties, jump back to the parent (Sisyphus) if we jumped.
  const stopAutoJump = timer
    ? timer.interval(() => {
        const current = snapshot.current as { childId?: string; status?: string } | null
        if (current?.childId && current.status === 'running' && lastJumpedTo !== current.childId && sessions) {
          lastJumpedTo = current.childId
          sessions.openSubagent({ parentSessionId: '', childSessionId: current.childId, mode: 'continuable' })
        } else if (!current && lastJumpedTo && sessions) {
          // Child settled; jump back to the parent (sessionId empty = current).
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
