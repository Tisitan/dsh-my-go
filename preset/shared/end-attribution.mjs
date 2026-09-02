/**
 * dsh-my-go — subagent/end 归因决策（0.3.0-tisitan.12，棒② B5 自 broker.mjs 抽出）。
 *
 * 「一条 end 事件该归到谁头上、归完之后做什么」是 broker 里分支最密的一段：八个
 * 控制出口，每个都牵动一次性表（abortExpected / fallbackDecided）、登记清理
 * （retireChild / retireTypeRecords）、通知协议（同步预告）与队列推进时机。这些
 * 判断本身不需要 ctx、不需要 I/O、不认识任何 harness 符号——原实现却把决策和执行
 * （inject / spawn / advanceQueue / bump）混在一个 130 行的事件回调里，于是「决策
 * 正确性」只能靠起一整套 ctx 替身才能验证，改一个分支要连替身一起改。
 *
 * 本模块把决策抽成纯函数：输入是**已经取好的状态快照与只读谓词**，输出是
 * `{ decision, ops, notices, facts }`：
 *   decision  八个出口之一（见 DECISIONS）
 *   ops       要改哪些表（由 dispatcher 按序落地；本模块不持有任何一张表）
 *   notices   要对谁说哪一句话（target: 'owner' 注入属主 / 'log' 留痕）
 *   facts     执行所需事实（归因到的 parentId、工种、结论文本、失败附因、advance）
 *
 * **调用方协议（改动前必读，三条都是实战批留下的规矩）**：
 *  1. **同步段零 await**（0.3.0-tisitan.18）：decision === 'fallback-evaluation' 时，
 *     dispatcher 落地 ops（`fallbackDecided.add`）之后的**第一件事必须是发 notices**，
 *     之后才可以 `void` 起异步重派链。add 与预告之间插一个 await，就等于把「主流程
 *     在备选评估真空期自行报死」那个原 bug 请回来。
 *  2. **推进队列的时机是决策的一部分**（R3/R4）：`finalizeEnd` 自己不推进队列（这条
 *     注释协议一直在，但只靠注释），现在由 `facts.advance` 显式回答「槽位还占不占」：
 *     'now' 立即推进 / 'no' 绝不推进 / 'if-owned' 仅当已知属主时推进。新增决策却
 *     没在 DECISION_ADVANCE 里登记 → dispatcher 拿到 undefined 并 warn（宁可不动，
 *     也不猜「推进」把还在跑的那一轮的槽位提前腾掉）。
 *  3. **guard 消费要看得见**：`abortExpected` 的 delete 无论 stopReason 是什么都
 *     要发生（掐断与完工是赛跑关系），所以它以 op 的形式出现在返回值里。原来那行
 *     `if (set.delete(id) && cond)` 把「消费」与「判定」写在一起，是这段代码最难
 *     读的一处，也是最容易在重构时被悄悄改掉的一处。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx。
 * 唯一的注入例外是 `readFailure`（失败附因读取）——本模块不认识文件也不认识会话，
 * 但它需要那份事实才能组结论文本，故由调用方给一个只读回调。
 */

export const DECISIONS = Object.freeze([
  'ignore', // E0 载荷连 childId 都没有
  'late-duplicate', // E1 台账有归属、活槽位没有：已落账那一代的迟到/重复 end
  'unattributable', // E2 不在册、台账无记录、可归因的 spawning 占位不唯一：留痕忽略
  'no-owning-orchestration', // E3 工种在册但属主实例已销毁：结论无处安放
  'expected-abort', // E4 urgency=abort 掐断的预期终局：吞掉，续轮仍占槽
  'fallback-in-flight', // E5 备选评估在飞窗口内的双发第二发：不矛盾口径、不推进
  'fallback-evaluation', // E6 error 终局 + 有备选链 + 本代际未决策：进异步重派
  'finalize', // E7 正常收尾（成功落账 / 失败附因落账）
])

