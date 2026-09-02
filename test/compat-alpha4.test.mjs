// alpha.2/3 ↔ alpha.4 兼容适配回归批（0.3.0-tisitan.4）。
// 上游 0.1.2-alpha.4：SubagentRuntime.followup 并入 sendMessage、reportFrom
// 整个删除、Session.events getter 删除（→ snapshotEvents()）。共享适配
// （preset/shared/adjacent.mjs 的 sessionEvents/deliverToAdjacent/reportToParent）
// 按方法存在性特性探测：已核实 alpha.2/3 无 sendMessage、alpha.4 无
// followup/reportFrom，探测即干净分界。
// 本批覆盖：① 适配函数新/旧双路径；② broker 在 alpha.4 形态 mock（仅
// sendMessage）下的 continue/need_help 接线；③ modelCache 随 settings/updated
// 失效（改模型清单无需重启即被 agent/request 校验感知）。
// 旧路径（followup/reportFrom）的 broker 级覆盖由 multi-session/bridge 等
// 既有测试持有（它们的 mock 只提供旧 API，探测自然走旧路）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx } from './helpers/mock-ctx.mjs'
import { sessionEvents, deliverToAdjacent, canQueueAdjacent, reportToParent, planAdjacentDelivery } from '../preset/shared/adjacent.mjs'

// 上游 internal 的排队投递符号（queueHostSubagentPrompt 的运行时直取形态）
const QUEUE_PROMPT = Symbol.for('dsh.subagent.queuePrompt')

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-compat-home-'))

// ── ① sessionEvents：snapshotEvents（alpha.4）/ events getter（alpha.2/3）──

test('sessionEvents：alpha.4 形态（snapshotEvents）直返快照数组', () => {
  const evs = [{ type: 'turn/end', seq: 1 }]
  assert.equal(sessionEvents({ snapshotEvents: () => evs }), evs)
})

test('sessionEvents：alpha.2/3 形态（events getter）原样返回；缺省/非数组回落 []', () => {
  const evs = [{ type: 'step/end' }]
  assert.equal(sessionEvents({ events: evs }), evs)
  assert.deepEqual(sessionEvents({ events: 'garbage' }), [])
  assert.deepEqual(sessionEvents({}), [])
  assert.deepEqual(sessionEvents(undefined), [])
  assert.deepEqual(sessionEvents(null), [])
})

test('sessionEvents：snapshotEvents 抛错（日志已关/坏档）回落 []，维持旧 getter 不抛口径', () => {
  assert.deepEqual(sessionEvents({ snapshotEvents: () => { throw new Error('log closed') } }), [])
  assert.deepEqual(sessionEvents({ snapshotEvents: () => 'not-an-array' }), [])
  // 双形态同时在（防御）：snapshotEvents 优先
  assert.deepEqual(sessionEvents({ snapshotEvents: () => [{ type: 'a' }], events: [{ type: 'b' }] }), [{ type: 'a' }])
})

// ── ① deliverToAdjacent：sendMessage（alpha.4）/ followup（alpha.2/3）────

const blocks = [{ type: 'text', text: '继续干' }]
const parentAgent = { id: 'parent-1', session: { header: {} } }

test('deliverToAdjacent：alpha.4 走 sendMessage，sender 为精确 Agent 对象，signal 永不缺省', async () => {
  const calls = []
  const subagents = { sendMessage: async (sender, targetId, content, options) => { calls.push({ sender, targetId, content, options }); return 'msg-new' } }
  const id = await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, {
    source: { kind: 'coordinator', form: 'relay', senderSessionId: 'parent-1' },
  })
  assert.equal(id, 'msg-new')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sender, parentAgent, 'sender 必须是同一 Agent 对象（alpha.4 runtime 校验同一性）')
  assert.equal(calls[0].targetId, 'sess-1')
  assert.equal(calls[0].content, blocks)
  assert.ok(calls[0].options.signal instanceof AbortSignal, 'alpha.4 运行期 throwIfAborted 直解引用，signal 必填')
  assert.equal(calls[0].options.signal.aborted, false)
  assert.equal('source' in calls[0].options, false, 'alpha.4 的 source 由 sender 推导，coordinator 形态不可携带')
})

test('deliverToAdjacent：alpha.2/3 走旧 followup，source/signal 原样透传', async () => {
  const calls = []
  const signal = new AbortController().signal
  const source = { kind: 'coordinator', form: 'relay', senderSessionId: 'parent-1' }
  const subagents = { followup: async (parent, childId, content, options) => { calls.push({ parent, childId, content, options }); return 'msg-old' } }
  const id = await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { source, signal })
  assert.equal(id, 'msg-old')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].parent, parentAgent)
  assert.equal(calls[0].options.source, source)
  assert.equal(calls[0].options.signal, signal)
})

