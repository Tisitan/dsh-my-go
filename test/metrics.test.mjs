// dsh-my-go — metrics 观测埋点测试（0.4.0-tisitan.0 第 0 期 0.1 步）。
//
// 两档：
//   ① 模块直测（脱离 mock-ctx 的纯函数直测，既有成功模式）：追加/保序/close 幂等/
//      enabled=false 零写盘/fs 失败只 warn（R0.1 变异探针）/cap 截头（R0.2）/跨重启续算。
//   ② broker 接线行为档（替身 ctx 端到端）：默认开时 go_work + end 各落一行、
//      config.metrics=false 零写盘——证明「埋点真的接上了」，而不只是模块本身正确。
//
// 等待纪律（9-2）：正向等待一律用「谓词轮询断言真正要读的观测量」（文件内容 /
// 快照落账），零固定 sleep；固定 sleep（drain）只出现在负向窗口（断言「坏事不发生」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMetrics, METRICS_EVENTS_CAP, METRICS_FILE } from '../preset/tools/metrics.mjs'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, waitFor, drain, removeHomeWithRetry } from './helpers/mock-ctx.mjs'

const eventsPathOf = (dir) => join(dir, METRICS_FILE)

async function readEvents(dir) {
  const raw = readFileSync(eventsPathOf(dir), 'utf-8')
  return raw.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
}

