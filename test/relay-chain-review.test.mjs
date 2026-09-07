// dsh-my-go — 三档审阅门 + 同步门的呈现面与生命周期（三期步骤 3.5）。
//
// 规格出处：docs/plans/next-gen-architecture-0.4.0.md 步骤 3.5 :322-330 +
// relay-chain-semantics.md §二（review/sync 挂起语义）/§五（D13 快照注入兜底、
// §5.2 属主销毁清理、§5.4 metrics）。链轴决策本体归 relay-chain.test.mjs，
// 工具行为归 relay-chain-tools.test.mjs，直投行为归 relay-chain-relay.test.mjs；
// 本文件锁 3.5 的四件事：
//   ① review/sync 挂起的可观测面（orchestration_status 链行 + 挂起通知裁决信息）
//   ② 面板半 chains 消费（prompt 剥除，D13 链行原样可见）
//   ③ R4 终局真空探针（挂起后主编会话销毁 → 链随 orchestration 清理并留痕）
//   ④ 移交②闭环（E9 verdict 落账补落板 → gate-verdict 带病续链的直投有板可读）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { trimSnapshotForPanel } from '../lib/index.js'
import { createMockCtx, withRealSignalContract, execOf, snapshotNow, waitFor, removeHomeWithRetry } from './helpers/mock-ctx.mjs'

// 提交制下 completed end 的消息形态自由（不再解析），闸门判定源是提交登记——
// 用例经 reviewCtx.submitReport 先登记再派 end。
const GOOD_END = (text) => ({ id: '', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text }] })

let spawnSeq = 0

async function reviewCtx(config = {}, { spawn } = {}) {
  const injects = []
  const spawned = []
  const PARENT = { id: 'parent-v', session: { header: {} }, inject: (msg) => injects.push(msg) }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === PARENT.id ? PARENT : undefined) },
    startContinuable: spawn ?? withRealSignalContract(async (spec) => {
      const childId = `sess-gen-${++spawnSeq}`
      spawned.push({ spec, childId })
      return { childId }
    }),
    homePrefix: 'dsh-my-go-review-',
  })
  await broker.apply(ctx, { relayChains: true, readPoolSize: 2, queueRetryBaseMs: 5, ...config })
  const submitReport = async (childId, conclusion = '结论') => {
    await tools.get('report_submit').execute(
      { report: `完整报告全文（${conclusion}）：实施细节与全部证据。`, conclusion, evidence: ['无'], open: '无' },
      { agent: { id: childId, session: { header: { parentSession: PARENT.id } } }, signal: new AbortController().signal },
    )
  }
  return { ctx, dispatch, tools, spawned, injects, PARENT, submitReport, home: process.env.DSH_HOME }
}

test('review 门：hop0 合格 → 链挂起；status 链行可读；通知带跳号/工种/摘要/report_fetch 指针', async () => {
  const { tools, spawned, injects, PARENT, dispatch, home, submitReport } = await reviewCtx()
  try {
    await tools.get('chain_start').execute({ hops: [{ agent: 'explore', prompt: '任务A' }, { agent: 'librarian', prompt: '任务B', gate: 'review' }] }, execOf(PARENT))
    await waitFor(() => spawned.length === 1, { what: 'hop1 spawn' })
    const gen1 = spawned[0].childId
    await submitReport(gen1, '检索结论摘要行')
    dispatch('subagent/end', { ...GOOD_END('检索结论摘要行'), id: gen1 })
    // T3：下一跳 review → 链挂起（永不超时放行，D13）
    await waitFor(() => snapshotNow().parents[PARENT.id]?.chains?.[0]?.state === 'suspended', { what: 'chain suspended(review)' })
    const chain = snapshotNow().parents[PARENT.id].chains[0]
    assert.equal(chain.suspendReason, 'review')
    assert.equal(chain.cursor, 1)
    assert.equal(chain.prevHopChildId, gen1)
    // D13 可观测兜底：orchestration_status 每次自查都渲染挂起链行（§5.1 格式）
    const status = await tools.get('orchestration_status').execute({}, execOf(PARENT))
    assert.match(status.text, new RegExp(`⛓ relay-chain ${chain.id} \\[suspended:review\\] hop 2/2 \\(librarian\\) — await resolve \\(chain_resolve\\)`))
    // 挂起通知 = 三档审阅的裁决信息面：跳号 + 工种 + 上一跳摘要 + report_fetch/chain_resolve 指针
    const notice = injects.map((m) => String(m.content?.[0]?.text ?? '')).join('\n')
    assert.match(notice, /挂起待审 \[review\]/)
    assert.match(notice, new RegExp(`report_fetch childId=${gen1}`))
    assert.match(notice, /chain_resolve/)
    assert.match(notice, /检索结论摘要行/)
  } finally { await removeHomeWithRetry(home) }
})

