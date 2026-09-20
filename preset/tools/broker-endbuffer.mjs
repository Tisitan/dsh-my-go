/**
 * dsh-my-go — E2 end 缓冲重放（二期 2.4，read-pool-semantics.md §4.3 方案 A；
 * 5.2 波自 broker.mjs 抽出）。
 *
 * 抢跑 spawn resolve 的 end 在此暂存：等登记（sessionTypes/bindChild/childOwner，
 * dispatchWork 与 attemptFallbackRedeploy 的 spawn resolve 后同步段）追上，按
 * **真 id 精确认领**重放全量归因管线——E4 guard/E5/E6 备选链/E7 落账/E9 闸门
 * 全量生效。认领键是真 id 本身（resolve 返回什么 id、登记就用什么 id），归因
 * 零猜测：幽灵红线在归因面上关死。替代退役的占位唯一归因兜底（更精确：重放
 * 走全管线，而非只补一条 attributed warn）。三红线口径：
 *   幽灵——认领即删条目、按真 id 匹配，无「恰有一条就归它」式猜测；
 *   双份——缓冲在归因管线之前，不存在两条路径消费同一 end；
 *   真空——每条目挂 grace 定时器，超时显式落档 + 占位审计回收（绝不静默蒸发）。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：本簇持进程内
 * 活状态（两张 Map + grace 定时器）并要跨簇回调——**原「头尾穿越」的现落点**（5.4
 * 波后两处消费点已各自随簇迁出，不再同处 broker.mjs 一头一尾）：直派认领点在
 * ./broker-scheduler.mjs 的 dispatchWork 登记同步段、重派认领点与重放入口 processEnd
 * 都在 ./broker-ending.mjs，broker.mjs 只做接线（两侧都拿本簇工厂产物）。本模块只管
 * 「存 / 取 / 超时回收」三件事，认领到载荷后由调用方自己调 processEnd 重放（本模块
 * 从不 import 也从不反向调用任何兄弟簇，依赖单向）。反过来超时支路的三连落账需要
 * broker 侧经 deps 注入的六件：orchestrations / childRegistry / abortExpected 三枚
 * 句柄 + notifyClearedHelp / bump / advanceQueue 三件回调（advanceQueue 是调度簇产物）。
 *
 * 形态：createEndBufferOps({ graceMs, metrics, orchestrations, abortExpected,
 * childRegistry, notifyClearedHelp, bump, advanceQueue }) → { bufferEnd,
 * claimBufferedEnd, auditStaleSpawningPlaceholders, clearEndBuffer }。
 *   - bufferEnd：入缓冲 + 容量驱逐（END_BUFFER_CAP 超容丢最旧并留痕）+ grace 定时器。
 *   - claimBufferedEnd：登记点同步认领，命中即删条目 + 撤 timer，返回 info；
 *     未命中返回 undefined（绝大多数 spawn 无抢跑 end）。
 *   - auditStaleSpawningPlaceholders：缓冲超时的连带回收（§4.2 泄漏面最终口径）——
 *     滞留超 grace 的 spawning 占位按 disposed 兜底同款三连落账解冻。仅簇内自调
 *     （超时支路自查；broker.mjs 接线未解构、测试亦无直接消费方），现无簇外消费方，
 *     导出仅保持簇口形状完整——行为面由 end-buffer.test.mjs 经 broker 挂载实测。
 *   - clearEndBuffer：卸载收尾，撤 timer + 清表。
 */

