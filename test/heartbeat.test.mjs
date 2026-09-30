// dsh-my-go — 主编缓存心跳（keep-alive heartbeat）测试。
//
// 两档（对齐 metrics.test.mjs 的成功模式）：
//   ① 模块与登记表直测：配置归一 / 摘要（字段·排序·字节上限）/ 起表·停表 / 跳拍 /
//      建议ping 与升级标红 / 信号清零 / 复活轮计时重置 / 终局清理。用注入式假时钟
//      一拍一拍手动推——**不 patch 全局定时器**：同进程还有台账防抖、宽限期与
//      waitFor 自己的计时器，全局替换会把这些一起冻住（waitFor 直接超时假红）。
//   ② broker 端到端接线档：go_work 后起表并真投递 followup（唤醒档，不是 inject）、
//      主编 running 跳拍、end 后重估停表、agent/disposed 停表、宿主配置桥热更即生效、
//      默认关零扰动。停表「有没有发生」是纯内部状态，外部只能靠 metrics JSONL 里的
//      heartbeat 事件看见它，故该档的观测量就是这份事件档 + 父会话收到的投递对象。
//
// 等待纪律：正向等待一律轮询谓词（投递数组 / 事件档内容），负向窗口才用 drain。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as broker from '../preset/tools/broker.mjs'
import { Orchestration } from '../preset/tools/broker.mjs'
import { createChildRegistry } from '../preset/shared/child-registry.mjs'
import { KEEP_ALIVE_DEFAULTS, HEARTBEAT_LIMIT_TICKS, HEARTBEAT_SUMMARY_MAX_BYTES } from '../preset/shared/constants.mjs'
import { createHeartbeatOps, normalizeKeepAlive, buildHeartbeatSummary, formatDuration, utf8Bytes } from '../preset/tools/broker-heartbeat.mjs'
import { METRICS_FILE } from '../preset/tools/metrics.mjs'
import { createMockCtx, withRealSignalContract, execOf, setHostBindings, createFakeClock, waitFor, drain } from './helpers/mock-ctx.mjs'

const MINUTE = 60000

function captureWarn() {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  return { warnings, restore: () => { console.warn = origWarn } }
}

// ── ① 模块直测的装置 ────────────────────────────────────────────────────────

/**
 * 心跳簇的最小装置：假时钟 + 真登记表 + 真 Orchestration（占槽与排队都走状态机
 * 本身，不手搓记录形状）+ 捕获投递的父会话替身。
 */
function makeRig({ keepAlive = {}, status = 'idle', followup, ownerAlive = true, extraParents = [] } = {}) {
  const clock = createFakeClock()
  const orchestrations = new Map()
  const childRegistry = createChildRegistry()
  const events = []
  const delivered = []
  let config = { ...KEEP_ALIVE_DEFAULTS, enabled: true, ...keepAlive }
  let parentStatus = status
  // ownerAlive：模拟「agent 已销毁、台账还留着在册记录等 disposed 宽限期」的现场
  // （resolveParentAgent 查不到 id）——R-2 的判据要用它。
  let alive = ownerAlive
  const parent = {
    id: 'parent-1',
    get status() { return parentStatus },
    followup: followup === undefined ? (message) => delivered.push(message) : followup,
  }
  // extraParents：同实例的第二/第三主编会话（隔离类用例——「A 亲手停表有没有
  // 越到 B 身上」）。形状与 parent-1 同构，各自一条投递数组，断言不靠摘要文本猜。
  const extras = new Map()
  for (const id of extraParents) {
    const row = { id, delivered: [], agent: { id, status: 'idle', followup: (message) => row.delivered.push(message) } }
    extras.set(id, row)
  }
  const ops = createHeartbeatOps({
    readConfig: () => normalizeKeepAlive(config, undefined),
    resolveParentAgent: (pid) => (pid === 'parent-1' ? (alive ? parent : undefined) : extras.get(pid)?.agent),
    orchestrations,
    childRegistry,
    metrics: { record: (event) => events.push(event) },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return {
    clock, orchestrations, childRegistry, events, delivered, ops, parent, extras,
    setStatus: (next) => { parentStatus = next },
    setOwnerAlive: (next) => { alive = next },
    setConfig: (next) => { config = { ...config, ...next } },
    phases: () => events.filter((event) => event.kind === 'heartbeat').map((event) => event.phase),
  }
}

/** 占一个在飞槽位（真状态机：beginSpawning → bindChild），并落一次 spawn 信号。 */
function occupy(rig, { childId = 'sess-1', agentType = 'hermes', parentId = 'parent-1' } = {}) {
  let orch = rig.orchestrations.get(parentId)
  if (!orch) {
    orch = new Orchestration()
    rig.orchestrations.set(parentId, orch)
  }
  const rec = orch.beginSpawning(agentType, 'task')
  orch.bindChild(rec.childId, childId)
  const entry = rig.childRegistry.noteHeartbeatSignal(childId, rig.clock.at)
  return { childId, orch, entry }
}

const summaryOf = (message) => message.content[0].text

// ── 配置归一（设置面读到的值 → 运行时行为值）────────────────────────────────

test('normalizeKeepAlive：默认单源、两层合并、非法值一律回落默认', () => {
  assert.deepEqual(normalizeKeepAlive(undefined, undefined), { ...KEEP_ALIVE_DEFAULTS }, '缺席 = 默认段（enabled 默认关）')
  // 插件行 config 是基线，宿主 settings 段覆盖其上（与本仓 bindings 同律）
  assert.deepEqual(
    normalizeKeepAlive({ enabled: true, orchestratorIntervalMs: 60000 }, { childPingAfterMs: 120000 }),
    { enabled: true, orchestratorIntervalMs: 60000, childPingAfterMs: 120000, escalateAfterPings: 3 },
    '段里有值用段、没有的回落到基线',
  )
  assert.equal(normalizeKeepAlive({ enabled: true }, { enabled: false }).enabled, false, '段能关掉基线里的开')
  assert.equal(normalizeKeepAlive({ enabled: 'true' }, undefined).enabled, false, '只有真 true 才算开（字符串不算）')
  assert.equal(normalizeKeepAlive(undefined, { enabled: true }).enabled, true)
  // 非法时长：0 / 负数 / NaN / Infinity / 非数字串 / null / 容器 一律回落默认
  //（配置写坏不该变成忙循环或一拍空转）
  for (const bad of [0, -1, NaN, Infinity, 'abc', null, {}, []]) {
    assert.deepEqual(
      normalizeKeepAlive(undefined, { orchestratorIntervalMs: bad, childPingAfterMs: bad, escalateAfterPings: bad }),
      { ...KEEP_ALIVE_DEFAULTS },
      `非法值 ${String(bad)} 回落默认`,
    )
  }
  assert.equal(normalizeKeepAlive(undefined, { orchestratorIntervalMs: '90000' }).orchestratorIntervalMs, 90000, '数字串收口成数字（settings.yaml 手改形态）')
  assert.equal(normalizeKeepAlive(undefined, { orchestratorIntervalMs: 1500.7 }).orchestratorIntervalMs, 1500, '非整数截断')
  assert.deepEqual(normalizeKeepAlive('garbage', 42), { ...KEEP_ALIVE_DEFAULTS }, '两层都不是对象 = 默认段（桥缺席/旧宿主形态）')
})

test('formatDuration / utf8Bytes：摘要用到的两个量纲', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(45000), '45s')
  assert.equal(formatDuration(12 * MINUTE), '12m')
  assert.equal(formatDuration(125 * MINUTE), '2h05m')
  assert.equal(formatDuration(-5), '0s')
  assert.equal(utf8Bytes('a'), 1)
  assert.equal(utf8Bytes('中'), 3)
  assert.equal(utf8Bytes(undefined), 0)
})

// ── 摘要（进主编上下文的那一条）──────────────────────────────────────────────

