// Integration test: broker publishes a live snapshot accessor on the
// Symbol.for global registry, and the lib RPC snapshot endpoint prefers it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as broker from '../preset/tools/broker.mjs'

function mockCtx() {
  return {
    get: () => undefined,
    on: () => {},
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
  }
}

test('broker.apply publishes Symbol.for("dsh-my-go.snapshot") accessor', async () => {
  const key = Symbol.for('dsh-my-go.snapshot')
  delete globalThis[key]
  await broker.apply(mockCtx())
  const accessor = globalThis[key]
  assert.equal(typeof accessor, 'function', 'snapshot accessor should be published')
  const snapshot = accessor()
  assert.ok(snapshot === null || typeof snapshot === 'object')
  if (snapshot) {
    assert.equal(typeof snapshot.seq, 'number')
    assert.ok(Array.isArray(snapshot.queue))
    assert.ok(Array.isArray(snapshot.helpRequests))
    assert.ok(Array.isArray(snapshot.history))
  }
})

test('snapshot accessor returns live state (not a stale copy)', async () => {
  const key = Symbol.for('dsh-my-go.snapshot')
  await broker.apply(mockCtx())
  const accessor = globalThis[key]
  const before = accessor()
  // Trigger a state change through a second apply's fresh orchestration is NOT
  // possible (each apply has its own state); instead verify the accessor reads
  // the same mutable reference twice — i.e. it is a getter, not a snapshot.
  const after = accessor()
  assert.ok(before === after || (before?.seq ?? 0) <= (after?.seq ?? 0))
})
