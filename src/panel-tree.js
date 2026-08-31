/**
 * dsh-my-go — orchestration tree panel (tisitan.15 split).
 *
 * Owns the polling/panel state machine that used to live at the top of
 * client.js: the 600ms snapshot poll, the overlay TreePanel (current /
 * queue / help / history / roster sections) and the auto-jump follow logic.
 * Everything is closed over by `createOrchestrationPanel` — no module-level
 * mutable singletons, the caller's `apply` creates exactly one instance.
 *
 * Consumes the snapshot RPC value verbatim: { seq, parents: { [id]:
 * { parentSessionId, current, queue, helpRequests, history } }, rosterLines }.
 */

import * as React from 'react'
import { shortId, oneLine, formatRelativeTime, extractFallbackNote } from './panel-format.js'
import {
  AGENT_LABELS,
  AGENT_COLORS,
  MONO_FONT,
  ACCENT_RUNNING,
  ACCENT_QUEUE,
  ACCENT_HELP,
  ACCENT_FALLBACK,
  intentLabel,
  typeLabel,
  typeName,
} from './client-constants.js'

export function createOrchestrationPanel({ slots, connection, sessions, timer }) {
  // ── shared state ────────────────────────────────────────────────────────
  let panelOpen = false
  // 多会话聚合形状：{ seq, parents: { [parentSessionId]: { parentSessionId,
  // current, queue, helpRequests, history } } }
  let snapshot = { seq: 0, parents: {} }
  // null=尚未探活, true=编排桥就绪, false=未就绪（面板显示提示态而非静默空白）
  let bridgeOk = null
  const listeners = new Set()
  const emit = () => { for (const l of [...listeners]) { try { l() } catch { /* noop */ } } }

  async function refresh() {
    if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
      if (bridgeOk !== false) { bridgeOk = false; emit() }
      return
    }
    try {
      const res = await connection.rpc.call('/dsh-my-go', 'snapshot', {})
      if (res && res.ok) {
        const wasOk = bridgeOk
        bridgeOk = true
        const next = res.value
        const changed = next && next.seq !== snapshot.seq
        if (next) snapshot = next
        if (changed || wasOk !== true) emit()
      } else if (bridgeOk !== false) {
        bridgeOk = false
        emit()
      }
    } catch {
      // host 未就绪（插件未激活/仍在启动/ RPC 未注册）：标记提示态，
      // 仅状态迁移时 emit，避免 600ms 轮询每次重渲染
      if (bridgeOk !== false) { bridgeOk = false; emit() }
    }
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
    const [rosterOpen, setRosterOpen] = React.useState(false)

    React.useEffect(() => {
      const rerender = () => force((c) => c + 1)
      listeners.add(rerender)
      // 相对时间（「3 分钟前」）需要自刷新：快照不变时不触发重渲染
      const tick = setInterval(() => force((c) => c + 1), 30_000)
      return () => { listeners.delete(rerender); clearInterval(tick) }
    }, [])

    if (!panelOpen) return null
    const s = snapshot
    // 面板扁平化展示所有编排会话的条目；parents 数量 >1 时每条附
    // parentSessionId 短后缀 chip 区分归属
    const parents = s.parents && typeof s.parents === 'object' ? s.parents : {}
    const parentList = Object.values(parents)
    const multi = parentList.length > 1

    // 统一徽章（chip）：标识符一律等宽小字、浅底圆角；title 悬浮给全量值
    const chip = (text, full, color) => React.createElement('span', {
      title: full ?? text,
      style: {
        flexShrink: 0,
        maxWidth: 110,
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

    // 工种彩色徽章：每工种固定色，悬浮 title 给完整中文名
    const typeChip = (t) => React.createElement('span', {
      title: typeLabel(t),
      style: {
        flexShrink: 0,
        fontFamily: MONO_FONT,
        fontSize: 10,
        lineHeight: '15px',
        padding: '0 5px',
        borderRadius: 4,
        fontWeight: 600,
        color: AGENT_COLORS[t] ?? '#9e9e9e',
        background: `${AGENT_COLORS[t] ?? '#9e9e9e'}22`,
      },
    }, typeName(t))

    const suffixChip = (pid) => (multi ? chip(`·${String(pid ?? '').slice(-6)}`, String(pid ?? '')) : null)

    // 统一行：左侧 2px 状态色条 + 状态字形 + 内容 cells，间距/行高全面板一致
    const row = (opts, ...cells) => React.createElement('div', {
      key: opts.key,
      onClick: opts.onClick,
      title: opts.title,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        padding: '3px 6px 3px 8px',
        marginBottom: 2,
        borderRadius: 4,
        borderLeft: `2px solid ${opts.accent ?? 'transparent'}`,
        cursor: opts.onClick ? 'pointer' : 'default',
      },
    },
      React.createElement('span', { style: { flexShrink: 0, width: 14, textAlign: 'center', color: opts.glyphColor } }, opts.glyph),
      ...cells,
    )

    // 单行省略号的收尾文本（结论等长内容），完整文本走 title
    const tail = (text, title) => React.createElement('span', {
      title,
      style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#a0a0a0', fontSize: 12 },
    }, text)

    const jump = (childId, parentSessionId) => {
      if (sessions && typeof sessions.openSubagent === 'function') {
        sessions.openSubagent({ parentSessionId: parentSessionId ?? '', childSessionId: childId, mode: 'continuable' })
      }
    }

    const currents = parentList.filter((p) => p && p.current)
    const queues = parentList.flatMap((p) => (Array.isArray(p?.queue) ? p.queue.map((w) => ({ ...w, parentSessionId: p.parentSessionId })) : []))
    const helps = parentList.flatMap((p) => (Array.isArray(p?.helpRequests) ? p.helpRequests.map((h) => ({ ...h, parentSessionId: p.parentSessionId })) : []))
    const histories = parentList
      .flatMap((p) => (Array.isArray(p?.history) ? p.history.map((r) => ({ ...r, parentSessionId: p.parentSessionId })) : []))
      .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))

    // 区块标题 + 计数徽章
    const sectionHeader = (title, count, hint) => React.createElement('div', { title: hint, style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
      React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, title),
      React.createElement('span', { style: { fontSize: 11, lineHeight: '15px', padding: '0 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#999' } }, String(count)),
    )

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
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
        React.createElement('strong', null, 'Sisyphus 编排'),
        React.createElement('button', { onClick: () => { panelOpen = false; emit() } }, '×'),
      ),

      bridgeOk === false
        ? React.createElement('div', {
            style: { marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', fontSize: 12 },
          }, '⚠ 编排桥未就绪：host 端 /dsh-my-go RPC 无响应（插件未激活或仍在启动），面板将持续自动重试。')
        : null,

      // 运行中：保留区块（空时显示「空闲」，用户习惯看它），等待求助的条目用红色
      React.createElement('div', { style: { marginBottom: 10 } },
        sectionHeader('运行中', currents.length),
        currents.length > 0
          ? currents.map((p) => {
              const c = p.current
              const waiting = c.status === 'waiting'
              return row({
                key: `cur-${p.parentSessionId}-${c.childId ?? ''}`,
                glyph: statusGlyph(c.status),
                glyphColor: waiting ? ACCENT_HELP : ACCENT_RUNNING,
                accent: waiting ? ACCENT_HELP : ACCENT_RUNNING,
                onClick: c.childId ? () => jump(c.childId, p.parentSessionId) : undefined,
                title: c.childId ? `${typeLabel(c.agentType)}\n${c.childId}` : typeLabel(c.agentType),
              },
                typeChip(c.agentType),
                suffixChip(p.parentSessionId),
                c.childId ? chip(shortId(c.childId), c.childId) : null,
              )
            })
          : React.createElement('div', { style: { color: '#888', fontSize: 12, padding: '2px 8px' } }, '○ 空闲'),
      ),

      // 队列 / 求助：空时整区折叠隐藏（比显示「无」更干净）
      queues.length > 0
        ? React.createElement('div', { style: { marginBottom: 10 } },
            sectionHeader('队列', queues.length),
            queues.map((w, i) => row({
              key: `q-${w.parentSessionId}-${w.id ?? i}`,
              glyph: '⏳',
              accent: ACCENT_QUEUE,
              title: String(w.id ?? ''),
            },
              typeChip(w.agentType),
              suffixChip(w.parentSessionId),
              chip(shortId(w.id), w.id),
            )),
          )
        : null,

      helps.length > 0
        ? React.createElement('div', { style: { marginBottom: 10 } },
            sectionHeader('求助', helps.length),
            helps.map((h, i) => row({
              key: `hlp-${h.parentSessionId}-${h.childId ?? i}`,
              glyph: '❓',
              accent: ACCENT_HELP,
              onClick: h.childId ? () => jump(h.childId, h.parentSessionId) : undefined,
              title: h.childId ? `${intentLabel(h.intent)}\n${h.childId}` : intentLabel(h.intent),
            },
              React.createElement('span', { style: { flexShrink: 0 } }, intentLabel(h.intent)),
              suffixChip(h.parentSessionId),
              h.childId ? chip(shortId(h.childId), h.childId) : null,
            )),
          )
        : null,

      // 历史：工种彩色徽章 + [备选 n/m] 紫色徽章 + 结论单行省略 + 相对时间
      histories.length > 0
        ? React.createElement('div', null,
            sectionHeader('历史', Math.min(8, histories.length), '仅显示最近 8 条结论'),
            histories.slice(-8).map((r, i) => {
              const { note, text } = extractFallbackNote(r.conclusion)
              const rel = formatRelativeTime(r.updatedAt)
              const ts = Number(r.updatedAt)
              const abs = Number.isFinite(ts) && ts > 0 ? new Date(ts).toLocaleString() : null
              const title = [typeLabel(r.agentType), abs, oneLine(r.conclusion)].filter(Boolean).join('\n')
              return row({
                key: `his-${r.parentSessionId}-${r.childId ?? i}`,
                glyph: statusGlyph(r.status),
                onClick: r.childId ? () => jump(r.childId, r.parentSessionId) : undefined,
                title,
              },
                typeChip(r.agentType),
                suffixChip(r.parentSessionId),
                note ? chip(note, `${note}（备选链自动重派）`, ACCENT_FALLBACK) : null,
                tail(text, title),
                rel ? React.createElement('span', { style: { flexShrink: 0, color: '#777', fontSize: 11 } }, rel) : null,
              )
            }),
          )
        : null,

      // 花名册常驻区（tisitan.15）：snapshot 响应附带的 rosterLines（与
      // orchestration_status roles 区同源，由 host 半 renderRosterLines 产出），
      // 与编排状态无关——桥未就绪/无编排会话也能显示。默认折叠。
      rosterOpen
        ? React.createElement('div', { style: { marginBottom: 10 } },
            sectionHeader('花名册', Array.isArray(s.rosterLines) ? s.rosterLines.length - 1 : 0, '可派角色与绑定摘要（点击标题折叠）'),
            Array.isArray(s.rosterLines) && s.rosterLines.length > 1
              ? s.rosterLines.slice(1).map((line, i) => React.createElement('div', {
                  key: `ros-${i}`,
                  title: line,
                  style: { fontFamily: MONO_FONT, fontSize: 11, color: '#a0a0a0', padding: '2px 8px', overflowWrap: 'anywhere' },
                }, line))
              : React.createElement('div', { style: { color: '#888', fontSize: 12, padding: '2px 8px' } }, '花名册不可用（host 未就绪）'),
          )
        : React.createElement('div', {
            style: { cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 },
            onClick: () => setRosterOpen(true),
            title: '展开可派角色与绑定摘要',
          },
            React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, '▸ 花名册'),
            Array.isArray(s.rosterLines) ? React.createElement('span', { style: { fontSize: 11, lineHeight: '15px', padding: '0 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#999' } }, String(s.rosterLines.length - 1)) : null,
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

  // ── auto-jump: follow running sub-agent, jump back on settle ────────────
  // 门禁：只有 running 条目的 parentSessionId === 当前打开的会话时才跳——
  // 多会话并行时绝不把用户从别的会话拽走。当前会话 id 读法：
  // sessions.list（SnapshotStore<SessionListState>）的 getSnapshot().current
  // （dsh-client-runtime types/client/sessions/service.d.ts:158,72）。
  // 拿不到可靠 id 时退化：仅当恰好只有一个 parent 有 running current 才跳
  // （保持单会话老行为）。跳回父会话同理加门禁。
  let lastJumped = null // { childId, parentSessionId } | null
  const currentSessionId = () => {
    try {
      const list = sessions?.list
      if (list && typeof list.getSnapshot === 'function') {
        const current = list.getSnapshot()?.current
        if (typeof current === 'string' && current) return current
      }
    } catch { /* store shape drift: fall through to degraded mode */ }
    return undefined
  }
  const unsub = () => { listeners.delete(refresh) }
  listeners.add(refresh)

  const stopAutoJump = timer && typeof timer.interval === 'function'
    ? timer.interval(() => {
        if (!sessions) return
        const parents = snapshot.parents && typeof snapshot.parents === 'object' ? snapshot.parents : {}
        const running = Object.values(parents).filter((p) => p?.current?.childId && p.current.status === 'running')
        const myId = currentSessionId()
        if (lastJumped) {
          const owner = parents[lastJumped.parentSessionId]
          const stillRunning = owner?.current?.childId === lastJumped.childId && owner.current.status === 'running'
          if (stillRunning) return
          // 子智能体结束：跳回 Sisyphus 父会话（ARCHITECTURE.md §3 的闭环）。
          // 门禁通过条件：当前停在父会话，或停在刚刚跟随的那个子会话上；
          // 拿不到当前会话 id 时退化为仅单 parent 场景跳回（单会话老行为）。
          const { childId, parentSessionId: pid } = lastJumped
          lastJumped = null
          const gated = myId !== undefined ? (myId === pid || myId === childId) : Object.keys(parents).length <= 1
          if (gated && pid && typeof sessions.open === 'function') {
            try { sessions.open(pid) } catch { /* parent session may be gone */ }
          }
          return
        }
        if (running.length === 0) return
        let target
        if (myId !== undefined) {
          target = running.find((p) => p.parentSessionId === myId)
        } else if (running.length === 1) {
          target = running[0]
        }
        if (!target) return
        lastJumped = { childId: target.current.childId, parentSessionId: target.parentSessionId }
        try {
          sessions.openSubagent({
            parentSessionId: target.parentSessionId,
            childSessionId: target.current.childId,
            mode: 'continuable',
          })
        } catch { /* fallback: just open the child session directly */ }
      }, 800)
    : undefined

  // ── cleanup ─────────────────────────────────────────────────────────────
  return () => {
    if (stopPolling) stopPolling()
    if (stopAutoJump) stopAutoJump()
    unsub()
  }
}
