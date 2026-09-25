/**
 * dsh-my-go — 泳道星图（canvas 2d + requestAnimationFrame 独立帧循环）。
 *
 * docs/design/panel-graph-demo.html 的移植件（冻结稿 v1.2）：几何坐标、粒子参数、
 * 状态→视觉映射、reduced-motion 降级逐条照稿还原。差异只在数据侧——demo 吃
 * 自带演出脚本，这里吃面板快照差分：currentRecords 按 childId 分三类触发
 * （新 id = 派工脉冲 / status 跳变 = 转场 / id 消失 = 终局回流或静默淡出）。
 *
 * 终局回流的触发源是 history 而非 currentRecords：宿主 finish() 把记录从
 * currentMap 摘除、终局只落 history（preset/shared/orchestration.mjs:220-240），
 * 所以「id 消失」时必须回查该 childId 的最近一条终局史来决定演出形态。
 *
 * 帧循环自持：React 只管挂载与投递快照，动画绝不依赖外层 600ms 全量重渲染。
 * 色板与字形锚定 src/client-constants.js:23-33（直接 import，不复制字面量）。
 */
import * as React from 'react'
import {
  AGENT_COLORS,
  MONO_FONT,
  ACCENT_RUNNING,
  ACCENT_QUEUE,
  ACCENT_HELP,
  typeLabel,
  typeName,
} from './client-constants.js'
import { shortId } from './panel-format.js'

const W = 296
const H = 300
const CENTER = { x: 148, y: 150, r: 22 }
const ORBIT_R = 105
const READ_SLOTS = [{ x: 74, y: 76 }, { x: 148, y: 45 }, { x: 222, y: 76 }]
const WRITE_SLOT = { x: 148, y: 255 }
const DOCK = [{ x: 26, y: 268 }, { x: 50, y: 268 }, { x: 74, y: 268 }]
const NODE_R = 16
const DOCK_W = 18
const DOCK_H = 15

const SPAWN_BURST = 10
const REFLOW_BURST = 12
const STREAM_GAP = 340
const HELP_GAP = 700
const FADE_DELAY = 250
const FADE_DUR = 650
const GONE_FADE_DUR = 300
const EDGE_FLASH_TTL = 2000

const UNKNOWN_COLOR = '#9e9e9e'
const HALO_COLOR = '#1e1e1e'
const ORBIT_COLOR = '#3a3a3a'
const LANE_LABEL_COLOR = '#5c5c5c'

const TERMINAL_STATUS = new Set(['done', 'failed'])

const READ_LANE_TYPES = new Set(['explore', 'librarian'])
const laneOf = (t) => (READ_LANE_TYPES.has(t) ? 'read' : 'write')
const agentColor = (t) => AGENT_COLORS[t] ?? UNKNOWN_COLOR
const glyphColor = (s) => (s === 'waiting' || s === 'failed'
  ? ACCENT_HELP
  : s === 'queued' ? ACCENT_QUEUE : s === 'done' || s === 'running' ? ACCENT_RUNNING : '#ddd')

const recordId = (rec) => {
  const id = rec ? (rec.childId ?? rec.id) : null
  return id ? String(id) : ''
}

const parentIdOf = (rec) => {
  const pid = rec ? rec.parentSessionId : null
  return typeof pid === 'string' && pid ? pid : ''
}

const recordTime = (rec) => {
  const t = Number(rec ? (rec.updatedAt ?? rec.createdAt ?? 0) : 0)
  return Number.isFinite(t) ? t : 0
}

export function endedByChild(histories) {
  const out = new Map()
  for (const rec of Array.isArray(histories) ? histories : []) {
    const id = recordId(rec)
    if (!id || !TERMINAL_STATUS.has(rec && rec.status)) continue
    const t = recordTime(rec)
    const prev = out.get(id)
    if (!prev || t >= prev.t) out.set(id, { status: rec.status, t })
  }
  return out
}

function buildLabels(nodes) {
  const groups = new Map()
  for (const n of nodes.values()) {
    const t = n.rec.agentType
    const list = groups.get(t)
    if (list) list.push(n)
    else groups.set(t, [n])
  }
  const labels = new Map()
  for (const [t, list] of groups) {
    if (list.length === 1) { labels.set(list[0].rec.id, typeName(t)); continue }
    list.sort((a, b) => (a.rec.createdAt ?? 0) - (b.rec.createdAt ?? 0))
    list.forEach((n, i) => labels.set(n.rec.id, `${typeName(t)}#${i + 1}`))
  }
  return labels
}

