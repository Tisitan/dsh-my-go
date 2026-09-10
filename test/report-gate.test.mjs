// dsh-my-go — 报告提交制闸门行为档（0.5.0-tisitan.1，替身 ctx 端到端）。
//
// 验收六路径 + 双发残余窗口（已知边界）：
//   ① 已提交直通：回执 conclusion = 合成概要、板上是 report 原文、metrics pass
//   ② 未提交首次：queued 补发（固定措辞点名四字段）、不落史占槽、metrics repair
//   ③ 补交轮提交成功 → 直通（guard 随终局翻篇——再次未提交可再次补发，防授权永挂）
//   ④ 补发后仍未提交转裁决（「未交付：」前缀落账、终局通知、无二次补发——防死循环主线）
//   ⑤ failed 直通（无链 error 现路径、无落板、无 report-gate 行）
//   ⑥ 双发残余窗口：end#1′ 在补发链 tick 前到达 → 走转裁决落账（结论按未交付
//      落账，不比现状差——主人批准的已知边界）。
//   ⑦ need_help 挂起回合（E8 静默出口，本批修复）：挂起前那一轮仍以 completed
//      上报 end，闸门对它不适用——零补发、不落史、记录留 waiting、求助单在册。
//   ⑧ 复活轮未重交（改点1 主修）：同 childId 终局后 continue 复活，提交登记跨
//      终局保留 → 复活轮不重交也判已交付，零补发、照常落账（历史现场 09-07 7f6c44fa）。
//   ⑨ 板兜底（改点2）：内存登记缺席但报告板有货 → pass-board-fallback 直通，
//      phase 与常规 pass 分开记，零补发。
//
// 等待纪律（9-2）：正向等待全部谓词轮询断言真正消费的观测量（history / queued
// 捕获 / board 文件 / metrics 行），零固定 sleep。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { encodeSegment } from '../preset/shared/archive.mjs'
import { writeBoard } from '../preset/shared/board.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, currentOf, waitFor, drain, removeHomeWithRetry } from './helpers/mock-ctx.mjs'

const QUEUE_PROMPT = Symbol.for('dsh.subagent.queuePrompt')

// report_submit 的最小真实调用面：身份只认 exec.agent（childId + parentSession）
const childExecOf = (childId) => ({ agent: { id: childId, session: { header: { parentSession: 'parent-g' } } }, signal: new AbortController().signal })
const submitArgs = (over = {}) => ({
  report: '# 完整报告\n实施细节与证据全文。\n',
  conclusion: '结论摘要',
  evidence: ['src/a.js:12'],
  open: '无',
  ...over,
})
const submitReport = (g, childId, over) => g.tools.get('report_submit').execute(submitArgs(over), childExecOf(childId))
const summaryOf = (childId, over = {}) => [
  over.conclusion ?? '结论摘要',
  '证据:',
  ...(over.evidence ?? ['src/a.js:12']).map((e) => `- ${e}`),
  `遗留: ${over.open ?? '无'}`,
  `全文落板，report_fetch childId=${childId} 切片取阅`,
].join('\n')

// 每用例一套独立捕获：queued = 补发投递、injected = 主编通知、specs = spawn 请求
function gateCtx({ bindings } = {}) {
  const queued = []
  const injected = []
  const specs = []
  const parent = { id: 'parent-g', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-g' ? parent : undefined) },
    bindings,
    subagentsExtra: {
      sendMessage: async () => ({}),
      [QUEUE_PROMPT]: async (_from, targetId, content) => {
        queued.push({ targetId, text: content?.[0]?.text ?? '' })
        return { ok: true }
      },
    },
    startContinuable: withRealSignalContract(async (spec) => {
      specs.push(spec)
      return { childId: `sess-${specs.length}` }
    }),
  })
  const home = process.env.DSH_HOME
  const eventsFile = join(home, 'dsh-my-go', 'metrics', 'events.jsonl')
  const boardPathOf = (childId) => join(home, 'dsh-my-go', 'board', encodeSegment('parent-g'), `${encodeSegment(childId)}.md`)
  return { ctx, dispatch, tools, queued, injected, home, eventsFile, boardPathOf }
}