test('deliverToAdjacent：双 API 同在时优先新 sendMessage；两者皆缺抛错不静默', async () => {
  const sent = []
  const subagents = {
    sendMessage: async () => { sent.push(1); return 'msg-new' },
    followup: async () => { throw new Error('must not be called') },
  }
  assert.equal(await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, {}), 'msg-new')
  assert.equal(sent.length, 1)
  await assert.rejects(() => deliverToAdjacent({}, parentAgent, 'sess-1', blocks, {}), /neither sendMessage/)
  await assert.rejects(() => deliverToAdjacent(undefined, parentAgent, 'sess-1', blocks, {}), /neither sendMessage/)
})

// ── ① R4 queued 档位：真 FIFO 队列通路（alpha.4 internal 符号 / alpha.2-3 followup）──

test('canQueueAdjacent：alpha.4 带 internal 队列符号 → 可排队；符号缺席 → 不可', () => {
  assert.equal(canQueueAdjacent({ sendMessage: async () => {}, [QUEUE_PROMPT]: () => {} }), true)
  assert.equal(canQueueAdjacent({ sendMessage: async () => {} }), false,
    'alpha.4 的 sendMessage 固定 steer，无符号队列时 queued 不成立')
  assert.equal(canQueueAdjacent({}), false)
  assert.equal(canQueueAdjacent(undefined), false)
})

test('canQueueAdjacent：alpha.2/3 的 followup 本身 FIFO → 天然可排队', () => {
  assert.equal(canQueueAdjacent({ followup: async () => {} }), true)
  // 双 API 同在（防御形态）：判定顺序必须与 deliverToAdjacent 分支一致——
  // 走 sendMessage 那一支，队列符号缺席即不可排队
  assert.equal(canQueueAdjacent({ sendMessage: async () => {}, followup: async () => {} }), false)
  assert.equal(canQueueAdjacent({ sendMessage: async () => {}, followup: async () => {}, [QUEUE_PROMPT]: () => {} }), true)
})

// ── ①′ N15：投递计划（探测与投递同一份分支表的同构不变量）───────────────────

// 五形态 × 两档位。旧写法里 canQueueAdjacent 与 deliverToAdjacent 各存一份分支
// 顺序，靠注释维持同构；本批合一成 planAdjacentDelivery 后，这条不变量必须能被
// 直接测出来：**探测说能不能排队，投递就必须真的走那条路**。
const RUNTIME_SHAPES = [
  ['alpha.4 带符号队列', (hit) => ({
    sendMessage: async () => { hit.push('sendMessage'); return 'via-sendMessage' },
    [QUEUE_PROMPT]: async () => { hit.push('queuePrompt'); return 'via-queuePrompt' },
  })],
  ['alpha.4 无符号（sendMessage 固定 steer）', (hit) => ({
    sendMessage: async () => { hit.push('sendMessage'); return 'via-sendMessage' },
  })],
  ['alpha.2/3 只有 followup', (hit) => ({
    followup: async () => { hit.push('followup'); return 'via-followup' },
  })],
  ['双 API 同在（防御形态，新 API 优先）', (hit) => ({
    sendMessage: async () => { hit.push('sendMessage'); return 'via-sendMessage' },
    followup: async () => { hit.push('followup'); return 'via-followup' },
    [QUEUE_PROMPT]: async () => { hit.push('queuePrompt'); return 'via-queuePrompt' },
  })],
  ['什么都不给（坏 runtime）', () => ({})],
]

test('N15 planAdjacentDelivery：五种 runtime 形态 × 两档位的路由枚举全在册', () => {
  const expect = {
    'alpha.4 带符号队列': { queued: 'queue', steer: 'steer' },
    'alpha.4 无符号（sendMessage 固定 steer）': { queued: 'steer', steer: 'steer' },
    'alpha.2/3 只有 followup': { queued: 'legacy', steer: 'legacy' },
    '双 API 同在（防御形态，新 API 优先）': { queued: 'queue', steer: 'steer' },
    '什么都不给（坏 runtime）': { queued: 'unavailable', steer: 'unavailable' },
  }
  for (const [name, make] of RUNTIME_SHAPES) {
    for (const tier of ['queued', 'steer']) {
      const plan = planAdjacentDelivery(make([]), tier)
      assert.equal(plan.route, expect[name][tier], `${name} / ${tier} 档位`)
      // 无通路时 invoke 为 null（不是 undefined——deliverToAdjacent 判的是 `if (!invoke)`）
      if (plan.route === 'unavailable') assert.equal(plan.invoke, null, `${name} / ${tier}：无通路给 null`)
      else assert.equal(typeof plan.invoke, 'function', `${name} / ${tier}：有通路必须给可调用`)
    }
    // 缺省档位 = queued（forward 无 urgency 概念，靠这条吃到真 FIFO）
    assert.equal(planAdjacentDelivery(make([])).route, expect[name].queued, `${name} 缺省即 queued`)
  }
})

