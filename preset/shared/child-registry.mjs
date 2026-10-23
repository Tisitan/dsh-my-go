/**
 * dsh-my-go — 子代理进程内登记表（十二张桥接表 + 跨表不变量）。
 *
 * 各表都是「派生事件之间的桥接状态」，不是编排事实本体（事实在
 * shared/orchestration.mjs 的流水线与台账里）：
 *  sessionTypes      childId → 工种（活登记；不持久化，冷恢复后靠 label 兜底）
 *  disposedTypes     墓碑：agent/disposed 恒先于 subagent/end，晚到的 end 靠它认工种
 *  childOwner       childId → 属主编排会话 id（子代理侧事件的回路由）
 *  activeFallback     childId → 备选 {provider, model}（waterfall 不回跳主模型）
 *  pendingFallbackByLabel label → 备选条目（spawn resolve 前的窗口）
 *  abortExpected     urgency=abort 掐断护航（预期 end 一次性消费，复活即清）
 *  fallbackDecided    备选评估 once-guard（同 childId 每代际只决策一次）
 *  repairRetried     报告补发 once-guard（1.5，语义「补发授权已用掉」：
 *             补发链不走 rearmChild，guard 存续到补发轮 end 的转裁决
 *             ——防无限循环；终局 retireChild 与复活 rearmChild 双点清）
 *  reportSubmitted    报告提交成功事实（提交制）：
 *             childId → 已校验的 { conclusion, evidence, open }，
 *             report_submit 落板成功即登记，供终局合成回执与报告闸门消费；
 *             代际语义：条目**跨终局保留**（retireChild / retireTypeRecords
 *             都不清——双发残余窗口里终局后再来的 end 不该被判「从未提交」），
 *             只在**复活开新一轮**（rearmChild：continue/forward 命中已结束
 *             子代）时清除——上一代际的提交不算本代际已交付，否则新一轮不交
 *             报告也会被闸门误判直通。有界 FIFO 容量 REPORT_SUBMITTED_CAP 兜
 *             无界增长；childId 全局唯一（uuid），条目不会与后世代际串号
 *  stagedReports      长正文暂存（提交制防重吐）：childId → report 全文。
 *             report_submit 因其他字段校验失败时把已传入的 report 正文存进
 *             这里，重调传「（已暂存）」或省略 report 即回填；成功提交、
 *             复活开新一轮、终局翻篇三处清理；容量 STAGED_REPORTS_CAP 兜底
 *  modelCache       provider → 模型 id 集合（只缓存「列举成功」的清单，含空集）
 *  pendingDeliveries childId → 在途投递计数（continue/forward 的唤醒投递窗口）。
 *             begin/end 成对，只由投递方包住「唤醒 → 复籍」整段；disposed 宽限期
 *             兜底在计数 >0 时**不得判死**（P11：冷恢复可能比宽限期长得多）。
 *             终局清理不动它——投递可能比记录更长寿，清了就等于放开那把刀。
 *  boardSeqAtArm   childId → { seq }：本世代唤醒前的 board **已落盘**代次（P21/P22
 *                  世代锚；`{seq:0}` 的「已设锚」≠「从未设锚」，见 noteBoardSeqAtArm）。
 *  submittedLandedSeq  childId → 该条 reportSubmitted 写中时的 landedSeq（P21）。
 *             continue/forward 在**唤醒之前**登记；终局报告闸门的板兜底据此要求
 *             「正板确系本世代新写入」（落盘代次已越过该锚），否则上一世代残留的
 *             旧板会被当成新一轮已交付。
 *  heartbeats       childId → { roundStartAt, lastSignalAt, pingsUnanswered }
 *             （主编缓存心跳的「本轮起始 / 上次信号 / 未回应 ping 数」；
 *             spawn·continue·need_help·report_submit 等任一信号刷新
 *             lastSignalAt 并清零 pingsUnanswered，复活开新一轮把
 *             roundStartAt 也归零；终局（retireChild/retireTypeRecords）
 *             随子代翻篇删除。定时器本体不在这——它属 broker 的
 *             broker-heartbeat.mjs，本表只存「信号时刻」这一事实。）
 *
 * 抽出来的理由：这几张表的生命周期**互相缠绕**——墓碑换出要顺带摘备选覆盖、
 * end 收尾要一次清四张表、重派要把 label 临时登记转正为 childId 永久登记、
 * 复活要按台账记录回填三张表并清两张一次性表（备选 once-guard 与 abort 护航）。这类跨表不变量散落在 broker 里时，任何新增清理
 * 点都可能漏掉一张表；漏了不报错，只在下一次 end 归因时静默串号。不变量收敛到
 * 本模块后，broker 侧只剩「单表读写 + 何时调用」。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx.
 * 纯状态 + 显式不变量：不发通知、不推队列、不 bump 快照、不读配置——那些是
 * broker 的策略。返回实例即「一次插件挂载」的全部子代理侧状态；多编排会话
 * 隔离仍由 broker 的 orchestrations Map 承担（本模块不认识会话）。
 */

