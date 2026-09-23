// 设置页加固批（0.3.0-tisitan.9）lib 半回归：
//   E6/A-03   revision 围栏（读面下发凭据 / 写面预检 / 宿主 expectedRevision
//             透传 / SettingsConflictError 映射 / 保存后新凭据 / 无凭据兼容写）
//   A-06      listModels 并行拉取 + 逐渠道失败显式回报（errors 字典）
//   A-05      snapshot 结构化 roster + 三处消费面同源（lib 文本镜像、broker
//             编排状态花名册区、shared 系统提示简报共用同一份语义源）
// 每进程独立（node --test 按文件分进程），DSH_HOME 指向本文件专属临时目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import * as host from '../lib/index.js'
import { rosterEntries, formatRosterRow, renderRosterBriefing } from '../preset/shared/roles.mjs'
import { createPanelRpcTransport, createSettingsStub, resolvedHostConfig } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-fence9-'))

const bridgeKey = Symbol.for('dsh-my-go.snapshot')
const bindingsKey = Symbol.for('dsh-my-go.bindings')
const revisionKey = Symbol.for('dsh-my-go.bindings-revision')

function mockHostCtx({ llm, settings } = {}) {
  const listeners = new Map()
  const panel = createPanelRpcTransport()
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, cb) => cb({ settings: ctx.get('settings'), effect: (fn) => fn(), get: (n) => ctx.get(n) }),
    fiber: { id: 'dsh-my-go-fiber' },
  }
  return { ctx, listeners, rpc: panel.rpc }
}

function withBridge(replace) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prev = globalThis[bridgeKey]
  replace()
  return () => {
    if (had) globalThis[bridgeKey] = prev
    else delete globalThis[bridgeKey]
  }
}

// ── 0.1.7 改判：配置面改声明式（顶层 Config），settings 注册面整体退役 ────────
// 旧写法（installSection / register(ns, schema, {base}) 双姿态）在 0.1.7 已不存在：
// 插件顶层导出 `Config`，宿主据此生成官方插件页表单，把行 config 里 schema 认得的
// 那层挂成 composition base、用户层覆盖其上，并在 volatile 字段变更时就地换引用。
// 本半因此只剩四件事：关自动页、现读段、经桥把段交给 broker、热更时刷新。

test('Config 在册：四个顶层字段各自 volatile，且无嵌套 volatile（0.1.7 启动硬约束）', () => {
  const Config = host.Config
  assert.ok(Config !== undefined, 'lib 半必须顶层导出 Config（0.1.7 声明式配置面）')
  assert.deepEqual(Object.keys(Config.dict).sort(), ['roles', 'sisyphus', 'usageCurrency', 'usagePrices'])
  for (const key of Object.keys(Config.dict)) {
    assert.equal(Config.dict[key].meta.volatile, true, `${key} 必须标 volatile（不标则 WebUI 改完不生效）`)
  }
  // 嵌套 volatile 会在启动期以 "volatile fields require a fixed object path" 抛穿，
  // 故 dict 值 / 数组元素 / union 分支内部一律不得再标——这里把该约束走一遍。
  const walk = (schema, path, blocked = false) => {
    if (schema.meta?.volatile && blocked) throw new Error(`${path}: nested volatile`)
    const nowBlocked = blocked || Boolean(schema.meta?.volatile)
    for (const [key, child] of Object.entries(schema.dict ?? {})) walk(child, `${path}.${key}`, nowBlocked)
    if (schema.inner) walk(schema.inner, `${path}[]`, nowBlocked)
  }
  assert.doesNotThrow(() => walk(Config, 'Config'), 'volatile 只能落在顶层字段上')
})

