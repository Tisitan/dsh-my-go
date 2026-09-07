// 二期 2.3 调度面泳道化行为批（read-pool-semantics.md §二；D9/D18/D19 已裁决）。
// 覆盖：T1 端到端读池并行 / 写平面单线地基 / 跨 lane 并行 / lane-aware skip /
// lane 内 FIFO / 容量 1 退化全局单线（等价性）/ 复活闸 lane 化。
// 所有「默认容量 1」路径的逐字节等价性另由既有 405 例全套件背书——它们全部
// 跑在 readPoolSize 缺省（=1）下，是本批最重的等价矩阵。
//
// 时序纪律：dispatch('subagent/end') 的同步段只保证「落账 + 出队 + 占位入槽」；
// 上岗任务的 bindChild 换键发生在 spawn resolve 后的微任务。因此「谁上岗了」
// 一律以 spawn mock 的调用计数为准（waitFor 等计数到位），不得同步断言
// current 的真 id——多条在飞时 snapshot 的 currentRecords 首条也不必然指向新上岗者。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapshotNow, snapOf, waitFor } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-lane-home-'))

function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-lane-home-', ...options })
}

const parent = { id: 'parent-1', session: { header: {} } }
const agentsMock = { get: (id) => ({ 'parent-1': parent })[id] }

async function applyWithPool(poolSize) {
  const spawns = []
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async (spec) => {
      spawns.push(spec?.request?.prompt?.[0]?.text ?? '')
      return { childId: `sess-${spawns.length}` }
    }),
    subagentsExtra: {
      followup: async () => 'msg-x',
    },
  })
  await broker.apply(ctx, { readPoolSize: poolSize, reportExternalization: false, queueRetryBaseMs: 5 })
  return { dispatch, tools, spawns }
}

const doneEnd = (id) => ({ id, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done' }] })

test('T1 端到端读池并行：readPoolSize=2 时两条读平面任务同时在飞，第三条排队', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读任务1' }, execOf(parent))
  assert.equal(a.status, 'running')
  const l = await goWork.execute({ agent: 'librarian', prompt: '读任务2' }, execOf(parent))
  assert.equal(l.status, 'running', '第二条读平面任务立即上岗（读池容量 2）——单线时代此处必排队')
  const c = await goWork.execute({ agent: 'explore', prompt: '读任务3' }, execOf(parent))
  assert.equal(c.status, 'queued', '读池满后入队')
  assert.equal(snapOf('parent-1').queue.length, 1)
  // 释放一个读槽 → 队首读任务上岗（lane 内 FIFO），占位换键在微任务完成
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => snapOf('parent-1')?.queue?.length === 0 && spawns.length === 3, { what: '排队读任务上岗（第 3 次 spawn）' })
  assert.equal(snapOf('parent-1').history.some((r) => r.childId === a.childId), true, '完工记录落史')
  assert.equal(spawns[2], '读任务3', '上岗的是排队的读任务3（lane 内 FIFO）')
})

test('T2 写平面单线地基：容量 2 下两条写平面任务仍严格串行（变异探针 P-E 咬点）', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const h1 = await goWork.execute({ agent: 'hermes', prompt: '写任务1' }, execOf(parent))
  assert.equal(h1.status, 'running')
  const h2 = await goWork.execute({ agent: 'prometheus', prompt: '写任务2' }, execOf(parent))
  assert.equal(h2.status, 'queued', '写平面恒 1：读池扩容不得波及写平面串行')
  dispatch('subagent/end', doneEnd(h1.childId))
  await waitFor(() => spawns.length === 2, { what: '写平面释放后排队写任务上岗（第 2 次 spawn）' })
  assert.equal(spawns[1], '写任务2')
  assert.equal(snapOf('parent-1').queue.length, 0)
})

test('T3 跨 lane 并行：容量 2 下 explore 与 hermes 各占各的槽同时在飞', async () => {
  const { tools } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const e = await goWork.execute({ agent: 'explore', prompt: '读' }, execOf(parent))
  const h = await goWork.execute({ agent: 'hermes', prompt: '写' }, execOf(parent))
  assert.equal(e.status, 'running')
  assert.equal(h.status, 'running', '读平面在飞不阻塞写平面直派（泳道隔离）')
  // D20 一步到位（二期 2.5）：current 单条已由 currentRecords 全量数组取代，
  // 本批与数据层/消费面同批复闭环（2.2+2.5 同批前提兑现）
  const snap = snapshotNow().parents['parent-1']
  assert.ok(Array.isArray(snap.currentRecords), 'currentRecords 全量数组（D20 一步到位）')
  assert.ok(!('current' in snap), '旧 current 单条形状已删除（无过渡双字段）')
  assert.equal(snap.currentRecords.length, 2, '读+写各一条，列表化可观测')
})