// 轮询到「文件可解析且谓词成立」：写链是异步串行的，断言消费的观测量就是这份
// 文件本身——谓词取它，而不是赌墙钟。
async function readEventsWhen(dir, ready, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const rows = await readEvents(dir)
      if (ready(rows)) return rows
    } catch { /* 写链尚未落盘 */ }
    if (Date.now() > deadline) throw new Error(`metrics 事件未落盘（${timeoutMs}ms 超时）: ${eventsPathOf(dir)}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

// 捕获 console.warn 的标准姿势（host-parity 同款）。
function captureWarn() {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  return { warnings, restore: () => { console.warn = origWarn } }
}

// ── ① 模块直测 ──────────────────────────────────────────────────────────────

test('record 追加写 JSONL：ts 自动注入、调用序即落盘序、close 排空', async () => {
  const dir = tempDir('dsh-my-go-metrics-basic-')
  try {
    const m = createMetrics({ dir })
    m.record({ kind: 'dispatch', agentType: 'explore', promptBytes: 7 })
    m.record({ kind: 'end', childId: 'c-1' })
    await m.close()
    const rows = readFileSync(eventsPathOf(dir), 'utf-8').split('\n')
    assert.equal(rows.length, 3, '两行事件 + 文件以换行结尾（split 出一个空尾串）')
    const first = JSON.parse(rows[0])
    const second = JSON.parse(rows[1])
    assert.equal(first.kind, 'dispatch', '调用序即落盘序（fire-and-forget 串行链保序）')
    assert.equal(first.agentType, 'explore')
    assert.equal(first.promptBytes, 7)
    assert.equal(typeof first.ts, 'number', 'ts 由模块统一注入')
    assert.equal(second.kind, 'end')
    assert.equal(second.childId, 'c-1')
  } finally {
    await removeHomeWithRetry(dir)
  }
})

test('调用方显式提供的 ts 不被覆盖', async () => {
  const dir = tempDir('dsh-my-go-metrics-ts-')
  try {
    const m = createMetrics({ dir })
    m.record({ kind: 'a', ts: 12345 })
    await m.close()
    const rows = await readEvents(dir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].ts, 12345, '显式 ts 原样保留')
  } finally {
    await removeHomeWithRetry(dir)
  }
})

test('close 幂等：多次调用均正常 resolve；close 后 record 静默丢弃', async () => {
  const dir = tempDir('dsh-my-go-metrics-close-')
  try {
    const m = createMetrics({ dir })
    m.record({ kind: 'a' })
    await Promise.all([m.close(), m.close(), m.close()])
    m.record({ kind: 'should-not-appear' })
    await drain(25) // 负向窗口：确认 close 后的新事件没有落盘
    const rows = await readEvents(dir)
    assert.deepEqual(rows.map((r) => r.kind), ['a'], 'close 后的新事件零落盘')
  } finally {
    await removeHomeWithRetry(dir)
  }
})

test('enabled=false 零写盘：不建目录、不落文件（验收条款）', async () => {
  // mkdtempSync 会建出外层目录，「零盘触」的断言对象必须是 createMetrics 职责内
  // 的 metrics 根（enabled=true 时由 ensureInit 建立；false 时全程不存在）。
  const outer = tempDir('dsh-my-go-metrics-off-')
  const dir = join(outer, 'metrics-root')
  try {
    const m = createMetrics({ dir, enabled: false })
    m.record({ kind: 'a' })
    m.record({ kind: 'b' })
    await m.close()
    assert.equal(existsSync(dir), false, '关闭态 metrics 根目录不存在（零盘触）')
  } finally {
    await removeHomeWithRetry(outer)
  }
})

test('R0.1 变异探针：fs 失败只 warn 不抛，close 仍正常完成', async () => {
  // 「只读目录」探针的跨平台等价形：Windows 无 POSIX 只读位，用「目标路径被
  // 一个文件占住」复现必然的 fs 失败（mkdir/append 全被击穿）。
  // 变异探针约定：删掉 metrics.mjs 写链的 try/catch，本用例必红——链上
  // rejection 变 unhandledRejection 直接打崩测试进程（或同步抛穿透 record）。
  const parent = tempDir('dsh-my-go-metrics-ro-')
  const blocker = join(parent, 'occupied-by-a-file')
  writeFileSync(blocker, 'not a directory', 'utf-8')
  const { warnings, restore } = captureWarn()
  try {
    const m = createMetrics({ dir: blocker })
    let syncThrew = false
    try {
      m.record({ kind: 'a' })
      m.record({ kind: 'b' })
    } catch {
      syncThrew = true
    }
    assert.equal(syncThrew, false, 'record 同步段绝不抛（fire-and-forget 契约）')
    await m.close()
    assert.ok(warnings.some((w) => w.includes('metrics event write failed')), `fs 失败走了 warn 吞掉路径: ${warnings.join(' | ')}`)
  } finally {
    restore()
    await removeHomeWithRetry(parent)
  }
})

test('R0.2 cap 截头：超限截头保留最新一半，每次截头动作恰一条 warn', async () => {
  const dir = tempDir('dsh-my-go-metrics-cap-')
  const { warnings, restore } = captureWarn()
  try {
    const m = createMetrics({ dir, cap: 4 })
    for (let i = 1; i <= 8; i++) m.record({ kind: `c${i}` })
    await m.close()
    const rows = await readEvents(dir)
    assert.deepEqual(rows.map((r) => r.kind), ['c7', 'c8'], '两次截头（5→keep2→5→keep2）后只剩最新一半')
    const capWarns = warnings.filter((w) => w.includes('exceeded'))
    assert.equal(capWarns.length, 2, '每次截头动作恰好一条 warn（既留痕又不刷屏）')
    assert.equal(METRICS_EVENTS_CAP, 100_000, '默认 cap 与规划 0.1 一致（10 万行）')
  } finally {
    restore()
    await removeHomeWithRetry(dir)
  }
})

test('cap 跨重启续算：初始化数现存行数，重启后 cap 仍然有效', async () => {
  const dir = tempDir('dsh-my-go-metrics-restart-')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(eventsPathOf(dir), [
      JSON.stringify({ ts: 1, kind: 'old-1' }),
      JSON.stringify({ ts: 2, kind: 'old-2' }),
      JSON.stringify({ ts: 3, kind: 'old-3' }),
    ].join('\n') + '\n', 'utf-8')
    const m = createMetrics({ dir, cap: 4 })
    m.record({ kind: 'new-1' })
    m.record({ kind: 'new-2' })
    await m.close()
    const rows = await readEvents(dir)
    assert.deepEqual(rows.map((r) => r.kind), ['new-1', 'new-2'], '3 行存量 + 2 条新事件 = 5 > cap(4)，截头保留文件里最新的 2 行')
  } finally {
    await removeHomeWithRetry(dir)
  }
})

// ── ② broker 接线行为档 ─────────────────────────────────────────────────────

test('broker 接线（默认开）：go_work 派发与 end 落账各产生一行 metrics', async () => {
  const parent = { id: 'parent-mx', session: { header: {} } }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-mx' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-mx-1' })),
  })
  const home = process.env.DSH_HOME
  const metricsDir = join(home, 'dsh-my-go', 'metrics')
  try {
    await broker.apply(ctx, {})
    const r = await tools.get('go_work').execute({ agent: 'explore', prompt: '观测档' }, execOf(parent))
    assert.equal(r.status, 'running', '编排行为零变化（派发照常成功）')
    // 提交制起（0.5.0-tisitan.1）：completed 终局需先 report_submit 才会直通（end 行），
    // 否则走 report-gate-repair（不记 end 行）——本用例主旨是 metrics 接线，先提交。
    const submitArgs = { report: '完整报告全文', conclusion: '结论摘要', evidence: ['src/a.js:12'], open: '无' }
    const expectedSummary = [
      '结论摘要',
      '证据:',
      '- src/a.js:12',
      '遗留: 无',
      '全文落板，report_fetch childId=sess-mx-1 切片取阅',
    ].join('\n')
    await tools.get('report_submit').execute(submitArgs, execOf({ id: 'sess-mx-1', session: { header: { parentSession: 'parent-mx' } } }))
    dispatch('subagent/end', { id: 'sess-mx-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '自由收尾一句话' }] })
    // 谓词读的是断言真正消费的观测量：events.jsonl 里出现 end 行（无固定 sleep）
    const rows = await readEventsWhen(metricsDir, (list) => list.some((row) => row.kind === 'end'))
    const dispatchRow = rows.find((row) => row.kind === 'dispatch')
    assert.ok(dispatchRow, 'dispatch 行在册')
    assert.equal(dispatchRow.agentType, 'explore')
    assert.equal(dispatchRow.promptBytes, '观测档'.length)
    assert.equal(typeof dispatchRow.ts, 'number')
    const endRow = rows.find((row) => row.kind === 'end')
    assert.equal(endRow.childId, 'sess-mx-1')
    assert.equal(endRow.agentType, 'explore')
    assert.equal(endRow.stopReason, 'completed')
    assert.equal(endRow.conclusionBytes, expectedSummary.length, '报告大小分布观测量 = 合成回执内芯 .length（规划 0.1 口径）')
    assert.equal(typeof endRow.runMs, 'number', 'runMs = end 与 spawning 占位 createdAt 之差')
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('broker 接线（config.metrics=false）：编排照常、零 metrics 写盘', async () => {
  const parent = { id: 'parent-mx2', session: { header: {} } }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-mx2' ? parent : undefined) },
    startContinuable: withRealSignalContract(async () => ({ childId: 'sess-mx-2' })),
  })
  const home = process.env.DSH_HOME
  try {
    // metrics 开关与报告闸门正交：关掉提交闸（本用例不做提交登记）专测零写盘
    await broker.apply(ctx, { metrics: false, reportExternalization: false })
    await tools.get('go_work').execute({ agent: 'explore', prompt: '关闭档' }, execOf(parent))
    dispatch('subagent/end', { id: 'sess-mx-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done' }] })
    // 负向窗口：先等编排终局落定（证明开关不影响编排行为），再断言「坏事不发生」
    await waitFor(() => snapOf('parent-mx2')?.history?.length === 1, { what: 'end 落账' })
    await drain(30)
    assert.equal(existsSync(join(home, 'dsh-my-go', 'metrics')), false, '关闭态零写盘（连目录都不建）')
  } finally {
    await removeHomeWithRetry(home)
  }
})
