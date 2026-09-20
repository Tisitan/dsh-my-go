/**
 * dsh-my-go — end 管线（subagent/end dispatcher + 落账收尾 + 失败备选重派 +
 * 报告补发链及其贴身 helper；5.4 波自 broker.mjs 抽出）。
 *
 * 成员与唯一归属：processEnd（归因六件套执行：缓冲闸、取快照、落地 ops、发
 * notices、按 decision 起执行链、按 facts.advance 推进队列——不含业务判定，
 * 决策在 shared/end-attribution.mjs 纯函数）、finalizeEnd（落史 + 失败附因推送
 * + 登记清理 + 快照刷新，**不推进队列**）、attemptFallbackRedeploy（error 终局
 * 的备选链重派主流程）、attemptReportRepair（报告补发链：followupPrompt +
 * queued 投递 + 失败终局回退）与两件贴身 helper readTurnFailure（附因取证
 * live 快路径 → 档案主路径）、pickFallbackEntry（备选条目预检）。
 *
 * 与调度簇（./broker-scheduler.mjs）的双向环用**相互回调注入**解（5.2 波 E2 簇
 * 同手法，5.4 裁决）：dispatchWork 登记同步段的认领重放调本簇 processEnd 尾、
 * 本簇 processEnd 的推进决策点与 attemptFallbackRedeploy / attemptReportRepair
 * 各终局支调调度簇 advanceQueue——两条边都由 broker.mjs 接线时包壳，本模块
 * 零 import 调度簇、零回引 broker.mjs，模块 import 环为零。对外消费面只有
 * processEnd 一件（ctx.on('subagent/end') 注册点留守本体）；finalizeEnd 等其余
 * 成员皆簇内私有（实读无簇外消费点）。
 *
 * persistReportBoard **不在本簇**（5.3 B2 裁定留守 broker.mjs）：它是本体侧的
 * 落板底座，除本簇补发链三处兜底路径外还注入 relay 簇共用——随迁会让 relay
 * 的注入源变成兄弟簇（破坏「簇间零互引」），故以回调形态注入本簇。
 *
 * 依赖注入面（对齐既有九簇范式）：零 ctx（sessions 服务经 getSessions 回调
 * 逐调用现取，与原读 ctx 时点一致）；orchestrations / childRegistry 传活句柄
 * （本簇直接消费 reportSubmitted / repairRetried / promoteFallback /
 * retireChild / retireTypeRecords 与其上挂方法）；调度簇三件（advanceQueue /
 * spawnChild / buildStallNotice）、notify 四件、endbuffer 两件、dispose 一件、
 * delivery 一件、relay 两件（包壳闭包）、capability 的 modelExists、本体的
 * orchOfChild / bump / persistReportBoard 全部显式注入；bindings 经 getBindings
 * 现读；REPORT_EXT / SUBAGENT_PROMPT_MAX 按值注入。纯函数层直引 ../shared/
 * （end-attribution / failure / archive / adjacent / board / misc / report-format）。
 *
 * 卸载口径：本簇无定时器与累积表（补发链与重派链的在飞 promise 与挂载实例
 * 同寿，once-guard 归 childRegistry 管）——无 clear* 需要导出，与 bootstrap
 * 簇同判。
 */

import { normalizeTurnFailure, isFallbackable } from '../shared/failure.mjs'
import { readArchivedTurnFailure } from '../shared/archive.mjs'
import { sessionEvents } from '../shared/adjacent.mjs'
import { agentLabel } from '../shared/misc.mjs'
import { hasBoardEntry } from '../shared/board.mjs'
import { REDISPATCH_RESUME_PREFIX } from '../shared/report-format.mjs'
import { attributeEnd, shouldAdvanceQueue } from '../shared/end-attribution.mjs'

