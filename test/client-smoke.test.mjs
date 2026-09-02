// 客户端半冒烟（0.3.0-tisitan.8 E2/A-01 + E5/A-02）：src/client.js 的 apply 与
// panel-tree.js 的轮询状态机在 Node 侧可跑通——宿主 timer 服务在位/缺席两条
// 路径、卸载后两条定时器链都停、in-flight 不重入、失败退避与成功复位、
// 「桥未注册」与「桥抛错」两种留痕口径。
// 本文件不起浏览器：slots / connection / timer 全部替身，React 组件不渲染
// （只验状态机），定时器用假时钟推动，绝不等真实 600ms。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as clientHalf from '../src/client.js'
import { createOrchestrationPanel } from '../src/panel-tree.js'

function fakeSlots() {
  const injected = []
  return {
    injected,
    inject: (name, factory) => { injected.push({ name, factory }) },
    register: () => () => {},
  }
}

function fakeTimer() {
  const chains = []
  return {
    chains,
    interval(fn, ms) {
      const chain = { fn, ms, stopped: false }
      chains.push(chain)
      return () => { chain.stopped = true }
    },
  }
}

// 替身 RPC：calls 记录每次调用；respond 决定这一发的返回（或抛错）。
function fakeConnection(respond) {
  const calls = []
  return {
    calls,
    rpc: {
      call: async (channel, endpoint, payload) => {
        calls.push({ channel, endpoint, payload })
        return respond(calls.length)
      },
    },
  }
}

function fakeClientCtx({ slots, connection, services = {} } = {}) {
  return {
    connection,
    get: (name) => {
      if (name === 'slots') return slots
      if (name in services) return services[name]
      return undefined
    },
  }
}

function captureConsole() {
  const lines = { warn: [], error: [], log: [] }
  const prev = { warn: console.warn, error: console.error, log: console.log }
  console.warn = (...a) => lines.warn.push(a.join(' '))
  console.error = (...a) => lines.error.push(a.join(' '))
  console.log = (...a) => lines.log.push(a.join(' '))
  return {
    lines,
    restore: () => Object.assign(console, prev),
  }
}

const tick = async (n = 1) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)) }

test('client.apply：宿主 timer 在位 → 两条链都走 timer.interval，unapply 后全部停', async () => {
  const slots = fakeSlots()
  const timer = fakeTimer()
  const connection = fakeConnection(() => ({ ok: true, value: { seq: 1, parents: {} } }))
  const stop = clientHalf.apply(fakeClientCtx({ slots, connection, services: { timer, sessions: {} } }))
  assert.equal(typeof stop, 'function', 'apply 返回卸载函数')
  assert.equal(timer.chains.length, 2, '快照轮询 + 自动跳转两条链')
  assert.deepEqual(timer.chains.map((c) => c.ms), [600, 800], '基准 600ms 轮询 / 800ms 跳转判定')
  assert.equal(connection.calls.length, 0, '建链本身不发请求，等首个 tick')

  timer.chains[0].fn()
  await tick(3)
  assert.equal(connection.calls.length, 1, '轮询链点火即打快照 RPC')
  assert.deepEqual(connection.calls[0].channel, '/dsh-my-go')
  assert.equal(connection.calls[0].endpoint, 'snapshot')

  stop()
  assert.ok(timer.chains.every((c) => c.stopped), 'unapply 后两条链的 disposer 都被调用')
})

test('client.apply：timer 缺席 → 回落自管 setInterval 并一次性留痕，unapply 后清零', async () => {
  const slots = fakeSlots()
  const connection = fakeConnection(() => ({ ok: true, value: { seq: 1, parents: {} } }))
  const real = { set: globalThis.setInterval, clear: globalThis.clearInterval }
  const created = []
  const cleared = []
  globalThis.setInterval = (fn, ms) => { const id = created.length + 1; created.push({ fn, ms, id }); return id }
  globalThis.clearInterval = (id) => { cleared.push(id) }
  const cap = captureConsole()
  let stop
  try {
    stop = clientHalf.apply(fakeClientCtx({ slots, connection, services: { sessions: {} } }))
    assert.equal(created.length, 2, '降级路径仍建起两条定时器链（面板不再静默不刷新）')
    assert.deepEqual(created.map((c) => c.ms), [600, 800])
    assert.equal(
      cap.lines.warn.filter((l) => l.includes('falls back to window.setInterval')).length,
      1,
      '回落留痕恰好一次（两条链共用同一次告警，不刷屏）',
    )
    assert.equal(
      cap.lines.warn.filter((l) => l.includes('sessions service unavailable')).length,
      0,
      'sessions 在席时不误报',
    )
    stop()
    assert.deepEqual(cleared.slice().sort(), [1, 2], 'unapply 清掉全部自管 interval，不留孤儿轮询')
  } finally {
    cap.restore()
    Object.assign(globalThis, { setInterval: real.set, clearInterval: real.clear })
  }
})