test('关自动页：settings 服务经子 fiber 的 inject 取用，entry inject 不含 settings', async () => {
  const presentations = []
  const settings = createSettingsStub({ configure: (p, owner) => { presentations.push({ p, owner }); return () => {} } })
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, resolvedHostConfig({}))
  assert.deepEqual(presentations.map((c) => c.p), [{ auto: false }], '官方插件页是唯一编辑面，自动页必须关掉')
  assert.equal(presentations[0].owner, ctx.fiber, 'presentation 归本插件的 fiber')
  assert.ok(!host.inject.includes('settings'), '配置面改声明式后 settings 不该进 entry inject')
  assert.deepEqual(host.inject, ['tools'], 'inject 面收敛为 tools')
})

test('读面现读：行 config 的 roles 段直接进 snapshot.roster（base 由宿主挂，本半不再自算）', async () => {
  const { ctx, rpc } = mockHostCtx({ settings: createSettingsStub() })
  await host.apply(ctx, resolvedHostConfig({ roles: { hermes: { provider: 'from-row', model: 'm' } } }))
  const res = await rpc('/dsh-my-go', 'snapshot', {})
  const hermes = res.value.roster.find((entry) => entry.role === 'hermes')
  assert.match(hermes.modelText, /from-row/, '行 config 的 roles 段即读面来源')
})

test('热更：loader/volatile-update 刷新 bindings，并经桥把段与版本号交给 broker', async () => {
  const config = resolvedHostConfig({ roles: { hermes: { provider: 'p-a', model: 'm-a' } } })
  const { ctx, listeners, rpc } = mockHostCtx({ settings: createSettingsStub() })
  await host.apply(ctx, config)
  const before = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((e) => e.role === 'hermes')
  assert.match(before.modelText, /p-a/, '初始读面来自行 config')
  assert.equal(typeof globalThis[bindingsKey], 'function', '跨平面配置桥必须在册（broker 的唯一读面）')
  assert.equal(globalThis[bindingsKey]().roles.hermes.provider, 'p-a', '桥交出的是已解析的 settings 段')
  const revisionBefore = globalThis[revisionKey]()
  // 模拟宿主 volatile 提交：loader 用 cosmokit 的 updateVolatile 就地换掉字段引用，
  // 值真变了才发事件（与 dsh-app-boot 的 _commitVolatile 同一枚调用）。
  updateVolatile(config.roles, resolvedHostConfig({ roles: { hermes: { provider: 'p-b', model: 'm-b' } } }).roles)
  listeners.get('loader/volatile-update')([['roles']])
  const after = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((e) => e.role === 'hermes')
  assert.match(after.modelText, /p-b/, '热更一次即重建 bindings')
  assert.equal(globalThis[bindingsKey]().roles.hermes.provider, 'p-b', '桥现读，桥的另一侧自动跟上')
  assert.equal(globalThis[revisionKey](), revisionBefore + 1, '段版本号随 volatile 提交自增（broker 缓存失效的信号）')
})

test('读面降级：段访问器抛错只留痕并回落基线，绝不炸穿宿主回调', async () => {
  // 访问器对象是冻结的（宿主侧引用），故这里自建一枚可切换的访问器壳：初读正常，
  // 热更时抛错——复现「settings provider 被摘」那条路径。
  const base = resolvedHostConfig({ roles: { hermes: { provider: 'p-a', model: 'm-a' } } })
  let detached = false
  const config = {
    ...base,
    roles: { get: () => { if (detached) throw new Error('provider detached'); return base.roles.get() } },
  }
  const { ctx, listeners, rpc } = mockHostCtx({ settings: createSettingsStub() })
  await host.apply(ctx, config)
  detached = true
  const errors = []
  const origError = console.error
  console.error = (...a) => { errors.push(a.map(String).join(' ')) }
  try {
    assert.doesNotThrow(() => listeners.get('loader/volatile-update')([['roles']]), '读面抛错不炸宿主回调')
  } finally {
    console.error = origError
  }
  assert.ok(errors.some((l) => l.includes('settings readout failed')), '失败必须留痕（静默降级是违禁）')
  const kept = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((e) => e.role === 'hermes')
  assert.match(kept.modelText, /p-a/, '失败时保留上一份 bindings，名册仍可渲染')
})

