// 用量聚合引擎单测（0.4.0 用量统计契约步骤 4/7，docs/usage-stats-design.md
// D2 游标缓存 / D3 RPC 契约 / D5 降级矩阵）。lib/usage-aggregator.mjs 纯依赖
// 注入，档案路径复用真实多帧 zstd fixture（落盘形状与 test/bridge.test.mjs
// 的 writeArchiveFixture 一致：每元素一帧，帧内逐行 JSONL）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { projectKey, readArchivedUsage } from '../preset/shared/archive.mjs'
import { createUsageAggregator } from '../lib/usage-aggregator.mjs'
import { apply as hostApply } from '../lib/index.js'
import { removeHomeWithRetry, createPanelRpcTransport } from './helpers/mock-ctx.mjs'

const ALL_NULL_BUCKETS = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }

// 事件形状与 dsh-session 落盘一致：{type, seq, time, data}；request/header 的
// config 在 data.header.config（EpochHeader 包装，先例 scripts/dump-session.mjs:36）。
const header = (seq, provider, model) => ({
  type: 'request/header',
  seq,
  time: seq,
  data: { header: { config: { provider, model } }, reason: 'initial' },
})
const msg = (seq, usage) => ({
  type: 'assistant/message',
  seq,
  time: seq,
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, ...(usage === undefined ? {} : { usage }) },
})

// live store 替身：只实现 snapshotEvents(fromSeq)（inclusive，index.d.ts:184）。
const liveOf = (events) => ({ snapshotEvents: (fromSeq) => events.filter((e) => e.seq >= fromSeq) })

function writeArchiveFixture(root, childId, frames) {
  const dir = join(root, projectKey(process.cwd()), childId)
  mkdirSync(dir, { recursive: true })
  const container = frames.map((lines) => zstdCompressSync(Buffer.from(lines.map((rec) => JSON.stringify(rec) + '\n').join(''))))
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat(container))
}

function makeDeps({ ledger = {}, sessions, subagents, runningChildren, prices, readArchive, now } = {}) {
  return {
    getSessions: () => sessions,
    getSubagents: () => subagents,
    listRunningChildren: runningChildren,
    loadLedger: async () => ({ version: 3, parents: ledger }),
    getUsagePrices: prices,
    // 未显式注入时的默认：空完整档案——live miss 的 self 流（D6）安静短路，
    // 不触真实 FS；显式注入的替身保留各自计数/哨兵语义。
    readArchive: readArchive ?? (() => ({ events: [], complete: true })),
    now,
  }
}

// ── live 增量路径（D2 快路径）─────────────────────────────────────────────────

test('live 增量路径：游标自 lastSeq+1 续读，running 子代轮询零档案解压', async () => {
  const events = [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 10, outputTokens: 5 }), msg(2, { inputTokens: 7, outputTokens: 2, cacheReadTokens: 3 })]
  const fromLog = []
  const sessions = new Map([['c1', { snapshotEvents: (fromSeq) => { fromLog.push(fromSeq); return events.filter((e) => e.seq >= fromSeq) } }]])
  let archiveCalls = 0
  const agg = createUsageAggregator(makeDeps({
    ledger: { p1: [] },
    sessions,
    runningChildren: () => [{ childId: 'c1', agentType: 'hermes' }],
    readArchive: (childId) => { if (childId !== 'c1') return { events: [], complete: true }; archiveCalls += 1; throw new Error('live-resident child must not touch the archive') },
  }))

  const r1 = await agg.getUsage('p1')
  assert.equal(r1.found, true, 'running 子代在场即 found（台账桶空数组也在场）')
  const child1 = r1.children[0]
  assert.equal(child1.childId, 'c1')
  assert.equal(child1.agentType, 'hermes', 'childOwner/sessionTypes 补源给出工种')
  assert.equal(child1.status, 'running')
  assert.equal(child1.frozen, false)
  assert.deepEqual(child1.totals, { inputTokens: 17, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: null })
  assert.equal(child1.segments.length, 1)
  assert.equal(child1.segments[0].messageCount, 2)
  assert.equal(child1.messageCount, 2)
  assert.deepEqual(fromLog, [0], '首轮从 seq 0 起全量读')

  events.push(msg(3, { inputTokens: 1, outputTokens: 1 }))
  const r2 = await agg.getUsage('p1')
  assert.deepEqual(r2.children[0].totals, { inputTokens: 18, outputTokens: 8, cacheReadTokens: 3, cacheWriteTokens: null }, '增量帧只消费一次（lastSeq 单调，不重不漏）')
  assert.equal(r2.children[0].messageCount, 3)
  assert.deepEqual(fromLog, [0, 3], '增量轮询从 lastSeq+1 起读，不做全量快照')
  assert.equal(archiveCalls, 0, 'live 在场绝不触发档案解压（30 子代轮询可承受的根据）')
})

