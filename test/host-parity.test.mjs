// lib 半 dispatchWork 模型校验对齐回归（tisitan.11）：binding.model 必须先经
// llm.listModels 校验真实存在才写进 agentOptions（此前 lib 半无条件硬塞，
// 与 broker 半行为漂移）；无 provider 可解析时与 broker 半同语义——直透，
// 由 agent/request waterfall 兜底校验。
// 本文件只加载 lib/index.js：每个测试进程独立运行，避免 Symbol.for 快照桥
// 被 broker 半覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as host from '../lib/index.js'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-host-home-'))

const withRealSignalContract = (fn) => async (spec) => {
  spec.signal.throwIfAborted()
  return fn(spec)
}

function mockHostCtx({ startContinuable, agents, llm, settings, sessions, toolsRegistry } = {}) {
  const listeners = new Map()
  const tools = new Map()
  const rpcHandlers = new Map()
  // 与 bridge/multi-session 的 mock 同契约：ctx.subagents 直挂属性（dispatchWork/
  // continue/forward 直接解引用）且 get('subagents') 可取。
  const subagents = { startContinuable }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return agents
      if (name === 'subagents') return subagents
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'sessions') return sessions
      if (name === 'tools') return toolsRegistry
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    // connection.rpc 通道捕获：saveSettings/loadSettings 端点经此注册，
    // 测试用返回的 rpc() 直呼端点（真实 DSH 由 WebUI 走同一入口）。
    inject: (_deps, cb) => {
      try {
        cb({ connection: { rpc: { handle: (channel, fn) => { rpcHandlers.set(channel, fn) } } } })
      } catch { /* no connection in this deployment shape */ }
    },
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    subagents,
  }
  return { ctx, listeners, tools, rpc: (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload) }
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

// ── fallback 备选链 step-1：settings schema + 合并通路回归批 ─────────────

test('lib 半 settings schema：fallbacks 数组被接受并原样带出', async () => {
  let registered
  const settings = {
    register: (ns, schema) => { registered = schema; return {} },
    get: () => undefined,
  }
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  assert.ok(registered, 'settings.register 应被调用且捕获 schema')
  const parsed = registered({ hermes: { provider: 'a', model: 'b', fallbacks: [{ provider: 'x', model: 'y' }] } })
  assert.deepEqual(parsed.hermes.fallbacks, [{ provider: 'x', model: 'y' }], 'schema 接受 fallbacks 且保持数组形状')
})

test('lib 半 saveSettings：fallbacks 空数组转 unset，非空数组原样 set', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    hermes: { fallbacks: [] },
    oracle: { fallbacks: [{ provider: 'p1', model: 'm1' }] },
  })
  assert.equal(res.ok, true)
  assert.equal(mutates.length, 1)
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'hermes' && o.path[1] === 'fallbacks'),
    [{ op: 'unset', path: ['hermes', 'fallbacks'] }],
    '空数组与空字符串同语义：unset',
  )
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'oracle' && o.path[1] === 'fallbacks'),
    [{ op: 'set', path: ['oracle', 'fallbacks'], value: [{ provider: 'p1', model: 'm1' }] }],
    '非空数组原样保留',
  )
})

test('host/broker 四处 settings 合并块对称携带 fallbacks（?? 链）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  const line = 'fallbacks: row.fallbacks ?? merged[key]?.fallbacks,'
  const count = (src) => src.split(line).length - 1
  assert.equal(count(hostSrc), 2, 'lib 半初始合并 + updated 监听各 1 处')
  assert.equal(count(brokerSrc), 2, 'broker 半初始合并 + updated 监听各 1 处')
})

// ── tool-mask 配置化（tisitan.13）：schema + saveSettings + listTools ────

test('lib 半 settings schema：toolMask.deny 数组被接受，缺省键不受影响', async () => {
  let registered
  const settings = {
    register: (ns, schema) => { registered = schema; return {} },
    get: () => undefined,
  }
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  const parsed = registered({ toolMask: { deny: ['mcp__a__x', 'tool_y'] } })
  assert.deepEqual(parsed.toolMask.deny, ['mcp__a__x', 'tool_y'], 'schema 接受 toolMask 且保持形状')
  const parsedMinimal = registered({})
  assert.ok(parsedMinimal && typeof parsedMinimal === 'object', '不含 toolMask 的存量配置仍可解析（向后兼容）')
})

test('lib 半 saveSettings：toolMask.deny 空数组转 unset，非空原样 set', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    toolMask: { deny: ['mcp__a__x'] },
    hermes: { fallbacks: [] },
  })
  assert.equal(res.ok, true)
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'toolMask'),
    [{ op: 'set', path: ['toolMask', 'deny'], value: ['mcp__a__x'] }],
    '非空 deny 原样 set',
  )
  const res2 = await rpc('/dsh-my-go', 'saveSettings', { toolMask: { deny: [] } })
  assert.equal(res2.ok, true)
  assert.deepEqual(
    mutates[1].ops.filter((o) => o.path[0] === 'toolMask'),
    [{ op: 'unset', path: ['toolMask', 'deny'] }],
    '空数组与不屏蔽同语义：unset',
  )
})

test('lib 半 listTools：花名册返回全局工具名且滤保留名（mock 注册表）', async () => {
  const { ctx, rpc } = mockHostCtx({
    toolsRegistry: {
      schemas: () => [
        { name: 'read', description: '', parameters: {} },
        { name: 'run_code', description: '', parameters: {} },
        { name: 'mcp__vcp__alpha', description: '', parameters: {} },
        { name: 'mcp__vcp__beta', description: '', parameters: {} },
      ],
    },
  })
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, ['mcp__vcp__alpha', 'mcp__vcp__beta', 'read'], '保留名 run_code 不返回，名单排序去重')
})

