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
 *   decision  十个出口之一（见 DECISIONS）
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
 *
 * 报告提交制闸门（0.5.0-tisitan.1，第二代替换第一代消息块解析闸）：第九出口
 * `report-gate-repair`。completed 终局且调用方传 `reportGate.enabled` 时过闸：
 *   - 本轮（含历史轮）report_submit 已成功（reportGate.reportSubmitted 命中，
 *     或 hasBoard 兜底命中——表为快路径、板为准）→
 *     仍走 'finalize'，facts.conclusion 改存 buildOwnerSummary 合成概要（短）；
 *     全文已由 report_submit 落板（登记前提），无需落板兜底。
 *   - 从未成功提交 → 'report-gate-repair'：ops 携带 add-repair-guard（once-guard，
 *     同步段由 dispatcher 第一时间落地——协议第 1 条），notices 同步预告，facts
 *     携带固定措辞的 repairPrompt。**不 finish**：记录留在 currentMap 实体占槽
 *     （advance='no'），补发链不调 rearmChild，guard 存续到补发轮 end 的转裁决
 *     ——防无限循环（「rearmChild 同点清理 × revive 路径」的规格字面矛盾以此
 *     消解）。
 *   - 已补发过（repairRetried 命中）→ 仍走 'finalize'，conclusion 加「未交付：」
 *     前缀转主编裁决，advance='now' 正常推进，不再二次补发。
 *   - failed（stopReason!=='completed'）永不过闸；reportGate 缺省/关 = 现路径
 *     一字不动。双发残余窗口（end#1' 在补发链 tick 前到达 → 走转裁决分支落账）
 *     为已知边界：结论按未交付落账，不比现状差。
 */

import { buildOwnerSummary } from './report-format.mjs'
import { laneOf } from './orchestration.mjs'

