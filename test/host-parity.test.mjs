// lib 半 dispatchWork 模型校验对齐回归（tisitan.11）：binding.model 必须先经
// llm.listModels 校验真实存在才写进 agentOptions（此前 lib 半无条件硬塞，
// 与 broker 半行为漂移）；无 provider 可解析时与 broker 半同语义——直透，
// 由 agent/request waterfall 兜底校验。
// 本文件只加载 lib/index.js：每个测试进程独立运行，避免 Symbol.for 快照桥
// 被 broker 半覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as host from '../lib/index.js'
import * as brokerHalf from '../preset/tools/broker.mjs'
import * as sharedFailure from '../preset/shared/failure.mjs'
import * as sharedRoles from '../preset/shared/roles.mjs'
import * as sharedMisc from '../preset/shared/misc.mjs'

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

// ── 棒2-L3：双半 model/waterfall 校验对称（lib 对齐 broker） ─────────────

test('lib 半 waterfall 对齐 broker：校验不过告警并保持 seed，provider 为空判丢弃（棒2-L3）', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    const parent = { id: 'parent-h6', session: { header: {} } }
    const { ctx, listeners } = mockHostCtx({
      agents: { get: (id) => (id === 'parent-h6' ? parent : undefined) },
      llm: { listModels: async (pid) => (pid === 'beta' ? [{ id: 'good-m' }] : []) },
    })
    await host.apply(ctx, { bindings: { hermes: { provider: 'beta', model: 'ghost-m' }, oracle: { model: 'any-m' } } })
    const wf = (agent, seed) => listeners.get('agent/request')({ agent }, async () => ({ ...seed }))
    // provider 已解析 + 模型校验不过：告警一次 + 保持 seed 的 model（不硬塞）
    const ghost = await wf({ id: 'w1', session: { header: { label: 'dsh-my-go:hermes: x' } } }, { provider: 'seed-p', model: 'seed-m' })
    assert.equal(ghost.provider, 'beta', 'provider 绑定仍生效')
    assert.equal(ghost.model, 'seed-m', '校验不过保持 seed model（修复前不告警，与 broker 漂移）')
    assert.ok(warnings.some((l) => l.includes('model "ghost-m" not found on provider "beta"')), '校验失败告警（双半同款降噪口径）')
    // provider 全空（绑定与 seed 均无）：判丢弃 model（不盲塞），且不告警
    const noProvider = await wf({ id: 'w2', session: { header: { label: 'dsh-my-go:oracle: y' } } }, { model: 'seed-m' })
    assert.equal(noProvider.provider, undefined, '无 provider 时 seed 形状原样')
    assert.equal(noProvider.model, 'seed-m', 'provider 为空判丢弃：不盲塞模型（修复前放行）')
    assert.equal(warnings.filter((l) => l.includes('not found on provider')).length, 1, '空 provider 路径不告警（无 provider 可归因）')
  } finally {
    console.warn = origWarn
  }
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
  const parsed = registered({ roles: { hermes: { provider: 'a', model: 'b', fallbacks: [{ provider: 'x', model: 'y' }] } } })
  assert.deepEqual(parsed.roles.hermes.fallbacks, [{ provider: 'x', model: 'y' }], 'schema 接受 fallbacks 且保持数组形状')
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
    mutates[0].ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'hermes' && o.path[2] === 'fallbacks'),
    [{ op: 'unset', path: ['roles', 'hermes', 'fallbacks'] }],
    '空数组与空字符串同语义：unset',
  )
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'oracle' && o.path[2] === 'fallbacks'),
    [{ op: 'set', path: ['roles', 'oracle', 'fallbacks'], value: [{ provider: 'p1', model: 'm1' }] }],
    '非空数组原样保留',
  )
})