test('buildHeartbeatSummary：字段齐备（childId/工种/本轮已运行/距上次信号/ping 数 + 排队 + 求助）', () => {
  const at = 1_700_000_000_000
  const text = buildHeartbeatSummary({
    tick: 7,
    queueLen: 2,
    helpCount: 1,
    at,
    children: [
      { childId: 'sess-a', agentType: 'hermes', roundStartAt: at - 12 * MINUTE, lastSignalAt: at - 31 * MINUTE, pingsUnanswered: 0, stale: true, escalate: false },
      { childId: 'sess-b', agentType: 'explore', roundStartAt: at - 3 * MINUTE, lastSignalAt: at - 3 * MINUTE, pingsUnanswered: 0, stale: false, escalate: false },
    ],
  })
  assert.ok(text.includes('心跳维护回合 #7'), '拍号在场')
  assert.ok(text.includes('在飞 2 排队 2 待决求助 1'), '在飞/排队/待决求助三个计数在场')
  assert.ok(text.includes('｜界限≈37m'), '头行尾带界限（默认拍距 250s × 9 = 2250s → 37m）')
  assert.ok(text.includes('- sess-a hermes run12m sig31m ping0 建议ping'), '每行四字段 + 建议ping 标记')
  assert.ok(text.includes('- sess-b explore run3m sig3m ping0'), '未到阈值的行不带建议ping')
  assert.ok(!text.includes('⚠'), '未升级的行不标红')
  assert.ok(text.includes('sisyphus.md「心跳维护回合」'), '指向主编侧回合纪律（话术不在摘要里复述）')
  assert.ok(utf8Bytes(text) <= HEARTBEAT_SUMMARY_MAX_BYTES, `≤${HEARTBEAT_SUMMARY_MAX_BYTES}B`)
})

test('buildHeartbeatSummary：标红行排最前、升级文案带连拍数；超限折成 +N 条且绝不超 500B', () => {
  const at = 1_700_000_000_000
  const mk = (index, over = {}) => ({
    childId: `12345678-1234-1234-1234-1234567890${String(index).padStart(2, '0')}`,
    agentType: 'hermes',
    roundStartAt: at - 5 * MINUTE,
    lastSignalAt: at - 5 * MINUTE,
    pingsUnanswered: 0,
    stale: false,
    escalate: false,
    ...over,
  })
  const escalated = mk(1, { stale: true, escalate: true, pingsUnanswered: 3, lastSignalAt: at - 40 * MINUTE })
  const suggested = mk(2, { stale: true, lastSignalAt: at - 31 * MINUTE })
  const quiet = mk(3)
  const text = buildHeartbeatSummary({ tick: 1, at, children: [quiet, escalated, suggested] })
  const lines = text.split('\n')
  assert.ok(lines[1].includes(escalated.childId), '标红行排第一（截断先丢的永远是不需要动作的行）')
  assert.ok(lines[2].includes(suggested.childId), '建议ping 行排第二')
  assert.ok(lines[1].includes('⚠连续3轮无回应→当场裁决'), '升级文案带连拍数')
  // 30 个在飞子代：必然截断，但总量受控、且明说去哪儿看余下条目
  const many = Array.from({ length: 30 }, (_, i) => mk(i + 10))
  const crowded = buildHeartbeatSummary({ tick: 2, at, children: many, queueLen: 3, helpCount: 0 })
  assert.ok(utf8Bytes(crowded) <= HEARTBEAT_SUMMARY_MAX_BYTES, `30 行压到 ≤${HEARTBEAT_SUMMARY_MAX_BYTES}B（实测 ${utf8Bytes(crowded)}B）`)
  assert.match(crowded, /\+\d+ 条见 orchestration_status/, '截断余量折成一行计数（不静默吞）')
  assert.ok(crowded.startsWith('[dsh-my-go] 心跳维护回合 #2'), '头行不被截掉')
})

test('头部界限：常量为 9（缓存命中十倍率减一），X = 常量 × 拍距，随拍距热更跟随且不破 500B', () => {
  assert.equal(HEARTBEAT_LIMIT_TICKS, 9, '9 = 3.00 ÷ 0.30 − 1（5m 档）；上 1h 档应改 19')
  const at = 1_700_000_000_000
  const child = { childId: 'sess-a', agentType: 'hermes', roundStartAt: at - MINUTE, lastSignalAt: at - MINUTE, pingsUnanswered: 0, stale: false, escalate: false }
  // 直测：界限走该模块既有的紧凑时长口径（调用方给生效拍距算出的 limitMs）
  const fiveMin = buildHeartbeatSummary({ tick: 1, at, children: [child], limitMs: HEARTBEAT_LIMIT_TICKS * 250000 })
  assert.ok(
    fiveMin.startsWith('[dsh-my-go] 心跳维护回合 #1｜在飞 1 排队 0 待决求助 0｜界限≈37m'),
    `250s 档 → 9 × 250s = 37m：[${fiveMin.split('\n')[0]}]`,
  )
  const oneHour = buildHeartbeatSummary({ tick: 2, at, children: [child], limitMs: HEARTBEAT_LIMIT_TICKS * 3600000 })
  assert.ok(oneHour.includes('｜界限≈9h00m'), `1h 档 → 9 × 3600s = 9h00m：[${oneHour.split('\n')[0]}]`)
  assert.ok(utf8Bytes(oneHour) <= HEARTBEAT_SUMMARY_MAX_BYTES, `头行加界限远未到上限，仍受 ${HEARTBEAT_SUMMARY_MAX_BYTES}B 管着`)
  // 端到端形态：拍距逐拍现读 → 热更后下一拍的界限自动跟随（不在起表时算死）
  const rig = makeRig({ keepAlive: { orchestratorIntervalMs: 1000 } })
  occupy(rig)
  rig.ops.ensure('parent-1')
  rig.ops.tickOnce('parent-1')
  assert.ok(summaryOf(rig.delivered[0]).includes('｜界限≈9s'), `9 × 1000ms = 9s：[${summaryOf(rig.delivered[0]).split('\n')[0]}]`)
  rig.setConfig({ orchestratorIntervalMs: 20 * MINUTE })
  rig.ops.tickOnce('parent-1')
  assert.ok(summaryOf(rig.delivered[1]).includes('｜界限≈3h00m'), `热更到 20 分钟后本拍即跟随：[${summaryOf(rig.delivered[1]).split('\n')[0]}]`)
})

// ── 起表 / 停表 / 跳拍 ──────────────────────────────────────────────────────

test('ensure：开启才起表且幂等（同一主编会话恒一枚定时器）', () => {
  const on = makeRig()
  assert.equal(on.ops.ensure('parent-1'), true)
  assert.deepEqual(on.ops.runningOwners(), ['parent-1'])
  assert.equal(on.clock.pending(), 1, '一枚定时器')
  assert.equal(on.ops.ensure('parent-1'), false, '二次 ensure 幂等（不重排、不叠加）')
  assert.equal(on.clock.pending(), 1)
  assert.deepEqual(on.phases(), ['start'])
  assert.equal(on.ops.ensure(''), false, '空 id 不起表')
  const off = makeRig({ keepAlive: { enabled: false } })
  assert.equal(off.ops.ensure('parent-1'), false, '关闭态不起表')
  assert.equal(off.clock.pending(), 0)
  assert.deepEqual(off.phases(), [], '关闭态连事件都不记')
})

test('tickOnce：注册表无在飞子代 → 停表（撤定时器 + stop-idle-registry）', () => {
  const rig = makeRig()
  rig.ops.ensure('parent-1')
  assert.equal(rig.clock.pending(), 1)
  assert.equal(rig.ops.tickOnce('parent-1'), 'stopped')
  assert.equal(rig.clock.pending(), 0, '自身撤掉定时器')
  assert.deepEqual(rig.ops.runningOwners(), [])
  assert.ok(rig.phases().includes('stop-idle-registry'))
  assert.equal(rig.delivered.length, 0, '没有等待中的子代就没有唤醒')
})

