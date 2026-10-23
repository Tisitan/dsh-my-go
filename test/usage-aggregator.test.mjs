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
import { removeHomeWithRetry, createPanelRpcTransport, resolvedHostConfig, createSettingsStub } from './helpers/mock-ctx.mjs'

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

function makeDeps({ ledger = {}, evictedParents, enumerationTruncated, intactParents, sessions, subagents, runningChildren, prices, readArchive, now } = {}) {
  return {
    getSessions: () => sessions,
    getSubagents: () => subagents,
    listRunningChildren: runningChildren,
    loadLedger: async () => ({ version: 3, parents: ledger, ...(evictedParents ? { evictedParents } : {}), ...(enumerationTruncated ? { enumerationTruncated: true } : {}), ...(intactParents ? { intactParents } : {}) }),
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
    const settings = createSettingsStub()
    const { ctx, rpc } = mockHostCtx({ settings })
    await hostApply(ctx, resolvedHostConfig({ usagePrices: { 'prov-a/m1': { input: 2, output: 8 } }, usageCurrency: 'CNY' }))

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
    const { ctx: ctxB, rpc: rpcB } = mockHostCtx({ settings: createSettingsStub() })
    await hostApply(ctxB, resolvedHostConfig({ usagePrices: {} }))
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

// ── 枚举完整性（F6 降级下界，P2）──────────────────────────────────────────────
// 报告上的 partial 只表达「本次聚合可能漏了子代」：listChildren 失败，或台账已
// 触顶 HISTORY_CAP 而第二源没给出任何行。没有它，合计会把下界当完整值展示。

test('枚举完整性：listChildren 抛错 → report.partial=true（这一源不可用）', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: [{ childId: 'c1', status: 'done' }] },
    subagents: { listChildren: async () => { throw new Error('catalog offline') } },
    readArchive: () => ({ events: [], complete: true }),
  }))
  const report = await agg.getUsage('p')
  assert.equal(report.partial, true, '第二源失败 = 枚举可能漏人')
  assert.equal(report.children.length, 1, '台账那一行照常入账')
})

test('枚举完整性：listChildren 形状漂移（非数组）→ 同样算不可用', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: [{ childId: 'c1', status: 'done' }] },
    subagents: { listChildren: async () => ({ nope: true }) },
    readArchive: () => ({ events: [], complete: true }),
  }))
  assert.equal((await agg.getUsage('p')).partial, true)
})

test('枚举完整性：台账触顶 HISTORY_CAP 且第二源缺席 → report.partial=true', async () => {
  const rows = []
  for (let i = 0; i < 200; i += 1) rows.push({ childId: `c${i}`, status: 'done' })
  assert.equal(rows.length, 200, '正好 HISTORY_CAP')
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: rows },
    subagents: undefined, // 旧宿主 / lib-only 降级：没有 listChildren 这一源
    readArchive: () => ({ events: [], complete: true }),
  }))
  const report = await agg.getUsage('p')
  assert.equal(report.partial, true, '只靠一张被裁过的台账 = 下界')
  assert.equal(report.children.length, 200)
})

test('枚举完整性：未触顶且第二源缺席 → 不加下界（正常形态不误报）', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: [{ childId: 'c1', status: 'done' }] },
    subagents: undefined,
    readArchive: () => ({ events: [], complete: true }),
  }))
  const report = await agg.getUsage('p')
  assert.equal(report.partial, false, '台账没触顶就没有裁剪可能，不许滥报下界')
})

test('枚举完整性：台账触顶但第二源给出了行 → 由第二源兜底，不算不完整', async () => {
  const rows = []
  for (let i = 0; i < 200; i += 1) rows.push({ childId: `c${i}`, status: 'done' })
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: rows },
    subagents: { listChildren: async () => [{ kind: 'child', id: 'older-1', activity: 'idle', label: 'dsh-my-go:explore: t' }] },
    readArchive: () => ({ events: [], complete: true }),
  }))
  const report = await agg.getUsage('p')
  assert.equal(report.partial, false, '第二源在场就能捞回更早的子代')
  assert.equal(report.children.length, 201, '两源合并去重：台账 200 + 第二源多出的 1')
})

test('枚举完整性：空输入（Z8）→ 空报告且 partial=false（不主张不完整）', async () => {
  const agg = createUsageAggregator(makeDeps({}))
  const report = await agg.getUsage('')
  assert.equal(report.found, false)
  assert.equal(report.partial, false)
})

// ── 宿主 catalog 形状 + 父桶整桶淘汰（P23）────────────────────────────────────

