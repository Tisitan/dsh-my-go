/**
 * dsh-my-go — model/effort 能力缓存（request waterfall 的能力判定面；
 * 5.1 波自 broker.mjs 抽出）。
 *
 * reasoningEffort follows the DSH model catalog: some models have no
 * thinking levels, others expose a different set (off/high/max, low, etc.).
 * We only ever set an effort the exact model actually supports; when the
 * configured effort is unsupported (or the model exposes none), we leave
 * the field unset so the adapter's default behavior applies — never hard-map
 * or clamp, which would reject or silently alter the request.
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：零 ctx——
 * llm 服务经 getLlm 回调注入，modelCache 注入的是 childRegistry.modelCache
 * 这同一枚 Map 句柄（本体仍住 child-registry，随 settings/updated 热更整体
 * 清空；此处绝不复制）。
 *
 * 形态：createCapabilityOps({ getLlm, modelCache }) → { supportedEfforts,
 * modelExists, invalidateCaches }。
 *   - effortCache 本体与 modelCacheEpoch 归本模块持有；两者都必须在 broker
 *     apply 的 settings 块之前就位（N9/N10 时序说明）——本 apply 中段有 await
 *     （loadLedger），settings/updated 若恰好在窗口里到达，处理器按尾部落在
 *     的 const 取值会撞 TDZ；缓存本体与失效计数都必须在处理器定义之前就位，
 *     失效入口即 invalidateCaches。
 *   - invalidateCaches：settings/updated 的同点失效三连（modelCache.clear +
 *     epoch 自增 + effortCache.clear），顺序与语义与拆分前逐行一致。
 */

export function createCapabilityOps({ getLlm, modelCache }) {
  // supportedEfforts 沿用拆分前的「创建期捕获一次」语义（原 const llm =
  // ctx.get('llm') 在 agent/request 段解析一次后闭包持有）；modelExists 则
  // 保持逐调用现取（原函数体内 ctx.get('llm')）——两处读取时点与拆分前一致。
  const llm = getLlm()
  const effortCache = new Map() // `${provider}/${model}` -> Set<effortId>（只存非 null 成功结果）
  let modelCacheEpoch = 0 // settings/updated 时 +1：在飞的 listModels 响应据此作废
  async function supportedEfforts(provider, model) {
    const key = `${provider}/${model}`
    const cached = effortCache.get(key)
    if (cached !== undefined) return cached
    let result = null // null = unknown (leave effort unset)
    let resolved = false
    try {
      if (llm && typeof llm.resolveModelInfo === 'function') {
        const info = await llm.resolveModelInfo(provider, model)
        resolved = true
        const efforts = info?.reasoning?.efforts
        if (Array.isArray(efforts) && efforts.length > 0) {
          result = new Set(efforts.map((e) => String(e?.id)))
        }
      }
    } catch {
      // Capability lookup must never break the request; unknown → leave unset.
    }
    // 只缓存查询成功的结果：瞬时失败/服务缺席不永久缓存（负缓存会让
    // effort 绑定在本进程生命周期内静默失效），留待下次请求重试。
    // null 也是「未知」而非结论（0.3.0-tisitan.7 N10）：模型不暴露档位与「这次没读到
    // 档位」在返回值上同形，当真值缓存下去就成了永久的「不支持 effort」——
    // 于是宁可每次请求多一次 resolveModelInfo，也不替用户把绑定判死。
    if (resolved && result !== null) effortCache.set(key, result)
    return result
  }

  // ── model validation ─────────────────────────────────────────────────
  // 缓存本体在 childRegistry.modelCache（随 settings/updated 热更整体清空）。
  async function modelExists(provider, model) {
    const key = String(provider)
    let set = modelCache.get(key)
    if (set === undefined) {
      const epoch = modelCacheEpoch
      set = new Set()
      let listed = false
      try {
        const llm = getLlm()
        if (llm) {
          const list = await llm.listModels(key)
          for (const m of list) set.add(m.id)
          listed = true
        }
      } catch { /* provider may not support listing */ }
      // 区分两种「清单为空」（0.3.0-tisitan.7 N9）：列举**成功**但里面没有绑定的模型
      // 是真结论，缓存它（含空集）——否则每次模型请求都对同一个坏 provider 重
      // 拉一遍清单；抛错/服务缺席是「不知道」，不缓存，留待下次重试。
      // epoch 比对挡在飞响应：本函数 await 期间若发生 settings/updated，那次
      // 陈旧清单不得回写（回写等于把刚清掉的缓存原样塞回去，热更失效无声撤销）。
      // 无论回写与否，本次请求仍按已读到的结果作答——语义与旧实现一致。
      if (listed && modelCacheEpoch === epoch) modelCache.set(key, set)
    }
    return set.has(String(model))
  }

  // settings/updated 同点失效三连（注释细节见 broker.mjs settings 块的接线点）：
  // modelCache 根治（0.3.0-tisitan.4）→ provider 模型清单缓存随绑定热更失效；
  // epoch 同点自增（0.3.0-tisitan.7 N9）→ clear 只清已落账的条目，清不掉此刻
  // 正在飞的 listModels，不回查就会让那次陈旧响应把旧清单又塞回来；effortCache
  // 同点失效（N10）→ 它此前无清理点，一次 resolveModelInfo 的结果在本进程内
  // 永挂。三连顺序与拆分前逐行一致。
  function invalidateCaches() {
    modelCache.clear()
    modelCacheEpoch += 1
    effortCache.clear()
  }

  return { supportedEfforts, modelExists, invalidateCaches }
}