test('settings 合并单一源：mergeRoleBindings 定义于 shared，两半接线各 2 处调用（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  // 定义不再双写：两半源码里都没有函数体，只有 import + re-export
  assert.equal(hostSrc.split('function mergeRoleBindings').length - 1, 0, 'lib 半无本地定义（已迁 shared）')
  assert.equal(brokerSrc.split('function mergeRoleBindings').length - 1, 0, 'broker 半无本地定义（原内联块退役）')
  // 接线对称：初载 + settings/updated 各 1 处调用
  const call = 'bindings = mergeRoleBindings(baseBindings, '
  assert.equal(hostSrc.split(call).length - 1, 2, 'lib 半接线 2 处')
  assert.equal(brokerSrc.split(call).length - 1, 2, 'broker 半接线 2 处')
  // ?? 链语义在 shared 单点定义（行为断言见「shared 行为面直测」用例）
  const sharedRolesSrc = await readFile(new URL('../preset/shared/roles.mjs', import.meta.url), 'utf-8')
  assert.equal(sharedRolesSrc.split('fallbacks: row.fallbacks ?? merged[key]?.fallbacks,').length - 1, 1, 'shared roles.mjs 单点携带 fallbacks ?? 链')
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

// ── 附因取证 cwd 无关化（tisitan.16b）：默认路径未命中时按 childId 兜底搜索 ──

// 造一份多帧 zstd 档案（turn/end error 文本可配），与 dsh-session-persistence-jsonl 落盘形状一致
async function writeArchive(dir, message) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { zstdCompressSync } = await import('node:zlib')
  const line = (rec) => JSON.stringify(rec) + '\n'
  mkdirSync(dir, { recursive: true })
  const frame1 = zstdCompressSync(Buffer.from(line({ type: 'session/header', seq: 0, time: 0, data: { version: 1 } })))
  const frame2 = zstdCompressSync(Buffer.from(line({
    type: 'turn/end', seq: 1, time: 1,
    data: { turn: 1, reason: { kind: 'error', error: { message, code: 'RATE_LIMIT', status: 429 } } },
  })))
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([frame1, frame2]))
}

