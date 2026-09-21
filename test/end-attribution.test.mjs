/**
 * dsh-my-go — subagent/end 归因决策直测（0.3.0-tisitan.12，棒② B5）。
 *
 * 这批用例**不起 ctx 替身**：attributeEnd 只吃纯数据与只读谓词，所以这里全部是
 * 「表状态进、决策出」的直测——这是 B5 抽函数的唯一收益诉求：八条控制出口从此
 * 可以逐条排列组合地验，而不必为了触发一条分支去搭整套 mock-ctx + 异步链。
 *
 * 两类断言各有分工：
 *   - decision / facts.advance：出口本身与「槽位还占不占」（队列推进时机）；
 *   - ops 的**内容与顺序**：dispatcher 会照单落地，顺序错了就是改表时序变了
 *     （例如 bind-spawning-child 必须早于 set-child-owner）。
 *
 * 出口编号与模块内 DECISIONS 表一致（E0 无载荷 → E7 finalize）。另有三例
 * **换序回归**（E4→E5 / E5→E6 / E3→E4）：这些分支的先后本身就是语义，
 * 谁先谁后决定「双发 end 会不会二次重派」「被掐轮的 guard 会不会被误吞」。
 * 把它们写成用例而不是注释，是因为源码里这段顺序在 .12 之前只由行号相邻来保证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributeEnd, shouldAdvanceQueue, DECISIONS } from '../preset/shared/end-attribution.mjs'
import { REPORT_REPAIR_CLAUSE_HINT } from '../preset/shared/report-format.mjs'

// ── 夹具：一张 end 事件所需的全部外部事实，默认值 = 「正常在册」───────────────
const CHAIN = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }]
const BINDINGS = { hermes: { provider: 'p0', model: 'm0', fallbacks: CHAIN }, explore: { provider: 'p0', model: 'm0' } }

// 夹具取值口径：**显式传 undefined 就是 undefined**（解构缺省值会把「故意清空
// type / routing」的覆盖吃回去，那正是这批分支用例唯一依赖的开关）。
function fixture(over = {}) {
  const pick = (key, dflt) => (key in over ? over[key] : dflt)
  const childId = pick('childId', 'sess-1')
  const info = pick('info', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '结论正文' }] })
  const routing = pick('routing', { parentId: 'parent-1' })
  const type = pick('type', 'hermes')
  const ledgerRecord = pick('ledgerRecord', undefined)
  const live = pick('live', true)
  const abortSet = pick('abortSet', [])
  const decidedSet = pick('decidedSet', [])
  const bindings = pick('bindings', BINDINGS)
  const failure = pick('failure', undefined)
  const reportGate = pick('reportGate', null)
  const calls = { readFailure: 0 }
  const result = attributeEnd({
    childId,
    info,
    routing,
    type,
    ledgerRecord,
    hasLiveRecord: (id) => (id === childId ? live : false),
    abortExpected: (id) => abortSet.includes(id),
    fallbackDecided: (id) => decidedSet.includes(id),
    bindings,
    readFailure: () => {
      calls.readFailure += 1
      return failure
    },
    reportGate,
  })
  return { ...result, calls }
}

const opsOf = (r) => r.ops.map((o) => o.op)
const ownerNotices = (r) => r.notices.filter((n) => n.target === 'owner').map((n) => n.text)

// ── E0 / E1 / E2 / E3：四条早退 ──────────────────────────────────────────────

test('E0 载荷无 childId → ignore，零 op 零通知且不推进队列', () => {
  const r = fixture({ childId: undefined, info: { stopReason: 'completed' } })
  assert.equal(r.decision, 'ignore')
  assert.deepEqual(r.ops, [])
  assert.deepEqual(r.notices, [])
  assert.equal(r.facts.advance, 'no')
  assert.equal(r.calls.readFailure, 0, '早退不得去读失败附因（那是 I/O）')
})

test('E1 台账有归属而活槽没有 → late-duplicate：不重复落账，但照常推进队列', () => {
  const r = fixture({ type: undefined, ledgerRecord: { agentType: 'hermes' }, live: false })
  assert.equal(r.decision, 'late-duplicate')
  assert.equal(r.facts.type, 'hermes', '工种以台账为准')
  assert.deepEqual(opsOf(r), [], '登记清理已由上一代 finalizeEnd 做过，此处不重复 retire')
  assert.equal(r.facts.advance, 'now', '槽位已空，队列该继续走')
  assert.match(r.facts.warn, /late\/duplicate subagent\/end for finished child sess-1 \(hermes\)/)
})

test('E2 不在册、台账无记录、无占位可归因 → unattributable：故意不 retire，推进看有没有属主', () => {
  const withOwner = fixture({ type: undefined, ledgerRecord: undefined, routing: { parentId: 'parent-1' } })
  assert.equal(withOwner.decision, 'unattributable')
  assert.deepEqual(opsOf(withOwner), [], '不 retire：类型表本来就没这个键，childOwner 更要留着给同时段其它儿童回程')
  assert.equal(withOwner.facts.advance, 'if-owned')
  assert.equal(shouldAdvanceQueue(withOwner.facts, { hasOwningOrch: true }), true)
  const noOwner = fixture({ type: undefined, ledgerRecord: undefined, routing: undefined })
  assert.equal(shouldAdvanceQueue(noOwner.facts, { hasOwningOrch: false }), false, '连属主都不知道，绝不盲推队列')
})

test('E2 占位归因兜底已退役（二期 2.4 方案 A）：不再有 bind/set-child-owner op，一律落档不猜', () => {
  // 退役前的「恰有一条占位即归因」（E2+）与「多条即歧义」（E2b）两分支随方案 A
  // 移除——end 抢跑场景由 broker 侧 end 缓冲重放接管（test/end-buffer.test.mjs）。
  // 纯函数层现在对「不在册且无台账」的输入只有一种答案：unattributable 落档。
  const r = fixture({ type: undefined, ledgerRecord: undefined, routing: undefined, live: false })
  assert.equal(r.decision, 'unattributable')
  assert.deepEqual(opsOf(r), [], '绝不猜测归因：bind-spawning-child / set-child-owner 已随退役移除')
  assert.equal('ambiguousSpawning' in r.facts, false, '歧义信号随占位候选机制一并退役')
  assert.match(r.facts.warn, /no record to attribute/)
})

test('E3 工种在册而属主实例已销毁 → no-owning-orchestration：只清类型三表、不推进队列', () => {
  const r = fixture({ routing: undefined })
  assert.equal(r.decision, 'no-owning-orchestration')
  assert.deepEqual(opsOf(r), ['retire-type-records'])
  assert.equal(r.facts.advance, 'no', '实例都不在了，推谁的队列？')
  assert.match(r.facts.warn, /has no owning orchestration; conclusion dropped/)
})

// ── E4 / E5：两张一次性表的出口与换序敏感性 ──────────────────────────────────

test('E4 abort 护航命中（非 completed 终局）→ 吞掉这一发：不通知、不落史、不推进', () => {
  const r = fixture({ abortSet: ['sess-1'], info: { id: 'sess-1', stopReason: 'aborted', lastAssistantMessage: [] } })
  assert.equal(r.decision, 'expected-abort')
  assert.deepEqual(opsOf(r), ['consume-abort-guard'])
  assert.deepEqual(ownerNotices(r), [], '不发失败预告：那是编排方自造的预期事件')
  assert.equal(r.facts.advance, 'no', '槽位仍被 interrupt 前排队的续轮占着')
  assert.match(r.facts.warn, /expected abort-interrupted turn; record stays running/)
})

test('E4b 被掐轮跑到 completed 终局 → guard 就地消费但**不吞**这条真结论', () => {
  const r = fixture({ abortSet: ['sess-1'] })
  assert.equal(r.decision, 'finalize', 'interrupt 只是同步受理，被掐轮完全可能已完工')
  assert.equal(opsOf(r).includes('consume-abort-guard'), true, 'guard 不留残，否则误伤下一代际')
  assert.equal(r.facts.conclusion, '结论正文')
  assert.equal(r.facts.failed, false)
})

test('E5 备选评估在飞时的双发第二发 → fallback-in-flight：不矛盾口径、不推进', () => {
  const r = fixture({ decidedSet: ['sess-1'], info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] } })
  assert.equal(r.decision, 'fallback-in-flight')
  assert.deepEqual(ownerNotices(r), [])
  assert.equal(r.facts.advance, 'no', '推进时机归 attemptFallbackRedeploy 的各终局分支')
  assert.equal(r.calls.readFailure, 0, '早退不读附因')
})

test('换序回归 E4→E5：abort 护航优先于「评估在飞」——两条 guard 同时在册时吞 end 不二次评估', () => {
  const r = fixture({
    abortSet: ['sess-1'],
    decidedSet: ['sess-1'],
    info: { id: 'sess-1', stopReason: 'aborted', lastAssistantMessage: [] },
  })
  assert.equal(r.decision, 'expected-abort')
  assert.deepEqual(opsOf(r), ['consume-abort-guard'], '只消费 abort 护航，绝不 add 第二次 once-guard')
})

test('换序回归 E5→E6：评估在飞优先于重派评估——否则双发 end 会二次重派出两个儿童', () => {
  const r = fixture({
    decidedSet: ['sess-1'],
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
    failure: { message: 'boom', code: 'SERVER' },
  })
  assert.equal(r.decision, 'fallback-in-flight')
  assert.equal(opsOf(r).includes('add-fallback-guard'), false, 'once-guard 不得重复登记')
  // 同一条 end 若把 decidedSet 清空（新代际），就该正常进评估——证明两分支互斥靠的是这张表
  const fresh = fixture({
    decidedSet: [],
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
    failure: { message: 'boom', code: 'SERVER' },
  })
  assert.equal(fresh.decision, 'fallback-evaluation')
})

test('换序回归 E3→E4：属主已销毁时不清 abort 护航——retire 与 guard 消费是两回事', () => {
  const r = fixture({ routing: undefined, abortSet: ['sess-1'] })
  assert.equal(r.decision, 'no-owning-orchestration')
  assert.deepEqual(opsOf(r), ['retire-type-records'], '顺序反了会先消费 guard 再 drop 结论')
  assert.equal(opsOf(r).includes('consume-abort-guard'), false)
})

// ── E8：need_help 挂起回合的静默出口（闸门不适用）──────────────────────────────
// 子代调 need_help 即 suspend（台账 status 转 waiting），挂起前那一轮仍以 completed
// 上报 end。这条 end 不是完工口径：既不该落账，更不该进报告闸门——闸门一旦判它
// 「未交报告」就会 queued 补发，把挂起中的子代 coldResume 唤醒（求助单还在册上）。

test('E8 挂起中的那一轮以 completed 收尾 → suspended-help-hold：闸门不发、零通知、不推进', () => {
  const r = fixture({
    ledgerRecord: { agentType: 'hermes', status: 'waiting' },
    reportGate: { enabled: true, reportSubmitted: () => false, readSubmitted: () => undefined, repairRetried: () => false },
  })
  assert.equal(r.decision, 'suspended-help-hold')
  assert.equal(r.facts.advance, 'no', '挂起子代续占单线槽位，等主编 forward/continue')
  assert.deepEqual(opsOf(r), [], '不 add-repair-guard：挂起轮不是完工，没有补发授权这回事')
  assert.deepEqual(r.notices, [], '静默出口零通知（主编已收到求助单，不该再收一次假完工预告）')
  assert.equal(r.notices.some((n) => n.text?.includes('报告未提交')), false, '绝不再发「报告未提交」')
  assert.equal(r.calls.readFailure, 0, '早退不读附因（那是 I/O）')
  assert.equal(r.facts.lane, 'write', 'lane 是纯事实：type 已定就照常记')
  assert.match(r.facts.warn, /is a suspended turn settling; record stays waiting, gate not applied/)
})

test('E8b 挂起判定与闸门开关无关；非 waiting 形态（含既有 fixture 的无 status 字段）自然判假走原路径', () => {
  assert.equal(fixture({ ledgerRecord: { agentType: 'hermes', status: 'waiting' } }).decision, 'suspended-help-hold', 'gate 缺省也走静默出口')
  assert.equal(fixture({ ledgerRecord: { agentType: 'hermes' } }).decision, 'finalize', '回归闸门：无 status 字段 = 判假，现路径一字不动')
  assert.equal(fixture({ ledgerRecord: { agentType: 'hermes', status: 'running' } }).decision, 'finalize')
  assert.equal(fixture({ ledgerRecord: { agentType: 'hermes', status: 'done' } }).decision, 'finalize')
  assert.equal(fixture({ ledgerRecord: { agentType: 'hermes', status: 'failed' } }).decision, 'finalize')
})

test('换序回归 E4→E8：挂起轮带着 abort 护航时 guard 仍就地消费，出口是静默而非补发', () => {
  const r = fixture({ abortSet: ['sess-1'], ledgerRecord: { agentType: 'hermes', status: 'waiting' } })
  assert.equal(r.decision, 'suspended-help-hold')
  assert.deepEqual(opsOf(r), ['consume-abort-guard'], 'guard 不留残，否则误伤下一代际')
})

test('换序回归 E5→E8：评估在飞优先于挂起静默（双发第二发仍按在飞口径消化）', () => {
  const r = fixture({
    decidedSet: ['sess-1'],
    ledgerRecord: { agentType: 'hermes', status: 'waiting' },
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
  })
  assert.equal(r.decision, 'fallback-in-flight')
  assert.equal(opsOf(r).includes('add-repair-guard'), false)
})

test('换序回归 E8→闸门：挂起判定必须早于报告闸门，否则挂起子代被 queued 补发唤醒', () => {
  // 同一份「completed + 从未提交」输入，只把台账 status 改成 waiting，出口就必须
  // 从 report-gate-repair 换成 suspended-help-hold——分支先后即本用例的全部内容。
  const notSubmitted = { enabled: true, reportSubmitted: () => false, readSubmitted: () => undefined, repairRetried: () => false }
  assert.equal(fixture({ reportGate: notSubmitted }).decision, 'report-gate-repair', '对照基线：未挂起时闸门照发')
  const r = fixture({ reportGate: notSubmitted, ledgerRecord: { agentType: 'hermes', status: 'waiting' } })
  assert.equal(r.decision, 'suspended-help-hold')
  assert.equal(r.facts.reportGate, undefined, 'facts 不带闸门 phase（dispatcher 不会记 report-gate 埋点）')
})

// ── E6：备选评估（error 终局 + 有链的唯一决策点）─────────────────────────────────────────────────────────────

test('E6 error 终局 + 有链 + 本代际未决策 → fallback-evaluation：guard 与预告同批产出', () => {
  const r = fixture({
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [{ type: 'text', text: '半成品' }] },
    failure: { message: 'rate limited', code: 'RATE_LIMIT' },
  })
  assert.equal(r.decision, 'fallback-evaluation')
  assert.deepEqual(opsOf(r), ['add-fallback-guard'])
  assert.deepEqual(ownerNotices(r), ['[dsh-my-go] 失败已知悉: sess-1 (hermes) 备选评估中（2 条），暂缓失败处置'])
  assert.equal(r.facts.baseConclusion, '半成品')
  assert.equal(r.facts.failureLine, '\n失败原因: rate limited [RATE_LIMIT]')
  assert.deepEqual(r.facts.fallbackChain, CHAIN, '链本体交给 dispatcher 传给重派流程')
  assert.equal(r.facts.advance, 'no', '推进归重派各终局分支')
})

test('E6b 非 error 的失败终局（aborted/timeout）绝不进重派评估', () => {
  for (const stopReason of ['aborted', 'timeout', 'cancelled']) {
    const r = fixture({ info: { id: 'sess-1', stopReason, lastAssistantMessage: [] }, failure: { message: 'x', code: 'OTHER' } })
    assert.equal(r.decision, 'finalize', `${stopReason} 走同步落账`)
    assert.equal(opsOf(r).includes('add-fallback-guard'), false)
  }
})

test('E6c 无链工种 error 终局 → 直接 finalize 并发「无备选链」预告（旧行为零变化）', () => {
  const r = fixture({
    type: 'explore',
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
    failure: { message: 'no such model', code: 'HTTP_404' },
  })
  assert.equal(r.decision, 'finalize')
  assert.deepEqual(ownerNotices(r), ['[dsh-my-go] 失败已知悉: sess-1 (explore) 无备选链，取证中'])
  assert.equal(r.facts.conclusion, '(error)\n失败原因: no such model [HTTP_404]')
  assert.equal(r.facts.failed, true)
})

test('E6d 有链却不进评估（非 error）时预告措辞为「不进入备选评估」，与「无备选链」可分辨', () => {
  const r = fixture({ info: { id: 'sess-1', stopReason: 'timeout', lastAssistantMessage: [] }, failure: { message: 'slow', code: 'TIMEOUT' } })
  assert.deepEqual(ownerNotices(r), ['[dsh-my-go] 失败已知悉: sess-1 (hermes) 不进入备选评估，取证中'])
})

// ── E7：正常收尾的载荷组 ─────────────────────────────────────────────────────

test('E7 completed 终局 → finalize：结论取 text 块串接，零通知（成功不打扰主流程）', () => {
  const r = fixture({
    info: { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '第一段' }, { type: 'tool_use' }, { type: 'text', text: '第二段' }] },
  })
  assert.equal(r.decision, 'finalize')
  assert.equal(r.facts.conclusion, '第一段\n第二段', '非 text 块与无名块剔除')
  assert.deepEqual(ownerNotices(r), [])
  assert.equal(r.facts.advance, 'now')
  assert.equal(r.calls.readFailure, 0, '成功终局不读附因')
})

test('E7b 空载荷兜底结论 = (stopReason)，附因全灭时补终局一行（棒2-L4 协议不留真空）', () => {
  const r = fixture({ info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] }, type: 'explore', failure: undefined })
  assert.equal(r.facts.conclusion, '(error)')
  const ns = ownerNotices(r)
  assert.deepEqual(ns, [
    '[dsh-my-go] 失败已知悉: sess-1 (explore) 无备选链，取证中',
    '[dsh-my-go] 失败终局: sess-1 (explore) 未读到附因（live 与档案均无失败原因），已按失败落账',
  ], '两行都在同步段产出，顺序即送达顺序')
})

test('E7c once-guard 在册但活槽已空（评估完成后迟到第二发）→ 不重复发预告，照常收尾', () => {
  const r = fixture({
    decidedSet: ['sess-1'],
    live: false,
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
    type: 'explore',
  })
  assert.equal(r.decision, 'finalize')
  assert.deepEqual(ownerNotices(r), [], '评估中预告已发过，不得再发矛盾口径')
})

test('readFailure 惰性：只在 failed 且走到收尾/评估时才读，早退五连一律零次', () => {
  const early = [
    () => fixture({ childId: undefined, info: {} }),
    () => fixture({ type: undefined, ledgerRecord: { agentType: 'hermes' }, live: false }),
    () => fixture({ type: undefined, ledgerRecord: undefined }),
    () => fixture({ routing: undefined }),
    () => fixture({ abortSet: ['sess-1'], info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] } }),
    () => fixture({ decidedSet: ['sess-1'], info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] } }),
  ]
  for (const make of early) {
    const r = make()
    assert.notEqual(r.decision, 'finalize', '早退用例配错分支')
    assert.equal(r.calls.readFailure, 0, `${r.decision} 分支不得读附因`)
  }
  const late = fixture({ info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] }, type: 'explore' })
  assert.equal(late.calls.readFailure, 1, '走到收尾才读，且只读一次')
})

// ── 队列推进时机的表完整性（R3/R4 显式化）────────────────────────────────────

test('每条 DECISIONS 出口都必须登记队列推进时机，且只有 now/if-owned 会推进', () => {
  assert.deepEqual([...DECISIONS].sort(), [
    'expected-abort',
    'fallback-evaluation',
    'fallback-in-flight',
    'finalize',
    'ignore',
    'late-duplicate',
    'no-owning-orchestration',
    'report-gate-repair',
    'suspended-help-hold',
    'unattributable',
  ], '十条出口齐备（1.5 新增 report-gate-repair，advance=no：补发期间槽位仍占；need_help 挂起批新增 suspended-help-hold，advance=no：挂起子代续占槽；增删决策要在这里说明理由）')
  const seen = new Set()
  const scenarios = [
    { args: { childId: undefined, info: {} } },
    { args: { childId: 'x', info: { stopReason: 'error' }, type: undefined, ledgerRecord: { agentType: 'hermes' }, hasLiveRecord: () => false } },
    { args: { childId: 'x', info: { stopReason: 'error' }, type: undefined, ledgerRecord: undefined, hasLiveRecord: () => false } },
    { args: { childId: 'x', info: { stopReason: 'error' }, type: 'hermes', routing: undefined } },
    { args: { childId: 'x', info: { stopReason: 'aborted', type: 'a' }, type: 'hermes', abortExpected: () => true } },
    { args: { childId: 'x', info: { stopReason: 'error' }, type: 'hermes', fallbackDecided: () => true } },
    { args: { childId: 'x', info: { stopReason: 'error' }, type: 'hermes', bindings: { hermes: { fallbacks: CHAIN } } } },
    { args: { childId: 'x', info: { stopReason: 'completed' }, type: 'hermes' } },
    { args: { childId: 'x', info: { stopReason: 'completed' }, type: 'hermes', ledgerRecord: { agentType: 'hermes', status: 'waiting' } } },
  ]
  for (const { args } of scenarios) {
    const r = attributeEnd({ routing: { parentId: 'p' }, hasLiveRecord: () => true, ...args })
    seen.add(r.decision)
    assert.ok(['now', 'no', 'if-owned'].includes(r.facts.advance), `${r.decision} 的 advance 口径合法`)
  }
  assert.equal(seen.size, 9, `无 gate 的基础场景集打到九条出口（report-gate-repair 由下方闸门直测批单独覆盖），实际只到 ${[...seen].join(',')}`)
  assert.equal(shouldAdvanceQueue({ advance: 'now' }), true)
  assert.equal(shouldAdvanceQueue({ advance: 'no' }), false)
  assert.equal(shouldAdvanceQueue({ advance: undefined }), false, '漏登记 = 不推进（宁可冻结也不放行两个并行）')
})

test('attributeEnd 对畸形载荷不抛错（表状态缺项/载荷非对象都归到 ignore/unattributable）', () => {
  assert.equal(attributeEnd({}).decision, 'ignore')
  assert.equal(attributeEnd({ childId: 'x', info: null, routing: { parentId: 'p' }, type: 'hermes', hasLiveRecord: () => true }).decision, 'finalize')
  assert.equal(attributeEnd({ childId: 'x', info: { stopReason: 'completed', lastAssistantMessage: '不是数组' }, routing: { parentId: 'p' }, type: 'hermes', hasLiveRecord: () => true }).facts.conclusion, '(completed)')
})

test('facts.lane 事实字段（二期 2.3，D18）：type 已定出口携带 laneOf(type)，E0/E2 缺 type 不猜', () => {
  // finalize：hermes → write；explore → read
  const finWrite = attributeEnd({ childId: 'x', info: { stopReason: 'completed' }, routing: { parentId: 'p' }, type: 'hermes', hasLiveRecord: () => true })
  assert.equal(finWrite.facts.lane, 'write')
  const finRead = attributeEnd({ childId: 'x', info: { stopReason: 'completed' }, routing: { parentId: 'p' }, type: 'explore', hasLiveRecord: () => true })
  assert.equal(finRead.facts.lane, 'read')
  // E0：无 childId，type 未定 → lane 缺席（不猜）
  assert.equal(attributeEnd({}).facts.lane, undefined)
  // E2：无从归属，type undefined → lane 缺席
  const e2 = attributeEnd({ childId: 'x', info: { stopReason: 'error' } })
  assert.equal(e2.decision, 'unattributable')
  assert.equal(e2.facts.lane, undefined)
  // facts.lane 是纯事实记录：不改变 advance 决策口径（D18 global-scan）
  assert.equal(finWrite.facts.advance, 'now')
})

// ── E9（报告提交制闸门，0.5.0-tisitan.1）直测批 ──────────────────────────────
// 闸门判定全部在 attributeEnd 纯函数层（同步段协议），这里「表状态进、决策出」
// 直测三分支 + 零进入：已提交直通 / 从未提交补发 / 已补发转裁决 / failed 与开关关。

// 成功提交登记的登记值形态（child-registry.reportSubmitted 的 value）
const SUBMITTED = { conclusion: '结论摘要', evidence: ['src/a.js:12'], open: '无' }
const summaryOf = (childId) => [
  '结论摘要',
  '证据:',
  '- src/a.js:12',
  '遗留: 无',
  `全文落板，report_fetch childId=${childId} 切片取阅`,
].join('\n')

// 闸门夹具：在标准 fixture 上叠 reportGate（登记命中开关 + 补发授权开关）
function gateFixture({ submitted = true, repaired = false, gateOver = {} } = {}) {
  return fixture({
    reportGate: {
      enabled: true,
      reportSubmitted: () => submitted,
      readSubmitted: () => SUBMITTED,
      repairRetried: () => repaired,
      ...gateOver,
    },
  })
}

test('闸门·已提交直通：finalize 但 conclusion = 合成概要（conclusion+evidence+open+取阅指针）', () => {
  const r = gateFixture()
  assert.equal(r.decision, 'finalize')
  assert.equal(r.facts.advance, 'now')
  assert.equal(r.facts.conclusion, summaryOf('sess-1'), '台账 conclusion = broker 合成回执内芯')
  assert.equal(r.facts.reportGate.phase, 'pass')
  assert.deepEqual(opsOf(r).filter((o) => o === 'add-repair-guard'), [])
  assert.ok(r.facts.conclusion.includes('全文落板，report_fetch childId=sess-1 切片取阅'), '取阅指引随回执')
})

// 板兜底（复活轮误判修复批改点2）：表为快路径、板为准。表空而板有货 = 已交付，
// 只是回执无从合成真字段（登记值缺席）→ 走显式最小兜底并把 phase 分开口径；
// 表命中时一律按常规 pass 走（板根本不参与判定，热路径不多一次谓词调用）。
test('闸门·板兜底：表空+板有货 → pass-board-fallback 直通；表命中 → 常规 pass', () => {
  const byBoard = gateFixture({ submitted: false, gateOver: { hasBoard: () => true } })
  assert.equal(byBoard.decision, 'finalize', '板上有货绝不发射补发')
  assert.deepEqual(opsOf(byBoard).filter((o) => o === 'add-repair-guard'), [], '零 add-repair-guard')
  assert.equal(byBoard.facts.advance, 'now', '照常腾槽推进')
  assert.equal(byBoard.facts.reportGate.phase, 'pass-board-fallback', '与常规 pass 分开记，统计不许混')
  assert.ok(byBoard.facts.conclusion.includes('(报告已在板，成功登记表缺席)'), '登记值缺席走显式最小兜底（不留空字段）')
  assert.ok(byBoard.facts.conclusion.includes('证据: 无') && byBoard.facts.conclusion.includes('遗留: 无'), '兜底字段仍走同款拼装')
  assert.ok(byBoard.facts.conclusion.includes('report_fetch childId=sess-1'), '取阅指针照常在')
  const byTable = gateFixture({ submitted: true, gateOver: { hasBoard: () => true } })
  assert.equal(byTable.facts.reportGate.phase, 'pass', '表命中即真直通，不因板也在而改口径')
  assert.equal(byTable.facts.conclusion, summaryOf('sess-1'), '回执内芯 = 登记值合成，不是兜底文案')
})

test('闸门·从未提交首次 → 第九出口：guard op 同步随行、固定措辞补发 prompt、槽位保留', () => {
  const r = gateFixture({ submitted: false })
  assert.equal(r.decision, 'report-gate-repair')
  assert.equal(r.facts.advance, 'no', '补发期间槽位仍占（队列不推进）')
  assert.deepEqual(r.ops, [{ op: 'add-repair-guard', childId: 'sess-1' }], 'once-guard 随决策返回，dispatcher 第一时间落地')
  assert.equal(r.facts.reportFullText, '结论正文', '最后消息全文随 facts（补发投递失败时的落账材料）')
  assert.ok(r.facts.repairPrompt.includes('未调用 report_submit 提交报告，视为未交付'), '补发 prompt 点名未交付')
  // 字段口径不许在 end-attribution 里另抄一份：整段必须原样引用 REPORT_REPAIR_CLAUSE_HINT
  // （与 REPORT_CLAUSE / REPORT_TAIL_FIELDS 同名册派生）——旧「四字段」措辞曾把施工层
  // 补交轮钉成第二次拒收，这一钉就是防它换个数字回潮。
  assert.ok(r.facts.repairPrompt.includes(REPORT_REPAIR_CLAUSE_HINT), '补发 prompt 引用同源字段口径（无第二源）')
  assert.ok(r.facts.repairPrompt.includes('六字段'), '补发 prompt 指路六字段')
  assert.ok(!r.facts.repairPrompt.includes('四字段'), '旧四字段口径零残留')
  for (const key of ['deviation', 'unverified']) {
    assert.ok(r.facts.repairPrompt.includes(key), `补发 prompt 点名两尾字段：${key}`)
  }
  assert.ok(r.facts.repairPrompt.includes('别往 report 正文里塞节标'), '补发 prompt 重申节标已退役')
  assert.ok(r.facts.repairPrompt.includes('只补交报告'), '补发 prompt 明示无需重做任务')
  assert.ok(ownerNotices(r)[0].includes('报告未提交'), '同步预告在 facts 组装期入列')
  assert.equal('repairErrors' in r.facts, false, '提交制无格式错误清单（判定源是登记表）')
})

test('闸门·已补发仍未提交 → 转裁决 finalize：「未交付：」前缀 + 正常推进，不再二次补发', () => {
  const r = gateFixture({ submitted: false, repaired: true })
  assert.equal(r.decision, 'finalize')
  assert.equal(r.facts.advance, 'now')
  assert.ok(r.facts.conclusion.startsWith('未交付：'), '转裁决前缀')
  assert.ok(r.facts.conclusion.includes('结论正文'), '最后消息全文随结论落账（唯一现场材料）')
  assert.equal(r.facts.reportGate.phase, 'verdict')
  assert.deepEqual(opsOf(r).filter((o) => o === 'add-repair-guard'), [], '不再二次补发（once-guard 已在册，决策走转裁决）')
})

test('闸门·failed 永不过闸：无链 error 终局走失败落账现路径，conclusion 无前缀、无 gate fact', () => {
  const r = fixture({
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [{ type: 'text', text: '半成品正文' }] },
    reportGate: { enabled: true, reportSubmitted: () => false, readSubmitted: () => undefined, repairRetried: () => false },
    bindings: { hermes: { provider: 'p0', model: 'm0' } },
    failure: { message: 'boom', code: 'HTTP_500' },
  })
  assert.equal(r.decision, 'finalize')
  assert.equal(r.facts.reportGate, undefined, 'failed 结论全文直推主编（沿用今日原则）')
  assert.ok(!r.facts.conclusion.startsWith('未交付：'))
  assert.equal(r.facts.advance, 'now')
})

test('闸门·开关关（reportGate 缺省）：现状零变化，最后消息文本原样进 conclusion', () => {
  const r = fixture({ info: { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '普通正文' }] } })
  assert.equal(r.decision, 'finalize')
  assert.equal(r.facts.conclusion, '普通正文', '全文原样（现状行为）')
  assert.equal(r.facts.reportGate, undefined)
})