test('tickOnce：主编 running → 跳拍（不投递、定时器重排），转 idle 后再拍照常唤醒', () => {
  const rig = makeRig({ status: 'running', keepAlive: { orchestratorIntervalMs: 1000 } })
  occupy(rig)
  rig.ops.ensure('parent-1')
  rig.clock.advance(1000)
  assert.equal(rig.delivered.length, 0, '主编 running 时不插队')
  assert.ok(rig.phases().includes('skip-running'))
  assert.equal(rig.clock.pending(), 1, '跳拍是重排而不是停表')
  rig.setStatus('idle')
  rig.clock.advance(1000)
  assert.equal(rig.delivered.length, 1, '主编安静下来后同一会话照常被唤醒')
  assert.ok(summaryOf(rig.delivered[0]).includes('心跳维护回合 #1'), '拍号只数真唤醒（主编见到的序号连续，不出现跳号）')
})

test('tickOnce：唤醒走 followup（唤醒档）且载荷形状与通知源一致', () => {
  const rig = makeRig()
  occupy(rig)
  assert.equal(rig.ops.tickOnce('parent-1'), 'woken')
  assert.equal(rig.delivered.length, 1)
  const message = rig.delivered[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'plugin:dsh-my-go', '生产者自持 kind（与 notify 同源）')
  assert.equal(message.source.form, 'notice', '内容语义是「刚发生了一件事」的账；唤醒与否由投递档承担')
  assert.ok(typeof message.source.summary === 'string' && message.source.summary.length <= 120, 'notice 的 summary 有界')
  assert.ok(message.id.startsWith('mygo-heartbeat-'))
  assert.ok(Array.isArray(message.content) && message.content[0].type === 'text')
})

test('无 followup 门面：留痕并停表（不空转）', () => {
  const warn = captureWarn()
  try {
    const rig = makeRig()
    rig.parent.followup = undefined
    occupy(rig)
    rig.ops.ensure('parent-1')
    assert.equal(rig.ops.tickOnce('parent-1'), 'stopped')
    assert.ok(rig.phases().includes('stop-no-followup'))
    assert.ok(warn.warnings.some((line) => line.includes('no followup')), '留痕说明为什么不再拍')
    assert.equal(rig.clock.pending(), 0)
  } finally {
    warn.restore()
  }
})

test('热更关闭：配置逐拍现读，关掉后下一拍即停表', () => {
  const rig = makeRig({ keepAlive: { orchestratorIntervalMs: 1000 } })
  occupy(rig)
  rig.ops.ensure('parent-1')
  assert.equal(rig.clock.pending(), 1)
  rig.setConfig({ enabled: false })
  rig.clock.advance(1000)
  assert.equal(rig.delivered.length, 0)
  assert.ok(rig.phases().includes('stop-disabled'))
  assert.equal(rig.clock.pending(), 0)
})

test('stop：带原因停表（disposed / session-disposed 由 broker 传入）；空转不记事件', () => {
  const rig = makeRig()
  occupy(rig)
  rig.ops.ensure('parent-1')
  assert.equal(rig.ops.stop('parent-1', 'disposed'), true)
  assert.deepEqual(rig.ops.runningOwners(), [])
  assert.ok(rig.phases().includes('stop-disposed'))
  assert.equal(rig.ops.stop('parent-1', 'disposed'), false, '再停一次是空转')
  assert.equal(rig.phases().filter((phase) => phase === 'stop-disposed').length, 1, '空转不重复记事件')
  rig.ops.ensure('parent-1')
  rig.ops.stopAll()
  assert.deepEqual(rig.ops.runningOwners(), [], 'stopAll 撤全部（卸载收尾）')
  assert.equal(rig.clock.pending(), 0)
})

test('syncAll：end 之后停「无在飞」的会话（带 end-reevaluate 原因）；仍有占位（含 spawning）的照常续拍', () => {
  const rig = makeRig()
  const { orch } = occupy(rig, { childId: 'sess-1' })
  rig.ops.ensure('parent-1')
  assert.deepEqual(rig.ops.syncAll('end-reevaluate'), { started: [], stopped: [] }, '还有在飞记录 → 不停')
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'])
  orch.finish('sess-1', 'done')
  assert.deepEqual(rig.ops.syncAll('end-reevaluate'), { started: [], stopped: ['parent-1'] }, '最后一条记录落史即停表')
  assert.deepEqual(rig.ops.runningOwners(), [])
  assert.ok(rig.phases().includes('stop-end-reevaluate'))
})

test('syncAll：spawning 占位也算在飞', () => {
  const rig = makeRig()
  const orch = new Orchestration()
  rig.orchestrations.set('parent-1', orch)
  orch.beginSpawning('hermes', 'task')
  rig.ops.ensure('parent-1')
  assert.deepEqual(rig.ops.syncAll('end-reevaluate'), { started: [], stopped: [] })
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'])
})

test('syncAll（F2）：在飞中把 enabled 从关翻到开 → 补起表', () => {
  const rig = makeRig({ keepAlive: { enabled: false } })
  occupy(rig, { childId: 'sess-1' })
  assert.equal(rig.ops.ensure('parent-1'), false, '关闭态不起表')
  assert.equal(rig.clock.pending(), 0)
  // 热更：桥段把开关打开——这一刻之前，在飞会话身上没有任何派发事件可挂
  rig.setConfig({ enabled: true })
  assert.deepEqual(rig.ops.syncAll('settings-revision'), { started: ['parent-1'], stopped: [] }, '对账把拍子点起来')
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'])
  assert.equal(rig.clock.pending(), 1)
  rig.clock.advance(300000)
  assert.equal(rig.delivered.length, 1, '补起的拍子是真的（下一拍即唤醒）')
  assert.equal(rig.phases().filter((phase) => phase === 'start').length, 1)
  assert.equal(rig.events.find((event) => event.phase === 'start')?.via, 'settings-revision', '起表事件带来源（谁把拍子点着的）')
})

test('syncAll（R-2）：属主 agent 已销毁（台账留槽等宽限期）→ 不补起表，不给注定空转的一拍留定时器', () => {
  const rig = makeRig({ ownerAlive: false })
  occupy(rig, { childId: 'sess-1' })
  assert.deepEqual(rig.ops.syncAll('settings-revision'), { started: [], stopped: [] }, '在飞但查不到活体 → 不起表')
  assert.deepEqual(rig.ops.runningOwners(), [])
  // 对照：同一条流水线，属主回来了（agent 重新在册）→ 照常补起表
  rig.setOwnerAlive(true)
  assert.deepEqual(rig.ops.syncAll('settings-revision'), { started: ['parent-1'], stopped: [] })
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'])
  // 且「已存在的拍子」不由本判据抢停：活体再次消失，syncAll 不动它（交给 tick 的 no-parent 支）
  rig.setOwnerAlive(false)
  assert.deepEqual(rig.ops.syncAll('settings-revision'), { started: [], stopped: [] })
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'], '停表决策单点在 tickOnce（两处不重复决策）')
})

test('syncAll：关闭态对在飞会话不抢停（留给下一拍自停），对空流水线照常停', () => {
  const rig = makeRig()
  const { orch } = occupy(rig, { childId: 'sess-1' })
  rig.ops.ensure('parent-1')
  rig.setConfig({ enabled: false })
  assert.deepEqual(rig.ops.syncAll('settings-revision'), { started: [], stopped: [] }, '有在飞 + 关闭 → 不抢停（留一拍余量给「关一下又开」的抖动）')
  assert.deepEqual(rig.ops.runningOwners(), ['parent-1'])
  orch.finish('sess-1', 'done')
  assert.deepEqual(rig.ops.syncAll('settings-revision').stopped, ['parent-1'], '空流水线照常停（不留空拍子）')
})

// ── 摘要取实时流水线值 ──────────────────────────────────────────────────────

