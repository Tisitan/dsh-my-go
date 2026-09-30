// 在飞回收竞态与审计边界（P1/P2 发版前修复）的回归锚。
//   P1：E2 泄漏哨兵按年龄回收「spawning 占位」时，该占位的派发可能仍在飞（冷读慢，
//       实测 56~145ms）。收口要求：迟到落地后真子代必须被重新登记在册——结论按真 id
//       归因、lane 槽位计入、台账不留与事实相反的 failed。
//   P2：审计判定式取 >=（达 grace 即回收）——严格大于口径下「createdAt = now-graceMs」
//       的占位在边界毫秒上会被漏收，而审计只由 end 缓冲到期触发一次，漏收即可能再无
//       重试机会（实测 60 次边界抽样 59 次跳过）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createEndBufferOps } from '../preset/tools/broker-endbuffer.mjs'
import { Orchestration, bindSpawnedChild } from '../preset/shared/orchestration.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, waitFor } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-reclaim-home-'))

const parent = { id: 'parent-1', session: { header: {} } }
const agentsMock = { get: (id) => ({ 'parent-1': parent })[id] }

const GRACE = 50

// 审计直调装置（注入确定性时钟）：与生产挂载同形，只把时钟换成 now。
function auditRig({ ageMs, at = 1000 }) {
  const calls = []
  const rec = { childId: 'child-audit-1', agentType: 'explore', status: 'spawning', createdAt: at - ageMs }
  const orch = {
    currentMap: new Map([[rec.childId, rec]]),
    finish: (id, conclusion, failed) => { calls.push({ op: 'finish', id, conclusion, failed }); orch.currentMap.delete(id); return { childId: id } },
  }
  const ops = createEndBufferOps({
    graceMs: GRACE,
    now: () => at,
    metrics: { record: () => {} },
    orchestrations: new Map([['parent-1', orch]]),
    abortExpected: new Map(),
    childRegistry: { retireChild: (id) => calls.push({ op: 'retireChild', id }) },
    notifyClearedHelp: () => {},
    bump: () => calls.push({ op: 'bump' }),
    advanceQueue: () => calls.push({ op: 'advanceQueue' }),
  })
  ops.auditStaleSpawningPlaceholders()
  return calls
}

test('P2 审计边界：年龄恰好 == graceMs 即回收（>= 口径），年轻 1ms 不回收、年长 1ms 回收', () => {
  const atBoundary = auditRig({ ageMs: GRACE })
  assert.deepEqual(atBoundary.map((c) => c.op), ['finish', 'retireChild', 'bump', 'advanceQueue'], '边界毫秒必须走完整三连（failed 落账/retire/advanceQueue 解冻）')
  assert.equal(atBoundary[0].failed, true, '边界回收按失败落账')
  assert.ok(atBoundary[0].conclusion.includes('spawning placeholder recovered'), '回收口径点名占位审计')
  assert.deepEqual(auditRig({ ageMs: GRACE + 1 }).map((c) => c.op), ['finish', 'retireChild', 'bump', 'advanceQueue'], '年长 1ms 同样回收')
  assert.deepEqual(auditRig({ ageMs: GRACE - 1 }), [], '年轻 1ms 不回收（哨兵不得误伤未到期占位）')
})

test('P2 审计边界（真时钟抽样）：createdAt = now-graceMs 的占位 60/60 全回收', () => {
  const recovered = []
  for (let i = 0; i < 60; i++) {
    const calls = []
    const at = Date.now()
    const rec = { childId: 'child-audit-rt', agentType: 'explore', status: 'spawning', createdAt: at - GRACE }
    const orch = {
      currentMap: new Map([[rec.childId, rec]]),
      finish: (id) => { calls.push('finish'); orch.currentMap.delete(id); return { childId: id } },
    }
    createEndBufferOps({
      graceMs: GRACE,
      metrics: { record: () => {} },
      orchestrations: new Map([['parent-1', orch]]),
      abortExpected: new Map(),
      childRegistry: { retireChild: () => calls.push('retireChild') },
      notifyClearedHelp: () => {},
      bump: () => {},
      advanceQueue: () => {},
    }).auditStaleSpawningPlaceholders()
    if (calls.includes('finish')) recovered.push(i)
  }
  assert.equal(recovered.length, 60, `边界毫秒漏收会导致泄漏哨兵失效（修复前该抽样约 1/60 命中）；实测 ${recovered.length}/60`)
})