// 墓碑有界 FIFO 上限：end 事件永久缺席时也不致无限增长；正常路径自会消费清除。
export const DISPOSED_TYPES_CAP = 50

// 成功提交登记的有界 FIFO 上限：这张表只在复活开新一轮时清（见 rearmChild），
// 终局落账不清——跨终局的代价是无界增长，故容量即它唯一的收缩手段。200 枚 =
// 远大于任何单进程的存活儿童数，驱逐只在长跑/常驻宿主上发生。
export const REPORT_SUBMITTED_CAP = 200

// 长正文暂存池容量：一次校验失败只暂存一份（同 childId 重存即覆盖），条目随
// 成功提交 / 复活 / 终局三处清理；容量只是「异常路径漏清」时的兜底。
export const STAGED_REPORTS_CAP = 100

/**
 * @param options.disposedTypesCap 墓碑表容量（测试可缩小以验证驱逐路径）
 * @returns 登记表句柄：八张表本体（同名暴露，单表读写点直用）+ 跨表不变量操作。
 */
export function createChildRegistry({ disposedTypesCap = DISPOSED_TYPES_CAP } = {}) {
  const sessionTypes = new Map()
  const disposedTypes = new Map()
  const childOwner = new Map()
  const activeFallback = new Map()
  const pendingFallbackByLabel = new Map()
  const abortExpected = new Set()
  const fallbackDecided = new Set()
  const repairRetried = new Set()
  // 世代锚表的容量上限（P21 顺手清理）：与 reportSubmitted 同尺。
  const BOARD_SEQ_ARM_CAP = 200
  const reportSubmitted = new Map()
  // 提交登记 ↔ 报告板世代的绑定（P21）：id → 落盘成功时的 landedSeq。
  // 与 reportSubmitted 同生同灭（rearmChild 一起清、FIFO 一起驱逐），只多一层
  // 「这条登记写的是哪代板」的事实，闸门用它防旧世代登记短路过闸。
  const submittedLandedSeq = new Map()
  const stagedReports = new Map()
  const modelCache = new Map()
  const heartbeats = new Map()
  const pendingDeliveries = new Map()
  const boardSeqAtArm = new Map()

  /**
  * disposed 先于 end 到达：工种从活登记移入墓碑，备选覆盖随之摘除（墓碑期
  * 不再有运行期重绑需求）。超容按插入序驱逐最旧条目，与其备选覆盖同进退。
  * @returns 是否真的做了迁移（无活登记时 false，调用方据此决定是否刷快照）
  */
  function tombstoneType(id) {
    const type = sessionTypes.get(id)
    if (type === undefined) return false
    sessionTypes.delete(id)
    activeFallback.delete(id)
    disposedTypes.set(id, type)
    if (disposedTypes.size > disposedTypesCap) {
      const evicted = disposedTypes.keys().next().value
      disposedTypes.delete(evicted)
      activeFallback.delete(evicted)
    }
    return true
  }

  /**
  * 报告提交成功登记（有界 FIFO，照 tombstoneType 同款范式）：delete→set 先摘后插
  * 刷新最近性（同 childId 重交不占两个位置），超容按插入序驱逐最旧条目。这张表
  * 跨终局保留，本方法是它唯一的收缩手段——不设容量就等于让一条永不被清理的表
  * 随常驻进程无限长。
  */
  function markSubmitted(id, value, landedSeq) {
    reportSubmitted.delete(id)
    reportSubmitted.set(id, value)
    if (reportSubmitted.size > REPORT_SUBMITTED_CAP) {
      const evicted = reportSubmitted.keys().next().value
      reportSubmitted.delete(evicted)
      submittedLandedSeq.delete(evicted)
    }
    if (Number.isFinite(landedSeq)) submittedLandedSeq.set(id, landedSeq)
    else submittedLandedSeq.delete(id)
    if (submittedLandedSeq.size > REPORT_SUBMITTED_CAP) {
      submittedLandedSeq.delete(submittedLandedSeq.keys().next().value)
    }
  }

  /**
   * 某条提交登记对应的是哪一代报告板（P21）。report_submit 落板成功后写入当时
   * 的 landedSeq；闸门用它判断「这条登记是不是本世代写的」，从而让
   * `hasBoard` 的世代护栏无法被一条**上一世代**的内存登记短路绕过（抢跑的
   * report_submit 若写盘失败，landedSeq 不前进，登记也不会被当成新世代）。
   */
  function submittedLandedSeqOf(id) {
    return submittedLandedSeq.get(id)
  }

  /**
   * 长正文暂存（report_submit 校验失败时落，成功提交/复活/终局三处清）：
   * delete→set 刷新最近性、超容驱逐最旧，与 markSubmitted 同款有界范式。
   */
  function stageReport(id, text) {
    if (typeof text !== 'string' || text === '') return false
    stagedReports.delete(id)
    stagedReports.set(id, text)
    if (stagedReports.size > STAGED_REPORTS_CAP) {
      stagedReports.delete(stagedReports.keys().next().value)
    }
    return true
  }

  /** 取回暂存正文（成功重调后由调用方 dropStagedReport 清理）。 */
  function takeStagedReport(id) {
    return stagedReports.get(id)
  }

  /** 清理暂存（成功提交 / 复活开新一轮 / 终局翻篇统一走这里，幂等）。 */
  function dropStagedReport(id) {
    return stagedReports.delete(id)
  }

  /** end 收尾 / 重派换键：工种 + 墓碑 + 备选覆盖 + 属主路由四张表一起翻篇。 */
  function retireChild(id) {
    sessionTypes.delete(id)
    disposedTypes.delete(id)
    activeFallback.delete(id)
    childOwner.delete(id)
  // 心跳表随终局删除：孩子走了，没有「距上次信号」可言（长跑进程里这张表唯一
  // 的收缩手段；只在活儿童/在飞记录上落表项，故容量恒 ≤ CURRENT_MAP_CAP）。
    heartbeats.delete(id)
  // repairRetried 的**终局清理点**（1.5 方案甲裁决，防无限循环的关键）：子代
  // 走到任何终局落账（合格 finalize / 转裁决 finalize / 失败终局）都经此处，
  // guard 必须随终局翻篇——补发链本身不走 rearmChild，若这里不清，授权状态
  // 会随 childId 永挂（childId 全局唯一，无别的清理时机）。
    repairRetried.delete(id)
  // reportSubmitted 这里**不清**：终局不等于新时代——子代交过报告、终局落账后
  // 闸门若再一次看到它的 end（双发残余窗口/补交轮终局），清掉会把它判成「从未
  // 提交」而发射第二次补发。代际翻篇的唯一时点是 rearmChild（主动复活开新一轮）。
  // 收缩由 markSubmitted 的 FIFO 容量承担。
  // 世代锚随终局清（P21）：属性是「本世代板写到哪」，终局闸门已经读过一次，
  // 之后同 childId 再无第二次终局读取的机会；留着只会在长跑进程里无界积累
  // （复活时投递方会重新设锚，所以这里清掉不丢信息）。
  // 提交登记绑定的 landedSeq 与 reportSubmitted 同律：**不清**（同一代际的
  // 双发残余窗口/补交轮终局还要读它），只随 rearmChild 与 FIFO 驱逐翻篇。
    boardSeqAtArm.delete(id)
  // 暂存正文随终局丢：子代已离场，不会再有重调来取它。
    stagedReports.delete(id)
  }

  /**
  * 属主实例已销毁（编排会话先走一步）的分支：只清类型侧三张表，**故意不动
  * childOwner**——与 retireChild 不可互换，那条路径的属主键留着另有用途
  * （disposed 侧仍会按它清理，早清会改变回收顺序）。
  */
  function retireTypeRecords(id) {
    sessionTypes.delete(id)
    disposedTypes.delete(id)
    activeFallback.delete(id)
  // 心跳表同点删（与 retireChild 同律：类型侧翻篇即本代际事实作废）
    heartbeats.delete(id)
  // 与 retireChild 同理：reportSubmitted 不随任何终局形态清空（只随 rearmChild 翻篇）；
  // 世代锚反而要清（属主实例已销毁 ⇒ 不会再有本世代的终局闸门读它）。
    boardSeqAtArm.delete(id)
  // 暂存正文同样没有消费方了，同点丢。
    stagedReports.delete(id)
  }

 // ── 在途投递窗口 + 报告板世代锚（P11 / P22）──────────────────────────────────
  /**
   * 在途投递窗口（P11）。投递方（continue/forward）在**唤醒子代之前** begin，
   * 在复籍落地后的 finally 里 end；disposed 宽限期兜底读 isDeliveryPending。
   *
   * 为什么必须由投递方显式开窗：宿主冷恢复（coldResume = observeSession +
   * materialize）没有任何时长保证，可能远超 disposeEndGraceMs。窗口内 broker 侧
   * 记录还没被 followupPrompt/revive 换掉（对象身份不变），兜底定时器看不出
   * 「有人在恢复」，只能靠这张表知道「有一笔投递在飞」。计数而非布尔：同一
   * childId 可能被并发 continue（重复投递是调用方的错，但计数保证 end 成对时
   * 不会提前关窗）。
   */
  function beginDelivery(childId) {
    pendingDeliveries.set(childId, (pendingDeliveries.get(childId) ?? 0) + 1)
  }

  function endDelivery(childId) {
    const n = pendingDeliveries.get(childId) ?? 0
    if (n <= 1) pendingDeliveries.delete(childId)
    else pendingDeliveries.set(childId, n - 1)
  }

  function isDeliveryPending(childId) {
    return (pendingDeliveries.get(childId) ?? 0) > 0
  }

  /**
   * 本世代报告板的**已落盘**代次锚（P21/P22）：continue/forward 在唤醒**之前**
   * 记下当时的 boardLandedSeq。终局闸门要求「本世代确实写过板」——判据是
   * landedSeq > 该锚，而不是「写过板」本身：抢跑的 report_submit 若写盘失败
   * （EISDIR），landedSeq 停在锚上，闸门就不认。
   *
   * 存 { seq } 而不是裸数字：`seq === 0` 的「已设锚」与「从未设锚」必须可区分
   * ——前者要求 landedSeq ≥ 1（新世代必须真写成过），后者（老路径）不做世代校验。
   * 容量跟 REPORT_SUBMITTED_CAP 同尺（childId 全局唯一，活体数受 CURRENT_MAP_CAP
   * 约束，这里只兜异常增长）；retireChild 时清（终局闸门已读完，不再需要）。
   */
  function noteBoardSeqAtArm(childId, seq) {
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) return
    boardSeqAtArm.delete(childId)
    boardSeqAtArm.set(childId, { seq })
    if (boardSeqAtArm.size > BOARD_SEQ_ARM_CAP) boardSeqAtArm.delete(boardSeqAtArm.keys().next().value)
  }

  function boardSeqAtArmOf(childId) {
    return boardSeqAtArm.get(childId)?.seq ?? 0
  }

  /** 该子代是否设有世代锚（`seq=0` 也算「有」——与 boardSeqAtArmOf 的 0 默认值不同）。 */
  function hasBoardSeqAtArm(childId) {
    return boardSeqAtArm.has(childId)
  }

 // ── 心跳字段（主编缓存心跳的信号面；定时器与决策在 broker-heartbeat.mjs）──────
  /**
  * 任一信号到达后的统一记账：刷新 lastSignalAt + 清零 pingsUnanswered。
  * 缺表项即补种（冷恢复/台账复活的儿童第一次被看见时走这里，roundStartAt 此刻
  * 起算——不拿「表项缺失」冒充「沉默很久」）。
  * @param id childId
  * @param at 信号时刻（ms，调用方显式给：本模块不读时钟，与 createdAt 同律）
  */
  function noteHeartbeatSignal(id, at) {
    const stamp = Number.isFinite(at) ? at : Date.now()
    const entry = heartbeats.get(id)
    if (entry) {
      entry.lastSignalAt = stamp
      entry.pingsUnanswered = 0
      return entry
    }
    const created = { roundStartAt: stamp, lastSignalAt: stamp, pingsUnanswered: 0 }
    heartbeats.set(id, created)
    return created
  }

  /**
  * 心跳判定「该子代该被 ping」的那一拍 +1（未回应 ping 数）。
  * **不刷新 lastSignalAt**：这是「连着几拍建议了 ping 而没有任何动作」的计数，
  * 刷了时刻就等于把自己清零，升级梯永远到不了 escalateAfterPings（标红形同虚设）。
  */
  function noteHeartbeatPing(id, at) {
    const entry = heartbeats.get(id) ?? noteHeartbeatSignal(id, at)
    entry.pingsUnanswered = Math.max(0, Number(entry.pingsUnanswered) || 0) + 1
    return entry
  }

  /** 读面补种：表项缺失时按「此刻起算」建表（只在读取点补，绝不伪造陈旧）。 */
  function heartbeatOf(id, at) {
    return heartbeats.get(id) ?? noteHeartbeatSignal(id, at)
  }

  /**
  * 占位键换真身（bindChild）时的同点清理：spawn resolve 前的窗口里若正好走过
  * 一拍，心跳表会按占位 id（work-*）留下一条表项；真身换键后它再没有任何清
  * 理点（终局路径只知道真 childId），留成孤儿。调用方在 bindChild 之后同点丢。
  */
  function dropHeartbeat(id) {
    return heartbeats.delete(id)
  }

  /**
  * waterfall 消费点：childId 永久覆盖优先，未命中回退 label 临时登记。
  * 两者的优先级就是时序：spawn resolve 前只有 label 可用。
  */
  function fallbackOverrideFor(childId, label) {
    return activeFallback.get(childId) ?? pendingFallbackByLabel.get(label)
  }

  /**
  * 重派两段式登记的第二步：撤临时 label 登记、工种活登记、
  * 备选覆盖转正三步同点发生。拆开写会留下「临时已清、永久未登」的空档，期间
  * 任何请求都会被回跳成主模型。第一步（spawn 前的 pendingFallbackByLabel.set）
  * 是单表写，由调用方直写。
  * 旧 childId 的清理不在这里——它发生在 await spawn 之前，与本函数时点隔着一次
  * 异步等待，合并会改变并发窗口（调用方自行 retireChild）。
  */
  function promoteFallback({ label, childId, type, entry }) {
    pendingFallbackByLabel.delete(label)
    sessionTypes.set(childId, type)
    activeFallback.set(childId, entry)
  }

  /**
  * 复活重建（continue/forward 命中已结束记录）：与工种登记同点回填备选覆盖与
  * 属主路由——fallbackEntry 随台账落盘，cold-resume 后不回填则
  * waterfall 把备选静默回跳成主模型；属主不回填则再次 end 时路由不回本实例。
  * entry 畸形（缺 provider/model）视同无覆盖。
  *
  * 复活即**新世代**：两张一次性表同点清零。`fallbackDecided`
  * 的登记发生在备选评估点火处（早于三个早退分支），条目随 childId 进过评估就
  * 永挂；`abortExpected` 同理（掐断补偿只在同代际内消费）。带着上一代残留下
  * 复活，复活轮那条**正常完工**的 end 会被 end 入口的「评估在飞/预期掐断」
  * 分支当成自己人吞掉——记录永挂 running，advanceQueue 被 isBusy 恒真堵死，
  * 队列永久冻结（唯一救援是 disposed 宽限期兜底，而它已被 end 入口自撤）。
  * 一次性语义只对本代际成立，跨代际残留不是防线而是地雷。
  */
  function rearmChild(childId, record, ownerPid) {
    fallbackDecided.delete(childId)
    abortExpected.delete(childId)
  // repairRetried 同点清（1.5 方案甲裁决，规格「复活即新世代」字面）：主编复活
  // 已转裁决的子代做新任务时，旧 guard 不得误吞新任务的补发资格。**补发链本身
  // 不走 rearmChild**（repair-gate-repair 不 finish，记录留在 currentMap，补发
  // 只投 followup）——故此处清理不构成死循环回路，两处清理各司其职。
    repairRetried.delete(childId)
  // reportSubmitted 同点清（复活即新世代的报告面）：上一代际的提交登记若留着，
    // 新一轮的终局闸门会把「本代际还没交」误判成「已交付」而直通——报告则永远停在
    // 上一代的旧板上。清掉后，新一轮要么真交报告才直通，要么正常触发补发；旧板
    // 文件由工具簇/rearmAfterDelivery 同点归档成 <childId>.prev.md（回归档，不删）。
    reportSubmitted.delete(childId)
    submittedLandedSeq.delete(childId)
    stagedReports.delete(childId)
    sessionTypes.set(childId, record.agentType)
  // 心跳同点开新一轮（keep-alive）：复活轮的「本轮已运行」从此刻起算，上一代际
  // 的沉默时长与未回应 ping 数一概不继承——带着上一代的计时复活，会把一个刚
  // 复活 3 分钟的子代直接标成「沉默 40 分钟」并请主编当场裁决。
    heartbeats.delete(childId)
    if (typeof record.fallbackEntry?.provider === 'string' && typeof record.fallbackEntry.model === 'string') {
      activeFallback.set(childId, record.fallbackEntry)
    }
    if (ownerPid !== undefined) childOwner.set(childId, ownerPid)
  }

  return {
    sessionTypes,
    disposedTypes,
    childOwner,
    activeFallback,
    pendingFallbackByLabel,
    abortExpected,
    fallbackDecided,
    repairRetried,
    reportSubmitted,
    stagedReports,
    modelCache,
    heartbeats,
    pendingDeliveries,
    boardSeqAtArm,
    tombstoneType,
    markSubmitted,
    submittedLandedSeqOf,
    stageReport,
    takeStagedReport,
    dropStagedReport,
    retireChild,
    retireTypeRecords,
    fallbackOverrideFor,
    promoteFallback,
    rearmChild,
    beginDelivery,
    endDelivery,
    isDeliveryPending,
    noteBoardSeqAtArm,
    boardSeqAtArmOf,
    hasBoardSeqAtArm,
    noteHeartbeatSignal,
    noteHeartbeatPing,
    heartbeatOf,
    dropHeartbeat,
  }
}
