// 多会话编排隔离回归批：每个 Sisyphus 编排会话一条独立流水线。
// 旧 standing-scope 单例下，会话1的子代理在跑时会话2的 go_work 会被排队
// 阻塞；改造后两侧队列/槽位/求助单互不干扰，childOwner 把子代理侧事件
// 路由回属主流水线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-multi-home-'))

// 全功能 mock：捕获 tools.register 与事件监听；ctx.get('subagents') 给出
// startContinuable/followup/reportFrom mock，ctx.get('agents') 给出 get()
// mock（台账读档、agent/request 之外的路径都会触到它们）。
function mockCtxFull({ startContinuable, agents, subagentsExtra } = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-multi-home-'))
  const listeners = new Map()
  const tools = new Map()
  const subagents = { startContinuable, ...subagentsExtra }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return agents
      if (name === 'subagents') return subagents
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    subagents,
  }
  return { ctx, listeners, tools, subagents }
}

// 真实契约包装：dsh-subagent 的 startContinuable 无条件解引用 spec.signal
const withRealSignalContract = (fn) => async (spec) => {
  spec.signal.throwIfAborted()
  return fn(spec)
}

const execOf = (agent) => ({ agent, signal: new AbortController().signal })
const snapshotNow = () => globalThis[Symbol.for('dsh-my-go.snapshot')]()
const snapOf = (pid) => snapshotNow()?.parents?.[pid]

const parentA = { id: 'parent-A', session: { header: {} } }
const parentB = { id: 'parent-B', session: { header: {} } }
const agentsMock = { get: (id) => ({ 'parent-A': parentA, 'parent-B': parentB })[id] }

