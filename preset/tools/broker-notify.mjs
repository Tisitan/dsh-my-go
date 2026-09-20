/**
 * dsh-my-go — 父会话补充通知（0.2.3-tisitan.8 起本体；5.1 波自 broker.mjs 抽出）。
 *
 * harness 的双通知（reported/settled）是 dsh-subagent 硬编码模板，插件无法
 * 抑制或改写；但 broker 可经 harness 公开 API（parent.inject，见
 * dsh-subagent notifySettlement 的用法）向父会话注入自己的一行短通知。
 * 选用非唤醒的 inject：两条通知都伴随既有的唤醒事件（settled notice /
 * Sisyphus 下一回合），不额外打断父会话。注入失败静默兜底，绝不阻塞派发。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：零 ctx、
 * 零 import——agents 注册表的读取（getAgents 回调）与观测埋点（metrics，
 * broker.mjs 的 createMetrics 实例）由 apply() 显式注入。
 *
 * 形态：createNotifyOps({ getAgents, metrics }) → { notifyParent,
 * resolveParentAgent, notifyOwner, notifyClearedHelp }。
 */

export function createNotifyOps({ getAgents, metrics }) {
  function notifyParent(parent, text) {
    try {
      if (!parent || typeof parent.inject !== 'function') return
      parent.inject({
        id: `mygo-notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-my-go',
          form: 'notice',
          summary: text.length <= 120 ? text : `${text.slice(0, 119)}…`,
        },
      })
      // 埋点（0.4.0-tisitan.0）：主编上下文增长的代理指标——插件自己注入了多少
      // 字节（notifyOwner 转调本函数，单点即全集；内核 notifySettlement 全文注入
      // 不可拦，不在本观测面内）。inject 同步受理成功才计。
      metrics.record({ kind: 'inject', bytes: text.length })
    } catch { /* 父会话已销毁/注入被拒：静默兜底 */ }
  }
  function resolveParentAgent(parentId) {
    const agents = getAgents()
    return parentId ? agents?.get?.(parentId) : undefined
  }
  // 属主 pid → 通知的一站式快捷（end 归因链上的通知点都只握着 ownerPid）：
  // resolveParentAgent 查不到活实例时静默返回 undefined，notifyParent 随之
  // no-op——与「先查再发」的两步写法完全同语义，只是不让九处调用点各写一遍。
  function notifyOwner(parentId, text) {
    notifyParent(resolveParentAgent(parentId), text)
  }
  // 完工连带清理求助单的可观测性（0.3.0-tisitan.3）：子代理结束（正常/失败/兜底
  // 掐断）时其名下未处置求助单被 finish 连带清理——清掉 ≥1 张必须可见，
  // console.warn 留痕 + notifyParent 二次触达（need_help 上报失败同款模式）。
  function notifyClearedHelp(ownerPid, childId, count) {
    console.warn(`[dsh-my-go] subagent ${String(childId)} finished: ${count} pending help request(s) cleared along with it`)
    notifyOwner(ownerPid, `[dsh-my-go] 子代理 ${String(childId)} 完工，其名下 ${count} 张未处置求助单已连带清理`)
  }
  return { notifyParent, resolveParentAgent, notifyOwner, notifyClearedHelp }
}