test('P1 在飞回收竞态：占位被哨兵回收后 spawn 才落地 → 真子代重新登记在册，结论不丢、台账不留假 failed', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.map(String).join(' '))
  try {
    let release
    const { ctx, dispatch, tools } = createMockCtx({
      agents: agentsMock,
      startContinuable: withRealSignalContract(() => new Promise((resolve) => {
        release = () => resolve({ childId: 'sess-late' })
      })),
      subagentsExtra: { followup: async () => 'msg-x' },
    })
    await broker.apply(ctx, { readPoolSize: 2, reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 20 })
    const goWork = tools.get('go_work')
    const dispatchedAt = Date.now()
    void goWork.execute({ agent: 'explore', prompt: '迟到读A' }, execOf(parent))
    await waitFor(() => release !== undefined, { what: 'spawn 已挂起在占位窗口' })
    await waitFor(() => Date.now() - dispatchedAt >= 40, { what: '占位成龄（>= graceMs，审计可判 stale）' })
    dispatch('subagent/end', { id: 'ghost-x', stopReason: 'completed', lastAssistantMessage: [] })
    await waitFor(() => snapOf('parent-1')?.history?.some((r) => r.status === 'failed'), { what: '哨兵回收滞留占位（failed 落账）' })
    assert.equal(snapOf('parent-1').currentRecords.length, 0, '回收后槽位已腾空')
    release()
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-late' && r.status === 'running'), { what: '迟到落地后真子代重新登记在册' })
    assert.equal(snapOf('parent-1').currentRecords.filter((r) => r.childId === 'sess-late').length, 1, '同一真子代只登记一次（不重复上岗）')
    assert.equal(snapOf('parent-1').history.filter((r) => r.status === 'failed').length, 0, '与事实相反的 failed 记录随复活撤回')
    assert.ok(!warnings.some((w) => w.includes('bindChild failed')), '不再有 bindChild failed / untracked')
    assert.ok(warnings.some((w) => w.includes('re-adopted into tracking')), '复活收口留痕可见')
    dispatch('subagent/end', { id: 'sess-late', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '迟到的结论' }] })
    await waitFor(() => snapOf('parent-1')?.history?.some((r) => r.childId === 'sess-late' && r.status === 'done'), { what: '迟到子代的结论按真 id 落账' })
    assert.equal(snapOf('parent-1').history.find((r) => r.childId === 'sess-late').conclusion, '迟到的结论', '结论正文完整归因（不丢弃）')
    assert.ok(!warnings.some((w) => w.includes('no live record')), '不再有 no live record / conclusion dropped')
  } finally {
    console.warn = origWarn
  }
})

test('P1 正常路径零变化：spawn 及时落地 → 原样换键，无复活留痕、台账不产生记录', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.map(String).join(' '))
  try {
    const { ctx, tools } = createMockCtx({
      agents: agentsMock,
      startContinuable: withRealSignalContract(async () => ({ childId: 'sess-ok' })),
      subagentsExtra: { followup: async () => 'msg-x' },
    })
    await broker.apply(ctx, { readPoolSize: 2, reportExternalization: false, queueRetryBaseMs: 5, spawnEndGraceMs: 5000 })
    await tools.get('go_work').execute({ agent: 'explore', prompt: '准时读A' }, execOf(parent))
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-ok' && r.status === 'running'), { what: '占位原地换键为真 childId' })
    assert.equal(snapOf('parent-1').currentRecords.length, 1, '槽位语义不变：恰一条在飞')
    assert.equal(snapOf('parent-1').currentRecords[0].prompt, '准时读A', '记录沿用原占位字段（prompt/createdAt 不重造）')
    assert.equal(snapOf('parent-1').history.length, 0, '正常路径零台账增量')
    assert.ok(!warnings.some((w) => w.includes('re-adopted into tracking')), '正常路径不触发复活收口')
  } finally {
    console.warn = origWarn
  }
})