// ── 档案主路径（F5，真实多帧 zstd fixture）────────────────────────────────────

test('档案主路径：多帧 zstd 一次全量扫即冻结（R3），冻结后轮询零 IO', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-usage-arch-'))
  const root = join(home, 'sessions')
  writeArchiveFixture(root, 'c2', [
    [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 100, outputTokens: 10 }), header(2, 'prov-b', 'm2'), msg(3, { inputTokens: 4, outputTokens: 40 })],
    [msg(4, { inputTokens: 6, outputTokens: 1, cacheWriteTokens: 9 }), { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'stop' } } }],
  ])
  let archiveCalls = 0
  const agg = createUsageAggregator(makeDeps({
    ledger: { p1: [{ childId: 'c2', agentType: 'hermes', status: 'done' }] },
    readArchive: (childId, fromSeq) => { if (childId !== 'c2') return { events: [], complete: true }; archiveCalls += 1; return readArchivedUsage(childId, fromSeq, { root, cwd: process.cwd() }) },
  }))
  try {
    const r1 = await agg.getUsage('p1')
    const child = r1.children[0]
    assert.equal(archiveCalls, 1)
    assert.equal(child.frozen, true, '台账终态 → 全量扫一次后冻结')
    assert.equal(child.agentType, 'hermes')
    assert.equal(child.status, 'done')
    assert.deepEqual(child.totals, { inputTokens: 110, outputTokens: 51, cacheReadTokens: null, cacheWriteTokens: 9 }, '跨帧跨模型累计，未上报桶保持 null')
    assert.deepEqual(child.segments.map((s) => [s.provider, s.model, s.messageCount]), [['prov-a', 'm1', 1], ['prov-b', 'm2', 2]])

    const r2 = await agg.getUsage('p1')
    assert.equal(archiveCalls, 1, '冻结后轮询零 IO（D2 R3）')
    assert.equal(r2.children[0].frozen, true)
    assert.deepEqual(r2.children[0].totals, child.totals)
  } finally {
    await removeHomeWithRetry(home)
  }
})

// ── 边界三例（D5）─────────────────────────────────────────────────────────────

test('缺桶（Z1）：缺席桶为 null 绝不补 0，partial 沿段→totals→byModel 逐级 OR', async () => {
  const sessions = new Map([['c1', liveOf([header(0, 'p', 'm'), msg(1, { inputTokens: 5 })])]])
  const agg = createUsageAggregator(makeDeps({ ledger: { p1: [] }, sessions, runningChildren: () => [{ childId: 'c1', agentType: 'explore' }] }))
  const r = await agg.getUsage('p1')
  const seg = r.children[0].segments[0]
  assert.deepEqual(seg.buckets, { inputTokens: 5, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }, '输出不得含伪造 0')
  assert.equal(seg.partial, true)
  assert.equal(r.children[0].partial, true)
  assert.deepEqual(r.children[0].totals, { inputTokens: 5, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })
  assert.equal(r.byModel[0].partial, true)
  assert.deepEqual(r.totals, { inputTokens: 5, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })
})

test('重绑双模型分段（Z16）：同 childId 备选重绑切段独立累计，byModel 按首次出现序', async () => {
  const events = [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 10, outputTokens: 2 }), header(2, 'prov-b', 'm2'), msg(3, { inputTokens: 4, outputTokens: 8 }), msg(4, { outputTokens: 1 })]
  const sessions = new Map([['c1', liveOf(events)]])
  const agg = createUsageAggregator(makeDeps({ ledger: { p1: [] }, sessions, runningChildren: () => [{ childId: 'c1', agentType: 'hermes' }] }))
  const r = await agg.getUsage('p1')
  const child = r.children[0]
  assert.deepEqual(child.segments.map((s) => s.model), ['m1', 'm2'], 'request/header 切段，禁止 child 级单模型假设')
  assert.deepEqual(child.segments[1].buckets, { inputTokens: 4, outputTokens: 9, cacheReadTokens: null, cacheWriteTokens: null })
  assert.deepEqual(r.byModel.map((row) => row.model), ['m1', 'm2'])
  assert.deepEqual(r.totals, { inputTokens: 14, outputTokens: 11, cacheReadTokens: null, cacheWriteTokens: null })
})

