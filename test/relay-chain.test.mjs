/**
 * dsh-my-go — 接力链状态机直测（三期步骤 3.2）。
 *
 * 仿 end-attribution.test.mjs 的「表状态进、决策出」直测风格：relay-chain.mjs
 * 是纯函数模块，不起 ctx 替身——advanceChain 吃链记录与事件，吐
 * { decision, patch, ops, notices, facts }，全部出口逐条排列组合地验。
 *
 * 迁移编号与设计文档 docs/plans/relay-chain-semantics.md §2.2 迁移表 T1~T17
 * 一一对应；校验码与 §1.2 规则表 R-a~R-h 对应。三枚变异探针（P1 锁绕行词表
 * 封闭 / P2 真空清理留痕 / P3 回填时序防线）在文件尾，各自注明「删防线必红」
 * 的攻破面；R2/R4/R11 三枚接线层探针（broker 替身行为）归 3.4/3.5 施工批，
 * 本文件只锁纯函数面（见各探针注释的移交说明）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RELAY_CHAINS_CAP,
  RELAY_DECISIONS,
  advanceChain,
  createChain,
  isChainRow,
  matchChainForEnd,
  matchChainForWork,
  normalizeRestoredChain,
  reconcileHopDispatch,
  reconcileWorkEnqueued,
  validateChainDeclaration,
} from '../preset/shared/relay-chain.mjs'

// ── 夹具 ────────────────────────────────────────────────────────────────────
// 读→读 auto 两跳（T2 主路径）；读→读→写 review→sync 四跳（T3/T5/T6 主路径）；
// 末跳 sync 两跳（R-c 废除回归钉 + T4 前置）。prompt 用单字母便于断言 op 内容。
const DECL_AUTO2 = [
  { agent: 'explore', prompt: 'A' },
  { agent: 'librarian', prompt: 'B' },
]
const DECL_MIX4 = [
  { agent: 'explore', prompt: 'A' },
  { agent: 'librarian', prompt: 'B' },
  { agent: 'hermes', prompt: 'C', gate: 'review' },
  { agent: 'prometheus', gate: 'sync' },
]
const DECL_LASTSYNC = [
  { agent: 'explore', prompt: 'A' },
  { agent: 'prometheus', gate: 'sync' },
]

function freshChain(hops = DECL_AUTO2, over = {}) {
  return createChain({ id: 'chain-t', parentSessionId: 'pid-1', hops, now: 1000, ...over })
}

// 出生态链跑完 T1（首派），返回 { chain, r }——patch 已合入 chain 副本。
function started(hops = DECL_AUTO2, over = {}) {
  const chain = freshChain(hops, over)
  const r = advanceChain(chain, { type: 'start' }, 1001)
  return { chain: { ...chain, ...r.patch }, r }
}

// ── C 系：声明校验全表（§1.2 R-a 结构面 / R-b / R-d / R-e；R-f~R-h 归 3.3 工具层）──

test('C1: 合法声明——读→读→写 review→sync 四跳全过（末跳 sync 合法，R-c 废除回归钉）', () => {
  assert.deepEqual(validateChainDeclaration(DECL_MIX4), { ok: true, errors: [] })
  assert.deepEqual(validateChainDeclaration(DECL_LASTSYNC), { ok: true, errors: [] })
  // gate 缺省 = auto
  assert.deepEqual(validateChainDeclaration(DECL_AUTO2), { ok: true, errors: [] })
})

test('C2: 结构防御——非数组 / 长度越界 / 跳形态 / agent 空 / prompt 型 / gate 枚举', () => {
  assert.equal(validateChainDeclaration('nope').ok, false)
  assert.deepEqual(validateChainDeclaration([{ agent: 'explore', prompt: 'A' }]), { ok: false, errors: ['hops-length:1'] })
  assert.equal(validateChainDeclaration(Array.from({ length: 9 }, (_, i) => ({ agent: 'explore', prompt: String(i) }))).errors[0], 'hops-length:9')
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: 'A' }, 'x']).errors.includes('hop-shape:1'))
  assert.ok(validateChainDeclaration([{ agent: '  ', prompt: 'A' }, { agent: 'explore', prompt: 'B' }]).errors.includes('agent:0'))
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: 7 }, { agent: 'explore', prompt: 'B' }]).errors.includes('prompt-type:0'))
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: 'A', gate: 'yolo' }, { agent: 'explore', prompt: 'B' }]).errors.includes('gate-enum:0'))
  // 坏 shape / agent 短路：后续 gate 细则不再叠报（错误清单只到结构层）
  assert.deepEqual(validateChainDeclaration([null, { agent: 'explore', prompt: 'B' }]).errors, ['hop-shape:0'])
})

test('C3: 首跳 gate 非 auto 拒（R-b）；auto 缺 prompt 拒（R-d）', () => {
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: 'A', gate: 'review' }, { agent: 'librarian', prompt: 'B' }]).errors.includes('first-gate'))
  assert.ok(validateChainDeclaration([{ agent: 'explore' }, { agent: 'librarian', prompt: 'B' }]).errors.includes('auto-prompt:0'))
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: '   ' }, { agent: 'librarian', prompt: 'B' }]).errors.includes('auto-prompt:0'))
})

test('C4: auto lane 矩阵（R-e/D24 严格口径）——write 本跳 / write 上跳皆拒 auto', () => {
  // hop[1] 是 write（hermes）：explore→hermes 不得 auto
  assert.ok(validateChainDeclaration([{ agent: 'explore', prompt: 'A' }, { agent: 'hermes', prompt: 'B' }]).errors.includes('auto-lane:1'))
  // hop[1] 是 read 但 hop[0] 是 write：hermes→explore 不得 auto
  assert.ok(validateChainDeclaration([{ agent: 'hermes', prompt: 'A' }, { agent: 'explore', prompt: 'B' }]).errors.includes('auto-lane:1'))
  // write→write 同拒
  assert.ok(validateChainDeclaration([{ agent: 'hermes', prompt: 'A' }, { agent: 'prometheus', prompt: 'B' }]).errors.includes('auto-lane:1'))
  // review/sync 不受 lane 矩阵约束（write 跳走挂起是正路）
  assert.deepEqual(validateChainDeclaration([{ agent: 'hermes', prompt: 'A' }, { agent: 'prometheus', gate: 'sync' }]), { ok: true, errors: [] })
})

test('C5: createChain 防御性重跑校验——坏声明抛 TypeError；好声明产 running 初态', () => {
  assert.throws(() => createChain({ id: 'c', parentSessionId: 'p', hops: [{ agent: 'explore', prompt: 'A' }] }), TypeError)
  const c = freshChain()
  assert.equal(c.state, 'running')
  assert.equal(c.cursor, 0)
  assert.equal(c.hopWorkId, null)
  assert.equal(c.hopChildId, null)
  // gate 归一：缺省写死 auto（快照不可变口径）
  assert.equal(c.hops[0].gate, 'auto')
})

test('C6: RELAY_CHAINS_CAP = 32（D27 配套兜底常量，pin 值防手滑改动）', () => {
  assert.equal(RELAY_CHAINS_CAP, 32)
})

// ── T 系：迁移表逐行（§2.2 T1~T17）───────────────────────────────────────────

test('T1: start 首派——decision=hop-dispatch，ops 唯一成员 enqueue-hop 携 hopIndex=0/预写指令', () => {
  const chain = freshChain()
  const r = advanceChain(chain, { type: 'start' }, 1001)
  assert.equal(r.decision, 'hop-dispatch')
  assert.deepEqual(r.patch, { cursor: 0, state: 'running', suspendReason: null, updatedAt: 1001 })
  assert.equal(r.ops.length, 1)
  assert.deepEqual(r.ops[0], { op: 'enqueue-hop', chainId: 'chain-t', hopIndex: 0, agent: 'explore', instruction: 'A' })
  assert.deepEqual(r.notices, [])
  // 重复 start 防御：已派发（占位键非空）→ idle
  const dispatched = { ...chain, ...r.patch, hopWorkId: 'work-1' }
  assert.equal(advanceChain(dispatched, { type: 'start' }, 1002).decision, 'idle')
})

test('T2: auto 推进——cursor+1 保持 running，enqueue-hop 指向下一跳预写指令', () => {
  // 真实时序：end 到达前 spawn 已 resolve、hopChildId 已回填（reconcileHopDispatch）
  const { chain } = started()
  const live = { ...chain, hopChildId: 'sess-e1' }
  const r = advanceChain(live, { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'pass', conclusionExcerpt: 'done-A' }, 1002)
  assert.equal(r.decision, 'hop-dispatch')
  assert.deepEqual(r.patch, { cursor: 1, state: 'running', suspendReason: null, hopChildId: null, hopWorkId: null, prevHopChildId: 'sess-e1', updatedAt: 1002 })
  assert.deepEqual(r.ops[0], { op: 'enqueue-hop', chainId: 'chain-t', hopIndex: 1, agent: 'librarian', instruction: 'B' })
})

test('T3: review/sync 入闸挂起——cursor 推进指向待派发跳，hopChildId 置 null，通知带三档取文指引', () => {
  const { chain } = started(DECL_MIX4)
  // 跳 1（librarian, auto）合格 → cursor→2 挂起 review（链先经 spawn 回填；
  // 注意跳 0 合格走的是 T2 推进——下一跳 librarian 也是 auto）
  const mid = { ...chain, cursor: 1, hopChildId: 'sess-e1' }
  const r = advanceChain(mid, { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'pass', conclusionExcerpt: 'B 的结论' }, 1002)
  assert.equal(r.decision, 'suspend')
  assert.equal(r.patch.suspendReason, 'review')
  assert.equal(r.patch.cursor, 2)
  assert.equal(r.patch.hopChildId, null)
  const notice = r.notices[0]
  assert.equal(notice.target, 'owner')
  assert.equal(notice.parentId, 'pid-1')
  assert.match(notice.text, /挂起待审 \[review\]/)
  assert.match(notice.text, /report_fetch childId=sess-e1/)
  assert.match(notice.text, /chain_resolve/)
})

test('T4: 末跳合格 → complete，cursor 出界哨 = hops.length', () => {
  const chain = { ...freshChain(DECL_AUTO2), cursor: 1, hopChildId: 'sess-e2' }
  const r = advanceChain(chain, { type: 'hop-end', childId: 'sess-e2', endDecision: 'finalize', failed: false, reportGatePhase: 'pass', conclusionExcerpt: '末跳结论' }, 1003)
  assert.equal(r.decision, 'complete')
  assert.deepEqual(r.patch, { cursor: 2, state: 'done', suspendReason: null, hopChildId: null, hopWorkId: null, prevHopChildId: 'sess-e2', updatedAt: 1003 })
  assert.match(r.notices[0].text, /链 chain-t 完成（2 跳）/)
  assert.match(r.notices[0].text, /末跳 librarian/)
})

test('T5: resolve continue on review——现场 prompt 优先；缺现场回落预写', () => {
  const { chain } = started(DECL_MIX4)
  // 推到 review 挂起态（cursor=2, suspendReason=review）
  const suspended = { ...chain, cursor: 2, state: 'suspended', suspendReason: 'review' }
  const withPrompt = advanceChain(suspended, { type: 'resolve', decision: 'continue', prompt: '现场指令' }, 1004)
  assert.equal(withPrompt.decision, 'hop-dispatch')
  assert.deepEqual(withPrompt.patch, { cursor: 2, state: 'running', suspendReason: null, hopChildId: null, hopWorkId: null, updatedAt: 1004 })
  assert.equal(withPrompt.ops[0].instruction, '现场指令')
  assert.equal(withPrompt.ops[0].hopIndex, 2)
  // 无现场 → 预写 C
  const fromPrewritten = advanceChain(suspended, { type: 'resolve', decision: 'continue' }, 1004)
  assert.equal(fromPrewritten.ops[0].instruction, 'C')
})

test('T6: resolve continue on sync——现场必填（R-k），无现场拒绝（idle + prompt-required）', () => {
  const { chain } = started(DECL_MIX4)
  const suspended = { ...chain, cursor: 3, state: 'suspended', suspendReason: 'sync' }
  const refused = advanceChain(suspended, { type: 'resolve', decision: 'continue' }, 1004)
  assert.equal(refused.decision, 'idle')
  assert.equal(refused.facts.error, 'prompt-required')
  assert.deepEqual(refused.ops, [])
  assert.equal(refused.patch, null)
  // 有现场 → 放行（sync 跳无预写也是合法声明）
  const ok = advanceChain(suspended, { type: 'resolve', decision: 'continue', prompt: '亲笔指令' }, 1004)
  assert.equal(ok.decision, 'hop-dispatch')
  assert.equal(ok.ops[0].instruction, '亲笔指令')
  assert.equal(ok.ops[0].agent, 'prometheus')
})

test('T7: resolve abort——各挂起因皆可弃链，patch 置 aborted 且两键清空', () => {
  for (const reason of ['review', 'sync', 'fallback', 'input-missing', 'gate-verdict', 'restart']) {
    const chain = { ...freshChain(), cursor: 1, state: 'suspended', suspendReason: reason, hopChildId: reason === 'fallback' ? 'sess-new' : null }
    const r = advanceChain(chain, { type: 'resolve', decision: 'abort' }, 1005)
    assert.equal(r.decision, 'abort', reason)
    assert.equal(r.patch.state, 'aborted')
    assert.equal(r.patch.hopChildId, null, reason)
    assert.match(r.notices[0].text, /已由主编裁决取消于跳 2/)
  }
})

test('T8: fallback continue——settled 赛跑自查走推进核心 / unsettled 换绑等待（D10）', () => {
  const suspended = { ...freshChain(DECL_AUTO2), cursor: 0, state: 'suspended', suspendReason: 'fallback', hopChildId: 'sess-gen2' }
  // unsettled：resume，hopChildId 保持新世代
  const r1 = advanceChain(suspended, { type: 'resolve', decision: 'continue' }, 1006)
  assert.equal(r1.decision, 'resume')
  assert.deepEqual(r1.patch, { state: 'running', suspendReason: null, updatedAt: 1006 })
  assert.match(r1.notices[0].text, /已重绑世代 sess-gen2/)
  // settled（终局合格）：直接走 T2 推进（跳 0 终局 → cursor 1 派发）
  const r2 = advanceChain(suspended, { type: 'resolve', decision: 'continue', generationSettled: { endDecision: 'finalize', failed: false, reportGatePhase: 'pass', conclusionExcerpt: 'x' } }, 1006)
  assert.equal(r2.decision, 'hop-dispatch')
  assert.equal(r2.patch.cursor, 1)
  // settled（终局失败落账）：链死
  const r3 = advanceChain(suspended, { type: 'resolve', decision: 'continue', generationSettled: { endDecision: 'finalize', failed: true } }, 1006)
  assert.equal(r3.decision, 'fail')
  // settled（verdict 终局）：走 T16 挂起
  const r4 = advanceChain(suspended, { type: 'resolve', decision: 'continue', generationSettled: { endDecision: 'finalize', failed: false, reportGatePhase: 'verdict' } }, 1006)
  assert.equal(r4.decision, 'suspend')
  assert.equal(r4.patch.suspendReason, 'gate-verdict')
})

test('T9: input-missing / restart 的 continue = 重派 cursor 跳（现场 ?? 预写）', () => {
  for (const reason of ['input-missing', 'restart']) {
    const chain = { ...freshChain(DECL_AUTO2), cursor: 1, state: 'suspended', suspendReason: reason }
    const r = advanceChain(chain, { type: 'resolve', decision: 'continue' }, 1007)
    assert.equal(r.decision, 'hop-dispatch', reason)
    assert.equal(r.ops[0].hopIndex, 1, reason)
    assert.equal(r.ops[0].instruction, 'B', reason)
    assert.equal(r.patch.state, 'running')
  }
})

test('T10: hop-end fallback-evaluation → pending-fallback（瞬时态，无通知——E6 预告已发）', () => {
  const { chain } = started()
  const r = advanceChain({ ...chain, hopChildId: 'sess-e1' }, { type: 'hop-end', childId: 'sess-e1', endDecision: 'fallback-evaluation', failed: true }, 1008)
  assert.equal(r.decision, 'pending-fallback')
  assert.deepEqual(r.patch, { state: 'pending-fallback', updatedAt: 1008 })
  assert.deepEqual(r.notices, [])
})

test('T11: fallback-redeployed → suspend-fallback，hopChildId 换绑新世代（D10：绑 childId 不绑槽位）', () => {
  const pending = { ...started().chain, state: 'pending-fallback' }
  const r = advanceChain(pending, { type: 'fallback-redeployed', newChildId: 'sess-gen2' }, 1009)
  assert.equal(r.decision, 'suspend-fallback')
  assert.deepEqual(r.patch, { state: 'suspended', suspendReason: 'fallback', hopChildId: 'sess-gen2', hopWorkId: null, updatedAt: 1009 })
  assert.match(r.notices[0].text, /棒亡备选重派成功（新世代 sess-gen2）/)
  assert.match(r.notices[0].text, /\[fallback\]/)
  // 非 pending 态防御
  assert.equal(advanceChain(started().chain, { type: 'fallback-redeployed', newChildId: 'x' }, 1009).decision, 'idle')
})

test('T12: fallback-failed on pending-fallback → fail；非 pending 态 idle', () => {
  const pending = { ...started().chain, state: 'pending-fallback' }
  const r = advanceChain(pending, { type: 'fallback-failed', reason: '链尽' }, 1010)
  assert.equal(r.decision, 'fail')
  assert.equal(r.patch.state, 'failed')
  assert.match(r.notices[0].text, /备选链评估终局为失败落账/)
  assert.equal(advanceChain(started().chain, { type: 'fallback-failed' }, 1010).decision, 'idle')
})

test('T13: hop-end finalize + failed（无备选链失败落账）→ fail', () => {
  const { chain } = started()
  const r = advanceChain({ ...chain, hopChildId: 'sess-e1' }, { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: true, conclusionExcerpt: '爆了' }, 1011)
  assert.equal(r.decision, 'fail')
  assert.equal(r.patch.state, 'failed')
  assert.match(r.notices[0].text, /失败于跳 1 \(explore\)/)
})

test('T14: queue-dropped——hopWorkId 匹配才 fail，不匹配 idle（T14 匹配键防线）', () => {
  const queued = { ...started().chain, hopWorkId: 'work-9' }
  const r = advanceChain(queued, { type: 'queue-dropped', workId: 'work-9', reason: '3 attempts' }, 1012)
  assert.equal(r.decision, 'fail')
  assert.match(r.notices[0].text, /队列派发重试放弃/)
  // workId 不符（他链的 work）→ idle
  assert.equal(advanceChain(queued, { type: 'queue-dropped', workId: 'work-other' }, 1012).decision, 'idle')
  // 无占位键（已上岗回填）→ idle
  assert.equal(advanceChain(started().chain, { type: 'queue-dropped', workId: 'work-9' }, 1012).decision, 'idle')
})

test('T15: hop-end report-gate-repair → hold（idle，无 patch 无 ops——闸门补发轮在飞，链冻结）', () => {
  const { chain } = started()
  const r = advanceChain({ ...chain, hopChildId: 'sess-e1' }, { type: 'hop-end', childId: 'sess-e1', endDecision: 'report-gate-repair' }, 1013)
  assert.equal(r.decision, 'idle')
  assert.equal(r.patch, null)
  assert.deepEqual(r.ops, [])
})

test('T16: hop-end verdict（补发后仍不合格）→ suspended(gate-verdict)，cursor 推进（D22 案 a）', () => {
  const { chain } = started(DECL_AUTO2)
  const r = advanceChain({ ...chain, hopChildId: 'sess-e1' }, { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'verdict' }, 1014)
  assert.equal(r.decision, 'suspend')
  assert.deepEqual(r.patch, { cursor: 1, state: 'suspended', suspendReason: 'gate-verdict', hopChildId: null, hopWorkId: null, prevHopChildId: 'sess-e1', updatedAt: 1014 })
  assert.match(r.notices[0].text, /\[gate-verdict\]/)
  assert.match(r.notices[0].text, /带病续链/)
  // gate-verdict 的 continue = 带病派发下一跳
  const resumed = advanceChain({ ...chain, ...r.patch }, { type: 'resolve', decision: 'continue' }, 1015)
  assert.equal(resumed.decision, 'hop-dispatch')
  assert.equal(resumed.ops[0].hopIndex, 1)
})

test('X1: 非法组合矩阵——跨态事件一律 idle 且 patch/ops 全空（宁可不动不猜）', () => {
  const running = started().chain
  const suspended = { ...running, state: 'suspended', suspendReason: 'review' }
  const done = { ...running, state: 'done' }
  // hop-end 打在 suspended/done
  assert.equal(advanceChain(suspended, { type: 'hop-end', childId: 'x', endDecision: 'finalize', failed: false }).decision, 'idle')
  assert.equal(advanceChain(done, { type: 'hop-end', childId: 'x', endDecision: 'finalize', failed: false }).decision, 'idle')
  // resolve 打在 running/pending/done
  assert.equal(advanceChain(running, { type: 'resolve', decision: 'continue' }).decision, 'idle')
  assert.equal(advanceChain({ ...running, state: 'pending-fallback' }, { type: 'resolve', decision: 'continue' }).decision, 'idle')
  assert.equal(advanceChain(done, { type: 'resolve', decision: 'abort' }).decision, 'idle')
  // input-missing 打在非 running
  assert.equal(advanceChain(suspended, { type: 'input-missing' }).decision, 'idle')
  // hop-end childId 不匹配（E1 幽灵防线）：旧世代 end 不推进
  assert.equal(advanceChain(running, { type: 'hop-end', childId: 'sess-dead', endDecision: 'finalize', failed: false }).decision, 'idle')
  // 未知事件类型 / 坏输入
  assert.equal(advanceChain(running, { type: 'wat' }).decision, 'idle')
  assert.equal(advanceChain(null, { type: 'start' }).decision, 'idle')
  // idle 决策恒无 patch 无 ops（X1 复合断言）
  for (const r of [advanceChain(suspended, { type: 'hop-end', childId: 'x', endDecision: 'finalize' }, 1), advanceChain(running, { type: 'resolve', decision: 'continue' }, 1)]) {
    assert.equal(r.patch, null)
    assert.deepEqual(r.ops, [])
  }
})

test('X2: decision 词表封闭——RELAY_DECISIONS 全登记（新增决策不登记的分支写不出来）', () => {
  const seen = new Set()
  // 遍历三个代表性链态 × 全事件型，收集出现过的 decision
  const chains = [
    started().chain,
    { ...started().chain, state: 'pending-fallback' },
    { ...started().chain, state: 'suspended', suspendReason: 'review', cursor: 1 },
    { ...started().chain, state: 'suspended', suspendReason: 'fallback', hopChildId: 'g2' },
    { ...started().chain, state: 'done' },
  ]
  const events = [
    { type: 'start' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'pass' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'fallback-evaluation', failed: true },
    { type: 'resolve', decision: 'continue' },
    { type: 'resolve', decision: 'abort' },
    { type: 'fallback-redeployed', newChildId: 'g2' },
    { type: 'fallback-failed' },
    { type: 'queue-dropped', workId: 'work-1' },
    { type: 'input-missing' },
    { type: 'dispose' },
  ]
  for (const c of chains) for (const e of events) seen.add(advanceChain(c, e, 1).decision)
  for (const d of seen) assert.ok(RELAY_DECISIONS.includes(d), `未登记决策: ${d}`)
})

// ── 匹配 / 回填契约（调用方协议第 1 条 + §4.2-① 时序窗口的纯函数面）────────────

test('M1: matchChainForEnd——running+hopChildId 精确命中；未回填/非 running/旧世代恒不命中', () => {
  const chains = [
    started().chain, // running, hopChildId=null（未回填窗口）
    { ...started().chain, hopChildId: 'sess-a' }, // running 已回填
    { ...started().chain, state: 'suspended', suspendReason: 'review' }, // 非 running
  ]
  assert.equal(matchChainForEnd(chains, 'sess-a'), chains[1])
  // P3 防线本体：未回填（hopChildId=null）对任何 childId 不命中——「先回填后认领」
  // 时序契约的匹配面（变异：删 c.hopChildId===childId 条件 → 本断言红）
  assert.equal(matchChainForEnd(chains, 'sess-e1'), undefined)
  assert.equal(matchChainForEnd(chains, undefined), undefined)
  assert.equal(matchChainForEnd(chains, ''), undefined)
  assert.equal(matchChainForEnd([], 'sess-a'), undefined)
})

test('M2: reconcileWorkEnqueued / reconcileHopDispatch——前置校验 + 幂等（绝不覆盖）', () => {
  const chain = started().chain
  // 回填 A：enqueue 落地
  assert.deepEqual(reconcileWorkEnqueued(chain, 'work-7', 2000), { hopWorkId: 'work-7', updatedAt: 2000 })
  const enqueued = { ...chain, hopWorkId: 'work-7' }
  assert.equal(reconcileWorkEnqueued(enqueued, 'work-8', 2001), null) // 已有占位键不覆盖
  // 回填 B：workId 不符 → null
  assert.equal(reconcileHopDispatch(enqueued, { workId: 'work-x', childId: 'sess-r', now: 2002 }), null)
  // 回填 B 正路：真 id 落位 + 占位键清空
  assert.deepEqual(reconcileHopDispatch(enqueued, { workId: 'work-7', childId: 'sess-r', now: 2002 }), { hopChildId: 'sess-r', hopWorkId: null, updatedAt: 2002 })
  const reconciled = { ...enqueued, hopChildId: 'sess-r', hopWorkId: null }
  assert.equal(reconcileHopDispatch(reconciled, { workId: 'work-7', childId: 'sess-r2', now: 2003 }), null) // 二次调用幂等
  // 非 running 态 / 坏入参防御
  assert.equal(reconcileHopDispatch({ ...reconciled, state: 'suspended' }, { workId: 'w', childId: 'c' }), null)
  assert.equal(reconcileHopDispatch(reconciled, { workId: 'work-7', childId: '' }), null)
})

// ── D27 dispose：桶删双留痕（patch + notice；台账删桶与 metrics 由 dispatcher 落地）──

test('P2(探针): dispose——终态内外皆可清，patch=aborted + 留痕 notice 必在（删 notice 本断言红）', () => {
  for (const over of [{}, { state: 'suspended', suspendReason: 'review', cursor: 1 }, { state: 'done', cursor: 2 }]) {
    const chain = { ...started(DECL_AUTO2).chain, ...over }
    const r = advanceChain(chain, { type: 'dispose' }, 3000)
    assert.equal(r.decision, 'aborted-by-dispose')
    assert.equal(r.patch.state, 'aborted')
    assert.equal(r.patch.hopChildId, null)
    assert.equal(r.notices.length, 1, 'D27 留痕：dispose 必发一行清理通知')
    assert.match(r.notices[0].text, /aborted-by-dispose/)
    assert.equal(r.facts.phase, 'aborted-by-dispose')
  }
})

// ── 台账 v3 恢复归一（D12/D27/D28）───────────────────────────────────────────

const ROW_OK = {
  id: 'chain-r', parentSessionId: 'pid-1',
  hops: [{ agent: 'explore', prompt: 'A', gate: 'auto' }, { agent: 'librarian', prompt: 'B', gate: 'auto' }],
  cursor: 1, state: 'suspended', suspendReason: 'review',
  hopWorkId: null, hopChildId: null, createdAt: 1, updatedAt: 2,
}

test('R1: isChainRow——合法行过；坏行族（缺字段/坏枚举/越界 cursor/坏键型）整行拒', () => {
  assert.equal(isChainRow(ROW_OK), true)
  assert.equal(isChainRow(null), false)
  assert.equal(isChainRow({ ...ROW_OK, id: '' }), false)
  assert.equal(isChainRow({ ...ROW_OK, state: 'wat' }), false)
  assert.equal(isChainRow({ ...ROW_OK, hops: [] }), false)
  assert.equal(isChainRow({ ...ROW_OK, cursor: 99 }), false)
  assert.equal(isChainRow({ ...ROW_OK, suspendReason: 'wat' }), false)
  assert.equal(isChainRow({ ...ROW_OK, hopChildId: 42 }), false)
  assert.equal(isChainRow({ ...ROW_OK, hops: [{ agent: '', gate: 'auto' }, { agent: 'x', gate: 'auto' }] }), false)
})

test('R2: normalizeRestoredChain——running→restart / pending→failed（D28 归一口径）', () => {
  const r1 = normalizeRestoredChain({ ...ROW_OK, state: 'running', suspendReason: null, hopWorkId: 'work-1', hopChildId: 'sess-1' }, { now: 5000 })
  assert.equal(r1.state, 'suspended')
  assert.equal(r1.suspendReason, 'restart')
  assert.equal(r1.hopWorkId, null)
  assert.equal(r1.hopChildId, null)
  const r2 = normalizeRestoredChain({ ...ROW_OK, state: 'pending-fallback', suspendReason: null, hopChildId: 'sess-dead' }, { now: 5000 })
  assert.equal(r2.state, 'failed')
  assert.equal(r2.suspendReason, null)
  assert.equal(r2.hopChildId, null)
})

test('R3: suspended(fallback) 恢复——代际已终局保留 hopChildId（T8 自查键精化）；未终局归 restart 防真空', () => {
  const row = { ...ROW_OK, state: 'suspended', suspendReason: 'fallback', hopChildId: 'sess-gen2' }
  const settled = normalizeRestoredChain(row, { hasSettledGeneration: (id) => id === 'sess-gen2', now: 5000 })
  assert.equal(settled.suspendReason, 'fallback')
  assert.equal(settled.hopChildId, 'sess-gen2')
  const unsettled = normalizeRestoredChain(row, { hasSettledGeneration: () => false, now: 5000 })
  assert.equal(unsettled.suspendReason, 'restart')
  assert.equal(unsettled.hopChildId, null)
  // 谓词缺省 = 保守未终局（接线方忘传谓词时宁可重派不可真空）
  const defaultPred = normalizeRestoredChain(row, { now: 5000 })
  assert.equal(defaultPred.suspendReason, 'restart')
})

test('R4: 恢复原样族与防 mutate——suspended(其他)/done 原样保留口径，输入行零污染', () => {
  const row = { ...ROW_OK, hopWorkId: 'work-1' }
  const snapshot = JSON.stringify(row)
  const r = normalizeRestoredChain(row, { now: 5000 })
  assert.equal(r.state, 'suspended')
  assert.equal(r.suspendReason, 'review') // 非 fallback 挂起原样保留
  assert.equal(r.hopWorkId, null) // 运行时键恒作废
  assert.equal(r.cursor, 1)
  assert.equal(JSON.stringify(row), snapshot)
  const doneRow = normalizeRestoredChain({ ...ROW_OK, state: 'done', suspendReason: null, cursor: 2 }, { now: 5000 })
  assert.equal(doneRow.state, 'done')
  assert.equal(doneRow.hopChildId, null)
  assert.equal(normalizeRestoredChain({ ...ROW_OK, hops: 'bad' }), null)
})

// ── P1 探针：锁绕行的结构面——ops 词表封闭性（INV-1）───────────────────────────
// 攻破面：任何人给 advanceChain 增加「直派」类 op（start-child/dispatch 之类），
// 本遍历断言必红——链请求派发只有 enqueue-hop 一条通道，泳道锁在 advanceQueue
// 内判定，链侧不存在绕行入口。（接线层探针 R2「write 满时链 hop 入队不上岗」
// 归 3.4 broker 替身批；本探针锁的是纯函数面的词表封闭，两层互补。）
test('P1(探针): 全 (链态×事件) 组合遍历——ops 词表 ⊆ {enqueue-hop}，直派通道不存在', () => {
  const chains = [
    freshChain(),
    started().chain,
    { ...started().chain, hopWorkId: 'work-1' },
    { ...started().chain, state: 'pending-fallback' },
    { ...started().chain, state: 'suspended', suspendReason: 'review', cursor: 1 },
    { ...started().chain, state: 'suspended', suspendReason: 'sync', cursor: 1 },
    { ...started().chain, state: 'suspended', suspendReason: 'fallback', hopChildId: 'g2' },
    { ...started().chain, state: 'suspended', suspendReason: 'gate-verdict', cursor: 1 },
    { ...started().chain, state: 'suspended', suspendReason: 'input-missing', cursor: 1 },
    { ...started().chain, state: 'suspended', suspendReason: 'restart', cursor: 1 },
    { ...started().chain, state: 'done', cursor: 2 },
    { ...started().chain, state: 'failed' },
    { ...started().chain, state: 'aborted' },
  ]
  const events = [
    { type: 'start' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'pass' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: true },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'finalize', failed: false, reportGatePhase: 'verdict' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'fallback-evaluation', failed: true },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'report-gate-repair' },
    { type: 'hop-end', childId: 'sess-e1', endDecision: 'expected-abort' },
    { type: 'resolve', decision: 'continue' },
    { type: 'resolve', decision: 'continue', prompt: 'P' },
    { type: 'resolve', decision: 'continue', generationSettled: { endDecision: 'finalize', failed: false, reportGatePhase: 'pass' } },
    { type: 'resolve', decision: 'abort' },
    { type: 'fallback-redeployed', newChildId: 'g2' },
    { type: 'fallback-failed' },
    { type: 'queue-dropped', workId: 'work-1' },
    { type: 'input-missing' },
    { type: 'dispose' },
    { type: 'wat' },
  ]
  let opsSeen = 0
  for (const c of chains) {
    for (const e of events) {
      const r = advanceChain(c, e, 1)
      for (const op of r.ops) {
        opsSeen += 1
        assert.equal(op.op, 'enqueue-hop', `词表外 op 出现: ${op.op}（state=${c.state}, event=${e.type}）`)
        assert.equal(typeof op.hopIndex, 'number')
        assert.equal(typeof op.agent, 'string')
        assert.equal(typeof op.instruction, 'string')
        assert.ok(op.instruction.trim() !== '', 'enqueue-hop 的 instruction 恒非空（R-d/R-k 校验面）')
      }
    }
  }
  assert.ok(opsSeen > 0, '遍历必须真实覆盖 op 产出路径')
})