test('N15 同构不变量：canQueueAdjacent 的答复与 deliverToAdjacent 实际命中的原语逐格一致', async () => {
  const HIT_OF_ROUTE = { queue: 'queuePrompt', steer: 'sendMessage', legacy: 'followup' }
  for (const [name, make] of RUNTIME_SHAPES) {
    const hit = []
    const subagents = make(hit)
    const probe = canQueueAdjacent(subagents)
    const planRoute = planAdjacentDelivery(subagents, 'queued').route
    assert.equal(probe, planRoute === 'queue' || planRoute === 'legacy',
      `${name}：探测答复必须等于 plan 的路由口径（旧写法靠注释维持，现在靠同一张分支表）`)
    if (planRoute === 'unavailable') {
      await assert.rejects(() => deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'queued' }), /neither sendMessage/)
      assert.deepEqual(hit, [], '无通路时绝不瞎调某个原语')
      continue
    }
    hit.length = 0
    await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'queued' })
    assert.deepEqual(hit, [HIT_OF_ROUTE[planRoute]], `${name}：探测说「${planRoute}」，投递就得真打在 ${HIT_OF_ROUTE[planRoute]} 上`)
    if (planRoute === 'queue') {
      // steer 档在带队列符号的 runtime 上必须放弃 FIFO 换 next-step 可见
      hit.length = 0
      await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'steer' })
      assert.deepEqual(hit, ['sendMessage'], `${name}：steer 档不吃队列符号`)
    }
  }
})

test('deliverToAdjacent：queued 档在 alpha.4 走 internal 队列符号，绝不落 sendMessage', async () => {
  const queueCalls = []
  let steerCalls = 0
  const signal = new AbortController().signal
  const subagents = {
    sendMessage: async () => { steerCalls += 1; throw new Error('must not be called') },
    [QUEUE_PROMPT]: async (parent, childId, content, source, sig) => { queueCalls.push({ parent, childId, content, source, sig }); return 'msg-queued' },
  }
  const id = await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'queued', signal })
  assert.equal(id, 'msg-queued')
  assert.equal(steerCalls, 0, '真 FIFO 可达时不得塌档到 steer')
  assert.equal(queueCalls.length, 1)
  assert.equal(queueCalls[0].parent, parentAgent, 'parent=精确 live 父 Agent（authorizeLineage 校验同一性）')
  assert.equal(queueCalls[0].childId, 'sess-1')
  assert.equal(queueCalls[0].content, blocks)
  assert.equal(queueCalls[0].sig, signal)
  assert.deepEqual(queueCalls[0].source, { kind: 'plugin', plugin: 'dsh-my-go', form: 'relay' },
    'alpha.4 的 MessageSource 只剩 user/plugin/model/tool；排队投递用 plugin+relay')
})

test('deliverToAdjacent：steer 档即使在带队列符号的 runtime 上也直走 sendMessage', async () => {
  const calls = []
  const subagents = {
    sendMessage: async (sender, targetId, content, options) => { calls.push({ sender, targetId, options }); return 'msg-steer' },
    [QUEUE_PROMPT]: async () => { throw new Error('must not queue') },
  }
  const id = await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'steer' })
  assert.equal(id, 'msg-steer')
  assert.equal(calls[0].sender, parentAgent)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test('deliverToAdjacent：alpha.2/3 的 queued 走 followup（旧路本身 FIFO），source/signal 原样透传', async () => {
  const calls = []
  const source = { kind: 'coordinator', form: 'relay', senderSessionId: 'parent-1' }
  const subagents = { followup: async (parent, childId, content, options) => { calls.push({ parent, childId, options }); return 'msg-old' } }
  const id = await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, { delivery: 'queued', source })
  assert.equal(id, 'msg-old')
  assert.equal(calls[0].options.source, source, '旧路径仍携带 coordinator source')
  assert.equal(calls[0].options.signal, undefined, '旧路径 signal 可为 undefined（alpha.4 才必填）')
})

test('deliverToAdjacent：缺省 delivery 即 queued（forward 无 urgency 概念，best-effort 排队）', async () => {
  let queued = 0
  const subagents = {
    sendMessage: async () => { throw new Error('must not steer') },
    [QUEUE_PROMPT]: async () => { queued += 1; return 'msg-default' },
  }
  assert.equal(await deliverToAdjacent(subagents, parentAgent, 'sess-1', blocks, {}), 'msg-default')
  assert.equal(queued, 1)
})

// ── ① reportToParent：reportFrom（alpha.2/3）/ sendMessage + inject 兜底（alpha.4）──

const childAgent = { id: 'sess-1', session: { header: { parentSession: 'parent-1' } } }

