// tisitan.18 失败通知真空期消灭战·三件套：
//   ① 名册简报系统提示段（dsh-my-go:roster，函数态 text、儿童门控、字节稳定）
//   ③ broker 失败同步预告（评估中/取证中）+ attemptFallbackRedeploy 终局通知
// 双半对称源码断言在 host-parity.test.mjs（新范式断言）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { renderRosterBriefing } from '../preset/shared/roles.mjs'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-fnotice-home-'))

// 与 bridge.test.mjs mockCtxFull 同契约，额外捕获 systemPrompt.section 注册。
function mockCtxFull({ startContinuable, agents, llm, settings, sessions, subagentsExtra } = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-fnotice-home-'))
  const listeners = new Map()
  const tools = new Map()
  const sections = []
  const ctx = {
    get: (name) => {
      if (name === 'agents') return agents
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'sessions') return sessions
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: (def) => { sections.push(def) } },
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    subagents: { startContinuable, ...subagentsExtra },
  }
  return { ctx, listeners, tools, sections }
}

const withRealSignalContract = (fn) => async (spec) => {
  spec.signal.throwIfAborted()
  return fn(spec)
}

const execOf = (agent) => ({ agent, signal: new AbortController().signal })
const drain = (ms = 25) => new Promise((r) => setTimeout(r, ms))

const rosterSectionOf = (sections) => sections.find((s) => s?.name === 'dsh-my-go:roster')

// ── ① 名册简报系统提示段 ─────────────────────────────────────────────────

test('名册简报段注册形态：name/order=10/函数态 text/无 complete（与 persona/orchestration 共存）', async () => {
  const { ctx, sections } = mockCtxFull()
  await broker.apply(ctx, {})
  const def = rosterSectionOf(sections)
  assert.ok(def, 'dsh-my-go:roster 段已注册')
  assert.equal(def.order, 10, 'order=10（persona(0) 与编排规则(20) 之间空档）')
  assert.equal(typeof def.text, 'function', '函数态 text（每次 assemble 现调）')
  assert.notEqual(def.complete, true, '不得携带 complete:true')
  assert.ok(sections.some((s) => s?.name === 'deployment:persona'), 'persona 段共存')
  assert.ok(sections.some((s) => s?.name === 'dsh-my-go:orchestration'), 'orchestration 段共存')
})

test('名册简报段儿童门控：子代理（parentSession 直达 + label 兜底）返回空串，根编排会话返回简报', async () => {
  const { ctx, sections } = mockCtxFull()
  await broker.apply(ctx, {})
  const def = rosterSectionOf(sections)
  const root = { id: 'root-1', session: { header: {} } }
  assert.ok(def.text({ agent: root }).length > 0, '根编排会话返回简报全文')
  // parentSession 直达门控
  const child = { id: 'c-1', session: { header: { parentSession: 'root-1' } } }
  assert.equal(def.text({ agent: child }), '', '子代理（parentSession）返回空串')
  // typeOfAgent 冷恢复 label 兜底：无 parentSession 但 label 命中工种前缀
  const coldChild = { id: 'c-2', session: { header: { label: 'dsh-my-go:hermes: 批量替换' } } }
  assert.equal(def.text({ agent: coldChild }), '', '冷恢复子代理（label 兜底识别）返回空串')
  // 无 agent 上下文（畸形调用）不炸
  assert.equal(typeof def.text({}), 'string')
})

test('名册简报内容：工种/模型/备选链序列/toolFilter 概要/人设来源 + 协议指路头部', async () => {
  const { ctx, sections } = mockCtxFull()
  await broker.apply(ctx, {
    bindings: {
      hermes: {
        provider: 'p0', model: 'm0',
        fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }],
        toolFilter: { allow: ['read', 'write'] },
      },
      'custom-z': { provider: 'p9', model: 'm9', persona: 'X 人设', toolFilter: { deny: ['bash'] }, fallbacks: [{ provider: 'p8', model: 'm8' }] },
    },
  })
  const def = rosterSectionOf(sections)
  const text = def.text({ agent: { id: 'root-1', session: { header: {} } } })
  const lines = text.split('\n')
  assert.ok(lines[0].includes('failed 通知先到是常态') && lines[0].includes('静默等待 broker 的备选处置通知'), '头部一行协议指路')
  assert.ok(lines.some((l) => l === '- hermes → p0·m0 → 备选链 2 条（p1·m1 → p2·m2） → 工具: 仅 read, write → 人设: 内置文件'), 'hermes 行全要素')
  assert.ok(lines.some((l) => l === '- custom-z → p9·m9 → 备选链 1 条（p8·m8） → 工具: 除 bash → 人设: 自定义人设'), '自定义角色行全要素')
  assert.ok(lines.some((l) => l === '- explore → 跟随环境 → 无备选链 → 工具: 全量（除全局掩码） → 人设: 内置文件'), '未配工种回落跟随环境/无备选链')
  // 键排序渲染：字典序——custom-z（c 开头）排在全部内置工种之前
  assert.ok(lines.indexOf(lines.find((l) => l.includes('- custom-z'))) < lines.indexOf(lines.find((l) => l.includes('- explore'))), '键排序渲染（字典序）')
})

