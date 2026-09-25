/**
 * 泳道星图（src/panel-graph.js）测试：纯函数直测 + stub canvas 引擎差分探针。
 *
 * 探针口径：canvas 上下文用 Proxy 替身记录每次绘制调用（arc/translate/scale/
 * lineTo/fillText），节点体圆的半径 16 是唯一标识，槽位靠 translate 坐标读，
 * 淡出进度靠 scale 读（静止模式下 scale 恒 1，只有 fade 会压它）。
 *
 * 注意：hasRaf 在模块导入期求值，所以 rAF / window / performance 三个全局
 * 必须先装好、再动态 import——改成静态 import 会让引擎永远走无 rAF 分支。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

let fakeNow = 1000
let activeQuery = null
const rafPending = new Map()
let rafSeq = 0

function makeQuery(matches) {
  return {
    matches,
    handlers: new Set(),
    addEventListener(type, fn) { if (type === 'change') this.handlers.add(fn) },
    removeEventListener(type, fn) { if (type === 'change') this.handlers.delete(fn) },
    fire() { for (const fn of [...this.handlers]) fn() },
  }
}

globalThis.performance = { now: () => fakeNow }
globalThis.window = { devicePixelRatio: 1, matchMedia: () => activeQuery }
globalThis.requestAnimationFrame = (cb) => { const id = ++rafSeq; rafPending.set(id, cb); return id }
globalThis.cancelAnimationFrame = (id) => { rafPending.delete(id) }

const { createGraphEngine, pickBucket, readCurrentSessionId, endedByChild, toCanvasPoint, emptyGraphHint } = await import('../src/panel-graph.js')

const advance = (ms) => { fakeNow += ms }
const pumpFrame = () => {
  const [id, cb] = [...rafPending][0] ?? []
  if (!cb) return false
  rafPending.delete(id)
  cb()
  return true
}

function makeProbe() {
  const calls = []
  const events = []
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...args) => { const e = { k, args }; calls.push(e); events.push(e) }),
    set: (t, k, v) => { t[k] = v; events.push({ k, v }); return true },
  })
  return { calls, events, canvas: { width: 0, height: 0, getContext: () => ctx } }
}

function newEngine(matches) {
  activeQuery = makeQuery(matches)
  rafPending.clear()
  const probe = makeProbe()
  return { engine: createGraphEngine(probe.canvas), probe, query: activeQuery }
}

const nodeDraws = (calls) => calls.filter((c) => c.k === 'arc' && c.args[2] === 16).length
const nodeScales = (calls) => calls.filter((c) => c.k === 'scale').map((c) => c.args[0])
const lastSlot = (calls) => {
  const t = calls.filter((c) => c.k === 'translate')
  return t.length ? [t[t.length - 1].args[0], t[t.length - 1].args[1]] : null
}
const drewPath = (calls, x, y) => calls.some((c) => c.k === 'lineTo' && c.args[0] === x && c.args[1] === y)
const texts = (calls) => calls.filter((c) => c.k === 'fillText').map((c) => c.args[0])
const ringColor = (events) => {
  const i = events.findIndex((e) => e.k === 'arc' && e.args[0] === 148 && e.args[1] === 150 && e.args[2] > 26 && e.args[2] < 46)
  if (i < 0) return null
  for (let j = i - 1; j >= 0; j--) if (events[j].k === 'strokeStyle') return events[j].v
  return null
}

const rec = (pid, childId, status, ts, agentType = 'explore') => ({
  parentSessionId: pid, childId, agentType, status, createdAt: ts, updatedAt: ts,
})
const hist = (pid, childId, status, ts, agentType = 'explore') => ({
  parentSessionId: pid, childId, agentType, status, updatedAt: ts,
})
const queued = (pid, id, agentType = 'hermes') => ({ parentSessionId: pid, id, agentType })

const listOf = (snap) => ({ list: { getSnapshot: () => snap } })
const realRow = (mainView) => ({ id: 's1', displayTitle: 's1', running: false, blank: false, updatedAt: 1, retainedBy: { mainView } })

test('D1 readCurrentSessionId：新版宿主的 current 优先，旧形状无 current 时扫 byId.mainView', () => {
  assert.equal(readCurrentSessionId(listOf({ current: 's-cur', ids: ['s-main'], byId: { 's-main': realRow(2) } })), 's-cur')
  assert.equal(readCurrentSessionId(listOf({ ids: ['s-a', 's-main'], byId: { 's-a': realRow(0), 's-main': realRow(1) } })), 's-main')
  assert.equal(readCurrentSessionId(listOf({ ids: ['s-a'], byId: { 's-a': realRow(0), 's-orphan': realRow(3) } })), 's-orphan')
  assert.equal(readCurrentSessionId(listOf({ ids: ['s-a'], byId: { 's-a': realRow(undefined) } })), undefined)
  assert.equal(readCurrentSessionId(listOf({ ids: [], byId: {}, phase: 'pending', projectionsBySession: {} })), undefined)
  assert.equal(readCurrentSessionId(listOf({ ids: ['s-b'], byId: { 's-b': { retainedBy: { mainView: true } } } })), 's-b')
})

test('readCurrentSessionId：缺席/漂移一律 undefined（不猜 id）', () => {
  assert.equal(readCurrentSessionId(undefined), undefined)
  assert.equal(readCurrentSessionId({}), undefined)
  assert.equal(readCurrentSessionId({ list: {} }), undefined)
  assert.equal(readCurrentSessionId({ list: { getSnapshot: () => ({ current: 'p1' }) } }), 'p1')
  assert.equal(readCurrentSessionId({ list: { getSnapshot: () => ({ current: '' }) } }), undefined)
  assert.equal(readCurrentSessionId({ list: { getSnapshot: () => ({ current: 7 }) } }), undefined)
  assert.equal(readCurrentSessionId({ list: { getSnapshot: () => { throw new Error('shape drift') } } }), undefined)
})

test('pickBucket：空入参 / null 入参不炸，单桶直显', () => {
  const empty = pickBucket(undefined, undefined, undefined, undefined)
  assert.deepEqual(empty.records, [])
  assert.deepEqual(empty.queue, [])
  assert.deepEqual(empty.histories, [])
  assert.equal(empty.parentCount, 0)

  const one = pickBucket([rec('p1', 'c1', 'running', 5)], [queued('p1', 'w1')], [hist('p1', 'c9', 'done', 1)], undefined)
  assert.equal(one.parentCount, 1)
  assert.equal(one.parentSessionId, 'p1')
  assert.equal(one.records.length, 1)
  assert.equal(one.queue.length, 1)
  assert.equal(one.histories.length, 1)
})

test('pickBucket：current 在席即恒取该桶（空桶画空星图，绝不回落显示他人会话）', () => {
  const records = [rec('p1', 'c1', 'running', 10), rec('p2', 'c2', 'running', 99)]
  const hit = pickBucket(records, [queued('p1', 'w1'), queued('p2', 'w2')], [], 'p1')
  assert.equal(hit.parentSessionId, 'p1')
  assert.deepEqual(hit.records.map((r) => r.childId), ['c1'])
  assert.deepEqual(hit.queue.map((r) => r.id), ['w1'])
  assert.equal(hit.parentCount, 2)

  const miss = pickBucket(records, [], [], 'p9')
  assert.equal(miss.parentSessionId, 'p9')
  assert.deepEqual(miss.records, [])
  assert.deepEqual(miss.queue, [])
  assert.equal(miss.parentCount, 2)

  const onlyHistory = pickBucket([], [], [hist('p3', 'c3', 'done', 3)], 'p3')
  assert.equal(onlyHistory.histories.length, 1)
  assert.equal(onlyHistory.records.length, 0)
})

test('pickBucket：sessions 缺席时退化——单桶直显、多桶取最近活跃桶', () => {
  const single = pickBucket([rec('p1', 'c1', 'running', 10)], [], [], undefined)
  assert.equal(single.parentCount, 1)
  assert.equal(single.records.length, 1)

  const multi = pickBucket([rec('p1', 'c1', 'running', 10), rec('p2', 'c2', 'running', 99)], [], [], undefined)
  assert.equal(multi.parentSessionId, 'p2')
  assert.deepEqual(multi.records.map((r) => r.childId), ['c2'])

  const viaHistory = pickBucket([rec('p1', 'c1', 'running', 10)], [], [hist('p2', 'c2', 'done', 500)], undefined)
  assert.equal(viaHistory.parentSessionId, 'p2')
  assert.equal(viaHistory.parentCount, 2)
})

test('endedByChild：只收终局态，同 childId 取最近一条', () => {
  const m = endedByChild([
    hist('p1', 'c1', 'done', 10),
    hist('p1', 'c1', 'failed', 20),
    hist('p1', 'c2', 'running', 30),
    { parentSessionId: 'p1', agentType: 'hermes', status: 'done', updatedAt: 40 },
    null,
  ])
  assert.equal(m.size, 1)
  assert.equal(m.get('c1').status, 'failed')
  assert.equal(m.get('c1').t, 20)
  assert.equal(m.get('c2'), undefined)
  assert.equal(endedByChild(undefined).size, 0)
})

test('F1 终局回流：id 消失 + history 有终局 → 走 done/failed 演出（250+650ms），非 300ms 静默淡出', () => {
  const { engine, probe } = newEngine(true)
  engine.start()
  const A = rec('p1', 'child-A', 'running', 1, 'explore')
  engine.applySnapshot([A], [], [])
  assert.equal(engine.stats().nodes, 1)
  assert.deepEqual(lastSlot(probe.calls), [74, 76])

  probe.calls.length = 0
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 10)])
  assert.equal(engine.stats().nodes, 1, '终局演出期间节点仍在')
  assert.ok(drewPath(probe.calls, 4.5, -3.5), '画的是 ✓（done 字形），说明 status 已转 done')

  advance(400)
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 10)])
  assert.equal(engine.stats().nodes, 1, '400ms 仍在 → 走的是 900ms 终局淡出而非 300ms 静默淡出')

  advance(600)
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 10)])
  assert.equal(engine.stats().nodes, 0, '900ms 后回收')
  engine.destroy()
})

test('F1 终局回流：failed 走红叉字形；无终局史才走静默淡出', () => {
  const a = newEngine(true)
  a.engine.start()
  a.engine.applySnapshot([rec('p1', 'child-F', 'running', 1, 'hermes')], [], [])
  a.probe.calls.length = 0
  a.engine.applySnapshot([], [], [hist('p1', 'child-F', 'failed', 10, 'hermes')])
  assert.ok(drewPath(a.probe.calls, 3.5, 3.5), '画的是 ✗（failed 字形）')
  assert.deepEqual(lastSlot(a.probe.calls), [148, 255], '写泳道单槽')
  a.engine.destroy()

  const b = newEngine(true)
  b.engine.start()
  b.engine.applySnapshot([rec('p1', 'child-G', 'running', 1)], [], [])
  b.engine.applySnapshot([], [], [])
  advance(400)
  b.engine.applySnapshot([], [], [])
  assert.equal(b.engine.stats().nodes, 0, '无终局史：300ms 静默淡出后回收')
  b.engine.destroy()
})

test('F2① 静止路径也回收：节点/槽位/粒子在静止重绘前清理，槽位可复用', () => {
  const { engine, probe } = newEngine(true)
  engine.start()
  engine.applySnapshot([rec('p1', 'child-A', 'running', 1)], [], [])
  assert.equal(engine.stats().particles, 10, '派工脉冲 10 粒')
  assert.deepEqual(lastSlot(probe.calls), [74, 76])

  engine.applySnapshot([], [], [])
  advance(2000)
  engine.applySnapshot([], [], [])
  assert.equal(engine.stats().nodes, 0)
  assert.equal(engine.stats().particles, 0, '静止路径无渲染循环，粒子仍被回收')

  probe.calls.length = 0
  engine.applySnapshot([rec('p1', 'child-B', 'running', 2)], [], [])
  assert.deepEqual(lastSlot(probe.calls), [74, 76], '槽位 0 已释放并被新子代复用')
  assert.equal(engine.stats().nodes, 1)
  engine.destroy()
})

test('F5 edgeFlash 有回收：节点存活但闪环过期即清', () => {
  const { engine } = newEngine(true)
  engine.start()
  engine.applySnapshot([rec('p1', 'child-A', 'running', 1)], [], [])
  assert.equal(engine.stats().flashes, 1)
  advance(3000)
  engine.applySnapshot([rec('p1', 'child-A', 'running', 1)], [], [])
  assert.equal(engine.stats().nodes, 1, '节点仍在（未淡出）')
  assert.equal(engine.stats().flashes, 0, '闪环超 TTL 已清')
  engine.destroy()
})

test('F3+N1 复活守卫对称：记录在席时 gone 与 end 两类淡出都被撤', () => {
  const gone = newEngine(true)
  gone.engine.start()
  const A = rec('p1', 'child-A', 'running', 1)
  gone.engine.applySnapshot([A], [], [])
  gone.engine.applySnapshot([], [], [])
  advance(100)
  gone.engine.applySnapshot([A], [], [])
  advance(1000)
  gone.engine.applySnapshot([A], [], [])
  assert.equal(gone.engine.stats().nodes, 1, 'gone 淡出已被复活守卫撤掉')
  assert.deepEqual(nodeScales(gone.probe.calls).slice(-1), [1], '复活后无淡出缩放')
  gone.engine.destroy()

  const end = newEngine(true)
  end.engine.start()
  const B = rec('p1', 'child-B', 'running', 1)
  end.engine.applySnapshot([B], [], [])
  end.engine.applySnapshot([], [], [hist('p1', 'child-B', 'done', 5)])
  advance(500)
  end.probe.calls.length = 0
  end.engine.applySnapshot([B], [], [hist('p1', 'child-B', 'done', 5)])
  assert.deepEqual(nodeScales(end.probe.calls).slice(-1), [1], 'end 淡出在记录在席时同样被撤（与 gone 守卫对称）')
  end.engine.destroy()
})

test('F2② reduced-motion 双向：命中即停 rAF 并静止重绘，切回 no-preference 重启帧循环', () => {
  const { engine, probe, query } = newEngine(false)
  engine.start()
  assert.equal(rafPending.size, 1, '默认模式起帧循环')

  query.matches = true
  query.fire()
  assert.equal(rafPending.size, 0, '切到 reduce：rAF 已取消')
  probe.calls.length = 0
  engine.applySnapshot([rec('p1', 'child-A', 'running', 1)], [], [])
  assert.ok(nodeDraws(probe.calls) > 0, 'reduce 下快照变更仍静止渲染一帧')
  assert.equal(rafPending.size, 0, 'reduce 下不再排帧')

  query.matches = false
  query.fire()
  assert.equal(rafPending.size, 1, '切回 no-preference：帧循环重启（不永久冻结）')
  probe.calls.length = 0
  assert.equal(pumpFrame(), true)
  assert.ok(nodeDraws(probe.calls) > 0, '重启后的帧照常绘制')
  assert.equal(rafPending.size, 1, '帧循环自续')

  engine.destroy()
  assert.equal(rafPending.size, 0, 'destroy 清掉待跑帧')
  assert.equal(query.handlers.size, 0, 'destroy 摘掉 matchMedia 监听')
})

test('同职责多子代标签加序号（按 createdAt 升序），单条保持单名', () => {
  const { engine, probe } = newEngine(true)
  engine.start()
  engine.applySnapshot([
    rec('p1', 'child-2', 'running', 200),
    rec('p1', 'child-1', 'running', 100),
    rec('p1', 'child-w', 'running', 300, 'hermes'),
  ], [], [])
  const drawn = texts(probe.calls)
  assert.ok(drawn.includes('Explore#1'))
  assert.ok(drawn.includes('Explore#2'))
  assert.ok(drawn.includes('Hermes'))
  assert.ok(!drawn.includes('Hermes#1'))
  engine.destroy()
})

test('N1 终局淡出窗内记录回归：撤 fade 且不重放派工脉冲（活子代不「消失一次」）', () => {
  const { engine } = newEngine(true)
  engine.start()
  const A = rec('p1', 'child-A', 'running', 1)
  engine.applySnapshot([A], [], [])
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 5)])
  advance(300)
  engine.applySnapshot([A], [], [hist('p1', 'child-A', 'done', 5)])
  assert.equal(engine.stats().nodes, 1, '回归当拍未被回收')
  advance(2000)
  engine.applySnapshot([A], [], [hist('p1', 'child-A', 'done', 5)])
  assert.equal(engine.stats().nodes, 1, '窗内回归后不再走完终局淡出')
  assert.equal(engine.stats().particles, 0, '未被回收 → 未重放派工脉冲（重放会留下 10 粒）')
  engine.destroy()
})

test('N1 对照：记录持续缺席时终局淡出照常走完（900ms 后回收）', () => {
  const { engine } = newEngine(true)
  engine.start()
  engine.applySnapshot([rec('p1', 'child-A', 'running', 1)], [], [])
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 5)])
  advance(500)
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 5)])
  assert.equal(engine.stats().nodes, 1, '缺席 500ms 仍在演出中')
  advance(500)
  engine.applySnapshot([], [], [hist('p1', 'child-A', 'done', 5)])
  assert.equal(engine.stats().nodes, 0, '缺席到底 → 终局淡出正常收尾')
  engine.destroy()
})

test('N2 hitTest 归一：宿主 border-box 压缩时按 rect.width/296 换算，仍精确命中', () => {
  const { engine } = newEngine(true)
  engine.start()
  engine.applySnapshot([
    rec('p1', 'child-L', 'running', 1),
    rec('p1', 'child-M', 'running', 2),
    rec('p1', 'child-R', 'running', 3),
  ], [], [])
  const rect = { left: 630, top: 56, width: 279, height: 283 }
  const k = rect.width / 296
  const hit = toCanvasPoint(rect, rect.left + 222 * k, rect.top + 76 * k)
  assert.ok(Math.abs(hit.x - 222) < 1e-9 && Math.abs(hit.y - 76) < 1e-9, 'CSS 坐标被还原成逻辑坐标')
  assert.equal(engine.hitTest(hit.x, hit.y).rec.id, 'child-R', '最右缘槽位仍精确命中')

  const outside = toCanvasPoint(rect, rect.left + 245.5 * k, rect.top + 76 * k)
  assert.equal(engine.hitTest(outside.x, outside.y), null, '归一后画布外点位不误命中')
  assert.equal(engine.hitTest(245.5 * k, 76 * k).rec.id, 'child-R', '未归一（直接用 CSS 偏移）会误命中，量化偏差 13.5px')
  engine.destroy()
})

test('N2 toCanvasPoint 边界：rect 缺失/零宽不炸，退化 1:1', () => {
  assert.deepEqual(toCanvasPoint(null, 10, 20), { x: 10, y: 20 })
  assert.deepEqual(toCanvasPoint({ left: 0, top: 0, width: 0 }, 10, 20), { x: 10, y: 20 })
  assert.deepEqual(toCanvasPoint({ left: 5, top: 7, width: 148 }, 5 + 74, 7 + 76), { x: 148, y: 152 })
})

test('N3 空桶占位文案：records/queue 双空才给，多桶带归属口径', () => {
  const empty = pickBucket([], [], [], undefined)
  assert.equal(emptyGraphHint(empty), '当前会话无在飞子代')

  const pinned = pickBucket([rec('p1', 'c1', 'running', 1)], [queued('p2', 'w2')], [], 'p2')
  assert.equal(pinned.records.length, 0)
  assert.equal(pinned.queue.length, 1)
  assert.equal(emptyGraphHint(pinned), null, '有队列 chip 时不算空')

  const multiEmpty = pickBucket([rec('p1', 'c1', 'running', 10), rec('p2', 'c2', 'running', 99)], [], [], 'p9')
  assert.equal(multiEmpty.parentCount, 2)
  assert.equal(emptyGraphHint(multiEmpty), '当前会话无在飞子代（本图仅 ·p9 桶）')

  const busy = pickBucket([rec('p1', 'c1', 'running', 1)], [], [], undefined)
  assert.equal(emptyGraphHint(busy), null)
  assert.equal(emptyGraphHint(undefined), null, 'scope 缺席时不敢断言空，宁可不给提示')
})

test('D2 中心吸收闪环跟随终局色：done 青、failed 红', () => {
  const done = newEngine(false)
  done.engine.start()
  done.engine.applySnapshot([rec('p1', 'child-D', 'running', 1)], [], [])
  advance(16)
  pumpFrame()
  done.engine.applySnapshot([], [], [hist('p1', 'child-D', 'done', 5)])
  advance(300)
  done.probe.events.length = 0
  pumpFrame()
  assert.equal(ringColor(done.probe.events), '#26a69a', 'done 回流：闪环青')
  done.engine.destroy()

  const failed = newEngine(false)
  failed.engine.start()
  failed.engine.applySnapshot([rec('p1', 'child-E', 'running', 1, 'hermes')], [], [])
  advance(16)
  pumpFrame()
  failed.engine.applySnapshot([], [], [hist('p1', 'child-E', 'failed', 5, 'hermes')])
  advance(300)
  failed.probe.events.length = 0
  pumpFrame()
  assert.equal(ringColor(failed.probe.events), '#ef5350', 'failed 回流：闪环红（与回流粒子同色）')
  failed.engine.destroy()
})

test('D3 waiting 字形矢量化：不再 fillText("?")，改两条线 + 一点', () => {
  const { engine, probe } = newEngine(true)
  engine.start()
  engine.applySnapshot([rec('p1', 'child-W', 'waiting', 1)], [], [])
  assert.ok(!texts(probe.calls).includes('?'), '不再用文本字形')
  assert.ok(drewPath(probe.calls, -0.9, -3.9), '钩形折线在场')
  assert.ok(drewPath(probe.calls, 0.1, 0.4), '下延笔画在场')
  assert.ok(probe.calls.some((c) => c.k === 'arc' && c.args[0] === 0.1 && c.args[1] === 3.6 && c.args[2] === 1.1), '点在场')
  engine.destroy()
})