test('unknown 归因（Z5/Z14）：header 前的 usage 落 unknown 段且 byModel 恒沉底；config 半缺独立判空；childCount 跨子代计数', async () => {
  const c1 = [msg(0, { inputTokens: 3, outputTokens: 1 }), header(1, 'prov-a', 'm1'), msg(2, { inputTokens: 10, outputTokens: 2 })]
  const c2 = [header(0, 'prov-x'), msg(1, { inputTokens: 1, outputTokens: 1 }), header(2, 'prov-a', 'm1'), msg(3, { inputTokens: 5, outputTokens: 5 })]
  const sessions = new Map([['c1', liveOf(c1)], ['c2', liveOf(c2)]])
  const agg = createUsageAggregator(makeDeps({ ledger: { p1: [] }, sessions, runningChildren: () => [{ childId: 'c1', agentType: 'hermes' }, { childId: 'c2', agentType: 'explore' }] }))
  const r = await agg.getUsage('p1')
  assert.deepEqual(r.children[0].segments[0], {
    provider: null, model: null, messageCount: 1,
    buckets: { inputTokens: 3, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null },
    partial: true,
  }, '无 header 的 usage 落 unknown 段；该帧缺 cache 两桶 → 段级 partial（D2 reducer）')
  assert.equal(r.children[1].segments[0].provider, 'prov-x')
  assert.equal(r.children[1].segments[0].model, null, 'header.config 缺 model → model=null（provider 不受牵连）')
  assert.deepEqual(r.byModel.map((row) => [row.provider, row.model]), [['prov-a', 'm1'], ['prov-x', null], [null, null]], 'unknown 段恒排末尾，其余按首次出现序')
  assert.equal(r.byModel[0].childCount, 2, '同 {provider,model} 跨子代归并计数（Z14）')
  assert.deepEqual(r.byModel[0].buckets, { inputTokens: 15, outputTokens: 7, cacheReadTokens: null, cacheWriteTokens: null })
  assert.equal(r.byModel[2].price, null, 'unknown 段无法成键，price=null')
})

// ── 复活解冻（D2 R4 / Z12）───────────────────────────────────────────────────

test('end 后增量已尽：档案扫描零新增即冻结（idle-freeze），台账行在场不抛错', async () => {
  // 真实时序：最后一条 live 轮询已消费全部事件 → end（persist 先于 live 摘除
  // 落全）→ 首个 post-end 轮询档案扫描 consumed===0 且台账行已落 —— 必须安静
  // 冻结，而不是在 idle-freeze 分支上炸整表。
  const events = [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 1, outputTokens: 1 })]
  const sessions = new Map([['c7', liveOf(events)]])
  let ledger = { p1: [] }
  let running = [{ childId: 'c7', agentType: 'hermes' }]
  let archiveCalls = 0
  const agg = createUsageAggregator({
    getSessions: () => sessions,
    getSubagents: () => undefined,
    listRunningChildren: () => running,
    loadLedger: async () => ({ version: 3, parents: ledger }),
    readArchive: (childId) => { if (childId === 'c7') archiveCalls += 1; return { events: [], complete: true } }, // 只数子代 c7：父会话 self 流的空扫不在本例断言面（D6）
  })
  const r1 = await agg.getUsage('p1')
  assert.equal(r1.children[0].frozen, false)
  assert.deepEqual(r1.children[0].totals, { inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null })

  sessions.delete('c7')
  running = []
  ledger = { p1: [{ childId: 'c7', agentType: 'hermes', status: 'done' }] }
  const r2 = await agg.getUsage('p1')
  assert.equal(archiveCalls, 1, 'end 后恰一次档案扫描（consumed===0 的空扫）')
  assert.equal(r2.children[0].frozen, true, '零新增 + 终态行 → 冻结，后续轮询零 IO')
  assert.deepEqual(r2.children[0].totals, r1.children[0].totals)
})