test('P23 真实宿主 catalog 行（无 kind 字段）必须被采纳：{id, createdAt, mode, label}', async () => {
  // @deepseek-ai/dsh-subagent 0.1.7-alpha.2 的 subagentCatalog 投影产出
  // { id, createdAt, mode, label }，**没有 kind**；旧判据 entry.kind === 'child'
  // 在生产里把第二源整源过滤成空。kind 缺省即按 child 采纳。
  const realRows = [{ id: 'c2', createdAt: 7, mode: 'continuable', label: 'dsh-my-go:hermes: 干活' }]
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: [{ childId: 'c1', agentType: 'explore', status: 'done' }] },
    subagents: { listChildren: async () => realRows },
  }))
  const report = await agg.getUsage('p')
  assert.equal(report.children.length, 2, '第二源的那一行确实入账（c1 台账 + c2 catalog）')
  const c2 = report.children.find((row) => row.childId === 'c2')
  assert.ok(c2, '真实 catalog 行被采纳')
  assert.equal(c2.agentType, 'dsh-my-go:hermes: 干活', 'label 即工种来源（与 broker 冷恢复同口径）')
  assert.equal(report.partial, false, '两源都在、台账未触顶 ⇒ 不主张不完整')
})

test('P23 catalog 行的显式非 child kind 仍然跳过；空 id 也跳过（形状漂移防线）', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { p: [{ childId: 'c1', status: 'done' }] },
    subagents: { listChildren: async () => [{ kind: 'orchestrator', id: 'x1' }, { id: '' }, { id: 'c9', label: 'ok' }] },
  }))
  const report = await agg.getUsage('p')
  const ids = report.children.map((row) => row.childId)
  assert.deepEqual(ids.sort(), ['c1', 'c9'], '只有合法子代行入账')
})

test('P23 父桶整桶淘汰（命中持久化 evictedParents）⇒ report.partial=true（下界，不谎报完整）', async () => {
  // pruneLedgerParents 触顶 200 父桶后整桶删掉最旧父会话：被淘汰者 ledgerRows=[]
  // 且不满足「>= HISTORY_CAP」，旧判据于是把漏算报成完整。
  const agg = createUsageAggregator(makeDeps({
    ledger: { other: [{ childId: 'k1', status: 'done' }] },
    evictedParents: ['gone'],
    subagents: undefined, // 降级形态：没有第二源
  }))
  const report = await agg.getUsage('gone')
  assert.equal(report.partial, true, '命中淘汰痕迹 = 历史不可逆缺失')
  assert.equal(report.children.length, 0, '用量本身恢复不了（如实不注入假数据）')
})

test('P23 桶不存在 + 父桶数触顶 ⇒ partial=true（处于淘汰态，无法证明「真没子代」）', async () => {
  const parents = {}
  for (let i = 0; i < 200; i += 1) parents[`p${i}`] = [{ childId: `c${i}`, status: 'done' }]
  const agg = createUsageAggregator(makeDeps({ ledger: parents, subagents: undefined }))
  const report = await agg.getUsage('unknown-parent')
  assert.equal(Object.keys(parents).length, 200)
  assert.equal(report.partial, true, '台账处于父桶淘汰态 ⇒ 缺席桶按不完整处理')
})

test('P23 桶不存在但父桶数未触顶 ⇒ partial=false（正常新会话不误报下界）', async () => {
  const agg = createUsageAggregator(makeDeps({ ledger: { other: [{ childId: 'k1', status: 'done' }] }, subagents: undefined }))
  const report = await agg.getUsage('brand-new-parent')
  assert.equal(report.partial, false, '没触淘汰上限就没有裁剪可能')
})

test('P23 pruneLedgerParents 的淘汰痕迹：不可枚举（不扰动桶数/序列化）+ 有界 + 可跨调用累积', async () => {
  const { pruneLedgerParents, evictedParentsOf, EVICTED_PARENTS_CAP } = await import('../preset/shared/misc.mjs')
  const parents = {}
  for (let i = 0; i < 205; i += 1) parents[`p${i}`] = [{ childId: `c${i}`, status: 'done', updatedAt: i + 1 }]
  const pruned = pruneLedgerParents(parents)
  assert.equal(Object.keys(pruned).length, 200, '保留最近 200 个桶')
  assert.equal(Object.keys(pruned).includes('evictedParents'), false, '痕迹必须不可枚举（不扰动桶数判定）')
  assert.equal(JSON.stringify(pruned).includes('evictedParents'), false, '直接序列化 parents 时不掺痕迹')
  assert.equal(evictedParentsOf(pruned).length, 5, '淘汰 5 个最旧父会话')
  // 跨调用累积（broker-ledger 用它把痕迹写进 payload 顶层）
  const next = {}
  for (let i = 0; i < 203; i += 1) next[`q${i}`] = [{ childId: `d${i}`, status: 'done', updatedAt: i + 1 }]
  const pruned2 = pruneLedgerParents(next, undefined, evictedParentsOf(pruned))
  const trail = evictedParentsOf(pruned2)
  assert.equal(trail.length, 5 + 3, '旧痕迹保留 + 本次新淘汰 3 个')
  assert.ok(trail.length <= EVICTED_PARENTS_CAP, '有界')
})

