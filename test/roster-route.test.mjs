// 路由层（0.2.3-tisitan.14）：go_work 名册路由 + spawn 正统通道（persona/toolFilter）
// + 活花名册 + 缺名兜底 + forward 名册化。本文件只加载 broker 半（独立进程，
// 避免 Symbol.for 快照桥被 host 半覆盖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, drain, snapOf, waitFor } from './helpers/mock-ctx.mjs'

const defaultSchemas = () => [{ name: 'read' }, { name: 'write' }, { name: 'glob' }, { name: 'bash' }]

// 全功能 mock 契约见 helpers/mock-ctx.mjs（六文件共用）；本文件专属默认值是台账
// 目录前缀，toolsRegistry（活花名册数据源）由用例逐个传入。
function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-roster-route-', ...options })
}

test('go_work 自定义角色：persona/toolFilter 经 spawn 通道注入，prompt 保持纯任务', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 'sess-c1' } }),
    toolsRegistry: { schemas: defaultSchemas },
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: {
      'custom-x': {
        provider: 'p9', model: 'm9',
        persona: '你是自定义角色 X',
        toolFilter: { allow: ['read', 'need_help'], deny: ['write'] },
      },
    },
  })
  const r = await tools.get('go_work').execute({ agent: 'custom-x', prompt: 'do the thing' }, execOf(parent))
  assert.equal(r.status, 'running')
  const req = specs[0].request
  assert.equal(req.persona, '你是自定义角色 X', '自定义角色 persona 经 request.persona 通道')
  assert.deepEqual(req.toolFilter, { allow: ['read', 'need_help'], deny: ['write'] }, '活目录内 allow（含编排自产工具）与 deny 原样透传')
  assert.equal(req.prompt[0].text, 'do the thing', '首条 prompt 为纯任务文本（system-reminder 包装退役）')
})

test('go_work 未注册名：结构化报错并列出当前可用角色清单', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 's1' } }),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { 'custom-x': { persona: 'X 的人设第一行' } } })
  await assert.rejects(
    () => tools.get('go_work').execute({ agent: 'nope', prompt: 'x' }, execOf(parent)),
    (error) => {
      const msg = String(error.message)
      assert.ok(msg.includes('unknown agent role: nope'), '报错点名未注册名')
      assert.ok(msg.includes('- hermes: fast execution'), '清单含内置工种与描述')
      assert.ok(msg.includes('- custom-x: custom role: X 的人设第一行'), '清单含自定义角色与 persona 首行摘要')
      assert.ok(msg.includes('orchestration_status'), '指引查活花名册')
      return true
    },
  )
  assert.equal(specs.length, 0, '未注册名不产生 spawn')
})

test('toolFilter 缺名兜底：假名被过滤 + warn，spawn 照常', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const { ctx, tools } = mockCtxFull({
      startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 's1' } }),
      toolsRegistry: { schemas: defaultSchemas },
    })
    await broker.apply(ctx, {
      queueRetryBaseMs: 5,
      bindings: { hermes: { toolFilter: { allow: ['read', 'ghost-tool', 'need_help'] } } },
    })
    const r = await tools.get('go_work').execute({ agent: 'hermes', prompt: 'x' }, execOf(parent))
    assert.equal(r.status, 'running', '过滤后 spawn 照常')
    assert.deepEqual(specs[0].request.toolFilter, { allow: ['read', 'need_help'] }, '假名被剔除')
    assert.ok(warnings.some((l) => l.includes('ghost-tool')), '被跳过的名字 warn 留痕')
  } finally {
    console.warn = origWarn
  }
})

test('toolFilter allow 全部为假名：丢弃 toolFilter（不传字段），子代理回落全量目录', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const { ctx, tools } = mockCtxFull({
      startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 's1' } }),
      toolsRegistry: { schemas: defaultSchemas },
    })
    await broker.apply(ctx, {
      queueRetryBaseMs: 5,
      bindings: { hermes: { toolFilter: { allow: ['ghost-a', 'ghost-b'] } } },
    })
    await tools.get('go_work').execute({ agent: 'hermes', prompt: 'x' }, execOf(parent))
    assert.equal('toolFilter' in specs[0].request, false, '配置不可信时不传 toolFilter')
    assert.ok(warnings.some((l) => l.includes('allow list emptied')), 'allow 被清空有 warn')
  } finally {
    console.warn = origWarn
  }
})

test('内置工种：persona 经 spawn 通道注入（prompts 缺档时兜底文案），prompt 无包装', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 's1' } }),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5 })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'plain task' }, execOf(parent))
  assert.equal(typeof specs[0].request.persona, 'string', '内置工种恒有 persona 字段')
  assert.ok(specs[0].request.persona.includes('hermes sub-agent'), 'prompts 档案缺席时回落兜底文案')
  assert.equal(specs[0].request.prompt[0].text, 'plain task', '首条 prompt 不再含 persona 包装')
})