const mainViewHeld = (row) => {
  const n = row && row.retainedBy ? row.retainedBy.mainView : undefined
  return typeof n === 'number' ? n > 0 : n === true
}

export function readCurrentSessionId(sessions) {
  try {
    const list = sessions && sessions.list
    if (list && typeof list.getSnapshot === 'function') {
      const snap = list.getSnapshot()
      if (snap) {
        const current = snap.current
        if (typeof current === 'string' && current) return current
        const byId = snap.byId
        if (byId && typeof byId === 'object') {
          const ids = Array.isArray(snap.ids) ? snap.ids : []
          for (const id of ids) {
            if (typeof id === 'string' && id && mainViewHeld(byId[id])) return id
          }
          for (const id of Object.keys(byId)) {
            if (mainViewHeld(byId[id])) return id
          }
        }
      }
    }
  } catch { /* store shape drift: degrade to single-bucket */ }
  return undefined
}

function mostActiveParent(items, order) {
  const latest = new Map()
  for (const r of items) {
    const pid = parentIdOf(r)
    if (!pid) continue
    const t = recordTime(r)
    if (t > (latest.get(pid) ?? -Infinity)) latest.set(pid, t)
  }
  let best = order[0]
  let bestTs = -Infinity
  for (const pid of order) {
    const t = latest.get(pid) ?? -Infinity
    if (t > bestTs) { bestTs = t; best = pid }
  }
  return best
}

export function pickBucket(records, queue, histories, currentParentId) {
  const recs = Array.isArray(records) ? records : []
  const que = Array.isArray(queue) ? queue : []
  const his = Array.isArray(histories) ? histories : []
  const all = recs.concat(que, his)
  const order = []
  for (const r of all) {
    const pid = parentIdOf(r)
    if (pid && order.indexOf(pid) < 0) order.push(pid)
  }
  const parentCount = order.length
  const ofParent = (list, pid) => list.filter((r) => parentIdOf(r) === pid)
  if (currentParentId !== undefined) {
    return {
      records: ofParent(recs, currentParentId),
      queue: ofParent(que, currentParentId),
      histories: ofParent(his, currentParentId),
      parentSessionId: currentParentId,
      parentCount,
    }
  }
  if (parentCount <= 1) {
    return { records: recs, queue: que, histories: his, parentSessionId: order[0], parentCount }
  }
  const pick = mostActiveParent(all, order)
  return {
    records: ofParent(recs, pick),
    queue: ofParent(que, pick),
    histories: ofParent(his, pick),
    parentSessionId: pick,
    parentCount,
  }
}

export function toCanvasPoint(rect, clientX, clientY) {
  const width = rect && Number.isFinite(rect.width) ? rect.width : 0
  const k = width > 0 ? W / width : 1
  const left = rect && Number.isFinite(rect.left) ? rect.left : 0
  const top = rect && Number.isFinite(rect.top) ? rect.top : 0
  return { x: (clientX - left) * k, y: (clientY - top) * k }
}

export function emptyGraphHint(scope) {
  if (!scope || scope.records.length > 0 || scope.queue.length > 0) return null
  const suffix = scope.parentCount > 1 && scope.parentSessionId
    ? `（本图仅 ·${String(scope.parentSessionId).slice(-6)} 桶）`
    : ''
  return `当前会话无在飞子代${suffix}`
}

const nowMs = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
  ? performance.now() : Date.now())

const hasRaf = typeof requestAnimationFrame === 'function'