// 每个决策的队列推进时机（协议第 2 条）。刻意写成显式全表：加决策不登记就 undefined。
const DECISION_ADVANCE = {
  'ignore': 'no',
  'late-duplicate': 'now',
  'unattributable': 'if-owned',
  'no-owning-orchestration': 'no',
  'expected-abort': 'no',
  'fallback-in-flight': 'no',
  'fallback-evaluation': 'no',
  'finalize': 'now',
}

/**
 * @param childId       end 载荷里的子会话 id
 * @param info          subagent/end 原始载荷（只读 stopReason / lastAssistantMessage）
 * @param routing       { parentId } —— childOwner 直达或全实例台账扫描得到的属主；undefined = 无属主
 * @param type          childId 的工种（活登记 ?? 墓碑，取证顺序由调用方决定）；undefined = 不在册
 * @param ledgerRecord  属主实例的台账记录（含 agentType），undefined = 台账也无归属
 * @param hasLiveRecord (childId) => boolean —— 属主实例活槽位是否在册（currentMap.has）
 * @param spawningCandidates [{ parentId, placeholderChildId, agentType }] —— 全实例里
 *                      状态为 spawning 的占位记录；**恰有一条**才允许归因（多条即歧义）
 * @param abortExpected / fallbackDecided (childId) => boolean —— 两张一次性表的成员判定
 * @param bindings      工种 → 角色绑定（读 fallbacks 链长与备选条目）
 * @param readFailure   (childId) => {message, code} | undefined —— 失败附因（惰性调用）
 */