test('readArchivedTurnFailure：cwd 错配时按 childId 兜底搜索命中（含 warn 留痕）', async () => {
  const { mkdtempSync: mkTmp } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-cwdmiss-'))
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const root = join(home, 'sessions')
    const projectA = host.projectKey('D:\\real-workspace')
    await writeArchive(join(root, projectA, 'hsess-dead'), 'rate limited: 5h cap')
    // options.cwd 指向不存在的项目目录——模拟 dsh web 宿主 cwd 与工作区错配
    const result = host.readArchivedTurnFailure('hsess-dead', { root, cwd: join(home, 'no-such-dir') })
    assert.deepEqual(result, { message: 'rate limited: 5h cap', code: 'RATE_LIMIT', status: 429 }, '兜底搜索读到附因')
    assert.ok(warnings.some((l) => l.includes('兜底搜索命中') && l.includes(projectA)), '兜底命中 warn 含项目目录名')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('readArchivedTurnFailure：多项目目录同名 childId 取 mtime 最新', async () => {
  const { mkdtempSync: mkTmp, utimesSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-mtime-'))
  const origWarn = console.warn
  console.warn = () => {}
  try {
    const root = join(home, 'sessions')
    const oldFile = join(root, host.projectKey('D:\\proj-old'), 'hsess-dup', 'session.jsonl.zstd')
    const newFile = join(root, host.projectKey('D:\\proj-new'), 'hsess-dup', 'session.jsonl.zstd')
    await writeArchive(join(oldFile, '..'), 'old error from project A')
    await writeArchive(join(newFile, '..'), 'new error from project B')
    const now = new Date()
    utimesSync(oldFile, now, new Date(now.getTime() - 60000))
    utimesSync(newFile, now, now)
    const result = host.readArchivedTurnFailure('hsess-dup', { root, cwd: join(home, 'no-such-dir') })
    assert.equal(result?.message, 'new error from project B', '多命中取 mtime 最新的档案')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('readArchivedTurnFailure：兜底零命中 warn + undefined（原语义不变）', async () => {
  const { mkdtempSync: mkTmp, mkdirSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-nohit-'))
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const root = join(home, 'sessions')
    mkdirSync(join(root, host.projectKey('D:\\some-project')), { recursive: true })
    const result = host.readArchivedTurnFailure('hsess-ghost', { root, cwd: join(home, 'no-such-dir') })
    assert.equal(result, undefined, '零命中静默退回无附因')
    assert.ok(warnings.some((l) => l.includes('持久化档案不可读')), '走原 warn 留痕路径')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('shared 单一源：两半 import 行指向存在的文件，提取通路保留（源码断言）', async () => {
  const repoRoot = new URL('../', import.meta.url)
  const halves = [
    ['broker', 'preset/tools/', 'broker.mjs', '../shared/'],
    ['lib', 'lib/', 'index.js', '../preset/shared/'],
  ]
  for (const [name, dir, entry, sharedPrefix] of halves) {
    const src = await readFile(new URL(dir + entry, repoRoot), 'utf-8')
    const importLines = src.split('\n').filter((l) => l.includes(`from '${sharedPrefix}`))
    assert.ok(importLines.length >= 6, `${name} 半应有 ≥6 行 shared import，实际 ${importLines.length}`)
    for (const line of importLines) {
      const m = /from '([^']+)'/.exec(line)
      assert.ok(m, `import 行含 from 子句: ${line.trim()}`)
      const target = fileURLToPath(new URL(m[1], new URL(dir, repoRoot)))
      assert.ok(existsSync(target), `${name} 半 import 目标存在: ${m[1]}`)
    }
  }
  // 消费通路（subagent/end 处理器内的附因归一）仍在两半 apply 内
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const [label, src] of [['lib 半', hostSrc], ['broker 半', brokerSrc]]) {
    assert.equal(src.split('const failure = normalizeTurnFailure(ev.data.reason.error)').length - 1, 1, `${label}: apply 内提取通路 1 处（另一处随 readArchivedTurnFailure 迁入 shared/archive.mjs）`)
  }
  const sharedArchiveSrc = await readFile(new URL('../preset/shared/archive.mjs', import.meta.url), 'utf-8')
  assert.equal(sharedArchiveSrc.split('const failure = normalizeTurnFailure(ev.data.reason.error)').length - 1, 1, 'shared archive.mjs 内提取通路 1 处')
})

test('shared 行为面直测：失败分类 / 角色合并 / 迁移 ops / 工种识别 / 台账修剪（两半同一实例）', async () => {
  // 两半 re-export 与 shared 模块是同一 ESM 绑定（单一实例，非复制）
  assert.equal(host.normalizeTurnFailure, sharedFailure.normalizeTurnFailure, 'lib re-export === shared')
  assert.equal(host.isFallbackable, sharedFailure.isFallbackable)
  assert.equal(brokerHalf.describeAgent, sharedMisc.describeAgent, 'broker re-export === shared')
  assert.equal(brokerHalf.Orchestration, (await import('../preset/shared/orchestration.mjs')).Orchestration, 'Orchestration 类单一定义')
  // normalizeTurnFailure：非字符串 message 拒绝，code/status 类型收紧
  assert.equal(sharedFailure.normalizeTurnFailure(null), undefined)
  assert.deepEqual(sharedFailure.normalizeTurnFailure({ message: 'x', code: 5, status: 502.5 }), { message: 'x', code: undefined, status: undefined })
  // isFallbackable：全缺失保守可切，abort 类绝不切
  assert.equal(sharedFailure.isFallbackable(undefined), true)
  assert.equal(sharedFailure.isFallbackable({ code: 'ABORTED' }), false)
  assert.equal(sharedFailure.isFallbackable({ code: 'SERVER' }), true)
  // mergeRoleBindings：roles 自定义键进合并结果，缺字段回落基线
  const merged = sharedRoles.mergeRoleBindings({ hermes: { model: 'base' } }, { roles: { 'custom-x': { model: 'm9', persona: 'X' } } })
  assert.equal(merged['custom-x'].model, 'm9')
  assert.equal(merged.hermes.model, 'base')
  // migrateLegacyRolesOps：整行搬入 roles + 旧键 unset
  const ops = sharedRoles.migrateLegacyRolesOps({ hermes: { model: 'm1' } })
  assert.deepEqual(ops.map((o) => [o.op, o.path.join('.')]), [['set', 'roles.hermes'], ['unset', 'hermes']])
  // typeOfAgent：活登记优先于畸形 label；无登记时 label 兜底
  assert.equal(sharedMisc.typeOfAgent(new Map([['c1', 'hermes']]), { id: 'c1', session: { header: { label: 'garbage' } } }), 'hermes')
  assert.equal(sharedMisc.typeOfAgent(new Map(), { id: 'c2', session: { header: { label: 'dsh-my-go:explore: 快速检索' } } }), 'explore')
  assert.equal(sharedMisc.typeOfAgent(new Map(), { id: 'c3', session: { header: { label: 'unrelated' } } }), undefined)
  // pruneLedgerParents：超 cap 保留最近桶
  const kept = sharedMisc.pruneLedgerParents({ a: [{ updatedAt: 100 }], b: [{ updatedAt: 300 }] }, 1)
  assert.deepEqual(Object.keys(kept), ['b'])
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
  // 带调用方上下文读状态：本文件全file共享一个 DSH_HOME，前序用例完工记录的
  // 防抖台账一旦在本用例 apply 前落盘，loadLedger 会建出多桶使无 exec 的
  //  orchForStatus 拒绝猜测（多实例 → idle）——真实调用方恒有 agent 上下文
  const status = await tools.get('orchestration_status').execute({}, execOf(parent)).then((v) => v.text)
  assert.ok(status.includes('[备选 1/1] 失败 → 自动切换备选 p1/m1 重派'), '历史带 [备选 n/m] provider/model 标注')
  assert.ok(status.includes('失败原因: no such model: m0 [HTTP_404]'), '原失败条目附因保留')
  assert.ok(status.includes('hermes (hsess-2) — running'), '新 child 在原 orchestration 占槽运行')
})

// ── 路由层（tisitan.14）：spawn 正统通道（persona/toolFilter）+ 名册路由 ──

test('lib 半 spawn 通道：自定义角色 persona/toolFilter 进 request，内置工种回落兜底文案', async () => {
  const parent = { id: 'parent-h4', session: { header: {} } }
  const specs = []
  const { ctx, listeners, tools } = mockHostCtx({
    agents: { get: (id) => (id === 'parent-h4' ? parent : undefined) },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `hsess-${specs.length}` } }),
    toolsRegistry: { schemas: () => [{ name: 'read' }, { name: 'write' }, { name: 'glob' }] },
  })
  await host.apply(ctx, {
    bindings: {
      'custom-x': { provider: 'p9', model: 'm9', persona: '你是自定义角色 X', toolFilter: { allow: ['read', 'ghost'], deny: ['write'] } },
    },
  })
  const goWork = tools.get('go_work')
  await goWork.execute({ agent: 'custom-x', prompt: 'custom task' }, execOf(parent))
  assert.equal(specs[0].request.persona, '你是自定义角色 X')
  assert.deepEqual(specs[0].request.toolFilter, { allow: ['read'], deny: ['write'] }, '假名 ghost 被活目录过滤，deny 原样')
  assert.equal(specs[0].request.prompt[0].text, 'custom task', '首条 prompt 纯任务文本')
  // 单线阻塞：清槽后第二派才真正 spawn
  listeners.get('subagent/end')({ id: 'hsess-1', stopReason: 'completed', lastAssistantMessage: [] })
  await new Promise((r) => setTimeout(r, 15))
  await goWork.execute({ agent: 'hermes', prompt: 'builtin task' }, execOf(parent))
  assert.equal(typeof specs[1].request.persona, 'string', '内置工种恒带 persona（prompts 缺档时兜底文案）')
  assert.ok(specs[1].request.persona.includes('hermes sub-agent'))
})

test('lib 半名册路由：未注册名结构化报错 + describeAgent default 永不 undefined', async () => {
  const parent = { id: 'parent-h5', session: { header: {} } }
  const { ctx, tools } = mockHostCtx({
    agents: { get: (id) => (id === 'parent-h5' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'hsess-x' })),
  })
  await host.apply(ctx, { bindings: { 'custom-x': { persona: 'X 首行' } } })
  await assert.rejects(
    () => tools.get('go_work').execute({ agent: 'nope', prompt: 'x' }, execOf(parent)),
    (error) => {
      const msg = String(error.message)
      assert.ok(msg.includes('unknown agent role: nope'))
      assert.ok(msg.includes('- custom-x: custom role: X 首行'))
      return true
    },
  )
  assert.equal(host.describeAgent('custom-x', undefined), 'custom role', 'default 分支不返回 undefined')
  assert.equal(host.describeAgent('hermes', undefined).includes('fast execution'), true, '内置描述不变')
})

// ── 工种识别统一与台账养护（tisitan.15）：双半对称（源码断言） ──────────

test('host/broker 双半 typeOfAgent 与养护闸经 shared 接线（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const marker of [
    'const type = typeOfAgent(sessionTypes, agent)',
    'this.enforceCurrentCap()',
    'pruneLedgerParents(raw.parents)',
    'pruneLedgerParents(parents)',
    'const rosterKeys = () => sharedRosterKeys(bindings)',
    'const rolePersona = (type) => sharedRolePersona(bindings, promptCache, loadPrompt, type)',
    'const resolveRoleToolFilter = (type, filter) => sharedResolveRoleToolFilter(type, filter, liveToolNames())',
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), count(brokerSrc), `双半计数一致: ${marker}`)
  }
  assert.equal(hostSrc.split('const agentType = typeOfAgent(sessionTypes, agent)').length - 1, 0, 'lib 半无 assemble 监听器（DSV4P0813 phase-1 为 broker 独有）')
  assert.equal(brokerSrc.split('const agentType = typeOfAgent(sessionTypes, agent)').length - 1, 1, 'broker assemble 消费点走 typeOfAgent')
  assert.equal(hostSrc.split("from '../preset/shared/").length - 1 >= 6, true, 'lib 半 shared import ≥6 行')
  assert.equal(brokerSrc.split("from '../shared/").length - 1 >= 6, true, 'broker 半 shared import ≥6 行')
})