test('fallback 重派：persona/toolFilter 与首派同源（bindings[type]）', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'no such model: m0', code: 'HTTP_404', status: 404 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
    toolsRegistry: { schemas: defaultSchemas },
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    disposeEndGraceMs: 30,
    bindings: {
      hermes: {
        provider: 'p0', model: 'm0',
        fallbacks: [{ provider: 'p1', model: 'm1' }],
        persona: 'hermes 定制人设',
        toolFilter: { allow: ['read', 'ghost'] },
      },
    },
  })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => specs.length >= 2, { what: '链首失败 → 切备选重派' })
  assert.equal(specs.length, 2, '链首失败 → 切备选重派')
  assert.equal(specs[1].request.persona, 'hermes 定制人设', '重派 persona 与首派同源')
  assert.deepEqual(specs[1].request.toolFilter, { allow: ['read'] }, '重派 toolFilter 同源且缺名过滤')
  assert.deepEqual(specs[1].request.agentOptions, { provider: 'p1', model: 'm1' }, 'agentOptions 仍为备选条目')
  assert.equal(specs[1].request.prompt[0].text, 'build it', '重派 prompt 保持纯任务文本')
})

test('orchestration_status：尾部含角色名册区（内置 + 自定义），sisyphus 不入可派名册', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const { ctx, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async () => ({ childId: 's1' })),
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { 'custom-x': { provider: 'p9', model: 'm9', persona: 'X', toolFilter: { deny: ['write'] } } },
  })
  const r = await tools.get('orchestration_status').execute({}, execOf(parent))
  assert.ok(r.text.includes('── 角色名册（roster） ──'), '输出尾部有 roles 区标题')
  assert.ok(r.text.includes('- hermes | 跟随环境 | 备选0 | 全量（除全局掩码） | 内置文件'), '内置工种列出且未配显示跟随环境')
  assert.ok(r.text.includes('- custom-x | p9·m9 | 备选0 | 除 write | 自定义人设'), '自定义角色列出绑定与 toolFilter 摘要')
  assert.ok(!r.text.includes('- sisyphus'), '编排者单例不入可派名册')
})

test('describeAgent default 分支：自定义角色返回通用描述且永不返回 undefined', () => {
  assert.equal(broker.describeAgent('custom-x', undefined), 'custom role')
  const d = broker.describeAgent('custom-x', '第一行人设\n第二行')
  assert.ok(d.includes('第一行人设'), 'persona 首行进描述')
  assert.ok(!d.includes('第二行'), '只取首行')
  const long = broker.describeAgent('custom-x', 'x'.repeat(100))
  assert.ok(long.length <= 'custom role: '.length + 60, '首行截断 60 字')
})

test('forward：target 为自定义角色时走 go_work 派发并携带 persona', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 'sess-w' } }),
    subagentsExtra: { reportFrom: async () => 'delivered' },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { 'custom-x': { persona: 'X 人设' } } })
  await tools.get('go_work').execute({ agent: 'explore', prompt: 'scout' }, execOf(parent))
  const childExec = { agent: { id: 'sess-w', session: { header: { parentSession: 'parent-1' } } }, signal: new AbortController().signal }
  // need_help 要求 tracked 子代理：先挂求助单，再完工清槽（否则 forward 的
  // go_work 分支因单线占位只会入队，不会真正 spawn）
  const r = await tools.get('need_help').execute({ intent: 'replan', content: '干不了，请求换人' }, childExec)
  assert.equal(r.suspended, true)
  // 单线阻塞：首派占线时 forward→go_work 只会入队；首派完工后 advanceQueue
  // 才把队首的 custom-x 真正出列派发（队列上岗链路）
  const fw = await tools.get('forward').execute({ from: r.helpRequestId, target: 'custom-x' }, execOf(parent))
  assert.equal(fw.kind, 'go_work', '自定义角色按类型派发而非按 id 续聊')
  assert.equal(specs.length, 1, '占线期间只入队不 spawn')
  dispatch('subagent/end', { id: 'sess-w', stopReason: 'completed', lastAssistantMessage: [] })
  await waitFor(() => specs.length >= 2, { what: '首派完工后队列出列派发' })
  assert.equal(specs.length, 2, '首派完工后队列出列派发')
  assert.equal(specs[1].request.persona, 'X 人设', 'forward→go_work 派发携带角色 persona')
})

// ── 工种识别统一（0.2.3-tisitan.15）：typeOfAgent 活登记优先 + label 正则兜底 ──

