// 防旁路加固批（R1/R2/R3）回归：上游邻接消息三件套（send_message /
// list_agents / interrupt_agent）必须在 MyGO 会话的两侧都从工具目录摘除——
// Sisyphus 顶层直调它们绕过台账与单线锁（并对已结束 child 触发 coldResume
// 后把结论丢进 broker 的 late/duplicate 分支 → 双流并发），子代理直调它们
// 绕过 need_help 挂账体系直插父代回合，直调 interrupt_agent 则没有
// abortExpected 护航（预期掐断被误判真失败）。
// 覆盖：① 常量与 broker 源码 pin（防回潮）；② agent/created 双侧实际下发
// 的 deny 清单；③ restrict 批级抛错时逐名兜底，不连坐其余屏蔽项。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx } from './helpers/mock-ctx.mjs'
import { ADJACENT_BYPASS_TOOLS, AGENT_TEAMS_TOOLS } from '../preset/shared/constants.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-bypass-home-'))

const BYPASS = ['send_message', 'list_agents', 'interrupt_agent']

test('pin：ADJACENT_BYPASS_TOOLS 恒为上游邻接消息三件套（名字改了就红）', () => {
  assert.deepEqual([...ADJACENT_BYPASS_TOOLS].sort(), [...BYPASS].sort())
})

// C-10 P6 退役：原先此处钉「broker 源码 ...ADJACENT_BYPASS_TOOLS 出现 2 次 /
// denyTools( 出现 3 次」——纯调用点计数，helper 内联或多一处合法调用就假红；
// 而「两侧都真的落下这三件套」由下方 agent/created 两例行为档逐名断言（比数
// 出现次数强得多：它验证的是 restrict 实际收到的清单）。

test('pin：三档投递全部经 subagents 门面，不复活「直取注册表 steer」旁路', async () => {
  // 5.2 拆分波：M1-M5 投递链本体迁入 ./broker-delivery.mjs，本 pin 随之覆盖
  // 「broker.mjs + 投递簇模块」两半之积——负向不变量对两个文件各自成立（旁路
  // 写在哪都算回潮），正向通路在册按合并源核（通路只此一份实现）。
  const [brokerSrc, deliverySrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-delivery.mjs', import.meta.url), 'utf-8'),
  ])
  for (const [name, src] of [['broker.mjs', brokerSrc], ['broker-delivery.mjs', deliverySrc]]) {
    assert.doesNotMatch(src, /childAgent\.steer\(/, `终审 U1：不得绕过门面直调 Agent.steer（${name}）`)
    assert.doesNotMatch(src, /mygo-steer-/, `不得自造 steer messageId（真实 inbox id 才是账；${name}）`)
  }
  // 投递点数量不是不变量（合并两档共用体会让计数变小而语义不变），只钉通路在册
  const union = brokerSrc + deliverySrc
  assert.ok(union.split('deliverToAdjacent(').length - 1 >= 1, '邻接投递走共享门面通路在册（投递链簇）')
  assert.ok(deliverySrc.split('deliverToAdjacent(').length - 1 >= 2, 'steer 与 queued 两档都在簇内同一条通路上（>=2 = 两条路都经门面）')
})

// 最小 ctx mock：只喂 broker.apply 走通到 agent/created 监听器注册所需的表面
// （服务解析全 undefined、subagents 空壳、捕获 tools.restrict 下发清单）。
// keepHome：本文件由模块级 DSH_HOME 统一隔离，逐例不换台账目录。
function mockCtx() {
  return createMockCtx({ keepHome: true, captureRestrict: true })
}

const parentAgent = { id: 'parent-A', session: { header: {} } }
const childAgentOf = (restrict) => ({
  id: 'sess-1',
  session: { header: { parentSession: 'parent-A' } },
  ctx: { tools: { restrict } },
})

test('agent/created：子代理侧 deny 含派生工具 + 邻接三件套；开关关时条件注册三件不入名单', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  // 双开关全关（reportExternalization: false + relayChains 缺省 false）：与当前
  // 部署同形——report_fetch/chain_start/chain_resolve 均未注册，deny 名单不得
  // 再含它们（否则真宿主 restrict 对未知名批级拒绝 + 逐名兜底的查无此具噪音，
  // tisitan.1 noise fix）。基础名单（无条件注册的派生/编排工具）与邻接三件套
  // 照旧全量 deny。
  await broker.apply(ctx, { reportExternalization: false })
  dispatch('agent/created', { agent: childAgentOf((filter) => denied.push(...filter.deny)) })
  for (const name of ['subagent', 'subagent_fork', 'workflow', 'ralph', 'go_work', 'continue', 'forward', ...BYPASS]) {
    assert.ok(denied.includes(name), `子代理 deny 缺少 ${name}`)
  }
  for (const name of ['report_fetch', 'chain_start', 'chain_resolve']) {
    assert.ok(!denied.includes(name), `开关关（工具未注册）时不得 deny ${name}（查无此具噪音源）`)
  }
  assert.ok(!denied.includes('need_help'), 'need_help 必须保留（子代唯一上报通道）')
  assert.ok(!denied.includes('orchestration_status') && !denied.includes('list_subagents'), '只读观测工具保留')
  assert.ok(!denied.includes('report_submit'), 'report_submit 必须保留（子代面向的上报通道，1.3）')
})