test('摘要取流水线实时值：排队数与待决求助数', () => {
  const rig = makeRig()
  const { orch, childId } = occupy(rig, { childId: 'sess-1', agentType: 'hermes' })
  orch.enqueue('oracle', 'queued-task', 'parent-1')
  orch.suspend(childId, { id: 'help-1', childId, intent: 'execute', content: '代跑命令' })
  rig.ops.ensure('parent-1')
  rig.ops.tickOnce('parent-1')
  const text = summaryOf(rig.delivered[0])
  assert.ok(text.includes('在飞 1 排队 1 待决求助 1'), `三个计数取实时值：[${text}]`)
  assert.ok(text.includes('sess-1 hermes'), '挂起等处置的子代照样在摘要里出现（正是要靠它浮上台面）')
})

// ── 建议ping / 升级梯 / 信号清零 ─────────────────────────────────────────────

test('建议ping：静默过阈值的子代被标建议ping，拍内计入未回应 ping 数且不刷新信号时刻', () => {
  const rig = makeRig({ keepAlive: { childPingAfterMs: 30 * MINUTE, escalateAfterPings: 3 } })
  const { childId, entry } = occupy(rig)
  entry.lastSignalAt = rig.clock.at - 31 * MINUTE
  entry.roundStartAt = rig.clock.at - 12 * MINUTE
  rig.ops.ensure('parent-1')
  assert.equal(rig.ops.tickOnce('parent-1'), 'woken')
  const text = summaryOf(rig.delivered[0])
  assert.ok(text.includes(`${childId} hermes run12m sig31m ping1 建议ping`), `一拍即建议ping且计数进 1：[${text}]`)
  const after = rig.childRegistry.heartbeatOf(childId, rig.clock.at)
  assert.equal(after.pingsUnanswered, 1)
  assert.equal(after.lastSignalAt, rig.clock.at - 31 * MINUTE, 'ping 不刷新 lastSignalAt（刷了就等于把自己清零，升级梯永远到不了）')
})

test('升级梯：连着三拍建议 ping → 标红请当场裁决；主编一次信号即清零', () => {
  const rig = makeRig({ keepAlive: { childPingAfterMs: 30 * MINUTE, escalateAfterPings: 3 } })
  const { childId, entry } = occupy(rig)
  entry.lastSignalAt = rig.clock.at - 45 * MINUTE
  rig.ops.ensure('parent-1')
  rig.ops.tickOnce('parent-1')
  rig.ops.tickOnce('parent-1')
  assert.ok(!summaryOf(rig.delivered[1]).includes('⚠'), '第二拍还没到升级梯')
  rig.ops.tickOnce('parent-1')
  const text = summaryOf(rig.delivered[2])
  assert.ok(text.includes('ping3'), `第三拍计数 3：[${text}]`)
  assert.ok(text.includes('⚠连续3轮无回应→当场裁决'), '到达 escalateAfterPings 即标红')
  // 主编照摘要发一次 continue(steer)：登记表 noteHeartbeatSignal → 清零 + 刷新
  rig.childRegistry.noteHeartbeatSignal(childId, rig.clock.at)
  rig.ops.tickOnce('parent-1')
  const cleared = summaryOf(rig.delivered[3])
  assert.ok(cleared.includes('sig0s ping0'), `信号到达即归零：[${cleared}]`)
  assert.ok(!cleared.includes('建议ping') && !cleared.includes('⚠'), '处置过就不再催')
  assert.equal(rig.childRegistry.heartbeatOf(childId, rig.clock.at).pingsUnanswered, 0)
})

// ── 登记表侧：信号 / 复活轮 / 终局 ──────────────────────────────────────────

test('登记表：信号刷新并清零、读面补种不伪造陈旧、终局随子代删除', () => {
  const registry = createChildRegistry()
  const created = registry.noteHeartbeatSignal('sess-1', 1000)
  assert.deepEqual(created, { roundStartAt: 1000, lastSignalAt: 1000, pingsUnanswered: 0 }, 'spawn 信号即本轮起点')
  registry.noteHeartbeatPing('sess-1', 2000)
  registry.noteHeartbeatPing('sess-1', 3000)
  assert.equal(registry.heartbeatOf('sess-1', 3000).pingsUnanswered, 2)
  assert.equal(registry.heartbeatOf('sess-1', 3000).roundStartAt, 1000, 'ping 不动本轮起点')
  registry.noteHeartbeatSignal('sess-1', 4000)
  const refreshed = registry.heartbeatOf('sess-1', 4000)
  assert.equal(refreshed.lastSignalAt, 4000)
  assert.equal(refreshed.pingsUnanswered, 0, '任何信号都清零未回应数')
  assert.equal(refreshed.roundStartAt, 1000, '信号不重开本轮（复活才重开）')
  // 读面补种（冷恢复 / 台账复活后第一次被看见）：从「此刻」起算，不冒充沉默很久
  const seeded = registry.heartbeatOf('sess-cold', 9000)
  assert.deepEqual(seeded, { roundStartAt: 9000, lastSignalAt: 9000, pingsUnanswered: 0 })
  registry.noteHeartbeatPing('sess-cold', 9000)
  assert.equal(registry.heartbeatOf('sess-cold', 9000).pingsUnanswered, 1, 'ping 对缺失表项也补种后计数')
  // 终局：retireChild / retireTypeRecords 双点删（长跑进程里这张表的收缩手段）
  registry.retireChild('sess-1')
  assert.equal(registry.heartbeats.has('sess-1'), false)
  registry.retireTypeRecords('sess-cold')
  assert.equal(registry.heartbeats.has('sess-cold'), false)
})

test('复活轮计时重置：rearmChild 清心跳表项，复活后的新一轮从信号时刻起算', () => {
  const registry = createChildRegistry()
  const spawned = registry.noteHeartbeatSignal('sess-1', 1000)
  spawned.lastSignalAt = 41 * MINUTE
  spawned.roundStartAt = 41 * MINUTE
  registry.rearmChild('sess-1', { agentType: 'hermes' }, 'parent-1')
  assert.equal(registry.heartbeats.has('sess-1'), false, '复活即新一轮：上一代际的沉默时长与 ping 数一概不继承')
  const revived = registry.noteHeartbeatSignal('sess-1', 42 * MINUTE)
  assert.deepEqual(revived, { roundStartAt: 42 * MINUTE, lastSignalAt: 42 * MINUTE, pingsUnanswered: 0 })
  // 端到端形态：复活轮第一拍展示的是本轮时长，而不是上一代的 41 分钟
  const rig = makeRig()
  const { childId, entry } = occupy(rig)
  entry.lastSignalAt = rig.clock.at - 41 * MINUTE
  entry.roundStartAt = rig.clock.at - 41 * MINUTE
  rig.childRegistry.rearmChild(childId, { agentType: 'hermes' }, 'parent-1')
  rig.childRegistry.noteHeartbeatSignal(childId, rig.clock.at)
  rig.ops.ensure('parent-1')
  rig.ops.tickOnce('parent-1')
  assert.ok(summaryOf(rig.delivered[0]).includes('run0s sig0s'), '复活轮从零计时')
})

// ── ② broker 端到端接线 ────────────────────────────────────────────────────

function startParent(overrides = {}, { childAgents = false, subagentsExtra = {}, extraParents = [] } = {}) {
  const injected = []
  const followed = []
  const parent = {
    id: 'parent-1',
    session: { header: {} },
    status: 'idle',
    inject: (message) => injected.push(message),
    followup: (message) => followed.push(message),
    ...overrides,
  }
  // extraParents：同实例的第二个主编会话（「只动自己的拍子」的端到端证据）。
  // 各自一条投递数组 + 自己的 agent 替身，投递按会话分开记，不靠摘要文本猜。
  const extras = new Map()
  for (const id of extraParents) {
    const row = { id, injected: [], followed: [] }
    row.agent = {
      id,
      session: { header: {} },
      status: 'idle',
      inject: (message) => row.injected.push(message),
      followup: (message) => row.followed.push(message),
    }
    extras.set(id, row)
  }
  // childAgents：让 agents 注册表也认得子代（steer 档的第一道门槛是「活体在册」——
  // GET targetId 拿不到就不许 steer，走 queued 回退）。只给需要的用例开。
  const child = { id: 'sess-1', session: { header: { parentSession: 'parent-1' } } }
  let spawnCalls = 0
  const mock = createMockCtx({
    homePrefix: 'dsh-my-go-heartbeat-',
    captureEffects: true,
    agents: {
      get: (id) => (id === 'parent-1'
        ? parent
        : (extras.get(id)?.agent ?? (childAgents && id === 'sess-1' ? child : undefined))),
    },
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: { reportFrom: async () => 'delivered', followup: async () => 'msg-1', ...subagentsExtra },
  })
  return { parent, injected, followed, extras, mock, home: process.env.DSH_HOME, unload: () => mock.effects.forEach((effect) => effect.dispose()) }
}