export function createGraphEngine(canvas) {
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  canvas.width = W * dpr
  canvas.height = H * dpr

  const nodes = new Map()
  const particles = []
  const edgeFlash = new Map()
  const readSlots = [null, null, null]
  let writeSlotUsed = null
  let queueView = []
  let centerFlashT = -1e9
  let centerFlashColor = ACCENT_RUNNING
  let rafId = null
  let destroyed = false
  let reduceQuery = null

  const t0 = nowMs()
  const T = () => nowMs() - t0

  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    }
  } catch { reduceQuery = null }

  const staticMode = () => !!(reduceQuery && reduceQuery.matches)

  function addParticle(fx, fy, tx, ty, color, delay, dur, size) {
    particles.push({ fx, fy, tx, ty, color, t0: T() + delay, dur, size: size ?? 1.8 })
  }
  function burst(from, to, color, n, spreadDelay, dur) {
    for (let i = 0; i < n; i++) addParticle(from.x, from.y, to.x, to.y, color, rnd() * spreadDelay, dur + rnd() * 120, 1.5 + rnd())
  }

  function allocSlot(id, agentType) {
    if (laneOf(agentType) === 'read') {
      for (let i = 0; i < READ_SLOTS.length; i++) {
        if (!readSlots[i]) { readSlots[i] = id; return READ_SLOTS[i] }
      }
      return READ_SLOTS[0]
    }
    writeSlotUsed = id
    return WRITE_SLOT
  }
  function freeSlot(n) {
    const i = readSlots.indexOf(n.rec.id)
    if (i >= 0) readSlots[i] = null
    if (writeSlotUsed === n.rec.id) writeSlotUsed = null
  }

  function collect(now) {
    for (const n of [...nodes.values()]) {
      if (n.fade && now > n.fade.t0 + n.fade.dur) { freeSlot(n); nodes.delete(n.rec.id) }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      if ((now - p.t0) / p.dur >= 1) particles.splice(i, 1)
    }
    for (const [id, t] of [...edgeFlash]) {
      if (!nodes.has(id) || now - t > EDGE_FLASH_TTL) edgeFlash.delete(id)
    }
  }

  function spawnNode(rec, id, now) {
    const pos = allocSlot(id, rec.agentType)
    const n = {
      rec: { id, agentType: rec.agentType, status: rec.status, createdAt: rec.createdAt ?? 0 },
      pos,
      born: now,
      fade: null,
      lastStream: now + rnd() * STREAM_GAP,
      lastHelp: now,
    }
    nodes.set(id, n)
    edgeFlash.set(id, now)
    burst(CENTER, pos, agentColor(rec.agentType), SPAWN_BURST, 300, 600)
    return n
  }

  function transition(n, to, now) {
    const color = agentColor(n.rec.agentType)
    if (TERMINAL_STATUS.has(to)) {
      burst(n.pos, CENTER, to === 'done' ? ACCENT_RUNNING : ACCENT_HELP, REFLOW_BURST, 450, 550)
      centerFlashT = now + 250
      centerFlashColor = to === 'done' ? ACCENT_RUNNING : ACCENT_HELP
      n.fade = { t0: now + FADE_DELAY, dur: FADE_DUR }
    } else if (to === 'waiting') {
      edgeFlash.set(n.rec.id, now)
    } else if (to === 'running') {
      burst(CENTER, n.pos, color, 4, 200, 500)
    }
    n.rec.status = to
  }

  function applySnapshot(records, queue, histories) {
    if (destroyed) return
    const now = T()
    collect(now)
    const ended = endedByChild(histories)
    const seen = new Set()
    for (const rec of Array.isArray(records) ? records : []) {
      const id = recordId(rec)
      if (!id) continue
      seen.add(id)
      const n = nodes.get(id)
      if (!n) { spawnNode(rec, id, now); continue }
      if (n.fade) n.fade = null
      if (n.rec.status !== rec.status) transition(n, rec.status, now)
    }
    for (const [id, n] of [...nodes]) {
      if (seen.has(id) || n.fade) continue
      const end = ended.get(id)
      if (end) transition(n, end.status, now)
      else n.fade = { t0: now, dur: GONE_FADE_DUR }
    }
    queueView = (Array.isArray(queue) ? queue : []).slice(0, 3)
    if (staticMode()) render(now, true)
  }

  function drawGlyph(status, cx, cy, color, t) {
    ctx.save()
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.8
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    switch (status) {
      case 'running': ctx.beginPath(); ctx.arc(cx, cy, 4.2, 0, 7); ctx.fill(); break
      case 'spawning': {
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.stroke()
        const a = (t / 500) % (Math.PI * 2)
        ctx.beginPath(); ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, 4.4, a, a + Math.PI); ctx.closePath(); ctx.fill()
        break
      }
      case 'queued': {
        ctx.beginPath(); ctx.moveTo(cx - 4, cy - 5); ctx.lineTo(cx + 4, cy - 5)
        ctx.lineTo(cx - 4, cy + 5); ctx.lineTo(cx + 4, cy + 5); ctx.closePath(); ctx.stroke()
        break
      }
      case 'waiting': {
        ctx.beginPath()
        ctx.moveTo(cx - 2.3, cy - 1.3)
        ctx.lineTo(cx - 0.9, cy - 3.9)
        ctx.lineTo(cx + 1.9, cy - 2.3)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx + 1.9, cy - 2.3)
        ctx.lineTo(cx + 0.1, cy + 0.4)
        ctx.stroke()
        ctx.beginPath(); ctx.arc(cx + 0.1, cy + 3.6, 1.1, 0, 7); ctx.fill()
        break
      }
      case 'done': ctx.beginPath(); ctx.moveTo(cx - 4.5, cy); ctx.lineTo(cx - 1.5, cy + 3.5); ctx.lineTo(cx + 4.5, cy - 3.5); ctx.stroke(); break
      case 'failed': ctx.beginPath(); ctx.moveTo(cx - 3.5, cy - 3.5); ctx.lineTo(cx + 3.5, cy + 3.5)
        ctx.moveTo(cx + 3.5, cy - 3.5); ctx.lineTo(cx - 3.5, cy + 3.5); ctx.stroke(); break
      default: ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.stroke()
    }
    ctx.restore()
  }

  function haloText(text, x, y, font, color) {
    ctx.save()
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 3; ctx.strokeStyle = HALO_COLOR; ctx.strokeText(text, x, y)
    ctx.fillStyle = color; ctx.fillText(text, x, y)
    ctx.restore()
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function render(now, isStatic) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    ctx.save()
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = ORBIT_COLOR
    ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, ORBIT_R, Math.PI * 1.14, Math.PI * 1.86); ctx.stroke()
    ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, ORBIT_R, Math.PI * 0.14, Math.PI * 0.86); ctx.stroke()
    ctx.restore()
    haloText('读泳道 · ≤3 并行', 44, 12, `9px ${MONO_FONT}`, LANE_LABEL_COLOR)
    haloText('写泳道 · 单线', 248, 292, `9px ${MONO_FONT}`, LANE_LABEL_COLOR)
    haloText('队列', 26, 250, `9px ${MONO_FONT}`, LANE_LABEL_COLOR)

    for (const n of nodes.values()) {
      const { x, y } = n.pos
      const waiting = n.rec.status === 'waiting'
      const agent = agentColor(n.rec.agentType)
      let alpha = 0.30
      const ef = edgeFlash.get(n.rec.id)
      if (ef !== undefined) alpha += 0.55 * Math.exp(-(now - ef) / 320)
      let width = 1.2
      if (!isStatic && n.rec.status === 'running') width = 1.2 + 0.4 * Math.sin(now / 700 + n.born)
      if (waiting && !isStatic) alpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(now / 200))
      let fadeA = 1
      if (n.fade) fadeA = Math.max(0, 1 - (now - n.fade.t0) / n.fade.dur)
      const dx = x - CENTER.x, dy = y - CENTER.y, len = Math.hypot(dx, dy)
      const sx = CENTER.x + dx / len * (CENTER.r + 2), sy = CENTER.y + dy / len * (CENTER.r + 2)
      const ex = x - dx / len * (NODE_R + 2), ey = y - dy / len * (NODE_R + 2)
      ctx.save()
      ctx.globalAlpha = Math.min(1, alpha) * fadeA
      ctx.strokeStyle = waiting ? ACCENT_HELP : agent
      ctx.lineWidth = width
      ctx.shadowColor = waiting ? ACCENT_HELP : agent
      ctx.shadowBlur = 8
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      ctx.restore()
    }

    if (!isStatic) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        const k = (now - p.t0) / p.dur
        if (k < 0) continue
        if (k >= 1) { particles.splice(i, 1); continue }
        for (let g = 0; g < 3; g++) {
          const kk = k - g * 0.07; if (kk < 0) continue
          ctx.globalAlpha = Math.sin(Math.PI * kk) * [0.9, 0.4, 0.15][g]
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.fx + (p.tx - p.fx) * kk, p.fy + (p.ty - p.fy) * kk, p.size * (1 - g * 0.25), 0, 7)
          ctx.fill()
        }
      }
      ctx.restore()
    }

    const labels = buildLabels(nodes)
    for (const n of nodes.values()) {
      const { x, y } = n.pos
      const agent = agentColor(n.rec.agentType)
      let scale = 1, alpha = 1
      const sp = Math.min(1, (now - n.born) / 400)
      if (sp < 1) { const c1 = 1.70158, c3 = c1 + 1; scale = 1 + c3 * Math.pow(sp - 1, 3) + c1 * Math.pow(sp - 1, 2) }
      if (isStatic) scale = 1
      if (n.fade) {
        const k = Math.min(1, Math.max(0, (now - n.fade.t0) / n.fade.dur))
        alpha = 1 - k
        scale *= 1 - 0.4 * k
      }
      const waiting = n.rec.status === 'waiting'
      const running = n.rec.status === 'running'
      ctx.save()
      ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha
      let glow = 6
      if (!isStatic && running) glow = 9 + 5 * Math.sin((now / 1400) * Math.PI * 2 + n.born)
      if (waiting) glow = 12
      ctx.shadowColor = waiting ? ACCENT_HELP : agent; ctx.shadowBlur = glow
      ctx.beginPath(); ctx.arc(0, 0, NODE_R, 0, 7)
      ctx.fillStyle = agent + '2e'; ctx.fill()
      ctx.lineWidth = 1.6; ctx.strokeStyle = waiting ? ACCENT_HELP : agent; ctx.stroke()
      ctx.shadowBlur = 0
      if (waiting) {
        const ra = isStatic ? 0.8 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(now / 160))
        ctx.globalAlpha = alpha * ra
        ctx.strokeStyle = ACCENT_HELP; ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.arc(0, 0, NODE_R + 4.5, 0, 7); ctx.stroke()
        ctx.globalAlpha = alpha
      }
      drawGlyph(n.rec.status, 0, 0, glyphColor(n.rec.status), isStatic ? 0 : now)
      ctx.restore()
      haloText(labels.get(n.rec.id) ?? typeName(n.rec.agentType), x, y + NODE_R + 11, `9.5px ${MONO_FONT}`, `rgba(200,200,200,${alpha})`)
    }

    queueView.forEach((q, i) => {
      const d = DOCK[i]; if (!d) return
      const c = agentColor(q && q.agentType)
      ctx.save()
      ctx.globalAlpha = isStatic ? 0.85 : 0.65 + 0.2 * Math.sin(now / 500 + i)
      ctx.fillStyle = c + '22'; ctx.strokeStyle = c; ctx.lineWidth = 1
      roundRectPath(d.x - DOCK_W / 2, d.y - 8, DOCK_W, DOCK_H, 3)
      ctx.fill(); ctx.stroke()
      drawGlyph('queued', d.x, d.y - 0.5, ACCENT_QUEUE, now)
      ctx.restore()
    })

    const flashK = Math.min(1, Math.max(0, (now - centerFlashT) / 500))
    ctx.save()
    const breathe = isStatic ? 0 : Math.sin((now / 2400) * Math.PI * 2)
    ctx.shadowColor = AGENT_COLORS.sisyphus; ctx.shadowBlur = 12 + 4 * breathe + flashK * 18
    ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, CENTER.r, 0, 7)
    ctx.fillStyle = `rgba(100,181,246,${0.16 + 0.25 * flashK})`; ctx.fill()
    ctx.lineWidth = 1.8; ctx.strokeStyle = AGENT_COLORS.sisyphus; ctx.stroke()
    ctx.shadowBlur = 0
    ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, 6.5, 0, 7); ctx.fillStyle = AGENT_COLORS.sisyphus; ctx.fill()
    ctx.restore()
    if (flashK > 0 && !isStatic) {
      ctx.save()
      ctx.globalAlpha = 0.75 * (1 - flashK)
      ctx.strokeStyle = centerFlashColor; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(CENTER.x, CENTER.y, CENTER.r + 4 + flashK * 20, 0, 7); ctx.stroke()
      ctx.restore()
    }
    haloText('Sisyphus', CENTER.x, CENTER.y + CENTER.r + 11, `10px ${MONO_FONT}`, '#9ec9ef')
  }

  function frame() {
    if (destroyed) return
    const now = T()
    collect(now)
    for (const n of nodes.values()) {
      if (n.fade) continue
      if (n.rec.status === 'running' && now - n.lastStream > STREAM_GAP) {
        n.lastStream = now
        addParticle(CENTER.x, CENTER.y, n.pos.x, n.pos.y, agentColor(n.rec.agentType), 0, 900, 1.6)
      }
      if (n.rec.status === 'waiting' && now - n.lastHelp > HELP_GAP) {
        n.lastHelp = now
        addParticle(n.pos.x, n.pos.y, CENTER.x, CENTER.y, ACCENT_HELP, 0, 700, 2)
      }
    }
    render(now, false)
    rafId = hasRaf && !staticMode() ? requestAnimationFrame(frame) : null
  }

  function onMotionPreferenceChange() {
    if (destroyed) return
    if (staticMode()) {
      if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      rafId = null
      const now = T()
      collect(now)
      render(now, true)
      return
    }
    if (hasRaf && rafId == null) rafId = requestAnimationFrame(frame)
  }

  if (reduceQuery) {
    if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', onMotionPreferenceChange)
    else if (typeof reduceQuery.addListener === 'function') reduceQuery.addListener(onMotionPreferenceChange)
  }

  function start() {
    if (destroyed) return
    if (!hasRaf || staticMode()) {
      const now = T()
      collect(now)
      render(now, true)
      return
    }
    if (rafId != null) return
    rafId = requestAnimationFrame(frame)
  }

  function destroy() {
    destroyed = true
    if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
    rafId = null
    if (reduceQuery) {
      if (typeof reduceQuery.removeEventListener === 'function') reduceQuery.removeEventListener('change', onMotionPreferenceChange)
      else if (typeof reduceQuery.removeListener === 'function') reduceQuery.removeListener(onMotionPreferenceChange)
    }
    nodes.clear()
    particles.length = 0
    edgeFlash.clear()
  }

  function hitTest(cssX, cssY) {
    let best = null
    let bestD = NODE_R + 6
    for (const n of nodes.values()) {
      if (n.fade) continue
      const d = Math.hypot(cssX - n.pos.x, cssY - n.pos.y)
      if (d < bestD) { bestD = d; best = n }
    }
    return best
  }

  const stats = () => ({ nodes: nodes.size, particles: particles.length, flashes: edgeFlash.size, running: rafId != null })

  return { applySnapshot, start, destroy, hitTest, stats }
}

