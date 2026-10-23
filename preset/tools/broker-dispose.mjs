/**
 * dsh-my-go — disposed 宽限期兜底。
 *
 * DSH continuable 生命周期中 agent/disposed 恒先于 subagent/end（dispose
 * 内部 handle.dispose() 先于 observer.settle()，见 dsh-subagent finishDisposal）。
 * 因此活记录遭遇 disposed 时不能立即清槽——end 通常紧随而至，立即 abort 会让
 * 合法结论无处落账（正常完工的 explore 会不进历史）。故
 * 立墓碑 + 宽限期兜底：宽限期内 end 到达则正常 finish；end 真缺席才 abort
 * 清槽推进队列，防止队列永久冻结。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：本簇持进程内
 * 活状态（兜底定时器表）且要碰兄弟簇产物与编排热路径——宽限期到点的「三连落账」
 * 需要 abortExpected / childRegistry.retireChild / notifyClearedHelp / bump /
 * advanceQueue，全部由 broker.mjs 的 apply() 显式注入。接线点在 broker.mjs 内排在
 * 调度簇实例化之后：advanceQueue 是调度簇工厂产物、notifyClearedHelp 是 notify 簇
 * 工厂产物，与 bump / childRegistry / abortExpected 一并**先声明后直传**——本簇零
 * 提升依赖、零 TDZ 窗口（不靠函数声明提升抢接线序）。grace 时长来自插件 config，
 * 读取仍在 broker.mjs。
 *
 * 形态：createDisposeFallbackOps({ graceMs, abortExpected, childRegistry,
 * notifyClearedHelp, bump, advanceQueue }) → { scheduleDisposeFallback,
 * cancelDisposeFallback, clearDisposeFallbackTimers }。
 *   - scheduleDisposeFallback：同 id 二挂直接跳过（首挂的宽限窗才是准）。
 *   - cancelDisposeFallback：end 收尾自撤（幂等空转），以及属主会话销毁时同点撤。
 *     **返回布尔**（是否真撤掉了一个在挂定时器）——供收尾/测试区分「真撤掉一枚」
 *     与「本来就没挂」；**不是**归因判据（真实宿主上 agent/disposed 恒先于
 *     subagent/end，这个布尔对正常完工路径恒为 true，拿它二分「续轮还会不会来」
 *     会把两段激活的第一段误判成终局——B2 闸 F1）。
 *   - clearDisposeFallbackTimers：插件卸载收尾（与 queueRetry / endBuffer 同点
 *     职责）——只 clearTimeout 不撤表会让在飞 timer 挂在已销毁的 scope 上。
 *
 * 与 E2 缓冲簇（./broker-endbuffer.mjs）结构同构（Map + grace 定时器 + 超时三连
 * 落账），但状态形状不同（本簇存 { timer, orch }、E2 存待重放的 end 载荷并带容量
 * 驱逐），消费方与生命周期也不同，故刻意分成两模块各守一条红线，不把「三连落账」
 * 再抽成第三处共享 helper（那是去重重构，不在本簇职责内）。
 */

