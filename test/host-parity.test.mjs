// lib 半 dispatchWork 模型校验对齐回归（tisitan.11）：binding.model 必须先经
// llm.listModels 校验真实存在才写进 agentOptions（此前 lib 半无条件硬塞，
// 与 broker 半行为漂移）；无 provider 可解析时与 broker 半同语义——直透，
// 由 agent/request waterfall 兜底校验。
// 本文件只加载 lib/index.js：每个测试进程独立运行，避免 Symbol.for 快照桥
// 被 broker 半覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as host from '../lib/index.js'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-host-home-'))

const withRealSignalContract = (fn) => async (spec) => {
  spec.signal.throwIfAborted()
  return fn(spec)
}

function mockHostCtx({ startContinuable, agents, llm } = {}) {
  const listeners = new Map()
  const tools = new Map()
  // 与 bridge/multi-session 的 mock 同契约：ctx.subagents 直挂属性（dispatchWork/
  // continue/forward 直接解引用）且 get('subagents') 可取。
  const subagents = { startContinuable }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return agents
      if (name === 'subagents') return subagents
      if (name === 'llm') return llm
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, _cb) => {},
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    subagents,
  }
  return { ctx, listeners, tools }
}

const execOf = (agent) => ({ agent, signal: new AbortController().signal })

test('lib 半 dispatchWork：配置的模型仅在 modelExists 通过时应用，否则回落 provider', async () => {
  const parent = { id: 'parent-h1', session: { header: {} } }
  const specs = []
  const { ctx, listeners, tools } = mockHostCtx({
    agents: { get: (id) => (id === 'parent-h1' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'beta' ? [{ id: 'good-model' }] : []) },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `hsess-${specs.length}` } }),
  })
  await host.apply(ctx, {
    bindings: {
      hermes: { provider: 'beta', model: 'good-model' },
      oracle: { provider: 'beta', model: 'ghost-model' },
    },
  })
  const goWork = tools.get('go_work')
  const r1 = await goWork.execute({ agent: 'hermes', prompt: 'build' }, execOf(parent))
  assert.equal(r1.status, 'running')
  assert.deepEqual(specs[0].request.agentOptions, { provider: 'beta', model: 'good-model' })
  // 单线阻塞：先落账第一个子代理，再派第二个
  listeners.get('subagent/end')({ id: 'hsess-1', stopReason: 'completed', lastAssistantMessage: [] })
  await goWork.execute({ agent: 'oracle', prompt: 'deep' }, execOf(parent))
  assert.deepEqual(specs[1].request.agentOptions, { provider: 'beta' }, 'listModels 查不到的模型不得硬塞进 agentOptions')
})

test('lib 半 dispatchWork：无 provider 可解析时模型直透（与 broker 半同语义）', async () => {
  const parent = { id: 'parent-h2', session: { header: {} } }
  let seen
  const { ctx, tools } = mockHostCtx({
    agents: { get: (id) => (id === 'parent-h2' ? parent : undefined) },
    startContinuable: withRealSignalContract(async (spec) => { seen = spec; return { childId: 'hsess-x' } }),
  })
  await host.apply(ctx, { bindings: { librarian: { model: 'any-model' } } })
  await tools.get('go_work').execute({ agent: 'librarian', prompt: 'read' }, execOf(parent))
  assert.deepEqual(seen.request.agentOptions, { model: 'any-model' }, 'provider 缺省时直透，由 waterfall 兜底校验')
})
