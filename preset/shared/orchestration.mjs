/**
 * dsh-my-go — single-line-blocking orchestration state machine.
 *
 * Minimal, dependency-free core: pure in-memory state + listeners. Since
 * 0.3.0-tisitan.0 (单宿主编排批) the broker half is the ONLY
 * consumer that builds Orchestration instances; the lib half no longer holds a
 * state machine of its own — it reads broker state one-way through the snapshot
 * bridge (`globalThis[Symbol.for('dsh-my-go.snapshot')]`). The class still lives
 * in the shared layer (not inlined into broker) so it stays ctx-free and unit-
 * testable in isolation.
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx.
 */

import { CURRENT_MAP_CAP, HISTORY_CAP } from './constants.mjs'

let seq = 0
export function nextId(prefix) {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

/** Minimal single-line-blocking orchestration state. Exported for unit tests. */
export class Orchestration {
  constructor() {
    this.currentMap = new Map()
    this.queue = []
    this.helpRequests = new Map()
    this.history = []
    this.listeners = new Set()
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      current: this.currentMap.size > 0 ? [...this.currentMap.values()][0] ?? null : null,
      queue: [...this.queue],
      helpRequests: [...this.helpRequests.values()],
      history: [...this.history],
    }
  }

  emit() {
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) {
      try { listener(snapshot) } catch { /* noop */ }
    }
  }

  isBusy() { return this.currentMap.size > 0 }

  enqueue(agentType, prompt, parentId) {
    const id = nextId('work')
    this.queue.push({ id, agentType, prompt, parentId, createdAt: Date.now() })
    this.emit()
    return id
  }

  // extra：重派路径注入的附加字段（如 fallbackAttempt/fallbackEntry），占位记录即携带，
  // bindChild 换键时经 {...record} 自然继承（竞态归随路径也不丢）。
  beginSpawning(agentType, prompt, extra = {}) {
    const record = {
      childId: nextId('child'),
      agentType,
      prompt,
      status: 'spawning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }
    this.currentMap.set(record.childId, record)
    this.enforceCurrentCap()
    this.emit()
    return record
  }

  bindChild(placeholderId, childId) {
    const record = this.currentMap.get(placeholderId)
    if (!record) {
      // 占位记录被误删/误改键时真实 childId 会游离于编排状态外——必须留痕，
      // 否则该子代理的结束事件将走归随兜底，引发历史工种串号
      console.warn(`[dsh-my-go] bindChild failed: placeholder ${String(placeholderId)} not found, child ${String(childId)} is now untracked`)
      return undefined
    }
    this.currentMap.delete(placeholderId)
    const next = { ...record, childId, status: 'running', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  dequeue() {
    const work = this.queue.shift()
    if (work) this.emit()
    return work
  }

  suspend(childId, help) {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    this.helpRequests.set(help.id, help)
    const next = { ...record, status: 'waiting', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  resolveHelp(id) {
    const help = this.helpRequests.get(id)
    if (help) { this.helpRequests.delete(id); this.emit() }
    return help
  }

  resume(childId) {
    const record = this.currentMap.get(childId)
    if (!record || record.status !== 'waiting') return record
    const next = { ...record, status: 'running', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  finish(childId, conclusion, failed = false) {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    const conclusionId = nextId('conclusion')
    const done = {
      ...record,
      status: failed ? 'failed' : 'done',
      conclusion,
      conclusionId,
      updatedAt: Date.now(),
    }
    this.currentMap.delete(childId)
    const clearedHelp = this.clearHelpFor(childId)
    this.history = [...this.history, done]
    if (this.history.length > HISTORY_CAP) this.history = this.history.slice(-HISTORY_CAP)
    this.emit()
    // 返回值附带连带清理计数（0.3.0-tisitan.3）：仅内存返回副本，不落 history/
    // 台账，供 broker 调用点对「清理 ≥1 张求助单」做可见通知
    return clearedHelp > 0 ? { ...done, clearedHelp } : done
  }

  clearHelpFor(childId) {
    let removed = 0
    for (const [id, help] of this.helpRequests) {
      if (help.childId === childId) {
        this.helpRequests.delete(id)
        removed += 1
      }
    }
    if (removed > 0) this.emit()
    return removed
  }

  requeueHead(work) {
    if (!work) return
    this.queue.unshift(work)
    this.emit()
  }

  /** Give up on a queued work item after retry exhaustion: remove it from the
   * queue and record a failed history entry — never strand it silently. */
  dropQueuedFailed(work, error) {
    const before = this.queue.length
    this.queue = this.queue.filter((w) => w.id !== work.id)
    const done = {
      childId: work.id,
      agentType: work.agentType,
      prompt: work.prompt,
      status: 'failed',
      conclusion: `queued dispatch abandoned after ${work.retries ?? 0} attempts: ${String(error)}`,
      conclusionId: nextId('conclusion'),
      createdAt: work.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    this.history = [...this.history, done]
    if (this.history.length > HISTORY_CAP) this.history = this.history.slice(-HISTORY_CAP)
    this.emit()
    return done
  }

  /** Move a done/failed history record back into currentMap as running (revive via continue/forward). */
  revive(childId) {
    if (this.currentMap.has(childId)) return this.currentMap.get(childId)
    const idx = this.history.findIndex((r) => r.childId === childId)
    if (idx < 0) return undefined
    const rec = this.history[idx]
    const next = { ...rec, status: 'running', updatedAt: Date.now() }
    this.history = [...this.history.slice(0, idx), ...this.history.slice(idx + 1)]
    this.currentMap.set(childId, next)
    this.enforceCurrentCap()
    this.emit()
    return next
  }

  abort(childId) {
    this.currentMap.delete(childId)
    this.emit()
  }

  /** 兜底闸（0.2.3-tisitan.15）：超限时按 updatedAt 淘汰最旧的滞留记录，防异常路径无界增长。 */
  enforceCurrentCap() {
    if (this.currentMap.size <= CURRENT_MAP_CAP) return
    let oldestId = null
    let oldestAt = Infinity
    for (const [id, rec] of this.currentMap) {
      const at = Number(rec?.updatedAt) || 0
      if (at < oldestAt) { oldestAt = at; oldestId = id }
    }
    if (oldestId !== null) {
      this.currentMap.delete(oldestId)
      console.warn(`[dsh-my-go] currentMap cap (${CURRENT_MAP_CAP}) exceeded; evicted stalest record ${String(oldestId)}`)
    }
  }

  record(childId) {
    return this.currentMap.get(childId) ?? this.history.find((r) => r.childId === childId)
  }

  /** Record the latest prompt Sisyphus sent to one child (go_work or continue).
   * urgency（0.3.0-tisitan.2，continue 三档声明）为可选第三参：非空字符串入账、否则
   * 清字段——字段语义恒为「最新一条 prompt 的投递档」，不留上一条的残留值；
   * 旧记录（从未传过 urgency）天然无此字段，零变化。 */
  followupPrompt(childId, prompt, urgency) {
    const tag = (next) => {
      if (typeof urgency === 'string' && urgency !== '') next.urgency = urgency
      else delete next.urgency
      return next
    }
    const rec = this.currentMap.get(childId)
    if (rec) {
      this.currentMap.set(childId, tag({ ...rec, prompt, updatedAt: Date.now() }))
      this.emit()
      return this.currentMap.get(childId)
    }
    const idx = this.history.findIndex((r) => r.childId === childId)
    if (idx >= 0) {
      const next = tag({ ...this.history[idx], prompt, updatedAt: Date.now() })
      this.history = [...this.history.slice(0, idx), next, ...this.history.slice(idx + 1)]
      this.emit()
      return next
    }
    return undefined
  }

  help(id) { return this.helpRequests.get(id) }
}
