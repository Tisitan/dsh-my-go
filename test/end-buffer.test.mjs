// 二期 2.4 E2 end 缓冲重放 + R2.3 复合键行为批（read-pool-semantics.md §4/§5）。
// 三红线主测试锚定：T1 幽灵（抢跑 end 不再丢失/错归，重放走全管线落账）、
// T3 真空（缓冲超时 + 占位审计回收三连：failed 落账/retireChild/advanceQueue
// 解冻，缺一则队列冻结）、T6 双份（pendingFallbackByLabel 复合键 token 各异，
// 并发双重派互不覆盖）。变异探针实测见完工报告。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, waitFor } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-e2buf-home-'))

function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-e2buf-home-', ...options })
}

const parent = { id: 'parent-1', session: { header: {} } }
const agentsMock = { get: (id) => ({ 'parent-1': parent })[id] }

test('T1 E2 抢跑 end 缓冲重放·成功终局（幽灵防线主测试）：登记追上后按真 id 重放落账', async () => {
  let releaseSpawn
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract((spec) => new Promise((resolve) => {
      releaseSpawn = () => resolve({ childId: 'sess-1' })
    })),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 5000 })
  const goWork = tools.get('go_work')
  const goPromise = goWork.execute({ agent: 'explore', prompt: '读任务' }, execOf(parent)) // spawn pending
  await waitFor(() => releaseSpawn !== undefined, { what: 'spawn 已挂起在占位窗口' })
  // end 抢跑：此刻 sessionTypes/墓碑/台账/childOwner 全无（真 E2 场景）
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '抢跑的结论' }] })
  assert.equal(snapOf('parent-1')?.history?.length ?? 0, 0, '缓冲闸：抢跑 end 既不猜测归因也不丢弃，暂存待认领')
  releaseSpawn()
  await goPromise
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '登记追上后认领重放，全管线落账' })
  assert.equal(snapOf('parent-1').history[0].childId, 'sess-1')
  assert.equal(snapOf('parent-1').history[0].conclusion, '抢跑的结论', '重放携带原载荷正文（end 不丢失）')
})

test('T2 抢跑重放走全管线·失败终局：error 载荷经重放按失败落账（E7 失败分支生效）', async () => {
  let releaseSpawn
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract((spec) => new Promise((resolve) => {
      releaseSpawn = () => resolve({ childId: 'sess-1' })
    })),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 5000 })
  const goPromise = tools.get('go_work').execute({ agent: 'explore', prompt: '会挂的读' }, execOf(parent))
  await waitFor(() => releaseSpawn !== undefined, { what: 'spawn 挂起' })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  releaseSpawn()
  await goPromise
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '失败终局重放落账' })
  const rec = snapOf('parent-1').history[0]
  assert.equal(rec.status, 'failed', '重放不是只认 completed：error 终局按失败分支落账')
  assert.equal(rec.conclusion, '(error)', '无正文时按 stopReason 落档（baseConclusion 口径）')
})

test('T3 E2 缓冲超时 + 占位审计回收三连（真空防线主测试）：failed 落账/retire/advanceQueue 一个不少', async () => {
  const spawns = []
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    // 永不 resolve：模拟 spawn 链无进展（占位滞留 spawning 的前提）。计数照记。
    startContinuable: withRealSignalContract((spec) => {
      spawns.push(spec?.request?.prompt?.[0]?.text ?? '')
      return new Promise(() => {})
    }),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, { readPoolSize: 2, reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 50 })
  const goWork = tools.get('go_work')
  void goWork.execute({ agent: 'explore', prompt: '挂死读A' }, execOf(parent)) // sess-1，永不 resolve
  void goWork.execute({ agent: 'librarian', prompt: '挂死读B' }, execOf(parent)) // sess-2，永不 resolve
  const q = await goWork.execute({ agent: 'explore', prompt: '排队读C' }, execOf(parent)) // read 满 → queued
  assert.equal(q.status, 'queued')
  // 抢跑 end：sess-1 的 end 到达但 spawn 永不 resolve（4.2 泄漏场景的原料）
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'x' }] })
  // grace(50ms) 后：缓冲条目落档 + 审计回收两条滞留占位（failed 落账三连）→ 队列解冻放行 C
  await waitFor(() => snapOf('parent-1')?.history?.filter((r) => r.status === 'failed')?.length === 2, { what: '两条滞留占位被审计回收并 failed 落账' })
  await waitFor(() => spawns.length === 3, { what: 'advanceQueue 解冻：排队读C 上岗（三连缺一即冻结）' })
  assert.equal(spawns[2], '排队读C')
  assert.ok(snapOf('parent-1').history.every((r) => r.conclusion?.includes('spawning placeholder recovered')), '回收口径点名占位审计')
})