test('agent/request：cold-resumed 子代理（无活登记、label 在案）恢复模型绑定', async () => {
  const { ctx, listeners, dispatch } = mockCtxFull({
    startContinuable: withRealSignalContract(async () => ({ childId: 's1' })),
    llm: { listModels: async () => [{ id: 'bound-m' }, { id: 'seed-m' }] },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { hermes: { provider: 'bound-p', model: 'bound-m' } } })
  const seed = { provider: 'seed-p', model: 'seed-m' }
  const out = await dispatch('agent/request', 
    { agent: { id: 'cold-1', session: { header: { label: 'dsh-my-go:hermes: 快速执行 Hermes' } } } },
    async () => ({ ...seed }),
  )
  assert.equal(out.provider, 'bound-p', 'label 兜底命中工种 → 绑定生效（修复前 sessionTypes 直查为空，绑定静默失效）')
  assert.equal(out.model, 'bound-m')
  const untouched = await dispatch('agent/request', 
    { agent: { id: 'other-1', session: { header: { label: 'unrelated session' } } } },
    async () => ({ ...seed }),
  )
  assert.deepEqual(untouched, seed, 'label 畸形且无登记 → 不触碰种子配置')
})

test('agent/request：活登记优先于畸形 label（回退优先级正确）', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 'sess-cx' } }),
    toolsRegistry: { schemas: defaultSchemas },
    llm: { listModels: async () => [{ id: 'custom-m' }, { id: 'seed-m' }] },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { 'custom-x': { provider: 'p9', model: 'custom-m' } } })
  await tools.get('go_work').execute({ agent: 'custom-x', prompt: 'work' }, execOf(parent))
  assert.equal(specs.length, 1)
  const seed = { provider: 'seed-p', model: 'seed-m' }
  const out = await dispatch('agent/request', 
    { agent: { id: 'sess-cx', session: { header: { label: 'garbage-label' } } } },
    async () => ({ ...seed }),
  )
  assert.equal(out.model, 'custom-m', '活登记命中（label 畸形被忽略）')
  const ghost = await dispatch('agent/request', 
    { agent: { id: 'ghost-id', session: { header: { label: 'garbage-label' } } } },
    async () => ({ ...seed }),
  )
  assert.deepEqual(ghost, seed, '无登记且 label 不匹配 → 原样')
})

test('system-prompt/assemble：DSV4P0813 工种识别走 typeOfAgent（label 兜底 + 登记优先）', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: 'sess-h' } }),
    toolsRegistry: { schemas: defaultSchemas },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { hermes: { dsv4p0813: true } } })
  // C-09：listeners 的值是 fn[] 多播数组。取首 handler 并钉「该事件只注册一次」
  //（旧替身单槽后写覆盖前写，重复注册完全看不见）
  const assemble = (listeners.get('system-prompt/assemble') ?? [])[0]
  assert.equal((listeners.get('system-prompt/assemble') ?? []).length, 1, "system-prompt/assemble 只应注册一个 handler")
  const mkAssembly = () => ({
    sections: [{ name: 'persona' }, { name: 'runtime:ctx' }],
    tools: [{ name: 'bash' }, { name: 'write' }],
    contexts: [{ id: 1 }],
  })
  const next = async () => mkAssembly()
  const cold = await assemble(
    mkAssembly(),
    { agent: { id: 'cold-2', session: { header: { label: 'dsh-my-go:hermes: 快速执行' } } } },
    next,
  )
  assert.deepEqual(cold.sections, [{ name: 'persona' }], 'cold-resume 形态：label 兜底识别 → phase-1 过滤生效')
  assert.deepEqual(cold.tools, [{ name: 'bash' }, { name: 'write' }], '工具面收到 bootstrap 白名单（bash/read/write 等七件）')
  assert.deepEqual(cold.contexts, [])
  const unrelated = await assemble(
    mkAssembly(),
    { agent: { id: 'other-2', session: { header: { label: 'unrelated' } } } },
    next,
  )
  assert.equal(unrelated.sections.length, 2, '非本插件会话不过滤')
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'work' }, execOf(parent))
  const registered = await assemble(
    mkAssembly(),
    { agent: { id: 'sess-h', session: { header: { label: 'garbage' } } } },
    next,
  )
  assert.deepEqual(registered.sections, [{ name: 'persona' }], '活登记优先于畸形 label')
})

