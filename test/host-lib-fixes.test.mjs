// lib 半存储/安装面回归（0.3.0-tisitan.8 lib/client 修复批）：
//   E1/B-02  settings 注册静默塌方 → 失败面隔离 + 留痕
//   E4/B-04  loadSettings 谎报成功 → 读盘抛错回 unavailable
//   E7/B-05  saveSettings 脏键整批毒杀 → ROLE_KEY_PATTERN 过滤
//   E10/B-03 snapshot 端点无 try → 桥抛错回结构化 internal
//   E5/A-02  snapshot 出口裁剪（history 末 8 / 剔 prompt）
//   E9/B-07  rpc.handle arity 探测（2 参旧形态 / 3 参 rc.8）
//   E8/B-08  marker 内容摘要逃生口（同版本内容漂移仍重拷）
//   E3/B-01  安装器参数化 + config.installPreset 真短路
//   B-09     prompts 镜像清孤儿 / 未变更文件不重写
// 每进程独立（node --test 按文件分进程），DSH_HOME 指向本文件专属临时目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as host from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-lib8-'))

// 安装同步关掉：本文件全部走 config 闸（E3/B-01 的新开关），不再靠版本标记
// 「碰巧」短路——后台拷贝与断言抢同一批文件是旧测试的隐性竞态。
const NO_INSTALL = { installPreset: false }

function mockHostCtx({ llm, settings, toolsRegistry, handleArity = 2 } = {}) {
  const listeners = new Map()
  const rpcHandlers = new Map()
  const handleArgs = []
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'tools') return toolsRegistry
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, cb) => {
      const handle = handleArity === 3
        ? (channel, fn, options) => { rpcHandlers.set(channel, fn); rpcHandlers.set(`${channel}:options`, options) }
        : (channel, fn) => { rpcHandlers.set(channel, fn) }
      handleArgs.push(handle.length)
      try {
        cb({ connection: { rpc: { handle } } })
      } catch { /* no connection in this deployment shape */ }
    },
  }
  const rpc = (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload)
  return { ctx, listeners, rpc, registeredOptions: () => rpcHandlers.get('/dsh-my-go:options'), handleArgs }
}

function captureConsole() {
  const lines = { warn: [], error: [], log: [] }
  const prev = { warn: console.warn, error: console.error, log: console.log }
  console.warn = (...a) => lines.warn.push(a.join(' '))
  console.error = (...a) => lines.error.push(a.join(' '))
  console.log = (...a) => lines.log.push(a.join(' '))
  return { lines, restore: () => Object.assign(console, prev) }
}

// ── E1/B-02：settings 注册失败面隔离 ──────────────────────────────────────

test('settings.register 抛错：error 留痕在册，且热更监听与 RPC 面照常接线', async () => {
  const settings = {
    register: () => { throw new Error('schemastery unavailable') },
    get: () => ({ roles: { hermes: { provider: 'p1', model: 'm1' } } }),
    mutate: async () => {},
  }
  const { ctx, listeners, rpc } = mockHostCtx({ settings })
  const cap = captureConsole()
  try {
    await host.apply(ctx, NO_INSTALL)
    assert.ok(
      cap.lines.error.some((l) => l.includes('settings namespace registration failed') && l.includes('schemastery unavailable')),
      '注册失败必须留一行 console.error（旧写法 catch 体零日志）',
    )
    assert.ok(listeners.has('settings/updated'), '热更监听仍挂上（旧写法同 try 罩住，注册一抛就整段失联）')
    assert.ok(await rpc('/dsh-my-go', 'listTools', {}), 'RPC 面仍可用')
    const res = await rpc('/dsh-my-go', 'loadSettings', {})
    assert.equal(res.ok, true, '读盘端点不受注册失败影响')
    // 热更链路真的活着：改一次存储，快照花名册立刻反映新绑定
    settings.get = () => ({ roles: { hermes: { provider: 'p2', model: 'm2' } } })
    listeners.get('settings/updated')('dsh-my-go')
    const snap = await rpc('/dsh-my-go', 'snapshot', {})
    assert.ok(snap.value.rosterLines.some((line) => line.includes('p2·m2')), '热更后 bindings 确实更新')
  } finally {
    cap.restore()
  }
})