export function attributeEnd({
  childId,
  info,
  routing,
  type,
  ledgerRecord,
  hasLiveRecord = () => false,
  spawningCandidates = [],
  abortExpected = () => false,
  fallbackDecided = () => false,
  bindings = {},
  readFailure = () => undefined,
} = {}) {
  // E0：不是编排面能处置的东西
  if (!childId) {
    return done('ignore', [], {})
  }

  const ops = []
  const notices = []
  let ownerPid = routing?.parentId
  let resolvedType = type
  // 归因改写属主后，活槽位判定必须以「改写后」的形态为准：bind-spawning-child 把
  // 占位记录换成真 childId 即入活槽，故本路径上 live 恒真（协议第 1 条同源事实）。
  let live = hasLiveRecord(childId)

  if (resolvedType === undefined) {
    if (ledgerRecord) {
      // 台账有归属：以台账为准
      resolvedType = ledgerRecord.agentType
      if (!live) {
        // E1：这条 end 属于已经落过账的那一代，重复落账会把 history 写脏
        return done('late-duplicate', ops, {
          ownerPid,
          type: resolvedType,
          notices: notices.concat(),
        }, { warn: `late/duplicate subagent/end for finished child ${String(childId)} (${resolvedType}); ignored` })
      }
    } else {
      // E2/E3 竞态兜底（最后手段）：快速失败的子会话可能在 startContinuable
      // resolve 之前就触发 subagent/end（此时 sessionTypes 尚未登记）。
      const hit = spawningCandidates.length === 1 ? spawningCandidates[0] : undefined
      if (!hit) {
        // 无从归属的 end：留痕；已知属主则照常推进其队列，绝不静默吞掉。
        //
        // **此处故意不 retire**（B5 补注，棒②点名的无注释脆弱点）：类型侧三张表
        // 本来就没有这个 childId——正因为它不在册才走到这条分支，retireTypeRecords
        // 是纯空转。而 childOwner 这一张表**更不能清**：它可能指向一个仍然活着的
        // 属主实例（本分支的 ownerPid 就是这么来的），清了就把同时段其它儿童的
        // 回程路由一起拆掉——那些 end 随后会全部掉进 E2，编排看起来「集体失忆」。
        return done('unattributable', ops, { ownerPid, type: undefined }, {
          warn: `subagent/end for untracked child ${String(childId)}, no record to attribute; ignored`,
          ambiguousSpawning: spawningCandidates.length > 1,
        })
      }
      ownerPid = hit.parentId
      resolvedType = hit.agentType
      live = true
      // 占位记录换键 + 属主路由改接：两条 op 由 dispatcher 按序落地
      ops.push(
        { op: 'bind-spawning-child', parentId: hit.parentId, placeholderChildId: hit.placeholderChildId, childId },
        { op: 'set-child-owner', childId, parentId: hit.parentId },
      )
      notices.push({ target: 'log', level: 'warn', text: `[dsh-my-go] subagent/end arrived before spawn resolved; attributed to spawning record ${childId}` })
    }
  }

  if (ownerPid === undefined) {
    // E3：类型有登记但实例已销毁（编排会话先走一步）：结论无处安放，留痕。
    // 只清类型侧三张表，childOwner 故意保留（见 child-registry.retireTypeRecords）。
    return done('no-owning-orchestration', [{ op: 'retire-type-records', childId }], { type: resolvedType }, {
      warn: `subagent/end for child ${String(childId)} (${resolvedType}) has no owning orchestration; conclusion dropped`,
    })
  }

  // E4：urgency=abort 护航（0.3.0-tisitan.2；收紧于 0.3.0-tisitan.7 N6）。
  // interrupt 掐断的那一轮必以非 completed 终局上报 end——它是编排方自造的预期
  // 事件，落史会让 interrupt 前排队的 followup 续轮游离于单线阻塞之外，「失败已知
  // 悉」预告/附因推送还会误导主流程进入失败处置。
  // **guard 无条件就地消费**（协议第 3 条）：掐断与完工是赛跑关系，interrupt 只是
  // 同步受理（Agent.cancel 异步生效），被掐轮完全可能已跑到 completed 终局——那是
  // 一条真结论，吞了就等于把成果连记录一起蒸发；而 guard 留着只会误伤下一代际
  // （跨代际残留另有 rearmChild 清理，N5）。
  if (abortExpected(childId)) {
    ops.push({ op: 'consume-abort-guard', childId })
    if (info?.stopReason !== 'completed') {
      // 不落史、不通知、不推进队列（槽位仍被续轮占用），续轮自己的 end 到达时走正常收尾
      return done('expected-abort', ops, { ownerPid, type: resolvedType, notices }, {
        warn: `subagent/end for ${String(childId)} (${resolvedType}) is the expected abort-interrupted turn; record stays running for the queued followup`,
      })
    }
  }

  // E5：双发 end 的第二发落在备选评估的 await 窗口内（pickFallbackEntry 含真实
  // 网络 I/O）：once-guard 已登记、评估中预告已发、活记录仍在原槽位。此处若照常
  // finalizeEnd，会把活记录提前落史——评估返回后 finish 落空、重派被静默放弃，
  // 主流程收过「评估中」预告却永等不到终局口径（棒2-Z1）。
  // 不落史、不发矛盾口径、不推进队列（槽位仍被评估占用，推进时机归重派各终局分支）。
  if (fallbackDecided(childId) && live) {
    return done('fallback-in-flight', ops, { ownerPid, type: resolvedType, notices }, {
      warn: `duplicate subagent/end while fallback evaluation in flight for ${String(childId)} (${resolvedType}); ignored`,
    })
  }

  const blocks = Array.isArray(info?.lastAssistantMessage) ? info.lastAssistantMessage : []
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  const failed = info?.stopReason !== 'completed'
  // 失败附因兜底：subagent/end 载荷无 error 字段，读子会话最后一条 turn/end 的
  // reason.error（live 快路径 + 持久化档案主路径，0.2.3-tisitan.9）；读档失败
  // 静默退回无附因（console.warn 留痕，不报错）。
  const failure = failed ? readFailure(childId) : undefined
  const baseConclusion = text || `(${String(info?.stopReason)})`
  const failureLine = failure ? `\n失败原因: ${failure.message} [${failure.code ?? 'UNKNOWN'}]` : ''
  const chain = Array.isArray(bindings[resolvedType]?.fallbacks) ? bindings[resolvedType].fallbacks : []

  // E6：备选链重派决策（唯一决策点：stopReason==='error'）。无链（含未配置
  // fallbacks）时保持既有同步落账路径，行为零变化；有链且活记录本代际未决策过
  // 才进入异步重派，同步登记 once-guard 防双派。
  if (info?.stopReason === 'error' && chain.length > 0 && !fallbackDecided(childId) && live) {
    ops.push({ op: 'add-fallback-guard', childId })
    // 同步预告（0.3.0-tisitan.18，同步段零 await）：harness 原生 failed 通知在
    // settle 瞬间同步唤醒主流程，而备选处置是异步的——真空期内主流程不知道备选
    // 存在，可能自行报死/手动重派撞车。进入异步评估前同步 inject 一行预告，告知
    // 主流程暂缓失败处置、静默等待 broker 的备选处置通知。
    notices.push({
      target: 'owner',
      parentId: ownerPid,
      text: `[dsh-my-go] 失败已知悉: ${childId} (${resolvedType}) 备选评估中（${chain.length} 条），暂缓失败处置`,
    })
    return done('fallback-evaluation', ops, {
      ownerPid,
      type: resolvedType,
      failure,
      baseConclusion,
      failureLine,
      fallbackChain: chain,
      notices,
    })
  }

  // E7：正常收尾。同步预告（0.3.0-tisitan.18）：不进备选评估的失败终局（无链 /
  // 非 error 终局）也要同步告知取证中，消灭失败通知真空期；成功 end 不发预告。
  // E5 已把「once-guard 在册的双发」拦在前面，这里不会发矛盾口径。
  if (failed && !fallbackDecided(childId)) {
    notices.push({
      target: 'owner',
      parentId: ownerPid,
      text: `[dsh-my-go] 失败已知悉: ${childId} (${resolvedType}) ${chain.length > 0 ? '不进入备选评估，取证中' : '无备选链，取证中'}`,
    })
    // 附因全灭的终局口径（棒2-L4）：live 与档案都没读到失败原因且不进重派评估时，
    // 「取证中」预告之后也必须有终局一行，协议不留真空期
    if (!failure) {
      notices.push({
        target: 'owner',
        parentId: ownerPid,
        text: `[dsh-my-go] 失败终局: ${childId} (${resolvedType}) 未读到附因（live 与档案均无失败原因），已按失败落账`,
      })
    }
  }

  return done('finalize', ops, {
    ownerPid,
    type: resolvedType,
    failure,
    conclusion: `${baseConclusion}${failureLine}`,
    failed,
    fallbackChain: chain,
    notices,
  })

  function done(decision, decisionOps, decisionFacts, extra = {}) {
    const advance = DECISION_ADVANCE[decision]
    if (advance === undefined) throw new Error(`attributeEnd: 决策 ${decision} 未在 DECISION_ADVANCE 登记队列推进时机`)
    return { decision, ops: decisionOps, notices: decisionFacts.notices ?? [], facts: { ...decisionFacts, ...extra, advance } }
  }
}

// dispatcher 侧解释 facts.advance（协议第 2 条）。拆成独立导出是为了让「推进时机」
// 这条不变量在测试里可以直接断言，而不用起整套替身。
export function shouldAdvanceQueue(facts, { hasOwningOrch = true } = {}) {
  switch (facts?.advance) {
    case 'now':
      return true
    case 'if-owned':
      return hasOwningOrch === true
    case 'no':
      return false
    default:
      // undefined = 决策没登记时机。宁可不动队列，也不猜「推进」——把还在跑的那一轮
      // 的槽位提前腾掉，等于放行两个子代理并行（单线阻塞是这插件的地基）。
      return false
  }
}