test('reportToParent：alpha.2/3 走旧 reportFrom（delivery next-step 原样）', async () => {
  const calls = []
  const subagents = { reportFrom: async (child, content, options) => { calls.push({ child, content, options }); return 'msg-old' } }
  const id = await reportToParent(subagents, childAgent, 'parent-1', blocks, { signal: undefined })
  assert.equal(id, 'msg-old')
  assert.equal(calls[0].child, childAgent)
  assert.equal(calls[0].options.delivery, 'next-step')
})

test('reportToParent：alpha.4 走 sendMessage(child, parentId, …)', async () => {
  const calls = []
  const subagents = { sendMessage: async (sender, targetId, content, options) => { calls.push({ sender, targetId, content, options }); return 'msg-new' } }
  const id = await reportToParent(subagents, childAgent, 'parent-1', blocks, {})
  assert.equal(id, 'msg-new')
  assert.equal(calls[0].sender, childAgent, 'sender=精确 live 子 Agent')
  assert.equal(calls[0].targetId, 'parent-1')
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test('reportToParent：alpha.4 投递被拒（非驻留等）→ injectFallback 兜底送达不抛错', async () => {
  const subagents = { sendMessage: async () => { throw new Error('UNAUTHORIZED: not a resident continuable child') } }
  const injected = []
  const id = await reportToParent(subagents, childAgent, 'parent-1', blocks, {
    injectFallback: (error) => { injected.push(String(error)); return true },
  })
  assert.equal(id, undefined, '兜底送达按成功处理（返回值无 messageId）')
  assert.equal(injected.length, 1)
  assert.match(injected[0], /UNAUTHORIZED/)
})

test('reportToParent：alpha.4 投递被拒且无兜底/兜底返回 false → 原错上抛，绝不静默失败', async () => {
  const subagents = { sendMessage: async () => { throw new Error('parent not live') } }
  await assert.rejects(() => reportToParent(subagents, childAgent, 'parent-1', blocks, {}), /parent not live/)
  await assert.rejects(
    () => reportToParent(subagents, childAgent, 'parent-1', blocks, { injectFallback: () => false }),
    /parent not live/,
  )
  // child/parentId 缺失且只剩 sendMessage：无法定位邻接，显式抛错
  await assert.rejects(() => reportToParent(subagents, null, 'parent-1', blocks, {}), /neither reportFrom/)
  await assert.rejects(() => reportToParent(subagents, childAgent, undefined, blocks, {}), /neither reportFrom/)
})

// ── ② broker 接线：alpha.4 形态 mock（仅 sendMessage）的 continue/need_help ──

// alpha.4 形态 mock：与共用契约同形，差别只在 startContinuable 缺省给一枚
// 直返 childId 的替身（本文件重点是投递面接线，不验 spawn 参数）。
function mockCtxAlpha4({ startContinuable = async () => ({ childId: 'sess-1' }), ...rest } = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-compat-home-', startContinuable, ...rest })
}

const execOf = (agent) => ({ agent, signal: new AbortController().signal })

test('broker/alpha.4：continue 经特性探测走 sendMessage（无 followup 的 runtime 上投递成功）', async () => {
  const sent = []
  const parent = { id: 'parent-A', session: { header: {} } }
  const { ctx, tools } = mockCtxAlpha4({
    agents: { get: (id) => (id === 'parent-A' ? parent : undefined) },
    subagentsExtra: {
      // alpha.4 形态：只有 sendMessage/interrupt，无 followup/reportFrom
      sendMessage: async (sender, targetId, content, options) => {
        sent.push({ sender, targetId, text: content[0]?.text, signal: options?.signal })
        return 'msg-a4'
      },
      interrupt: () => {},
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
  const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '驳回重做' }, execOf(parent))
  assert.equal(r.accepted, true)
  assert.equal(r.messageId, 'msg-a4')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].sender, parent, 'sender=exec.agent 精确 live 父 Agent')
  assert.equal(sent[0].targetId, 'sess-1')
  assert.equal(sent[0].text, '驳回重做')
  assert.ok(sent[0].signal instanceof AbortSignal)
})

test('broker/alpha.4：need_help 经 sendMessage 上报，Sisyphus 收到的注入体不变', async () => {
  const sent = []
  const parent = { id: 'parent-A', session: { header: {} } }
  const { ctx, tools } = mockCtxAlpha4({
    agents: { get: (id) => (id === 'parent-A' ? parent : undefined) },
    subagentsExtra: {
      sendMessage: async (sender, targetId, content) => { sent.push({ sender, targetId, text: content[0]?.text }); return 'msg-help' },
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
  const child = { id: 'sess-1', session: { header: { parentSession: 'parent-A' } } }
  const r = await tools.get('need_help').execute({ intent: 'execute', content: '帮我跑这条命令' }, execOf(child))
  assert.equal(r.suspended, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].sender, child, 'sender=精确 live 子 Agent（alpha.4 source 由其推导）')
  assert.equal(sent[0].targetId, 'parent-A', 'target=子会话 header 里的直接父会话')
  assert.match(sent[0].text, /<need_help id="[^"]+" intent="execute" child="sess-1">/)
  assert.match(sent[0].text, /帮我跑这条命令/)
})

test('broker/alpha.4：need_help 的 sendMessage 被拒 → parent.inject 兜底送达，求助单挂起不炸', async () => {
  const injected = []
  const parent = {
    id: 'parent-A',
    session: { header: {} },
    inject: (message) => { injected.push(message) },
  }
  const { ctx, tools } = mockCtxAlpha4({
    agents: { get: (id) => (id === 'parent-A' ? parent : undefined) },
    subagentsExtra: {
      sendMessage: async () => { throw new Error('UNAUTHORIZED: not resident') },
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
  const child = { id: 'sess-1', session: { header: { parentSession: 'parent-A' } } }
  const r = await tools.get('need_help').execute({ intent: 'replan', content: '超出能力' }, execOf(child))
  assert.equal(r.suspended, true, '兜底送达按成功处理，挂起账不破坏')
  assert.equal(injected.length, 1, 'parent.inject 收到求助注入（行为等价旧 reportFrom）')
  assert.match(injected[0].content[0].text, /<need_help id="[^"]+" intent="replan"/)
  assert.equal(injected[0].source.kind, 'plugin', 'inject 兜底走 plugin 通知源（notifyParent 同款）')
})

test('broker/alpha.4：continue 默认 queued 档经 internal 队列符号投递（真 FIFO，不塌 steer）', async () => {
  const queued = []
  const parent = { id: 'parent-A', session: { header: {} } }
  const { ctx, tools } = mockCtxAlpha4({
    agents: { get: (id) => (id === 'parent-A' ? parent : undefined) },
    subagentsExtra: {
      // alpha.4 完整形态：sendMessage（steer-only）+ internal 队列符号
      sendMessage: async () => { throw new Error('queued 档不得走 steer') },
      [QUEUE_PROMPT]: async (agent, childId, content) => { queued.push({ agent, childId, text: content[0]?.text }); return 'msg-q' },
      interrupt: () => {},
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
  const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '驳回重做' }, execOf(parent))
  assert.equal(r.accepted, true)
  assert.equal(r.mode, 'queued', '档位如实回报 queued')
  assert.equal(r.messageId, 'msg-q')
  assert.equal(queued.length, 1)
  assert.equal(queued[0].agent, parent)
  assert.equal(queued[0].childId, 'sess-1')
  assert.equal(queued[0].text, '驳回重做')
})

test('broker/alpha.4：无队列符号的 runtime 上 queued 档退化为 steer 并如实回报 + warn 留痕', async () => {
  const sent = []
  const warned = []
  const origWarn = console.warn
  console.warn = (...a) => warned.push(a.join(' '))
  try {
    const parent = { id: 'parent-A', session: { header: {} } }
    const { ctx, tools } = mockCtxAlpha4({
      agents: { get: (id) => (id === 'parent-A' ? parent : undefined) },
      subagentsExtra: {
        // 只有 sendMessage（无 followup、无 internal 符号）：无 FIFO 通路可言
        sendMessage: async (sender, targetId, content) => { sent.push({ sender, targetId, text: content[0]?.text }); return 'msg-s' },
        interrupt: () => {},
      },
    })
    await broker.apply(ctx, { queueRetryBaseMs: 5 })
    await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
    const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '补充说明' }, execOf(parent))
    assert.equal(r.accepted, true)
    assert.equal(r.mode, 'steer', '塌档必须如实回报，绝不静默')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].text, '补充说明')
    assert.ok(warned.some((w) => /no FIFO queue route/.test(w)), '退化有 warn 留痕')
  } finally {
    console.warn = origWarn
  }
})

test('broker/alpha.4：steer 档走门面 sendMessage（不直取 Agent.steer、不入队列符号）', async () => {
  const steered = []
  const queued = []
  const sent = []
  const parent = { id: 'parent-A', session: { header: {} } }
  const childAgent = { id: 'sess-1', steer: (msg) => steered.push(msg) }
  const { ctx, tools } = mockCtxAlpha4({
    agents: { get: (id) => (id === 'parent-A' ? parent : id === 'sess-1' ? childAgent : undefined) },
    subagentsExtra: {
      sendMessage: async (sender, targetId, content, options) => {
        sent.push({ sender, targetId, text: content[0]?.text, options })
        return 'msg-steer-inbox-77'
      },
      [QUEUE_PROMPT]: async () => { queued.push(1); return 'msg-q' },
      interrupt: () => {},
    },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
  const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '中途纠偏', urgency: 'steer' }, execOf(parent))
  assert.equal(r.mode, 'steer')
  assert.equal(r.messageId, 'msg-steer-inbox-77', 'messageId 是门面返回的真实 inbox id，不再自造')
  assert.equal(steered.length, 0, '不再绕过 subagents 门面直调 Agent.steer')
  assert.equal(queued.length, 0, 'steer 档绝不入排队符号')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].sender, parent)
  assert.equal(sent[0].text, '中途纠偏')
  assert.equal('source' in sent[0].options, false, 'alpha.4 支不携带退役的 coordinator source')
})

test('broker/alpha.4：steer 被门面拒收 → warn 留痕并回落 queued 通路（绝不静默）', async () => {
  const queued = []
  const warned = []
  const parent = { id: 'parent-A', session: { header: {} } }
  const childAgent = { id: 'sess-1', steer: () => { throw new Error('must not be called') } }
  const origWarn = console.warn
  console.warn = (...args) => { warned.push(args.map(String).join(' ')) }
  try {
    const { ctx, tools } = mockCtxAlpha4({
      agents: { get: (id) => (id === 'parent-A' ? parent : id === 'sess-1' ? childAgent : undefined) },
      subagentsExtra: {
        sendMessage: async () => { throw new Error('UNAUTHORIZED lineage') },
        [QUEUE_PROMPT]: async () => { queued.push(1); return 'msg-q-fallback' },
        interrupt: () => {},
      },
    })
    await broker.apply(ctx, { queueRetryBaseMs: 5 })
    await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
    const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '纠偏', urgency: 'steer' }, execOf(parent))
    assert.equal(r.accepted, true, '门面拒收后仍把话送到')
    assert.equal(r.mode, 'queued', '实际档位如实回报')
    assert.equal(r.messageId, 'msg-q-fallback')
    assert.equal(queued.length, 1)
    assert.ok(warned.some((w) => /urgency=steer.*facade steer rejected/.test(w)), 'steer 被拒有留痕')
  } finally {
    console.warn = origWarn
  }
})

