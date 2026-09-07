// dsh-my-go — report_fetch 主编工具行为档（第一期步骤 1.6）。
//
// 规划 1.6 验收四路：正常切片 / 越界钳制 / 跨 sessionId 不可达 / 子代理侧不在册
// （anti-bypass 同款断言模式在 anti-bypass.test.mjs 兑现，此处覆盖运行时守卫），
// 外加主人裁决三条：sessionId 一律取主编会话自身、REPORT_EXT 闸内注册、not-found
// 包装成主编可读返回（不抛）。板夹具直接用 writeBoard 造（1.1 round-trip 已锁
// 写路径正确性，此处只造数据，不重复验存储层）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as broker from '../preset/tools/broker.mjs'
import { writeBoard } from '../preset/shared/board.mjs'
import { createMockCtx, removeHomeWithRetry, execOf } from './helpers/mock-ctx.mjs'

const PARENT = { id: 'parent-f', session: { header: {} } }
const CHILD = { id: 'sess-1', session: { header: { parentSession: 'parent-f' } } }

async function fetchCtx(config = {}) {
  const { ctx, dispatch, tools } = createMockCtx({})
  await broker.apply(ctx, config)
  return { ctx, dispatch, tools, home: process.env.DSH_HOME }
}

test('在册与契约：主编面向注册、childId 必填、description 自教（D15 关键词）', async () => {
  const { tools, home } = await fetchCtx()
  try {
    const tool = tools.get('report_fetch')
    assert.ok(tool, 'REPORT_EXT 默认开 → report_fetch 在册')
    assert.deepEqual(tool.parameters.required, ['childId'])
    assert.ok(tool.parameters.properties.offset && tool.parameters.properties.limit, 'offset/limit 可选参数在 schema')
    assert.ok(/0-BASED/i.test(tool.description), 'description 显式写明 offset 0-based（裁决·描述宽度）')
    assert.ok(tool.description.includes('切片是常态') && tool.description.includes('全文取回是异常路径'), '用法导向进 description（D15：不动 system prompt）')
    assert.equal(tool.isConcurrencySafe(), true, '只读工具并发安全')
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('正常切片 + offset 0-based 语义：跳过 N 行读窗口，回显实际生效值', async () => {
  const { tools, home } = await fetchCtx()
  try {
    const board = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join('\n')
    await writeBoard('parent-f', 'sess-1', board)
    const r = await tools.get('report_fetch').execute({ childId: 'sess-1', offset: 2, limit: 3 }, execOf(PARENT))
    assert.equal(r.ok, true)
    assert.equal(r.totalLines, 10)
    assert.equal(r.offset, 2, '0-based：跳过前 2 行，从第 3 行起（Array.slice 语义）')
    assert.equal(r.limit, 3)
    assert.equal(r.text, 'line-3\nline-4\nline-5')
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('默认 limit 200 / 上限钳制 2000：大板不拉爆主编上下文', async () => {
  const { tools, home } = await fetchCtx()
  try {
    const big = Array.from({ length: 2500 }, (_, i) => `row-${i + 1}`).join('\n')
    await writeBoard('parent-f', 'sess-big', big)
    const def = await tools.get('report_fetch').execute({ childId: 'sess-big' }, execOf(PARENT))
    assert.equal(def.ok, true)
    assert.equal(def.limit, 200, '缺省 limit = 200 行')
    assert.equal(def.text.split('\n').length, 200)
    const capped = await tools.get('report_fetch').execute({ childId: 'sess-big', offset: 0, limit: 99999 }, execOf(PARENT))
    assert.equal(capped.limit, 2000, '上限钳制 2000 行（工具层业务钳）')
    assert.equal(capped.text.split('\n').length, 2000)
    const tail = await tools.get('report_fetch').execute({ childId: 'sess-big', offset: 2490, limit: 100 }, execOf(PARENT))
    assert.equal(tail.limit, 10, '尾部窗口按剩余行数钳（1.1 物理边界）')
    assert.equal(tail.text, 'row-2491\nrow-2492\nrow-2493\nrow-2494\nrow-2495\nrow-2496\nrow-2497\nrow-2498\nrow-2499\nrow-2500')
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('越界钳制并回显实际生效值：超尾 offset 钳到 totalLines（空窗口不抛）', async () => {
  const { tools, home } = await fetchCtx()
  try {
    await writeBoard('parent-f', 'sess-1', 'a\nb\nc')
    const r = await tools.get('report_fetch').execute({ childId: 'sess-1', offset: 9999, limit: 5 }, execOf(PARENT))
    assert.equal(r.ok, true)
    assert.equal(r.totalLines, 3)
    assert.equal(r.offset, 3, '超尾 offset 钳到 totalLines 并回显（D1 裁决）')
    assert.equal(r.limit, 0)
    assert.equal(r.text, '')
    const neg = await tools.get('report_fetch').execute({ childId: 'sess-1', offset: -5, limit: -1 }, execOf(PARENT))
    assert.equal(neg.ok, true)
    assert.equal(neg.offset, 0, '负 offset 钳 0（防御宿主宽松传参）')
    assert.equal(neg.limit, 0)
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('跨 sessionId 不可达：别家会话的板在本主编视野里就是 not-found', async () => {
  const { tools, home } = await fetchCtx()
  try {
    await writeBoard('other-session', 'sess-1', '别人家的报告')
    const r = await tools.get('report_fetch').execute({ childId: 'sess-1' }, execOf(PARENT))
    assert.equal(r.ok, false, 'boardPath 双段编码焊死：sessionId 取主编会话自身（parent-f），读不到 other-session 的板')
    assert.ok(r.message.includes('sess-1'))
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('not-found 包装成主编可读返回：不抛异常、给排查指引', async () => {
  const { tools, home } = await fetchCtx()
  try {
    const r = await tools.get('report_fetch').execute({ childId: 'sess-none' }, execOf(PARENT))
    assert.equal(r.ok, false)
    assert.ok(r.message.includes('sess-none'), '主编可读：指明查的是哪个 id')
    assert.ok(/orchestration_status/.test(r.message), '指引去 orchestration_status 对 id')
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('子代理调用被 canOrchestrate 运行时守卫拒（deny 闸双保险的第二道）', async () => {
  const { tools, home } = await fetchCtx()
  try {
    await assert.rejects(
      () => tools.get('report_fetch').execute({ childId: 'x' }, execOf(CHILD)),
      /reserved for orchestrator/,
      '子代（有 parentSession）直调 invoke 也必须被守卫拦下',
    )
  } finally {
    await removeHomeWithRetry(home)
  }
})

test('REPORT_EXT 闸：关 → report_fetch 不在册（report_submit 同闸联动的读侧）', async () => {
  const { tools, home } = await fetchCtx({ reportExternalization: false })
  try {
    assert.equal(tools.get('report_fetch'), undefined, '开关关 → 不注册')
    assert.equal(tools.get('report_submit'), undefined, '写侧同闸（1.3 既有行为不回潮）')
  } finally {
    await removeHomeWithRetry(home)
  }
})
