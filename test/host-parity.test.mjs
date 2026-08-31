// 反向 parity（tisitan.21 Wave 1）：lib 半编排面整体切除后的分界断言。
//   ① lib 源码零编排面标记（编排工具注册/状态机/台账/备选链/生命周期钩子
//      grep=0），broker 半（preset scope）全量保留——编排实现唯一归属 broker。
//   ② RPC/settings 契约：RPC 端点全家与 settings.register 为 lib 独有，
//      broker 只读不注册（Symbol.for 快照桥 broker 发布、lib 消费）。
//   ③ lib 存储/面板面行为批（settings schema/saveSettings/listTools/
//      getBuiltinPersona/loadSettings）原样保留。
//   ④ shared 面行为直测（分类器/归档取证/合并/迁移）不经 lib re-export，
//      直引 preset/shared/（shared 源文件未动）。
// 原「双半对称」断言全部改造为「lib=0 + broker=原计数」；lib 半编排行为用例
// 已删除——broker 侧等价覆盖见 bridge.test.mjs / roster-route.test.mjs。
// 本文件只 apply lib/index.js：每个测试进程独立运行，避免 Symbol.for 快照桥
// 被 broker 半覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as host from '../lib/index.js'
import * as brokerHalf from '../preset/tools/broker.mjs'
import * as sharedFailure from '../preset/shared/failure.mjs'
import * as sharedArchive from '../preset/shared/archive.mjs'
import * as sharedRoles from '../preset/shared/roles.mjs'
import * as sharedMisc from '../preset/shared/misc.mjs'

// 测试隔离：preset 同步（ensurePresetInstalled）与 getBuiltinPersona 读盘
// 走 DSH_HOME——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-host-home-'))

function mockHostCtx({ llm, settings, toolsRegistry } = {}) {
  const listeners = new Map()
  const rpcHandlers = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
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
  }
  return { ctx, listeners, rpc: (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload) }
}

const readBothHalves = () => Promise.all([
  readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
  readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
])
const countOf = (src, marker) => src.split(marker).length - 1

// ── ① 反向 parity 主断言：lib 零编排面 + broker 独有面保留 ────────────────

test('lib 半零编排面（反向 parity）：编排注册/状态机/台账/备选链/钩子标记 grep=0，broker 半全量保留', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const marker of [
    // 六个编排工具注册（编排实现唯一归属 broker 半）
    "name: 'go_work'",
    "name: 'continue'",
    "name: 'need_help'",
    "name: 'forward'",
    "name: 'orchestration_status'",
    "name: 'list_subagents'",
    // 派发与队列支撑闭包
    'async function dispatchWork(',
    'function advanceQueue(',
    'function scheduleQueueRetry(',
    'function orchFor(',
    'function orchOfChild(',
    'function findRecordEverywhere(',
    'function findHelpEverywhere(',
    // 编排状态全家
    'const orchestrations = new Map()',
    'const childOwner = new Map()',
    'const sessionTypes = new Map()',
    'const disposedTypes = new Map()',
    'const activeFallback = new Map()',
    'const pendingFallbackByLabel = new Map()',
    'function tombstoneType(',
    'function cancelDisposeFallback(',
    'function scheduleDisposeFallback(',
    'canOrchestrate',
    // 台账：lib 从此不读不写台账文件
    'async function loadLedger(',
    'function scheduleLedgerSave(',
    'async function findRecordWithLedgerFallback(',
    'orchestration-ledger.json',
    // 备选链与绑定执行面
    'async function pickFallbackEntry(',
    'async function attemptFallbackRedeploy(',
    'function finalizeEnd(',
    'function notifyParent(',
    'function resolveParentAgent(',
    'function readTurnFailure(',
    'async function modelExists(',
    'async function supportedEfforts(',
    'startContinuable',
    // 生命周期钩子
    "ctx.on('subagent/end'",
    "ctx.on('agent/request'",
    "ctx.on('agent/disposed'",
    "ctx.on('session/disposed'",
    // 编排人设加载链（getBuiltinPersona 磁盘直读，不依赖它）
    'const promptCache = new Map()',
    // Orchestration 状态机实例化（lib 连 import 都不再持有）
    'new Orchestration(',
    'shared/orchestration.mjs',
    'shared/failure.mjs',
    'shared/archive.mjs',
  ]) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(brokerSrc, marker) >= 1, `broker 半保留: ${marker}`)
  }
})