test('A 忙时 B 的 go_work 不排队：两个编排会话各自独立的流水线', async () => {
  let spawnCalls = 0
  const { ctx, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  const goWork = tools.get('go_work')

  const a1 = await goWork.execute({ agent: 'explore', prompt: 'A 的任务1' }, execOf(parentA))
  assert.equal(a1.status, 'running')
  assert.equal(a1.childId, 'sess-1')

  // 核心断言：A 的子代理在跑，B 的派发必须立即上岗而不是被 A 排队
  const b1 = await goWork.execute({ agent: 'hermes', prompt: 'B 的任务1' }, execOf(parentB))
  assert.equal(b1.status, 'running', 'B 的派发不得被 A 的在跑子代理阻塞')
  assert.equal(b1.queued, false)

  // A 再派一个：只进 A 自己的队列
  const a2 = await goWork.execute({ agent: 'librarian', prompt: 'A 的任务2' }, execOf(parentA))
  assert.equal(a2.status, 'queued')

  // 快照 parents 形状：两个分桶各自独立
  const snap = snapshotNow()
  assert.ok(snap.parents && typeof snap.parents === 'object')
  assert.deepEqual(Object.keys(snap.parents).sort(), ['parent-A', 'parent-B'])
  assert.equal(snap.parents['parent-A'].parentSessionId, 'parent-A')
  assert.equal(snapOf('parent-A').current?.childId, 'sess-1')
  assert.equal(snapOf('parent-A').queue.length, 1)
  assert.equal(snapOf('parent-A').queue[0].agentType, 'librarian')
  assert.equal(snapOf('parent-B').current?.childId, 'sess-2')
  assert.equal(snapOf('parent-B').queue.length, 0, 'B 的队列不受 A 排队影响')
})

test('childOwner 路由：need_help 落进属主流水线，subagent/end 只推进属主队列', async () => {
  let spawnCalls = 0
  const reports = []
  const { ctx, listeners, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: {
      reportFrom: async (child, blocks) => { reports.push({ childId: child.id, blocks }) },
      followup: async () => 'msg-1',
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  const goWork = tools.get('go_work')

  await goWork.execute({ agent: 'explore', prompt: 'A 的任务' }, execOf(parentA)) // sess-1
  await goWork.execute({ agent: 'hermes', prompt: 'B 的任务' }, execOf(parentB)) // sess-2
  // A 再排一个，等会儿验证 end 只推进 A 的队列
  await goWork.execute({ agent: 'oracle', prompt: 'A 的排队任务' }, execOf(parentA))

  // B 的子代理求助：必须落进 B 的流水线，A 的求助单为空
  const needHelp = tools.get('need_help')
  const r = await needHelp.execute(
    { intent: 'replan', content: 'B 的子代理请求换工种' },
    execOf({ id: 'sess-2', session: { header: { parentSession: 'parent-B' } } }),
  )
  assert.equal(r.suspended, true)
  assert.equal(snapOf('parent-B').helpRequests.length, 1)
  assert.equal(snapOf('parent-B').helpRequests[0].childId, 'sess-2')
  assert.equal(snapOf('parent-B').current?.status, 'waiting')
  assert.equal(snapOf('parent-A').helpRequests.length, 0, 'A 不得收到 B 子代理的求助单')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].childId, 'sess-2')

  // A 的子代理完工：只推进 A 的队列，B 的 waiting 记录原样保留
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A done' }] })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const snapA = snapOf('parent-A')
  assert.equal(snapA.history.length, 1)
  assert.equal(snapA.history[0].agentType, 'explore')
  assert.equal(snapA.queue.length, 0, 'A 的排队任务已被推进消化')
  assert.equal(snapA.current?.agentType, 'oracle')
  const snapB = snapOf('parent-B')
  assert.equal(snapB.current?.childId, 'sess-2')
  assert.equal(snapB.current?.status, 'waiting', 'B 的 suspended 记录不受 A 完工影响')
  assert.equal(snapB.history.length, 0)
})

test('session/disposed 销毁该会话的整条流水线，其他会话不受影响', async () => {
  let spawnCalls = 0
  const { ctx, listeners, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  const goWork = tools.get('go_work')

  await goWork.execute({ agent: 'explore', prompt: 'A 的任务' }, execOf(parentA)) // sess-1
  await goWork.execute({ agent: 'librarian', prompt: 'A 的排队任务' }, execOf(parentA)) // queued
  await goWork.execute({ agent: 'hermes', prompt: 'B 的任务' }, execOf(parentB)) // sess-2

  // A 编排会话被删除：其实例整个销毁（current/queue 清空、从 parents 摘除）
  listeners.get('session/disposed')({ id: 'parent-A' })
  const snap = snapshotNow()
  assert.deepEqual(Object.keys(snap.parents), ['parent-B'])
  assert.equal(snapOf('parent-B').current?.childId, 'sess-2')

  // A 的孤儿子代理迟到的 end：无处落账但不得拖垮 B（留痕忽略）
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'orphan' }] })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after = snapshotNow()
  assert.deepEqual(Object.keys(after.parents), ['parent-B'])
  assert.equal(snapOf('parent-B').current?.childId, 'sess-2')
  assert.equal(snapOf('parent-B').history.length, 0)

  // B 完工后正常落账推进
  listeners.get('subagent/end')({ id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'B done' }] })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(snapOf('parent-B').history.length, 1)
  assert.equal(snapOf('parent-B').history[0].conclusion, 'B done')
  assert.equal(snapOf('parent-B').current, null)
})

test('continue 先查调用方实例再全局扫描：复活已完工子代理并重新登记属主', async () => {
  let spawnCalls = 0
  const followups = []
  const { ctx, listeners, tools } = mockCtxFull({
    agents: agentsMock,
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: {
      followup: async (parent, childId, blocks) => { followups.push({ parentId: parent.id, childId }); return 'msg-x' },
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  const goWork = tools.get('go_work')

  await goWork.execute({ agent: 'explore', prompt: 'A 的任务' }, execOf(parentA)) // sess-1
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A done' }] })
  assert.equal(snapOf('parent-A').history.length, 1)

  // A 驳回重做：revive 后记录回到 A 的 currentMap
  const cont = tools.get('continue')
  const res = await cont.execute({ id: 'sess-1', prompt: '驳回：补充细节' }, execOf(parentA))
  assert.equal(res.accepted, true)
  assert.equal(followups.length, 1)
  assert.equal(followups[0].parentId, 'parent-A')
  assert.equal(snapOf('parent-A').current?.childId, 'sess-1')
  assert.equal(snapOf('parent-A').current?.status, 'running')
  assert.equal(snapOf('parent-A').history.length, 0)

  // 再次完工：经 childOwner 重登记路由回 A 的流水线正常落账
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A redone' }] })
  const snapA = snapOf('parent-A')
  assert.equal(snapA.history.length, 1)
  assert.equal(snapA.history[0].conclusion, 'A redone')
  assert.equal(snapA.current, null)
})
