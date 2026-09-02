/**
 * dsh-my-go — orchestration tree panel (tisitan.15 split).
 *
 * Owns the polling/panel state machine that used to live at the top of
 * client.js: the 600ms snapshot poll, the overlay TreePanel (current /
 * queue / help / history / roster sections) and the auto-jump follow logic.
 * Everything is closed over by `createOrchestrationPanel` — no module-level
 * mutable singletons, the caller's `apply` creates exactly one instance.
 *
 * Consumes the snapshot RPC value: { seq, parents: { [id]: { parentSessionId,
 * current, queue, helpRequests, history } }, roster, rosterLines }. `roster`
 * is the structured roster (tisitan.9 A-05) the panel lays out itself;
 * `rosterLines` is its deprecated text mirror, only kept as a fallback for an
 * older host half.
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
  let snapshotLoaded = false
  // 快照桥健康度（E10/B-03 后分两型）：null=正常，'absent'=host 端 RPC 根本没
  // 应答（插件未激活/仍在启动），'internal'=host 端在、但桥函数抛了错。
  let bridgeProblem = null
  let bridgeDetail = ''
  // 轮询节流（E5/A-02）：一次 in-flight 只允许一个刷新在跑（快照体积随编排
  // 历史线性增长，慢宿主上 600ms 一轮会自我堆叠）；连续失败按
  // 600 → 1500 → 3000ms 退避，成功即复位到基准档。
  const POLL_BASE_MS = 600
  const POLL_BACKOFF_MS = [600, 1500, 3000]
  let pollInFlight = false
  let pollBackoffStep = 0
  let nextPollAt = 0
  const listeners = new Set()
  const emit = () => { for (const l of [...listeners]) { try { l() } catch { /* noop */ } } }

  // 状态迁移点各留一行痕（E5）：只在真正翻转时打，绝不每 600ms 刷屏——
  // 面板静默重连是最难查的一类故障。
  function setBridgeProblem(problem, detail) {
    if (bridgeProblem === problem && bridgeDetail === (detail ?? '')) return false
    bridgeProblem = problem
    bridgeDetail = detail ?? ''
    if (problem === null) {
      console.warn('[dsh-my-go] panel: orchestration snapshot bridge recovered')
    } else {
      console.warn(`[dsh-my-go] panel: orchestration snapshot bridge ${problem === 'internal' ? 'threw inside the host' : 'unavailable'}${bridgeDetail ? ` (${bridgeDetail})` : ''}`)
    }
    return true
  }
  function notePollFailure(problem, detail) {
    pollBackoffStep = Math.min(pollBackoffStep + 1, POLL_BACKOFF_MS.length - 1)
    nextPollAt = Date.now() + POLL_BACKOFF_MS[pollBackoffStep]
    if (setBridgeProblem(problem, detail)) emit()
  }
  function notePollSuccess() {
    pollBackoffStep = 0
    nextPollAt = 0
    if (setBridgeProblem(null, '')) emit()
  }

  async function refresh() {
    if (pollInFlight) return
    if (Date.now() < nextPollAt) return
    if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
      notePollFailure('absent', 'no rpc channel')
      return
    }
    pollInFlight = true
    try {
      const res = await connection.rpc.call('/dsh-my-go', 'snapshot', {})
      if (res && res.ok) {
        const next = res.value
        // 首帧必 emit（哪怕 seq 恰与初值同）：花名册区在 seq=0 的降级空态里
        // 也有内容，漏掉这一发会让面板停在空白上
        const firstFrame = !snapshotLoaded
        const changed = next && next.seq !== snapshot.seq
        if (next) { snapshot = next; snapshotLoaded = true }
        notePollSuccess()
        if (changed || firstFrame) emit()
      } else if (res && res.error && res.error.code === 'internal') {
        // host 端桥函数抛错（lib snapshot 端点自带 try 后的结构化失败信封）：
        // 与「桥未注册」分开提示，前者说明装配完成但状态读挂了
        notePollFailure('internal', String(res.error.message ?? ''))
      } else {
        notePollFailure('absent', res ? 'unexpected response envelope' : 'no response')
      }
    } catch (error) {
      // 调用本身抛错（通道未注册/传输层断）：提示态，按退避节奏自动重试
      notePollFailure('absent', String(error))
    } finally {
      pollInFlight = false
    }
  }

  const stopPolling = timer && typeof timer.interval === 'function'
    ? timer.interval(() => { void refresh() }, POLL_BASE_MS)
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
      // 相对时间（「3 分钟前」）需要自刷新：快照不变时不触发重渲染。
      // 刷新链只在面板可见时做功（tisitan.8 A-09）：面板关着时这枚 30s tick
      // 每轮都强制重渲染一个返回 null 的组件，纯烧电。
      const tick = setInterval(() => { if (panelOpen) force((c) => c + 1) }, 30_000)
      return () => { listeners.delete(rerender); clearInterval(tick) }
    }, [])

    if (!panelOpen) return null
    const s = snapshot
    const parents = s.parents && typeof s.parents === 'object' ? s.parents : {}
    // 面板扁平化展示所有编排会话的条目；parents 数量 >1 时每条附
    // parentSessionId 短后缀 chip 区分归属。
    // 'legacy' 是台账 v1 兼容桶（broker 载入时造出的幽灵父区）：它没有属主
    // 会话、current 恒空、点开无处可跳，出现在父区列表里只会被误认成一个
    // 真实编排会话（tisitan.8 A-04，父区直接过滤）。
    const parentList = Object.values(parents).filter((p) => p && p.parentSessionId !== 'legacy')
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

      bridgeProblem === 'internal'
        ? React.createElement('div', {
            style: { marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,152,0,0.12)', border: '1px solid rgba(255,152,0,0.35)', fontSize: 12 },
          }, `⚠ host 端编排快照读取异常（装配已完成，桥函数抛错）：${bridgeDetail || '未提供原因'}；面板停在最后一次实况，按退避节奏自动重试。`)
        : bridgeProblem === 'absent'
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
              // 求助单 id 才是这一行的身份（tisitan.8 A-08）：同一儿童可以
              // 先后挂着两张不同 intent 的求助单，按 childId 做 key 会让 React
              // 把第二张就地复用成第一张（intent 文案串台）
              key: `hlp-${h.parentSessionId}-${h.id ?? i}`,
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

      // 花名册常驻区（tisitan.15；tisitan.9 A-05 起吃结构化 roster）：渲染依据
      // 是 snapshot.roster 数组——表头文案、计数、行排版全部客户端自持。旧写法
      // 靠「rosterLines[0] 必为表头」的位置约定 slice(1) 取数、用 length-1 当
      // 计数，等于把 host 的字符串格式当 API：host 一改措辞（或哪天想加个脚注）
      // 这里就静默少一行或多渲染一行标题。rosterLines 只作旧 host 的兼容回落。
      (() => {
        const rows = Array.isArray(s.roster) ? s.roster : null
        const legacyLines = !rows && Array.isArray(s.rosterLines) && s.rosterLines.length > 1 ? s.rosterLines.slice(1) : null
        const count = rows ? rows.length : (legacyLines ? legacyLines.length : 0)
        if (!rosterOpen) {
          return React.createElement('div', {
            style: { cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 },
            onClick: () => setRosterOpen(true),
            title: '展开可派角色与绑定摘要',
          },
            React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, '▸ 花名册'),
            count > 0
              ? React.createElement('span', { style: { fontSize: 11, lineHeight: '15px', padding: '0 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#999' } }, String(count))
              : null,
          )
        }
        return React.createElement('div', { style: { marginBottom: 10 } },
          sectionHeader('花名册', count, '可派角色与绑定摘要（点击标题折叠）'),
          rows
            ? rows.map((entry) => React.createElement('div', {
              key: `ros-${entry?.role ?? ''}`,
              title: `${entry?.role ?? ''}：${entry?.modelText ?? '跟随环境'}；备选 ${Array.isArray(entry?.chain) ? entry.chain.length : 0} 条；工具 ${entry?.toolFilterText ?? ''}；人设 ${entry?.personaSource ?? ''}`,
              style: { fontFamily: MONO_FONT, fontSize: 11, color: '#a0a0a0', padding: '2px 8px', overflowWrap: 'anywhere', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
            },
              React.createElement('span', null, `${entry?.role ?? '?'}`),
              React.createElement('span', { style: { color: '#c8c8c8' } }, `· ${entry?.modelText ?? '跟随环境'}`),
              Array.isArray(entry?.chain) && entry.chain.length > 0 ? chip(`+${entry.chain.length}`, `备选链 ${entry.chain.length} 条`, ACCENT_QUEUE) : null,
              entry?.builtin === false ? chip('自定义', '自定义角色（不在内置八工种内）') : null,
            ))
            : legacyLines
              ? legacyLines.map((line, i) => React.createElement('div', {
                key: `ros-${i}`,
                title: line,
                style: { fontFamily: MONO_FONT, fontSize: 11, color: '#a0a0a0', padding: '2px 8px', overflowWrap: 'anywhere' },
              }, line))
              : React.createElement('div', { style: { color: '#888', fontSize: 12, padding: '2px 8px' } }, '花名册不可用（host 未就绪）'),
        )
      })(),
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