test('复活解冻：冻结后同 childId 复活，live 增量续扫新代际，历史分段保留不重不漏', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-usage-revive-'))
  const root = join(home, 'sessions')
  writeArchiveFixture(root, 'c4', [[header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 10, outputTokens: 2 })]])
  let ledgerRows = [{ childId: 'c4', agentType: 'hermes', status: 'done' }]
  let running = []
  const events = []
  const sessions = new Map()
  let archiveCalls = 0
  const agg = createUsageAggregator({
    getSessions: () => sessions,
    getSubagents: () => undefined,
    listRunningChildren: () => running,
    loadLedger: async () => ({ version: 3, parents: { p1: ledgerRows } }),
    readArchive: (childId, fromSeq) => { if (childId === 'c4') archiveCalls += 1; return readArchivedUsage(childId, fromSeq, { root, cwd: process.cwd() }) }, // 只数子代 c4（D6 self 流不在本例断言面）
  })
  try {
    const r1 = await agg.getUsage('p1')
    assert.equal(r1.children[0].frozen, true, '终态先冻结')
    assert.deepEqual(r1.children[0].totals, { inputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null })

    // 复活即新世代（F7）：台账记录回槽（文件桶摘除）+ 登记表回填（running）+
    // live store 重驻留（cold resume 后事件流含历史全量，seq 续接）。
    ledgerRows = []
    running = [{ childId: 'c4', agentType: 'hermes' }]
    events.push(header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 10, outputTokens: 2 }), header(2, 'prov-b', 'm2'), msg(3, { inputTokens: 7, outputTokens: 3 }))
    sessions.set('c4', liveOf(events))

    const r2 = await agg.getUsage('p1')
    const child = r2.children[0]
    assert.equal(child.frozen, false, '终态→活跃 解冻（R4）')
    assert.equal(archiveCalls, 1, '复活后走 live 增量，不再触发第二次档案解压')
    assert.equal(child.status, 'running')
    assert.deepEqual(child.totals, { inputTokens: 17, outputTokens: 5, cacheReadTokens: null, cacheWriteTokens: null }, 'lastSeq 续扫：新代际帧只计一次')
    assert.deepEqual(child.segments.map((s) => s.model), ['m1', 'm2'], '新代际由 request/header 切新段，历史分段保留')
    assert.deepEqual(child.segments.map((s) => s.messageCount), [1, 1])
    assert.equal(child.messageCount, 2)
  } finally {
    await removeHomeWithRetry(home)
  }
})

// ── getUsage 端点（lib 半接线，D3）───────────────────────────────────────────