// 心跳事件档读面：metrics 走异步写链，读面必须容忍「只写了一半的行」。
function readHeartbeatEvents(home) {
  let raw
  try {
    raw = readFileSync(join(home, 'dsh-my-go', 'metrics', METRICS_FILE), 'utf-8')
  } catch {
    return []
  }
  const rows = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      const row = JSON.parse(line)
      if (row.kind === 'heartbeat') rows.push(row)
    } catch { /* 半截行：等下一轮 */ }
  }
  return rows
}

async function waitForPhase(home, phase, { timeoutMs = 5000 } = {}) {
  return waitFor(() => readHeartbeatEvents(home).some((row) => row.phase === phase), {
    timeoutMs, intervalMs: 10, what: `heartbeat 事件 ${phase}`,
  })
}

const SMALL = { enabled: true, orchestratorIntervalMs: 20, childPingAfterMs: 60 * MINUTE, escalateAfterPings: 3 }

test('端到端：go_work 成功后起表，到点用 followup 唤醒主编（摘要含该子代）', async () => {
  const { parent, injected, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '心跳唤醒投递' })
    const text = summaryOf(followed[0])
    assert.ok(text.includes('心跳维护回合 #1'), `首拍：#1 [${text}]`)
    assert.ok(text.includes('sess-1 hermes'), '在飞子代在摘要里（真 childId + 工种）')
    assert.equal(injected.length, 0, '心跳只走 followup；inject 是 notify 簇的非唤醒通道')
    await waitForPhase(home, 'start')
  } finally {
    unload()
  }
})

test('端到端：主编 running 时跳拍（零投递），转 idle 后照常唤醒', async () => {
  const { parent, followed, mock, home, unload } = startParent({ status: 'running' })
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await waitForPhase(home, 'skip-running')
    assert.equal(followed.length, 0, 'running 期间一次都不插队')
    parent.status = 'idle'
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '主编安静后的唤醒' })
  } finally {
    unload()
  }
})

test('端到端：子代完工（队列空）→ end 之后重估停表，不再产生唤醒', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '心跳唤醒投递' })
    mock.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '收工' }] })
    await waitForPhase(home, 'stop-end-reevaluate')
    const settled = followed.length
    await drain(80) // 负向窗口：20ms 一拍，若没停表这段时间必然多出好几拍
    assert.equal(followed.length, settled, '停表之后一拍都不再醒')
  } finally {
    unload()
  }
})

test('端到端：agent/disposed 撤掉该会话的拍子（stop-disposed）', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '心跳唤醒投递' })
    mock.dispatch('agent/disposed', { agent: { id: 'parent-1' } })
    await waitForPhase(home, 'stop-disposed')
    const settled = followed.length
    await drain(80)
    assert.equal(followed.length, settled, '会话销毁后不再唤醒一个不存在的会话')
  } finally {
    unload()
  }
})

test('端到端：keepAlive 走宿主配置桥——桥段开即起表、桥段关即停表（热更）', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  // 插件行 config 不带 keepAlive：开与不开完全由宿主 settings 段决定
  const restore = setHostBindings({ keepAlive: { ...SMALL, escalateAfterPings: 2 } })
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '经桥开启后的唤醒' })
    await waitForPhase(home, 'start')
    // 热更：把桥段关掉（等价 WebUI 取消勾选并保存）→ 下一拍停表
    setHostBindings({ keepAlive: { enabled: false } })
    await waitForPhase(home, 'stop-disabled')
    const settled = followed.length
    await drain(80)
    assert.equal(followed.length, settled, '热更关闭后不再唤醒')
  } finally {
    restore()
    unload()
  }
})

test('端到端：默认关——不开 keepAlive 时一个定时器都不起（既有行为零扰动）', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一条线' }, execOf(parent))
    await drain(60)
    assert.equal(followed.length, 0)
    assert.deepEqual(readHeartbeatEvents(home), [], '默认关：连事件都不记（零观测噪声）')
  } finally {
    unload()
  }
})

test('端到端：dispatch 失败（未知工种）不起表——只有真上岗才续缓存', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await assert.rejects(() => mock.tools.get('go_work').execute({ agent: 'nobody', prompt: 'x' }, execOf(parent)))
    await drain(60)
    assert.equal(followed.length, 0, '没有子代上岗就没有等待窗口')
    assert.deepEqual(readHeartbeatEvents(home), [], '派发失败路径不起表')
  } finally {
    unload()
  }
})

test('登记表：占位键换真身（dropHeartbeat）清掉 spawn 窗口里可能留下的孤儿表项', () => {
  const registry = createChildRegistry()
  // spawn resolve 前的那一拍可能按占位 id（work-*）补种一条表项
  registry.heartbeatOf('work-placeholder', 1000)
  assert.equal(registry.heartbeats.has('work-placeholder'), true)
  assert.equal(registry.dropHeartbeat('work-placeholder'), true, '换键后同点丢弃')
  assert.equal(registry.heartbeats.has('work-placeholder'), false)
  assert.equal(registry.dropHeartbeat('work-unknown'), false, '没这条也没关系（幂等空转）')
  // 端到端：真身 childId 的表项不受影响
  const rig = makeRig()
  const { childId } = occupy(rig)
  rig.childRegistry.dropHeartbeat('work-other')
  assert.equal(rig.childRegistry.heartbeats.has(childId), true, '真身的表项照旧在')
})

// ── （F1/F2/F3）：三处被打回的可达性缺口各一例 ──────────────────────

test('F1 端到端：continue 复活已完工子代后补起表——「派A→A交报告→continue(A,下一段长活)」不再整轮零心跳', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '第一段' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '首轮唤醒' })
    // A 完工（队列空）→ end 后的对账把拍子停掉
    mock.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '第一段收工' }] })
    await waitForPhase(home, 'stop-end-reevaluate')
    const startsBefore = readHeartbeatEvents(home).filter((row) => row.phase === 'start').length
    // 主编给同一个子代续下一段长活（复活面，不走派发面）
    const cont = await mock.tools.get('continue').execute({ id: 'sess-1', prompt: '接着做第二段' }, execOf(parent))
    assert.equal(cont.accepted, true, 'continue 复活投递成功')
    let reviveStarts = []
    await waitFor(() => {
      const starts = readHeartbeatEvents(home).filter((row) => row.phase === 'start')
      reviveStarts = starts.filter((row) => row.via === 'revive')
      return starts.length > startsBefore
    }, { timeoutMs: 5000, intervalMs: 10, what: 'revive 起表事件' })
    assert.equal(reviveStarts.length, 1, '起表事件标 via=revive（来源可追溯）——复活只点一枚拍子')
    await waitFor(() => followed.length > 1, { timeoutMs: 5000, intervalMs: 10, what: '复活后的唤醒' })
    assert.ok(summaryOf(followed.at(-1)).includes('sess-1'), '复活轮的摘要仍带着这个子代')
  } finally {
    unload()
  }
})