test('sync 门：write 跳恒挂起（无 auto 档），链行 [suspended:sync] 渲染；终态链不出现在 status', async () => {
  const { tools, spawned, PARENT, dispatch, home, submitReport } = await reviewCtx()
  try {
    await tools.get('chain_start').execute({ hops: [{ agent: 'explore', prompt: '任务A' }, { agent: 'hermes', prompt: '施工任务', gate: 'sync' }] }, execOf(PARENT))
    await waitFor(() => spawned.length === 1, { what: 'hop1 spawn' })
    await submitReport(spawned[0].childId, '探明结论')
    dispatch('subagent/end', { ...GOOD_END('探明结论'), id: spawned[0].childId })
    await waitFor(() => snapshotNow().parents[PARENT.id]?.chains?.[0]?.state === 'suspended', { what: 'chain suspended(sync)' })
    const chain = snapshotNow().parents[PARENT.id].chains[0]
    assert.equal(chain.suspendReason, 'sync')
    const status = await tools.get('orchestration_status').execute({}, execOf(PARENT))
    assert.match(status.text, new RegExp(`⛓ relay-chain ${chain.id} \\[suspended:sync\\] hop 2/2 \\(hermes\\)`))
    // 主编弃链后：终态链不再渲染（status 面只看活链）
    await tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'abort' }, execOf(PARENT))
    const status2 = await tools.get('orchestration_status').execute({}, execOf(PARENT))
    assert.ok(!status2.text.includes('⛓ relay-chain'), 'aborted 链不渲染')
  } finally { await removeHomeWithRetry(home) }
})

test('面板半投影：chains 透传 + 每跳 prompt 剥除（状态面全保留）', () => {
  const chain = {
    id: 'chain-x', parentSessionId: 'p', cursor: 1, state: 'suspended', suspendReason: 'review',
    hopWorkId: null, hopChildId: null, prevHopChildId: 'sess-gen-1', createdAt: 1, updatedAt: 2,
    hops: [{ agent: 'explore', prompt: '主编预写全文，面板不许看', gate: 'auto' }, { agent: 'librarian', prompt: '另一条预写', gate: 'review' }],
  }
  const out = trimSnapshotForPanel({ parents: { p: { chains: [chain] } } })
  const projected = out.parents.p.chains[0]
  assert.equal(projected.id, 'chain-x')
  assert.equal(projected.state, 'suspended')
  assert.equal(projected.suspendReason, 'review')
  assert.equal(projected.cursor, 1)
  assert.deepEqual(projected.hops, [{ agent: 'explore', gate: 'auto' }, { agent: 'librarian', gate: 'review' }])
  assert.ok(!JSON.stringify(out).includes('主编预写全文'), 'prompt 一个字节都不过线')
  // 非法形状原样透传（不炸面板）
  const passthrough = trimSnapshotForPanel({ parents: { q: { chains: 'garbage' } } })
  assert.equal(passthrough.parents.q.chains, 'garbage')
})