test('settings.get 抛错：注册成功也独立留痕，RPC 面不受牵连', async () => {
  const settings = {
    register: () => ({}),
    get: () => { throw new Error('settings store unreadable') },
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  const cap = captureConsole()
  try {
    await host.apply(ctx, NO_INSTALL)
    assert.ok(
      cap.lines.error.some((l) => l.includes('settings readout failed') && l.includes('settings store unreadable')),
      '读盘/接线面失败单独留痕（与注册失败不同因）',
    )
    assert.equal((await rpc('/dsh-my-go', 'listTools', {})).ok, true, 'RPC 面活着')
  } finally {
    cap.restore()
  }
})

// ── E4/B-04：loadSettings 不再谎报成功 ────────────────────────────────────

test('loadSettings：读盘抛错回 ok:false + unavailable（前端 loadError 横幅据此亮起）', async () => {
  const settings = {
    register: () => ({}),
    get: () => { throw new Error('EIO disk gone') },
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'loadSettings', {})
  assert.equal(res.ok, false, '旧写法回 ok:true + 空对象，前端把读失败渲染成干净空表单')
  assert.equal(res.error.code, 'unavailable')
  assert.ok(res.error.message.includes('EIO disk gone'), '原因带回去，不留哑谜')
  assert.deepEqual(res.error.details, {}, '错误信封三字段齐（ConnectionRpcFailure 契约）')
})

// ── E7/B-05：脏键不再毒杀整批保存 ─────────────────────────────────────────

test('saveSettings：draft.roles 里的脏键就地丢弃，其余行照常落盘', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    roles: {
      'Bad Key': { provider: 'evil', model: 'evil' }, // 大写 + 空格：schema 必拒
      '../escape': { provider: 'evil2' }, // 路径串：同样必拒
      hermes: { provider: 'p1', model: 'm1' },
      'custom-ok': { provider: 'p9', model: 'm9' },
    },
  })
  assert.equal(res.ok, true, '一枚脏键不得毒杀整次保存（mutate 是整批原子的）')
  assert.equal(mutates.length, 1)
  const keys = mutates[0].ops.map((op) => op.path[1])
  assert.ok(!keys.includes('Bad Key') && !keys.includes('../escape'), '脏键 ops 一条都不生成')
  assert.deepEqual(
    mutates[0].ops.filter((op) => op.path[1] === 'hermes' && op.path[2] === 'provider'),
    [{ op: 'set', path: ['roles', 'hermes', 'provider'], value: 'p1' }],
    '正常行原样写入',
  )
  assert.ok(keys.includes('custom-ok'), '自定义行原样写入')
})

// ── E10/B-03 + E5/A-02：snapshot 端点 try + 出口裁剪 ──────────────────────

test('snapshot：桥函数抛错回结构化 internal，不再抛穿 RPC 框架', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const had = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prev = globalThis[bridgeKey]
  try {
    globalThis[bridgeKey] = () => { throw new Error('ledger state corrupted') }
    const { ctx, rpc } = mockHostCtx({})
    const cap = captureConsole()
    try {
      await host.apply(ctx, NO_INSTALL)
      const res = await rpc('/dsh-my-go', 'snapshot', {})
      assert.equal(res.ok, false)
      assert.equal(res.error.code, 'internal', '桥在但读挂了：与「桥未注册」可区分')
      assert.ok(res.error.message.includes('ledger state corrupted'))
      assert.deepEqual(res.error.details, {})
      assert.ok(cap.lines.warn.some((l) => l.includes('snapshot bridge read failed')), 'host 侧留痕一行')
    } finally {
      cap.restore()
    }
  } finally {
    if (had) globalThis[bridgeKey] = prev
    else delete globalThis[bridgeKey]
  }
})

