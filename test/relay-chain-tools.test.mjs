// dsh-my-go — chain_start / chain_resolve 主编工具行为档（三期步骤 3.3）。
//
// 规格出处：docs/plans/relay-chain-semantics.md §一（R-a~R-l，R-c 已废除）+
// 规划 3.3。状态机决策本体已由 relay-chain.test.mjs 直测（T1~T17），本文件锁
// 工具层：注册开关门（R-g）、D23 fail-fast（R-h）、roster/结构双闸（R-a）、
// 单活跃链（R-f/D25）、canOrchestrate 与子代理 deny 双保险、T1 首派端到端
// （enqueue→上岗→spawn prompt 形态）、chain_resolve 各 suspendReason 分派与
// T8 赛跑预查、台账 v3 round-trip（D12/D28）。
// 挂起态夹具用白盒变形（snapshotNow 拿链引用改 state）：3.3 阶段无 hop-end
// 归因回调（3.4 接线），无法经事件流自然抵达挂起态——变形只造「抵达后的现场」，
// 被锚定的行为全是工具层自己的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapshotNow, waitFor, removeHomeWithRetry } from './helpers/mock-ctx.mjs'

const PARENT = { id: 'parent-c', session: { header: {} } }
const CHILD = { id: 'sess-sub', session: { header: { parentSession: 'parent-c' } } }
const DECL_AUTO2 = [{ agent: 'explore', prompt: '任务A' }, { agent: 'librarian', prompt: '任务B' }]

let spawnSeq = 0

// 链工具批统一替身：relayChains 缺省开（本文件专测工具层）、startContinuable
// 捕获 spawn 载荷、agents 注册主编（resolveParentAgent/notifyOwner 通路）。
async function chainCtx(config = {}) {
  const spawned = []
  const { ctx, dispatch, tools, restricted, home } = createMockCtx({
    agents: { get: (id) => (id === PARENT.id ? PARENT : undefined) },
    captureRestrict: true, // deny 闸断言的数据源（agent/created → tools.restrict 捕获）
    startContinuable: withRealSignalContract(async (spec) => {
      const childId = `sess-gen-${++spawnSeq}`
      spawned.push({ spec, childId })
      return { childId }
    }),
    homePrefix: 'dsh-my-go-chain-',
  })
  await broker.apply(ctx, { relayChains: true, readPoolSize: 2, queueRetryBaseMs: 5, ...config })
  return { ctx, dispatch, tools, restricted, spawned, home: process.env.DSH_HOME }
}

// 把实例内第 idx 条链变形为挂起态（白盒夹具：跳过 3.4 才接线的归因事件流）。
function suspendChainAt(pid, idx, suspendReason, { cursor, hopChildId = null } = {}) {
  const chain = snapshotNow().parents[pid].chains[idx]
  assert.ok(chain, `夹具链不存在: index ${idx}`)
  Object.assign(chain, { state: 'suspended', suspendReason, cursor: cursor ?? chain.cursor, hopChildId, hopWorkId: null })
  return chain
}

// ── 注册开关门与 D23 ──────────────────────────────────────────────────────────

test('R-g: relayChains 缺省关 → 两工具不在册；显式 false 同', async () => {
  const a = await chainCtx({ relayChains: undefined })
  try {
    assert.equal(a.tools.get('chain_start'), undefined, '缺省关 = 不注册（D5 三期默认关）')
    assert.equal(a.tools.get('chain_resolve'), undefined)
  } finally { await removeHomeWithRetry(a.home) }
  const b = await chainCtx({ relayChains: false })
  try {
    assert.equal(b.tools.get('chain_start'), undefined)
  } finally { await removeHomeWithRetry(b.home) }
})