test('负向：settings 注册面与旧命名空间通道零残留（单模式 0.1.7，不留双姿态）', async () => {
  const hostSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf-8'))
  // 只钉**调用形态**：说明性注释里出现旧名字（对比旧设计）是允许的。
  for (const retired of ["installSection", "settings.register(", "ctx.on('settings/updated'", "compositionBase(", "ensurePresetInstalled(", "settingsScope", "settings.get("]) {
    assert.equal(hostSrc.includes(retired), false, `退役面不得复活：${retired}`)
  }
  assert.equal(hostSrc.includes('loader/volatile-update'), true, '热更走 0.1.7 事件')
  assert.equal(hostSrc.includes("Symbol.for('dsh-my-go.bindings')"), true, '跨平面配置桥在册')
})

// ── A-06 改判：模型目录来自宿主官方面，逐渠道失败显式化的形状锁在客户端 ──────

test('目录装配：groups/failures → providers/models/errors，失败渠道键不缺席', async () => {
  const { createCatalogStore } = await import('../src/client.js')
  const remote = {
    session: {
      modelCatalog: async () => ({
        ok: true,
        value: {
          routableProviders: ['deepseek', 'minimax'],
          groups: [
            { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] },
          ],
          failures: [{ id: 'minimax', name: 'MiniMax', message: 'HTTP_401 unauthorized' }],
        },
      }),
    },
  }
  const store = createCatalogStore(remote)
  let ticks = 0
  const off = store.subscribe(() => { ticks += 1 })
  await store.load()
  const state = store.get()
  assert.equal(state.status, 'ready')
  assert.deepEqual(state.providers, ['deepseek', 'minimax'], 'routableProviders 为准：读失败的渠道仍在')
  assert.deepEqual(state.models.deepseek, ['deepseek-chat', 'deepseek-reasoner'])
  assert.deepEqual(state.models.minimax, [], '失败渠道的键不缺席（与「该渠道真没模型」区分的前提）')
  assert.equal(state.errors.minimax, 'HTTP_401 unauthorized', '缺席一律进 errors，前端按渠道行内提示')
  assert.ok(ticks >= 2, 'loading → ready 各广播一次')
  off()
})

test('目录装配：并发只认最后一次、缺席服务回 error、load 幂等而 invalidate 重拉', async () => {
  const { createCatalogStore } = await import('../src/client.js')
  const answers = ['stale', 'fresh']
  const resolvers = []
  const slow = {
    session: {
      modelCatalog: () => new Promise((resolve) => {
        const id = answers.shift() ?? 'fresh'
        resolvers.push(() => resolve({ ok: true, value: { routableProviders: [id], groups: [], failures: [] } }))
      }),
    },
  }
  const store = createCatalogStore(slow)
  const first = store.load()
  const second = store.invalidate()
  for (const settle of resolvers.splice(0)) settle()
  await Promise.all([first, second])
  assert.deepEqual(store.get().providers, ['fresh'], '慢回来的旧响应不得覆盖新代次')
  const absent = createCatalogStore({})
  await absent.load()
  assert.equal(absent.get().status, 'error', '宿主没给 modelCatalog 就是失败，不许假装空清单是「没配模型」')
  let calls = 0
  const counted = createCatalogStore({ session: { modelCatalog: async () => { calls += 1; return { ok: true, value: { groups: [], failures: [], routableProviders: [] } } } } })
  await counted.load()
  await counted.load()
  assert.equal(calls, 1, 'load 幂等（每次挂载都重拉会让下拉清单抖动）')
  await counted.invalidate()
  assert.equal(calls, 2, 'invalidate 才真重拉')
  counted.reset()
  await counted.load()
  assert.equal(calls, 3, '连接重代后 reset 让下一次挂载重新拉')
})