// ── ③ modelCache 根治：settings/updated 后模型清单缓存失效 ─────────────────

test('modelCache：settings/updated 热更后重新拉取 provider 模型清单，无需重启即感知', async () => {
  let stored = { sisyphus: { provider: 'p1', model: 'm-old' } }
  let catalog = ['m-old']
  let listCalls = 0
  const settings = { get: (ns) => (ns === 'dsh-my-go' ? stored : undefined) }
  const llm = {
    listModels: async (pid) => { listCalls += 1; assert.equal(pid, 'p1'); return catalog.map((id) => ({ id })) },
  }
  const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
  // C-09：listeners 的值是 fn[] 多播数组——重复注册不再互相覆盖，而是当场数得出来
  const onRequestHandlers = listeners.get('agent/request') ?? []
  assert.equal(onRequestHandlers.length, 1, 'agent/request 只注册一个 handler')
  const onRequest = onRequestHandlers[0]
  const agent = { id: 'root-1', session: { header: {} } }
  const next = async () => ({ provider: 'p1', model: 'seed-model' })

  // 第一发：m-old 在清单内 → 绑定生效，清单入缓存
  const first = await onRequest({ agent }, next)
  assert.equal(first.model, 'm-old')
  assert.equal(listCalls, 1)

  // provider 侧换成 m-new（模拟使用者刚在别处配好模型），settings 同步改绑定
  catalog = ['m-new']
  stored = { sisyphus: { provider: 'p1', model: 'm-new' } }
  dispatch('settings/updated', 'dsh-my-go')

  // 第二发：缓存已随热更失效 → 重新拉清单，m-new 校验通过即绑定
  const second = await onRequest({ agent }, next)
  assert.equal(listCalls, 2, 'settings/updated 必须清掉 modelCache（不清则沿用旧清单、误判 m-new 不存在）')
  assert.equal(second.model, 'm-new')

  // 第三发：缓存重建后同清单内复用，不每请求重拉
  const third = await onRequest({ agent }, next)
  assert.equal(listCalls, 2)
  assert.equal(third.model, 'm-new')
})