function mockHostCtx({ settings } = {}) {
  const panel = createPanelRpcTransport()
  const ctx = {
    get: (name) => {
      if (name === 'settings') return settings
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: () => {},
    inject: panel.inject,
    effect: () => {},
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
  }
  return { ctx, rpc: panel.rpc }
}

test('getUsage 端点：台账/档案默认路径聚合 + 价格实时 join（R6）+ Z8 空结构不抛错', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-usage-endpoint-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    mkdirSync(join(home, 'dsh-my-go'), { recursive: true })
    writeFileSync(join(home, 'dsh-my-go', 'orchestration-ledger.json'), JSON.stringify({ version: 3, parents: { p9: [{ childId: 'c9', agentType: 'oracle', status: 'done' }] } }))
    writeArchiveFixture(join(home, 'sessions'), 'c9', [
      [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 100, outputTokens: 50 })],
      [header(2, 'prov-b', 'm2'), msg(3, { inputTokens: 1, outputTokens: 1 })],
    ])
    const settings = {
      register: () => ({}),
      get: (ns) => (ns === 'dsh-my-go' ? { usagePrices: { 'prov-a/m1': { input: 2, output: 8 } }, usageCurrency: 'CNY' } : undefined),
      mutate: async () => {},
    }
    const { ctx, rpc } = mockHostCtx({ settings })
    await hostApply(ctx, { installPreset: false })

    const { ok, value } = await rpc('/dsh-my-go', 'getUsage', { parentSessionId: 'p9' })
    assert.equal(ok, true)
    assert.equal(value.parentSessionId, 'p9')
    assert.equal(value.found, true)
    assert.equal(value.currency, 'CNY', '响应回显全局币种（D1a，R6 同点实时读）')
    assert.equal(value.children[0].childId, 'c9')
    assert.equal(value.children[0].agentType, 'oracle')
    assert.equal(value.children[0].status, 'done')
    assert.equal(value.children[0].frozen, true)
    assert.deepEqual(value.children[0].totals, { inputTokens: 101, outputTokens: 51, cacheReadTokens: null, cacheWriteTokens: null })
    assert.deepEqual(value.byModel.map((row) => row.model), ['m1', 'm2'])
    assert.deepEqual(value.byModel[0].price, { input: 2, output: 8 }, '价格 join 只发生在响应组装（D2 R6）')
    assert.equal(value.byModel[1].price, null, 'unmatched 模型 price=null（Z3）')
    assert.equal(typeof value.generatedAt, 'number')
    assert.deepEqual(value.totals, { inputTokens: 101, outputTokens: 51, cacheReadTokens: null, cacheWriteTokens: null })

    for (const bad of [42, '', undefined]) {
      const res = await rpc('/dsh-my-go', 'getUsage', { parentSessionId: bad })
      assert.equal(res.ok, true, 'Z8：非法入参不抛错，回 ok:true 空结构')
      assert.equal(res.value.found, false)
      assert.equal(res.value.parentSessionId, '')
      assert.equal(res.value.currency, 'CNY', 'currency 读全局 settings，与入参无关（D1a）')
      assert.deepEqual(res.value.children, [])
      assert.deepEqual(res.value.byModel, [])
      assert.deepEqual(res.value.totals, ALL_NULL_BUCKETS)
    }

    // D1a 降级：settings 无 usageCurrency 键（存量配置）→ 响应回落 USD
    const { ctx: ctxB, rpc: rpcB } = mockHostCtx({ settings: { register: () => ({}), get: (ns) => (ns === 'dsh-my-go' ? { usagePrices: {} } : undefined), mutate: async () => {} } })
    await hostApply(ctxB, { installPreset: false })
    const noCur = await rpcB('/dsh-my-go', 'getUsage', { parentSessionId: 'p9' })
    assert.equal(noCur.value.currency, 'USD', '未知/缺席币种回落 USD，绝不渲染裸数字')
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    await removeHomeWithRetry(home)
  }
})

// ── 父会话自身用量（D6 parent-usage 契约）────────────────────────────────────

test('父会话自身 live 流：self 合成行排最前带 isSelf，byModel 并入但 childCount 只数子代，totals=完整开销', async () => {
  const selfEvents = [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 50, outputTokens: 5 }), msg(2, { outputTokens: 3, cacheReadTokens: 7 })]
  const childEvents = [header(0, 'prov-b', 'm2'), msg(1, { inputTokens: 10, outputTokens: 2 })]
  const sessions = new Map([
    ['p1', liveOf(selfEvents)],
    ['c1', liveOf(childEvents)],
  ])
  const agg = createUsageAggregator(makeDeps({
    ledger: { p1: [{ childId: 'c1', agentType: 'hermes', status: 'running' }] },
    sessions,
  }))
  const r = await agg.getUsage('p1')
  assert.equal(r.found, true)
  assert.equal(r.children.length, 2, 'self 合成行 + 子代行')
  const self = r.children[0]
  assert.equal(self.isSelf, true, '身份标注：isSelf 恒在场')
  assert.equal(self.childId, 'p1', 'self 行 childId = 父会话 id')
  assert.equal(self.agentType, null, '父会话无工种')
  assert.deepEqual(self.totals, { inputTokens: 50, outputTokens: 8, cacheReadTokens: 7, cacheWriteTokens: null }, '父会话自身流同款四桶聚合')
  assert.equal(self.segments.length, 1, '同 header 切段语义')
  assert.equal(self.messageCount, 2)
  assert.equal(r.children[1].childId, 'c1', 'self 排在子代之前')
  assert.equal(r.children[1].isSelf, undefined, '子代行不带 isSelf')

  const m1 = r.byModel.find((row) => row.model === 'm1')
  assert.deepEqual(m1.buckets, { inputTokens: 50, outputTokens: 8, cacheReadTokens: 7, cacheWriteTokens: null }, '父会话用量自然并入对应模型行')
  assert.equal(m1.childCount, 0, 'self 不是子代：childCount 不计它')
  const m2 = r.byModel.find((row) => row.model === 'm2')
  assert.equal(m2.childCount, 1, '子代照常计数')
  assert.deepEqual(r.totals, { inputTokens: 60, outputTokens: 10, cacheReadTokens: 7, cacheWriteTokens: null }, '合计 = self + 子代完整开销')
})