test('名册简报字节稳定：同 settings 两次渲染逐字节全等（渲染器键排序，键插入序无关）', async () => {
  const { ctx, sections } = mockCtxFull()
  await broker.apply(ctx, {
    bindings: {
      'custom-z': { model: 'mz', fallbacks: [{ provider: 'p1', model: 'm1' }] },
      'custom-a': { provider: 'pa' },
      hermes: { provider: 'p0', model: 'm0' },
    },
  })
  const def = rosterSectionOf(sections)
  const root = { agent: { id: 'root-1', session: { header: {} } } }
  assert.equal(def.text(root), def.text(root), '同 apply 两次渲染逐字节全等')
  // 渲染器直测：同语义的 bindings 不同键插入序 → 逐字节全等
  const a = renderRosterBriefing({ 'custom-z': { model: 'mz' }, 'custom-a': {}, hermes: { model: 'm0' } })
  const b = renderRosterBriefing({ hermes: { model: 'm0' }, 'custom-a': {}, 'custom-z': { model: 'mz' } })
  assert.equal(a, b, '键插入序不影响渲染结果')
})

test('名册简报 bindings 取法：沿用 settings/updated 整表重建，函数态天然免刷新管道', async () => {
  let stored = { roles: { hermes: { provider: 'p0', model: 'm0' } } }
  const settings = {
    register: () => ({}),
    get: () => stored,
  }
  const { ctx, listeners, sections } = mockCtxFull({ settings })
  await broker.apply(ctx, {})
  const def = rosterSectionOf(sections)
  const root = { agent: { id: 'root-1', session: { header: {} } } }
  assert.ok(def.text(root).includes('- hermes → p0·m0'), '初载 settings 合并生效')
  // WebUI 改配置 → settings/updated → bindings 整表重建 → 函数态现调直读新值
  stored = { roles: { hermes: { provider: 'p9', model: 'm9', fallbacks: [{ provider: 'p8', model: 'm8' }] } } }
  listeners.get('settings/updated')('dsh-my-go')
  const next = def.text(root)
  assert.ok(next.includes('- hermes → p9·m9 → 备选链 1 条（p8·m8）'), 'settings 更新后无需任何刷新管道即反映新绑定')
  // 非本命名空间的更新事件被忽略
  stored = { roles: { hermes: { provider: 'pX', model: 'mX' } } }
  listeners.get('settings/updated')('other-plugin')
  assert.ok(!def.text(root).includes('pX·mX'), '异命名空间 settings/updated 不触发重绑')
})

// ── ③ 失败同步预告 + 终局显式通知 ────────────────────────────────────────

test('预告：有链失败同步 inject「备选评估中」，先于异步重派通知到达', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const specs = []
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'no such model: m0', code: 'HTTP_404', status: 404 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  // 零延迟断言：end 处理器同步段（无 drain）预告已在父会话
  const preview = injected.find((m) => m.content?.[0]?.text?.includes('备选评估中'))
  assert.ok(preview, '有链失败同步 inject 评估中预告（真空期消灭）')
  assert.ok(preview.content[0].text.includes('失败已知悉: sess-1 (hermes) 备选评估中（1 条），暂缓失败处置'), '预告口径含 childId/工种/链数/暂缓指令')
  assert.equal(injected.filter((m) => m.content?.[0]?.text?.includes('备选重派')).length, 0, '同步段内重派通知尚未到达（异步处置）')
  await drain()
  const texts = injected.map((m) => m.content?.[0]?.text ?? '')
  const iPreview = texts.findIndex((t) => t.includes('备选评估中'))
  const iRedeploy = texts.findIndex((t) => t.includes('备选重派'))
  assert.ok(iPreview !== -1 && iRedeploy !== -1 && iPreview < iRedeploy, '评估中预告先于备选重派通知')
})

