/**
 * dsh-my-go — disposed 宽限期兜底（0.2.3-tisitan.4 起本体；5.2 波自 broker.mjs 抽出）。
 *
 * DSH continuable 生命周期中 agent/disposed 恒先于 subagent/end（dispose
 * 内部 handle.dispose() 先于 observer.settle()，见 dsh-subagent finishDisposal）。
 * 因此活记录遭遇 disposed 时不能立即清槽——end 通常紧随而至，立即 abort 会让
 * 合法结论无处落账（0.2.3-tisitan.6 部署实测：正常完工的 explore 不进历史）。改为
 * 立墓碑 + 宽限期兜底：宽限期内 end 到达则正常 finish；end 真缺席才 abort
 * 清槽推进队列，防止队列永久冻结。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：本簇持进程内
 * 活状态（兜底定时器表）且要碰兄弟簇产物与编排热路径——宽限期到点的「三连落账」
 * 需要 abortExpected / childRegistry.retireChild / notifyClearedHelp / bump /
 * advanceQueue，全部由 broker.mjs 的 apply() 显式注入。接线点在 broker.mjs 内排在
 * 调度簇实例化之后（5.4 重排）：advanceQueue 是调度簇工厂产物、notifyClearedHelp 是
 * notify 簇工厂产物，与 bump / childRegistry / abortExpected 一并**先声明后直传**，
 * 本簇零提升依赖、零 TDZ 窗口（原先「靠函数声明提升抢在接线序之前取值」的 D-4
 * 布局雷已随该波重排消掉）。grace 时长来自插件 config，读取仍在 broker.mjs。
 *
 * 形态：createDisposeFallbackOps({ graceMs, abortExpected, childRegistry,
 * notifyClearedHelp, bump, advanceQueue }) → { scheduleDisposeFallback,
 * cancelDisposeFallback, clearDisposeFallbackTimers }。
 *   - scheduleDisposeFallback：同 id 二挂直接跳过（首挂的宽限窗才是准）。
 *   - cancelDisposeFallback：end 入口自撤（幂等空转），以及属主会话销毁时同点撤。
 *   - clearDisposeFallbackTimers：插件卸载收尾（与 queueRetry / endBuffer 同点
 *     职责）——只 clearTimeout 不撤表会让在飞 timer 挂在已销毁的 scope 上。
 *
 * 与 E2 缓冲簇（./broker-endbuffer.mjs）结构同构（Map + grace 定时器 + 超时三连
 * 落账），但状态形状不同（本簇存 { timer, orch }、E2 存待重放的 end 载荷并带容量
 * 驱逐），消费方与生命周期也不同，故刻意分成两模块各守一条红线，不把「三连落账」
 * 再抽成第三处共享 helper（那是去重而非搬家，超出本波「行为零变化」的口径）。
 */

export function createDisposeFallbackOps({ graceMs, abortExpected, childRegistry, notifyClearedHelp, bump, advanceQueue }) {
  const disposeFallbackTimers = new Map()
  function cancelDisposeFallback(id) {
    const entry = disposeFallbackTimers.get(id)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      disposeFallbackTimers.delete(id)
    }
  }
  function scheduleDisposeFallback(id, orch, parentId) {
    if (disposeFallbackTimers.has(id)) return
    const timer = setTimeout(() => {
      disposeFallbackTimers.delete(id)
      if (!orch.currentMap.has(id)) return
      console.warn(`[dsh-my-go] subagent/end never arrived for disposed child ${String(id)} within ${graceMs}ms; aborting record to unblock the queue`)
      // end 真缺席时同步清 abort 护航，防 guard 泄漏后误吞同 childId 复活轮的正常 end
      abortExpected.delete(id)
      // 0.3.0-tisitan.3：兜底掐断不再静默 abort 蒸发记录——按 dropQueuedFailed
      // 同款口径落一条 failed 历史（finish 连带清理其名下求助单），队列解冻
      // 但账上有据；宽限期内正常 end 到达的路径走 finalizeEnd，不会重复落史
      const done = orch.finish(id, `disposed grace-period fallback aborted this record: subagent/end never arrived within ${graceMs}ms`, true)
      if (done?.clearedHelp) notifyClearedHelp(parentId, id, done.clearedHelp)
      // 走 retireChild 而非手删 childOwner（0.3.0-tisitan.7 N14）：兜底掐断即本儿童
      // 的终局，类型侧三张表（活登记/墓碑/备选覆盖）必须同点翻篇。此前墓碑条目
      // 滞留，真迟到的那条 end 仍能经墓碑认到工种、归到已无活记录的实例上，
      // 报出一句「has no live record; conclusion dropped」——结论其实早已按兜底
      // 口径落账，这条 warn 是无中生有的误报（且墓碑白占容量）。
      childRegistry.retireChild(id)
      bump()
      advanceQueue(orch)
    }, graceMs)
    timer.unref?.()
    disposeFallbackTimers.set(id, { timer, orch })
  }
  // 卸载收尾：撤掉所有在飞的宽限期定时器（与 broker.mjs 的 queueRetry / endBuffer
  // 清理点同一枚 ctx.effect）。
  function clearDisposeFallbackTimers() {
    for (const entry of disposeFallbackTimers.values()) clearTimeout(entry.timer)
    disposeFallbackTimers.clear()
  }
  return { scheduleDisposeFallback, cancelDisposeFallback, clearDisposeFallbackTimers }
}
