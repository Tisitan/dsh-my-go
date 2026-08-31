// Unit tests for the Orchestration state machine (single-line-blocking core).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Orchestration, pruneLedgerParents } from '../preset/tools/broker.mjs'

test('beginSpawning occupies the single slot (isBusy)', () => {
  const o = new Orchestration()
  assert.equal(o.isBusy(), false)
  const rec = o.beginSpawning('hermes', 'task')
  assert.equal(o.isBusy(), true)
  assert.equal(rec.status, 'spawning')
  assert.equal(o.snapshot().current.childId, rec.childId)
})

test('bindChild promotes placeholder to running with real childId', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  const bound = o.bindChild(rec.childId, 'sess-1')
  assert.equal(bound.status, 'running')
  assert.equal(o.snapshot().current.childId, 'sess-1')
  assert.equal(o.currentMap.has(rec.childId), false)
})

test('finish moves record to history and frees the slot', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  const done = o.finish('sess-1', 'conclusion text')
  assert.equal(done.status, 'done')
  assert.equal(o.isBusy(), false)
  assert.equal(o.history.length, 1)
  assert.equal(o.history[0].conclusion, 'conclusion text')
})

test('finish clears pending helpRequests for that child (no zombie help)', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'replan', content: 'x' })
  assert.equal(o.helpRequests.size, 1)
  o.finish('sess-1', 'done')
  assert.equal(o.helpRequests.size, 0)
})

test('clearHelpFor returns the removed count; finish exposes clearedHelp on the returned copy only (tisitan.3)', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'replan', content: 'x' })
  o.suspend('sess-1', { id: 'help-2', childId: 'sess-1', intent: 'execute', content: 'y' })
  assert.equal(o.helpRequests.size, 2)
  const done = o.finish('sess-1', 'done')
  assert.equal(done.clearedHelp, 2, '返回副本附带连带清理计数，供调用点做可见通知')
  assert.ok(!('clearedHelp' in o.history[0]), 'history/台账记录不携带该瞬态字段')
  assert.equal(o.helpRequests.size, 0)
  // 无求助单时保持旧返回形状（零变化）
  const rec2 = o.beginSpawning('hermes', 'task2')
  o.bindChild(rec2.childId, 'sess-2')
  const done2 = o.finish('sess-2', 'done2')
  assert.ok(!('clearedHelp' in done2))
})

test('suspend marks waiting; resume flips back to running', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'execute', content: 'cmd' })
  assert.equal(o.snapshot().current.status, 'waiting')
  o.resolveHelp('help-1')
  o.resume('sess-1')
  assert.equal(o.snapshot().current.status, 'running')
  assert.equal(o.helpRequests.size, 0)
})

test('revive moves a finished record from history back into currentMap', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hephaestus', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.finish('sess-1', 'conclusion')
  assert.equal(o.isBusy(), false)
  const revived = o.revive('sess-1')
  assert.equal(revived.status, 'running')
  assert.equal(o.isBusy(), true)
  assert.equal(o.history.length, 0)
  assert.equal(o.snapshot().current.childId, 'sess-1')
})

test('revive is a no-op for unknown ids', () => {
  const o = new Orchestration()
  assert.equal(o.revive('nope'), undefined)
})

test('requeueHead puts work back at the front of the queue', () => {
  const o = new Orchestration()
  const w1 = { id: 'work-1', agentType: 'hermes', prompt: 'a' }
  const w2 = { id: 'work-2', agentType: 'explore', prompt: 'b' }
  o.queue.push(w2)
  o.requeueHead(w1)
  assert.equal(o.dequeue().id, 'work-1')
  assert.equal(o.dequeue().id, 'work-2')
})

test('history is capped at 200 entries', () => {
  const o = new Orchestration()
  for (let i = 0; i < 210; i++) {
    const rec = o.beginSpawning('hermes', `task-${i}`)
    o.bindChild(rec.childId, `sess-${i}`)
    o.finish(`sess-${i}`, `c-${i}`)
  }
  assert.equal(o.history.length, 200)
  assert.equal(o.history.at(-1).conclusion, 'c-209')
  assert.equal(o.history[0].conclusion, 'c-10')
})

test('record() finds both running and finished children', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  assert.equal(o.record('sess-1').status, 'running')
  o.finish('sess-1', 'done')
  assert.equal(o.record('sess-1').status, 'done')
  assert.equal(o.record('unknown'), undefined)
})

test('followupPrompt updates last prompt for running and history records', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'original')
  o.bindChild(rec.childId, 'sess-1')
  o.followupPrompt('sess-1', 'rejected, redo')
  assert.equal(o.currentMap.get('sess-1').prompt, 'rejected, redo')
  o.finish('sess-1', 'done')
  o.followupPrompt('sess-1', 'followup after done')
  assert.equal(o.history[0].prompt, 'followup after done')
})