// ── 内置卡「载入文件默认」（tisitan.16b）：getBuiltinPersona RPC 端点 ────

test('lib 半 getBuiltinPersona：正常读取 / 非法 type / 目录穿越 / 文件缺失全结构化', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  // 用哨兵内容覆盖同步落盘的真文件（版本标记已短路 ensurePresetInstalled，
  // 不会被后台拷贝覆写），断言读取的正是磁盘原文而非任何缓存
  const promptsDir = join(process.env.DSH_HOME, '.agent-presets', 'dsh-my-go', 'prompts')
  mkdirSync(promptsDir, { recursive: true })
  writeFileSync(join(promptsDir, 'hermes.md'), 'SENTINEL hermes 人设原文')
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, {})
  const ok = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'hermes' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { type: 'hermes', persona: 'SENTINEL hermes 人设原文' }, '直读磁盘原文返回')
  const illegal = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'Hermes' })
  assert.equal(illegal.ok, false, '大写非法 type 拒绝')
  assert.equal(illegal.error.code, 'bad-request')
  const traversal = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: '../../package' })
  assert.equal(traversal.ok, false, '目录穿越被 ROLE_KEY_PATTERN 拒绝')
  const noPayload = await rpc('/dsh-my-go', 'getBuiltinPersona')
  assert.equal(noPayload.ok, false, '缺 payload 拒绝而非抛穿')
  const missing = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'ghost-role' })
  assert.equal(missing.ok, false, '合法但无文件的 type 结构化空')
  assert.equal(missing.error.code, 'not-found')
})