test('F1 端到端：forward 到 childId（continue 等效）同样补起表', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '主线' }, execOf(parent))
    // 子代上报求助（挂起占槽）→ 心跳照常跑
    const { helpRequestId } = await mock.tools.get('need_help').execute({ intent: 'execute', content: '代跑一条命令' }, {
      agent: { id: 'sess-1', session: { header: { parentSession: 'parent-1' } } },
      signal: new AbortController().signal,
    })
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '待决求助期的唤醒' })
    assert.ok(summaryOf(followed.at(-1)).includes('待决求助 1'), '求助单在摘要计数里')
    // 主编会话销毁 → 拍子停（借这条真实停表口制造「peaceful 之后 forward 必须自己点起来」的现场）
    mock.dispatch('agent/disposed', { agent: { id: 'parent-1' } })
    await waitForPhase(home, 'stop-disposed')
    const startsBefore = readHeartbeatEvents(home).filter((row) => row.phase === 'start').length
    // 转发求助单到原 childId：forward 的 continue 等效支
    const fw = await mock.tools.get('forward').execute({ from: helpRequestId, target: 'sess-1' }, execOf(parent))
    assert.equal(fw.kind, 'continue', 'forward 走 childId 支')
    let forwardStarts = []
    await waitFor(() => {
      const starts = readHeartbeatEvents(home).filter((row) => row.phase === 'start')
      forwardStarts = starts.filter((row) => row.via === 'revive')
      return starts.length > startsBefore
    }, { timeoutMs: 5000, intervalMs: 10, what: 'forward 起表事件' })
    assert.equal(forwardStarts.length, 1, 'forward 的 continue 等效支同样走 revive 起表')
  } finally {
    unload()
  }
})

test('F2 端到端：在飞中把桥段的 enabled 打开 → 下一次 broker 交互即补起表', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  // 桥段初始缺席（= 默认关）：派发那一刻起表被拒，在飞会话身上没有任何事件可挂
  try {
    const restore = setHostBindings({})
    try {
      await broker.apply(mock.ctx, { reportExternalization: false, metrics: true })
      await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '在飞的一条线' }, execOf(parent))
      await drain(60)
      assert.equal(followed.length, 0, '关闭态：零唤醒')
      assert.deepEqual(readHeartbeatEvents(home), [], '关闭态：零事件')
      // 热更：把开关打开（等价 WebUI 勾选 + 保存 → 宿主 volatile 提交 → 段版本推进）
      setHostBindings({ keepAlive: SMALL })
      // 下一次 broker 交互：主编再派一跳（dispatchWork 开头的名册解析走 getBindings
      // → 读到段版本推进 → 心跳全量对账）。主编会话**自己的** agent/request 瀑布在
      // bindSisyphus 关时会早退、不读段，故「主编动手干点什么」才是现实触发点。
      await mock.tools.get('go_work').execute({ agent: 'explore', prompt: '热更后的第二跳' }, execOf(parent))
      // metrics 走异步写链：对事件档的断言一律轮询（不赌墙钟）
      await waitFor(() => readHeartbeatEvents(home).some((row) => row.phase === 'start' && row.via === 'settings-revision'), {
        timeoutMs: 5000, intervalMs: 10, what: '段版本推进处的起表事件（via=settings-revision）',
      })
      await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '热更开启后的唤醒' })
      assert.ok(summaryOf(followed[0]).includes('sess-1'), '唤醒的摘要带着那条在飞线')
    } finally {
      restore()
    }
  } finally {
    unload()
  }
})

test('F3 端到端：报告补发投递成功即刷心跳信号——正在补交报告的子代不被误判 stale/标红', async () => {
  const { parent, followed, injected, mock, unload } = startParent()
  try {
    await broker.apply(mock.ctx, {
      reportExternalization: true,
      metrics: true,
      // childPingAfterMs 压到 30ms：不刷信号的话，补发中的子代下一拍就该被判 stale
      keepAlive: { enabled: true, orchestratorIntervalMs: 20, childPingAfterMs: 30, escalateAfterPings: 3 },
    })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '交报告的那条线' }, execOf(parent))
    // 先把信号放到 stale（证明这一拍确实会判 stale）——注意此时子代还活着
    await waitFor(() => followed.some((message) => summaryOf(message).includes('建议ping')), {
      timeoutMs: 5000, intervalMs: 10, what: '进入建议ping状态',
    })
    // 标记「补发时代」起点：必须在触发 end **之前**取，否则补发那一刷信号与随后的
    // 第一拍干净摘要都可能落在 mark 之后被切掉（通知是信号之后才发的，两者之间有拍子）
    const mark = followed.length
    // 子代完工但**没交报告** → 闸门走 report-gate-repair 补发链（不 finish，记录留槽）
    mock.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文（未提交报告）' }] })
    await waitFor(() => injected.some((message) => String(message.content?.[0]?.text).includes('报告补发已投递')), {
      timeoutMs: 5000, intervalMs: 10, what: '补发投递通知',
    })
    // 补发投递成功那一刷信号之后，必然出现一拍「ping0 且不建议ping」——没有 F3 的修复，
    // 未回应 ping 数只会一路涨（1,2,3…），这条永不成立
    await waitFor(() => followed.slice(mark).some((message) => {
      const text = summaryOf(message)
      return text.includes('sess-1') && text.includes('ping0') && !text.includes('建议ping')
    }), { timeoutMs: 5000, intervalMs: 10, what: '补发后信号已刷新（ping0 且不建议ping）' })
  } finally {
    unload()
  }
})

test('R-3：起表事件的 via 按调用点细分——continue(steer) 记 ping，queued 复活/forward 记 revive', async () => {
  const { parent, followed, mock, home, unload } = startParent({}, {
    childAgents: true,
    subagentsExtra: { sendMessage: async () => 'msg-steer' },
  })
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '在跑的一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '首拍唤醒' })
    // 真实停表口（会话销毁）→ 让后续 ensure 可观测
    mock.dispatch('agent/disposed', { agent: { id: 'parent-1' } })
    await waitForPhase(home, 'stop-disposed')
    // steer 档 = 主编照心跳摘要发的那一档（子代在跑，消息插在步边界）
    const steered = await mock.tools.get('continue').execute({ id: 'sess-1', prompt: '简报当前进度', urgency: 'steer' }, execOf(parent))
    assert.equal(steered.mode, 'steer', 'steer 档真走成了（活体在册 + running）')
    await waitFor(() => readHeartbeatEvents(home).some((row) => row.phase === 'start' && row.via === 'ping'), {
      timeoutMs: 5000, intervalMs: 10, what: 'via=ping 的起表事件',
    })
    assert.equal(readHeartbeatEvents(home).some((row) => row.phase === 'start' && row.via === 'revive'), false,
      'steer 档不被误标成 revive（观测口径不撒谎）')
  } finally {
    unload()
  }
})

// ── ③ 主编自助闸──────────────
// 冻结语义一句话：「暂停」= 撤掉**当下这一枚定时器**，不是一道闸——零新增状态、
// 真事件（子代完工 / 求助 / 信号）照来、下一次真实活动自动复活。七例按验收单
// 六条各就各位：①pause 幂等 ②跨会话隔离（模块级 + 工具面各证一遍）③pause 后
// end-reevaluate 自动复活 ④resume 幂等 ⑤status 只回本会话 ⑥disabled 自洽。

test('heartbeat(pause)：撤掉本会话拍子且幂等——第二发是零状态零事件的空转', () => {
  const rig = makeRig({ keepAlive: { orchestratorIntervalMs: 1000 } })
  occupy(rig)
  rig.ops.ensure('parent-1', 'dispatch')
  assert.equal(rig.ops.status('parent-1').running, true, '起表后在跑')
  assert.equal(rig.clock.pending(), 1)
  assert.equal(rig.ops.pause('parent-1'), true, '第一发真撤掉一枚拍子')
  assert.equal(rig.ops.status('parent-1').running, false, '表里没有定时器了')
  assert.equal(rig.clock.pending(), 0, '定时器真被 clear（不是只在语义层做标记）')
  assert.deepEqual(rig.ops.runningOwners(), [], 'runningOwners 也不再报这个会话')
  assert.equal(rig.ops.status('parent-1').tick, 0, '停表即清拍号（与 stop 同一枚口径）')
  const settled = rig.phases().length
  assert.equal(rig.ops.pause('parent-1'), false, '第二发幂等（本来就没在跑）')
  assert.equal(rig.phases().length, settled, '空转不记事件：观测面不许出现第二次停表')
  assert.deepEqual(rig.phases(), ['start', 'stop-paused'], '停表原因可辨（主编亲手停 ≠ 自动停）')
  rig.clock.advance(5000)
  assert.equal(rig.delivered.length, 0, '暂停就是真不叫醒：推五拍零投递')
  assert.equal(rig.clock.pending(), 0, '也没有自作主张重排')
})