test('预告：无链失败同步 inject「无备选链，取证中」，先于附因通知', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'SERVER', status: 500 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'explore', prompt: 'scout' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  const preview = injected.find((m) => m.content?.[0]?.text?.includes('无备选链，取证中'))
  assert.ok(preview, '无链失败同步 inject 取证中预告')
  assert.ok(preview.content[0].text.includes('失败已知悉: sess-1 (explore)'), '预告含 childId/工种')
  const texts = injected.map((m) => m.content?.[0]?.text ?? '')
  const iPreview = texts.findIndex((t) => t.includes('无备选链，取证中'))
  const iCause = texts.findIndex((t) => t.includes('子代理失败'))
  assert.ok(iPreview !== -1 && iCause !== -1 && iPreview < iCause, '取证中预告先于附因通知')
  assert.equal(injected.filter((m) => m.content?.[0]?.text?.includes('失败终局')).length, 0, '无链路径不发终局通知（无评估可终局）')
})

test('预告：有链但非 error 终局（aborted）→「不进入备选评估，取证中」，绝不谎报评估中', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'task' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'aborted', lastAssistantMessage: [] })
  const preview = injected.find((m) => m.content?.[0]?.text?.includes('不进入备选评估，取证中'))
  assert.ok(preview, '有链但 aborted：预告取证中（不谎报评估中，否则主流程空等）')
  assert.ok(!injected.some((m) => m.content?.[0]?.text?.includes('备选评估中')), '不进入评估绝不发评估中预告')
})

test('终局通知：备选链尽（备选也失败）→「备选链尽，按失败终局落账」', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const specs = []
  const errorEvents = {
    'sess-1': { message: 'no such model: m0', code: 'HTTP_404', status: 404 },
    'sess-2': { message: 'provider 429 exhausted', code: 'RATE_LIMIT', status: 429 },
  }
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (errorEvents[id]
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: errorEvents[id] } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'task' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await drain()
  assert.equal(specs.length, 2, '链首失败已切备选重派')
  listeners.get('subagent/end')({ id: 'sess-2', stopReason: 'error', lastAssistantMessage: [] })
  await drain() // 终局通知在 attemptFallbackRedeploy 的 await 边界之后，等异步处置落地
  // 链尽终局通知也走评估中预告路径（sess-2 有链且未决策过）→ 先预告后终局
  const terminal = injected.find((m) => m.content?.[0]?.text?.includes('备选链尽，按失败终局落账'))
  assert.ok(terminal, '链尽收到终局通知')
  assert.ok(terminal.content[0].text.includes('失败终局: sess-2 (hermes)'), '终局通知含新 childId/工种')
  const texts = injected.map((m) => m.content?.[0]?.text ?? '')
  const previews = texts.filter((t) => t.includes('备选评估中'))
  assert.equal(previews.length, 2, '链上两跳各有评估中预告')
  assert.equal(injected.filter((m) => m.content?.[0]?.text?.includes('失败终局')).length, 1, '终局通知仅链尽一次')
})

test('终局通知：分类器否决（abort 类附因）→「附因属中断类，不重派，按失败终局落账」', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'This operation was aborted', code: 'ABORTED' } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'task' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await drain()
  const terminal = injected.find((m) => m.content?.[0]?.text?.includes('附因属中断类，不重派，按失败终局落账'))
  assert.ok(terminal, '分类器否决收到终局通知')
  assert.ok(terminal.content[0].text.includes('失败终局: sess-1 (hermes)'))
  assert.ok(!injected.some((m) => m.content?.[0]?.text?.includes('备选重派')), '否决路径无重派通知')
})

test('预告：成功 end 零预告（失败已知悉/失败终局均不出现）', async () => {
  const injected = []
  const parent = { id: 'parent-1', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, listeners, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-1' })),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'task' }, execOf(parent))
  listeners.get('subagent/end')({ id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done' }] })
  await drain()
  assert.equal(injected.filter((m) => m.content?.[0]?.text?.includes('失败已知悉')).length, 0, '成功 end 零预告')
  assert.equal(injected.filter((m) => m.content?.[0]?.text?.includes('失败终局')).length, 0, '成功 end 零终局通知')
})