test('T4 缓冲 cap=16 封顶：超出丢弃最旧并留痕（异常风暴兜底）', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const { ctx, dispatch } = mockCtxFull({
      agents: agentsMock,
      startContinuable: withRealSignalContract(async () => ({ childId: 'sess-never' })),
    })
    await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 5000 })
    for (let i = 1; i <= 17; i++) dispatch('subagent/end', { id: `ghost-${i}`, stopReason: 'completed', lastAssistantMessage: [] })
  } finally {
    console.warn = origWarn
  }
  assert.equal(warnings.filter((w) => w.includes('buffered awaiting spawn registration')).length, 17, '17 条全部留痕受理')
  assert.ok(warnings.some((w) => w.includes('end buffer cap (16) exceeded')), '第 17 条触发最旧驱逐')
})

test('T5 同 childId 双发抢跑：缓冲覆盖保留最新载荷，重放不双落账', async () => {
  let releaseSpawn
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract((spec) => new Promise((resolve) => {
      releaseSpawn = () => resolve({ childId: 'sess-1' })
    })),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 5000 })
  const goPromise = tools.get('go_work').execute({ agent: 'explore', prompt: '读' }, execOf(parent))
  await waitFor(() => releaseSpawn !== undefined, { what: 'spawn 挂起' })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '第一发' }] })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '第二发' }] })
  releaseSpawn()
  await goPromise
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '重放恰好一次落账' })
  assert.equal(snapOf('parent-1').history.length, 1, '双发只重放一次（认领即删条目）')
  assert.equal(snapOf('parent-1').history[0].conclusion, '第二发', '覆盖语义保留最新载荷')
})

test('T6 R2.3 复合键：连发双重派的 pending label 各含独立 spawnToken（双份防线主测试）', async () => {
  const labels = []
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    llm: { listModels: async (pid) => (pid === 'p1' ? [{ id: 'm1' }] : pid === 'p2' ? [{ id: 'm2' }] : []) },
    startContinuable: withRealSignalContract(async (spec) => {
      labels.push(spec?.label ?? '')
      return { childId: `sess-${labels.length}` }
    }),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, {
    reportExternalization: false,
    queueRetryBaseMs: 5,
    bindings: { hermes: { fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] } },
  })
  const goWork = tools.get('go_work')
  await goWork.execute({ agent: 'hermes', prompt: '同一份任务' }, execOf(parent)) // sess-1
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => labels.length === 2, { what: '第一跳备选重派' })
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => labels.length === 3, { what: '第二跳备选重派（attempt 递增至链尾）' })
  const [l1, l2] = labels.slice(1)
  assert.ok(l1.startsWith('dsh-my-go:hermes: 同一份任务#child-'), `重派 label 内嵌 spawnToken（got: ${l1}）`)
  assert.ok(l2.startsWith('dsh-my-go:hermes: 同一份任务#child-'), `第二跳同样内嵌 spawnToken（got: ${l2}）`)
  assert.notEqual(l1, l2, 'token 各异 → pendingFallbackByLabel 键天然不冲突：并发双重派后写不再覆盖先写（R2.3）')
  assert.equal(labels[0], 'dsh-my-go:hermes: 同一份任务', '首派 label 不带 token（只有重派窗口需要）')
})
