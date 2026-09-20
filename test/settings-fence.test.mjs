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
import * as host from '../lib/index.js'
import { rosterEntries, formatRosterRow, renderRosterBriefing } from '../preset/shared/roles.mjs'
import { createPanelRpcTransport } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-fence9-'))

const NO_INSTALL = { installPreset: false }
const bridgeKey = Symbol.for('dsh-my-go.snapshot')

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
    inject: panel.inject,
  }
  return { ctx, listeners, rpc: panel.rpc }
}

// settings 替身：revision 由 describe 供真源（对齐宿主 SettingsDescriptor），
// mutate 记录收到的全部实参，便于断言 expectedRevision 是否透传。
// described / stored 故意可分叉：宿主侧「describe 读到 r5、提交时已是 r7」这段
// TOCTOU 窗只能靠分叉复现（不分叉就永远走本半预检，映射分支永远测不到）。
function settingsMock({ stored = {}, revision = 0, mutateBehavior } = {}) {
  const calls = []
  let described = revision
  let stored_ = revision
  return {
    service: {
      register: () => ({}),
      get: () => stored,
      describe: () => [{ ns: 'other-ns', revision: 999 }, { ns: 'dsh-my-go', revision: described }],
      // 三参签名：让 hostTakesExpectedRevision() 探测为真（旧宿主是两参）
      mutate: async (ns, ops, expectedRevision) => {
        calls.push({ ns, ops, expectedRevision })
        if (expectedRevision !== undefined && expectedRevision !== stored_) {
          const error = new Error('namespace moved')
          error.code = 'SETTINGS_CONFLICT'
          error.name = 'SettingsConflictError'
          error.expected = expectedRevision
          error.actual = stored_
          throw error
        }
        if (mutateBehavior) mutateBehavior()
        stored_ += 1 // 宿主语义：一次提交推一格
        described = stored_
      },
    },
    calls,
    // 只推真实版本、不动 describe = 复现「预检通过但提交时已被他处抢先」
    moveStoreOnly: (next) => { stored_ = next },
    getRevision: () => stored_,
  }
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

// ── 0.5.0-tisitan.3 改判：设置面写通道整体迁宿主 settingsScope ──────────────
// 本半不再自造 revision（loadSettings / saveSettings / listModels 三个端点退役，
// 判据搬到 test/settings-ops.test.mjs 与 test/client-card.test.mjs）。此处只留
// 宿主半还剩的真东西：命名空间以 installSection 挂 composition base、老宿主回落、
// 活源热更驱动 bindings，以及「本半不再 mint 版本号」这条负向。

test('installSection 在册：行 config 的 settings 形状部分挂成 composition base', async () => {
  const calls = []
  const settings = {
    installSection: (_owner, ns, schema, entry, hooks) => {
      calls.push({ ns, entry, hasSchema: typeof schema === 'function', hooks: Object.keys(hooks ?? {}).sort() })
      hooks.setSource(() => ({ roles: { hermes: { provider: 'from-host', model: 'm' } } }))
      hooks.onChange(() => {})
    },
    get: () => undefined,
    mutate: async () => {},
  }
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, { installPreset: false, usagePrices: { 'a/b': { input: 1, output: 2 } } })
  assert.deepEqual(calls.map((c) => c.ns), ['dsh-my-go'], '命名空间经 installSection 注册一次')
  assert.deepEqual(calls[0].entry, { usagePrices: { 'a/b': { input: 1, output: 2 } } }, 'base = 行 config 的 settings 形状部分')
  assert.deepEqual(calls[0].hooks, ['onChange', 'setSource', 'validate'].filter((k) => k === 'onChange' || k === 'setSource'), 'hooks 只交 setSource/onChange（校验归页面）')
  assert.equal(calls[0].hasSchema, true, 'schema 是可调用的')
})

test('installSection 缺席的老宿主：回落 register(ns, schema, {base})，语义不退化', async () => {
  const calls = []
  const settings = {
    register: (ns, schema, options) => { calls.push({ ns, options }) },
    get: () => ({ roles: { hermes: { provider: 'p1', model: 'm1' } } }),
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, { installPreset: false, bindings: undefined })
  assert.equal(calls.length, 1, '老宿主仍注册命名空间（否则 WebUI 根本没有这一层）')
  assert.equal(calls[0].ns, 'dsh-my-go')
  assert.deepEqual(calls[0].options, { base: {} }, '行 config 无 settings 形状键时 base 为空对象')
  const snap = await rpc('/dsh-my-go', 'snapshot', {})
  assert.ok(snap.value.roster.some((entry) => entry.role === 'hermes' && entry.modelText?.includes('p1')), '回落路径的读面与 bindings 照常工作')
})

test('活源热更：installSection 的 onChange 驱动 bindings 重建（provider 被摘也不炸）', async () => {
  let notify = null
  let source = () => ({ roles: { hermes: { provider: 'p-a', model: 'm-a' } } })
  const settings = {
    installSection: (_owner, _ns, _schema, _entry, hooks) => {
      hooks.setSource(() => source())
      notify = hooks.onChange
    },
    get: () => undefined,
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const before = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((entry) => entry.role === 'hermes')
  assert.match(before.modelText, /p-a/, '初始读面来自活源')
  source = () => ({ roles: { hermes: { provider: 'p-b', model: 'm-b' } } })
  notify()
  const after = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((entry) => entry.role === 'hermes')
  assert.match(after.modelText, /p-b/, 'onChange 一次即重建 bindings')
  source = () => { throw new Error('provider detached') }
  assert.doesNotThrow(() => notify(), '读面抛错只留痕，绝不炸穿宿主回调')
  const kept = (await rpc('/dsh-my-go', 'snapshot', {})).value.roster.find((entry) => entry.role === 'hermes')
  assert.match(kept.modelText, /p-b/, '失败时保留上一份 bindings，名册仍可渲染')
})

test('本半不再自造版本号：revision 唯一真源是宿主 describe（两处真相必然漂移）', async () => {
  const hostSrc = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf-8'))
  assert.equal(hostSrc.includes('localRevision'), false, '进程内计数器不得复活')
  assert.equal(hostSrc.includes('function currentRevision'), false, '自造 revision 出口不得复活')
  assert.equal(hostSrc.includes('hostTakesExpectedRevision'), false, 'mutate arity 探测随围栏上移一起退役')
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
    const settings = settingsMock({ stored: { roles: FENCE_BINDINGS }, revision: 0 })
    const { ctx, rpc } = mockHostCtx({ settings: settings.service })
    await host.apply(ctx, NO_INSTALL)
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