test('D15: description 自教完备——gate 三型语义 / auto read→read / sync 现场必填 / D13 无超时 / D23 依赖声明', async () => {
  const { tools, home } = await chainCtx()
  try {
    const start = tools.get('chain_start')
    assert.ok(start, 'relayChains: true → 在册')
    assert.match(start.description, /"auto" \(default\): dispatch immediately/)
    assert.ok(start.description.includes('Read→read hops only'), 'auto 仅读→读（D24）')
    assert.ok(start.description.includes('MUST supply a fresh prompt'), 'sync 现场必填（R-k）')
    assert.ok(/reportExternalization=true/i.test(start.description), 'D23 依赖声明写进 description')
    assert.ok(/NO timeout auto-resume/i.test(start.description), 'D13 永久挂起可观测兜底')
    const resolve = tools.get('chain_resolve')
    assert.ok(/fallback.*re-binds the chain to the new generation/is.test(resolve.description), 'D10 语义自教')
    assert.ok(/NOT interrupted/.test(resolve.description), '链 abort 不掐在飞子代（§4.2-③）')
  } finally { await removeHomeWithRetry(home) }
})

test('R-h(D23): REPORT_EXT 关 → chain_start 在册但 execute fail-fast 报依赖（不静默降级）', async () => {
  const { tools, home } = await chainCtx({ reportExternalization: false })
  try {
    const tool = tools.get('chain_start')
    assert.ok(tool, '链开关与报告开关彼此独立：工具在册，运行时守门')
    await assert.rejects(
      () => tool.execute({ hops: DECL_AUTO2 }, execOf(PARENT)),
      /reportExternalization=true/,
      'D23 fail-fast：报错指路 config，绝不开第二真相源',
    )
  } finally { await removeHomeWithRetry(home) }
})

// ── 校验面（R-a / R-b / R-d / R-f）────────────────────────────────────────────

test('R-a: roster 双闸——未知 agent 在结构校验之前被 roster 闸拒绝并指路花名册', async () => {
  const { tools, home } = await chainCtx()
  try {
    await assert.rejects(
      () => tools.get('chain_start').execute({ hops: [{ agent: 'no-such-role', prompt: 'x' }, { agent: 'explore', prompt: 'y' }] }, execOf(PARENT)),
      /not in the live roster/,
    )
  } finally { await removeHomeWithRetry(home) }
})

test('结构闸: auto 无 prompt / 首 gate 非 auto / 长度不足——报错含错误码与指路', async () => {
  const { tools, home } = await chainCtx()
  try {
    const start = tools.get('chain_start')
    await assert.rejects(() => start.execute({ hops: [{ agent: 'explore' }, { agent: 'librarian', prompt: 'B' }] }, execOf(PARENT)), /auto-prompt:0/, 'R-d：auto 指令只能预写')
    await assert.rejects(() => start.execute({ hops: [{ agent: 'explore', prompt: 'A', gate: 'review' }, { agent: 'librarian', prompt: 'B' }] }, execOf(PARENT)), /first-gate/, 'R-b：声明即审')
    await assert.rejects(() => start.execute({ hops: [{ agent: 'explore', prompt: 'A' }] }, execOf(PARENT)), /hops-length:1/)
    // D24：explore→hermes 不得 auto（write 本跳）
    await assert.rejects(() => start.execute({ hops: [{ agent: 'explore', prompt: 'A' }, { agent: 'hermes', prompt: 'B' }] }, execOf(PARENT)), /auto-lane:1/)
  } finally { await removeHomeWithRetry(home) }
})

test('R-f(D25): 已有活跃链 → 拒绝并回显既有链 id/state；终态链不挡新链', async () => {
  const { tools, home } = await chainCtx()
  try {
    await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    await assert.rejects(
      () => tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT)),
      /active relay chain already exists.*chain-/,
    )
    // 终态链（白盒变形为 done）不挡
    const chain = snapshotNow().parents[PARENT.id].chains[0]
    Object.assign(chain, { state: 'done', cursor: chain.hops.length })
    const r = await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    assert.equal(r.ok, true)
  } finally { await removeHomeWithRetry(home) }
})

// ── T1 首派端到端（工具层 → 队列基建 → spawn 载荷）────────────────────────────