test('父会话自身档案路径：冷父会话空扫一轮即冻结零 IO；无台账无子代也因 self 在场 found=true', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-usage-self-arch-'))
  const root = join(home, 'sessions')
  writeArchiveFixture(root, 'p1', [
    [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 42, outputTokens: 4 })],
  ])
  let archiveCalls = 0
  const agg = createUsageAggregator(makeDeps({
    ledger: {},
    readArchive: (childId, fromSeq) => { archiveCalls += 1; return readArchivedUsage(childId, fromSeq, { root, cwd: process.cwd() }) },
  }))
  try {
    const r1 = await agg.getUsage('p1')
    assert.equal(r1.found, true, 'self 在场 → found（台账查无、零子代亦然）')
    assert.equal(r1.children.length, 1)
    assert.equal(r1.children[0].isSelf, true)
    assert.deepEqual(r1.children[0].totals, { inputTokens: 42, outputTokens: 4, cacheReadTokens: null, cacheWriteTokens: null })

    // self 无台账终态行（父会话本质无 ledger 行），冻结走 idle-freeze：
    // 首轮全量扫（consumed>0 不冻），次轮空扫（consumed===0）冻结，此后零 IO
    assert.equal(r1.children[0].frozen, false)
    const r2 = await agg.getUsage('p1')
    assert.equal(r2.children[0].frozen, true, '空扫即冻结（idle-freeze）')
    assert.deepEqual(r2.children[0].totals, r1.children[0].totals)
    const r3 = await agg.getUsage('p1')
    assert.equal(archiveCalls, 2, '冻结后轮询零 IO')
    assert.deepEqual(r3.children[0].totals, r1.children[0].totals)
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('父会话自身空流降级：无 assistant 消息 → 不注入 self 行，Z8 found 语义不翻', async () => {
  // live 在场但只有非 assistant 事件 → segments 空 → 无 self 行
  const sessions = new Map([['p1', liveOf([{ type: 'user/message', seq: 0, time: 0, data: {} }])]])
  const agg = createUsageAggregator(makeDeps({
    ledger: { p1: [{ childId: 'c1', agentType: 'hermes', status: 'done' }] },
    sessions,
    readArchive: () => ({ events: [], complete: true }),
  }))
  const r = await agg.getUsage('p1')
  assert.equal(r.children.length, 1, '只有子代行，无零值 self 合成行')
  assert.equal(r.children[0].isSelf, undefined)

  // 完全未知的会话：live miss + 档案无 + 台账查无 → found=false（Z8 不被 self 翻面）
  const agg2 = createUsageAggregator(makeDeps({
    ledger: {},
    readArchive: () => ({ events: [], complete: true }),
  }))
  const r2 = await agg2.getUsage('ghost')
  assert.equal(r2.found, false)
  assert.deepEqual(r2.children, [])
})

test('父会话自身复活解冻：冻结后 live 重驻留即续扫新代际（R4 同款）', async () => {
  let archiveCalls = 0
  const events = []
  const sessions = new Map()
  const agg = createUsageAggregator(makeDeps({
    ledger: { p1: [] },
    sessions,
    readArchive: () => { archiveCalls += 1; return { events: [], complete: true } },
  }))
  const r1 = await agg.getUsage('p1')
  assert.equal(r1.children.length, 0, '空流无 self 行')
  assert.equal(archiveCalls, 1, 'live miss → 恰一次档案空扫')

  // 父会话自身复活（cold resume / 会话重驻留）：live 在场 → 解冻续扫
  events.push(header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 9, outputTokens: 1 }))
  sessions.set('p1', liveOf(events))
  const r2 = await agg.getUsage('p1')
  assert.equal(archiveCalls, 1, '解冻后走 live 增量，不再碰档案')
  const self = r2.children[0]
  assert.equal(self.isSelf, true)
  assert.equal(self.frozen, false, 'live 重驻留 → 解冻（R4）')
  assert.deepEqual(self.totals, { inputTokens: 9, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null })
})