test('T4 lane-aware skip：队列 [写, 读]，读槽先空出来 → 读上岗、写原地保留', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // read 1/2
  await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // read 2/2
  const h1 = await goWork.execute({ agent: 'hermes', prompt: '写H1' }, execOf(parent)) // write 1/1
  const w2 = await goWork.execute({ agent: 'prometheus', prompt: '写W2' }, execOf(parent))
  assert.equal(w2.status, 'queued', '写平面满 → 入队，队列 [W2]')
  const l2 = await goWork.execute({ agent: 'librarian', prompt: '读L2' }, execOf(parent))
  assert.equal(l2.status, 'queued', '读平面满 → 入队，队列 [W2, L2]')
  assert.equal(spawns.length, 3)
  // 读槽释放：advance 扫描跳过满池 write 的 W2，放行读 lane 的 L2（D9 lane-aware skip）
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => spawns.length === 4, { what: 'skip 后 L2 被放行上岗（第 4 次 spawn）' })
  assert.equal(spawns[3], '读L2', '上岗的是排在队尾的读任务（skip 越过了队首的写任务）')
  assert.deepEqual(snapOf('parent-1').queue.map((w) => w.agentType), ['prometheus'], 'W2 原地保留、序不重排')
  // 写槽释放（H1 完工）→ W2 才上岗
  dispatch('subagent/end', doneEnd(h1.childId))
  await waitFor(() => spawns.length === 5, { what: '写 lane 空位出现后 W2 上岗' })
  assert.equal(spawns[4], '写W2')
})

test('T5 lane 内 FIFO：同 lane 两条排队任务按入队序依次上岗，不因 skip 换序', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // read 1/2
  await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // read 2/2
  const l2 = await goWork.execute({ agent: 'explore', prompt: '读L2' }, execOf(parent))
  const l3 = await goWork.execute({ agent: 'librarian', prompt: '读L3' }, execOf(parent))
  assert.equal(l2.status, 'queued')
  assert.equal(l3.status, 'queued')
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => spawns.length === 3, { what: '先入队的 L2 上岗' })
  assert.equal(spawns[2], '读L2', 'lane 内 FIFO：先入队先上岗')
  const snap = snapOf('parent-1')
  assert.equal(snap.queue.length, 1, 'L3 原地保留，一次释放只消化一个空位')
  assert.equal(snap.queue[0].agentType, 'librarian')
})

test('T6 容量 1 退化全局单线：write 在跑时 explore 派发入队（跨 lane 不并行），end 后上岗', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(1)
  const goWork = tools.get('go_work')
  const h = await goWork.execute({ agent: 'hermes', prompt: '写' }, execOf(parent))
  assert.equal(h.status, 'running')
  const e = await goWork.execute({ agent: 'explore', prompt: '读' }, execOf(parent))
  assert.equal(e.status, 'queued', 'readPoolSize=1 = 关闭 = 全局单线：write 占用时 read 不得上岗（D5 逐字节现状）')
  dispatch('subagent/end', doneEnd(h.childId))
  await waitFor(() => spawns.length === 2, { what: '单线释放后队首上岗（与改造前行为一致）' })
  assert.equal(spawns[1], '读')
})

test('T7 复活闸 lane 化：读池满时复活读任务拒绝（报错点名 lane），写占用不挡读复活', async () => {
  // 场景一：读池满（2/2）+ finished explore → continue 复活被拒
  {
    const { dispatch, tools } = await applyWithPool(2)
    const goWork = tools.get('go_work')
    const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent))
    await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // read 2/2
    dispatch('subagent/end', doneEnd(a.childId))
    await goWork.execute({ agent: 'librarian', prompt: '读C' }, execOf(parent)) // 补满 read 2/2
    await assert.rejects(
      () => tools.get('continue').execute({ id: a.childId, prompt: '驳回重做' }, execOf(parent)),
      (error) => {
        assert.ok(String(error.message).includes('read lane'), '报错点明满池的是读 lane（去 single-line blocking 化）')
        return true
      },
    )
  }
  // 场景二：写平面占用 + 读有空位 → 复活读任务放行（旧 isBusy 判定下会被误拒）。
  // 复籍在投递成功之后（M5），current 换回被复活记录要等微任务 → waitFor。
  {
    const { dispatch, tools } = await applyWithPool(2)
    const goWork = tools.get('go_work')
    const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent))
    dispatch('subagent/end', doneEnd(a.childId))
    await goWork.execute({ agent: 'hermes', prompt: '写H' }, execOf(parent)) // write 1/1，read 空
    const res = await tools.get('continue').execute({ id: a.childId, prompt: '驳回重做' }, execOf(parent))
    assert.equal(res.accepted, true, '复活闸看目标 lane 空位，不看不相关 lane 的占用')
    // current 是 Map 首条（单条形状，2.5 才改）：复活记录排在后入槽的 hermes 之后，
    // 不可观测——revive 把记录从 history 挪回 currentMap，以 history 挪出为准
    await waitFor(() => snapOf('parent-1')?.history?.length === 0, { what: '复活的读任务从 history 回槽' })
  }
})

test('T8 直派成功路径回归：D19 补位推进为无害调用（满池/无匹配 no-op），队列不异常增殖', async () => {
  const { tools } = await applyWithPool(2)
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent))
  const h = await goWork.execute({ agent: 'hermes', prompt: '写H' }, execOf(parent))
  assert.equal(a.status, 'running')
  assert.equal(h.status, 'running')
  // 直派成功路径末尾的 advanceQueue（D19）在无可上岗 work 时必须原样返回：
  // 队列为空、无幽灵排队任务、无重复派发
  const snap = snapshotNow().parents['parent-1']
  assert.equal(snap.queue.length, 0)
  assert.ok(Array.isArray(snap.currentRecords) && snap.currentRecords.length > 0, '在飞状态自洽（读+写各一）')
})