test('lib 半 listTools：tools 服务缺席回落空名单（ok:true）', async () => {
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, [], '设置页降级为纯编辑器而非报错')
})

// ── fallback 备选链 step-2：readTurnFailure 结构化 + isFallbackable 分类器 ──

test('lib 半 isFallbackable / normalizeTurnFailure 与 broker 半同语义', async () => {
  const { isFallbackable, normalizeTurnFailure } = host
  assert.equal(typeof isFallbackable, 'function', 'lib 半应导出 isFallbackable')
  assert.equal(typeof normalizeTurnFailure, 'function', 'lib 半应导出 normalizeTurnFailure')
  // 分类表核心行（与 bridge.test.mjs 的 broker 半全表互为镜像）
  assert.equal(isFallbackable(undefined), true, '全缺失保守可切')
  assert.equal(isFallbackable({ message: 'x', code: 'ABORTED' }), false)
  assert.equal(isFallbackable({ message: 'This operation was aborted', code: 'UNKNOWN' }), false)
  assert.equal(isFallbackable({ message: 'rate limited', code: 'RATE_LIMIT', status: 429 }), true)
  assert.equal(isFallbackable({ message: 'no such model', code: 'HTTP_404', status: 404 }), true)
  // 结构化归一
  assert.deepEqual(normalizeTurnFailure({ message: 'm', code: 'C', status: 500 }), { message: 'm', code: 'C', status: 500 })
  assert.deepEqual(normalizeTurnFailure({ message: 'm', code: 'C' }), { message: 'm', code: 'C', status: undefined })
  assert.equal(normalizeTurnFailure({ code: 'X' }), undefined)
})

test('lib 半 readArchivedTurnFailure 结构化返回 {message, code, status}', async () => {
  const { mkdtempSync: mkTmp, mkdirSync, writeFileSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const { zstdCompressSync } = await import('node:zlib')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-host-norm-'))
  try {
    const line = (rec) => JSON.stringify(rec) + '\n'
    const dir = join(home, 'sessions', host.projectKey(process.cwd()), 'hsess-norm')
    mkdirSync(dir, { recursive: true })
    const frame1 = zstdCompressSync(Buffer.from(line({ type: 'session/header', seq: 0, time: 0, data: { version: 1 } })))
    const frame2 = zstdCompressSync(Buffer.from(line({
      type: 'turn/end', seq: 1, time: 1,
      data: { turn: 1, reason: { kind: 'error', error: { message: 'provider 500: boom', code: 'SERVER', status: 500 } } },
    })))
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([frame1, frame2]))
    assert.deepEqual(
      host.readArchivedTurnFailure('hsess-norm', { root: join(home, 'sessions'), cwd: process.cwd() }),
      { message: 'provider 500: boom', code: 'SERVER', status: 500 },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('host/broker 双半 normalize/isFallbackable 定义与提取通路对称（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const marker of [
    'export function normalizeTurnFailure',
    'export function isFallbackable',
    'const failure = normalizeTurnFailure(ev.data.reason.error)',
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), marker.includes('ev.data.reason.error') ? 2 : 1, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), marker.includes('ev.data.reason.error') ? 2 : 1, `broker 半: ${marker}`)
  }
})

// ── fallback 备选链 step-3：broker 重派核心 ──────────────────────────────

test('lib 半重派 e2e：链首 404 → 切 fallbacks[0] 重派，历史带标注，新 child 归属原 orchestration', async () => {
  const parent = { id: 'parent-h3', session: { header: {} } }
  const specs = []
  const { ctx, listeners, tools } = mockHostCtx({
    agents: { get: (id) => (id === 'parent-h3' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (id === 'hsess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'no such model: m0', code: 'HTTP_404', status: 404 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `hsess-${specs.length}` } }),
  })
  await host.apply(ctx, {
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  const goWork = tools.get('go_work')
  await goWork.execute({ agent: 'hermes', prompt: 'host build' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'hsess-1', stopReason: 'error', lastAssistantMessage: [] })
  await new Promise((r) => setTimeout(r, 25))
  assert.equal(specs.length, 2, '链首失败后自动重派')
  assert.deepEqual(specs[1].request.agentOptions, { provider: 'p1', model: 'm1' }, 'agentOptions 覆盖为备选条目')
  assert.equal(specs[1].request.parent, parent, '同 parent（原 Sisyphus 会话）重派')
  assert.ok(specs[1].request.prompt[0].text.includes('host build'), '同 prompt 重派（lib 半纯 prompt 形状）')
  const status = await tools.get('orchestration_status').execute().then((v) => v.text)
  assert.ok(status.includes('[备选 1/1] 失败 → 自动切换备选 p1/m1 重派'), '历史带 [备选 n/m] provider/model 标注')
  assert.ok(status.includes('失败原因: no such model: m0 [HTTP_404]'), '原失败条目附因保留')
  assert.ok(status.includes('hermes (hsess-2) — running'), '新 child 在原 orchestration 占槽运行')
})

test('host/broker 重派核心对称（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const [marker, expected] of [
    ['const fallbackDecided = new Set()', 1],
    ['async function pickFallbackEntry(type, from)', 1],
    ['function finalizeEnd(orch, ownerPid, type, childId, conclusion, failed, failure)', 1],
    ['async function attemptFallbackRedeploy(', 1],
    ['fallbackAttempt: attempt', 1],
    ["info?.stopReason === 'error' && fallbackChain.length > 0 && !fallbackDecided.has(childId) && orch.currentMap.has(childId)", 1],
    ['未读到附因，保守切换', 2],
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), expected, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), expected, `broker 半: ${marker}`)
  }
})