test('DSV4P0813 promotion 行为面：tool/call 事件直判 / turn-end 翻转 / phase1→phase2 单向切换（棒2-L7；N7 修事件时序）', async () => {
  const { ctx, listeners, dispatch } = mockCtxFull({
    startContinuable: withRealSignalContract(async () => ({ childId: 's-dsv' })),
    toolsRegistry: { schemas: defaultSchemas },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { hermes: { dsv4p0813: true } } })
  // C-09：listeners 的值是 fn[] 多播数组。取首 handler 并钉「该事件只注册一次」
  //（旧替身单槽后写覆盖前写，重复注册完全看不见）
  const assemble = (listeners.get('system-prompt/assemble') ?? [])[0]
  assert.equal((listeners.get('system-prompt/assemble') ?? []).length, 1, "system-prompt/assemble 只应注册一个 handler")
  // C-09：listeners 的值是 fn[] 多播数组。取首 handler 并钉「该事件只注册一次」
  //（旧替身单槽后写覆盖前写，重复注册完全看不见）
  const sessionEvent = (listeners.get('session/event') ?? [])[0]
  assert.equal((listeners.get('session/event') ?? []).length, 1, "session/event 只应注册一个 handler")
  const mkAssembly = () => ({
    sections: [{ name: 'persona' }, { name: 'runtime:ctx' }],
    tools: [{ name: 'bash' }, { name: 'write' }],
    contexts: [{ id: 1 }],
  })
  const agentOf = (id, label) => ({ agent: { id, session: { header: { label } } } })
  // 状态键是 agent.session 本体：事件侧必须传同一对象（生产语义 _session === agent.session）
  const phaseOf = async (agentCtx) => {
    const out = await assemble(mkAssembly(), agentCtx, async () => mkAssembly())
    return { sections: out.sections.map((s) => s.name), tools: out.tools.map((t) => t.name), contexts: out.contexts.length }
  }
  const PHASE1 = { sections: ['persona'], tools: ['bash', 'write'], contexts: 0 }
  const PHASE2 = { sections: ['persona', 'runtime:ctx'], tools: ['bash', 'write'], contexts: 1 }
  // 夹具必须复刻宿主派发时序（0.3.0-tisitan.7 N7）：Session.append 先 push 再 notify
  // （@deepseek-ai/dsh-session/lib/index.js:1433-1435），处理器看到的 events 数组
  // **末位恒为当前这条事件**。旧夹具把 tool/call 铺在末位、再派发 step/end，
  // 等于替倒扫实现撒了谎——真机上倒扫第一格就 break，toolCalled 永假（假绿）。
  const hermes = agentOf('p-s1', 'dsh-my-go:hermes: x')
  assert.deepEqual(await phaseOf(hermes), PHASE1, 'phase-1：sections 只剩 persona、tools 收窄 bootstrap、contexts 清空')
  // 无工具的 step：末位即当前 step/end，此前无任何 tool/call 事件 → 不翻转
  hermes.agent.session.events = [{ type: 'step/end' }]
  sessionEvent(hermes.agent.session, { type: 'step/end' })
  assert.deepEqual(await phaseOf(hermes), PHASE1, '无工具的 step 不翻转')
  // 同一 step 内先落 tool/call（agent-loop:295）后落 step/end（:563）：两条事件
  // 各自独立派发，促升发生在 tool/call 那一格
  hermes.agent.session.events = [{ type: 'step/end' }, { type: 'tool/call' }]
  sessionEvent(hermes.agent.session, { type: 'tool/call' })
  assert.deepEqual(await phaseOf(hermes), PHASE2, 'tool/call 事件即促升：全量 sections/tools/contexts')
  hermes.agent.session.events = [{ type: 'step/end' }, { type: 'tool/call' }, { type: 'step/end' }]
  sessionEvent(hermes.agent.session, { type: 'step/end' })
  assert.deepEqual(await phaseOf(hermes), PHASE2, 'tool/call 之后的 step/end 不再改变形态（判据是事件类型，非数组扫描）')
  // 单向闸：promoted 后再无事件也不回退
  hermes.agent.session.events = []
  sessionEvent(hermes.agent.session, { type: 'turn/end' })
  assert.deepEqual(await phaseOf(hermes), PHASE2, 'promotion 单向：phase-2 不回退 phase-1')
  // turn/end 独立翻转路径（未调工具、直接回复）
  const hermes2 = agentOf('p-s2', 'dsh-my-go:hermes: y')
  assert.deepEqual(await phaseOf(hermes2), PHASE1)
  hermes2.agent.session.events = [{ type: 'turn/end' }]
  sessionEvent(hermes2.agent.session, { type: 'turn/end' })
  assert.deepEqual(await phaseOf(hermes2), PHASE2, 'turn/end 响应即晋升（无工具路径）')
  // 促升判定不再读事件数组（热路径代价随之消失）：坏档/快照缺席（sessionEvents
  // 回落 []的形态）下 tool/call 事件照样驱动晋升
  const hermes3 = agentOf('p-s5', 'dsh-my-go:hermes: v')
  assert.deepEqual(await phaseOf(hermes3), PHASE1)
  hermes3.agent.session.snapshotEvents = () => { throw new Error('log closed') }
  sessionEvent(hermes3.agent.session, { type: 'tool/call' })
  assert.deepEqual(await phaseOf(hermes3), PHASE2, '事件直判不依赖事件数组：快照不可读也促升')
  // 未启用 dsv4p0813 的工种不受影响（全量形态，事件也不改变它）
  const explore = agentOf('p-s3', 'dsh-my-go:explore: z')
  assert.deepEqual(await phaseOf(explore), PHASE2, '未启用工种不过滤')
})