// ── ③b 缓存纪律（0.3.0-tisitan.7 N9/N10）：什么算结论、热更后一律作废 ─────────────
// 两枚缓存此前各有一个方向失误：modelCache 把「列举成功的空/不含结果」当未知
// 反复重拉，却又让在飞响应回写刚清掉的缓存；effortCache 压根没有清理点，还把
// null（未知）当真值永挂。以下用例逐条钉死。

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms))
const sisyphusPayload = { agent: { id: 'root-1', session: { header: {} } } }
const seedNext = async () => ({ provider: 'p1', model: 'seed-model' })
// waterfall 链的返回值 = 最外层 handler 的结果（替身 dispatch 已按真宿主串法实现）
const askWaterfall = (dispatch) => dispatch('agent/request', sisyphusPayload, seedNext)

test('modelCache：在飞的 listModels 响应不回写热更后的缓存（epoch 竞态，N9）', async () => {
  let stored = { sisyphus: { provider: 'p1', model: 'm-old' } }
  let catalog = ['m-old']
  let listCalls = 0
  let release
  const settings = { get: (ns) => (ns === 'dsh-my-go' ? stored : undefined) }
  const llm = {
    listModels: async () => {
      listCalls += 1
      const snapshot = catalog.map((id) => ({ id })) // 在飞响应携带发出时刻的清单
      if (listCalls === 1) await new Promise((r) => { release = r })
      return snapshot
    },
  }
  const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
  const inflight = askWaterfall(dispatch)
  await settle()
  // 窗口内热更：provider 侧换模型 + settings 改绑定 → 缓存整体作废
  catalog = ['m-new']
  stored = { sisyphus: { provider: 'p1', model: 'm-new' } }
  dispatch('settings/updated', 'dsh-my-go')
  release()
  const first = await inflight
  assert.equal(first.model, 'm-old', '本次请求按已读到的清单作答（既有语义不变）')
  // 决定性：陈旧清单不得回写（回写 = 刚 clear 的缓存被复活，热更失效无声撤销，
  // 且污染期无界——直到下一次热更才被撤销）
  const second = await askWaterfall(dispatch)
  assert.equal(listCalls, 2, '陈旧响应未回写 → 下一发重新拉取清单')
  assert.equal(second.model, 'm-new')
})