test('T1(端到端): chain_start 首跳入队并驱动上岗——spawn 载荷含预写指令 + SUMMARY_CLAUSE，泳道锁同源', async () => {
  const { tools, spawned, home } = await chainCtx()
  try {
    const r = await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    assert.equal(r.ok, true)
    assert.match(r.chainId, /^chain-/)
    assert.equal(r.hopCount, 2)
    assert.ok(r.workId, '首跳 enqueue 返回 work 占位 id')
    assert.equal(r.state, 'running')
    // enqueue → advanceQueue 驱动上岗：spawn 已被调（异步链落定后断言）
    await waitFor(() => spawned.length === 1, { what: 'first hop spawn' })
    const prompt = spawned[0].spec.request.prompt
    assert.equal(prompt[0].text, '任务A', 'instruction 原文即 prompt[0]（3.3 口径：数据块包装归 3.4）')
    assert.ok(prompt[1].text.includes('[报告提交条款'), 'REPORT_CLAUSE 由 spawnChild 尾注照常（REPORT_EXT 缺省开）')
    // 快照面：占位记录入 currentMap（beginSpawning），链随快照可见（D13 数据源）
    const snap = snapshotNow().parents[PARENT.id]
    assert.equal(snap.chains.length, 1)
    assert.equal(snap.chains[0].state, 'running')
    assert.equal(snap.chains[0].cursor, 0)
  } finally { await removeHomeWithRetry(home) }
})

test('canOrchestrate + deny 双保险：子代理侧运行时拒 + agent/created 目录层摘除', async () => {
  const { tools, dispatch, home } = await chainCtx()
  try {
    // 运行时守卫：子代理（有 parentSession）调用直接抛
    await assert.rejects(
      () => tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(CHILD)),
      /reserved for orchestrator sessions/,
    )
    await assert.rejects(
      () => tools.get('chain_resolve').execute({ chainId: 'chain-x', decision: 'abort' }, execOf(CHILD)),
      /reserved for orchestrator sessions/,
    )
    // 目录层：agent/created 对子代理 restrict 的 deny 名单含两新名（agent.ctx
    // 是子代理自己的作用域——夹具带一个 restrict 捕获器）
    const restrictCalls = []
    dispatch('agent/created', { agent: { ...CHILD, ctx: { tools: { restrict: (f) => restrictCalls.push(f) } } } })
    const subGate = restrictCalls.find((r) => Array.isArray(r.deny) && r.deny.includes('chain_start'))
    assert.ok(subGate, '子代理 deny 名单含 chain_start（deny 探针的锚点行为）')
    assert.ok(subGate.deny.includes('chain_resolve'), '子代理 deny 名单含 chain_resolve')
  } finally { await removeHomeWithRetry(home) }
})

// ── chain_resolve 行为分派（R-i / R-j / R-k / T8 赛跑预查）────────────────────

test('chain_resolve: 未知链 id / 非 suspended（R-i）/ abort 带 prompt（R-j）全部拒绝且指路', async () => {
  const { tools, home } = await chainCtx()
  try {
    await assert.rejects(
      () => tools.get('chain_resolve').execute({ chainId: 'chain-none', decision: 'continue' }, execOf(PARENT)),
      /unknown relay chain id/,
    )
    await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    const chainId = snapshotNow().parents[PARENT.id].chains[0].id
    // running 态（首跳在飞）→ R-i
    await assert.rejects(
      () => tools.get('chain_resolve').execute({ chainId, decision: 'continue' }, execOf(PARENT)),
      /not suspended/,
    )
    // 白盒变形为挂起 → abort 带 prompt 被 R-j 拦
    suspendChainAt(PARENT.id, 0, 'review')
    await assert.rejects(
      () => tools.get('chain_resolve').execute({ chainId, decision: 'abort', prompt: '不该带' }, execOf(PARENT)),
      /not accepted with decision="abort"/,
    )
  } finally { await removeHomeWithRetry(home) }
})

