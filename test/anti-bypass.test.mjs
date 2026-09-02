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
import { ADJACENT_BYPASS_TOOLS } from '../preset/shared/constants.mjs'

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
  const src = await readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(src, /childAgent\.steer\(/, '终审 U1：不得绕过门面直调 Agent.steer')
  assert.doesNotMatch(src, /mygo-steer-/, '不得自造 steer messageId（真实 inbox id 才是账）')
  // 投递点数量不是不变量（合并两档共用体会让计数变小而语义不变），只钉通路在册
  assert.ok(src.split('deliverToAdjacent(').length - 1 >= 1, '邻接投递走共享门面通路在册')
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

test('agent/created：子代理侧 deny 含原生派生工具 + 邻接三件套（星型闸双保险）', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  await broker.apply(ctx, {})
  dispatch('agent/created', { agent: childAgentOf((filter) => denied.push(...filter.deny)) })
  for (const name of ['subagent', 'subagent_fork', 'workflow', 'ralph', 'go_work', 'continue', 'forward', ...BYPASS]) {
    assert.ok(denied.includes(name), `子代理 deny 缺少 ${name}`)
  }
  assert.ok(!denied.includes('need_help'), 'need_help 必须保留（子代唯一上报通道）')
  assert.ok(!denied.includes('orchestration_status') && !denied.includes('list_subagents'), '只读观测工具保留')
})

test('agent/created：Sisyphus 侧 deny 掉 skill 与邻接三件套（R1/R3 顶层收口）', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  await broker.apply(ctx, {})
  dispatch('agent/created', { agent: { id: 'parent-A', session: { header: {} }, ctx: { tools: { restrict: (f) => denied.push(...f.deny) } } } })
  assert.ok(denied.includes('skill'), 'skill 屏蔽（catalog 注入守门）不回潮')
  for (const name of BYPASS) assert.ok(denied.includes(name), `Sisyphus deny 缺少 ${name}`)
  for (const name of ['go_work', 'continue', 'forward', 'orchestration_status', 'list_subagents']) {
    assert.ok(!denied.includes(name), `编排六件套不得被自家闸摘除：${name}`)
  }
})

test('restrict 批级抛错（某部署缺一个工具行）→ 逐名兜底，其余屏蔽项不连坐', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const denied = []
  const warns = []
  const origWarn = console.warn
  console.warn = (...a) => warns.push(a.join(' '))
  try {
    await broker.apply(ctx, {})
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
    await broker.apply(ctx, {})
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
// 一个纯静默的 catch。本闸是星型拓扑与邻接三件套的 agent 作用域防线（tool-mask
// 那条 standing 层兜底的前提在 web 部署下不成立，见 README「容错」），失守必须
// 可见——不炸挂载，但一行 warn 点名是哪个 agent。
test('agent/created 闸体抛错：不炸挂载且 console.warn 留痕，每 agent 恰一行（N12）', async () => {
  const { ctx, listeners, dispatch } = mockCtx()
  const warns = []
  const origWarn = console.warn
  console.warn = (...a) => { warns.push(a.map(String).join(' ')) }
  try {
    await broker.apply(ctx, {})
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
