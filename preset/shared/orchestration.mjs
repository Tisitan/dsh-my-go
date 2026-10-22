/**
 * dsh-my-go — single-line-blocking orchestration state machine.
 *
 * Minimal, dependency-free core: pure in-memory state + listeners. The broker
 * half is the ONLY consumer that builds Orchestration instances; the lib half
 * holds no state machine of its own — it reads broker state one-way through the
 * snapshot bridge (`globalThis[Symbol.for('dsh-my-go.snapshot')]`). The class
 * lives in the shared layer (not inlined into broker) so it stays ctx-free and
 * unit-testable in isolation.
 *
 * 泳道化（read-pool-semantics.md §一）：两个泳道各自持容量——读平面
 * （explore/librarian）readCapacity、写平面（其余全部工种）writeCapacity，
 * 缺省皆为 1 = 关闭 = 逐字节现状（写池配置化见 write-pool 批次，与读池对称）。
 * 关键口径：
 *  - **占槽 = 在 currentMap 即占槽**（spawning/waiting/running 同权，与单线口径
 *    一致）——laneCount 按记录数统计，不看 status。
 *  - record.lane 由 beginSpawning 从 laneOf(agentType) 派生写死，落在 ...extra
 *    **之后**（D8：泳道归属不可配，调用方无法越权覆盖）；revive 从旧台账回槽时
 *    按 laneOf 归一化补写——防旧格式台账记录回槽后 laneCount 漏统计。
 *  - laneCount 对无 lane 记录按 laneOf(agentType) 兜底归类。双保险的理由：漏一条
 *    无 lane 的 write 记录进 currentMap，isBusy 复合判定就漏计它 → 放行第二个写
 *    平面子代 = 单线锁被架空，这类「静默变松」比「报错」危险得多。
 *  - isBusy() 是复合判定「任一 lane 满」：两池容量皆 1（退化全局单线）时与
 *    「size>0」逐点等价（每条记录恰属一个 lane）；任一容量 ≥2 后 size>0 不再是
 *    正确的忙判定（read 在飞 1 条是设计内并行，不是忙）。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx.
 */

import { CURRENT_MAP_CAP, HISTORY_CAP } from './constants.mjs'

// 泳道判定表（read-pool-semantics.md §1.1，D7/D8）：explore/librarian 入
// 读 lane；looker 归写 lane（多模态成本异质，默认保守）；自定义角色与一切未知名
// 恒写 lane 且不可配（D8）——laneOf 是 agentType → lane 的纯函数，挂载期不变。
const READ_LANE_TYPES = new Set(['explore', 'librarian'])

export function laneOf(agentType) {
  return READ_LANE_TYPES.has(agentType) ? 'read' : 'write'
}

// 泳道容量钳制（读池/写池同律：规划 2.6 + 写池批次对称）：?? 1 默认关，2~3 启用，
// >3 钳 3。非法值一律回落 1（= 现状）而非抛错：容量来自部署 config，坏值不应炸
// 挂载，回落关闭是最安全降级。
const LANE_CAPACITY_MAX = 3

export function clampLaneCapacity(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(LANE_CAPACITY_MAX, Math.floor(n))
}

// 两枚泳道别名指向同一实现：调用点自解释（读池/写池各自命名），钳制律单点。
export const clampReadCapacity = clampLaneCapacity
export const clampWriteCapacity = clampLaneCapacity

