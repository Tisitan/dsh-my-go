// dsh-my-go — report_submit 行为档（提交制 0.5.0-tisitan.1，替身 ctx 端到端）。
//
// 验收面：四字段 schema pin（全 required，身份绝不经参数面）/ 正常写板 /
// 字段校验不过逐条报错且不落板不登记 / evidence ["无"] 与空数组归一化合法 /
// 主会话调用抛错 / 开关关工具不在册 / D14 观测（board-write 行，谓词轮询零固定
// sleep）/ 成功事实登记（reportSubmitted，供终局合成回执消费）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { encodeSegment } from '../preset/shared/archive.mjs'
import { createMockCtx, execOf, drain, removeHomeWithRetry, snapOf, waitFor } from './helpers/mock-ctx.mjs'

// 子代理最小形状：parentSession 在 header（isSubAgent 的判据）
const childAgent = (id = 'child-rs-1', parent = 'parent-rs') => ({
  id,
  session: { header: { parentSession: parent } },
})
const orchestratorAgent = (id = 'parent-rs') => ({ id, session: { header: {} } })
const argsOf = (over = {}) => ({
  report: '# 完整报告\n实施细节与证据全文。\n',
  conclusion: '做完了关键的事，结果是好的。',
  evidence: ['preset/tools/broker.mjs:87'],
  open: '无',
  ...over,
})