// ── 粘滞裁剪标志（P22 收口）：曾饱和 = 永久下界，不随桶数回落而消失 ────────────

test('P22 旧饱和台账迁移（200 桶、无痕迹）⇒ 删掉一个保留桶后仍 partial=true', async () => {
  // 场景 A：升级前已裁到 200 桶的旧档没有 evictedParents。加载时「原始桶数触顶」
  // 即置粘滞 enumerationTruncated；随后 session/disposed 删桶到 199，痕迹仍为空
  // ——两条瞬时判据同时失效，只有粘滞标志能证明「缺席 ≠ 真没子代」。
  const parents = {}
  for (let i = 0; i < 200; i += 1) parents[`kept${i}`] = [{ childId: `c${i}`, status: 'done', updatedAt: i + 1 }]
  const agg = createUsageAggregator(makeDeps({ ledger: parents, subagents: undefined }))
  assert.equal((await agg.getUsage('previously-evicted')).partial, true, '饱和台账（200 桶）样本')
  // 模拟 broker 落盘后再删桶：payload 顶层带 enumerationTruncated，桶数 199
  const shrunk = {}
  for (let i = 1; i < 200; i += 1) shrunk[`kept${i}`] = parents[`kept${i}`]
  const agg2 = createUsageAggregator(makeDeps({ ledger: shrunk, evictedParents: undefined, subagents: undefined, enumerationTruncated: true }))
  assert.equal(Object.keys(shrunk).length, 199)
  assert.equal((await agg2.getUsage('previously-evicted')).partial, true, '痕迹为空 + 桶数 199 也不许退回 false')
})

test('P22 粘滞标志：无名单的在场桶保守下界（v6），行照常入账、缺席桶也不许报完整', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { fresh: [{ childId: 'c1', status: 'done' }] },
    subagents: undefined,
    enumerationTruncated: true,
  }))
  const present = await agg.getUsage('fresh')
  // v6 收口：没有白名单时，在场桶也可能是「先重建后升级」的残缺桶 —— 无法证伪即标下界。
  assert.equal(present.partial, true, '无名单的裁剪档：在场桶也必须是下界')
  assert.equal(present.children.length, 1, '行本身照常入账，下界不是吞数据')
  const absent = await agg.getUsage('never-seen')
  assert.equal(absent.partial, true, '曾裁剪过的台账里缺席的父会话 = 无法证明「真没子代」')
})