// ── 备选重派运行期防回跳（0.2.3-tisitan.16）：activeFallback × agent/request ──
// 生产事故根因：重派 spawn 的 agentOptions 只管首帧，waterfall 每请求按
// bindings[type] 重绑 provider/model，把备选儿童回跳成主模型再死一次。
// 以下用例模拟真实 waterfall 运行期重绑面（旧 mock 盲区只断言 spawn 入参）。

// 共享夹具：hermes 绑定 p0/m0 + effort high + 备选链 p1/m1，两 provider 模型
// 均可校验，effort 目录含 low/high（保留工种 effort 断言依赖 resolveModelInfo）
function mockRedeployCtx({ subagentsExtra } = {}) {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const mocked = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: {
      listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []),
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'rate limited', code: 'RATE_LIMIT', status: 429 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
    toolsRegistry: { schemas: defaultSchemas },
    subagentsExtra,
  })
  return { parent, specs, ...mocked }
}

const REDEPLOY_BINDINGS = {
  hermes: { provider: 'p0', model: 'm0', reasoningEffort: 'high', fallbacks: [{ provider: 'p1', model: 'm1' }] },
}
const waterfallOf = (dispatch, id, label) =>
  dispatch('agent/request', 
    { agent: { id, session: { header: { label } } } },
    async () => ({ provider: 'seed-p', model: 'seed-m' }),
  )

test('重派儿童：agent/request waterfall 保持备选 provider/model 不回跳，工种 effort 保留；常规派发不受影响', async () => {
  const { parent, specs, ctx, listeners, dispatch, tools } = mockRedeployCtx()
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  // 链首 429 → disposed + error end → 自动切备选重派
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-2', { what: '链首失败后重派并 resolve sess-2' })
  assert.equal(specs.length, 2, '链首失败后重派 sess-2')
  assert.deepEqual(specs[1].request.agentOptions, { provider: 'p1', model: 'm1' }, 'spawn 首帧仍是备选（既有行为不变）')
  // 决定性断言：重派儿童运行期每个请求经 waterfall 后仍是备选，不回跳 p0/m0
  const out = await waterfallOf(dispatch, 'sess-2', 'dsh-my-go:hermes: build it')
  assert.equal(out.provider, 'p1', '运行期重绑后 provider 保持备选（修复前被回跳成 p0）')
  assert.equal(out.model, 'm1', '运行期重绑后 model 保持备选（修复前被回跳成 m0）')
  assert.equal(out.reasoningEffort, 'high', '工种 reasoningEffort 等其余字段保留（覆盖只换 provider/model）')
  // 常规派发路径不动：sess-2 完工（仅 end，不经 disposed）后新派儿童无覆盖登记
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [] })
  await drain()
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'again' }, execOf(parent))
  assert.equal(specs.length, 3, '清槽后常规派发 sess-3')
  const normal = await waterfallOf(dispatch, 'sess-3', 'dsh-my-go:hermes: again')
  assert.equal(normal.provider, 'p0', '常规派发不受覆盖表影响：waterfall 用 bindings[type] 主模型')
  assert.equal(normal.model, 'm0')
})

test('重派儿童生命周期清理：disposed/end 后覆盖消失，waterfall 回到 bindings[type]', async () => {
  const { parent, specs, ctx, listeners, dispatch, tools } = mockRedeployCtx()
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-2', { what: '重派儿童已占槽（清理前覆盖在飞）' })
  assert.equal(specs.length, 2)
  const before = await waterfallOf(dispatch, 'sess-2', 'dsh-my-go:hermes: build it')
  assert.equal(before.model, 'm1', '清理前覆盖生效')
  // disposed 立墓碑（tombstoneType 镜像清理）→ end 收尾（finalizeEnd 再清）
  dispatch('agent/disposed', { agent: { id: 'sess-2' } })
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [] })
  await drain()
  // 活登记已清，label 兜底仍识别 hermes；覆盖表若泄漏会继续吐出 p1/m1
  const after = await waterfallOf(dispatch, 'sess-2', 'dsh-my-go:hermes: build it')
  assert.equal(after.provider, 'p0', '清理后 waterfall 回到 bindings[type] 主模型')
  assert.equal(after.model, 'm0', 'activeFallback 无泄漏（否则此处仍是 m1）')
})