test('modelCache：列举成功但绑定的模型不在（含空清单）是结论 → 缓存之，不逐请求重拉（N9）', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    let listCalls = 0
    const settings = { get: (ns) => (ns === 'dsh-my-go' ? { sisyphus: { provider: 'p1', model: 'ghost-m' } } : undefined) }
    const llm = { listModels: async () => { listCalls += 1; return [] } }
    const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
    await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
    const first = await askWaterfall(dispatch)
    assert.equal(first.model, 'seed-model', '校验不过 → 保留种子模型（行为不变）')
    const second = await askWaterfall(dispatch)
    assert.equal(listCalls, 1, '列举成功=确定结论：空集也入缓存（修复前坏 provider 每请求被重拉一遍）')
    assert.equal(second.model, 'seed-model')
    assert.equal(warnings.filter((l) => l.includes('not found on provider')).length, 2, '每发仍各自留痕')
  } finally {
    console.warn = origWarn
  }
})

test('modelCache：listModels 抛错 / llm 服务缺席属「不知道」→ 不缓存，逐请求重试（N9）', async () => {
  const origWarn = console.warn
  console.warn = () => {}
  try {
    let listCalls = 0
    const settings = { get: (ns) => (ns === 'dsh-my-go' ? { sisyphus: { provider: 'p1', model: 'm1' } } : undefined) }
    const llm = { listModels: async () => { listCalls += 1; throw new Error('provider offline') } }
    const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
    await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
    assert.equal((await askWaterfall(dispatch)).model, 'seed-model')
    assert.equal((await askWaterfall(dispatch)).model, 'seed-model')
    assert.equal(listCalls, 2, '瞬时失败不留负缓存：provider 恢复后下一发即能绑定生效')
  } finally {
    console.warn = origWarn
  }
})

test('effortCache：能力表热更后重新解析，改好的档位即刻生效（此前无任何清理点，N10）', async () => {
  let stored = { sisyphus: { provider: 'p1', model: 'm1', reasoningEffort: 'high' } }
  let efforts = [{ id: 'low' }]
  let infoCalls = 0
  const settings = { get: (ns) => (ns === 'dsh-my-go' ? stored : undefined) }
  const llm = {
    listModels: async () => [{ id: 'm1' }],
    resolveModelInfo: async () => { infoCalls += 1; return { reasoning: { efforts } } },
  }
  const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
  const first = await askWaterfall(dispatch)
  assert.equal(first.reasoningEffort, undefined, 'high 不在能力表内 → 不设档位（既有纪律）')
  await askWaterfall(dispatch)
  assert.equal(infoCalls, 1, '成功结果（非空档位表）照常缓存')
  // provider 侧补齐能力表 + 热更（缓存必须随绑定一起作废）
  efforts = [{ id: 'low' }, { id: 'high' }]
  stored = { sisyphus: { provider: 'p1', model: 'm1', reasoningEffort: 'high' } }
  dispatch('settings/updated', 'dsh-my-go')
  const after = await askWaterfall(dispatch)
  assert.equal(infoCalls, 2, 'settings/updated 必须清 effortCache')
  assert.equal(after.reasoningEffort, 'high', '热更后 effort 绑定重新生效（修复前旧表永挂，绑定静默失效）')
})

