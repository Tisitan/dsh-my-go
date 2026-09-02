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
  const spawningCandidates = pick('spawningCandidates', [])
  const abortSet = pick('abortSet', [])
  const decidedSet = pick('decidedSet', [])
  const bindings = pick('bindings', BINDINGS)
  const failure = pick('failure', undefined)
  const calls = { readFailure: 0 }
  const result = attributeEnd({
    childId,
    info,
    routing,
    type,
    ledgerRecord,
    hasLiveRecord: (id) => (id === childId ? live : false),
    spawningCandidates,
    abortExpected: (id) => abortSet.includes(id),
    fallbackDecided: (id) => decidedSet.includes(id),
    bindings,
    readFailure: () => {
      calls.readFailure += 1
      return failure
    },
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

test('E2b spawning 占位不唯一 → 歧义即放弃归因，一条 op 都不发（0.2.3-tisitan.6 串号教训）', () => {
  const r = fixture({
    type: undefined,
    ledgerRecord: undefined,
    routing: undefined,
    spawningCandidates: [
      { parentId: 'parent-1', placeholderChildId: 'child-a', agentType: 'hermes' },
      { parentId: 'parent-2', placeholderChildId: 'child-b', agentType: 'explore' },
    ],
  })
  assert.equal(r.decision, 'unattributable')
  assert.equal(r.facts.ambiguousSpawning, true)
  assert.deepEqual(r.ops, [], '绑错属主比不绑更坏：绝不猜一个')
})

test('E3 工种在册而属主实例已销毁 → no-owning-orchestration：只清类型三表、不推进队列', () => {
  const r = fixture({ routing: undefined })
  assert.equal(r.decision, 'no-owning-orchestration')
  assert.deepEqual(opsOf(r), ['retire-type-records'])
  assert.equal(r.facts.advance, 'no', '实例都不在了，推谁的队列？')
  assert.match(r.facts.warn, /has no owning orchestration; conclusion dropped/)
})

// ── E2+：E2/E3 竞态兜底段的占位换键归因（不是终端出口，继续走完整链）────────

test('E2+ end 早于 spawn resolve → 归因到唯一占位：ops 顺序必须 bind 在前、改属主在后', () => {
  const r = fixture({
    type: undefined,
    ledgerRecord: undefined,
    routing: undefined,
    live: false,
    spawningCandidates: [{ parentId: 'parent-1', placeholderChildId: 'child-p1', agentType: 'hermes' }],
    info: { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done' }] },
  })
  assert.equal(r.decision, 'finalize', '归因成功后照常走收尾（E2+ 是链中段而非出口）')
  assert.deepEqual(opsOf(r), ['bind-spawning-child', 'set-child-owner'])
  assert.deepEqual(r.ops[0], { op: 'bind-spawning-child', parentId: 'parent-1', placeholderChildId: 'child-p1', childId: 'sess-1' })
  assert.deepEqual(r.ops[1], { op: 'set-child-owner', childId: 'sess-1', parentId: 'parent-1' })
  assert.equal(r.facts.ownerPid, 'parent-1', '属主改接为占位记录所在实例')
  assert.equal(r.facts.type, 'hermes', '工种取自占位记录')
  assert.equal(r.notices[0].target, 'log', '留痕一条，不发父会话通知')
  assert.match(r.notices[0].text, /arrived before spawn resolved; attributed to spawning record sess-1/)
  assert.equal(r.facts.conclusion, 'done')
})

test('E2+b 归因后活槽判定以改写后为准（不能被 hasLiveRecord 的旧快照误判成迟到 end）', () => {
  // live=false 是「归因前」的事实：占位换键后记录就在活槽里，若沿用旧值会被
  // 判成 E1 late-duplicate 或跳过重派评估（error 终局 + 有链时漏重派）。
  const r = fixture({
    type: undefined,
    ledgerRecord: undefined,
    routing: undefined,
    live: false,
    spawningCandidates: [{ parentId: 'parent-1', placeholderChildId: 'child-p1', agentType: 'hermes' }],
    info: { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] },
    failure: { message: 'boom', code: 'SERVER' },
  })
  assert.equal(r.decision, 'fallback-evaluation', '归因即入活槽，重派评估照常成立')
  assert.equal(opsOf(r).includes('add-fallback-guard'), true)
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
    'unattributable',
  ], '八条出口齐备（增删决策要在这里说明理由）')
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
  ]
  for (const { args } of scenarios) {
    const r = attributeEnd({ routing: { parentId: 'p' }, hasLiveRecord: () => true, ...args })
    seen.add(r.decision)
    assert.ok(['now', 'no', 'if-owned'].includes(r.facts.advance), `${r.decision} 的 advance 口径合法`)
  }
  assert.equal(seen.size, 8, `八条出口都要被这组场景打到，实际只到 ${[...seen].join(',')}`)
  assert.equal(shouldAdvanceQueue({ advance: 'now' }), true)
  assert.equal(shouldAdvanceQueue({ advance: 'no' }), false)
  assert.equal(shouldAdvanceQueue({ advance: undefined }), false, '漏登记 = 不推进（宁可冻结也不放行两个并行）')
})

test('attributeEnd 对畸形载荷不抛错（表状态缺项/载荷非对象都归到 ignore/unattributable）', () => {
  assert.equal(attributeEnd({}).decision, 'ignore')
  assert.equal(attributeEnd({ childId: 'x', info: null, routing: { parentId: 'p' }, type: 'hermes', hasLiveRecord: () => true }).decision, 'finalize')
  assert.equal(attributeEnd({ childId: 'x', info: { stopReason: 'completed', lastAssistantMessage: '不是数组' }, routing: { parentId: 'p' }, type: 'hermes', hasLiveRecord: () => true }).facts.conclusion, '(completed)')
})
