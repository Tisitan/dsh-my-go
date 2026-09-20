// lib 半存储/安装面回归（0.3.0-tisitan.8 lib/client 修复批）：
//   E1/B-02  settings 注册静默塌方 → 失败面隔离 + 留痕
//   E4/B-04  读面失败不许谎报成功 → 端点退役后改判为「旧设置面端点不再存在」
//   E7/B-05  脏键整批毒杀 → ROLE_KEY_PATTERN 过滤（ops 编译层已搬浏览器侧）
//   E10/B-03 snapshot 端点无 try → 桥抛错回结构化 internal
//   E5/A-02  snapshot 出口裁剪（history 末 8 / 剔 prompt）
//   E9/B-07  面板通道注册壳（原 rpc.handle arity 探测 → F1 换 webServer 直注册）
//   E8/B-08  marker 内容摘要逃生口（同版本内容漂移仍重拷）
//   E3/B-01  安装器参数化 + config.installPreset 真短路
//   B-09     prompts 镜像清孤儿 / 未变更文件不重写
// 每进程独立（node --test 按文件分进程），DSH_HOME 指向本文件专属临时目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as host from '../lib/index.js'
import { createPanelRpcTransport, callWebRouteHandler } from './helpers/mock-ctx.mjs'
import { buildSettingsOps } from '../src/settings-ops.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-lib8-'))

// 安装同步关掉：本文件全部走 config 闸（E3/B-01 的新开关），不再靠版本标记
// 「碰巧」短路——后台拷贝与断言抢同一批文件是旧测试的隐性竞态。
const NO_INSTALL = { installPreset: false }

function mockHostCtx({ llm, settings, toolsRegistry, rejection } = {}) {
  const listeners = new Map()
  const panel = createPanelRpcTransport({ rejection })
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'tools') return toolsRegistry
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: panel.inject,
  }
  return { ctx, listeners, panel, rpc: panel.rpc }
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
    assert.equal((await rpc('/dsh-my-go', 'snapshot', {})).ok, true, '面板端点不受注册失败影响')
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

// ── E4/B-04（改判）：旧设置面端点必须彻底不在 ─────────────────────────────

