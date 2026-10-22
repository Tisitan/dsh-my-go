// 二期 2.3 调度面泳道化行为批（read-pool-semantics.md §二；D9/D18/D19 已裁决）。
// 覆盖（两批合并叙述——读池批 = 二期 2.3；写池批 = 0.6.0 的 writePoolSize 配置化，
// 与读池对称）：
//   读池批：T1 端到端读池并行 / 写平面容量 1 地基 / 跨 lane 并行 / lane-aware skip /
//   lane 内 FIFO / 容量 1 退化全局单线（等价性）/ 复活闸 lane 化 / T9 容量 3
//   （三读在飞 + 第四读入队 + 读池满时写任务越过上岗）。
//   写池批：T10~T12——写池 3 端到端（三写在飞 + 第四入队 + 读任务越过满写池）、
//   工具描述串容量内插、非法/超限回落与钳制。
// 退化矩阵（两批共用）：T2 起「写平面串行」用例全部跑在 writePoolSize 缺省（=1）下，
// 是写池退化面的等价矩阵；所有「默认容量 1」路径的逐字节等价性另由既有全套件背书
// （它们全部跑在 readPoolSize 缺省 =1 下），是最重的等价矩阵。
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
import { laneOf } from '../preset/shared/orchestration.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapshotNow, snapOf, waitFor } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-lane-home-'))

function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-lane-home-', ...options })
}

const parent = { id: 'parent-1', session: { header: {} } }
const agentsMock = { get: (id) => ({ 'parent-1': parent })[id] }

async function applyWithPools(config) {
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
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, ...config })
  return { dispatch, tools, spawns }
}

const applyWithPool = (poolSize) => applyWithPools({ readPoolSize: poolSize })

// 占位 → 真 childId：applyWithPools 的 spawn mock 以序号造 id（sess-N），
// go_work 在队列非空时返回的是**排队 work id** 而非真 id，故一律按顺序回填。
const realId = (n) => `sess-${n}`
// 等台账里出现指定 childId 的活记录（绑键在 spawn resolve 的微任务里完成）
const waitForChild = (id, what) => waitFor(
  () => snapOf('parent-1')?.currentRecords?.some((r) => r.childId === id),
  { what },
)

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
  // 与数据层/消费面同批复闭环（2.2+2.5 同批前提兑现）
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
  // 复籍在投递成功之后，current 换回被复活记录要等微任务 → waitFor。
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

// （扩池 2→3）：显式 3 = 钳制上限顶格。T1 咬的是 2，本例把
// 同一端到端形状外扩一档，并咬住「读池 3/3 满 ≠ 全局满」——写 lane 的空位仍能把
// 队列里排在满池读任务之后的写任务放行（broker.mjs advanceQueue 的 lane-aware skip）。
test('T9 端到端读池扩容：readPoolSize=3 时三条读任务同时在飞、第四条排队；读池满时写任务仍可越过上岗', async () => {
  const { dispatch, tools, spawns } = await applyWithPool(3)
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // read 1/3
  const b = await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // read 2/3
  const c = await goWork.execute({ agent: 'explore', prompt: '读C' }, execOf(parent)) // read 3/3
  assert.equal(a.status, 'running')
  assert.equal(b.status, 'running', '第二条读任务立即上岗（读池容量 3）')
  assert.equal(c.status, 'running', '第三条读任务立即上岗（容量 2 时代此处必排队）')
  assert.equal(spawns.length, 3, '同刻三条读任务在飞 = 读池容量随显式值放大')
  const d = await goWork.execute({ agent: 'librarian', prompt: '读D' }, execOf(parent))
  assert.equal(d.status, 'queued', '读池 3/3 满后第四条读任务入队')
  assert.equal(snapOf('parent-1').queue.length, 1)
  // 读 lane 满不挡写 lane：直派走目标 lane 空位判定（泳道隔离）
  const h1 = await goWork.execute({ agent: 'hermes', prompt: '写H1' }, execOf(parent)) // write 1/1
  assert.equal(h1.status, 'running', '读池 3/3 满时写平面任务仍可直派上岗')
  const w2 = await goWork.execute({ agent: 'prometheus', prompt: '写W2' }, execOf(parent))
  assert.equal(w2.status, 'queued', '写平面满 → 入队，队列 [读D, 写W2]')
  assert.deepEqual(snapOf('parent-1').queue.map((w) => w.agentType), ['librarian', 'prometheus'], '入队序即全局序，skip 不改序')
  // lane-aware skip：写槽释放 → advanceQueue 扫过满池 read 的队首读D，放行写 lane 的 W2
  dispatch('subagent/end', doneEnd(h1.childId))
  await waitFor(() => spawns.length === 5, { what: '读池满时写 lane 空位放行写任务（skip 越过队首读任务）' })
  assert.equal(spawns[4], '写W2', '越过队首满池读任务上岗的是写任务（读池放开不改变满 lane 原地保留）')
  assert.deepEqual(snapOf('parent-1').queue.map((w) => w.agentType), ['librarian'], '读D 原地保留、序不重排')
  // 读槽释放 → 读D 才上岗（lane 内 FIFO）
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => spawns.length === 6, { what: '读槽释放后排队读任务上岗（第 6 次 spawn）' })
  assert.equal(spawns[5], '读D', '上岗的是排队的读任务4（lane 内 FIFO）')
  assert.equal(snapOf('parent-1').queue.length, 0)
})