test('R4(终局真空探针): 挂起链随主编会话销毁清理并留痕（warn + 台账桶消失），绝不无声悬挂', async (t) => {
  const warnMock = t.mock.method(console, 'warn')
  const { tools, spawned, PARENT, dispatch, home, submitReport } = await reviewCtx()
  try {
    await tools.get('chain_start').execute({ hops: [{ agent: 'explore', prompt: '任务A' }, { agent: 'librarian', prompt: '任务B', gate: 'review' }] }, execOf(PARENT))
    await waitFor(() => spawned.length === 1, { what: 'hop1 spawn' })
    await submitReport(spawned[0].childId, '摘要')
    dispatch('subagent/end', { ...GOOD_END('摘要'), id: spawned[0].childId })
    await waitFor(() => snapshotNow().parents[PARENT.id]?.chains?.[0]?.state === 'suspended', { what: 'chain suspended' })
    // 挂起已落盘（chains 桶在台账上）。注意：waitFor 不支持 async 谓词（Promise
    // 恒真，3.3 教训）——台账/板面轮询一律 readFileSync 同步读。
    const ledgerPath = join(home, 'dsh-my-go', 'orchestration-ledger.json')
    const readLedger = () => { try { return JSON.parse(readFileSync(ledgerPath, 'utf-8')) } catch { return null } }
    await waitFor(() => { const l = readLedger(); return l !== null && l.chains !== undefined && l.chains[PARENT.id] !== undefined }, { what: 'chains bucket persisted' })
    // 主编会话销毁（R4 主战场：§5.2）
    dispatch('session/disposed', { id: PARENT.id })
    assert.equal(snapshotNow().parents[PARENT.id], undefined, '编排实例同点摘除')
    // 台账 chains 桶消失（D27：主编会话已灭，链账无消费方，不留 aborted 行）。
    // 提交制起 gate pass 路径多一次落板异步写，全量并发下 fs 竞争变挤——放宽时限。
    await waitFor(() => { const l = readLedger(); return l === null || l.chains?.[PARENT.id] === undefined }, { what: 'chains bucket purged from ledger', timeoutMs: 10000 })
    // 留痕面：每条非终态链 warn 一行 aborted-by-dispose（§5.2 双留痕的日志半）
    assert.ok(
      warnMock.mock.calls.some((c) => String(c.arguments[0]).includes('aborted-by-dispose') && String(c.arguments[0]).includes(String(PARENT.id))),
      '销毁留痕必须到达（不得无声悬挂）',
    )
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('移交②闭环: E9 verdict 落账补落板 → gate-verdict 带病续链的直投有板可读', async () => {
  const { tools, spawned, injects, PARENT, dispatch, home } = await reviewCtx()
  try {
    // 全 auto 链：verdict 挂起后主编 continue → T2 直投下一跳（读上一跳板）
    const r = await tools.get('chain_start').execute({ hops: [{ agent: 'explore', prompt: '任务A' }, { agent: 'librarian', prompt: '任务B' }] }, execOf(PARENT))
    assert.equal(r.ok, true)
    await waitFor(() => spawned.length === 1, { what: 'hop1 spawn' })
    const gen1 = spawned[0].childId
    // 未提交的 end：E9 报告补发 → 投递失败（替身无邻接通道）→ verdict 落账
    dispatch('subagent/end', { id: gen1, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '裸全文正文（未交报告）' }] })
    // T16：补发失败落账 → 链挂起 gate-verdict（等主编「带病续链 or 弃链」）
    await waitFor(() => snapshotNow().parents[PARENT.id]?.chains?.[0]?.state === 'suspended', { what: 'chain suspended(gate-verdict)' })
    const chain = snapshotNow().parents[PARENT.id].chains[0]
    assert.equal(chain.suspendReason, 'gate-verdict')
    // 移交②主断言：verdict 落账路径把全文补上了板（幂等落板）——直投读得到。
    // 同步轮询（waitFor 不支持 async 谓词）；全量并发下 fs 竞争慢，放宽时限。
    const boardPath = join(home, 'dsh-my-go', 'board', PARENT.id, `${gen1}.md`)
    await waitFor(() => {
      try { return readFileSync(boardPath, 'utf-8').includes('裸全文正文（未交报告）') } catch { return false }
    }, { what: 'verdict fulltext persisted to board', timeoutMs: 10000 })
    // 带病续链：主编裁决 continue → settled 自查 pass → T2 直投 hop2，数据块有货
    const res = await tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'continue' }, execOf(PARENT))
    assert.equal(res.ok, true)
    await waitFor(() => spawned.length === 2, { what: 'hop2 dispatched with data block', timeoutMs: 10000 })
    const prompt = spawned[1].spec.request.prompt[0].text
    assert.ok(prompt.startsWith('任务B\n\n<mygo_relay_input trusted="false"'), '直投指令在前')
    assert.ok(prompt.includes('裸全文正文（未交报告）'), 'verdict 落账的全文经板进入数据块')
    assert.ok(injects.some((m) => String(m.content?.[0]?.text ?? '').includes('[gate-verdict]')), 'T16 挂起通知到达主编')
  } finally { await removeHomeWithRetry(home) }
})