test('P22 pruneLedgerParents 的粘滞标志：触顶/淘汰/痕迹溢出任一成立即真，且不可枚举', async () => {
  const { pruneLedgerParents, enumerationTruncatedOf, EVICTED_PARENTS_CAP } = await import('../preset/shared/misc.mjs')
  const rows = (n, pfx = 'p') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pfx}${i}`, [{ childId: `c${i}`, status: 'done', updatedAt: i + 1 }]]))
  assert.equal(enumerationTruncatedOf(pruneLedgerParents(rows(3))), false, '小台账不设标志')
  const saturated = pruneLedgerParents(rows(200))
  assert.equal(enumerationTruncatedOf(saturated), true, '桶数触顶 200 即视为曾饱和（旧档迁移）')
  assert.equal(Object.keys(saturated).includes('enumerationTruncated'), false, '不可枚举（序列化/桶数判定零扰动）')
  const pruned = pruneLedgerParents(rows(201))
  assert.equal(enumerationTruncatedOf(pruned), true)
  // 痕迹表溢出：713 轮淘汰 ⇒ 痕迹被 slice(-512) 截断，标志必须为真
  let kept = {}
  let trail = []
  for (let i = 0; i < 713; i += 1) {
    kept = pruneLedgerParents({ ...kept, [`r${i}`]: [{ childId: `c${i}`, updatedAt: i + 1 }] }, undefined, trail)
    trail = kept.evictedParents ?? []
  }
  assert.equal(trail.length, EVICTED_PARENTS_CAP)
  assert.equal(enumerationTruncatedOf(kept), true, '痕迹溢出后同样为真')
  // 粘滞：标志随 carried 传下去，桶数回落也不回退
  const carried = pruneLedgerParents(rows(5), undefined, trail)
  assert.equal(enumerationTruncatedOf(carried), true, '输入带痕迹/标志 ⇒ 永远为真')
})

// ── 幸存桶白名单（v4 收口）：重建的未知父桶不得洗白成「历史完整」 ───────────────

test('v4 裁剪态 + 白名单：名单内保留桶精确、名单外重建桶标下界', async () => {
  const intact = Array.from({ length: 200 }, (_, i) => `kept${i}`)
  const agg = createUsageAggregator(makeDeps({
    ledger: {
      kept5: [{ childId: 'c5', status: 'done' }],
      // 当年被静默裁掉、之后恢复重建的旧父会话：桶里只有新记录
      'previously-evicted': [{ childId: 'new-child', status: 'done' }],
    },
    subagents: undefined,
    enumerationTruncated: true,
    intactParents: intact,
  }))
  const retained = await agg.getUsage('kept5')
  assert.equal(retained.partial, false, '白名单内的桶：历史自纪元起连续在场 ⇒ 精确')
  assert.equal(retained.children.length, 1)
  const resumed = await agg.getUsage('previously-evicted')
  assert.equal(resumed.partial, true, '白名单外的在场桶：可能是恢复重建的旧会话 ⇒ 下界')
  assert.equal(resumed.children.length, 1, '桶里的行照常入账（下界不是吞数据）')
  const absent = await agg.getUsage('never-seen')
  assert.equal(absent.partial, true, '缺席 + 裁剪态 ⇒ 下界')
})

test('v6 白名单缺失但已有粘滞标志（先重建后升级）⇒ 在场桶一律下界', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { fresh: [{ childId: 'c1', status: 'done' }] },
    subagents: undefined,
    enumerationTruncated: true,
  }))
  assert.equal((await agg.getUsage('fresh')).partial, true, '仍处在裁剪态 ⇒ 报精确就是替残缺桶背书')
  assert.equal((await agg.getUsage('unknown-absent')).partial, true)
  // 缺少完整性证据的旧档由 prune 迁移为 intactParents: []。
})

test('v4 第二源给出完整名单 ⇒ 名单外重建桶也算完整（逐子代回读档案，漏算不成立）', async () => {
  const agg = createUsageAggregator(makeDeps({
    ledger: { 'previously-evicted': [{ childId: 'new-child', status: 'done' }] },
    subagents: { listChildren: async () => [{ id: 'new-child', createdAt: 1, mode: 'continuable', label: 'dsh-my-go:hermes: t' }] },
    enumerationTruncated: true,
    intactParents: ['kept0'],
  }))
  const report = await agg.getUsage('previously-evicted')
  assert.equal(report.partial, false, '第二源在场并给出子代名单 ⇒ 枚举完整')
  assert.equal(report.children.length, 1)
})

test('v4 pruneLedgerParents 的白名单：纪元确立 → 只减不增（后建桶永不自动加入）', async () => {
  const { pruneLedgerParents, intactParentsOf, enumerationTruncatedOf } = await import('../preset/shared/misc.mjs')
  const rows = (n, pfx = 'k') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pfx}${i}`, [{ childId: `c${i}`, status: 'done', updatedAt: i + 1 }]]))
  const epoch = pruneLedgerParents(rows(200))
  assert.equal(enumerationTruncatedOf(epoch), true)
  assert.equal(intactParentsOf(epoch).length, 200, '纪元在场的 200 桶全部入名单')
  // 删掉 kept0、再加一个「恢复重建」的旧会话：名单只减不增
  const after = pruneLedgerParents({ ...rows(199, 'k'), resurrected: [{ childId: 'n', status: 'done', updatedAt: 9e9 }] }, undefined, [], intactParentsOf(epoch), true)
  const list = intactParentsOf(after)
  assert.equal(list.length, 199, 'kept0 出名单')
  assert.equal(list.includes('resurrected'), false, '后建的桶不自动加入名单')
  // 未裁剪台账不产名单（不为无法判定而滥报）
  assert.deepEqual(intactParentsOf(pruneLedgerParents(rows(3))), [])
})