test('client.apply：sessions 缺席 → 一次性留痕且跳转链不点火', async () => {
  const slots = fakeSlots()
  const timer = fakeTimer()
  const connection = fakeConnection(() => ({ ok: true, value: { seq: 1, parents: {} } }))
  const cap = captureConsole()
  let stop
  try {
    stop = clientHalf.apply(fakeClientCtx({ slots, connection, services: { timer } }))
    assert.equal(
      cap.lines.warn.filter((l) => l.includes('sessions service unavailable')).length,
      1,
      '缺席留痕一次（既有 ?. 守卫保留，不抛穿）',
    )
    timer.chains[1].fn() // 自动跳转链：sessions 缺席时静默返回
    await tick(2)
    assert.ok(true, '跳转链在无 sessions 时不抛异常')
  } finally {
    cap.restore()
    stop()
  }
})

test('快照轮询 in-flight 门：上一发未回时后续 tick 一律不重入（E5）', async () => {
  const slots = fakeSlots()
  const timer = fakeTimer()
  let release
  const gate = new Promise((r) => { release = r })
  let calls = 0
  const connection = {
    rpc: {
      call: async () => {
        calls += 1
        await gate
        return { ok: true, value: { seq: calls, parents: {} } }
      },
    },
  }
  const stop = createOrchestrationPanel({ slots, connection, sessions: {}, timer })
  try {
    timer.chains[0].fn()
    await tick(2)
    assert.equal(calls, 1, '首发放行')
    timer.chains[0].fn()
    timer.chains[0].fn()
    await tick(3)
    assert.equal(calls, 1, 'in-flight 期间的 tick 全部丢弃，不堆叠在飞请求')
    release()
    await tick(3)
    timer.chains[0].fn()
    await tick(3)
    assert.equal(calls, 2, '上一发落地后恢复放行')
  } finally {
    release()
    stop()
  }
})

test('快照轮询失败退避：600 → 1500 → 3000ms 封顶，成功即复位（E5）', async () => {
  const slots = fakeSlots()
  const timer = fakeTimer()
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  let mode = 'fail'
  let calls = 0
  const connection = {
    rpc: {
      call: async () => {
        calls += 1
        if (mode === 'throw') throw new Error('channel not registered')
        if (mode === 'fail') return { ok: false, error: { code: 'bad-request', message: 'nope', details: {} } }
        return { ok: true, value: { seq: calls, parents: {} } }
      },
    },
  }
  const cap = captureConsole()
  const stop = createOrchestrationPanel({ slots, connection, sessions: {}, timer })
  const poll = () => { timer.chains[0].fn() }
  try {
    // 假时钟推进器：跳一档 → 点火一次 → 断言这一档是否被放行
    const advance = async (ms, expectedCalls) => {
      now += ms
      poll()
      await tick(3)
      assert.equal(calls, expectedCalls, `now=+${ms} 后累计调用数应为 ${expectedCalls}`)
    }
    mode = 'fail'
    poll()
    await tick(3)
    assert.equal(calls, 1, '第一发照常放行')
    // 失败 #1 → 退避 1500ms
    await advance(600, 1)
    await advance(900, 2) // 累计 1500ms 放行 → 失败 #2 → 退避 3000ms
    await advance(1500, 2)
    await advance(1499, 2)
    await advance(1, 3) // 累计 3000ms 放行 → 失败 #3 → 3000ms 封顶，不再增长
    mode = 'ok'
    await advance(3000, 4)
    assert.ok(true, '成功一发出即复位')
    await advance(600, 5) // 复位后回到基准 600ms 节奏
    assert.equal(
      cap.lines.warn.filter((l) => l.includes('snapshot bridge unavailable')).length,
      1,
      '故障留痕只在状态迁移点一次，不随退避链刷屏',
    )
    assert.equal(
      cap.lines.warn.filter((l) => l.includes('snapshot bridge recovered')).length,
      1,
      '恢复留痕同样只在迁移点一次',
    )
  } finally {
    cap.restore()
    Date.now = realNow
    stop()
  }
})

test('桥抛错与桥未注册分两型留痕：internal 走「threw inside the host」，抛穿走「unavailable」（E10 前端面）', async () => {
  const realNow = Date.now
  let now = 5_000_000
  Date.now = () => now
  const stoppers = []
  const cap = captureConsole()
  try {
    {
      const timer = fakeTimer()
      const connection = fakeConnection(() => ({ ok: false, error: { code: 'internal', message: 'bridge exploded', details: {} } }))
      stoppers.push(createOrchestrationPanel({ slots: fakeSlots(), connection, sessions: {}, timer }))
      timer.chains[0].fn()
      await tick(3)
      assert.ok(
        cap.lines.warn.some((l) => l.includes('threw inside the host') && l.includes('bridge exploded')),
        'host 端在、桥函数抛错 → internal 型提示（附原因）',
      )
      assert.ok(!cap.lines.warn.some((l) => l.includes('unavailable')), 'internal 型不误报成未就绪')
    }
    cap.lines.warn.length = 0
    {
      const timer = fakeTimer()
      const connection = { rpc: { call: async () => { throw new Error('no such channel') } } }
      stoppers.push(createOrchestrationPanel({ slots: fakeSlots(), connection, sessions: {}, timer }))
      timer.chains[0].fn()
      await tick(3)
      assert.ok(
        cap.lines.warn.some((l) => l.includes('unavailable') && l.includes('no such channel')),
        'RPC 调用抛穿 → absent 型提示',
      )
    }
  } finally {
    cap.restore()
    Date.now = realNow
    for (const stop of stoppers) stop()
  }
})