// ── spawn 解析前窗口（棒2-Z2）：pendingFallbackByLabel × agent/request ──
// 重派 startContinuable resolve 之前 sessionTypes/activeFallback 均未登记，
// 窗口内儿童的请求经 typeOfAgent label 兜底只能取 bindings[type] 主模型。

// 与 mockRedeployCtx 同基座，但第二次 spawn（重派）的行为由用例自定：
// holdRelease 挂起不 resolve（窗口保持），或直接抛错（清理路径）。
const mockPendingWindowCtx = ({ spawnSecond }) => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const holdRelease = {}
  const mocked = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: {
      listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []),
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'rate limited', code: 'RATE_LIMIT', status: 429 } } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => {
      specs.push(spec)
      if (specs.length === 1) return { childId: 'sess-1' }
      return spawnSecond(spec, holdRelease)
    }),
    toolsRegistry: { schemas: defaultSchemas },
  })
  return { parent, specs, holdRelease, ...mocked }
}

test('spawn 解析前窗口：重派儿童的请求先于 resolve 到达 waterfall 也保持备选，不回跳主模型（棒2-Z2）', async () => {
  const { parent, specs, holdRelease, ctx, listeners, dispatch, tools } = mockPendingWindowCtx({
    spawnSecond: (_spec, hold) => new Promise((resolve) => { hold.release = resolve }),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => specs.length >= 2, { what: '重派 spawn 已发出但未 resolve（窗口保持）' })
  assert.equal(specs.length, 2, '重派 spawn 已发出但未 resolve（窗口保持）')
  const pendingLabel = specs[1].label
  // 窗口内：重派儿童的请求先于 spawn resolve 到达 waterfall。
  // 修复前：sessionTypes/activeFallback 均未登记，label 兜底识别工种后只能取
  // bindings[type] 主模型——0.2.3-tisitan.16 同款回跳的最后存活窗口。
  const inWindow = await waterfallOf(dispatch, 'sess-2-pending', pendingLabel)
  assert.equal(inWindow.provider, 'p1', '窗口内 provider 保持备选（修复前回跳 p0）')
  assert.equal(inWindow.model, 'm1', '窗口内 model 保持备选（修复前回跳 m0）')
  assert.equal(inWindow.reasoningEffort, 'high', '工种 reasoningEffort 等其余字段保留')
  // pending 按 label 匹配：陌生 label 的会话不沾备选
  const stranger = await waterfallOf(dispatch, 'sess-stranger', 'unrelated-label')
  assert.deepEqual(stranger, { provider: 'seed-p', model: 'seed-m' }, '陌生会话不受 pending 影响')
  // resolve 后转正：activeFallback 接管，waterfall 继续保持备选
  holdRelease.release({ childId: 'sess-2' })
  await waitFor(() => globalThis[Symbol.for('dsh-my-go.snapshot')]()?.parents?.['parent-1']?.current?.childId === 'sess-2', { what: '重派 spawn resolve 后占槽' })
  const snapOf = (pid) => globalThis[Symbol.for('dsh-my-go.snapshot')]()?.parents?.[pid]
  assert.equal(snapOf('parent-1').current?.childId, 'sess-2', 'spawn resolve 后占槽运行')
  const promoted = await waterfallOf(dispatch, 'sess-2', pendingLabel)
  assert.equal(promoted.provider, 'p1', 'resolve 后 waterfall 保持备选（转正表接管）')
  assert.equal(promoted.model, 'm1')
})

test('spawn 失败：pending 备选登记同步清理，不留悬空覆盖（棒2-Z2 清理路径）', async () => {
  const { parent, specs, ctx, listeners, dispatch, tools } = mockPendingWindowCtx({
    spawnSecond: () => { throw new Error('spawn exploded') },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => specs.length >= 2, { what: '重派 spawn 已尝试' })
  assert.equal(specs.length, 2, '重派 spawn 已尝试')
  // spawn 失败后同 label 的 waterfall 请求不得再拿到备选（pending 已清）：
  // 覆盖消失 → 回 bindings[type] 主模型（p0/m0）
  const after = await waterfallOf(dispatch, 'sess-ghost', specs[1].label)
  assert.equal(after.provider, 'p0', 'spawn 失败清 pending：同 label 不再吐备选覆盖')
  assert.equal(after.model, 'm0', '覆盖消失后按 bindings[type] 主模型解析')
})

// ── 备选覆盖复活重建（0.2.3-tisitan.17）：fallbackEntry 入账 → revive 同点回填 ──

test('continue 复活已完工备选儿童：activeFallback 按 record.fallbackEntry 重建，waterfall 不回跳', async () => {
  const { parent, specs, ctx, listeners, dispatch, tools } = mockRedeployCtx({
    subagentsExtra: { followup: async () => 'msg-r1' },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-2', { what: '链首失败后重派并 resolve sess-2' })
  assert.equal(specs.length, 2, '链首失败后重派 sess-2')
  // 备选儿童完工：finalizeEnd 清覆盖（16a 清理语义不变），waterfall 回主模型
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [] })
  await drain()
  const finished = await waterfallOf(dispatch, 'sess-2', 'dsh-my-go:hermes: build it')
  assert.equal(finished.model, 'm0', '完工后覆盖已清（复活前状态）')
  // continue 复活：sessionTypes 同点按 record.fallbackEntry 重建 activeFallback
  const r = await tools.get('continue').execute({ id: 'sess-2', prompt: '驳回，重做' }, execOf(parent))
  assert.equal(r.accepted, true)
  const revived = await waterfallOf(dispatch, 'sess-2', 'dsh-my-go:hermes: build it')
  assert.equal(revived.provider, 'p1', '复活后 waterfall 保持备选 provider（修复前回跳 p0）')
  assert.equal(revived.model, 'm1', '复活后 waterfall 保持备选 model（修复前回跳 m0）')
  assert.equal(revived.reasoningEffort, 'high', '工种 reasoningEffort 等其余字段保留')
})

test('链上第二跳覆盖第一跳：fallbackEntry 随重派换新，历史保留各自条目', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const errorEvents = {
    'sess-1': { message: 'rate limited', code: 'RATE_LIMIT', status: 429 },
    'sess-2': { message: 'server overloaded', code: 'SERVER', status: 500 },
  }
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
    llm: {
      listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : pid === 'p2' ? [{ id: 'm2' }] : []),
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    },
    sessions: {
      get: (id) => (errorEvents[id]
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: errorEvents[id] } } }] }
        : undefined),
    },
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
    toolsRegistry: { schemas: defaultSchemas },
  })
  await broker.apply(ctx, {
    queueRetryBaseMs: 5,
    bindings: { hermes: { provider: 'p0', model: 'm0', reasoningEffort: 'high', fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] } },
  })
  const snapOf = (pid) => globalThis[Symbol.for('dsh-my-go.snapshot')]()?.parents?.[pid]
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  // 第一跳：链首 429 → fallbacks[0]（p1/m1）
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-2' && snapOf('parent-1')?.current?.fallbackEntry?.model === 'm1', { what: '第一跳 resolve 占槽且备选条目入账' })
  assert.deepEqual(snapOf('parent-1')?.current?.fallbackEntry, { provider: 'p1', model: 'm1' }, '第一跳条目入账')
  // 第二跳：备选也 500 → fallbacks[1]（p2/m2）
  dispatch('agent/disposed', { agent: { id: 'sess-2' } })
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-3', { what: '第二跳重派并 resolve sess-3' })
  assert.equal(specs.length, 3, '第二跳重派 sess-3')
  assert.deepEqual(specs[2].request.agentOptions, { provider: 'p2', model: 'm2' }, '第二跳 spawn 用链上下一条')
  const cur = snapOf('parent-1')?.current
  assert.equal(cur?.childId, 'sess-3')
  assert.deepEqual(cur?.fallbackEntry, { provider: 'p2', model: 'm2' }, '新占位记录携带新条目，天然覆盖第一跳')
  assert.equal(cur?.fallbackAttempt, 2, 'attempt 索引同步递增')
  // 历史保留各自条目：链首无字段，第一跳记录仍是 p1/m1
  const history = snapOf('parent-1')?.history ?? []
  assert.equal(history.find((r) => r.childId === 'sess-1')?.fallbackEntry, undefined)
  assert.deepEqual(history.find((r) => r.childId === 'sess-2')?.fallbackEntry, { provider: 'p1', model: 'm1' }, '第一跳失败记录保留自己的条目')
  // 决定性断言：第二跳儿童运行期 waterfall 是 p2/m2，不是第一跳的 p1/m1
  const out = await waterfallOf(dispatch, 'sess-3', 'dsh-my-go:hermes: build it')
  assert.equal(out.provider, 'p2')
  assert.equal(out.model, 'm2', 'waterfall 跟随最新一跳的覆盖')
})