test('chain_resolve review continue：预写兜底放行 → 待派发跳入队并驱动上岗；通知走 notifyOwner', async () => {
  const { tools, spawned, home } = await chainCtx()
  try {
    await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    await waitFor(() => spawned.length >= 1, { what: 'first hop spawn' })
    // 白盒推进：跳 0 已终局、cursor 指向待派发跳 1（3.4 接线前无自然事件流）
    const chain = suspendChainAt(PARENT.id, 0, 'review', { cursor: 1 })
    const r = await tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'continue' }, execOf(PARENT))
    assert.equal(r.ok, true)
    assert.equal(r.state, 'running')
    assert.ok(r.workId, '放行 = 待派发跳入队')
    await waitFor(() => spawned.length === 2, { what: 'second hop spawn' })
    assert.equal(spawned[1].spec.request.prompt[0].text, '任务B', '无现场 prompt → 回落预写（R-k）')
  } finally { await removeHomeWithRetry(home) }
})

test('chain_resolve sync: 无现场 prompt 拒绝（R-k，报错可读）；带现场 → 指令用现场文本', async () => {
  const { tools, spawned, home } = await chainCtx()
  try {
    await tools.get('chain_start').execute({ hops: [{ agent: 'explore', prompt: 'A' }, { agent: 'prometheus', gate: 'sync' }] }, execOf(PARENT))
    await waitFor(() => spawned.length >= 1, { what: 'first hop spawn' })
    const chain = suspendChainAt(PARENT.id, 0, 'sync', { cursor: 1 })
    await assert.rejects(
      () => tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'continue' }, execOf(PARENT)),
      /prompt is REQUIRED/,
      'sync 恒现场必填——预写兜底不存在',
    )
    const r = await tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'continue', prompt: '亲笔的不可逆指令' }, execOf(PARENT))
    assert.equal(r.ok, true)
    await waitFor(() => spawned.length === 2, { what: 'sync hop spawn' })
    assert.equal(spawned[1].spec.request.prompt[0].text, '亲笔的不可逆指令', 'INV-2：sync 指令来自闸门现场')
  } finally { await removeHomeWithRetry(home) }
})

test('T8 赛跑预查(D10): fallback continue——世代已终局 → 直接推进不二次挂起；在飞 → resume 换绑等待', async () => {
  // settled 现场用真实事件流造：首跳 spawn → dispatch subagent/end（completed）
  // → E7 finalize 入 history（3.3 阶段 processEnd 尚无链匹配回调，链不受扰——
  // 这正是 3.4 接线后「end 先于裁决到达」的自然形态）。
  const { tools, spawned, dispatch, home } = await chainCtx()
  try {
    await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    await waitFor(() => spawned.length === 1, { what: 'first hop spawn' })
    const genId = spawned[0].childId
    // 先落提交登记（闸门 pass 的判定源），再派 completed end——闸门 pass →
    // 板上是 report 原文 → T2 直投有板可读（未提交的 end 会走 E9 补发，另一条路径）。
    // 注意：3.4 起合格的 end 会立刻触发链的 T2 自动推进（直投 hop1 入队上岗），
    // 变形前必须等这条异步链落定——否则变形与直投竞态（reconcile 会正确拒绝
    // suspended 态的回填，链状态被截在半程）。
    await tools.get('report_submit').execute(
      { report: '已终局的完整产出全文', conclusion: '已终局的产出', evidence: ['无'], open: '无' },
      execOf({ id: genId, session: { header: { parentSession: PARENT.id } } }),
    )
    dispatch('subagent/end', { id: genId, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '已终局的产出' }] })
    await waitFor(() => spawned.length === 2, { what: 'T2 auto-advanced hop1 (chain self-ran)' })
    await waitFor(() => snapshotNow().parents[PARENT.id].history.some((r) => r.childId === genId), { what: 'generation settled into history' })
    // 链挂起 fallback 绑该世代（主编裁决晚于终局的赛跑现场）
    const chain = suspendChainAt(PARENT.id, 0, 'fallback', { cursor: 0, hopChildId: genId })
    const r = await tools.get('chain_resolve').execute({ chainId: chain.id, decision: 'continue' }, execOf(PARENT))
    assert.equal(r.ok, true)
    assert.equal(r.state, 'running')
    assert.ok(r.workId, 'settled 自查 → 直接 T2 派发下一跳（不二次挂起）')
    assert.equal(chain.cursor, 1)
    await waitFor(() => spawned.length === 2, { what: 'next hop spawn after settled resume' })
    // unsettled 分支：世代在飞（currentMap 在册）→ 预查不命中 → resume 换绑等待
    const genLive = spawned[1].childId
    const chain2 = suspendChainAt(PARENT.id, 0, 'fallback', { cursor: 0, hopChildId: genLive })
    const r2 = await tools.get('chain_resolve').execute({ chainId: chain2.id, decision: 'continue' }, execOf(PARENT))
    assert.equal(r2.ok, true)
    assert.equal(r2.state, 'running')
    assert.equal(r2.workId, undefined, 'resume 不派发——等世代自己的 end')
    assert.equal(chain2.hopChildId, genLive, 'T11 世代保持换绑值')
  } finally { await removeHomeWithRetry(home) }
})