let seq = 0
export function nextId(prefix) {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

/** Minimal single-line-blocking orchestration state. Exported for unit tests. */
export class Orchestration {
  // readCapacity / writeCapacity：两泳道并发容量（构造期固定；broker 接线
  // config.readPoolSize / config.writePoolSize）。默认皆 1 = 关闭 = 单线现状，
  // 默认构造的实例与改造前行为逐字节等价。
  constructor({ readCapacity = 1, writeCapacity = 1 } = {}) {
    this.readCapacity = clampLaneCapacity(readCapacity)
    this.writeCapacity = clampLaneCapacity(writeCapacity)
    this.currentMap = new Map()
    this.revivalReservations = new Map()
    this.queue = []
    this.helpRequests = new Map()
    this.history = []
    // 声明式接力链桶（docs/plans/relay-chain-semantics.md §2.4）：
    // 记录形状与迁移语义全部在 shared/relay-chain.mjs（决策纯函数 + dispatcher
    // 协议），本类只持桶——链是账本不是槽位持有者（不参与 laneCount/isBusy），
    // 存量上限 RELAY_CHAINS_CAP 由 broker 的 chain_start 入口执行。
    this.chains = []
    this.listeners = new Set()
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      // D20（read-pool-semantics.md §1.3）：current 单条（取 Map 首条，
      // 多条在飞时语义即错）→ currentRecords 全量数组，一步到位无过渡双字段。
      // 消费面三处（orchestration_status / list_subagents / 快照桥面板半）同批复闭环。
      currentRecords: [...this.currentMap.values()],
      queue: [...this.queue],
      helpRequests: [...this.helpRequests.values()],
      history: [...this.history],
      // 链桶追加字段（非形状变更——D13 快照注入兜底与面板渲染的
      // 数据源；渲染归 3.5，此处只保证链对快照消费者可见）。
      chains: [...this.chains],
      // 泳道容量事实（写池批次）：面板星图按容量渲染写槽几何与标签。只发容量、
      // 不发占用——占用数消费侧从 currentRecords 自算，避免同一事实两处漂移。
      lanes: {
        read: { capacity: this.readCapacity },
        write: { capacity: this.writeCapacity },
      },
    }
  }

  emit() {
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) {
      try { listener(snapshot) } catch { /* noop */ }
    }
  }

  isBusy() {
    // 复合判定「任何 lane 满」（read-pool-semantics.md §1.2）。两池容量皆 1 时
    // isLaneFree 退化口径对两个 lane 同真同假（见下），本判定逐点等价旧 size>0；
    // 任一容量 ≥2 后「某 lane 在飞但未满」不再是忙。
    return !this.isLaneFree('read') || !this.isLaneFree('write')
  }

  // 未知 lane 名（laneOf 不会产出）按最保守容量 1：宁可误判忙，不可静默变松。
  capacityOf(lane) {
    if (lane === 'read') return this.readCapacity
    if (lane === 'write') return this.writeCapacity
    return 1
  }

  // 占槽口径与单线时代一致：在 currentMap 即占槽（spawning/waiting/running 同权）。
  // 无 lane 记录按 laneOf(agentType) 兜底归类（旧台账回填/异常路径的双保险，见头注释）。
  // **同一 childId 跨两处只算一次**：revive 把记录搬回 currentMap 后预占若还挂着
  // （释放前的一拍），同一条子代会被算两槽——那是重复计槽，不是多占一个槽。
  laneCount(lane) {
    let n = 0
    for (const rec of this.currentMap.values()) {
      if ((rec.lane ?? laneOf(rec.agentType)) === lane) n += 1
    }
    for (const [reservedId, reservedLane] of this.revivalReservations) {
      if (reservedLane === lane && !this.currentMap.has(reservedId)) n += 1
    }
    return n
  }

  // 复活预占（continue/forward 把已完工子代放回其 lane 槽之前先占位）。
  // **先占后断言**而非「先查后占」：容量 ≥2 时同一 tick 内两条不同 childId 的复活
  // 会双双看到最后一个空位并双双通过（查与占之间没有原子性）；先 set 再数，
  // 后到者必然看见前者的预占，超容即回滚。JS 单线程 + 无 await 保证这段是原子的。
  reserveRevival(childId, lane) {
    if (this.revivalReservations.has(childId) || !this.isLaneFree(lane)) return undefined
    this.revivalReservations.set(childId, lane)
    if (this.laneCount(lane) > this.capacityOf(lane)) {
      this.revivalReservations.delete(childId)
      return undefined
    }
    return () => { this.revivalReservations.delete(childId) }
  }

  isLaneFree(lane) {
    // 退化口径（read-pool-semantics.md §八退化判据 + 写池对称）：读池与写池容量
    // 皆为 1 = 双池皆关 = **全局单线**，而非「read 1 + write 1 各占一槽的跨 lane
    // 并行」——否则全缺省配置下 write 在跑时 read 会被放行，违背 D5「默认关 =
    // 逐字节现状」。任一池容量 ≥2 才启用 lane 各自计数。
    // 硬性兼容：write=1+read=1 与改造前逐字节等价；write=1+read=3（写池批次前的
    // 装机态）走 lane 计数分支，与改造前同点同判，行为不变。
    if (this.readCapacity <= 1 && this.writeCapacity <= 1) return this.currentMap.size === 0 && this.revivalReservations.size === 0
    return this.laneCount(lane) < this.capacityOf(lane)
  }

  // lane-aware skip 的按 id 出队原语（read-pool-semantics.md §2.1）：被跳过的
  // work 原地保留、队列序不重排，被选中者按 id 精确移除。与 dequeue() 同款 emit。
  dequeueById(id) {
    const idx = this.queue.findIndex((w) => w.id === id)
    if (idx < 0) return undefined
    const [work] = this.queue.splice(idx, 1)
    this.emit()
    return work
  }

  enqueue(agentType, prompt, parentId) {
    const id = nextId('work')
    this.queue.push({ id, agentType, prompt, parentId, createdAt: Date.now() })
    this.emit()
    return id
  }

  // extra：重派路径注入的附加字段（如 fallbackAttempt/fallbackEntry），占位记录即携带，
  // bindChild 换键时经 {...record} 自然继承（竞态归随路径也不丢）。
  // lane 刻意落在 ...extra 之后：泳道归属派生自 agentType 且不可配（D8），
  // 调用方经 extra 越权注入 lane 字段会被这里的强制重算纠正。
  beginSpawning(agentType, prompt, extra = {}) {
    const record = {
      childId: nextId('child'),
      agentType,
      prompt,
      status: 'spawning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
      lane: laneOf(agentType),
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
    // stallNotified（broker 侧「本次停摆已向主编报过」的 episode 标记）随挂起复位：
    // episode 的边界是「这一轮挂起」而不是「这个子代」，新一轮挂起就该重新可见一次。
    // 复位点选在挂起本身而非恢复之后：同轮连挂两张求助单时第二次挂起同样复位，而
    // 「报不报」由 broker 的队列积压判定把关（无积压 = 无停摆 = 不报），此处只负责
    // 忘记上一轮。
    delete next.stallNotified
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
    delete next.stallNotified // 复籍即停摆 episode 结束（见 suspend 的复位注释）
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
    // stallNotified 不随记录入史/入档（持久化取舍：episode 标记只活在
    // currentMap 的占槽记录上）——入史即 episode 终结，留着只会让台账里的死记录
    // 带一个永不复位的标记，复活后反而哑掉下一次通报。
    delete done.stallNotified
    this.currentMap.delete(childId)
    const clearedHelp = this.clearHelpFor(childId)
    this.history = [...this.history, done]
    if (this.history.length > HISTORY_CAP) this.history = this.history.slice(-HISTORY_CAP)
    this.emit()
    // 返回值附带连带清理计数：仅内存返回副本，不落 history/
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
    // lane 归一化：旧格式台账回填的 history 记录没有 lane 字段，回槽
    // 必须补写——否则 laneCount 漏统计，isBusy 复合判定在写 lane 占用时可能为假，
    // 放行第二个写平面子代（泳道槽被一条旧档案架空）。
    const next = { ...rec, lane: rec.lane ?? laneOf(rec.agentType), status: 'running', updatedAt: Date.now() }
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

  /** 兜底闸：超限时按 updatedAt 淘汰最旧的滞留记录，防异常路径无界增长。 */
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
   * urgency（continue 三档声明）为可选第三参：非空字符串入账、否则清字段——
   * 字段语义恒为「最新一条 prompt 的投递档」，不留上一条的残留值；从未传过
   * urgency 的记录天然无此字段。 */
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

/**
 * 占位 → 真 childId 的换键分流：spawn 窗口里占位可能已被回收——
 * E2 泄漏哨兵按 `createdAt` 年龄判定（冷读慢的派发会被判成「链无进展」并 finish），
 * disposed 兜底 abort 与 `currentMap` 容量淘汰同理。此时照旧 `bindChild` 会命中不在
 * 册的占位：真子代 untracked、结论丢弃、台账还留一条与事实相反的 failed。三条分支收
 * 在一处（直派与备选重派共用，杜绝第二份实现）：
 *   ① 占位仍在册 → 原样换键（正常路径，行为零变化）；
 *   ② 已被落账型回收（任何走 `finish` 的回收）→ 先 `revive` 把那条 failed 史记录搬回
 *      槽（台账不留与事实相反的 failed、结论仍按真 id 归因），再换键；
 *   ③ 被无史回收（disposed 兜底 abort / 容量淘汰）→ 按 `extra` 重建占位再换键——
 *      `extra` 承接 `fallbackAttempt`/`fallbackEntry` 一类占位附加字段，重派路径不丢链状态。
 * 纯状态机适配：零 ctx、零兄弟模块依赖（本文件铁律同守）。
 */
export function bindSpawnedChild(orch, placeholder, childId, agentType, prompt, extra = {}) {
  if (orch.currentMap.has(placeholder.childId)) return orch.bindChild(placeholder.childId, childId)
  if (orch.revive(placeholder.childId)) return orch.bindChild(placeholder.childId, childId)
  return orch.bindChild(orch.beginSpawning(agentType, prompt, extra).childId, childId)
}