export function createDisposeFallbackOps({ graceMs, abortExpected, childRegistry, notifyClearedHelp, bump, advanceQueue }) {
  const disposeFallbackTimers = new Map()
  // 返回布尔 = **本次调用是否真的撤掉了一个已挂起的定时器**（收尾/测试可观测量）。
  // 刻意**不**把它当归因判据：真实宿主上 disposed 恒先于 end ⇒ 对正常完工路径它
  // 恒为 true，用它判「有没有续轮」会把两段激活的第一段误判成终局（B2 闸 F1）。
  function cancelDisposeFallback(id) {
    const entry = disposeFallbackTimers.get(id)
    if (entry === undefined) return false
    clearTimeout(entry.timer)
    disposeFallbackTimers.delete(id)
    return true
  }
  function scheduleDisposeFallback(id, orch, parentId) {
    if (disposeFallbackTimers.has(id)) return
    // 挂表那一刻的记录对象（编排核每次改动都 `currentMap.set(id, { ...rec, ... })`
    // 换新对象，从不原地改）——活体检查的锚点，见下方定时器回调。
    armDisposeFallback(id, orch, parentId, orch.currentMap.get(id))
  }

  // 实际挂表。armedRecord 由调用方给：首次挂表取当下记录对象，因「在途投递」
  // 推迟时**沿用原锚**（见回调内 P11 分支）——推迟不是新世代，换锚就等于把
  // 「投递前那代记录」误认成「投递后新代记录」，后续活体检查全部失效。
  function armDisposeFallback(id, orch, parentId, armedRecord) {
    const timer = setTimeout(() => {
      disposeFallbackTimers.delete(id)
      const record = orch.currentMap.get(id)
      if (!record) return
      // ★ 在途投递（P11）：continue/forward 的唤醒投递可能正在等宿主冷恢复
      // （coldResume = observeSession + materialize，无时长保证），这段窗口里
      // broker 侧记录还没被 followupPrompt/revive 换掉，下面那条对象身份检查
      // 看不出「有人正在恢复」。此时**绝不判死**，只把定时器再挂一轮（沿用原
      // armedRecord 锚）：投递落地后记录被换 ⇒ 下一拍按活体检查撤除；投递抛错
      // 关窗后 ⇒ 下一拍照常兜底判死。宁可晚收槽，不可把在途冷恢复的结论判死
      // （后者会让第二段的 completed 变成 late-duplicate，永久丢结论）。
      if (childRegistry.isDeliveryPending?.(id) === true) {
        armDisposeFallback(id, orch, parentId, armedRecord)
        return
      }
      // ★ 活体检查（B2 闸 F1）：宽限期起算之后记录被替换过 ⇒ 期间发生过续轮投递
      // （`orch.followupPrompt` 换新记录对象，`prompt`/`updatedAt` 同步更新）或状态
      // 迁移 ⇒ 子代其实活着、宿主已接受它进入新一段激活，「end 永不到来」的前提
      // 不成立。此时**撤掉兜底且不重挂**（不是重新计时）：重挂等于给一个正常在跑的
      // 子代留一把随时可能落下的刀——第二段 Activation 只要跑得比宽限期长，就会被
      // 兜底按 failed 判死，它真正的 completed 结论随后被当成 late-duplicate 丢弃，
      // 正是 F1 要消灭的结论丢失。与评审建议的「continue 投递成功后
      // cancelDisposeFallback(targetId)」等效，只把判定点放进定时器回调（本写集
      // 无法在投递簇里拿到那个函数）。代价：若宿主接受了续派却永不启动第二段，
      // 记录会停在 running——那是宿主违约，与「所有正常在跑的子代」同一风险面
      // （没有兜底定时器在挂），由心跳/停摆通报面负责。
      // 判据只用记录**对象身份**：编排核每次改动都 currentMap.set(id, {...rec})，
      // 从不原地改——这是这条判据成立的唯一前提，也正因如此这里不看 mtime/时间窗。
      if (record !== armedRecord) return
      console.warn(`[dsh-my-go] subagent/end never arrived for disposed child ${String(id)} within ${graceMs}ms; aborting record to unblock the queue`)
      // end 真缺席时同步清 abort 护航，防 guard 泄漏后误吞同 childId 复活轮的正常 end
      abortExpected.delete(id)
      // 兜底掐断不静默 abort 蒸发记录——按 dropQueuedFailed
      // 同款口径落一条 failed 历史（finish 连带清理其名下求助单），队列解冻
      // 但账上有据；宽限期内正常 end 到达的路径走 finalizeEnd，不会重复落史
      const done = orch.finish(id, `disposed grace-period fallback aborted this record: subagent/end never arrived within ${graceMs}ms`, true)
      if (done?.clearedHelp) notifyClearedHelp(parentId, id, done.clearedHelp)
      // 走 retireChild 而非手删 childOwner：兜底掐断即本儿童的终局，类型侧三张表
      // （活登记/墓碑/备选覆盖）必须同点翻篇。手删 childOwner 会留下滞留的墓碑条目：
      // 真迟到的那条 end 仍能经墓碑认到工种、归到已无活记录的实例上，报出一句
      // 「has no live record; conclusion dropped」——结论其实早已按兜底口径落账，
      // 这条 warn 是无中生有的误报（且墓碑白占容量）。
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