// 条件注册三件的 deny 随开关联动（tisitan.1 noise fix 的另一半）：开关开 =
// 工具在册 = 星型闸必须照常摘除（canOrchestrate 运行时守卫之外的目录层双保险）。
test('agent/created：REPORT_EXT 开 → report_fetch 入子代理 deny；RELAY_CHAINS 开 → 链两件入 deny', async () => {
  const a = mockCtx()
  const deniedA = []
  await broker.apply(a.ctx, {}) // REPORT_EXT 缺省开；relayChains 缺省关
  a.dispatch('agent/created', { agent: childAgentOf((filter) => deniedA.push(...filter.deny)) })
  assert.ok(deniedA.includes('report_fetch'), 'REPORT_EXT 开 = report_fetch 在册，deny 必须生效')
  assert.ok(!deniedA.includes('chain_start') && !deniedA.includes('chain_resolve'), 'relayChains 缺省关 = 链两件不入 deny')

  const b = mockCtx()
  const deniedB = []
  await broker.apply(b.ctx, { relayChains: true })
  b.dispatch('agent/created', { agent: childAgentOf((filter) => deniedB.push(...filter.deny)) })
  assert.ok(deniedB.includes('chain_start') && deniedB.includes('chain_resolve'), 'RELAY_CHAINS 开 = 链两件在册，deny 必须生效')
  assert.ok(deniedB.includes('report_fetch'), '两个开关彼此独立：链开关不影响 report_fetch 的 deny')
})

test('agent/created：Sisyphus 侧 deny 掉 skill 与邻接三件套（R1/R3 顶层收口）', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  await broker.apply(ctx, { reportExternalization: false })
  dispatch('agent/created', { agent: { id: 'parent-A', session: { header: {} }, ctx: { tools: { restrict: (f) => denied.push(...f.deny) } } } })
  assert.ok(denied.includes('skill'), 'skill 屏蔽（catalog 注入守门）不回潮')
  for (const name of BYPASS) assert.ok(denied.includes(name), `Sisyphus deny 缺少 ${name}`)
  for (const name of ['go_work', 'continue', 'forward', 'orchestration_status', 'list_subagents']) {
    assert.ok(!denied.includes(name), `编排六件套不得被自家闸摘除：${name}`)
  }
  assert.ok(!denied.includes('report_fetch'), 'report_fetch 不得被主编闸摘除（主编面向的读板通道，1.6）')
})

// ── Agent Teams 实验面（0.5.0-tisitan.2） ──────────────────────────────────
// spawn_teammate / wait_agent / team_task_* 让叶子自拉队友、自建任务板——与邻接
// 三件套同属旁路面，但处置口径**刻意不对称**：只摘子代理侧，主会话留着玩（主人
// 拍板：Agent Teams 是主编排会话的实验玩法，收口只到叶子派生，与 subagent /
// subagent_fork / workflow / ralph 同款）。名单另随宿主在册状态联动——这三件由
// 宿主注册（当前 0.1.5-alpha.1 实况：未注册），硬 deny 未知名只会换来 restrict
// 批级拒绝 + 逐名兜底的查无此具噪音。
const TEAMS = ['spawn_teammate', 'wait_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update']

test('pin：AGENT_TEAMS_TOOLS 恒为 Agent Teams 六件套（名字改了就红）', () => {
  assert.deepEqual([...AGENT_TEAMS_TOOLS].sort(), [...TEAMS].sort())
})

const teamsRegistry = () => ({ schemas: () => TEAMS.map((name) => ({ name })) })