export function createEndBufferOps({ graceMs, metrics, orchestrations, abortExpected, childRegistry, notifyClearedHelp, bump, advanceQueue }) {
  const endBuffer = new Map()      // childId → { info, bufferedAt }
  const endBufferTimers = new Map() // childId → timer（认领即撤，超时即回收）
  const END_BUFFER_CAP = 16
  function bufferEnd(childId, info) {
    // 同 childId 二发：覆盖旧载荷（登记缺席窗口内无从区分代际，保留最新即可；
    // 真正的代际双发由 E5 once-guard 在重放后的归因管线里拦）
    if (endBufferTimers.has(childId)) clearTimeout(endBufferTimers.get(childId))
    endBuffer.delete(childId)
    endBuffer.set(childId, { info, bufferedAt: Date.now() })
    if (endBuffer.size > END_BUFFER_CAP) {
      const oldest = endBuffer.keys().next().value
      const dropped = endBuffer.get(oldest)
      endBuffer.delete(oldest)
      if (endBufferTimers.has(oldest)) { clearTimeout(endBufferTimers.get(oldest)); endBufferTimers.delete(oldest) }
      console.warn(`[dsh-my-go] end buffer cap (${END_BUFFER_CAP}) exceeded; dropped oldest buffered end ${String(oldest)} (stopReason=${String(dropped?.info?.stopReason)})`)
      metrics.record({ kind: 'end-buffer', phase: 'cap-evicted', childId: oldest })
    }
    console.warn(`[dsh-my-go] subagent/end for untracked child ${String(childId)} buffered awaiting spawn registration (E2 buffer, grace=${graceMs}ms)`)
    metrics.record({ kind: 'end-buffer', phase: 'buffered', childId })
    const timer = setTimeout(() => {
      endBufferTimers.delete(childId)
      const entry = endBuffer.get(childId)
      if (!entry) return // 认领竞态双保险（认领路径也会撤 timer）
      endBuffer.delete(childId)
      console.warn(`[dsh-my-go] buffered end for ${String(childId)} expired after ${graceMs}ms without spawn registration; dropped as unattributable`)
      metrics.record({ kind: 'end-buffer', phase: 'expired', childId })
      auditStaleSpawningPlaceholders()
    }, graceMs)
    timer.unref?.()
    endBufferTimers.set(childId, timer)
  }
  // 认领：登记点（spawn resolve 后）同步调用。命中即删条目 + 撤 timer，返回暂存
  // 载荷交调用方重入归因管线；未命中返回 undefined（绝大多数 spawn 无抢跑 end）。
  function claimBufferedEnd(childId) {
    const entry = endBuffer.get(childId)
    if (!entry) return undefined
    endBuffer.delete(childId)
    if (endBufferTimers.has(childId)) { clearTimeout(endBufferTimers.get(childId)); endBufferTimers.delete(childId) }
    metrics.record({ kind: 'end-buffer', phase: 'claimed', childId })
    return entry.info
  }
  // 占位审计（缓冲超时的连带回收，防 §4.2 泄漏面的最终口径）：滞留超 grace 的
  // spawning 占位 = spawn 链无进展（正常窗口 ≪ grace），按 disposed 兜底同款
  // 三连落账回收——failed 落账 + retireChild + advanceQueue 解冻，一个都不少。
  function auditStaleSpawningPlaceholders() {
    const now = Date.now()
    for (const [pid, orch] of orchestrations) {
      for (const rec of [...orch.currentMap.values()]) {
        if (rec.status !== 'spawning') continue
        if (now - (Number(rec.createdAt) || 0) <= graceMs) continue
        console.warn(`[dsh-my-go] spawning placeholder ${String(rec.childId)} (${rec.agentType}) stale for >${graceMs}ms; recovering as failed (E2 leak guard)`)
        // 兜底掐断前同步撤 abort 护航（防 guard 泄漏误吞复活轮，同 disposed 兜底纪律）
        abortExpected.delete(rec.childId)
        const recovered = orch.finish(rec.childId, `spawning placeholder recovered: spawn did not resolve within ${graceMs}ms`, true)
        if (recovered?.clearedHelp) notifyClearedHelp(pid, rec.childId, recovered.clearedHelp)
        childRegistry.retireChild(rec.childId)
        bump()
        advanceQueue(orch)
      }
    }
  }
  // 卸载收尾：撤掉所有在飞的 grace 定时器并清空两张表（与 queueRetry / dispose
  // 宽限期清理同一枚 ctx.effect）。
  function clearEndBuffer() {
    for (const timer of endBufferTimers.values()) clearTimeout(timer)
    endBufferTimers.clear()
    endBuffer.clear()
  }
  return { bufferEnd, claimBufferedEnd, auditStaleSpawningPlaceholders, clearEndBuffer }
}