test('heartbeat(pause)：会话 A 停表不碰会话 B 的 timer/ticks（键是属主编排会话 id）', () => {
  const rig = makeRig({ keepAlive: { orchestratorIntervalMs: 1000 }, extraParents: ['parent-2'] })
  occupy(rig, { childId: 'sess-1', parentId: 'parent-1' })
  occupy(rig, { childId: 'sess-2', parentId: 'parent-2' })
  rig.ops.ensure('parent-1', 'dispatch')
  rig.ops.ensure('parent-2', 'dispatch')
  assert.equal(rig.clock.pending(), 2, '两个会话各一枚拍子')
  // B 先走一拍（拍号 #1）：让「A 的 pause 有没有顺手清掉 B 的拍号」这一问可见
  rig.clock.advance(1000)
  const bDelivered = rig.extras.get('parent-2').delivered.length
  assert.equal(bDelivered, 1, 'B 照常被唤醒')
  assert.equal(rig.ops.status('parent-2').tick, 1)
  assert.equal(rig.ops.pause('parent-1'), true, 'A 停自己的表')
  assert.equal(rig.ops.status('parent-1').running, false)
  assert.equal(rig.ops.status('parent-2').running, true, 'B 的定时器一根毫毛都没动')
  assert.equal(rig.ops.status('parent-2').tick, 1, 'B 的拍号也不被 A 的操作清掉')
  assert.deepEqual(rig.ops.runningOwners(), ['parent-2'])
  const aDelivered = rig.delivered.length
  rig.clock.advance(3000)
  assert.equal(rig.delivered.length, aDelivered, 'A 的静默期零唤醒')
  assert.equal(rig.extras.get('parent-2').delivered.length, bDelivered + 3, 'B 照旧一拍不落')
  assert.ok(summaryOf(rig.extras.get('parent-2').delivered.at(-1)).includes('sess-2'), 'B 收到的摘要带的是自己的在飞线')
})

test('heartbeat(status)：纯查表快照（running/tick/生效配置），逐会话独立且零副作用', () => {
  const rig = makeRig({ keepAlive: { orchestratorIntervalMs: 1000, childPingAfterMs: 120000, escalateAfterPings: 2 }, extraParents: ['parent-2'] })
  occupy(rig, { parentId: 'parent-1' })
  const idle = rig.ops.status('parent-2')
  assert.deepEqual(idle.config, { enabled: true, orchestratorIntervalMs: 1000, childPingAfterMs: 120000, escalateAfterPings: 2 },
    'config 是生效配置快照（归一后的值，不是原始入参）')
  assert.equal(idle.running, false, '没起表的会话如实报 false')
  assert.equal(idle.tick, 0)
  const before = { pending: rig.clock.pending(), events: rig.phases().length, owners: rig.ops.runningOwners().length }
  rig.ops.status('parent-1')
  rig.ops.status('parent-2')
  rig.ops.status('parent-不存在')
  assert.equal(rig.clock.pending(), before.pending, 'status 不建表')
  assert.equal(rig.phases().length, before.events, 'status 不出事件')
  assert.equal(rig.ops.runningOwners().length, before.owners, 'status 不改任何表')
  rig.ops.ensure('parent-1', 'dispatch')
  rig.clock.advance(1000)
  assert.equal(rig.ops.status('parent-1').tick, 1, 'tick = 已经发出的维护回合数')
  assert.equal(rig.ops.status('parent-1').running, true, '拍完照常重排（表里还在）')
  assert.equal(rig.ops.status('parent-2').tick, 0, '另一个会话的拍号不受影响')
})

test('端到端：heartbeat(pause) 真撤本会话的表且不碰另一会话——A 静默、B 照常唤醒', async () => {
  const { parent, followed, extras, mock, home, unload } = startParent({}, { extraParents: ['parent-2'] })
  const other = extras.get('parent-2')
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: 'A 的主线' }, execOf(parent))
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: 'B 的主线' }, execOf(other.agent))
    await waitFor(() => followed.length > 0 && other.followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '两个会话各自的首拍' })
    const tool = mock.tools.get('heartbeat')
    assert.ok(tool, 'heartbeat 工具在册（主编自助闸）')
    const paused = await tool.execute({ action: 'pause' }, execOf(parent))
    assert.equal(paused.ok, true)
    assert.equal(paused.action, 'pause')
    assert.equal(paused.changed, true, '第一发真撤掉表')
    assert.equal(paused.running, false, '返回值即本会话状态')
    assert.ok(paused.text.includes('真事件不受影响'), 'pause 文案必须点明「真事件不受影响」')
    assert.ok(paused.text.includes('自动复活'), 'pause 文案必须点明「下次活动自动复活」')
    await waitForPhase(home, 'stop-paused')
    const aSettled = followed.length
    const bSettled = other.followed.length
    await drain(120) // 负向窗口：20ms 一拍，没停表这段时间必然多出好几拍
    assert.equal(followed.length, aSettled, 'A 的拍子真停了（工具返回后一拍都不再来）')
    assert.ok(other.followed.length > bSettled, 'B（同实例另一主编会话）照常被唤醒——心跳只动自己的 parentId')
  } finally {
    unload()
  }
})

test('端到端：pause 之后 end 后的对账自动复活拍子（在飞子代仍在时）——pause 不是闸', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '写线' }, execOf(parent))
    await mock.tools.get('go_work').execute({ agent: 'explore', prompt: '读线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '首拍唤醒' })
    const paused = await mock.tools.get('heartbeat').execute({ action: 'pause' }, execOf(parent))
    assert.equal(paused.changed, true, '停掉当下这枚拍子')
    await waitForPhase(home, 'stop-paused')
    const mark = followed.length
    // 一个子代完工、另一个仍在飞：end 后的 syncAll 看到「有在飞 + 配置开 + 属主在册」→ 补起表
    mock.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '写线收工' }] })
    await waitFor(() => readHeartbeatEvents(home).some((row) => row.phase === 'start' && row.via === 'end-reevaluate'), {
      timeoutMs: 5000, intervalMs: 10, what: 'end-reevaluate 起表事件',
    })
    const st = await mock.tools.get('heartbeat').execute({ action: 'status' }, execOf(parent))
    assert.equal(st.running, true, 'status 看见拍子回来了（无需人手动 resume）')
    await waitFor(() => followed.slice(mark).some((message) => summaryOf(message).includes('心跳维护回合 #1')), {
      timeoutMs: 5000, intervalMs: 10, what: '复活那一拍从 #1 数',
    })
    assert.ok(summaryOf(followed.slice(mark).find((message) => summaryOf(message).includes('心跳维护回合 #1'))).includes('sess-2'),
      '复活后的摘要带着仍在飞的那条线')
  } finally {
    unload()
  }
})

