// 挂起停摆可观测性（本批）：need_help 挂起的子代占着槽位、队列不推进（E8
// suspended-help-hold 的 advance='no'），流水线就此停摆而主编毫无回声。两个触发点
// 各补一行非唤醒通知（T1 挂起瞬间 / T2 停摆期 go_work 入队），共享「每次 episode
// 只报一次」守卫。断言面在 broker 集成层（要的是 end dispatcher 与入队路径真跑通），
// 归因决策本身的零通知口径由 end-attribution.test.mjs 锁着，本文件不重复。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, currentOf } from './helpers/mock-ctx.mjs'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-stall-home-'))

function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-stall-home-', ...options })
}

const stallNoticesOf = (injected) => injected.filter((m) => m.content?.[0]?.text?.includes('流水线停摆'))

// 子代侧 need_help 的执行上下文（parentSession 指回属主）
const helpExecOf = (childId) => ({
  agent: { id: childId, session: { header: { parentSession: 'parent-1' } } },
  signal: new AbortController().signal,
})

test('T1 挂起瞬间 + 队列有货 → 停摆通知恰一次且字段齐全；挂起本身（队列空）不响', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (m) => injected.push(m) }
  let spawnCalls = 0
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: { reportFrom: async () => 'delivered', followup: async () => 'msg-1' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'first' }, execOf(parent))
  // 先压一条队列任务：此刻槽主还在 running，不构成停摆（T2 不得误报）
  const queued = await tools.get('go_work').execute({ agent: 'explore', prompt: 'second' }, execOf(parent))
  assert.equal(queued.status, 'queued')
  assert.equal(stallNoticesOf(injected).length, 0, '槽主在跑时入队不是停摆')
  // 子代上报 need_help → 挂起占槽；此刻还没有 end，也不该有第二回声
  const longAsk = '请代跑 pwsh ' + 'A'.repeat(300)
  const { helpRequestId } = await tools.get('need_help').execute({ intent: 'execute', content: longAsk }, helpExecOf('sess-1'))
  assert.equal(currentOf('parent-1')?.status, 'waiting')
  assert.equal(stallNoticesOf(injected).length, 0, '挂起本身不报：本批只报「有积压的停摆」')
  // E8：挂起那一轮的 completed end 落到静默出口 → T1 在此补报
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '中场哨' }] })
  const notices = stallNoticesOf(injected)
  assert.equal(notices.length, 1, '停摆通知恰一次')
  const text = notices[0].content[0].text
  assert.ok(text.includes('sess-1') && text.includes('(hermes)'), `childId 与工种齐备: ${text}`)
  assert.ok(text.includes(helpRequestId), '求助单 id 在场')
  assert.ok(text.includes('execute'), '求助单 intent 在场')
  assert.ok(text.includes('请代跑 pwsh'), '求助单正文在场')
  assert.ok(text.includes('A'.repeat(200)) && !text.includes('A'.repeat(241)), '正文按 helpContentMax=240 截断（不越界也不截过头）')
  assert.ok(/队列压着 1 个/.test(text), `排队任务数 N 在场: ${text}`)
  assert.ok(text.includes('forward/continue 处置求助单后流水线自动恢复'), '处置指引原句在场')
  // 非唤醒 inject 通路（队列上岗通知同款形状）
  assert.equal(notices[0].role, 'user')
  assert.equal(notices[0].source?.kind, 'plugin')
  assert.equal(notices[0].source?.form, 'notice')
  // E8 原口径零退化：不落史、不腾槽，且守卫标记已落
  const snap = snapOf('parent-1')
  assert.equal(snap.history.length, 0, '挂起轮不是完工，不落史')
  assert.equal(snap.currentRecords[0].status, 'waiting', '记录留在 waiting 原位')
  assert.equal(snap.currentRecords[0].stallNotified, true, '本 episode 已报标记落位')
})

test('T1b 挂起瞬间队列空 → 零通知（主编手里已有那张求助单，不再重复打扰）', async () => {
  const injected = []
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const parent = { id: 'parent-1', session: { header: {} }, inject: (m) => injected.push(m) }
    const { ctx, dispatch, tools } = mockCtxFull({
      agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
      startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
      subagentsExtra: { reportFrom: async () => 'delivered' },
    })
    await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
    await tools.get('go_work').execute({ agent: 'hermes', prompt: 'only' }, execOf(parent))
    await tools.get('need_help').execute({ intent: 'explore', content: '帮我读个文件' }, helpExecOf('sess-1'))
    dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '收尾一句' }] })
    assert.ok(warnings.some((l) => l.includes('suspended turn settling')), '仍走 E8 静默出口并留痕')
    assert.equal(stallNoticesOf(injected).length, 0, '零通知')
    assert.equal(snapOf('parent-1').currentRecords[0].stallNotified, undefined, '没报过就不打标（标记只随真实通报落位）')
    assert.equal(currentOf('parent-1')?.status, 'waiting')
  } finally {
    console.warn = origWarn
  }
})