export function createEndingOps({
  childRegistry,
  orchestrations,
  getBindings,
  orchOfChild,
  resolveParentAgent,
  notifyParent,
  notifyOwner,
  notifyClearedHelp,
  bump,
  metrics,
  modelExists,
  advanceQueue,
  spawnChild,
  buildStallNotice,
  cancelDisposeFallback,
  bufferEnd,
  claimBufferedEnd,
  deliverWithQueueFallback,
  relayChainOnEnd,
  resolveChainFallback,
  persistReportBoard,
  getSessions,
  REPORT_EXT,
  SUBAGENT_PROMPT_MAX,
}) {
  const { sessionTypes, disposedTypes, childOwner, pendingFallbackByLabel, abortExpected, fallbackDecided } = childRegistry

  // 失败附因兜底：subagent/end 的通知层载荷只有 stopReason 的 kind，
  // error.message 完整存在于子会话档案的 turn/end reason.error。
  // 0.2.3-tisitan.9：continuable 销毁顺序使 subagent/end 发射晚于 live store 摘除，
  // live 读法（sessions 服务 API）降级为快路径；主路径读持久化档案
  // （readArchivedTurnFailure，多帧 zstd 逐帧解压）。哪边先拿到用哪边。
  function readTurnFailure(childId) {
    try {
      const session = getSessions()?.get?.(childId)
      // alpha.4 起 Session.events getter 删除 → snapshotEvents()（0.3.0-tisitan.4，
      // 共享适配 sessionEvents 特性探测，双版本同跑；坏档/已关闭回落空数组）
      const events = sessionEvents(session)
      if (Array.isArray(events)) {
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'error') {
            const failure = normalizeTurnFailure(ev.data.reason.error)
            if (failure) return failure
          }
        }
      }
    } catch { /* live 快路径失败不挡档案主路径 */ }
    return readArchivedTurnFailure(childId)
  }

  // 从链的 from 索引（含）向后找第一个预检通过的备选条目；缺字段/模型不存在
  // 的条目 console.warn 跳过并继续尝试下一条。返回 { entry, attempt(1-based),
  // total } 或 undefined（无链/链尽/预检全败）。
  async function pickFallbackEntry(type, from) {
    const raw = getBindings()[type]?.fallbacks
    const chain = Array.isArray(raw) ? raw.filter((e) => e && typeof e === 'object') : []
    for (let i = Math.max(from, 0); i < chain.length; i++) {
      const entry = chain[i]
      const provider = typeof entry.provider === 'string' ? entry.provider : ''
      const model = typeof entry.model === 'string' ? entry.model : ''
      if (!provider || !model) {
        console.warn(`[dsh-my-go] fallback: ${type} 备选条目 #${i + 1} 缺 provider/model，跳过`)
        continue
      }
      if (await modelExists(provider, model)) return { entry, attempt: i + 1, total: chain.length }
      console.warn(`[dsh-my-go] fallback: ${type} 备选条目 #${i + 1} 模型校验失败（${provider}/${model}），跳过`)
    }
    return undefined
  }

  // subagent/end 收尾共用：落史 + 失败附因推送 + 登记清理 + 快照刷新。
  // **本函数不推进队列**——0.3.0-tisitan.12 起这条不再是注释协议：推进时机是
  // attributeEnd 返回值里的 facts.advance（'now' / 'no' / 'if-owned'），由 end
  // dispatcher 单点执行（R3/R4）。重派成功路径占槽不推进，也走同一个决策点。
  function finalizeEnd(orch, ownerPid, type, childId, conclusion, failed, failure) {
    const done = orch.finish(childId, conclusion, failed)
    if (done?.clearedHelp) notifyClearedHelp(ownerPid, childId, done.clearedHelp)
    if (failed && failure) {
      // 失败附因推送：harness 的 settled 通知只带 stopReason，补一行完整原因
      notifyOwner(ownerPid, `[dsh-my-go] 子代理失败: ${childId} (${type}): ${failure.message} [${failure.code ?? 'UNKNOWN'}]`)
    }
    if (!done) {
      // 有类型登记但台账无活记录（如已被 disposed 兜底清槽）：结论无处安放，留痕
      console.warn(`[dsh-my-go] subagent/end for child ${String(childId)} (${type}) has no live record; conclusion dropped`)
    }
    childRegistry.retireChild(childId)
    bump()
    return done
  }

  // 备选重派主流程（error 终局且 once-guard 首触时由 subagent/end 决策点调用）。
  // 语义：同 prompt、同 parent（原 Sisyphus 会话）、同 agentType；agentOptions
  // 覆盖为备选条目 {provider, model}；不入队、不占新槽位——原条目先落史（附因
  // 保留 + [备选 n/m] 标注），随即在同一流水线内占位换键重派。attempt 严格
  // 递增（新记录 fallbackAttempt=attempt，下次决策从该索引起找）而链长有限
  // ⇒ 必然终止，绝无无限循环。
  //
  // 链 × 备选链的感知点（三期 3.4，D10/T11/T12；本体在 ./broker-relay.mjs 的
  // resolveChainFallback，接线在 broker 侧）：pending-fallback 态的链按亡棒
  // childId 精确查找，评估终局喂给状态机（重派成功 → 换绑挂起等裁决；失败落账 →
  // 链 failed）。非链棒（绝大多数）查不到链，零开销直落。
  async function attemptFallbackRedeploy({ orch, ownerPid, type, childId, failure, baseConclusion, failureLine }) {
    // 分类器否决（abort/dispose/用户中断特征）绝不重派，走既有失败路径
    if (!isFallbackable(failure)) {
      console.warn(`[dsh-my-go] fallback: ${String(childId)} 附因属 abort/dispose 类，分类器否决重派，按失败终局处理 (${type})`)
      finalizeEnd(orch, ownerPid, type, childId, `${baseConclusion}${failureLine}`, true, failure)
      // 链感知（T12）：评估终局为失败落账，链 failed（§四 E6 格）
      resolveChainFallback(orch, childId, { type: 'fallback-failed', reason: '附因属中断类，不重派' })
      // 终局显式通知（0.2.3-tisitan.18）：评估中预告之后必有终局口径到达，
      // 主流程据此解除静默等待、进入自己的失败处置
      notifyOwner(ownerPid, `[dsh-my-go] 失败终局: ${childId} (${type}) 附因属中断类，不重派，按失败终局落账`)
      advanceQueue(orch)
      return
    }
    const record = orch.record(childId)
    const prompt = typeof record?.prompt === 'string' ? record.prompt : ''
    const parent = resolveParentAgent(ownerPid)
    if (!prompt || !parent) {
      console.warn(`[dsh-my-go] fallback: ${String(childId)} 无法重派（${!prompt ? '编排记录缺原始 prompt' : `父会话 ${String(ownerPid)} 已不在注册表`}），按失败终局处理 (${type})`)
      finalizeEnd(orch, ownerPid, type, childId, `${baseConclusion}${failureLine}`, true, failure)
      resolveChainFallback(orch, childId, { type: 'fallback-failed', reason: '无法重派（缺编排记录或父会话）' })
      // 终局显式通知（0.2.3-tisitan.18）：同终局口径
      notifyOwner(ownerPid, `[dsh-my-go] 失败终局: ${childId} (${type}) 无法重派（${!prompt ? '编排记录缺原始 prompt' : '父会话已不在注册表'}），按失败终局落账`)
      advanceQueue(orch)
      return
    }
    const from = record?.fallbackAttempt ?? 0
    const picked = await pickFallbackEntry(type, from)
    if (!picked) {
      // 无链/链尽/备选预检全败：既有失败历史路径不变（附因保留）
      finalizeEnd(orch, ownerPid, type, childId, `${baseConclusion}${failureLine}`, true, failure)
      resolveChainFallback(orch, childId, { type: 'fallback-failed', reason: '备选链尽' })
      // 终局显式通知（0.2.3-tisitan.18）
      notifyOwner(ownerPid, `[dsh-my-go] 失败终局: ${childId} (${type}) 备选链尽，按失败终局落账`)
      advanceQueue(orch)
      return
    }
    const { entry, attempt, total } = picked
    if (!failure) {
      // errorInfo 缺失（档案/live 均未读到附因）+ 有链：保守切换，日志注明措辞
      console.warn(`[dsh-my-go] fallback: ${String(childId)} 未读到附因，保守切换备选 [${attempt}/${total}] ${entry.provider}/${entry.model} (${type})`)
    }
    // 同步段（finish → beginSpawning 之间无 await）：原条目先落史后占位。
    // 双发 end 的第二发在 finish 之后只能命中「迟到/重复」分支，绝不双落账；
    // disposed 宽限兜底 timer 已在 end 入口取消，不会误 abort 新占位。
    const done = orch.finish(childId, `${baseConclusion}${failureLine}\n[备选 ${attempt}/${total}] 失败 → 自动切换备选 ${entry.provider}/${entry.model} 重派`, true)
    if (!done) {
      console.warn(`[dsh-my-go] fallback: ${String(childId)} 落史失败（无活记录），放弃重派 (${type})`)
      bump()
      advanceQueue(orch)
      return
    }
    if (done.clearedHelp) notifyClearedHelp(ownerPid, childId, done.clearedHelp)
    childRegistry.retireChild(childId)
    // fallbackEntry 与 fallbackAttempt 同点入账（0.2.3-tisitan.17）：备选条目本体随
    // 编排记录走 finish→history→台账落盘全链路，供复活时重建 activeFallback；
    // 链上下一跳重派时新占位记录携带新条目，天然覆盖上一跳。
    // fallbackLabel 提到 try 外声明（与 request.label 同源同值）：spawn 失败
    // 的 catch 块看不到 try 内的 request，清理必须依赖外层作用域的 label。
    // R2.3 复合键（二期 2.4，read-pool-semantics.md §5.1）：label 内嵌 spawnToken
    // （占位 id）——resolve 前窗口的 waterfall 覆盖查询键 = header.label（=
    // request.label 落盘镜像），token 使并发同工种同 prompt 的双重派各自精确
    // 命中自己的 pending 条目；旧裸 label 键在并行下后写覆盖先写 = 备选配置串号。
    const placeholder = orch.beginSpawning(type, prompt, {
      fallbackAttempt: attempt,
      fallbackEntry: { provider: entry.provider, model: entry.model },
    })
    const fallbackLabel = `${agentLabel(type, prompt.slice(0, SUBAGENT_PROMPT_MAX))}#${placeholder.childId}`
    try {
      // agentOptions 覆盖为备选条目（provider/model 均已过 pickFallbackEntry 预检）；
      // persona/toolFilter 与 dispatchWork 同源（bindings[type] + prompts 链），
      // 重派 = 同角色换脑重新上岗。
      // spawn 前登记 pending 备选（棒2-Z2）：覆盖 startContinuable resolve
      // 之前 waterfall 只能靠 label 识别工种的窗口
      pendingFallbackByLabel.set(fallbackLabel, { provider: entry.provider, model: entry.model })
      // 恢复前缀注入（A1）：仅本重派分支把 REDISPATCH_RESUME_PREFIX 拼进
      // prompt[0] 头部——首发路径（dispatchWork）走同一 spawnChild 但不经此
      // 拼接，一个字都不加。record.prompt 存的仍是原文（beginSpawning 在上
      // 方用未拼接的 prompt 入账），链上下一跳重派逐次现拼，前缀不累积。
      const newChildId = await spawnChild({
        agentType: type,
        prompt: `${REDISPATCH_RESUME_PREFIX}\n${prompt}`,
        parent,
        label: fallbackLabel,
        agentOptions: { provider: entry.provider, model: entry.model },
        toolFilter: getBindings()[type]?.toolFilter,
        sig: new AbortController().signal,
      })
      // resolve 成功：撤临时登记 + 工种活登记 + 备选覆盖转正三步同点（含换键前
      // 旧 childId 的清理已在同步段做过），waterfall 运行期重绑据此保持备选
      // provider/model 不回跳主模型（spawn 的 agentOptions 只管首帧配置）
      childRegistry.promoteFallback({ label: fallbackLabel, childId: newChildId, type, entry: { provider: entry.provider, model: entry.model } })
      orch.bindChild(placeholder.childId, newChildId)
      childOwner.set(newChildId, parent.id)
      bump()
      // 链感知（T11/D10）：重派成功 → 链换绑新世代并挂起等裁决。插点同律于
      // dispatchWork 的回填契约：换绑先于下方 E2 认领——重放的 end 查链时
      // state 已是 suspended（不命中 running 匹配），无双推进面。
      resolveChainFallback(orch, childId, { type: 'fallback-redeployed', newChildId })
      // E2 缓冲认领点（二期 2.4，方案 A）：重派 spawn 也可能被抢跑 end——登记
      // （promoteFallback/bindChild/childOwner）落地后同步认领重放，与直派同律。
      const bufferedReplay = claimBufferedEnd(newChildId)
      if (bufferedReplay !== undefined) processEnd(bufferedReplay)
      // 面板/台账/通知全部指向原父会话（多会话隔离：orch 全程为原实例）
      notifyParent(parent, `[dsh-my-go] 备选重派: ${String(childId)} → ${newChildId} (${type}) [备选 ${attempt}/${total}] ${entry.provider}/${entry.model}${failure ? `：${failure.message}` : '（未读到附因，保守切换）'}`)
      // 不 advanceQueue：新 child 已在原槽位语义内运行，队列保持原状
    } catch (error) {
      // spawn 失败：pending 登记同步清理（棒2-Z2 清理路径），不留悬空覆盖
      pendingFallbackByLabel.delete(fallbackLabel)
      orch.abort(placeholder.childId)
      bump()
      console.error(`[dsh-my-go] fallback 重派 spawn 失败（${entry.provider}/${entry.model}），按失败终局回退:`, error)
      resolveChainFallback(orch, childId, { type: 'fallback-failed', reason: `备选重派 spawn 失败（${entry.provider}/${entry.model}）` })
      notifyParent(parent, `[dsh-my-go] 备选重派 spawn 失败（${entry.provider}/${entry.model}）：${String(childId)} 已按失败落账，队列已推进`)
      // 槽位已腾出：立即推进队首（0.2.3-tisitan.6 教训：清槽动作必须推进队列）
      advanceQueue(orch, parent)
    }
  }

  // ── 报告补发链（报告提交制，0.5.0-tisitan.1）────────────────────────────────
  // 前提：report-gate-repair 决策**不 finish**——记录留在 currentMap 实体占槽
  // （「补发期间槽位仍占」的实体化），repairRetried 已在同步段登记（防无限循环：
  // 本链不走 rearmChild，guard 存续到补发轮 end 的转裁决）。本链只做：台账照记
  // 补发 prompt（followupPrompt，固定措辞点名补交四字段）→ queued 档投递（coldResume
  // 唤醒已 settle 的子会话，D4 裁决）；投递失败兜底按「未交付（补发投递失败）」
  // 落账转裁决 + advanceQueue 解冻（仿 attemptFallbackRedeploy catch 失败终局回退
  // ——绝不留终局真空）。
  async function attemptReportRepair({ orch, ownerPid, type, childId, fullText, repairPrompt }) {
    const parent = resolveParentAgent(ownerPid)
    const fallbackConclusion = `未交付（补发投递失败）：${typeof fullText === 'string' && fullText !== '' ? fullText : '(无正文)'}`
    if (!parent || !orch) {
      console.warn(`[dsh-my-go] 报告补发无法投递 (${childId}): ${!parent ? `父会话 ${String(ownerPid)} 已不在注册表` : '编排实例缺失'}；按未交付落账转主编裁决`)
      notifyOwner(ownerPid, `[dsh-my-go] 报告补发投递失败: ${childId}，已按「未交付（补发投递失败）」落账，请主编裁决`)
      metrics.record({ kind: 'report-gate', phase: 'repair-failed', childId, sessionId: ownerPid ?? null })
      // verdict 落账路径补落板（三期 3.5 移交②）：此前此路全文从未落板——
      // gate-verdict 挂起后主编「带病续链」的直投读板会扑空（input-missing 误挂）。
      // 幂等（report_submit 已落则跳过），fire-and-forget 不改终局时序。
      void persistReportBoard(ownerPid, childId, fullText)
      finalizeEnd(orch, ownerPid, type, childId, fallbackConclusion, false, undefined)
      relayChainOnEnd(orch, ownerPid, childId, { endDecision: 'finalize', failed: false, reportGatePhase: 'verdict', conclusionExcerpt: fallbackConclusion, fullText })
      advanceQueue(orch)
      return
    }
    orch.followupPrompt(childId, repairPrompt)
    bump()
    try {
      await deliverWithQueueFallback({ parent, targetId: childId, prompt: repairPrompt, signal: new AbortController().signal, label: 'report-repair' })
    } catch (error) {
      console.warn(`[dsh-my-go] 报告补发投递失败 (${childId}): ${String(error)}；按未交付落账转主编裁决`)
      notifyOwner(ownerPid, `[dsh-my-go] 报告补发投递失败: ${childId}，已按「未交付（补发投递失败）」落账，请主编裁决`)
      metrics.record({ kind: 'report-gate', phase: 'repair-failed', childId, sessionId: ownerPid ?? null })
      void persistReportBoard(ownerPid, childId, fullText)
      finalizeEnd(orch, ownerPid, type, childId, fallbackConclusion, false, undefined)
      relayChainOnEnd(orch, ownerPid, childId, { endDecision: 'finalize', failed: false, reportGatePhase: 'verdict', conclusionExcerpt: fallbackConclusion, fullText })
      advanceQueue(orch)
      return
    }
    notifyOwner(ownerPid, `[dsh-my-go] 报告补发已投递: ${childId}（queued），等待补交轮终局`)
    // 投递成功：补交轮自己的 end 会再进闸门（reportSubmitted 已登记 → 合成回执直通 /
    // 仍未提交转裁决），本链到此结束。
  }

  // ── subagent/end dispatcher（B5：决策在 shared/end-attribution.mjs，本处只执行）──
  // 归因链的九条决策与三条协议（同步段零 await / 推进时机显式 / guard 消费可见）
  // 都在那个纯函数里，改动前先读它的文件头注释。本处职责只有六件：缓冲闸、取
  // 快照、落地 ops、发 notices、按 decision 起执行链、按 facts.advance 推进队列
  // ——不含业务判定。主体抽成 processEnd 以便缓冲认领后重入（方案 A 重放）。
  function processEnd(info) {
    const childId = info?.id
    // end 到达即取消 disposed 宽限期兜底——正常完工路径上兜底定时器必然在挂着。
    // 无 id 的载荷在表上没有键，自撤是幂等空转，故这一步无条件执行。
    cancelDisposeFallback(childId)
    // ★ 缓冲闸（方案 A）：类型登记与台账双双缺席 = 登记未就绪 ⇒ 暂存待认领，
    //   绝不猜测归因（占位归因兜底已退役，见 end-attribution.mjs E2 收窄注释）。
    //   条件与 attributeEnd 的 E2 前置严格一致：type 取证（活登记 ?? 墓碑）失败
    //   且属主实例台账（currentMap + history）无记录。
    if (childId) {
      const typeSeen = sessionTypes.has(childId) || disposedTypes.has(childId)
      if (!typeSeen) {
        const ledgerHit = orchOfChild(childId)?.orch?.record(childId)
        if (!ledgerHit) {
          bufferEnd(childId, info)
          return
        }
      }
    }
    // 快照只读：类型取证顺序（活登记 → 墓碑 → 编排台账）与属主路由（childOwner
    // 直达 → 全实例 record 扫描兜底）沿用原实现；写一律走 ops 由下面按序落地。
    const routed = childId ? orchOfChild(childId) : undefined
    const routedOrch = routed?.orch
    const { decision, ops, notices, facts } = attributeEnd({
      childId,
      info,
      routing: routed ? { parentId: routed.parentId } : undefined,
      type: sessionTypes.get(childId) ?? disposedTypes.get(childId),
      ledgerRecord: routedOrch?.record(childId),
      hasLiveRecord: (id) => (routedOrch ? routedOrch.currentMap.has(id) : false),
      abortExpected: (id) => abortExpected.has(id),
      fallbackDecided: (id) => fallbackDecided.has(id),
      bindings: getBindings(),
      readFailure: (id) => readTurnFailure(id),
      // 报告提交制闸门：开关关传 null = 现路径零变化；已提交判定与字段读取走
      // childRegistry.reportSubmitted（report_submit 校验过即登记），补发授权
      // 走 childRegistry.repairRetried（once-guard，同步段 op 落地）。
      // hasBoard = 报告板兜底（表为快路径、板为准）：内存登记会随进程重启/冷恢复
      // 清零，而全文在板上是持久的——只查表会把交过的儿童判成从未提交并发射补发。
      // 每 end 至多一枚 existsSync（同步段零 await 不破：它是同步调用，不是 await）。
      reportGate: REPORT_EXT ? {
        enabled: true,
        reportSubmitted: (id) => childRegistry.reportSubmitted.has(id),
        readSubmitted: (id) => childRegistry.reportSubmitted.get(id),
        repairRetried: (id) => childRegistry.repairRetried.has(id),
        hasBoard: () => (routed?.parentId ? hasBoardEntry(routed.parentId, childId) : false),
      } : null,
    })
    const ownerPid = facts.ownerPid
    const orch = ownerPid === undefined ? undefined : orchestrations.get(ownerPid)
    // 留痕在 ops 之前：E3（no-owning-orchestration）原本就是先 warn 再清登记，
    // 反过来写会变成「先删证据再报案」。
    if (facts.warn) console.warn(`[dsh-my-go] ${facts.warn}`)
    for (const op of ops) {
      switch (op.op) {
        case 'consume-abort-guard':
          abortExpected.delete(op.childId)
          break
        case 'add-fallback-guard':
          fallbackDecided.add(op.childId)
          break
        case 'add-repair-guard':
          // 1.5 报告补发 once-guard：同步段第一时间落地（协议第 1 条），此后本
          // 轮的任何 end 都会在闸门判到「已补发过」→ 转裁决，绝不二次补发。
          childRegistry.repairRetried.add(op.childId)
          break
        case 'retire-type-records':
          childRegistry.retireTypeRecords(op.childId)
          break
        default:
          console.warn(`[dsh-my-go] subagent/end: 未知归因 op ${String(op.op)}（决策表与执行表脱节，请修）`)
      }
    }
    for (const notice of notices) {
      if (notice.target === 'log') console.warn(notice.text)
      else notifyOwner(notice.parentId, notice.text)
    }
    if (decision === 'fallback-evaluation') {
      // ops（fallbackDecided.add）与 notices（评估中预告）都已在同步段落地，异步
      // 重派链**必须**是本决策点的最后一件事——协议第 1 条（0.3.0-tisitan.18）。
      void attemptFallbackRedeploy({
        orch,
        ownerPid,
        type: facts.type,
        childId,
        failure: facts.failure,
        baseConclusion: facts.baseConclusion,
        failureLine: facts.failureLine,
      }).catch((error) => {
        console.error('[dsh-my-go] fallback 重派流程异常，回退失败落账:', error)
        finalizeEnd(orch, ownerPid, facts.type, childId, `${facts.baseConclusion}${facts.failureLine}`, true, facts.failure)
        advanceQueue(orch)
      })
    } else if (decision === 'suspended-help-hold') {
      // T1 挂起瞬间的停摆通报（本批）。E8 是静默出口：不落史、不腾槽、不推进，
      // 于是「槽位被一个等处置的子代占着」在主编那边完全没有回声——队列里有货
      // 才说明这真是一次停摆（有任务在等一个永不到来的推进事件），此时经
      // notifyParent 推一行非唤醒通知补齐可见性；队列空则零通知，与 E8 原口径
      // （主编手里已有那张求助单）逐字节一致。队列长度在 dispatcher 侧取：
      // attributeEnd 保持纯函数零改动，队列状态本就归调度核管（buildStallNotice
      // 经注入取自调度簇，与 T2 共用同一份文案与同一枚 episode 守卫）。
      const stallNotice = buildStallNotice(orch, orch?.currentMap.get(childId))
      if (stallNotice) notifyOwner(ownerPid, stallNotice)
    } else if (decision === 'finalize') {
      // 埋点（0.4.0-tisitan.0）：终局落账基线——报告大小分布（conclusionBytes）、
      // 子代运行时长（runMs，spawning 占位起算到 end）。record 在 finalizeEnd 之前
      // 取（finish 挪史不影响，取的是同一份 createdAt）；无记录时 runMs 缺席如实。
      const endRecord = orch?.record(childId)
      metrics.record({
        kind: 'end',
        childId,
        agentType: facts.type,
        lane: facts.lane,
        stopReason: info?.stopReason,
        conclusionBytes: facts.conclusion.length,
        ...(endRecord ? { runMs: Date.now() - endRecord.createdAt } : {}),
      })
      // 报告提交制终局口径（0.5.0-tisitan.1）：pass（回执内芯 = 合成概要，全文已
      // 随 report_submit 落板）与 verdict（补发后仍未提交，转主编裁决）都记
      // report-gate 事件供观测。D2 阈值反馈环原料：report-gate 事件按 phase 记。
      if (facts.reportGate) {
        metrics.record({
          kind: 'report-gate',
          phase: facts.reportGate.phase,
          childId,
          sessionId: ownerPid ?? null,
        })
        if (facts.reportGate.phase === 'verdict') {
          notifyOwner(ownerPid, `[dsh-my-go] 报告闸门终局: ${childId} 补发后仍未提交报告，已按「未交付」落账，请主编裁决`)
        }
      }
      // 无活记录时 finalizeEnd 已留痕；队列仍照常推进，绝不静默停摆
      finalizeEnd(orch, ownerPid, facts.type, childId, facts.conclusion, facts.failed, facts.failure)
    } else if (decision === 'report-gate-repair') {
      // 报告补发链（提交制）：guard op 与预告已在同步段落地（协议第 1 条），
      // 异步补发链必须是本决策点的最后一件事。不 finish 不 revive——记录留在
      // currentMap 实体占槽，本链只投 followup（详见 attemptReportRepair 头注释）。
      metrics.record({
        kind: 'report-gate',
        phase: 'repair',
        childId,
        sessionId: ownerPid ?? null,
      })
      void attemptReportRepair({
        orch,
        ownerPid,
        type: facts.type,
        childId,
        fullText: facts.reportFullText,
        repairPrompt: facts.repairPrompt,
      }).catch((error) => {
        console.error('[dsh-my-go] 报告补发链异常，回退转裁决落账:', error)
        const fallbackText = typeof facts.reportFullText === 'string' && facts.reportFullText !== '' ? facts.reportFullText : '(无正文)'
        // 移交②同律：verdict 落账前落板兜底（幂等），带病续链的直投有板可读
        void persistReportBoard(ownerPid, childId, facts.reportFullText)
        finalizeEnd(orch, ownerPid, facts.type, childId, `未交付（补发投递失败）：${fallbackText}`, false, undefined)
        relayChainOnEnd(orch, ownerPid, childId, { endDecision: 'finalize', failed: false, reportGatePhase: 'verdict', conclusionExcerpt: fallbackText, fullText: facts.reportFullText })
        advanceQueue(orch)
      })
    }
    // ── 链匹配回调（三期 3.4，§四矩阵：归因之后、推进决策点之前）──────────────
    // 先匹配后决策（协议第 1 条）：hopChildId 精确命中才轮到链轴，链绝不改写
    // 归因结论。同步段（决策 + patch + notices）零 await；enqueue-hop 的直投
    // 落地是 void 异步链且必须是本决策点最后一件事（协议第 1 条同律）——它
    // 自带入队 + advanceQueue，故此处末尾的队列推进决策点照旧无扰。
    if (childId && orch) {
      relayChainOnEnd(orch, ownerPid, childId, {
        endDecision: decision,
        failed: facts.failed === true,
        reportGatePhase: facts.reportGate?.phase,
        conclusionExcerpt: typeof facts.conclusion === 'string' ? facts.conclusion : '',
        fullText: facts.reportGate?.fullText,
      })
    }
    // 推进队列的唯一决策点（协议第 2 条）：finalizeEnd 自己不推进、重派各终局分支
    // 自己推进，都在这里之外——时机由 attributeEnd 的 facts.advance 决定。
    if (shouldAdvanceQueue(facts, { hasOwningOrch: orch !== undefined })) advanceQueue(orch)
  }

  return { processEnd }
}