test('v4 裁剪态下全新父桶：第二源缺席时保守标下界（残余误报面，如实钉住）', async () => {
  // 与「恢复重建的旧会话」在台账里长得一模一样：桶里只有一条新记录、不在白名单。
  // 无第二源时无法证明它是全新会话，只能保守报下界（宁可显示 ≥，不可把漏算说成精确）。
  const agg = createUsageAggregator(makeDeps({
    ledger: { 'brand-new': [{ childId: 'c1', status: 'done' }] },
    subagents: undefined,
    enumerationTruncated: true,
    intactParents: ['kept0', 'kept1'],
  }))
  assert.equal((await agg.getUsage('brand-new')).partial, true)
  // 真实宿主上第二源在场时该会话会被证明完整（catalog 逐子代枚举），见上一例
})

test('v4b 名单退空为 [] 后：在场桶一律下界，绝不重新播种（同进程）', async () => {
  const { pruneLedgerParents, intactParentsOf, hasIntactParentsMeta, enumerationTruncatedOf } = await import('../preset/shared/misc.mjs')
  const rows = (ids) => Object.fromEntries(ids.map((id) => [id, [{ childId: 'c-' + id, status: 'done', updatedAt: 1 }]]))
  const epochIds = Array.from({ length: 200 }, (_, i) => `kept${i}`)
  let cur = pruneLedgerParents(rows(epochIds))
  assert.equal(intactParentsOf(cur).length, 200)
  // 200 个幸存桶陆续 session/disposed 退场 ⇒ 名单退空为 []
  cur = pruneLedgerParents(rows(epochIds.slice(1)), undefined, [], intactParentsOf(cur), true)
  assert.equal(intactParentsOf(cur).length, 199)
  cur = pruneLedgerParents({}, undefined, [], intactParentsOf(cur), true)
  assert.deepEqual(intactParentsOf(cur), [], '名单退空为 []')
  assert.equal(hasIntactParentsMeta(cur), true, '空数组仍是「已确立的名单」，不是「没有名单」')
  assert.equal(enumerationTruncatedOf(cur), true)
  // 被裁掉的旧父会话恢复重建桶 ⇒ 不得被补种进名单
  cur = pruneLedgerParents(rows(['previously-evicted']), undefined, [], intactParentsOf(cur), true)
  assert.deepEqual(intactParentsOf(cur), [], '退空后绝不重新播种')
  assert.equal(hasIntactParentsMeta(cur), true)
  // 聚合端：空名单 + 在场桶 ⇒ 下界；同档内普通全新桶也不得报精确
  const agg = createUsageAggregator(makeDeps({
    ledger: { 'previously-evicted': [{ childId: 'new-child', status: 'done' }], fresh: [{ childId: 'cf', status: 'done' }] },
    subagents: undefined,
    enumerationTruncated: true,
    intactParents: [],
  }))
  assert.equal((await agg.getUsage('previously-evicted')).partial, true, '空名单里的在场桶必须保持下界')
  assert.equal((await agg.getUsage('fresh')).partial, true, '空名单下无法证明任何在场桶完整')
})

