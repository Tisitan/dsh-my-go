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

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-fence9-'))

const NO_INSTALL = { installPreset: false }
const bridgeKey = Symbol.for('dsh-my-go.snapshot')

function mockHostCtx({ llm, settings, handleArity = 2 } = {}) {
  const listeners = new Map()
  const rpcHandlers = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, cb) => {
      const handle = handleArity === 3
        ? (channel, fn, options) => { rpcHandlers.set(channel, fn); rpcHandlers.set(`${channel}:options`, options) }
        : (channel, fn) => { rpcHandlers.set(channel, fn) }
      try {
        cb({ connection: { rpc: { handle } } })
      } catch { /* no connection in this deployment shape */ }
    },
  }
  const rpc = (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload)
  return { ctx, listeners, rpc }
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

// ── E6/A-03：读面下发凭据 ──────────────────────────────────────────────────

test('loadSettings 回带 revision：宿主 describe 在场时透其单调版本号', async () => {
  const settings = settingsMock({ stored: { roles: { hermes: { provider: 'p1', model: 'm1' } } }, revision: 7 })
  const { ctx, rpc } = mockHostCtx({ settings: settings.service })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'loadSettings', {})
  assert.equal(res.ok, true)
  assert.equal(res.value.revision, 7, 'revision 即宿主 describe 的 dsh-my-go 版本号')
  assert.deepEqual(res.value.hermes, { provider: 'p1', model: 'm1' }, '既有提升形状不受新键影响')
  assert.ok(!('revision' in res.value.roles), 'revision 只挂顶级，不渗进 roles 行')
})

test('loadSettings：宿主 describe 缺席时回落进程内计数器，settings/updated 每次推进一格', async () => {
  const legacyService = {
    register: () => ({}),
    get: () => ({ roles: {} }),
    mutate: async () => {},
  }
  const { ctx, listeners, rpc } = mockHostCtx({ settings: legacyService })
  await host.apply(ctx, NO_INSTALL)
  assert.equal((await rpc('/dsh-my-go', 'loadSettings', {})).value.revision, 0, '起点 0')
  listeners.get('settings/updated')('dsh-my-go')
  listeners.get('settings/updated')('dsh-my-go')
  listeners.get('settings/updated')('other-ns')
  assert.equal((await rpc('/dsh-my-go', 'loadSettings', {})).value.revision, 2, '只数本命名空间的变更，外部命名空间不算')
})

// ── E6/A-03：写面围栏 ──────────────────────────────────────────────────────

test('saveSettings：凭据过期就地拒绝，且一次写都不发（后写覆盖前写的老路被堵死）', async () => {
  const settings = settingsMock({ stored: { roles: {} }, revision: 5 })
  const { ctx, rpc } = mockHostCtx({ settings: settings.service })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', { revision: 3, hermes: { model: 'm-stale' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'conflict')
  assert.deepEqual(res.error.details, { expected: 3, actual: 5 }, 'details 带两侧版本号，前端能报「他处已改到 r5」')
  assert.equal(settings.calls.length, 0, '预检失败不得惊动存储')
})

test('saveSettings：凭据新鲜时把 expectedRevision 交给宿主执行，成功后回带新版本号', async () => {
  const settings = settingsMock({ stored: { roles: {} }, revision: 5 })
  const { ctx, rpc } = mockHostCtx({ settings: settings.service })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', { revision: 5, hermes: { model: 'm-new' } })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.value.revision, 6, '保存即推进版本：不 adopt 会让用户下一处保存自撞假冲突')
  assert.equal(settings.calls.at(-1).expectedRevision, 5, '围栏交给宿主在写队列内执行（检查与写入之间无 TOCTOU 窗）')
})