// ── 界面层（tisitan.14）：saveSettings 的 persona/toolFilter 显式字段 + 角色删除 ──

function settingsMockWithStored(stored) {  return {
    register: () => ({}),
    get: () => stored,
    mutate: async () => {},
  }
}

test('saveSettings：draft.roles 行显式携带 persona/toolFilter 时 set/unset，空=unset', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    roles: {
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X 人设', toolFilter: { allow: ['read', ''], deny: [] } },
      'custom-y': { persona: '' },
    },
  })
  assert.equal(res.ok, true)
  const ops = mutates[0].ops
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'persona' && o.path[1] === 'custom-x'),
    [{ op: 'set', path: ['roles', 'custom-x', 'persona'], value: 'X 人设' }],
    '非空 persona 原样 set',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'persona' && o.path[1] === 'custom-y'),
    [{ op: 'unset', path: ['roles', 'custom-y', 'persona'] }],
    '空字符串 persona = unset',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'toolFilter' && o.path[3] === 'allow'),
    [{ op: 'set', path: ['roles', 'custom-x', 'toolFilter', 'allow'], value: ['read'] }],
    'allow 非空 set（剔空条目）',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'toolFilter' && o.path[3] === 'deny'),
    [{ op: 'unset', path: ['roles', 'custom-x', 'toolFilter', 'deny'] }],
    'deny 空数组 unset',
  )
})

test('saveSettings：旧形状/内置提升行不带 persona/toolFilter 字段 → 完全不触碰', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  await rpc('/dsh-my-go', 'saveSettings', {
    sisyphus: { provider: 'ps', persona: '不该被写进任何地方' },
    hermes: { provider: 'p1', persona: '顶级工种键 persona' },
    roles: { hermes: { provider: 'p1' } },
  })
  const ops = mutates[0].ops
  assert.equal(ops.filter((o) => o.path.includes('persona')).length, 0, '无显式 persona 字段 = 零 persona ops')
  assert.equal(ops.filter((o) => o.path.includes('toolFilter')).length, 0, '无显式 toolFilter 字段 = 零 toolFilter ops')
  assert.equal(ops.filter((o) => o.path[0] === 'sisyphus' && o.path[1] === 'persona').length, 0, 'sisyphus 恒不触碰 persona')
})