// ── 写池配置化（writePoolSize，与读池对称）──────────────────────────────────
// 断言纪律：并行证据一律取快照侧语义条件（go_work 返回的 status、currentRecords
// 的 lane 计数、queue 形状），**严禁拿 spawn 计数当在飞数**——人派任务同样占
// spawn，计数>1 不能证明「同一条 lane 真的并行上岗」。
const laneRecs = (snap, lane) => snap.currentRecords.filter((r) => (r.lane ?? laneOf(r.agentType)) === lane)

test('T10 端到端写池扩容：writePoolSize=3 时三条写任务同时在飞、第四条排队；写池满时读任务仍可越过上岗', async () => {
  const { dispatch, tools } = await applyWithPools({ readPoolSize: 1, writePoolSize: 3 })
  const goWork = tools.get('go_work')
  const h1 = await goWork.execute({ agent: 'hermes', prompt: '写H1' }, execOf(parent))
  const h2 = await goWork.execute({ agent: 'prometheus', prompt: '写H2' }, execOf(parent))
  const h3 = await goWork.execute({ agent: 'hephaestus', prompt: '写H3' }, execOf(parent))
  assert.equal(h1.status, 'running')
  assert.equal(h2.status, 'running', '写池容量 3：第二条写平面任务立即上岗（改造前此处必排队）')
  assert.equal(h3.status, 'running', '第三条写平面任务立即上岗（3/3 满；容量 2 时代此处必排队）')
  assert.equal(laneRecs(snapOf('parent-1'), 'write').length, 3, '快照侧：写 lane 占槽 3/3（不用 spawn 计数）')
  const w4 = await goWork.execute({ agent: 'oracle', prompt: '写H4' }, execOf(parent))
  assert.equal(w4.status, 'queued', '写池 3/3 满后第四条写任务入队')
  assert.equal(snapOf('parent-1').queue.length, 1)
  // 泳道隔离：写池满不构成对读 lane 的封锁（旧全局单线下此处必排队）
  const e1 = await goWork.execute({ agent: 'explore', prompt: '读E1' }, execOf(parent))
  assert.equal(e1.status, 'running', '写池 3/3 满时读任务仍上岗（lane 各自计数）')
  const e2 = await goWork.execute({ agent: 'librarian', prompt: '读E2' }, execOf(parent))
  assert.equal(e2.status, 'queued', '读池仍为 1：第二条读任务入队（写池扩容不得波及读池容量）')
  const snap = snapOf('parent-1')
  assert.equal(laneRecs(snap, 'write').length, 3, '写 lane 3/3')
  assert.equal(laneRecs(snap, 'read').length, 1, '读 lane 1/1')
  assert.deepEqual(snap.queue.map((w) => w.agentType), ['oracle', 'librarian'], '入队序即全局序，skip 不改序')
  // 汇总行显示写容量（项 6）：两池各自计数上屏
  const status = await tools.get('orchestration_status').execute({}, execOf(parent))
  assert.match(status.text, /lanes: read 1\/1 · write 3\/3/, 'lanes 汇总行带写池容量')
  // 释放一个写槽 → 队首写任务上岗（lane 内 FIFO），读任务原地保留
  dispatch('subagent/end', doneEnd(h1.childId))
  await waitFor(() => snapOf('parent-1')?.currentRecords?.some((r) => r.prompt === '写H4'), { what: '写槽释放后排队写任务上岗' })
  const snap2 = snapOf('parent-1')
  assert.equal(laneRecs(snap2, 'write').length, 3, '释放后的写槽立刻被队首写任务填满')
  assert.equal(laneRecs(snap2, 'read').length, 1)
  assert.deepEqual(snap2.queue.map((w) => w.agentType), ['librarian'], '读E2 原地保留、序不重排')
  assert.equal(snap2.history.some((r) => r.childId === h1.childId), true, '完工记录落史')
})