export const DECISIONS = Object.freeze([
  'ignore', // E0 载荷连 childId 都没有
  'late-duplicate', // E1 台账有归属、活槽位没有：已落账那一代的迟到/重复 end
  'unattributable', // E2 不在册、台账无记录、可归因的 spawning 占位不唯一：留痕忽略
  'no-owning-orchestration', // E3 工种在册但属主实例已销毁：结论无处安放
  'expected-abort', // E4 urgency=abort 掐断的预期终局：吞掉，续轮仍占槽
  'fallback-in-flight', // E5 备选评估在飞窗口内的双发第二发：不矛盾口径、不推进
  'fallback-evaluation', // E6 error 终局 + 有备选链 + 本代际未决策：进异步重派
  'finalize', // E7 正常收尾（成功落账 / 失败附因落账 / 闸门合格或转裁决）
  'suspended-help-hold', // E8 need_help 挂起（台账 status=waiting）的那一轮在收尾：不是完工，闸门不适用，记录留 waiting
  'report-gate-repair', // E9（报告提交制）completed 但从未成功提交报告：guard 登记 + queued 补发，槽位保留不落史
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
  'suspended-help-hold': 'no', // 挂起子代续占单线槽位，等主编 forward/continue
  'report-gate-repair': 'no', // 补发期间槽位仍占（记录留 currentMap，队列不推进）
}

// 闸门 hasBoard 的缺省替身：调用方不注入即恒假（判定退回纯内存表）。既有替身
// （只给 reportSubmitted/readSubmitted/repairRetried 的老测试）因此零扰动，本模块
// 也依旧零 fs——板上是否有货这件事实由 broker 现算后喂进来。
const NEVER_HAS_BOARD = () => false

// 登记值缺席但板上有货时的最小四字段（回执内芯的合成原料）。措辞点名「登记表
// 缺席」而非「未提交」：报告是真在板上的，主编照 report_fetch 取全文即可。
const BOARD_ONLY_SUBMITTED = Object.freeze({
  conclusion: '(报告已在板，成功登记表缺席)',
  evidence: '无',
  open: '无',
})

/**
 * @param childId       end 载荷里的子会话 id
 * @param info          subagent/end 原始载荷（只读 stopReason / lastAssistantMessage）
 * @param routing       { parentId } —— childOwner 直达或全实例台账扫描得到的属主；undefined = 无属主
 * @param type          childId 的工种（活登记 ?? 墓碑，取证顺序由调用方决定）；undefined = 不在册
 * @param ledgerRecord  属主实例的台账记录（含 agentType），undefined = 台账也无归属
 * @param hasLiveRecord (childId) => boolean —— 属主实例活槽位是否在册（currentMap.has）
 * @param abortExpected / fallbackDecided (childId) => boolean —— 两张一次性表的成员判定
 * @param bindings      工种 → 角色绑定（读 fallbacks 链长与备选条目）
 * @param readFailure   (childId) => {message, code} | undefined —— 失败附因（惰性调用）
 * @param reportGate    报告提交制闸门输入，null/缺省 = 关闭（现路径零变化）。启用形态：
 *                      { enabled: true, reportSubmitted: (id) => boolean,
 *                        readSubmitted: (id) => { conclusion, evidence, open },
 *                        repairRetried: (id) => boolean, hasBoard: (id) => boolean }
 *                      —— reportSubmitted/readSubmitted 读成功提交登记（report_submit
 *                      校验通过即登记，child-registry 持有），repairRetried 是
 *                      补发授权 once-guard 的成员判定谓词；hasBoard 是**报告板兜底**
 *                      （该 childId 在板上是否已有货，broker 侧 existsSync 现算）。
 *                      缺省 () => false：本模块零 fs、既有替身零扰动，判定退回纯内存表
 *
 * 二期 2.4（read-pool-semantics.md §4.3 方案 A）：spawningCandidates 参数与占位
 * 归因兜底（bind-spawning-child / set-child-owner 两 op）**退役**——end 抢跑场景
 * 改由 broker 侧 end 缓冲重放接管（真 id 精确认领，零猜测）。E2 出口保留但语义
 * 收窄为「缓冲前最终无从归属」的落档口径。
 */
export function attributeEnd({
  childId,
  info,
  routing,
  type,
  ledgerRecord,
  hasLiveRecord = () => false,
  abortExpected = () => false,
  fallbackDecided = () => false,
  bindings = {},
  readFailure = () => undefined,
  reportGate = null,
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
      // E2（二期 2.4 起语义收窄，read-pool-semantics.md §4.3 方案 A）：end 抢跑
      // spawn resolve 的场景由 broker 侧 **end 缓冲重放** 接管——暂存后等登记
      // 追上，按真 id 精确认领重放（认领时登记已落地、type 命中，根本不会进到
      // 本分支）。原「恰有一条 spawning 占位即归因」的猜测式兜底退役：并行下
      // 多条占位是常态，find-first 收集会把第二发的 end 静默归给第一条占位
      // （串号 = 幽灵，0.2.3-tisitan.6 教训的并行放大形态）。能抵达本分支的
      // 只剩缓冲超时后的最终落档口径。
      //
      // **此处故意不 retire**（B5 补注，棒②点名的无注释脆弱点）：类型侧三张表
      // 本来就没有这个 childId——正因为它不在册才走到这条分支，retireTypeRecords
      // 是纯空转。而 childOwner 这一张表**更不能清**：它可能指向一个仍然活着的
      // 属主实例（本分支的 ownerPid 就是这么来的），清了就把同时段其它儿童的
      // 回程路由一起拆掉——那些 end 随后会全部掉进 E2，编排看起来「集体失忆」。
      return done('unattributable', ops, { ownerPid, type: undefined }, {
        warn: `subagent/end for untracked child ${String(childId)}, no record to attribute; ignored`,
      })
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

  // E8：need_help 挂起回合的静默出口。子代调 need_help 即 suspend（台账 status 转
  // waiting），而它挂起前的那一轮在 harness 侧仍以 completed 终局上报 end——这条
  // end 不是完工口径，是「一次求助的中场哨」。此前它一路掉进报告闸门，被判成
  // 「完工未交报告」：发射第九出口 + queued 补发 prompt，把已经挂起的子代
  // coldResume 唤醒（求助单还挂在册上，人却被踢回去补交报告）。闸门在这里不适用：
  // 不 finish、不补发、不推进队列——记录留在 waiting 原位，等主编 forward/continue。
  if (ledgerRecord?.status === 'waiting') {
    return done('suspended-help-hold', ops, { ownerPid, type: resolvedType }, {
      warn: `subagent/end for ${String(childId)} (${resolvedType}) is a suspended turn settling; record stays waiting, gate not applied`,
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

  // E7'（报告提交制闸门，0.5.0-tisitan.1）：completed 终局且开关开时过闸。
  // failed 永不过闸（上方 failed 分支照旧）；reportGate 缺省 = 现路径一字不动。
  // 判定源是成功提交登记，子代最后一条消息不参与任何解析。
  if (reportGate?.enabled && !failed) {
    // 表为快路径（内存登记，跨终局保留），板为兜底（文件持久化）：任一命中即
    // 视为已交付。补上兜底的病灶：进程重启/冷恢复后内存表必然为空，而报告全文
    // 明明还在板上——只查表就会把「交过」的儿童判成「从未提交」并发射补发。
    const hasBoard = reportGate.hasBoard ?? NEVER_HAS_BOARD
    const tableHit = reportGate.reportSubmitted(childId)
    if (tableHit || hasBoard(childId)) {
      // 已交付：回执内芯 = 从已校验字段合成的概要（短），全文已在板上
      // （report_submit 落板成功是登记前提），无需落板兜底。
      // 登记值缺席（仅板命中）→ 显式兜底一份最小四字段，phase 记成
      // 'pass-board-fallback' 与常规 'pass' 分开：统计上这是「板为准」的保守
      // 放行，不是真读到了提交值，两种口径不许混在一个 phase 里。
      const registered = tableHit ? reportGate.readSubmitted(childId) : undefined
      return done('finalize', ops, {
        ownerPid,
        type: resolvedType,
        failure,
        conclusion: buildOwnerSummary(registered ?? BOARD_ONLY_SUBMITTED, childId),
        failed,
        fallbackChain: chain,
        notices,
        reportGate: { phase: registered ? 'pass' : 'pass-board-fallback' },
      })
    }
    if (reportGate.repairRetried(childId)) {
      // 已补发过（补发轮 end 或双发残余窗口）：转裁决落账，不再二次补发。
      // 结论前缀「未交付：」+ 最后消息全文（唯一的现场材料，不比现状差）。
      return done('finalize', ops, {
        ownerPid,
        type: resolvedType,
        failure,
        conclusion: `未交付：${text || baseConclusion}`,
        failed,
        fallbackChain: chain,
        notices,
        reportGate: { phase: 'verdict' },
      })
    }
    // 从未成功提交 → 第九出口：guard 随 ops 同步落地（协议第 1 条：dispatcher 落
    // ops 与发预告之间不得插 await），预告同步发，补发材料进 facts 交 dispatcher
    // void 异步链。不 finish：记录留在 currentMap 实体占槽（advance='no'），
    // 补发链不调 rearmChild，guard 存续到补发轮 end 的转裁决（防无限循环）。
    ops.push({ op: 'add-repair-guard', childId })
    notices.push({
      target: 'owner',
      parentId: ownerPid,
      text: `[dsh-my-go] 报告未提交: ${childId} (${resolvedType})——queued 补发中，暂缓处置`,
    })
    return done('report-gate-repair', ops, {
      ownerPid,
      type: resolvedType,
      notices,
      reportFullText: text,
      repairPrompt: buildRepairPrompt(),
    })
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
    // facts.lane（二期 2.3，D18 口径）：纯事实记录——被释放槽位所属泳道，供
    // metrics 与测试断言，**不参与任何推进决策**（global-scan 下推进决策由
    // isLaneFree 驱动，见 read-pool-semantics.md §2.5）。type 未定（E0/E2）则
    // lane 缺席，不猜。
    const lane = decisionFacts.type === undefined ? undefined : laneOf(decisionFacts.type)
    return { decision, ops: decisionOps, notices: decisionFacts.notices ?? [], facts: { ...decisionFacts, ...extra, lane, advance } }
  }
}

// 补发 prompt（报告提交制）：措辞零参数化——未提交的唯一原因就是没调工具，
// 四字段用法由工具描述与 REPORT_CLAUSE 自教，这里只点名补交什么与「不必重做」。
function buildRepairPrompt() {
  return '[dsh-my-go] 你上一轮结束但未调用 report_submit 提交报告，视为未交付。请调用 report_submit 一次交齐四字段（report 完整报告全文 / conclusion 2-4 句结论 / evidence 裸『路径:行号』数组或 ["无"] / open 遗留或「无」）。内容可完全复用你已完成的工作，只补交报告。'
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