test('effortCache：resolveModelInfo 成功但读不到档位表 → null 不缓存（不把「没读到」判成永久不支持，N10）', async () => {
  let infoCalls = 0
  const settings = { get: (ns) => (ns === 'dsh-my-go' ? { sisyphus: { provider: 'p1', model: 'm1', reasoningEffort: 'high' } } : undefined) }
  const llm = {
    listModels: async () => [{ id: 'm1' }],
    resolveModelInfo: async () => { infoCalls += 1; return {} }, // 无 reasoning 段
  }
  const { ctx, listeners, dispatch } = mockCtxAlpha4({ settings, llm })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindSisyphus: true })
  assert.equal((await askWaterfall(dispatch)).reasoningEffort, undefined)
  assert.equal((await askWaterfall(dispatch)).reasoningEffort, undefined)
  assert.equal(infoCalls, 2, 'null 是未知而非结论：不入缓存，留待下次现读')
})

// ── ④ 契约哨兵：真宿主 dsh-subagent 的 API 形状（防适配层静默塌档）──────────
// 整条兼容分界建立在「alpha.3+ 门面只剩 sendMessage + 真排队靠 internal 队列
// 符号」这一事实上。上游若改名/删符号，本仓 mock 测试不会红——只有拿真宿主
// prototype 对账才会红。解析不到宿主包或版本不足 alpha.3 门槛时整组 skip 并注明原因。
//
// 0.3.0-tisitan.11（N1）起本闸**在本仓合闸真跑**：devDependencies 从 rc.8 线升到
// `^0.1.2-alpha.4`（npm 因家族内交叉 peer 实际解析到 0.1.2-alpha.5）。此前它长期
// 停在 rc.8（低于自家 peer floor），门槛不满足 → 本仓 npm test 恒走 skip 分支，
// 也就是「全仓唯一的宿主契约闸从未在本仓合过闸」。现在 `# skipped 0` 就是它在位的
// 证据；真要回归，看这条用例红没红，别看别的档。

function prereleaseRank(pre) {
  // semver §11：数字标识符优先级低于字母标识符；逐段比较，前缀短者小
  return pre === undefined ? undefined : pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
}

function comparePrerelease(a, b) {
  const [xs, ys] = [prereleaseRank(a), prereleaseRank(b)]
  if (xs === undefined && ys === undefined) return 0
  if (xs === undefined) return 1 // 无预发布 = 正式版，优先级高于任何预发布
  if (ys === undefined) return -1
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    const x = xs[i]
    const y = ys[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

// 返回 -1/0/1：a 相对 b 的大小（仅覆盖本仓用得到的 core + prerelease 形态）
function compareVersions(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(a)) ?? []
  const pb = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(b)) ?? []
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(pa[i] ?? -1) - Number(pb[i] ?? -1)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return comparePrerelease(pa[4], pb[4])
}

function hostSubagentVersion() {
  try {
    return createRequire(import.meta.url)('@deepseek-ai/dsh-subagent/package.json').version
  } catch {
    return undefined // 不可解析（未安装 / exports 不暴露 package.json / 离线环境）
  }
}

test('契约哨兵：宿主 dsh-subagent >= 0.1.2-alpha.3 时门面只剩 sendMessage 且队列符号在位', async (t) => {
  const version = hostSubagentVersion()
  if (typeof version !== 'string') return t.skip('宿主 @deepseek-ai/dsh-subagent 不可解析（本仓未安装该依赖），契约哨兵跳过')
  if (compareVersions(version, '0.1.2-alpha.3') < 0) return t.skip(`解析到宿主版本 ${version}，低于 0.1.2-alpha.3 门槛，契约哨兵跳过`)
  const mod = await import('@deepseek-ai/dsh-subagent')
  const Runtime = mod.SubagentRuntime ?? mod.default
  assert.equal(typeof Runtime, 'function', `版本 ${version} 的 dsh-subagent 必须导出 SubagentRuntime`)
  const proto = Runtime.prototype
  assert.equal(typeof proto?.sendMessage, 'function', 'alpha.3+ 门面必须有 sendMessage（deliverToAdjacent/reportToParent 的新路径）')
  assert.equal(proto.followup, undefined, 'followup 必须已并入 sendMessage（探测分界的前提）')
  assert.equal(proto.reportFrom, undefined, 'reportFrom 必须已删（否则 need_help 兜底路径假设失效）')
  assert.equal(typeof proto[Symbol.for('dsh.subagent.queuePrompt')], 'function', '真 FIFO 排队通路（R4）依赖的注册符号必须在 prototype 上，否则 queued 档会静默塌成 steer')
})