test('T11 工具描述串写容量内插：缺省 1 → "up to 1"，显式 3 → "up to 3"（模板内插不写死装机值）', async () => {
  const a = await applyWithPools({ readPoolSize: 1 })
  assert.match(a.tools.get('go_work').description, /the write plane runs up to 1 in parallel/,
    '缺省 writePoolSize=1 → 描述串写平面容量 1（关闭）')
  assert.doesNotMatch(a.tools.get('go_work').description, /runs one at a time/, '旧「一次只跑一条」硬编码口径已退役')
  const b = await applyWithPools({ readPoolSize: 3, writePoolSize: 3 })
  assert.match(b.tools.get('go_work').description, /the write plane runs up to 3 in parallel/,
    '显式 writePoolSize=3 → 描述串内插实际装机容量')
  assert.match(b.tools.get('go_work').description, /the read plane \(Explore\/Librarian\) runs up to 3 in parallel/,
    '双车道容量各自内插（读池先例不变）')
})

test('T12 写池非法配置回落：writePoolSize 非数值/超上限 → 写平面退回容量 1 / 钳 3', async () => {
  const bad = await applyWithPools({ readPoolSize: 1, writePoolSize: 'x' })
  const w1 = await bad.tools.get('go_work').execute({ agent: 'hermes', prompt: '写1' }, execOf(parent))
  const w2 = await bad.tools.get('go_work').execute({ agent: 'prometheus', prompt: '写2' }, execOf(parent))
  assert.equal(w1.status, 'running')
  assert.equal(w2.status, 'queued', '非法值回落 1 = 写平面恒单线（坏值不炸挂载，最安全降级）')
  const cap = await applyWithPools({ readPoolSize: 1, writePoolSize: 99 })
  const c1 = await cap.tools.get('go_work').execute({ agent: 'hermes', prompt: '写1' }, execOf(parent))
  const c2 = await cap.tools.get('go_work').execute({ agent: 'prometheus', prompt: '写2' }, execOf(parent))
  const c3 = await cap.tools.get('go_work').execute({ agent: 'hephaestus', prompt: '写3' }, execOf(parent))
  const c4 = await cap.tools.get('go_work').execute({ agent: 'oracle', prompt: '写4' }, execOf(parent))
  assert.deepEqual([c1.status, c2.status, c3.status], ['running', 'running', 'running'], '>3 钳 3：三条写任务在飞')
  assert.equal(c4.status, 'queued', '第四条入队（钳制上限 3 生效）')
})

// 复活预占（reserveRevival）的**归还**回归：投递失败的那一轮必须把预占槽吐回去。
// 历史病灶：投递失败（门面抛错 / abort 后投递失败）时预占永挂在
// revivalReservations 里，同一 childId 再次 continue 恒报「another revival is in
// progress」，写池放满后残留三条即全局满、整条流水线停摆。
test('T13 复活预占在投递失败时归还：同一 childId 可再次 continue，泳道不残留幽灵槽', async () => {
  let failDelivery = true
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-r' })),
    subagentsExtra: {
      followup: async () => {
        if (failDelivery) throw new Error('delivery boom')
        return 'msg-ok'
      },
    },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, readPoolSize: 1, writePoolSize: 1 })
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent))
  assert.equal(a.status, 'running')
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '读任务结束落史' })

  await assert.rejects(
    () => tools.get('continue').execute({ id: a.childId, prompt: '复活' }, execOf(parent)),
    /delivery boom/,
    '门面抛错原样冒泡（投递失败语义不变）',
  )
  // 预占必须已归还。两池容量皆为 1 = 全局单线：残留一条预占即 isLaneFree 恒假，
  // 同一 childId 第二次 continue 撞「another revival is in progress」，派发也全被
  // 挡进队列——历史病灶的现场。
  failDelivery = false
  const retry = await tools.get('continue').execute({ id: a.childId, prompt: '再复活' }, execOf(parent))
  assert.equal(retry.accepted, true, '投递失败后预占已归还，同一 childId 可再次复活')
  const snap = snapshotNow().parents['parent-1']
  assert.equal(snap.history.length, 0, '复活把记录从 history 取回在飞')
  assert.equal(snap.queue.length, 0, '无幽灵排队（预占泄漏会让后续派发全部入队）')
  assert.equal(snap.currentRecords.length, 1, '全局单线：在飞恰一条')
})