test('RPC/settings 契约：RPC 端点全家与 settings.register 为 lib 独有，broker 半只读', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  // lib 半：settings 注册面 + RPC 单通道全端点
  assert.equal(countOf(hostSrc, 'settingsScope = settings.register('), 1, 'lib 半注册 settings 命名空间')
  assert.equal(countOf(hostSrc, "rpc.handle('/dsh-my-go'"), 1, 'lib 半 RPC 单通道')
  for (const endpoint of ['snapshot', 'listModels', 'listTools', 'getBuiltinPersona', 'loadSettings', 'saveSettings']) {
    assert.equal(countOf(hostSrc, `endpoint === '${endpoint}'`), 1, `lib 半保留端点: ${endpoint}`)
  }
  assert.ok(countOf(hostSrc, "Symbol.for('dsh-my-go.snapshot')") >= 1, 'lib 半消费快照桥')
  // broker 半：只读 settings、零 RPC，快照桥唯一发布者
  assert.equal(countOf(brokerSrc, 'settingsScope = settings.register('), 0, 'broker 半不重复注册 settings（只读）')
  assert.equal(countOf(brokerSrc, 'rpc.handle('), 0, 'broker 半零 RPC 端点')
  assert.ok(countOf(brokerSrc, "globalThis[Symbol.for('dsh-my-go.snapshot')]") >= 1, 'broker 半发布快照桥')
})

test('host/broker 接线分界：typeOfAgent/养护闸/备选链/台账/persona 链全部 broker 独有（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const [marker, brokerExpected] of [
    ['const type = typeOfAgent(sessionTypes, agent)', 1],
    // currentMap 养护闸本体在 shared/orchestration.mjs（beginSpawning/revive 内
    // 各 1 处 this.enforceCurrentCap()），两半 apply 本就零直引，不入分界清单
    ['pruneLedgerParents(raw.parents)', 1],
    ['pruneLedgerParents(parents)', 1],
    ['const rolePersona = (type) => sharedRolePersona(bindings, promptCache, loadPrompt, type)', 1],
    ['const resolveRoleToolFilter = (type, filter) => sharedResolveRoleToolFilter(type, filter, liveToolNames())', 1],
    // 重派核心（原「双半对称」断言，改造为 broker 计数保留 + lib=0）
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
    // tisitan.16：activeFallback 写入/清理/消费点
    ['const activeFallback = new Map()', 1],
    ['activeFallback.set(newChildId, { provider: entry.provider, model: entry.model })', 1],
    ['activeFallback.delete(childId)', 3],
    ['activeFallback.delete(id)', 1],
    ['activeFallback.delete(evicted)', 1],
    // tisitan.17：fallbackEntry 入账与复活重建
    ['fallbackEntry: { provider: entry.provider, model: entry.model }', 1],
    ['activeFallback.set(record.childId, record.fallbackEntry)', 1],
    ['activeFallback.set(target, record.fallbackEntry)', 1],
    ["typeof record.fallbackEntry.provider === 'string'", 2],
    // tisitan.18：失败同步预告与终局通知
    ['备选评估中（', 1],
    ['无备选链，取证中', 1],
    ['不进入备选评估，取证中', 1],
    ['未读到附因（live 与档案均无失败原因）', 1],
    ['附因属中断类，不重派，按失败终局落账', 1],
    ['备选链尽，按失败终局落账', 1],
    ['无法重派（', 2], // console.warn 留痕 + 终局通知同口径
    ['按失败终局落账', 3],
    ['fallbackDecided.add(childId)', 1],
  ]) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), brokerExpected, `broker 半计数不变: ${marker}`)
  }
  // 名册键集薄壳是两半各自的共享接线（renderRosterLines/派发入口都吃它），不随切除
  assert.equal(countOf(hostSrc, 'const rosterKeys = () => sharedRosterKeys(bindings)'), 1, 'lib 半保留名册键集接线（RPC 花名册数据源）')
  assert.equal(countOf(brokerSrc, 'const rosterKeys = () => sharedRosterKeys(bindings)'), 1, 'broker 半接线不变')
  assert.equal(countOf(hostSrc, 'const agentType = typeOfAgent(sessionTypes, agent)'), 0, 'lib 半无 assemble 监听器（DSV4P0813 phase-1 为 broker 独有）')
  assert.equal(countOf(brokerSrc, 'const agentType = typeOfAgent(sessionTypes, agent)'), 1, 'broker assemble 消费点走 typeOfAgent')
  // 合并语义单一源：两半都无本地定义，只经 shared/misc.mjs 接线
  assert.equal(countOf(hostSrc, 'function resolveEffectiveBinding'), 0, 'lib 半无本地定义（且不再 import）')
  assert.equal(countOf(brokerSrc, 'function resolveEffectiveBinding'), 0, 'broker 半无本地定义')
  // 失败通知协议同步段零 await 契约：预告先于 attemptFallbackRedeploy 点火（broker 单边）
  assert.ok(brokerSrc.indexOf('备选评估中（') < brokerSrc.indexOf('void attemptFallbackRedeploy('), 'broker 半: 评估中预告先于 attemptFallbackRedeploy 点火')
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