test('agent/created：Agent Teams 六件套只摘子代理侧；宿主未注册时不入名单（主会话恒保留）', async () => {
  // ① 宿主已注册（Agent Teams 实验开）→ 子代理侧六件套全量入名单
  const live = createMockCtx({ keepHome: true, captureRestrict: true, toolsRegistry: teamsRegistry() })
  const deniedLive = []
  await broker.apply(live.ctx, { reportExternalization: false })
  live.dispatch('agent/created', { agent: childAgentOf((filter) => deniedLive.push(...filter.deny)) })
  for (const name of TEAMS) assert.ok(deniedLive.includes(name), `宿主在册时子代理 deny 缺少 ${name}`)

  // ② 宿主未注册（当前部署实况）→ 不入名单，杜绝查无此具噪音
  const absent = mockCtx()
  const deniedAbsent = []
  await broker.apply(absent.ctx, { reportExternalization: false })
  absent.dispatch('agent/created', { agent: childAgentOf((filter) => deniedAbsent.push(...filter.deny)) })
  for (const name of TEAMS) assert.ok(!deniedAbsent.includes(name), `宿主未注册时不得 deny ${name}（批级拒绝 + 逐名兜底噪音源）`)

  // ③ 主会话侧（orchestrator scope）即使宿主在册也恒不摘
  const parentSide = createMockCtx({ keepHome: true, captureRestrict: true, toolsRegistry: teamsRegistry() })
  const deniedParent = []
  await broker.apply(parentSide.ctx, { reportExternalization: false })
  parentSide.dispatch('agent/created', {
    agent: { id: 'parent-at', session: { header: {} }, ctx: { tools: { restrict: (f) => deniedParent.push(...f.deny) } } },
  })
  for (const name of TEAMS) assert.ok(!deniedParent.includes(name), `主会话不得被摘除 ${name}（Agent Teams 主场）`)
  assert.ok(deniedParent.includes('skill'), '主会话既有屏蔽面不回潮')
})

test('restrict 批级抛错（某部署缺一个工具行）→ 逐名兜底，其余屏蔽项不连坐', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  const warns = []
  const origWarn = console.warn
  console.warn = (...a) => warns.push(a.join(' '))
  try {
    await broker.apply(ctx, { reportExternalization: false })
    // 第一批整体拒绝（模拟 restrict 对 unknown global tool 的抛错），逐名时
    // 只让 list_agents 失败：星型闸必须仍然落下其余名字
    let first = true
    const restrict = (filter) => {
      if (first) { first = false; throw new Error('tools.restrict() names unknown global tool "subagent"') }
      if (filter.deny.length !== 1) throw new Error('per-name expected')
      if (filter.deny[0] === 'list_agents') throw new Error('unknown global tool "list_agents"')
      denied.push(filter.deny[0])
    }
    dispatch('agent/created', { agent: childAgentOf(restrict) })
  } finally {
    console.warn = origWarn
  }
  assert.ok(denied.includes('send_message') && denied.includes('interrupt_agent'), '邻接三件套里可解析的名字照常落地')
  assert.ok(!denied.includes('list_agents'), '确实解析不了的名字被跳过')
  assert.ok(denied.length >= 8, `逐名兜底后仍应保住绝大多数屏蔽项，实际 ${denied.length}`)
  assert.ok(warns.some((w) => /applying per name/.test(w)), '批级失败有留痕')
  assert.ok(warns.some((w) => /list_agents/.test(w)), '单名失败有留痕')
})

test('agent/created 对无 agent 的载荷与 restrict 全崩场景均不炸挂载', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const origWarn = console.warn
  console.warn = () => {}
  try {
    await broker.apply(ctx, { reportExternalization: false })
    assert.doesNotThrow(() => dispatch('agent/created', {}))
    assert.doesNotThrow(() => dispatch('agent/created', { agent: { id: 'x', session: { header: {} } } }))
    assert.doesNotThrow(() => dispatch('agent/created', {
      agent: childAgentOf(() => { throw new Error('ctx not ready') }),
    }))
  } finally {
    console.warn = origWarn
  }
})

// N12（0.3.0-tisitan.7）：闸体自身抛错（agent.ctx 尚未 ready、宿主内部异常）此前落进
// 一个纯静默的 catch。本闸是星型拓扑与邻接三件套的 agent 作用域防线（原
// tool-mask standing 层已拆除迁移至 dsh-tool-guard，本闸是唯一防线，见
// README「容错」），失守必须可见——不炸挂载，但一行 warn 点名是哪个 agent。
test('agent/created 闸体抛错：不炸挂载且 console.warn 留痕，每 agent 恰一行（N12）', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const warns = []
  const origWarn = console.warn
  console.warn = (...a) => { warns.push(a.map(String).join(' ')) }
  try {
    await broker.apply(ctx, { reportExternalization: false })
    const exploding = {
      id: 'sess-boom',
      session: { header: { parentSession: 'parent-A' } },
      get ctx() { throw new Error('agent.ctx not ready') },
    }
    assert.doesNotThrow(() => dispatch('agent/created', { agent: exploding }))
    const traced = warns.filter((w) => w.includes('agent/created gate threw'))
    assert.equal(traced.length, 1, '抛错路径留痕恰一次')
    assert.ok(traced[0].includes('sess-boom'), '留痕点名是哪个 agent')
    assert.ok(traced[0].includes('agent.ctx not ready'), '留痕携带原错')
    assert.ok(traced[0].includes('deny may be incomplete'), '留痕说清后果（防线未落全）')
  } finally {
    console.warn = origWarn
  }
})