async function readMetricsWhen(file, ready, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const rows = readFileSync(file, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
      if (ready(rows)) return rows
    } catch { /* 写链尚未落盘 */ }
    if (Date.now() > deadline) throw new Error(`metrics 未落盘（${timeoutMs}ms 超时）: ${file}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('①已提交直通：conclusion = 合成概要、板上是 report 原文、metrics pass 行', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '合格任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    await submitReport(g, 'sess-1')
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '自由收尾一句话' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '已交付落账' })
    assert.equal(snapOf('parent-g').history[0].conclusion, summaryOf('sess-1'), '台账 conclusion = 合成回执内芯')
    await waitFor(() => existsSync(g.boardPathOf('sess-1')), { what: 'report 全文在板' })
    assert.equal(readFileSync(g.boardPathOf('sess-1'), 'utf-8'), submitArgs().report, '落板内容 = report 原文')
    const rows = await readMetricsWhen(g.eventsFile, (list) => list.some((r) => r.kind === 'report-gate' && r.phase === 'pass'))
    assert.ok(rows.some((r) => r.kind === 'report-gate' && r.phase === 'pass' && r.childId === 'sess-1'))
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('②未提交首次：queued 补发一次、prompt 点名四字段、不落史占槽、metrics repair', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '忘了交报告的任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '只写了正文没交报告' }] })
    await waitFor(() => g.queued.length === 1, { what: 'queued 补发已投递' })
    assert.equal(g.queued[0].targetId, 'sess-1')
    assert.ok(g.queued[0].text.includes('未调用 report_submit 提交报告，视为未交付'), '补发 prompt 点名未交付')
    assert.ok(g.queued[0].text.includes('四字段'), '补发 prompt 指路四字段')
    assert.ok(g.queued[0].text.includes('report_submit'), '补发 prompt 指路上报通道')
    assert.equal(snapOf('parent-g')?.history?.length ?? 0, 0, '不 finish：未交付中间态不落史（一份工作一条终史）')
    assert.equal(currentOf('parent-g')?.childId, 'sess-1', '记录留在 currentMap 实体占槽（advance=no）')
    assert.ok(g.injected.some((m) => m.content?.[0]?.text?.includes('报告未提交')), '主编收到同步预告')
    await readMetricsWhen(g.eventsFile, (rows) => rows.some((r) => r.kind === 'report-gate' && r.phase === 'repair'))
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('③补交轮提交成功 → 直通；guard 随终局翻篇——再次未提交可再次补发（防授权永挂）', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文一' }] })
    await waitFor(() => g.queued.length === 1, { what: '第一次补发投递' })
    await submitReport(g, 'sess-1', { conclusion: '补交结论' })
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文二' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '补交轮直通落账' })
    assert.equal(snapOf('parent-g').history[0].conclusion, summaryOf('sess-1', { conclusion: '补交结论' }))
    assert.equal(g.queued.length, 1)
    // 授权已随终局 retireChild 翻篇：再来一次未提交 → 应能再次获得补发
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '任务二' }, execOf({ id: 'parent-g', session: { header: {} } }))
    g.dispatch('subagent/end', { id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文三' }] })
    await waitFor(() => g.queued.length === 2, { what: '授权已翻篇：第二次未提交再次补发' })
    await readMetricsWhen(g.eventsFile, (rows) => rows.some((r) => r.kind === 'report-gate' && r.phase === 'pass'))
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('④补发后仍未提交转裁决：「未交付：」前缀落账、终局通知、无二次补发（防死循环主线）', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '顽固任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文就是不交' }] })
    await waitFor(() => g.queued.length === 1, { what: '首次补发投递' })
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文就是不交' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '转裁决落账' })
    const conclusion = snapOf('parent-g').history[0].conclusion
    assert.ok(conclusion.startsWith('未交付：'), '转裁决前缀')
    assert.ok(conclusion.includes('正文就是不交'), '最后消息全文随结论落账')
    assert.equal(currentOf('parent-g'), null, '终局腾槽并推进（advance=now）')
    assert.equal(g.queued.length, 1, '无二次补发（repairRetried 存续到转裁决——防死循环主线）')
    assert.ok(g.injected.some((m) => m.content?.[0]?.text?.includes('报告闸门终局')), '主编收到终局裁决通知')
    await readMetricsWhen(g.eventsFile, (rows) => rows.some((r) => r.kind === 'report-gate' && r.phase === 'verdict'))
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('⑤failed 直通：无链 error 现路径落账，无落板、无补发、无 report-gate 行', async () => {
  const g = gateCtx({ bindings: { explore: { provider: 'p0', model: 'm0' } } })
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '失败任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [{ type: 'text', text: '半成品' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '失败落账' })
    assert.ok(!snapOf('parent-g').history[0].conclusion.startsWith('未交付：'), '失败结论不过闸（沿用今日原则）')
    // 负向窗口：end 事件已在 metrics 落定后，闸门行/补发/落板都不应存在
    await readMetricsWhen(g.eventsFile, (rows) => rows.some((r) => r.kind === 'end'), { timeoutMs: 3000 })
    const rows = readFileSync(g.eventsFile, 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
    assert.equal(rows.some((r) => r.kind === 'report-gate'), false, 'failed 零 report-gate 行')
    assert.equal(g.queued.length, 0, 'failed 零补发')
    assert.equal(existsSync(g.boardPathOf('sess-1')), false, 'failed 不落板')
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('⑥双发残余窗口（已知边界）：end#1′ 在补发链 tick 前到达 → 转裁决落账，不比现状差', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '双发任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    // 同一同步块内连发两次相同 end：第二发时 guard 已在同步段落地 → 走转裁决
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文双发' }] })
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '正文双发' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length >= 1, { what: '双发下结论按未交付落账（已知边界后果上限）' })
    assert.ok(snapOf('parent-g').history[0].conclusion.startsWith('未交付：'), '双发窗口后果 = 结论按未交付落账（不比现状差）')
    // 投递受理发生在 attemptReportRepair 的同步段（async 函数执行到首个 await），
    // 晚到的转裁决拦不住它——这一次投递最终无效，正是「已知边界」的代价本体。
    assert.equal(g.queued.length, 1, '补发投递已受理（同步段），后续按无效补发消化')
    // 若子代真被唤醒补交：终局已落账 → E1 late-duplicate 忽略，不产生双份终局
    await submitReport(g, 'sess-1')
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '补交正文' }] })
    await waitFor(() => existsSync(g.boardPathOf('sess-1')), { what: '补交落板在册' })
    assert.equal(snapOf('parent-g').history.length, 1, '补交轮结论不重复落账（E1 兜底，终局唯一）')
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

// ── ⑦ E8 桥接回归（need_help 挂起回合被闸门误判修复批）────────────────────────
// 真桥接形态（不起纯函数替身）：go_work → 子代 need_help 挂起 → 挂起前那一轮以
// completed 上报 end。闸门对这条 end 不适用：既不 queued 补发（那会把挂起中的子代
// coldResume 唤醒，求助单还挂在册上），也不落史、不腾槽。

test('⑦need_help 挂起回合：end(completed) 走静默出口——零补发、记录留 waiting、求助单在册', async () => {
  const g = gateCtx()
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '挂起任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    const childExec = { agent: { id: 'sess-1', session: { header: { parentSession: 'parent-g' } } }, signal: new AbortController().signal }
    const help = await g.tools.get('need_help').execute({ intent: 'read_doc', content: '查个文档' }, childExec)
    assert.equal(currentOf('parent-g')?.status, 'waiting', 'need_help 即挂起（台账转 waiting）')
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '挂起前那句收尾' }] })
    // 正向等待：静默出口的留痕行（证明这条 end 真被处置过，而非没到）
    await waitFor(() => warnings.some((l) => l.includes('suspended turn settling')), { what: 'E8 静默出口留痕' })
    await drain(30) // 负向窗口：给任何补发投递的异步落地机会，仍为 0 才算真零补发
    assert.equal(g.queued.length, 0, '零 queued 补发：挂起轮不是完工，闸门不得把挂起子代唤醒')
    assert.equal(snapOf('parent-g')?.history?.length ?? 0, 0, '不落史：中场哨不是终局')
    const rec = currentOf('parent-g')
    assert.equal(rec?.status, 'waiting', '记录原位留 waiting，等主编 forward/continue')
    assert.equal(rec?.childId, 'sess-1', '槽位仍由挂起子代占着（advance=no，队列不推进）')
    assert.equal(snapOf('parent-g').helpRequests.length, 1, '求助单仍可见')
    assert.equal(snapOf('parent-g').helpRequests[0].id, help.helpRequestId)
    assert.equal(g.injected.some((m) => m.content?.[0]?.text?.includes('报告未提交')), false, '不发「报告未提交」假完工预告')
    assert.equal(warnings.some((l) => l.includes('report-gate')), false, '闸门埋点不参与挂起轮')
  } finally {
    console.warn = origWarn
    await removeHomeWithRetry(g.home)
  }
})

// ── ⑧⑨ 复活轮误判修复批（改点1 跨终局保留 + 改点2 报告板兜底）────────────────
// 病灶现场（2026-09-07 7f6c44fa）：儿童交过报告 → 终局落账 → 主编 continue/forward
// 复活它 → 复活轮只写收尾不再重交 → 闸门读到的是「一张被终局清空的表」，于是判定
// 「从未提交」并发射补发。两道防线：登记表跨终局保留（主修）+ 板上有货即放行（兜底）。

test('⑧复活轮未重交：continue 复活同 childId，不重交报告也判已交付——零补发、照常落账（改点1）', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '一轮任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    await submitReport(g, 'sess-1')
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '一轮收尾' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '一轮交付落账' })
    // 复活：continue 命中已完工记录 → revive + rearmChild（修复前 rearm 不回灌登记表）
    const revived = await g.tools.get('continue').execute({ id: 'sess-1', prompt: '驳回：补一段说明' }, execOf({ id: 'parent-g', session: { header: {} } }))
    assert.equal(revived.accepted, true, '复活投递受理')
    await waitFor(() => currentOf('parent-g')?.childId === 'sess-1', { what: '复活记录回槽占位' })
    assert.equal(snapOf('parent-g').history.length, 0, '记录已搬回活槽（历史轮次那条不重复在册）')
    const queuedAfterRevive = g.queued.length
    // 复活轮**不重交**报告，只照常收尾
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '复活轮收尾一句话' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '复活轮直通落账' })
    await drain(30) // 负向窗口：给任何补发投递的异步落地机会，仍不动才算真零补发
    assert.equal(g.queued.length, queuedAfterRevive, '零补发：复活轮不重交也视为已交付')
    assert.equal(g.injected.some((m) => m.content?.[0]?.text?.includes('报告未提交')), false, '主编不再收到假「报告未提交」预告')
    assert.equal(snapOf('parent-g').history[0].conclusion, summaryOf('sess-1'), '回执内芯 = 同一份登记值合成（登记表未丢）')
    const rows = await readMetricsWhen(g.eventsFile, (list) => list.filter((r) => r.kind === 'report-gate' && r.phase === 'pass').length === 2)
    assert.equal(rows.some((r) => r.kind === 'report-gate' && r.phase === 'repair'), false, '两枚 pass，零 repair')
  } finally {
    await removeHomeWithRetry(g.home)
  }
})

test('⑨板兜底：登记表缺席（重启/冷恢复形态）而板上有货 → pass-board-fallback 直通、零补发（改点2）', async () => {
  const g = gateCtx()
  try {
    await broker.apply(g.ctx, {})
    await g.tools.get('go_work').execute({ agent: 'explore', prompt: '跨重启任务' }, execOf({ id: 'parent-g', session: { header: {} } }))
    // 板上直接落货（绕过 report_submit 的登记侧）＝换一次进程后的形状：报告文件是
    // 持久的，childRegistry 的成功提交登记是进程内的，重启后必然为空。
    await writeBoard('parent-g', 'sess-1', '# 板上原文\n上一世代提交过的完整报告。\n')
    g.dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '复活轮收尾' }] })
    await waitFor(() => snapOf('parent-g')?.history?.length === 1, { what: '板兜底直通落账' })
    await drain(30)
    assert.equal(g.queued.length, 0, '零补发：板上有货就不再骚扰')
    const conclusion = snapOf('parent-g').history[0].conclusion
    assert.ok(conclusion.includes('(报告已在板，成功登记表缺席)'), '回执点名登记值缺席（不是空字段，也不谎称读过提交值）')
    assert.ok(conclusion.includes('证据: 无') && conclusion.includes('遗留: 无'), '兜底四字段走同款合成拼装')
    assert.ok(conclusion.includes('report_fetch childId=sess-1'), '取阅指针照常在')
    const rows = await readMetricsWhen(g.eventsFile, (list) => list.some((r) => r.kind === 'report-gate' && r.phase === 'pass-board-fallback'))
    assert.ok(rows.some((r) => r.kind === 'report-gate' && r.phase === 'pass-board-fallback' && r.childId === 'sess-1'), '观测口径与常规 pass 分开')
    assert.equal(rows.some((r) => r.kind === 'report-gate' && (r.phase === 'pass' || r.phase === 'repair')), false, '既不记 pass 也不记 repair')
  } finally {
    await removeHomeWithRetry(g.home)
  }
})