function GraphCanvas({ records, queue, histories }) {
  const canvasRef = React.useRef(null)
  const engineRef = React.useRef(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const engine = createGraphEngine(canvas)
    engineRef.current = engine
    engine.start()
    return () => {
      engineRef.current = null
      engine.destroy()
    }
  }, [])

  React.useEffect(() => {
    const engine = engineRef.current
    if (engine) engine.applySnapshot(records, queue, histories)
  }, [records, queue, histories])

  const onMove = (e) => {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas) return
    const p = toCanvasPoint(canvas.getBoundingClientRect(), e.clientX, e.clientY)
    const n = engine.hitTest(p.x, p.y)
    canvas.title = n ? `${typeLabel(n.rec.agentType)}\n${shortId(n.rec.id)}` : ''
  }
  const onLeave = () => {
    const canvas = canvasRef.current
    if (canvas) canvas.title = ''
  }

  return React.createElement('canvas', {
    ref: canvasRef,
    onMouseMove: onMove,
    onMouseLeave: onLeave,
    style: { display: 'block', width: W, height: 'auto', maxWidth: '100%' },
  })
}

export function GraphSection({ records, queue, histories, sessions }) {
  const [open, setOpen] = React.useState(true)
  const scope = pickBucket(records, queue, histories, readCurrentSessionId(sessions))
  const waiting = scope.records.filter((r) => r && r.status === 'waiting').length
  const ownerChip = scope.parentCount > 1 && scope.parentSessionId
    ? React.createElement('span', {
        title: scope.parentSessionId,
        style: {
          flexShrink: 0,
          maxWidth: 60,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: MONO_FONT,
          fontSize: 10,
          lineHeight: '15px',
          padding: '0 5px',
          borderRadius: 4,
          color: '#9e9e9e',
          background: 'rgba(255,255,255,0.07)',
        },
      }, `·${String(scope.parentSessionId).slice(-6)}`)
    : null

  const hint = emptyGraphHint(scope)

  return React.createElement('div', { style: { marginBottom: 10 } },
    React.createElement('div', {
      style: { cursor: 'pointer', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
      onClick: () => setOpen((v) => !v),
      title: open
        ? '收起星图'
        : '展开泳道星图（Sisyphus 子代实时动画；展开时按当前子代重放一次派工脉冲）',
    },
      React.createElement('span', { style: { fontWeight: 600, fontSize: 12 } }, `${open ? '▾' : '▸'} 星图`),
      React.createElement('span', {
        style: { fontSize: 11, lineHeight: '15px', padding: '0 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#999' },
      }, String(scope.records.length)),
      ownerChip,
      waiting > 0
        ? React.createElement('span', { style: { fontSize: 11, color: ACCENT_HELP } }, `${waiting} 求助`)
        : null,
      scope.queue.length > 0
        ? React.createElement('span', { style: { fontSize: 11, color: ACCENT_QUEUE } }, `队列 ${scope.queue.length}`)
        : null,
      hint
        ? React.createElement('span', { style: { fontSize: 11, color: '#777' } }, hint)
        : null,
    ),
    open ? React.createElement(GraphCanvas, { records: scope.records, queue: scope.queue, histories: scope.histories }) : null,
  )
}
