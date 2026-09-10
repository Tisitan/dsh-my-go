// 跨半集成（0.4.0 用量统计收官，步骤 7/7）：broker 落账面 ↔ lib 聚合读面的
// 台账契约。orchestration 流（broker.apply + go_work spawn + subagent/end）把
// 台账行写进临时 DSH_HOME 的真台账文件，usage 事件造在持久化 zstd 档案（与
// 台账 childId 对齐），host 半 getUsage 出账。live 快路径的聚合语义已有
// usage-aggregator.test.mjs 全套单测；本例专证「orchestration 流写下的台账行
// 恰是聚合器读的形状」——两半各自为政的测试都绿也拦不住的形状漂移在这里红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import * as broker from '../preset/tools/broker.mjs'
import { apply as hostApply } from '../lib/index.js'
import { projectKey } from '../preset/shared/archive.mjs'
import { createMockCtx, withRealSignalContract, execOf, waitFor, removeHomeWithRetry, createPanelRpcTransport } from './helpers/mock-ctx.mjs'

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
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage },
})

test('集成：broker spawn+end 落账 → 档案 usage 帧 → lib getUsage 出账（台账契约贯通）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-my-go-usage-integ-'))
  const prevHome = process.env.DSH_HOME
  // keepHome 前置：createMockCtx 默认每次重置 DSH_HOME，台账会写进它自己的
  // 临时目录而不是本用例的 home——双半必须共享同一个 DSH_HOME 才有集成可言。
  process.env.DSH_HOME = home
  try {
    // ── orchestration 流：真 broker apply + spawn + end 落账 ──────────────
    const parent = { id: 'parent-1', session: { header: {} } }
    const { ctx, dispatch, tools } = createMockCtx({
      keepHome: true,
      homePrefix: 'unused-',
      agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
      startContinuable: withRealSignalContract(async () => ({ childId: 'sess-9' })),
    })
    await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
    const goWork = tools.get('go_work')
    await goWork.execute({ agent: 'hermes', prompt: 'probe' }, execOf(parent))
    dispatch('subagent/end', { id: 'sess-9', stopReason: 'completed', lastAssistantMessage: [] })

    // ── usage 事件：真 zstd 多帧档案，childId 与台账行对齐（F5 档案主路径）──
    // 父会话 parent-1 自身的 usage 帧同样造进档案（D6，独用模型 m0 以验证
    // self 段独立并入 byModel）：主编排会话的消耗走同一落盘形状，聚合器按
    // sessionId 直读，无需任何台账行。
    const writeArchive = (sessionId, frames_) => {
      const dir = join(home, 'sessions', projectKey(process.cwd()), sessionId)
      mkdirSync(dir, { recursive: true })
      const container = frames_.map((lines) => zstdCompressSync(Buffer.from(lines.map((rec) => JSON.stringify(rec) + '\n').join(''))))
      writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat(container))
    }
    writeArchive('parent-1', [
      [header(0, 'prov-self', 'm0'), msg(1, { inputTokens: 10, outputTokens: 5 })],
      [header(2, 'prov-self', 'm0'), msg(3, { inputTokens: 7, outputTokens: 3 })],
    ])
    writeArchive('sess-9', [
      [header(0, 'prov-a', 'm1'), msg(1, { inputTokens: 10, outputTokens: 5 })],
      [header(2, 'prov-b', 'm2'), msg(3, { inputTokens: 7, outputTokens: 3 })],
    ])

    // 台账是防抖写盘：等到 sess-9 行真的落进 orchestration-ledger.json
    const ledgerFile = join(home, 'dsh-my-go', 'orchestration-ledger.json')
    await waitFor(() => {
      try {
        const parsed = JSON.parse(readFileSync(ledgerFile, 'utf-8'))
        return parsed?.parents?.['parent-1']?.some((row) => row.childId === 'sess-9')
      } catch { return false }
    }, { what: 'broker 台账落盘 sess-9 行' })

    // ── lib 半出账：真 hostApply RPC 接线（installPreset: false 不抢测试装置）──
    const settings = { register: () => ({}), get: () => undefined, mutate: async () => {} }
    const panel = createPanelRpcTransport()
    const hostCtx = {
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
    await hostApply(hostCtx, { installPreset: false })
    const { ok, value } = await panel.rpc('/dsh-my-go', 'getUsage', { parentSessionId: 'parent-1' })
    assert.equal(ok, true)
    assert.equal(value.found, true, 'broker 落的台账行被 lib 半聚合器认领（台账桶键 = 属主会话 id）')
    assert.equal(value.children.length, 2, '父会话自身行（D6）+ 子代行')
    const self = value.children[0]
    assert.equal(self.isSelf, true, 'self 合成行排最前带身份标注')
    assert.equal(self.childId, 'parent-1')
    assert.equal(self.agentType, null, '父会话无工种')
    assert.equal(self.frozen, false, '首轮全量扫已消费事件，idle-freeze 要等空扫轮（同子代时序）')
    assert.deepEqual(self.totals, { inputTokens: 17, outputTokens: 8, cacheReadTokens: null, cacheWriteTokens: null })
    const child = value.children[1]
    assert.equal(child.childId, 'sess-9')
    assert.equal(child.agentType, 'hermes', '台账 agentType 补源贯通两半')
    assert.equal(child.status, 'done', 'stopReason completed → 台账 done（isTerminalStatus 认得它）')
    assert.equal(child.frozen, true, '终态行 → 档案全量扫一次后冻结（R3）')
    assert.deepEqual(child.totals, { inputTokens: 17, outputTokens: 8, cacheReadTokens: null, cacheWriteTokens: null })
    assert.deepEqual(child.segments.map((s) => s.model), ['m1', 'm2'])
    assert.deepEqual(value.byModel.map((row) => row.model), ['m0', 'm1', 'm2'], 'self 的 m0 段按首次出现序并入 byModel')
    assert.equal(value.byModel[0].childCount, 0, 'childCount 只数子代，self 不计入')
    assert.equal(value.byModel[1].childCount, 1)
    // 合计 = 父会话自身 + 子代 的完整开销
    assert.deepEqual(value.totals, { inputTokens: 34, outputTokens: 16, cacheReadTokens: null, cacheWriteTokens: null })
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    await removeHomeWithRetry(home)
  }
})