test('bindSpawnedChild 三分流（单测）：在册原地换键 / 落账型回收复活并撤回假 failed / 无史回收按 extra 重建占位', () => {
  const fresh = (extra = {}) => {
    const orch = new Orchestration({ readCapacity: 2 })
    const ph = orch.beginSpawning('explore', '任务', extra)
    return { orch, ph }
  }
  // ① 占位在册：原样换键，台账零增量，lane 计入
  const a = fresh()
  bindSpawnedChild(a.orch, a.ph, 'sess-live', 'explore', '任务')
  assert.equal(a.orch.currentMap.get('sess-live')?.status, 'running', '真 childId 在册为 running')
  assert.equal(a.orch.currentMap.has(a.ph.childId), false, '占位键已换走')
  assert.equal(a.orch.history.length, 0, '正常分支零台账增量')
  assert.equal(a.orch.laneCount('read'), 1, 'lane 计入')
  // ② 落账型回收（泄漏哨兵 finish 过）：复活回槽 + 换键 + 那条假 failed 撤回
  const b = fresh()
  b.orch.finish(b.ph.childId, 'spawning placeholder recovered: spawn did not resolve within 50ms', true)
  assert.equal(b.orch.history.length, 1, '回收已落一条 failed 史')
  bindSpawnedChild(b.orch, b.ph, 'sess-late', 'explore', '任务')
  assert.equal(b.orch.history.length, 0, '与事实相反的 failed 随复活撤回')
  assert.equal(b.orch.currentMap.get('sess-late')?.status, 'running', '真 childId 在册为 running')
  assert.equal(b.orch.laneCount('read'), 1, '回收腾出的槽位因收养重新计入')
  // ③ 无史回收（disposed 兜底 abort / 容量淘汰）：按 extra 重建占位再换键，链状态不丢
  const c = fresh({ fallbackAttempt: 2, fallbackEntry: { provider: 'p2', model: 'm2' } })
  c.orch.abort(c.ph.childId)
  assert.equal(c.orch.currentMap.size, 0, 'abort 后占位无史消失')
  bindSpawnedChild(c.orch, c.ph, 'sess-redeploy', 'hermes', '重派任务', { fallbackAttempt: 2, fallbackEntry: { provider: 'p2', model: 'm2' } })
  const rec = c.orch.currentMap.get('sess-redeploy')
  assert.equal(rec?.status, 'running', '真 childId 在册为 running（绝不留在跟踪面外）')
  assert.equal(rec?.fallbackAttempt, 2, '重建占位承接 fallbackAttempt（链状态不丢）')
  assert.deepEqual(rec?.fallbackEntry, { provider: 'p2', model: 'm2' }, '重建占位承接 fallbackEntry')
  assert.equal(c.orch.laneCount('write'), 1, 'lane 计入（hermes 属写平面）')
})