test('saveSettings：draft 提供 roles dict 时缺失的非内置键整键 unset；旧前端无 roles 键不清册', async () => {
  const stored = { sisyphus: {}, toolMask: {}, roles: { 'custom-x': { provider: 'p9' }, 'custom-y': {}, hermes: { provider: 'p1' } } }
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => stored,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, {})
  await rpc('/dsh-my-go', 'saveSettings', { roles: { 'custom-x': { provider: 'p9' } } })
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2),
    [{ op: 'unset', path: ['roles', 'custom-y'] }],
    'draft.roles 缺失的 custom-y 整键 unset；custom-x 存续；内置 hermes 不在删除面',
  )
  await rpc('/dsh-my-go', 'saveSettings', { hermes: { provider: 'p1' } })
  assert.equal(
    mutates[1].ops.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2).length,
    0,
    '旧前端 draft 无 roles 键 → 删除语义不启用，存量名册不被误清',
  )
})

test('loadSettings 回传形状：roles 原样附带 + 内置提升 + sisyphus/toolMask 顶级（角色编辑器数据源）', async () => {
  const stored = {
    sisyphus: { provider: 'ps' },
    toolMask: { deny: [] },
    roles: {
      hermes: { provider: 'p1', model: 'm1' },
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X' },
    },
  }
  const { ctx, rpc } = mockHostCtx({ settings: settingsMockWithStored(stored) })
  await host.apply(ctx, {})
  const res = await rpc('/dsh-my-go', 'loadSettings', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.roles['custom-x'].persona, 'X', 'roles 原样附带（编辑器数据源）')
  assert.deepEqual(res.value.hermes, { provider: 'p1', model: 'm1' }, '内置提升回顶级')
  assert.deepEqual(res.value.sisyphus, { provider: 'ps' })
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
    // 棒2-Z1：备选评估 await 窗口内双发 end 按迟到/重复忽略，不提前落史
    ['duplicate subagent/end while fallback evaluation in flight', 1],
    // 棒2-Z2：spawn 解析前 pending 备选表（登记 ×1、清理 ×2、waterfall 消费 ×1）
    ['const pendingFallbackByLabel = new Map()', 1],
    ['pendingFallbackByLabel.set(fallbackLabel, { provider: entry.provider, model: entry.model })', 1],
    ['pendingFallbackByLabel.delete(fallbackLabel)', 2],
    ['?? pendingFallbackByLabel.get(agent?.session?.header?.label)', 1],
    ["resolveEffectiveBinding(bindings[type ?? 'sisyphus'] ?? {}, override)", 1],
    // 现场-Z3：台账文件兜底查找（定义 ×1 + continue/forward 调用点 ×2）
    ['async function findRecordWithLedgerFallback(', 1],
    ['await findRecordWithLedgerFallback(', 2],
    // 棒2-L2：跨会话抢属主防线（continue + forward 各 1）
    ['belongs to another live orchestration session', 2],
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), expected, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), expected, `broker 半: ${marker}`)
  }
})

// ── 备选重派运行期防回跳（tisitan.16）：activeFallback 双半对称 ──────────

test('host/broker activeFallback 写入/清理/消费点对称（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const [marker, expected] of [
    // 声明 ×1；消费（waterfall 有效绑定）×1；写入（重派成功登记）×1
    ['const activeFallback = new Map()', 1],
    // waterfall 消费点：activeFallback 优先，spawn 解析前窗口按 label 匹配 pending（棒2-Z2）
    ['?? pendingFallbackByLabel.get(agent?.session?.header?.label)', 1],
    ['activeFallback.set(newChildId, { provider: entry.provider, model: entry.model })', 1],
    // 清理：finalizeEnd / 重派换键 / end 无属主兜底 各 1 处 = 3
    ['activeFallback.delete(childId)', 3],
    // tombstoneType 立碑清理 ×1 + 墓碑 FIFO 淘汰连带清理 ×1
    ['activeFallback.delete(id)', 1],
    ['activeFallback.delete(evicted)', 1],
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), expected, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), expected, `broker 半: ${marker}`)
  }
  // 合并语义单一源：两半都无本地定义，只经 shared/misc.mjs 接线
  assert.equal(hostSrc.split('function resolveEffectiveBinding').length - 1, 0, 'lib 半无本地定义')
  assert.equal(brokerSrc.split('function resolveEffectiveBinding').length - 1, 0, 'broker 半无本地定义')
})