test('loadSettings / saveSettings / listModels 端点已退役：一律 bad-request（混合通道不许复活）', async () => {
  const settings = {
    register: () => ({}),
    get: () => ({ roles: { hermes: { provider: 'p1', model: 'm1' } } }),
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  for (const endpoint of ['loadSettings', 'saveSettings', 'listModels']) {
    const res = await rpc('/dsh-my-go', endpoint, { hermes: { model: 'x' } })
    assert.equal(res.ok, false, `${endpoint} 不再受理`)
    assert.equal(res.error.code, 'bad-request')
    assert.match(res.error.message, /unknown endpoint/, '拒绝口径是「不认识这个端点」，不是内部错')
  }
  assert.equal((await rpc('/dsh-my-go', 'snapshot', {})).ok, true, '面板端点照常（迁移没牵连非设置面）')
})

// ── E7/B-05：脏键不再毒杀整批保存（判据搬到 ops 编译层）────────────────────

test('写面：draft.roles 里的脏键就地丢弃，其余行照常落盘（E7/B-05 判据搬到 ops 编译层）', () => {
  const ops = buildSettingsOps({
    roles: {
      'Bad Key': { provider: 'evil', model: 'evil' }, // 大写 + 空格：schema 必拒
      '../escape': { provider: 'evil2' }, // 路径串：同样必拒
      hermes: { provider: 'p1', model: 'm1' },
      'custom-ok': { provider: 'p9', model: 'm9' },
    },
  }, { value: {}, user: {}, base: {} })
  const paths = JSON.stringify(ops.map((op) => op.path))
  assert.equal(paths.includes('Bad Key') || paths.includes('escape'), false, '脏键零 op（一枚脏键不毒杀整批原子写）')
  assert.ok(ops.some((op) => op.path[1] === 'hermes' && op.path[2] === 'provider' && op.value === 'p1'), '其余行照常落盘')
  assert.ok(ops.some((op) => op.path[1] === 'custom-ok' && op.path[2] === 'provider' && op.value === 'p9'), '自定义行照常')
})

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
      assert.ok((!Array.isArray(bucket.currentRecords)) || bucket.currentRecords.every((c) => c === null || !('prompt' in c)), `${pid}: currentRecords 条目无 prompt（非数组原样透出）`)
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

// ── E9/B-07 → F1：面板通道注册壳（webServer 直注册 + 手工信封）───────────────
// 0.1.5-alpha.1 的 connection.rpc.handle 在注册时读 owner.webServer 必抛（owner 被
// 钉死在 client-connection 自己的 apply fiber），通道从未挂上、面板 RPC 全量吃 405。
// 本半改为直接 webServer.register(prefix route)，并在 handler 内补回 rpc.handle 代做
// 的两件事。以下逐条钉的就是这两件事——替身走真 node:http 形状（req/res），鉴权直出、
// 信封封装、endpoint 解析都在壳里真跑，不再比宿主宽容。

test('F1 注册形态：connection + webServer 齐备时挂 prefix 路由，端点经完整 HTTP 壳往返', async () => {
  const { ctx, panel } = mockHostCtx({ toolsRegistry: { schemas: () => [{ name: 'read' }] } })
  await host.apply(ctx, NO_INSTALL)
  const route = panel.routes.get('prefix /dsh-my-go')
  assert.ok(route, 'webServer 上挂出一条 prefix /dsh-my-go 路由')
  assert.equal(route.kind, 'prefix')
  assert.equal(typeof route.handler, 'function')
  const { status, frame, result } = await panel.request({ endpoint: 'listTools', rpcId: 'abc-123', payload: {} })
  assert.equal(status, 200, '已认证请求走业务分发而非鉴权直出')
  assert.equal(frame.type, 'server-response', '响应是合法 server-response 帧')
  assert.equal(frame.rpcId, 'abc-123', 'rpcId 原样回显（浏览器侧 rpcId 不符即抛）')
  assert.deepEqual(result, { ok: true, value: ['read'] })
})

test('F1 鉴权直出：requestRejection 给 401/403 时绝不进业务分发（未认证不再 405）', async () => {
  for (const [rejection, body] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    const { ctx, panel } = mockHostCtx({ rejection })
    await host.apply(ctx, NO_INSTALL)
    const res = await panel.request({ endpoint: 'snapshot', payload: {} })
    assert.equal(res.status, rejection, `未认证请求直出 ${rejection}`)
    assert.equal(res.body, body)
    assert.equal(res.frame, undefined, '鉴权失败不回业务信封')
  }
})

test('F1 传输面：GET / 无 endpoint / 非 JSON content-type 各回 404 / 404 / 415', async () => {
  const { ctx, panel } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  assert.equal((await panel.request({ httpMethod: 'GET', endpoint: 'snapshot' })).status, 404)
  assert.equal((await panel.request({ url: '/dsh-my-go', endpoint: 'snapshot' })).status, 404, '裸通道路径不认领任何端点')
  assert.equal((await panel.request({ url: '/dsh-my-go/../etc', endpoint: 'snapshot' })).status, 404, '穿越形态的 pathname 解析不出 endpoint')
  const wrongType = await panel.request({ endpoint: 'snapshot', headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 415)
  assert.equal(wrongType.body, 'content type must be application/json')
})

test('F1 信封面：坏 JSON 400；缺字段/错 method 回 gateway/bad-request 合法帧；未知端点回 bad-request', async () => {
  const { ctx, panel } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  assert.equal((await panel.request({ endpoint: 'snapshot', body: 'not json' })).status, 400)
  const noId = await panel.request({ endpoint: 'snapshot', body: { type: 'client-request', method: 'snapshot' } })
  assert.equal(noId.status, 200, '信封不合法仍是 2xx + server-response（与宿主 rpcFetchHandler 同形）')
  assert.equal(noId.frame.type, 'server-response')
  assert.equal(noId.frame.rpcId, 'invalid-request', '读不到 rpcId 时用哨兵位')
  assert.equal(noId.frame.result.error.code, 'gateway/bad-request')
  assert.deepEqual(noId.frame.result.error.details, { issues: [] })
  const mismatch = await panel.request({ endpoint: 'snapshot', payload: {}, method: 'listTools' })
  assert.equal(mismatch.result.error.code, 'gateway/bad-request')
  assert.match(mismatch.result.error.message, /does not match endpoint/)
  const unknown = await panel.rpc('/dsh-my-go', 'nope', {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request', '未知端点由分发行兜住（本半原有语义不变）')
})

test('F1 分发抛穿：createPanelRpcHandler 把异常收口成 gateway/internal 合法帧而非裸 500', async () => {
  const warned = []
  const origWarn = console.warn
  console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
  try {
    const handler = host.createPanelRpcHandler({
      connection: { requestRejection: () => undefined },
      dispatch: async () => { throw new Error('dispatch exploded') },
    })
    const res = await callWebRouteHandler(handler, {
      url: '/dsh-my-go/boom',
      body: JSON.stringify({ type: 'client-request', rpcId: 'r-9', method: 'boom', payload: {} }),
    })
    assert.equal(res.status, 200, '宿主 rpcFetchHandler 在这里回裸 500（面板只能显示传输错），本壳回合法帧')
    assert.equal(res.frame.type, 'server-response')
    assert.equal(res.frame.rpcId, 'r-9')
    assert.equal(res.result.ok, false)
    assert.equal(res.result.error.code, 'gateway/internal')
    assert.match(res.result.error.message, /dispatch exploded/)
    assert.deepEqual(res.result.error.details, {}, '错误信封三字段齐备（浏览器 parseConnectionResponse 硬校验）')
    assert.ok(warned.some((l) => /panel endpoint boom threw.*dispatch exploded/.test(l)), '抛穿有 warn 留痕')
  } finally {
    console.warn = origWarn
  }
})

test('F1 体积闸：content-length 预检与流式超限都出 413 并断开请求', async () => {
  const handler = host.createPanelRpcHandler({
    connection: { requestRejection: () => undefined },
    dispatch: async () => ({ ok: true, value: 1 }),
    maxBodyBytes: 64,
  })
  const declared = await callWebRouteHandler(handler, {
    url: '/dsh-my-go/listTools',
    headers: { 'content-length': '9999' },
    body: '{}',
  })
  assert.equal(declared.status, 413)
  assert.equal(declared.headers.connection, 'close')
  assert.equal(declared.req.destroyed, true, '超限请求被主动断开（不给它继续喂体的机会）')
  const streamed = await callWebRouteHandler(handler, {
    url: '/dsh-my-go/listTools',
    body: 'x'.repeat(200),
  })
  assert.equal(streamed.status, 413, '没声明 content-length 时靠流式计量兜住')
})

test('F1 降级形态：无 webServer 服务时 warn 留痕并跳过注册，存储面照常挂载', async () => {
  const warned = []
  const origWarn = console.warn
  console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
  try {
    const panel = createPanelRpcTransport()
    const settings = { register: () => ({}), get: () => undefined, mutate: async () => {} }
    const ctx = {
      get: (name) => {
        if (name === 'settings') return settings
        if (name === 'connection') return panel.connection
        return undefined // headless / CLI profile：webServer 服务不存在
      },
      on: () => {},
      inject: (_deps, cb) => cb({ effect: (fn) => fn() }),
    }
    await host.apply(ctx, NO_INSTALL)
    assert.equal(panel.routes.size, 0, '零注册（不是抛错，也不是半挂）')
    assert.ok(warned.some((l) => /webServer service unavailable/.test(l)), '跳过必须留痕')
  } finally {
    console.warn = origWarn
  }
})

test('F1 断开兜底：请求体迭代抛穿（客户端中途断开）不得逃逸成 unhandledRejection', async () => {
  const warned = []
  const origWarn = console.warn
  console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
  try {
    const handler = host.createPanelRpcHandler({
      connection: { requestRejection: () => undefined },
      dispatch: async () => { throw new Error('分发绝不该被走到') },
    })
    const res = await callWebRouteHandler(handler, {
      url: '/dsh-my-go/snapshot',
      streamError: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    })
    assert.equal(res.status, 400, '断开请求收口成 400，而不是让 promise 逃逸')
    assert.ok(warned.some((l) => /panel channel request aborted.*read ECONNRESET/.test(l)), '断开留痕一行（带原始异常正文）')
    assert.ok(!warned.some((l) => /panel endpoint/.test(l)), '体都没读完，分发绝不启动')
  } finally {
    console.warn = origWarn
  }
})

test('F1 回归闸：宿主缺陷面 connection.rpc.handle 仍会抛，本半不得退回它', async () => {
  const panel = createPanelRpcTransport()
  assert.throws(() => panel.connection.rpc.handle('/dsh-my-go', () => {}), /without inject/)
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  assert.equal((await rpc('/dsh-my-go', 'listTools', {})).ok, true, '通道靠 webServer 直注册存活')
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
  // 5.3 波 J-2：tools/ 侧簇文件从哨兵同一清单（lib 导出单源）生成占位——
  // 哨兵加名夹具自动跟上了，两侧永不漂移；broker.mjs 上面的 presetFile 已写。
  for (const file of host.BROKER_CLUSTER_ROSTER) {
    if (file === 'broker.mjs') continue
    writeFileSync(join(root, 'preset', 'tools', file), `// ${file} fixture\n`)
  }
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

// 5.3 波 J-2：tools/ 侧在册核验——批次 5 拆分后 broker.mjs 的同目录 import 扇出
// 到清单里的簇模块，漏拷/半拷的故障点是会话组装期的挂载 import（当场炸且
// 安装器零留痕）。哨兵把失联提前到装机时 warn，且不阻断（与 shared/ 同款
// fail-observable 口径）。清单本体经 lib 导出单源消费（上方 fakePackage 同源）。
test('安装哨兵 tools/ 侧（J-2）：簇文件半拷 → warn 点名缺席者且不阻断；在册者零噪音', async () => {
  const pkg = fakePackage()
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-home8-'))
  const cap = captureConsole()
  try {
    rmSync(join(pkg, 'preset', 'tools', 'broker-tools.mjs')) // 模拟半拷（漏一个簇）
    await host.ensurePresetInstalled({ packageRoot: pkg, dshHome: home })
    const toolsWarns = cap.lines.warn.filter((l) => l.includes(' missing —'))
    assert.equal(toolsWarns.length, 1, `缺席者恰一行点名，实际 ${toolsWarns.length} 行`)
    assert.ok(toolsWarns[0].includes('tools/broker-tools.mjs missing'), 'warn 点名缺的是哪个文件')
    assert.match(markerOf(home), /\+[0-9a-f]{16}$/, 'warn 不阻断：marker 照常落盘（fail-observable 非 fail-fast）')
  } finally {
    cap.restore()
    rmSync(pkg, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('安装哨兵清单与 preset/tools/ 实况同源（J-2 防脱节）：清单外无 import 目标', async () => {
  // 清单是安装期核验的唯一依据，源码侧漏登记 = 新簇上线后哨兵失明——本例把
  // 「broker.mjs 的同目录 ./broker-*/./metrics import ⊆ 清单」钉成行为档，
  // 新簇加文件忘登记清单当场红（比装机哨兵本身更早一步）。
  const brokerSrc = readFileSync(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8')
  const imported = [...brokerSrc.matchAll(/from '\.\/([\w.-]+\.mjs)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(imported, [...host.BROKER_CLUSTER_ROSTER].filter((f) => f !== 'broker.mjs').sort(), 'broker 同目录 import 全集与哨兵清单逐名一致')
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

test('presetInstallRoot：DSH_HOME 空串视同未设，回落 ~/.dsh（paths.mjs dshHome 的 || 语义钉死）', () => {
  const prev = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = ''
    assert.equal(host.presetInstallRoot(), join(homedir(), '.dsh', '.agent-presets'),
      '空串走 || 兜底而非 ?? 直通——否则 join(\'\', ...) 解析出相对路径，读写分家')
  } finally {
    process.env.DSH_HOME = prev
  }
})