test('shared 单一源：两半 import 行指向存在的文件，附因提取通路只在 broker/shared（源码断言）', async () => {
  const repoRoot = new URL('../', import.meta.url)
  const halves = [
    ['broker', 'preset/tools/', 'broker.mjs', '../shared/', 6],
    // tisitan.21 后 lib 只保留存储/面板面 shared 依赖（constants/roles/misc
    // 三行 import + 两行存储面 re-export = 5 行），下限放宽到 ≥3
    ['lib', 'lib/', 'index.js', '../preset/shared/', 3],
  ]
  for (const [name, dir, entry, sharedPrefix, minLines] of halves) {
    const src = await readFile(new URL(dir + entry, repoRoot), 'utf-8')
    const importLines = src.split('\n').filter((l) => l.includes(`from '${sharedPrefix}`))
    assert.ok(importLines.length >= minLines, `${name} 半应有 ≥${minLines} 行 shared import，实际 ${importLines.length}`)
    for (const line of importLines) {
      const m = /from '([^']+)'/.exec(line)
      assert.ok(m, `import 行含 from 子句: ${line.trim()}`)
      const target = fileURLToPath(new URL(m[1], new URL(dir, repoRoot)))
      assert.ok(existsSync(target), `${name} 半 import 目标存在: ${m[1]}`)
    }
  }
  // 消费通路（subagent/end 处理器内的附因归一）只在 broker apply 内；lib 已无编排面
  const [brokerSrc, hostSrc] = await readBothHalves()
  assert.equal(countOf(hostSrc, 'const failure = normalizeTurnFailure(ev.data.reason.error)'), 0, 'lib 半无附因提取通路（随编排面切除）')
  assert.equal(countOf(brokerSrc, 'const failure = normalizeTurnFailure(ev.data.reason.error)'), 1, 'broker 半 apply 内提取通路 1 处（另一处在 shared/archive.mjs）')
  const sharedArchiveSrc = await readFile(new URL('../preset/shared/archive.mjs', import.meta.url), 'utf-8')
  assert.equal(sharedArchiveSrc.split('const failure = normalizeTurnFailure(ev.data.reason.error)').length - 1, 1, 'shared archive.mjs 内提取通路 1 处')
})

// ── ①b 降级形态语义：snapshot 桥缺席 = preset 未装配 → 空态 + 花名册常驻 ──

test('snapshot RPC：preset 未装配（无桥）回落降级空态，桥在席读 broker 实况', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const hadBridge = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prevBridge = globalThis[bridgeKey]
  try {
    delete globalThis[bridgeKey]
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, {})
    // 无桥 = preset 未装配（lib-only 降级形态）：空态形状 + rosterLines 常驻
    const degraded = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(degraded.ok, true)
    assert.deepEqual({ seq: degraded.value.seq, parents: degraded.value.parents }, { seq: 0, parents: {} }, 'preset 未装配 → 降级空态 { seq: 0, parents: {} }')
    assert.ok(Array.isArray(degraded.value.rosterLines) && degraded.value.rosterLines.length > 1, '降级形态下 rosterLines 仍常驻')
    // 桥在席：RPC 直读 broker 发布的实时快照（零副本）
    const live = { seq: 7, parents: { 'p-1': { parentSessionId: 'p-1', current: null, queue: [], helpRequests: [], history: [] } } }
    globalThis[bridgeKey] = () => live
    const bridged = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(bridged.ok, true)
    assert.equal(bridged.value.seq, 7, '桥在席读 broker 实况而非空态')
    assert.ok(bridged.value.parents['p-1'], 'broker 分桶原样透出')
    assert.ok(Array.isArray(bridged.value.rosterLines), '桥在席时 rosterLines 同样附带')
  } finally {
    if (hadBridge) globalThis[bridgeKey] = prevBridge
    else delete globalThis[bridgeKey]
  }
})