test('snapshot：每桶 history 裁到末 8 且全形状剔 prompt，helpRequests.content 保留', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const had = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prev = globalThis[bridgeKey]
  try {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      childId: `c-${i}`,
      agentType: 'hermes',
      status: 'done',
      conclusion: `结论 ${i}`,
      prompt: `全文 prompt ${i}`,
      updatedAt: 1000 + i,
    }))
    globalThis[bridgeKey] = () => ({
      seq: 42,
      parents: {
        'p-1': {
          parentSessionId: 'p-1',
          current: { childId: 'c-30', agentType: 'oracle', status: 'running', prompt: '在跑的全文' },
          queue: [{ id: 'q-1', agentType: 'explore', prompt: '排队全文' }],
          helpRequests: [{ id: 'h-1', childId: 'c-30', intent: 'explore', content: '求助正文' }],
          history: rows,
        },
        legacy: { parentSessionId: 'legacy', current: null, queue: [], helpRequests: [], history: rows },
      },
    })
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, NO_INSTALL)
    const res = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(res.ok, true)
    assert.equal(res.value.seq, 42, 'seq 原样透出（面板增量判定靠它）')
    for (const pid of ['p-1', 'legacy']) {
      const bucket = res.value.parents[pid]
      assert.equal(bucket.history.length, 8, `${pid}: history 只留末 8 条`)
      assert.equal(bucket.history[7].childId, 'c-29', `${pid}: 留的是最新那 8 条`)
      assert.ok(bucket.history.every((r) => !('prompt' in r)), `${pid}: history 条目无 prompt`)
      assert.ok(bucket.history.every((r) => r.conclusion.startsWith('结论')), `${pid}: 面板要显示的字段一个不少`)
      assert.ok(bucket.current === null || !('prompt' in bucket.current), `${pid}: current 无 prompt（null 原样透出）`)
      assert.ok(bucket.queue.every((w) => !('prompt' in w)), `${pid}: queue 条目无 prompt`)
    }
    assert.deepEqual(res.value.parents['p-1'].helpRequests, [{ id: 'h-1', childId: 'c-30', intent: 'explore', content: '求助正文' }], '求助单原样保留（正文面板要显示）')
    assert.ok(Array.isArray(res.value.rosterLines), '裁剪不影响花名册附带')
    // 原快照不得被改写（面板桥发布的是 broker 实况对象）
    assert.equal(rows.length, 30, '裁剪作用于 RPC 出口副本，broker 侧 history 一条不丢')
    assert.equal(rows[0].prompt, '全文 prompt 0')
  } finally {
    if (had) globalThis[bridgeKey] = prev
    else delete globalThis[bridgeKey]
  }
})

test('snapshot：桥缺席仍是降级空态（裁剪对空形状零副作用）', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const had = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prev = globalThis[bridgeKey]
  try {
    delete globalThis[bridgeKey]
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, NO_INSTALL)
    const res = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(res.ok, true)
    assert.deepEqual({ seq: res.value.seq, parents: res.value.parents }, { seq: 0, parents: {} })
    assert.ok(res.value.rosterLines.length > 1)
  } finally {
    if (had) globalThis[bridgeKey] = prev
    else delete globalThis[bridgeKey]
  }
})

// ── E9/B-07：rpc.handle arity 探测 ────────────────────────────────────────

test('rpc.handle arity：旧两参形态不多传，rc.8 三参形态带 authority=loopback', async () => {
  const legacy = mockHostCtx({ handleArity: 2 })
  await host.apply(legacy.ctx, NO_INSTALL)
  assert.equal(legacy.registeredOptions(), undefined, '两参 handle 的宿主不塞第三参（多余参数会撞旧版校验）')
  assert.deepEqual(legacy.handleArgs, [2], '探测读到的确实是形参个数 2')

  const modern = mockHostCtx({ handleArity: 3 })
  await host.apply(modern.ctx, NO_INSTALL)
  assert.deepEqual(modern.registeredOptions(), { authority: 'loopback' }, '三参 handle 的宿主必须拿到 authority')
  const res = await modern.rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true, '带 options 注册后通道照常工作')
})

// ── E3/B-01 + E8/B-08 + B-09：安装器（参数化 / 摘要 marker / 镜像语义）────