test('v4b 名单退空为 [] 后跨落盘重载：旧父会话重建桶仍保下界', async () => {
  const [{ createLedgerOps }, fs] = await Promise.all([import('../preset/tools/broker-ledger.mjs'), import('node:fs/promises')])
  const home = await fs.mkdtemp(join(tmpdir(), 'dsh-my-go-v4b-'))
  try {
    const file = `${home}/ledger.json`
    const orchestrations = new Map()
    const orchFor = (id) => { if (!orchestrations.has(id)) orchestrations.set(id, { history: [], chains: [] }); return orchestrations.get(id) }
    const mkOps = () => createLedgerOps({ ledgerPath: file, orchestrations, orchFor, findRecordEverywhere() {}, bump() {} })
    const usage = () => createUsageAggregator({ ledgerPath: file, readArchive: async () => ({ events: [], complete: true }) })
    // 201 桶 ⇒ 真实淘汰 p0，名单 = 在场 200 桶
    let ops = mkOps()
    for (let i = 0; i < 201; i++) orchFor('p' + i).history = [{ childId: 'c' + i, agentType: 'hermes', status: 'done', updatedAt: i + 1 }]
    ops.writeLedgerSync(ops.ledgerPayload())
    let raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(raw.intactParents.length, 200)
    // 在册桶与已被淘汰的桶全部退场（编排实例全销毁）：名单退空为 [] 并**落盘**。
    // 注意 p0 虽已被账本淘汰，其编排实例仍在内存里、下次落盘会重新长出桶——这里连它
    // 一起销毁，才是「幸存桶全退场」的真实形态。
    for (const pid of [...orchestrations.keys()]) orchestrations.delete(pid)
    ops.scheduleLedgerSave(); ops.closeLedger()
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.equal(Object.keys(raw.parents).length, 0)
    assert.deepEqual(raw.intactParents, [], '空名单必须随档落盘（不是省略字段）')
    // 旧被裁父会话 p0 恢复重建桶并落盘 → 重载 → 依然是下界
    ops = mkOps(); await ops.loadLedger()
    orchFor('p0').history = [{ childId: 'new', agentType: 'hermes', status: 'done', updatedAt: 9e9 }]
    ops.scheduleLedgerSave(); ops.closeLedger()
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.deepEqual(raw.intactParents, [], '重载后不得把重建桶补种进空名单')
    assert.equal((await usage().getUsage('p0')).partial, true)
    assert.equal((await usage().getUsage('previously-evicted')).partial, true)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('旧档已有淘汰痕迹但缺裁剪标志和名单 ⇒ 不把其余在场桶认作完整', async () => {
  const { pruneLedgerParents, intactParentsOf } = await import('../preset/shared/misc.mjs')
  const rows = (ids) => Object.fromEntries(ids.map((id) => [id, [{ childId: 'c-' + id, status: 'done', updatedAt: 1 }]]))
  // 痕迹来自旧档，无法证明是否完整；标志缺失不代表此次才首次裁剪。
  const seeded = pruneLedgerParents(rows(['a', 'b', 'c']), undefined, ['b'], undefined, false)
  assert.deepEqual(intactParentsOf(seeded), [], '旧淘汰痕迹不能证明 a/c 从未丢过历史')
  // 未裁剪台账不立名单
  assert.deepEqual(intactParentsOf(pruneLedgerParents(rows(['a']))), [])
})

test('v6 先重建后升级：已裁剪态 + 无名单的旧档加载后落成空白名单，残留残缺桶不再报精确', async () => {
  const [{ createLedgerOps }, fs] = await Promise.all([import('../preset/tools/broker-ledger.mjs'), import('node:fs/promises')])
  const home = await fs.mkdtemp(join(tmpdir(), 'dsh-my-go-v6-'))
  try {
    const file = `${home}/ledger.json`
    // 旧档形态：裁剪早已发生（粘滞标志在），受害父会话在升级前就已恢复并留下 1 行残缺桶，
    // 且没有 intactParents 字段。
    const parents = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`kept${i}`, [{ childId: `child${i}`, agentType: 'hermes', status: 'done', updatedAt: i + 1 }]]))
    parents['previously-evicted'] = [{ childId: 'new-child', agentType: 'hermes', status: 'done', updatedAt: 999 }]
    await fs.writeFile(file, JSON.stringify({ version: 3, parents, enumerationTruncated: true }))
    const orchestrations = new Map()
    const orchFor = (id) => { if (!orchestrations.has(id)) orchestrations.set(id, { history: [], chains: [] }); return orchestrations.get(id) }
    const ops = createLedgerOps({ ledgerPath: file, orchestrations, orchFor, findRecordEverywhere() {}, bump() {} })
    const usage = () => createUsageAggregator({ ledgerPath: file, readArchive: async () => ({ events: [], complete: true }) })
    await ops.loadLedger()
    // 升级落盘：不播种当前在场桶，落成空白名单
    ops.scheduleLedgerSave(); ops.closeLedger()
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.deepEqual(raw.intactParents, [], '先重建后升级的旧档不得补种白名单')
    assert.equal(raw.enumerationTruncated, true, '粘滞标志保留')
    assert.equal((await usage().getUsage('previously-evicted')).partial, true, '残留残缺桶必须报下界')
    assert.equal((await usage().getUsage('kept5')).partial, true, '同档其它在场桶也无法证明完整（保守）')
    // 重载后再写一次：依旧是空名单，不会把在场桶补种进来
    const again = createLedgerOps({ ledgerPath: file, orchestrations, orchFor, findRecordEverywhere() {}, bump() {} })
    await again.loadLedger(); again.writeLedgerSync(again.ledgerPayload())
    const raw2 = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.deepEqual(raw2.intactParents, [])
    assert.equal((await usage().getUsage('previously-evicted')).partial, true)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('v6 直接喂给聚合器的裸 JSON（枚举标志 true、无名单）与经 prune 后（[]）同判', async () => {
  const raw = createUsageAggregator(makeDeps({ ledger: { revived: [{ childId: 'n1', status: 'done' }] }, subagents: undefined, enumerationTruncated: true }))
  assert.equal((await raw.getUsage('revived')).partial, true, 'intactKnown=false 也必须下界')
  const pruned = createUsageAggregator(makeDeps({ ledger: { revived: [{ childId: 'n1', status: 'done' }] }, subagents: undefined, enumerationTruncated: true, intactParents: [] }))
  assert.equal((await pruned.getUsage('revived')).partial, true, 'intactParents=[] 同判')
  // 未裁剪台账里同一形状的桶仍然精确
  const clean = createUsageAggregator(makeDeps({ ledger: { revived: [{ childId: 'n1', status: 'done' }] }, subagents: undefined }))
  assert.equal((await clean.getUsage('revived')).partial, false)
})

test('v6 第二源「部分名单」不再算证明：必须覆盖台账已知的每个子代', async () => {
  const ledger = { revived: [{ childId: 'n1', status: 'done' }, { childId: 'n2', status: 'done' }] }
  const partial = createUsageAggregator(makeDeps({
    ledger,
    subagents: { listChildren: async () => [{ id: 'n1', createdAt: 1, mode: 'continuable', label: 'dsh-my-go:hermes: t' }] },
    enumerationTruncated: true,
    intactParents: [],
  }))
  assert.equal((await partial.getUsage('revived')).partial, true, '只给 n1 的残名单不能免除下界')
  const full = createUsageAggregator(makeDeps({
    ledger,
    subagents: {
      listChildren: async () => [
        { id: 'n1', createdAt: 1, mode: 'continuable', label: 'dsh-my-go:hermes: t' },
        { id: 'n2', createdAt: 2, mode: 'continuable', label: 'dsh-my-go:hermes: t' },
      ],
    },
    enumerationTruncated: true,
    intactParents: [],
  }))
  assert.equal((await full.getUsage('revived')).partial, false, '覆盖全部已知子代才算证明')
})

test('首次 201→200 裁剪确立幸存名单，已有名单跨 512 痕迹溢出仍保留', async () => {
  const { pruneLedgerParents, intactParentsOf, evictedParentsOf, EVICTED_PARENTS_CAP } = await import('../preset/shared/misc.mjs')
  const rows = (ids) => Object.fromEntries(ids.map((id) => [id, [{ childId: 'c-' + id, status: 'done', updatedAt: 1 }]]))
  // 从未裁剪、也无历史痕迹的 201 桶：此轮真正首次淘汰 victim。
  const fresh = Object.fromEntries(['victim', 'survivor', ...Array.from({ length: 199 }, (_, i) => `kept${i}`)].map((id, i) => [id, [{ childId: 'c-' + id, status: 'done', updatedAt: i + 1 }]]))
  const seeded = pruneLedgerParents(fresh)
  assert.equal(intactParentsOf(seeded).length, 200)
  assert.ok(intactParentsOf(seeded).includes('survivor'))
  assert.ok(!intactParentsOf(seeded).includes('victim'))
  assert.deepEqual(evictedParentsOf(seeded), ['victim'])
  // 之后痕迹表溢出 512（最早 victim 被挤出）：survivor 已在名单内，victim 永不进入
  const trail = ['victim', ...Array.from({ length: 513 }, (_, i) => `e${i}`)]
  const after = pruneLedgerParents(rows(['survivor', 'victim']), undefined, trail, intactParentsOf(seeded), true)
  assert.equal(evictedParentsOf(after).length, EVICTED_PARENTS_CAP)
  assert.ok(!evictedParentsOf(after).includes('victim'), 'victim 已被挤出痕迹表')
  assert.deepEqual(intactParentsOf(after), ['survivor'], '溢出后名单不因 victim 出表而洗白')
})

test('v6b 已裁剪 + 无名单且痕迹为空/已溢出 ⇒ 不播种（先重建后升级）', async () => {
  const { pruneLedgerParents, intactParentsOf } = await import('../preset/shared/misc.mjs')
  const rows = (ids) => Object.fromEntries(ids.map((id) => [id, [{ childId: 'c-' + id, status: 'done', updatedAt: 1 }]]))
  // 痕迹为空：旧版静默裁剪，一个 victim 都没记下 ⇒ 私下无法排除残缺桶
  assert.deepEqual(intactParentsOf(pruneLedgerParents(rows(['survivor', 'victim']), undefined, [], undefined, true)), [])
  // 痕迹已溢出：最早 victim 被挤出 ⇒ 同样不能把「不在痕迹里」当成幸存证明
  const overflowed = ['victim', ...Array.from({ length: 513 }, (_, i) => `e${i}`)]
  assert.deepEqual(intactParentsOf(pruneLedgerParents(rows(['survivor', 'victim']), undefined, overflowed, undefined, true)), [])
})

// 老版本落盘形态：淘汰表可能只记录了后来的裁剪，也可能早已被截断。
// 两种都不能用当前非空且 <=512 的表证明「未在表中的父会话历史完整」。
for (const [scenario, evictedParents] of [
  ['单条无关淘汰', ['unrelated-parent']],
  ['已落盘截断至512条', ['victim', ...Array.from({ length: 512 }, (_, i) => `evicted-${i}`)].slice(-512)],
]) {
  for (const hasTruncatedFlag of [true, false]) {
    test(`旧档迁移回归：${scenario}、${hasTruncatedFlag ? '有' : '无'}裁剪标志，迁移和重启均保留下界`, async () => {
      const [{ createLedgerOps }, fs] = await Promise.all([import('../preset/tools/broker-ledger.mjs'), import('node:fs/promises')])
      const home = await fs.mkdtemp(join(tmpdir(), 'dsh-my-go-ledger-migration-'))
      const file = join(home, 'ledger.json')
      const root = join(home, 'sessions')
      const parentId = 'victim'
      const oldChildId = 'old-million-token-child'
      const newChildId = 'new-child'
      try {
        // 归档始终可读；丢失的是旧子代到父会话的台账关联。
        for (const [id, inputTokens] of [[parentId, 10], [oldChildId, 1_000_000], [newChildId, 100]]) {
          writeArchiveFixture(root, id, [[header(0, 'prov-a', 'm1'), msg(1, { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })]])
        }
        await fs.writeFile(file, JSON.stringify({
          version: 3,
          parents: { [parentId]: [{ childId: newChildId, agentType: 'hermes', status: 'done', updatedAt: 1 }] },
          evictedParents,
          ...(hasTruncatedFlag ? { enumerationTruncated: true } : {}),
        }))
        const original = JSON.parse(await fs.readFile(file, 'utf8'))
        assert.equal(original.intactParents, undefined)
        assert.ok(!original.evictedParents.includes(parentId))
        assert.equal(original.evictedParents.length, scenario === '单条无关淘汰' ? 1 : 512)
        const catalog = [oldChildId, newChildId].map((id) => ({ id, createdAt: 1, mode: 'continuable', label: 'dsh-my-go:hermes: test' }))
        const usage = (withCatalog = false) => createUsageAggregator({
          ledgerPath: file,
          readArchive: (id, fromSeq) => readArchivedUsage(id, fromSeq, { root, cwd: process.cwd() }),
          getSubagents: () => withCatalog ? { listChildren: async () => catalog } : undefined,
        })
        const assertReports = async (phase) => {
          const lowerBound = await usage().getUsage(parentId)
          assert.equal(lowerBound.totals.inputTokens, 110, `${phase}: self 10 + 新子代 100 正常计入`)
          assert.equal(lowerBound.partial, true, `${phase}: 仍缺旧子代 100万，不得报告精确值`)
          assert.ok(!lowerBound.children.some((child) => child.childId === oldChildId))
          const complete = await usage(true).getUsage(parentId)
          assert.equal(complete.totals.inputTokens, 1_000_110, `${phase}: 完整 catalog 能重新枚举旧子代归档`)
          assert.equal(complete.partial, false, `${phase}: 真实补齐后的报告可以恢复精确值`)
        }
        // lib-only 直接读旧档也必须保守，不依赖 broker 先迁移落盘。
        await assertReports('迁移前')
        for (const phase of ['首次迁移落盘', '重启再次落盘']) {
          // 每次使用新的 Map 和 createLedgerOps，避免把内存元数据误当成持久化成功。
          const orchestrations = new Map()
          const orchFor = (id) => {
            if (!orchestrations.has(id)) orchestrations.set(id, { history: [], chains: [] })
            return orchestrations.get(id)
          }
          const ops = createLedgerOps({ ledgerPath: file, orchestrations, orchFor, findRecordEverywhere() {}, bump() {} })
          await ops.loadLedger()
          ops.scheduleLedgerSave()
          ops.closeLedger()
          await assertReports(phase)
          const persisted = JSON.parse(await fs.readFile(file, 'utf8'))
          assert.equal(persisted.enumerationTruncated, true)
          assert.deepEqual(persisted.intactParents, [], `${phase}: 不把未知历史的现存桶补种为完整`)
          assert.deepEqual(persisted.evictedParents, evictedParents, `${phase}: 现有淘汰记录照常保留`)
        }
      } finally {
        await fs.rm(home, { recursive: true, force: true })
      }
    })
  }
}
