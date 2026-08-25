// Unit tests for the Orchestration state machine (single-line-blocking core).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Orchestration } from '../preset/tools/broker.mjs'

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

test('dropQueuedFor removes only the given parent session tasks', () => {
  const o = new Orchestration()
  o.enqueue('hermes', 'a', 'parent-1')
  o.enqueue('explore', 'b', 'parent-2')
  o.enqueue('librarian', 'c', 'parent-1')
  const dropped = o.dropQueuedFor('parent-1')
  assert.equal(dropped, 2)
  assert.equal(o.queue.length, 1)
  assert.equal(o.queue[0].agentType, 'explore')
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