// metrics 事件轮询（写链异步串行，谓词取断言真正要读的观测量）
async function readEventsWhen(file, ready, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const rows = readFileSync(file, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
      if (ready(rows)) return rows
    } catch { /* 写链尚未落盘 */ }
    if (Date.now() > deadline) throw new Error(`metrics 事件未落盘（${timeoutMs}ms 超时）: ${file}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function applyBroker(config = {}) {
  const { ctx, tools } = createMockCtx({})
  const home = process.env.DSH_HOME
  await broker.apply(ctx, config)
  return { tools, home, eventsFile: join(home, 'dsh-my-go', 'metrics', 'events.jsonl'), boardPathOf: (childId) => join(home, 'dsh-my-go', 'board', encodeSegment('parent-rs'), `${encodeSegment(childId)}.md`) }
}

test('默认开：report_submit 在册，四字段全 required，isConcurrencySafe，无旧机制字样', async () => {
  const { tools } = await applyBroker({})
  const tool = tools.get('report_submit')
  assert.ok(tool, 'D5 一期默认开 → 工具在册')
  assert.deepEqual(tool.parameters.required, ['report', 'conclusion', 'evidence', 'open'], '四字段全必填')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['report', 'conclusion', 'evidence', 'open'], 'childId/sessionId 不得出现在参数面（防伪造他人板）')
  assert.equal(tool.parameters.properties.evidence.type, 'array', 'evidence 是字符串数组')
  assert.equal(tool.parameters.properties.evidence.items.type, 'string')
  assert.equal(tool.isConcurrencySafe(), true, '与六件套同例')
  assert.ok(!JSON.stringify(tool).includes('mygo_report'), '工具描述 = 四字段用法，旧机制字样零出现')
})

test('正常写板：report 原文落盘、返回 {ok,path,bytes}、路径按双段编码焊在 board 根内', async () => {
  const { tools, home } = await applyBroker({})
  const args = argsOf()
  const result = await tools.get('report_submit').execute(args, execOf(childAgent()))
  assert.equal(result.ok, true)
  assert.equal(result.bytes, Buffer.byteLength(args.report, 'utf-8'))
  const expected = join(home, 'dsh-my-go', 'board', encodeSegment('parent-rs'), `${encodeSegment('child-rs-1')}.md`)
  assert.equal(result.path, expected, 'sessionId/childId 由 exec.agent 推导（parentSession/agent.id）')
  assert.equal(readFileSync(expected, 'utf-8'), args.report, '落板内容 = report 原文')
})

test('字段校验不过：逐条报错（含 evidence 索引）、不落板、不登记、不产生 board-write 行', async () => {
  const { tools, eventsFile, boardPathOf } = await applyBroker({})
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf({ conclusion: '', open: '' }), execOf(childAgent())),
    (error) => {
      const text = String(error.message)
      return text.includes('字段校验未通过') && text.includes('conclusion:') && text.includes('open:')
    },
    '错误逐条点名字段（原地修正重调）',
  )
  const indexed = argsOf({ evidence: ['好锚点 a.ts:1', '坏锚点无行号'] })
  await assert.rejects(
    () => tools.get('report_submit').execute(indexed, execOf(childAgent())),
    /evidence\[1\]/,
    'evidence 非法项带数组索引',
  )
  assert.equal(existsSync(boardPathOf('child-rs-1')), false, '校验不过不落板')
  // 负向窗口：写链静默期过后也不允许出现 board-write 行（本用例零成功提交）
  await drain(30)
  if (existsSync(eventsFile)) {
    const rows = readFileSync(eventsFile, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
    assert.equal(rows.some((r) => r.kind === 'board-write'), false, '失败的提交不产生观测行')
  }
})

test('evidence ["无"] 与空数组均合法：落板成功（归一化在校验器，登记值即归一后形态）', async () => {
  const { tools } = await applyBroker({})
  for (const evidence of [['无'], []]) {
    const result = await tools.get('report_submit').execute(argsOf({ evidence }), execOf(childAgent('child-rs-wu')))
    assert.equal(result.ok, true)
  }
})

test('成功事实登记：submit 后 gate 直通——completed end 的台账 conclusion = 合成概要', async () => {
  const parent = { id: 'parent-rs', session: { header: {} } }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-rs' ? parent : undefined) },
    startContinuable: async () => ({ childId: 'child-rs-1' }),
  })
  try {
    await broker.apply(ctx, {})
    await tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf(parent))
    await tools.get('report_submit').execute(argsOf(), execOf(childAgent()))
    dispatch('subagent/end', { id: 'child-rs-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '收尾' }] })
    await waitFor(() => snapOf('parent-rs')?.history?.length === 1, { what: '提交后终局直通' })
    const conclusion = snapOf('parent-rs').history[0].conclusion
    assert.ok(conclusion.includes('做完了关键的事，结果是好的。'), '回执内芯 = conclusion 全文')
    assert.ok(conclusion.includes('- preset/tools/broker.mjs:87'), 'evidence 逐行')
    assert.ok(conclusion.includes('遗留: 无'), 'open 在册')
    assert.ok(conclusion.includes('report_fetch childId=child-rs-1'), '取阅指针在册')
  } finally {
    await removeHomeWithRetry(process.env.DSH_HOME)
  }
})

test('主会话调用抛错（orchestrator 不提交报告）', async () => {
  const { tools } = await applyBroker({})
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf(), execOf(orchestratorAgent())),
    /only available to sub-agents/,
  )
})

test('身份推导防御：无 exec.agent 抛错；parentSession 非字符串抛结构化错误', async () => {
  const { tools } = await applyBroker({})
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf(), execOf(undefined)),
    /requires a calling agent/,
  )
  const malformed = { id: 'child-rs-2', session: { header: { parentSession: 123 } } }
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf(), execOf(malformed)),
    /missing or malformed/,
    'isSubAgent 只查 != null，非字符串 parentSession 在类型闸被拦',
  )
})

test('施工层小节闸（agentType 走登记表反查）：hephaestus 子代缺节即拒收不落板，补齐后放行', async () => {
  const parent = { id: 'parent-rs', session: { header: {} } }
  const { ctx, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-rs' ? parent : undefined) },
    startContinuable: async () => ({ childId: 'child-hp' }),
  })
  const home = process.env.DSH_HOME
  try {
    await broker.apply(ctx, {})
    await tools.get('go_work').execute({ agent: 'hephaestus', prompt: '改 broker' }, execOf(parent))
    const exec = execOf(childAgent('child-hp'))
    const boardPath = join(home, 'dsh-my-go', 'board', encodeSegment('parent-rs'), 'child-hp.md')
    await assert.rejects(
      () => tools.get('report_submit').execute(argsOf(), exec),
      (error) => {
        const text = String(error.message)
        return text.includes('缺少「偏差记录」小节') && text.includes('缺少「未验项」小节') && !text.includes('conclusion:')
      },
      '缺哪节报哪节（其余字段不误伤）',
    )
    assert.equal(existsSync(boardPath), false, '小节闸不过不落板、不登记')
    const fixed = argsOf({ report: '# 完整报告\n偏差记录：无\n未验项：无\n' })
    assert.equal((await tools.get('report_submit').execute(fixed, exec)).ok, true, '两节齐（值为「无」）放行')
    assert.equal(readFileSync(boardPath, 'utf-8'), fixed.report)
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('工种反查两腿：注册表缺席靠 label 兜底认工种；两条腿都查不到 → 不强制', async () => {
  const { tools } = await applyBroker({})
  const labeled = (type) => ({ id: 'child-cold', session: { header: { parentSession: 'parent-rs', label: `dsh-my-go:${type}: 施工` } } })
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf(), execOf(labeled('hephaestus'))),
    /缺少「偏差记录」小节/,
    'cold-resume 后活登记为空，label 兜底仍认得出施工层',
  )
  assert.equal((await tools.get('report_submit').execute(argsOf(), execOf(labeled('oracle')))).ok, true, '非施工层不强制')
  assert.equal((await tools.get('report_submit').execute(argsOf(), execOf(childAgent('child-plain')))).ok, true, '注册表 + label 双缺（自定义角色）→ 放行')
})

test('开关关（config.reportExternalization=false）：工具不在册', async () => {
  const { tools } = await applyBroker({ reportExternalization: false })
  assert.equal(tools.get('report_submit'), undefined, '开关关 → 工具不注册（挂载期读一次）')
  assert.ok(tools.get('go_work'), '六件套不受该开关影响')
})

test('D14 观测：成功写板落 board-write 行（bytes + 溯源字段），失败不落', async () => {
  const { tools, eventsFile } = await applyBroker({})
  await tools.get('report_submit').execute(argsOf({ report: '观测内容' }), execOf(childAgent()))
  const rows = await readEventsWhen(eventsFile, (list) => list.some((r) => r.kind === 'board-write'))
  const row = rows.find((r) => r.kind === 'board-write')
  assert.equal(row.bytes, Buffer.byteLength('观测内容', 'utf-8'))
  assert.equal(row.sessionId, 'parent-rs')
  assert.equal(row.childId, 'child-rs-1')
  const before = rows.length
  await assert.rejects(
    () => tools.get('report_submit').execute(argsOf(), execOf(orchestratorAgent())),
    undefined,
  )
  assert.equal(readFileSync(eventsFile, 'utf-8').split('\n').filter((l) => l !== '').length, before, '失败的提交不产生观测行（写板没发生）')
})