// ── ② 存储/面板面行为批（tisitan.21 后 lib 半的全部行为面，原样保留）──────

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
  const [brokerSrc, hostSrc] = await readBothHalves()
  // 定义不再双写：两半源码里都没有函数体，只有 import + re-export
  assert.equal(countOf(hostSrc, 'function mergeRoleBindings'), 0, 'lib 半无本地定义（已迁 shared）')
  assert.equal(countOf(brokerSrc, 'function mergeRoleBindings'), 0, 'broker 半无本地定义（原内联块退役）')
  // 接线对称：初载 + settings/updated 各 1 处调用
  const call = 'bindings = mergeRoleBindings(baseBindings, '
  assert.equal(countOf(hostSrc, call), 2, 'lib 半接线 2 处')
  assert.equal(countOf(brokerSrc, call), 2, 'broker 半接线 2 处')
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

// ── ④ shared 行为面直测（不经 lib re-export，直引 preset/shared/）──────────

test('isFallbackable / normalizeTurnFailure 分类器语义（shared 直测，与 broker 半同源）', () => {
  const { isFallbackable, normalizeTurnFailure } = sharedFailure
  // 分类表核心行（broker 半全表见 bridge.test.mjs）
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

test('readArchivedTurnFailure 结构化返回 {message, code, status}（shared 直测）', async () => {
  const { mkdtempSync: mkTmp, mkdirSync, writeFileSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const { zstdCompressSync } = await import('node:zlib')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-host-norm-'))
  try {
    const line = (rec) => JSON.stringify(rec) + '\n'
    const dir = join(home, 'sessions', sharedArchive.projectKey(process.cwd()), 'hsess-norm')
    mkdirSync(dir, { recursive: true })
    const frame1 = zstdCompressSync(Buffer.from(line({ type: 'session/header', seq: 0, time: 0, data: { version: 1 } })))
    const frame2 = zstdCompressSync(Buffer.from(line({
      type: 'turn/end', seq: 1, time: 1,
      data: { turn: 1, reason: { kind: 'error', error: { message: 'provider 500: boom', code: 'SERVER', status: 500 } } },
    })))
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([frame1, frame2]))
    assert.deepEqual(
      sharedArchive.readArchivedTurnFailure('hsess-norm', { root: join(home, 'sessions'), cwd: process.cwd() }),
      { message: 'provider 500: boom', code: 'SERVER', status: 500 },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

// ── 附因取证 cwd 无关化（tisitan.16b）：默认路径未命中时按 childId 兜底搜索 ──
// shared/archive.mjs 纯机制用例（shared 未动，broker 侧无等价覆盖，必须保留）

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
    const projectA = sharedArchive.projectKey('D:\\real-workspace')
    await writeArchive(join(root, projectA, 'hsess-dead'), 'rate limited: 5h cap')
    // options.cwd 指向不存在的项目目录——模拟 dsh web 宿主 cwd 与工作区错配
    const result = sharedArchive.readArchivedTurnFailure('hsess-dead', { root, cwd: join(home, 'no-such-dir') })
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
    const oldFile = join(root, sharedArchive.projectKey('D:\\proj-old'), 'hsess-dup', 'session.jsonl.zstd')
    const newFile = join(root, sharedArchive.projectKey('D:\\proj-new'), 'hsess-dup', 'session.jsonl.zstd')
    await writeArchive(join(oldFile, '..'), 'old error from project A')
    await writeArchive(join(newFile, '..'), 'new error from project B')
    const now = new Date()
    utimesSync(oldFile, now, new Date(now.getTime() - 60000))
    utimesSync(newFile, now, now)
    const result = sharedArchive.readArchivedTurnFailure('hsess-dup', { root, cwd: join(home, 'no-such-dir') })
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
    mkdirSync(join(root, sharedArchive.projectKey('D:\\some-project')), { recursive: true })
    const result = sharedArchive.readArchivedTurnFailure('hsess-ghost', { root, cwd: join(home, 'no-such-dir') })
    assert.equal(result, undefined, '零命中静默退回无附因')
    assert.ok(warnings.some((l) => l.includes('持久化档案不可读')), '走原 warn 留痕路径')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('shared 行为面直测：失败分类 / 角色合并 / 迁移 ops / 工种识别 / 台账修剪（broker re-export 同一实例）', async () => {
  // broker 半 re-export 与 shared 模块是同一 ESM 绑定（单一实例，非复制）；
  // lib 半不再 re-export 编排面符号（tisitan.21），行为一律直测 shared
  assert.equal(brokerHalf.normalizeTurnFailure, sharedFailure.normalizeTurnFailure, 'broker re-export === shared')
  assert.equal(brokerHalf.isFallbackable, sharedFailure.isFallbackable)
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

test('shared 行为面：resolveEffectiveBinding 覆盖合并（broker re-export 同一实例）', () => {
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