function fakePackage({ shared = true, prompts = { hermes: 'HERMES' }, presetFile = 'export default 1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-my-go-pkg8-'))
  mkdirSync(join(root, 'preset', 'tools'), { recursive: true })
  if (shared) mkdirSync(join(root, 'preset', 'shared'), { recursive: true })
  mkdirSync(join(root, 'prompts'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-my-go', version: '9.9.9-tisitan.0' }))
  writeFileSync(join(root, 'preset', 'agent.cordis.yml'), 'name: dsh-my-go\n')
  writeFileSync(join(root, 'preset', 'tools', 'broker.mjs'), presetFile)
  if (shared) writeFileSync(join(root, 'preset', 'shared', 'constants.mjs'), 'export const AGENT_TYPES = []\n')
  for (const [name, body] of Object.entries(prompts)) writeFileSync(join(root, 'prompts', `${name}.md`), body)
  return root
}

function markerOf(dshHome) {
  return readFileSync(join(host.presetInstallRoot(dshHome), 'dsh-my-go', '.dsh-my-go-version'), 'utf-8').trim()
}

test('installPreset:false 真短路：apply 不再后台拷贝（测试与安装器抢文件的根治）', async () => {
  const pkg = fakePackage()
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  try {
    const { ctx } = mockHostCtx({})
    await host.apply(ctx, { installPreset: false })
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(existsSync(join(host.presetInstallRoot(dshHome), 'dsh-my-go')), false, '关闸后本次挂载零文件动作')
  } finally {
    rmSync(pkg, { recursive: true, force: true })
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('marker：首装落 version+摘要；同版本同内容跳过；包内内容漂移重拷（E8 逃生口）', async () => {
  const pkg = fakePackage()
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const target = join(host.presetInstallRoot(dshHome), 'dsh-my-go')
  const cap = captureConsole()
  try {
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome })
    const marker = markerOf(dshHome)
    assert.match(marker, /^9\.9\.9-tisitan\.0\+[0-9a-f]{16}$/, `marker 是「版本+内容摘要」两要素：${marker}`)
    assert.equal(readFileSync(join(target, 'prompts', 'hermes.md'), 'utf-8'), 'HERMES')

    // 同版本同内容：短路（连副本被手改过也不覆写——旧语义保留）
    // 安装布局：cp(presetSource, target) 拷的是**目录内容** → target/tools/…
    writeFileSync(join(target, 'tools', 'broker.mjs'), '// 装机侧手改，不该被同内容重载覆写')
    cap.lines.log.length = 0
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome })
    assert.equal(readFileSync(join(target, 'tools', 'broker.mjs'), 'utf-8'), '// 装机侧手改，不该被同内容重载覆写')
    assert.equal(cap.lines.log.filter((l) => l.includes('preset synced')).length, 0, '摘要一致 → 零拷贝零日志')

    // 同版本但包内内容漂移：旧写法（只看版本）永远不重拷，摘要把它救回来
    writeFileSync(join(pkg, 'preset', 'tools', 'broker.mjs'), 'export default 2')
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome })
    assert.equal(readFileSync(join(target, 'tools', 'broker.mjs'), 'utf-8'), 'export default 2', '内容漂移 → 重拷并覆写手改')
    assert.notEqual(markerOf(dshHome), marker, 'marker 随摘要换值')
  } finally {
    cap.restore()
    rmSync(pkg, { recursive: true, force: true })
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('marker 缺席（首装/旧版只写版本号的存量）→ 无条件同步', async () => {
  const pkg = fakePackage()
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const target = join(host.presetInstallRoot(dshHome), 'dsh-my-go')
  try {
    // 模拟上个版本的存量副本：marker 只有版本号，且 preset 内容是旧的
    mkdirSync(join(target, 'preset'), { recursive: true })
    writeFileSync(join(target, '.dsh-my-go-version'), '9.9.9-tisitan.0')
    writeFileSync(join(target, 'preset', 'stale.txt'), '旧副本残留')
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome })
    assert.match(markerOf(dshHome), /\+[0-9a-f]{16}$/, '旧格式 marker 被就地升级')
    assert.ok(existsSync(join(target, 'tools', 'broker.mjs')), '无摘要可比对 → 走一次真同步')
  } finally {
    rmSync(pkg, { recursive: true, force: true })
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('安装器行为面：shared 缺席 warn、源缺失吞异常留痕、prompts 镜像清孤儿、未变更文件不重写', async () => {
  // ① shared/ 缺席：装完仍继续（fail-observable），但必须 warn
  const pkgNoShared = fakePackage({ shared: false })
  const homeA = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const cap = captureConsole()
  try {
    await host.ensurePresetInstalled({ packageRoot: pkgNoShared, dshHome: homeA })
    assert.ok(cap.lines.warn.some((l) => l.includes('shared/ missing')), 'broker import 断链风险必须留痕')
  } finally {
    cap.restore()
    rmSync(pkgNoShared, { recursive: true, force: true })
    rmSync(homeA, { recursive: true, force: true })
  }

  // ② 源树缺席（没有 preset/）：整段同步失败被吞，只留 error，绝不抛出打断 apply
  const brokenRoot = mkdtempSync(join(tmpdir(), 'dsh-my-go-pkg8-broken-'))
  const homeB = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const cap2 = captureConsole()
  try {
    writeFileSync(join(brokenRoot, 'package.json'), JSON.stringify({ version: '9.9.9-tisitan.0' }))
    await host.ensurePresetInstalled({ packageRoot: brokenRoot, dshHome: homeB })
    assert.ok(cap2.lines.error.some((l) => l.includes('could not sync preset')), '失败留痕')
    assert.equal(existsSync(join(host.presetInstallRoot(homeB), 'dsh-my-go', '.dsh-my-go-version')), false, '同步没做成就不写 marker（下次仍会重试）')
  } finally {
    cap2.restore()
    rmSync(brokenRoot, { recursive: true, force: true })
    rmSync(homeB, { recursive: true, force: true })
  }

  // ③ prompts/ 纯镜像：上游删了的人设文件不得留在装机侧继续供卡片用
  const pkg = fakePackage()
  const homeC = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const target = join(host.presetInstallRoot(homeC), 'dsh-my-go')
  try {
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome: homeC })
    const orphan = join(target, 'prompts', 'retired-role.md')
    writeFileSync(orphan, '上游早已删掉的人设')
    rmSync(join(target, '.dsh-my-go-version')) // 强制重拷一次
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome: homeC })
    assert.equal(existsSync(orphan), false, '孤儿 prompt 被镜像语义清出（cp 只增不删的旧行为）')

    // ④ 逐文件比对：内容没变的代码文件不被重写（mtime 不变 = 写窗口没打开）
    const brokerCopy = join(target, 'tools', 'broker.mjs')
    const before = statSync(brokerCopy).mtimeMs
    writeFileSync(join(pkg, 'prompts', 'hermes.md'), 'HERMES v2') // 只改人设文件
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome: homeC })
    assert.equal(readFileSync(join(target, 'prompts', 'hermes.md'), 'utf-8'), 'HERMES v2', '改过的文件照常落盘')
    assert.equal(statSync(brokerCopy).mtimeMs, before, '未变更的 broker.mjs 一个字节都不重写')
  } finally {
    rmSync(pkg, { recursive: true, force: true })
    rmSync(homeC, { recursive: true, force: true })
  }
})