test('T14 投递失败那一轮不误放队列：队列任务等真实槽位释放才上岗', async () => {
  let calls = 0
  let failDelivery = true
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++calls}` })),
    subagentsExtra: {
      followup: async () => {
        if (failDelivery) throw new Error('delivery boom')
        return 'msg-ok'
      },
    },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, readPoolSize: 1, writePoolSize: 1 })
  const goWork = tools.get('go_work')
  // 占住单线：一条在飞读任务 + 一条排队写任务。
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent))
  const queued = await goWork.execute({ agent: 'hermes', prompt: '排队写' }, execOf(parent))
  assert.equal(queued.status, 'queued', '单线占用时第二条任务入队')
  // 在飞任务自然完工 → 队列推进上岗（既有语义）。
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => snapOf('parent-1')?.currentRecords?.[0]?.agentType === 'hermes', { what: '槽位释放后排队任务上岗' })
  // 复活对象用一条已完工的记录：让 hermes 也结束，再把 explore 复活并故意让投递失败。
  dispatch('subagent/end', doneEnd(`sess-2`))
  await waitFor(() => snapOf('parent-1')?.history?.length === 2, { what: '两条记录都落史' })
  await assert.rejects(
    () => tools.get('continue').execute({ id: a.childId, prompt: '复活' }, execOf(parent)),
    /delivery boom/,
    '投递失败原样冒泡',
  )
  const snap = snapshotNow().parents['parent-1']
  assert.equal(snap.currentRecords.length, 0, '失败那一轮不复活任何记录（无假 running 槽）')
  assert.equal(snap.queue.length, 0, '失败那一轮不产生新排队')
  // 预占已归还：同一 childId 再复活可成（泄漏时这里恒报 another revival is in progress）。
  failDelivery = false
  const retry = await tools.get('continue').execute({ id: a.childId, prompt: '再复活' }, execOf(parent))
  assert.equal(retry.accepted, true)
})

// 复活预占的原子性端到端：读池 2 时两条复活各占 1 槽、第三条被拒，全程不超容。
// **口径诚实**：continue 在首次 await 之前没有让出点，「先查后占」在顺序语义下
// 不可能双双通过——本用例锁的是行为（复活受容量约束、不饿死、不泄漏），不是
// 某一行实现的指纹；「先占后断言」与 laneCount 交接口径的因果面由
// orchestration.test.mjs 的状态机用例直接咬住（那里能构造出超容/跨两处的真实现场）。
test('T15 复活受容量约束端到端：读池 2 时两条复活各占 1 槽，续聊不占新槽且不留幽灵槽', async () => {
  const spawns = []
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async (spec) => {
      spawns.push(spec?.request?.prompt?.[0]?.text ?? '')
      return { childId: `sess-${spawns.length}` }
    }),
    subagentsExtra: { followup: async () => 'msg-x' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, readPoolSize: 2, writePoolSize: 1 })
  const goWork = tools.get('go_work')
  const a = await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // sess-1
  dispatch('subagent/end', doneEnd(a.childId))
  await waitFor(() => snapOf('parent-1')?.history?.some((r) => r.childId === a.childId), { what: '读A 落史（读池 0/2）' })
  const b = await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // sess-2
  dispatch('subagent/end', doneEnd(b.childId))
  await waitFor(() => snapOf('parent-1')?.history?.length === 2, { what: '读B 落史（读池 0/2）' })
  // 同一 tick 连续复活两条：各占 1 槽，读池回到 2/2
  const r1 = await tools.get('continue').execute({ id: a.childId, prompt: '复活A' }, execOf(parent))
  const r2 = await tools.get('continue').execute({ id: b.childId, prompt: '复活B' }, execOf(parent))
  assert.equal(r1.accepted, true)
  assert.equal(r2.accepted, true, '读池容量 2：两条复活各占 1 槽都成立')
  const readNow = laneRecs(snapOf('parent-1'), 'read').length
  assert.equal(readNow, 2, `读 lane 恰 2/2：实际 ${readNow}`)
  // 满池后的复活一律被 lane 闸拦下（复活不是容量豁免），且不留幽灵槽
  // 注意：目标**在飞**时 continue 是续聊（不占新槽），不被复活闸拦——这是既有语义，
  // 不是容量豁免；容量闸只对「把已完工记录放回槽位」的复活成立。
  const followup = await tools.get('continue').execute({ id: a.childId, prompt: '续聊' }, execOf(parent))
  assert.equal(followup.accepted, true, '在飞子代的续聊不被复活闸拦（不占新槽）')
  const after = laneRecs(snapOf('parent-1'), 'read').length
  assert.equal(after, 2, `续聊后读池仍恰 2/2（不留幽灵槽）：实际 ${after}`)
  // 队列面自洽：读池真满时新读任务只能排队
  const c = await goWork.execute({ agent: 'explore', prompt: '读C' }, execOf(parent))
  assert.equal(c.status, 'queued', '读池 2/2 → 直派入队（无幽灵预占把容量读成 3）')
  assert.equal(snapOf('parent-1').queue.length, 1)
})
// 槽位交接：复活一条已完工子代**消耗**一个槽而不是释放。成功出口必须在推进队列
// 之前归还预占，否则同一 childId 被算两槽 —— 排队 work 看到的占用虚高，读池少派
// 一条（「已完工子代被捞回」与「排队任务上岗」在同一条 lane 上博弈）。
test('T16 复活消耗槽位而非释放：满池时复活被拒，空位出现后复活成功且交接不留幽灵槽', async () => {
  const { dispatch, tools, spawns } = await applyWithPools({ readPoolSize: 2, writePoolSize: 1 })
  const goWork = tools.get('go_work')
  await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // sess-1
  await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // sess-2，读池 2/2
  await waitForChild(realId(2), '读B 换键到真 childId')
  dispatch('subagent/end', doneEnd(realId(1)))
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '读A 落史（读池 1/2）' })
  await goWork.execute({ agent: 'explore', prompt: '读C' }, execOf(parent))
  await waitForChild(realId(3), '读C 上岗（读池 2/2）')
  await assert.rejects(
    () => tools.get('continue').execute({ id: realId(1), prompt: '复活A' }, execOf(parent)),
    /read lane/,
    '满池时复活被拒（复活消耗槽位，不是释放槽位）',
  )
  // 释放一个读槽 → 复活读A 成功；复活轮不产生新排队、也不产生新 spawn
  dispatch('subagent/end', doneEnd(realId(2)))
  await waitFor(() => snapOf('parent-1')?.history?.length === 2, { what: '读B 落史（读池 1/2）' })
  const before = spawns.length
  const revived = await tools.get('continue').execute({ id: realId(1), prompt: '复活A' }, execOf(parent))
  assert.equal(revived.accepted, true)
  const snap = snapOf('parent-1')
  assert.equal(laneRecs(snap, 'read').length, 2, '复活后读 lane 2/2 = 真实占用（预占滞留会重复计槽）')
  assert.equal(snap.queue.length, 0, '复活轮不产生新排队')
  assert.equal(spawns.length, before, '复活本身不是派发（不产生新 spawn）')
  assert.equal(snap.history.length, 1, '读A 从 history 挪回 currentMap')
})

// 交接窗口的读口径：revive 已占 currentMap、预占尚未归还的那一拍里，laneCount 必须
// 把同一子代算 1 槽而非 2 —— 否则同一时段快照/状态面读到的是虚高占用。
test('T17 交接窗口内同一子代只算一槽：复活后状态面读池不虚高', async () => {
  const { dispatch, tools } = await applyWithPools({ readPoolSize: 2, writePoolSize: 1 })
  const goWork = tools.get('go_work')
  await goWork.execute({ agent: 'explore', prompt: '读A' }, execOf(parent)) // sess-1
  await goWork.execute({ agent: 'librarian', prompt: '读B' }, execOf(parent)) // sess-2
  await waitForChild(realId(2), '读B 换键到真 childId')
  dispatch('subagent/end', doneEnd(realId(1)))
  await waitFor(() => snapOf('parent-1')?.history?.length === 1, { what: '读A 落史（读池 1/2）' })
  // 复活读A：读池 1/2 → 2/2。状态面必须读到 2/2，不是 3/2。
  const res = await tools.get('continue').execute({ id: realId(1), prompt: '复活A' }, execOf(parent))
  assert.equal(res.accepted, true)
  const status = await tools.get('orchestration_status').execute({}, execOf(parent))
  assert.match(String(status.text), /lanes: read 2\/2/, '状态面读到读池 2/2（重复计槽会显示 3/2 或误拒复活）')
  assert.equal(laneRecs(snapOf('parent-1'), 'read').length, 2)
  // 口径不是靠放宽容量换来的：读池真满时再复活仍被拒
  await goWork.execute({ agent: 'explore', prompt: '读排队' }, execOf(parent))
  const queued = await goWork.execute({ agent: 'librarian', prompt: '读排队2' }, execOf(parent))
  assert.equal(queued.status, 'queued', '读池 2/2 → 排队')
  const status2 = await tools.get('orchestration_status').execute({}, execOf(parent))
  assert.match(String(status2.text), /lanes: read 2\/2/, '拒绝前后读数不漂移（不留预占残渣）')
})