test('目录装配：宿主回 ok:false 也是 error，不静默清空', async () => {
  const { createCatalogStore } = await import('../src/client.js')
  const store = createCatalogStore({ session: { modelCatalog: async () => ({ ok: false, error: { code: 'unavailable' } }) } })
  await store.load()
  assert.equal(store.get().status, 'error')
})

// ── A-05：结构化名册（不变）───────────────────────────────────────────────

const FENCE_BINDINGS = {
  hermes: { provider: 'p1', model: 'm1', fallbacks: [{ provider: 'p2', model: 'm2' }, { provider: 'p3', model: 'm3' }] },
  'custom-x': { model: 'mx', persona: '自定义人设正文', toolFilter: { allow: ['read'], deny: ['write'] } },
}

test('snapshot.roster：结构化字段齐备，表头/计数不再由 host 代劳', async () => {
  const restore = withBridge(() => { globalThis[bridgeKey] = () => ({ seq: 1, parents: {} }) })
  try {
    const { ctx, rpc } = mockHostCtx({ settings: createSettingsStub() })
    await host.apply(ctx, resolvedHostConfig({ roles: FENCE_BINDINGS }))
    const res = await rpc('/dsh-my-go', 'snapshot', {})
    const byRole = Object.fromEntries(res.value.roster.map((e) => [e.role, e]))
    assert.equal(byRole.hermes.modelText, 'p1·m1')
    assert.equal(byRole.hermes.builtin, true)
    assert.deepEqual(byRole.hermes.chain, [{ provider: 'p2', model: 'm2' }, { provider: 'p3', model: 'm3' }], '备选链原样结构化（面板要行数也要明细）')
    assert.equal(byRole['custom-x'].builtin, false, '自定义角色可辨识（面板据此挂「自定义」徽章）')
    assert.equal(byRole['custom-x'].modelText, '?·mx')
    assert.equal(byRole['custom-x'].toolFilterText, '仅 read；除 write')
    assert.equal(byRole['custom-x'].personaSource, '自定义人设')
    assert.ok(!('persona' in byRole['custom-x']), '人设正文不进快照（面板只显示来源）')
    assert.ok(!('sisyphus' in byRole), '编排者单例不入可派花名册')
    assert.equal(res.value.rosterLines.length, res.value.roster.length + 1, 'deprecated 文本镜像与结构化同源（多出的正是表头行）')
  } finally {
    restore()
  }
})

test('A-05 同源锁：同一 bindings 下 lib 文本镜像、shared 简报、结构化条目三者语义一致', () => {
  const entries = rosterEntries(FENCE_BINDINGS)
  const hermes = entries.find((e) => e.role === 'hermes')
  assert.equal(formatRosterRow(hermes), '- hermes | p1·m1 | 备选2 | 全量 | 内置文件')
  const briefing = renderRosterBriefing(FENCE_BINDINGS)
  assert.ok(briefing.includes('hermes → p1·m1 → 备选链 2 条（p2·m2 → p3·m3）'), '简报读的是同一份 modelText/chain')
  assert.ok(briefing.includes('custom-x → ?·mx → 无备选链 → 工具: 仅 read；除 write → 人设: 自定义人设'), 'toolFilter 与人设摘要同样同源')
})

test('A-05 防御面：bindings 形状漂移（非数组 fallbacks / 脏 toolFilter）不炸渲染', () => {
  const entries = rosterEntries({ hermes: { fallbacks: 'nope', toolFilter: 'nope' }, 'odd-role': null })
  const hermes = entries.find((e) => e.role === 'hermes')
  assert.deepEqual(hermes.chain, [], '非数组 fallbacks 归空')
  assert.equal(hermes.toolFilterText, '全量')
  const odd = entries.find((e) => e.role === 'odd-role')
  assert.equal(odd.modelText, '跟随环境')
  assert.equal(odd.personaSource, '无（跟随环境）')
})