test('saveSettings：宿主自己抛 SettingsConflictError 也映射为 conflict（预检与提交间的竞态不逃逸）', async () => {
  const settings = settingsMock({ stored: { roles: {} }, revision: 5 })
  const { ctx, rpc } = mockHostCtx({ settings: settings.service })
  await host.apply(ctx, NO_INSTALL)
  settings.moveStoreOnly(9) // describe 仍报 r5，真实存储已走 r9：预检放行、宿主拒绝
  const res = await rpc('/dsh-my-go', 'saveSettings', { revision: 5, hermes: { model: 'x' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'conflict', '不能退化成 settings-rejected：前端要据此区分「该重新加载」与「配置本身有问题」')
  assert.deepEqual(res.error.details, { expected: 5, actual: 9 })
})

test('saveSettings：draft 不带 revision（旧前端 / 脚本直调）保持无条件写，也不塞假第三参', async () => {
  const settings = settingsMock({ stored: { roles: {} }, revision: 4 })
  const { ctx, rpc } = mockHostCtx({ settings: settings.service })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', { hermes: { model: 'm1' } })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(settings.calls.at(-1).expectedRevision, undefined, '缺凭据 = 不围栏，绝不发明 0 之类的假版本')
})

test('saveSettings：旧宿主 mutate 两参时不越签名传第三参', async () => {
  const calls = []
  const legacyService = {
    register: () => ({}),
    get: () => ({ roles: {} }),
    describe: () => [{ ns: 'dsh-my-go', revision: 2 }],
    async mutate(ns, ops) {
      // arguments.length 才是「调用方到底传了几参」的证据：多塞一枚 undefined
      // 对严格校验第三参的宿主就是越界实参，mock 的形参个数证明不了这件事
      calls.push({ ns, ops, received: arguments.length })
    },
  }
  const { ctx, rpc } = mockHostCtx({ settings: legacyService })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', { revision: 2, hermes: { model: 'm' } })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(calls.at(-1).received, 2, '探测结论是「旧宿主两参」时就该只发两参')
})

// ── A-06：listModels 并行 + 失败显式化 ─────────────────────────────────────

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('listModels：各渠道并行列举（串行 await 时 N 个渠道就是 N 倍首屏）', async () => {
  const gates = { p1: deferred(), p2: deferred(), p3: deferred() }
  const started = []
  const llm = {
    listProviders: async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    listModels: async (pid) => { started.push(pid); return gates[pid].promise },
  }
  const { ctx, rpc } = mockHostCtx({ llm })
  await host.apply(ctx, NO_INSTALL)
  const inflight = rpc('/dsh-my-go', 'listModels', {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(started.slice().sort(), ['p1', 'p2', 'p3'], '三个渠道在同一 tick 内全部发起')
  gates.p1.resolve([{ id: 'm1' }])
  gates.p2.resolve([{ id: 'm2' }])
  gates.p3.resolve([])
  const res = await inflight
  assert.deepEqual(res.value.models, { p1: ['m1'], p2: ['m2'], p3: [] })
  assert.deepEqual(res.value.errors, {}, '全部成功时 errors 是空字典（前端无须特判缺席）')
})

test('listModels：单渠道失败只脏自己——键不缺席、原因进 errors、他渠道照常', async () => {
  const llm = {
    listProviders: async () => [{ id: 'good' }, { id: 'bad' }],
    listModels: async (pid) => {
      if (pid === 'bad') throw new Error('HTTP_429 rate limited')
      return [{ id: 'm-ok' }]
    },
  }
  const { ctx, rpc } = mockHostCtx({ llm })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'listModels', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.models.bad, [], '失败渠道给空数组而非删键（旧写法的「键缺席」与「真的没模型」同形）')
  assert.match(res.value.errors.bad, /HTTP_429 rate limited/, '原因原样回报，供设置页行内提示')
  assert.deepEqual(res.value.models.good, ['m-ok'], '一个渠道炸不掉整页')
  assert.equal(res.value.errors.good, undefined)
})

test('listModels：llm 服务缺席仍是空清单形状，errors 一并给空字典', async () => {
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'listModels', {})
  assert.deepEqual(res.value, { providers: [], models: {}, errors: {} })
})

// ── A-05：结构化 roster 与三处同源 ─────────────────────────────────────────

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
  assert.equal(formatRosterRow(hermes), '- hermes | p1·m1 | 备选2 | 全量（除全局掩码） | 内置文件')
  const briefing = renderRosterBriefing(FENCE_BINDINGS)
  assert.ok(briefing.includes('hermes → p1·m1 → 备选链 2 条（p2·m2 → p3·m3）'), '简报读的是同一份 modelText/chain')
  assert.ok(briefing.includes('custom-x → ?·mx → 无备选链 → 工具: 仅 read；除 write → 人设: 自定义人设'), 'toolFilter 与人设摘要同样同源')
})

test('A-05 防御面：bindings 形状漂移（非数组 fallbacks / 脏 toolFilter）不炸渲染', () => {
  const entries = rosterEntries({ hermes: { fallbacks: 'nope', toolFilter: 'nope' }, 'odd-role': null })
  const hermes = entries.find((e) => e.role === 'hermes')
  assert.deepEqual(hermes.chain, [], '非数组 fallbacks 归空')
  assert.equal(hermes.toolFilterText, '全量（除全局掩码）')
  const odd = entries.find((e) => e.role === 'odd-role')
  assert.equal(odd.modelText, '跟随环境')
  assert.equal(odd.personaSource, '无（跟随环境）')
})