// ── 台账 v3 round-trip（D12/D28）──────────────────────────────────────────────

test('台账 v3: 建链落盘 → 全新 apply 恢复——running 归一 suspended(restart)（D28），运行时键作废', async () => {
  const { ctx, tools, home } = await chainCtx()
  try {
    const r = await tools.get('chain_start').execute({ hops: DECL_AUTO2 }, execOf(PARENT))
    // 等防抖窗（250ms）后的落盘出现 chains 桶——有界轮询（waitFor 不吃 async 谓词，
    // Promise 恒真会让它假通过；此循环与 waitFor 同性质：等条件成立，超时显式抛）
    const ledgerFile = join(home, 'dsh-my-go', 'orchestration-ledger.json')
    const deadline = Date.now() + 3000
    let onDisk = null
    for (;;) {
      try {
        const raw = JSON.parse(await readFile(ledgerFile, 'utf-8'))
        if (raw?.version === 3 && raw?.chains?.[PARENT.id]?.length === 1) { onDisk = raw; break }
      } catch { /* 尚未落盘，继续轮询 */ }
      if (Date.now() > deadline) throw new Error('timed out waiting for ledger v3 chains bucket')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(onDisk.chains[PARENT.id][0].id, r.chainId)
    // 全新 apply = 重启等价：loadLedger v3 分支恢复 + 归一（keepHome 复用同一
    // 份台账文件；createMockCtx keepHome 不动 DSH_HOME，仍是上面那个 home）。
    // spawn 通路照配（独立捕获数组）——restart continue 的 T9 重派要真上岗，
    // 不给回补重试留噪音。
    const rebornSpawned = []
    const reborn = createMockCtx({
      agents: { get: (id) => (id === PARENT.id ? PARENT : undefined) },
      startContinuable: withRealSignalContract(async (spec) => {
        const childId = `sess-reborn-${++spawnSeq}`
        rebornSpawned.push({ spec, childId })
        return { childId }
      }),
      homePrefix: 'dsh-my-go-chain-reborn-',
      keepHome: true,
    })
    await broker.apply(reborn.ctx, { relayChains: true, readPoolSize: 2, queueRetryBaseMs: 5 })
    const restored = snapshotNow().parents[PARENT.id].chains
    assert.equal(restored.length, 1)
    assert.equal(restored[0].id, r.chainId)
    assert.equal(restored[0].state, 'suspended', 'running 不可跨进程复得 → T17 归一')
    assert.equal(restored[0].suspendReason, 'restart')
    assert.equal(restored[0].hopWorkId, null)
    assert.equal(restored[0].hopChildId, null)
    // 恢复后的 restart 链可被 chain_resolve 处置（T9 重派口径）
    const res = await reborn.tools.get('chain_resolve').execute({ chainId: r.chainId, decision: 'continue' }, execOf(PARENT))
    assert.equal(res.ok, true)
    assert.equal(res.state, 'running', 'T9: restart continue = 重派 cursor 跳')
    assert.ok(res.workId)
    await waitFor(() => rebornSpawned.length === 1, { what: 're-dispatched hop spawn' })
    assert.equal(rebornSpawned[0].spec.request.prompt[0].text, '任务A', '重派用预写指令（hop 0）')
  } finally { await removeHomeWithRetry(home) }
})
