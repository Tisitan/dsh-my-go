/**
 * dsh-my-go — 子代理进程内登记表（健康度批自 broker.mjs 抽出，语义零变化）。
 *
 * 八张表都是「派生事件之间的桥接状态」，不是编排事实本体（事实在
 * shared/orchestration.mjs 的流水线与台账里）：
 *   sessionTypes           childId → 工种（活登记；不持久化，冷恢复后靠 label 兜底）
 *   disposedTypes          墓碑：agent/disposed 恒先于 subagent/end，晚到的 end 靠它认工种
 *   childOwner             childId → 属主编排会话 id（子代理侧事件的回路由）
 *   activeFallback         childId → 备选 {provider, model}（waterfall 不回跳主模型）
 *   pendingFallbackByLabel label → 备选条目（spawn resolve 前的窗口，棒2-Z2）
 *   abortExpected          urgency=abort 掐断护航（预期 end 一次性消费，复活即清）
 *   fallbackDecided        备选评估 once-guard（同 childId 每代际只决策一次）
 *   modelCache             provider → 模型 id 集合（只缓存「列举成功」的清单，含空集）
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
  const modelCache = new Map()

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

  /** end 收尾 / 重派换键：工种 + 墓碑 + 备选覆盖 + 属主路由四张表一起翻篇。 */
  function retireChild(id) {
    sessionTypes.delete(id)
    disposedTypes.delete(id)
    activeFallback.delete(id)
    childOwner.delete(id)
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
  }

  /**
   * waterfall 消费点：childId 永久覆盖优先，未命中回退 label 临时登记（棒2-Z2）。
   * 两者的优先级就是时序：spawn resolve 前只有 label 可用。
   */
  function fallbackOverrideFor(childId, label) {
    return activeFallback.get(childId) ?? pendingFallbackByLabel.get(label)
  }

  /**
   * 重派两段式登记的第二步（棒2-Z2 的另一半）：撤临时 label 登记、工种活登记、
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
   * 属主路由（0.2.3-tisitan.17）——fallbackEntry 随台账落盘，cold-resume 后不回填则
   * waterfall 把备选静默回跳成主模型；属主不回填则再次 end 时路由不回本实例。
   * entry 畸形（缺 provider/model）视同无覆盖。
   *
   * 复活即**新世代**（0.3.0-tisitan.7 N5）：两张一次性表同点清零。`fallbackDecided`
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
    sessionTypes.set(childId, record.agentType)
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
    modelCache,
    tombstoneType,
    retireChild,
    retireTypeRecords,
    fallbackOverrideFor,
    promoteFallback,
    rearmChild,
  }
}