test('T2 停摆期入队 → 通知恰一次；同 episode 再入队与后到 E8 都零重复', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (m) => injected.push(m) }
  let spawnCalls = 0
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: { reportFrom: async () => 'delivered' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'first' }, execOf(parent))
  await tools.get('need_help').execute({ intent: 'ask_user', content: '这题选 A 还是 B' }, helpExecOf('sess-1'))
  assert.equal(stallNoticesOf(injected).length, 0, '挂起时队列为空，T1/T2 都不响')
  // 停摆中派工：入队即撞 T2
  await tools.get('go_work').execute({ agent: 'explore', prompt: 'second' }, execOf(parent))
  const notices = stallNoticesOf(injected)
  assert.equal(notices.length, 1, 'T2 报一次')
  assert.ok(notices[0].content[0].text.includes('sess-1'), '报的是挡住本任务的槽主')
  assert.ok(/队列压着 1 个/.test(notices[0].content[0].text), 'N 取入队后的实时值')
  assert.ok(notices[0].content[0].text.includes('这题选 A 还是 B'), '求助单内容可达')
  // 同 episode 再派工：不重复
  await tools.get('go_work').execute({ agent: 'librarian', prompt: 'third' }, execOf(parent))
  assert.equal(stallNoticesOf(injected).length, 1, '同 episode 第二次入队零重复')
  assert.equal(snapOf('parent-1').queue.length, 2, '入队本身照常（守卫只压通知，不改派发）')
  // 同 episode 内 T1 后到：谁先触发谁报，另一处静默
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '中场哨' }] })
  assert.equal(stallNoticesOf(injected).length, 1, 'T2 已报 → T1 不再报')
})

test('continue 处置求助单复籍 → 再次挂起是新 episode → 可再报', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (m) => injected.push(m) }
  const { ctx, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
    subagentsExtra: { reportFrom: async () => 'delivered', followup: async () => 'msg-c1' },
  })
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'first' }, execOf(parent))
  await tools.get('go_work').execute({ agent: 'explore', prompt: 'second' }, execOf(parent))
  // episode #1：挂起 + E8 → 报一次
  await tools.get('need_help').execute({ intent: 'execute', content: '代跑第一步命令' }, helpExecOf('sess-1'))
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '哨一' }] })
  assert.equal(stallNoticesOf(injected).length, 1)
  assert.equal(snapOf('parent-1').currentRecords[0].stallNotified, true)
  // 主编 continue 处置：求助单销账、记录复籍 running、标记同点清除
  const cont = await tools.get('continue').execute({ id: 'sess-1', prompt: '按这个答案继续' }, execOf(parent))
  assert.equal(cont.accepted, true)
  const resumed = snapOf('parent-1').currentRecords[0]
  assert.equal(resumed.status, 'running', '复籍')
  assert.equal(resumed.stallNotified, undefined, 'episode 标记随复籍清除')
  assert.equal(snapOf('parent-1').helpRequests.length, 0, '名下求助单已销')
  assert.equal(stallNoticesOf(injected).length, 1, '复籍本身不产生新通知')
  // episode #2：再次挂起 + 再次 E8 → 可再报
  await tools.get('need_help').execute({ intent: 'execute', content: '代跑第二步命令' }, helpExecOf('sess-1'))
  assert.equal(snapOf('parent-1').currentRecords[0].stallNotified, undefined, '再次挂起即新 episode，标记已复位')
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '哨二' }] })
  const notices = stallNoticesOf(injected)
  assert.equal(notices.length, 2, '新 episode 再报一次')
  assert.ok(notices[1].content[0].text.includes('代跑第二步命令'), '第二次的文案指向本轮那张求助单')
})

test('forward 到工种（记录留 waiting）→ 销单后停摆照报且文案如实降级；T2 只报同泳道的堵点', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (m) => injected.push(m) }
  let spawnCalls = 0
  const { ctx, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: `sess-${++spawnCalls}` })),
    subagentsExtra: { reportFrom: async () => 'delivered' },
  })
  // 读池 2：写 lane 的挂起不挡读 lane 的转派，本用例要的正是「单子销了、人还挂着」
  await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5, readPoolSize: 2 })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'first' }, execOf(parent))
  const { helpRequestId } = await tools.get('need_help').execute({ intent: 'read_doc', content: '借个文档' }, helpExecOf('sess-1'))
  // forward 到工种：转派真上岗（读 lane 空位），销单，但挂起的那位**不**复籍
  //（AGENTS.md 明载），写 lane 照旧被占着
  const fw = await tools.get('forward').execute({ from: helpRequestId, target: 'explore' }, execOf(parent))
  assert.equal(fw.kind, 'go_work')
  assert.equal(stallNoticesOf(injected).length, 0, '读 lane 派发不是停摆，不该响')
  assert.equal(snapOf('parent-1').helpRequests.length, 0)
  const waiting = snapOf('parent-1').currentRecords.filter((r) => r.status === 'waiting')
  assert.equal(waiting.length, 1, 'hermes 仍挂起占槽')
  // 停摆中的写 lane 派工 → T2 报，且报的是同泳道那位挂起者
  const q = await tools.get('go_work').execute({ agent: 'oracle', prompt: 'third' }, execOf(parent))
  assert.equal(q.status, 'queued')
  const notices = stallNoticesOf(injected)
  assert.equal(notices.length, 1, '停摆通报恰一次')
  assert.equal(notices[0].content[0].text.includes(helpRequestId), false, '那张单已被 forward 销账，不再引用')
  assert.ok(notices[0].content[0].text.includes('名下已无在册单据'), '无在册单据时如实降级')
  assert.ok(notices[0].content[0].text.includes(waiting[0].childId), '报的是那位仍占槽的挂起子代')
  // 读 lane 排队（另一条泳道满）不因写 lane 的挂起而误报：本例读 lane 有 explore 在跑，
  // 再派两条读任务才会排队——此刻队列里只有那条 oracle，读任务照常直发。
  const rq = await tools.get('go_work').execute({ agent: 'librarian', prompt: 'fourth' }, execOf(parent))
  assert.equal(rq.status, 'running', '读 lane 有空位 → 直发，不是停摆')
  assert.equal(stallNoticesOf(injected).length, 1, '跨泳道不误报，通知数不变')
})