// ── 复活新世代（0.3.0-tisitan.7 N5）：复活曾进备选评估的儿童 ────────────────────
// 上面那组用例复活的是 sess-2（从没进过备选评估），恰好绕开了被污染的 sess-1。
// fallbackDecided 的登记发生在 end 入口的决策点（早于 attemptFallbackRedeploy
// 的三个早退分支），条目随 childId 永挂且全仓零 .delete：链首失败儿童一旦被
// continue 复活，它复活轮那条 completed end 会撞上「评估在飞」分支被吞——记录
// 永挂 running、advanceQueue 被 isBusy 堵死，该编排会话队列永久冻结。

test('continue 复活曾进备选评估的链首儿童：完工 end 不被 once-guard 残留吞掉，台账照常落账、队列解冻（N5）', async () => {
  const { parent, specs, ctx, listeners, dispatch, tools } = mockRedeployCtx({
    subagentsExtra: { followup: async () => 'msg-n5' },
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: REDEPLOY_BINDINGS })
  await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
  // 链首 429 终局：sess-1 进过备选评估（fallbackDecided 已登记）→ 重派 sess-2
  dispatch('agent/disposed', { agent: { id: 'sess-1' } })
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
  await waitFor(() => snapOf('parent-1')?.current?.childId === 'sess-2', { what: '备选重派已 resolve 占槽' })
  assert.equal(specs.length, 2, '备选重派已发生')
  const failedRow = (snapOf('parent-1')?.history ?? []).find((x) => x.childId === 'sess-1')
  assert.equal(failedRow?.status, 'failed', '链首失败记录已在账（复活前）')
  dispatch('subagent/end', { id: 'sess-2', stopReason: 'completed', lastAssistantMessage: [] })
  await drain()
  // 复活被污染者本身（不是 sess-2）
  const r = await tools.get('continue').execute({ id: 'sess-1', prompt: '驳回，按新方向重做' }, execOf(parent))
  assert.equal(r.accepted, true)
  assert.equal(snapOf('parent-1')?.current?.childId, 'sess-1', '复活后重新占槽（失败记录被搬回槽位）')
  // 复活轮正常完工
  dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '复活轮结论' }] })
  await waitFor(() => snapOf('parent-1')?.current === null, { what: '复活轮收尾释放槽位' })
  const after = snapOf('parent-1')
  assert.equal(after?.current, null, '槽位释放（修复前记录永挂 running）')
  const rows = (after?.history ?? []).filter((x) => x.childId === 'sess-1')
  assert.equal(rows.length, 1, '复活轮收尾重新落账一条（旧失败记录已被 revive 搬走）')
  assert.equal(rows[0].status, 'done', '复活轮按 completed 正常落账')
  assert.equal(rows[0].conclusion, '复活轮结论')
  const again = await tools.get('go_work').execute({ agent: 'hermes', prompt: 'next' }, execOf(parent))
  assert.equal(again.status, 'running', '队列解冻：复活轮收尾后新任务直接上岗（修复前只会永挂排队）')
})