test('P1 备选重派窗口：重派 spawn 在飞时占位被哨兵回收 → 迟到落地仍收养成功（真子代在册、结论按真 id 归因）', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.map(String).join(' '))
  try {
    let spawnCount = 0
    let releaseRedeploy
    const { ctx, dispatch, tools } = createMockCtx({
      agents: agentsMock,
      llm: { listModels: async () => [{ id: 'm1' }] },
      startContinuable: withRealSignalContract(() => {
        spawnCount += 1
        if (spawnCount === 1) return Promise.resolve({ childId: 'sess-first' })
        return new Promise((resolve) => { releaseRedeploy = () => resolve({ childId: 'sess-redeploy' }) })
      }),
      subagentsExtra: { followup: async () => 'msg-x' },
    })
    await broker.apply(ctx, {
      reportExternalization: false,
      queueRetryBaseMs: 5,
      spawnEndGraceMs: 30,
      bindings: { hermes: { fallbacks: [{ provider: 'p1', model: 'm1' }] } },
    })
    await tools.get('go_work').execute({ agent: 'hermes', prompt: '重派任务' }, execOf(parent))
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-first'), { what: '首派落地' })
    dispatch('subagent/end', { id: 'sess-first', stopReason: 'error', lastAssistantMessage: [] })
    await waitFor(() => releaseRedeploy !== undefined, { what: '备选重派 spawn 已挂起在占位窗口' })
    const redeployAt = Date.now()
    await waitFor(() => Date.now() - redeployAt >= 60, { what: '重派占位成龄（>= graceMs，审计可判 stale）' })
    dispatch('subagent/end', { id: 'ghost-x', stopReason: 'completed', lastAssistantMessage: [] })
    await waitFor(() => snapOf('parent-1')?.history?.some((r) => r.status === 'failed' && String(r.conclusion).includes('spawning placeholder recovered')), { what: '哨兵回收在飞的重派占位（failed 落账）' })
    assert.equal(snapOf('parent-1').currentRecords.length, 0, '回收后重派槽位已腾空')
    releaseRedeploy()
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-redeploy' && r.status === 'running'), { what: '重派真子代重新登记在册' })
    assert.equal(snapOf('parent-1').history.filter((r) => String(r.conclusion).includes('spawning placeholder recovered')).length, 0, '重派占位那条与事实相反的 failed 随复活撤回')
    assert.ok(snapOf('parent-1').history.some((r) => r.childId === 'sess-first' && r.status === 'failed'), '首派那条合法的备选落账（[备选 1/1] 失败 → 重派）原样保留，不被复活连坐')
    assert.ok(!warnings.some((w) => w.includes('bindChild failed')), '不再有 bindChild failed / untracked')
    assert.ok(warnings.some((w) => w.includes('re-adopted into tracking (fallback redeploy)')), '重派收养收口留痕可见')
    dispatch('subagent/end', { id: 'sess-redeploy', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '重派后的结论' }] })
    await waitFor(() => snapOf('parent-1')?.history?.some((r) => r.childId === 'sess-redeploy' && r.status === 'done'), { what: '重派子代结论按真 id 落账' })
    assert.equal(snapOf('parent-1').history.find((r) => r.childId === 'sess-redeploy').conclusion, '重派后的结论', '结论正文完整归因（不丢弃）')
    assert.ok(!warnings.some((w) => w.includes('no live record')), '不再有 no live record / conclusion dropped')
  } finally {
    console.warn = origWarn
  }
})

test('P1 备选重派正常路径零变化：重派 spawn 及时落地 → 原样换键，无收养留痕', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.map(String).join(' '))
  try {
    let spawnCount = 0
    const { ctx, dispatch, tools } = createMockCtx({
      agents: agentsMock,
      llm: { listModels: async () => [{ id: 'm1' }] },
      startContinuable: withRealSignalContract(async () => ({ childId: (spawnCount += 1) === 1 ? 'sess-first' : 'sess-redeploy' })),
      subagentsExtra: { followup: async () => 'msg-x' },
    })
    await broker.apply(ctx, {
      reportExternalization: false,
      queueRetryBaseMs: 5,
      spawnEndGraceMs: 5000,
      bindings: { hermes: { fallbacks: [{ provider: 'p1', model: 'm1' }] } },
    })
    await tools.get('go_work').execute({ agent: 'hermes', prompt: '重派任务' }, execOf(parent))
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-first'), { what: '首派落地' })
    dispatch('subagent/end', { id: 'sess-first', stopReason: 'error', lastAssistantMessage: [] })
    await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === 'sess-redeploy' && r.status === 'running'), { what: '重派原地换键为真 childId' })
    assert.equal(snapOf('parent-1').currentRecords.length, 1, '槽位语义不变：恰一条在飞（重派占位原地换键）')
    assert.equal(snapOf('parent-1').history.filter((r) => String(r.conclusion).includes('spawning placeholder recovered')).length, 0, '正常重派零回收留痕')
    assert.ok(!warnings.some((w) => w.includes('re-adopted into tracking')), '正常重派不触发收养收口')
    assert.ok(!warnings.some((w) => w.includes('bindChild failed')), '正常重派无 untracked 留痕')
  } finally {
    console.warn = origWarn
  }
})
