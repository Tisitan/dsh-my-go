// usagePrices broker 侧热更通路（0.4.0 用量统计契约，步骤 3/7）：单价表随宿主半
// 配置桥到达 broker 半消费端（0.1.7：桥逐调用现读，段一变即见新值）。本文件加载
// broker.apply（独立进程，
// 避免 Symbol.for 快照桥覆盖 lib-only 测试文件的桥断言）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as broker from '../preset/tools/broker.mjs'
import { createMockCtx, setHostBindings, withRealSignalContract, execOf } from './helpers/mock-ctx.mjs'

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-my-go-usage-prices-broker-'))

test('usagePrices 随宿主配置桥到达 broker 半：消费链路健康，绑定语义不变', async () => {
  const parent = { id: 'parent-1', session: { header: {} } }
  // broker 半只读整段（broker.mjs 的桥读取件），usagePrices 是 pass-through
  // 新字段：到场与否不得影响 mergeRoleBindings / 缓存失效链路。
  const restore = setHostBindings({
    roles: { hermes: { model: 'm1' } },
    usagePrices: { 'newapi/k3-256k': { input: 2, output: 8, cacheRead: 0.4 } },
  })
  try {
    const specs = []
    const { ctx, dispatch, tools } = createMockCtx({
      agents: { get: (id) => (id === 'parent-1' ? parent : undefined) },
      startContinuable: withRealSignalContract(async (spec) => { specs.push(spec); return { childId: `sess-${specs.length}` } }),
    })
    await broker.apply(ctx, { reportExternalization: false, queueRetryBaseMs: 5 })
    const goWork = tools.get('go_work')
    await goWork.execute({ agent: 'hermes', prompt: 'first' }, execOf(parent))
    assert.equal(specs[0].request.agentOptions?.model, 'm1', '带 usagePrices 的段不破派发绑定')
    dispatch('subagent/end', { id: 'sess-1', stopReason: 'completed', lastAssistantMessage: [] })
    // WebUI 保存新单价表（局部合并落盘）→ 宿主半解析出的段随之变化 → broker 现读即见
    assert.doesNotThrow(() => setHostBindings({
      roles: { hermes: { model: 'm1' } },
      usagePrices: {
        'newapi/k3-256k': { input: 2, output: 8, cacheRead: 0.4 },
        'openrouter/deepseek/deepseek-chat': { input: 0.27, output: 1.1 },
      },
    }), '热更消费（绑定重建 + 缓存失效）在单价表变化时健康')
    await goWork.execute({ agent: 'hermes', prompt: 'second' }, execOf(parent))
    assert.equal(specs[1].request.agentOptions?.model, 'm1', '热更后派发绑定语义不变（usagePrices 是 pass-through）')
  } finally {
    restore()
  }
})