// ── 人设档案负缓存（0.3.0-tisitan.7 N11）：失败不记账，下次现读重试 ──────────────
// broker 的读盘根是「本 preset 相邻的 prompts/」（安装态由 ensurePresetInstalled
// 后台拷贝生成）。仓库形态下该目录本就不存在——正可用来造「首读撞拷贝竞态失败、
// 随后档案补齐」的真实两段时序；旧实现在失败分支写 null，那条负缓存随模块作用
// 域钉死本进程所有挂载，儿童永久丢人设且无从自愈。

test('prompt 档案首读失败不入缓存：档案补齐后下一派即正确加载人设（N11）', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  const specs = []
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'preset', 'prompts')
  const probeType = `n11-probe-${process.pid}`
  const probeFile = join(promptsDir, `${probeType}.md`)
  const dirPreexisted = existsSync(promptsDir)
  const { ctx, listeners, dispatch, tools } = mockCtxFull({
    startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
  })
  await broker.apply(ctx, { queueRetryBaseMs: 5, bindings: { [probeType]: {} } })
  try {
    await tools.get('go_work').execute({ agent: probeType, prompt: 'first' }, execOf(parent))
    assert.equal('persona' in specs[0].request, false, '档案缺席：自定义角色不注入 persona（走无 persona 形态）')
    // 让首派完工腾槽（单线阻塞），再补档案派第二发
    dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [] })
    await drain()
    mkdirSync(promptsDir, { recursive: true })
    writeFileSync(probeFile, 'N11 探针人设原文', 'utf-8')
    await tools.get('go_work').execute({ agent: probeType, prompt: 'second' }, execOf(parent))
    assert.equal(specs[1].request.persona, 'N11 探针人设原文', '失败不入缓存：档案补齐后下一派即现读生效（修复前首读的 null 永久钉死）')
  } finally {
    await rm(probeFile, { force: true }).catch(() => {})
    if (!dirPreexisted) await rm(promptsDir, { recursive: true, force: true }).catch(() => {})
  }
  assert.equal(existsSync(promptsDir), dirPreexisted, '探针目录不残留在工作树')
})