// ── 备选覆盖复活重建（tisitan.17）：fallbackEntry 入账/重建点双半对称 ──────

test('host/broker fallbackEntry 入账与复活重建对称（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const [marker, expected] of [
    // 入账：beginSpawning extra 与 fallbackAttempt 同点携带备选条目本体 ×1
    ['fallbackEntry: { provider: entry.provider, model: entry.model }', 1],
    // 复活重建：continue 路径 ×1、forward 路径 ×1，畸形条目守卫同形 ×2
    ['activeFallback.set(record.childId, record.fallbackEntry)', 1],
    ['activeFallback.set(target, record.fallbackEntry)', 1],
    ["typeof record.fallbackEntry.provider === 'string'", 2],
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), expected, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), expected, `broker 半: ${marker}`)
  }
})

test('shared 行为面：resolveEffectiveBinding 覆盖合并（两半同一实例）', () => {
  assert.equal(host.resolveEffectiveBinding, sharedMisc.resolveEffectiveBinding, 'lib re-export === shared')
  assert.equal(brokerHalf.resolveEffectiveBinding, sharedMisc.resolveEffectiveBinding, 'broker re-export === shared')
  const base = { provider: 'p0', model: 'm0', reasoningEffort: 'high', fallbacks: [{ provider: 'p1', model: 'm1' }] }
  const merged = sharedMisc.resolveEffectiveBinding(base, { provider: 'p1', model: 'm1' })
  assert.deepEqual(merged, { ...base, provider: 'p1', model: 'm1' }, '覆盖只换 provider/model，工种其余字段保留')
  assert.notEqual(merged, base, '返回新对象')
  assert.equal(base.provider, 'p0', '绝不原地改 bindings[type]（防备选泄漏给常规派发）')
  assert.equal(sharedMisc.resolveEffectiveBinding(base, undefined), base, '无覆盖 → 原样返回（同一对象）')
  assert.equal(sharedMisc.resolveEffectiveBinding(base, null), base)
  assert.equal(sharedMisc.resolveEffectiveBinding(base, { provider: 'p1' }), base, '畸形覆盖（缺 model）不生效')
  assert.equal(sharedMisc.resolveEffectiveBinding(undefined, undefined), undefined, '双缺省直通')
})

// ── 失败通知真空期消灭战（tisitan.18）：同步预告/终局通知双半对称 + 名册简报段 ──

test('host/broker 失败同步预告与终局通知对称（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
  ])
  for (const [marker, expected] of [
    // 同步预告：有链进评估 / 无链取证中 / 有链但非 error 终局取证中，各 1 处
    ['备选评估中（', 1],
    ['无备选链，取证中', 1],
    ['不进入备选评估，取证中', 1],
    // 棒2-L4：附因全灭的无链路径补「未读到附因」终局口径
    ['未读到附因（live 与档案均无失败原因）', 1],
    // 终局显式通知：分类器否决 / 链尽 / 无法重派，各 1 处
    ['附因属中断类，不重派，按失败终局落账', 1],
    ['备选链尽，按失败终局落账', 1],
    ['无法重派（', 2], // console.warn 留痕 + 终局通知同口径
    ['按失败终局落账', 3],
    // 同步段零 await 契约：预告在 attemptFallbackRedeploy 点火之前
    ['fallbackDecided.add(childId)', 1],
  ]) {
    const count = (src) => src.split(marker).length - 1
    assert.equal(count(hostSrc), expected, `lib 半: ${marker}`)
    assert.equal(count(brokerSrc), expected, `broker 半: ${marker}`)
  }
  // 预告先于异步点火（两半同构，源码序断言）
  for (const [label, src] of [['lib 半', hostSrc], ['broker 半', brokerSrc]]) {
    assert.ok(src.indexOf('备选评估中（') < src.indexOf('void attemptFallbackRedeploy('), `${label}: 评估中预告先于 attemptFallbackRedeploy 点火`)
  }
})