test('followupPrompt urgency tag: 入账/扩散/清除三态（tisitan.2）', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'original')
  o.bindChild(rec.childId, 'sess-1')
  // 非空字符串入账
  o.followupPrompt('sess-1', 'mid-run correction', 'steer')
  assert.equal(o.currentMap.get('sess-1').urgency, 'steer')
  // 随 finish 扩散进 history（台账落盘全链路的前置）
  o.finish('sess-1', 'done')
  assert.equal(o.history[0].urgency, 'steer')
  // 缺省清除残留：字段语义恒为「最新一条 prompt 的投递档」
  o.followupPrompt('sess-1', 'plain queued followup')
  assert.equal(o.history[0].urgency, undefined)
  assert.ok(!('urgency' in o.history[0]), '清除是删字段而非置 undefined——旧记录形状零变化')
  // 空串同缺省
  o.followupPrompt('sess-1', 'abort-tagged', 'abort')
  assert.equal(o.history[0].urgency, 'abort')
  o.followupPrompt('sess-1', 'empty string clears', '')
  assert.ok(!('urgency' in o.history[0]))
})

test('bindChild on a missing placeholder warns and returns undefined', () => {
  const o = new Orchestration()
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    const result = o.bindChild('child-missing', 'sess-1')
    assert.equal(result, undefined)
    assert.equal(o.currentMap.size, 0)
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes('bindChild failed'))
    assert.ok(warnings[0].includes('sess-1'))
  } finally {
    console.warn = origWarn
  }
})

test('dropQueuedFailed removes the work item and records a failed history entry', () => {
  const o = new Orchestration()
  o.enqueue('hermes', 'a', 'parent-1')
  o.enqueue('explore', 'b', 'parent-1')
  const work = o.queue[0]
  work.retries = 4
  const done = o.dropQueuedFailed(work, new Error('spawn boom'))
  assert.equal(o.queue.length, 1)
  assert.equal(o.queue[0].agentType, 'explore')
  assert.equal(done.status, 'failed')
  assert.equal(done.agentType, 'hermes')
  assert.ok(done.conclusion.includes('spawn boom'))
  assert.equal(o.history.length, 1)
  assert.equal(o.history[0].childId, work.id)
})

// ── 兜底闸与台账养护（tisitan.15） ──────────────────────────────────────

test('enforceCurrentCap：超限淘汰 updatedAt 最旧的滞留记录，未超限原样', () => {
  const o = new Orchestration()
  for (let i = 0; i < 500; i++) o.currentMap.set(`c${i}`, { childId: `c${i}`, updatedAt: 1000 + i })
  o.enforceCurrentCap()
  assert.equal(o.currentMap.size, 500)
  assert.ok(o.currentMap.has('c0'), '未超限不淘汰')
  o.currentMap.set('c500', { childId: 'c500', updatedAt: 1500 })
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    o.enforceCurrentCap()
  } finally {
    console.warn = origWarn
  }
  assert.equal(o.currentMap.size, 500, '超限后回落到上限')
  assert.equal(o.currentMap.has('c0'), false, 'updatedAt 最旧者被淘汰')
  assert.ok(o.currentMap.has('c500'))
  assert.equal(warnings.length, 1, '淘汰留痕 console.warn')
  assert.ok(warnings[0].includes('currentMap cap'))
})

test('beginSpawning 路径闸生效：连发超限后 currentMap 稳定在上限', () => {
  const o = new Orchestration()
  for (let i = 0; i < 501; i++) o.beginSpawning('hermes', 't')
  assert.equal(o.currentMap.size, 500)
})

test('pruneLedgerParents：超量按桶内最新 updatedAt 保留最近桶', () => {
  assert.deepEqual(pruneLedgerParents(undefined), {})
  assert.deepEqual(pruneLedgerParents('nope'), {})
  const mk = (id, latest) => ({ [id]: [{ childId: id, agentType: 'hermes', updatedAt: latest }] })
  const parents = { ...mk('a', 100), ...mk('b', 300), ...mk('c', 200) }
  const kept = pruneLedgerParents(parents, 2)
  assert.deepEqual(Object.keys(kept).sort(), ['b', 'c'], '按桶内最新 updatedAt 保留最近 2 桶，a 整桶淘汰')
  assert.deepEqual(pruneLedgerParents(parents, 5), parents, '未超限原样返回')
  const withDirty = { ...mk('a', 100), ...mk('b', 300), empty: [], dirty: 'x', ...mk('c', 200) }
  const kept2 = pruneLedgerParents(withDirty, 2)
  assert.deepEqual(Object.keys(kept2).sort(), ['b', 'c'], '空桶与非数组桶不参与计数')
  const kept3 = pruneLedgerParents({ ...mk('a', 100), x: [{ childId: 'x', agentType: 'hermes' }] }, 1)
  assert.deepEqual(kept3, mk('a', 100), '缺失 updatedAt 视为 0，最旧被淘汰')
})