test('端到端：heartbeat(resume) 幂等起表——连着两发只起一枚，拍号从 #1 数', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '主线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '首拍唤醒' })
    const tool = mock.tools.get('heartbeat')
    assert.equal((await tool.execute({ action: 'pause' }, execOf(parent))).changed, true, '先停')
    const mark = followed.length
    const resumed = await tool.execute({ action: 'resume' }, execOf(parent))
    assert.equal(resumed.ok, true)
    assert.equal(resumed.changed, true, '第一发真起表')
    assert.equal(resumed.running, true)
    await waitFor(() => followed.slice(mark).some((message) => summaryOf(message).includes('心跳维护回合 #1')), {
      timeoutMs: 5000, intervalMs: 10, what: '恢复后的第一拍（拍号从 #1 数）',
    })
    const second = await tool.execute({ action: 'resume' }, execOf(parent))
    assert.equal(second.changed, false, '第二发幂等（已有拍子不重排）')
    assert.equal(second.running, true, '连调两发之后照旧只有一枚拍子在跑')
    await drain(80)
    assert.equal(readHeartbeatEvents(home).filter((row) => row.phase === 'start' && row.via === 'manual').length, 1,
      'via=manual 的起表事件只有一条（幂等不是嘴上说说）')
    assert.ok(followed.length > mark, '恢复后照常续拍')
  } finally {
    unload()
  }
})

test('端到端：heartbeat(status) 只回本会话快照——不带 id 参数面，也不给别的会话读数', async () => {
  const { parent, followed, extras, mock, unload } = startParent({}, { extraParents: ['parent-2'] })
  const other = extras.get('parent-2')
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    const tool = mock.tools.get('heartbeat')
    const before = await tool.execute({ action: 'status' }, execOf(parent))
    assert.equal(before.running, false, '还没有在飞子代 → 没拍子')
    assert.equal(before.tick, 0)
    assert.ok(before.text.includes('running=false'))
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: 'A 的线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: 'A 的首拍' })
    const mine = await tool.execute({ action: 'status' }, execOf(parent))
    assert.equal(mine.running, true, '自己会话在跑')
    assert.ok(mine.tick >= 1, 'tick 是已发出的维护回合数')
    assert.ok(mine.text.includes('running=true'))
    assert.ok(mine.text.includes('enabled=true'), 'status 附带生效配置快照')
    const theirs = await tool.execute({ action: 'status' }, execOf(other.agent))
    assert.equal(theirs.running, false, 'status 只读调用者自己的 parentId（无 id 参数面）')
    assert.equal(theirs.tick, 0, '另一会话的拍号不被 A 的在跑状态污染')
    assert.ok(theirs.text.includes('parent-2'), '回执点明是哪个会话的快照')
  } finally {
    unload()
  }
})

test('heartbeat：配置 disabled 时 pause/resume 自洽（不炸、语义不越配置开关）', async () => {
  // 模块级：关闭态三档全空转，且连事件都不记（与既有「默认关零扰动」同口径）
  const rig = makeRig({ keepAlive: { enabled: false } })
  occupy(rig)
  assert.equal(rig.ops.resume('parent-1'), false, '关闭态 resume 不起表（它不是绕过配置的后门）')
  assert.equal(rig.ops.pause('parent-1'), false, '没有拍子可停：幂等空转')
  assert.equal(rig.clock.pending(), 0)
  assert.deepEqual(rig.phases(), [], '关闭态零事件')
  assert.equal(rig.ops.status('parent-1').config.enabled, false, 'status 如实回报配置快照')
  assert.equal(rig.ops.status('parent-1').running, false)
  // 端到端：工具面同样不炸，文案把「配置挡着」说清楚
  const { parent, followed, mock, home, unload } = startParent()
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true, keepAlive: { ...SMALL, enabled: false } })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '默认关的一条线' }, execOf(parent))
    const tool = mock.tools.get('heartbeat')
    const paused = await tool.execute({ action: 'pause' }, execOf(parent))
    assert.equal(paused.ok, true, '关闭态 pause 不炸')
    assert.equal(paused.changed, false)
    const resumed = await tool.execute({ action: 'resume' }, execOf(parent))
    assert.equal(resumed.ok, true, '关闭态 resume 不炸')
    assert.equal(resumed.changed, false, '配置关：起不来')
    assert.equal(resumed.running, false)
    assert.ok(resumed.text.includes('enabled=false'), '文案点明是配置开关挡着，不是故障')
    const st = await tool.execute({ action: 'status' }, execOf(parent))
    assert.equal(st.running, false)
    assert.equal(st.tick, 0)
    await drain(80)
    assert.equal(followed.length, 0, '关闭态零唤醒')
    assert.deepEqual(readHeartbeatEvents(home), [], '关闭态零心跳事件——工具的 pause/resume 也不伪造留痕')
  } finally {
    unload()
  }
})

test('端到端：pause 之后配置段推进（主编零派工，只读一眼状态）也把拍子复活——pause 最长活到下一个真事件', async () => {
  const { parent, followed, mock, home, unload } = startParent()
  const restore = setHostBindings({ keepAlive: SMALL })
  try {
    await broker.apply(mock.ctx, { reportExternalization: false, metrics: true })
    await mock.tools.get('go_work').execute({ agent: 'hermes', prompt: '在飞的一条线' }, execOf(parent))
    await waitFor(() => followed.length > 0, { timeoutMs: 5000, intervalMs: 10, what: '首拍唤醒' })
    assert.equal((await mock.tools.get('heartbeat').execute({ action: 'pause' }, execOf(parent))).changed, true, '先停')
    await waitForPhase(home, 'stop-paused')
    const mark = followed.length
    // 段版本推进（等价 WebUI 改一个旋钮并保存 → 宿主 volatile 提交）：主编只读一眼
    // 状态、零派工，段读点上的 syncAll 也把「有在飞且开启」的会话重新点着——这正是
    // 「pause 不是闸」的第二条复活路径（第三条是 end 后的对账，见上一例）。
    setHostBindings({ keepAlive: { ...SMALL, escalateAfterPings: 2 } })
    await mock.tools.get('orchestration_status').execute({}, execOf(parent))
    await waitFor(() => readHeartbeatEvents(home).some((row) => row.phase === 'start' && row.via === 'settings-revision'), {
      timeoutMs: 5000, intervalMs: 10, what: 'via=settings-revision 的复活起表',
    })
    assert.equal((await mock.tools.get('heartbeat').execute({ action: 'status' }, execOf(parent))).running, true, 'status 看见拍子回来了')
    await waitFor(() => followed.length > mark, { timeoutMs: 5000, intervalMs: 10, what: '复活后的唤醒' })
  } finally {
    restore()
    unload()
  }
})

test('heartbeat(status)：没拍子的注脚按配置开关分叉——配置关着不许许诺「自动复活」', async () => {
  // （status 档文案）：旧文案无条件说「下一次活动会自动复活」，而配置
  // enabled=false 时任何 ensure 都起不来表——那句话是 pause 的语义，被误安在了
  // 「配置关」这个局面上，读者照它等一个永远不会来的拍子。
  const tool = (booted) => booted.mock.tools.get('heartbeat')
  // ① 关闭态：未起表 + 不许出现「自动复活」的许诺
  const off = startParent()
  try {
    await broker.apply(off.mock.ctx, { reportExternalization: false, metrics: true, keepAlive: { ...SMALL, enabled: false } })
    const closed = await tool(off).execute({ action: 'status' }, execOf(off.parent))
    assert.equal(closed.running, false)
    assert.ok(closed.text.includes('enabled=false'), '生效配置如实回报')
    assert.equal(closed.text.includes('下一次活动会自动复活'), false, '配置关着不许许诺自动复活')
    assert.ok(closed.text.includes('先开配置') || closed.text.includes('要先开配置'), '改说「配置挡着」并给出出路')
  } finally {
    off.unload()
  }
  // ② 开启态但当下无拍子（没有在飞子代）：pause 语义照旧（真事件会来、下次活动复活）
  const on = startParent()
  try {
    await broker.apply(on.mock.ctx, { reportExternalization: false, metrics: true, keepAlive: SMALL })
    const idle = await tool(on).execute({ action: 'status' }, execOf(on.parent))
    assert.equal(idle.running, false, '还没有在飞子代 → 没有拍子')
    assert.ok(idle.text.includes('下一次活动会自动复活'), '开启态的注脚保持 pause 的语义')
    assert.equal(idle.text.includes('配置挡着'), false)
  } finally {
    on.unload()
  }
})