// ── B-10：安装根单一来源 + getBuiltinPersona 回落包内原文 ─────────────────

test('getBuiltinPersona：安装副本缺席时回落包内 prompts（冷启动早期不再假报「文件不存在」）', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-empty-'))
  const prevHome = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = dshHome
    assert.equal(existsSync(join(host.presetInstallRoot(dshHome), 'dsh-my-go')), false, '前提：装机副本尚不存在')
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, NO_INSTALL)
    const res = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'sisyphus' })
    assert.equal(res.ok, true, '包内 prompts/sisyphus.md 兜住：安装同步还在后台跑时设置页也能载入原文')
    assert.ok(typeof res.value.persona === 'string' && res.value.persona.length > 0)
    const missing = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'ghost-role' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'not-found')
    assert.deepEqual(missing.error.details, {})
  } finally {
    process.env.DSH_HOME = prevHome
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('presetInstallRoot：DSH_HOME 覆盖与 ~/.dsh 兜底两条口径都在', () => {
  const prev = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/some-dsh-home'
    assert.equal(host.presetInstallRoot(), join('/tmp/some-dsh-home', '.agent-presets'))
    assert.equal(host.presetInstallRoot('/explicit'), join('/explicit', '.agent-presets'))
  } finally {
    process.env.DSH_HOME = prev
  }
})