test('名册简报段为 broker 独有注册 + 渲染单一源在 shared（源码断言）', async () => {
  const [brokerSrc, hostSrc, rolesSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/shared/roles.mjs', import.meta.url), 'utf-8'),
  ])
  // 渲染器单一源：shared 定义 1 处，broker 经别名 import + 函数态 text 消费 2 处
  assert.equal(rolesSrc.split('export function renderRosterBriefing').length - 1, 1, 'shared roles.mjs 单点定义')
  assert.equal(brokerSrc.split('sharedRenderRosterBriefing').length - 1, 2, 'broker 半 import + text 消费')
  assert.equal(hostSrc.split('renderRosterBriefing').length - 1, 0, 'lib 半不注册系统提示段（与 persona/orchestration 同为 broker 独有）')
  // 注册形态：name / order=10 / 无 complete:true（同 scope 同名重注册会抛错，形态必须唯一）
  assert.equal(brokerSrc.split("name: 'dsh-my-go:roster'").length - 1, 1, 'broker 半注册 1 处')
  assert.equal(brokerSrc.split('order: 10').length - 1, 1, 'order=10（persona(0) 与编排规则(20) 之间空档）')
  assert.equal(hostSrc.split('dsh-my-go:roster').length - 1, 0, 'lib 半零注册')
  assert.ok(!/"dsh-my-go:roster"[^}]*complete:\s*true/s.test(brokerSrc), 'roster 段不得携带 complete:true')
})

// ── 棒2-M1：快照桥存在时 lib 半台账只读化（broker 半是唯一写者） ──────────
// 双半同挂时 lib 的 scheduleLedgerSave 会以启动时陈旧快照整体覆写台账文件，
// 静默回退 broker 半的新鲜历史（重启 + 任一会话删除即触发）。修复后桥函数
// 在席即写通路早退；读取照常（loadLedger 供 RPC 与兜底查找）。

test('快照桥存在时 lib 半台账只读化：任何突变不再覆写台账文件（棒2-M1）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-my-go-m1-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const hadBridge = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prevBridge = globalThis[bridgeKey]
  try {
    // 预置台账文件：一个「broker 半落盘」的桶，内含一条记录
    const ledgerFile = join(dir, 'dsh-my-go', 'orchestration-ledger.json')
    await mkdir(dirname(ledgerFile), { recursive: true })
    const diskPayload = JSON.stringify({ version: 2, parents: { 'p-x': [{ childId: 'c-1', agentType: 'explore', prompt: 't', status: 'done', conclusion: 'keep me', createdAt: 1, updatedAt: 1 }] } })
    await writeFile(ledgerFile, diskPayload, 'utf-8')
    // 发布快照桥（模拟双半同挂：broker 半已在同进程 apply 过）
    globalThis[bridgeKey] = () => ({ seq: 1, parents: {} })
    const { ctx, listeners } = mockHostCtx({ agents: { get: () => undefined } })
    await host.apply(ctx, {})
    // lib 侧突变：session/disposed → scheduleLedgerSave（修复前以启动快照整体覆写）
    listeners.get('session/disposed')({ id: 'p-x' })
    await new Promise((r) => setTimeout(r, 400)) // 台账防抖窗口
    assert.equal(await readFile(ledgerFile, 'utf-8'), diskPayload, '桥存在时台账文件逐字节未动（broker 是唯一写者）')
    // 对照组：撤桥后（broker 缺席的部署形态）同一突变路径恢复写者身份，
    // 被 dispose 的桶按既有语义清出——只读化不误伤单 lib 部署
    delete globalThis[bridgeKey]
    const { ctx: ctx2, listeners: listeners2 } = mockHostCtx({ agents: { get: () => undefined } })
    await host.apply(ctx2, {})
    listeners2.get('session/disposed')({ id: 'p-x' })
    await new Promise((r) => setTimeout(r, 400))
    const after = JSON.parse(await readFile(ledgerFile, 'utf-8'))
    assert.equal(after.parents['p-x'], undefined, '无桥时本半仍是写者（单 lib 部署不回归）')
  } finally {
    if (hadBridge) globalThis[bridgeKey] = prevBridge
    else delete globalThis[bridgeKey]
    process.env.DSH_HOME = prevHome
    await rm(dir, { recursive: true, force: true })
  }
})
