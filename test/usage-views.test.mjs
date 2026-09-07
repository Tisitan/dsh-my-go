// usage-views（0.4.0 用量统计契约 D4/D5，步骤 6/7）：面板三视图派生纯函数——
// 价格索引、渲染层成本（唯一计费点）、紧凑格式化、空态/降级文案选择。
// src/usage-views.js 零依赖，node --test 直接 import（与 esbuild bundle 内联
// 同源，无 DOM、无 React）；组件层 DOM 交互不上测试（client-smoke 先例）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  USAGE_TABS,
  BUCKET_COLUMNS,
  priceIndexFrom,
  computeCost,
  combineCosts,
  computeChildCost,
  computeTotalCost,
  hasAnyPrice,
  modelDisplayKey,
  formatCompactTokens,
  formatFullTokens,
  formatBucketCell,
  formatCost,
  currencySymbol,
  usageSessionTarget,
  sessionsListPhase,
  usageEmptyState,
  globalPartial,
  sumMessageCount,
  childRowCount,
} from '../src/usage-views.js'

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `expected ${actual} ≈ ${expected}`)

const FULL_PRICE = { input: 2, output: 8, cacheRead: 0.4, cacheWrite: 1 }
const FULL_BUCKETS = { inputTokens: 1_000_000, outputTokens: 2_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 1_000_000 }

test('priceIndexFrom：byModel 建 "{p}/{m}"→price 索引，null 侧/null 价/坏行跳过', () => {
  const byModel = [
    { provider: 'newapi', model: 'k3-256k', price: FULL_PRICE },
    { provider: 'openrouter', model: 'deepseek/deepseek-chat', price: { input: 1, output: 2 } },
    { provider: null, model: null, price: FULL_PRICE, messageCount: 1 },
    { provider: 'acme', model: 'free', price: null },
    { provider: 'acme', model: 'free2' },
    null,
    'garbage',
  ]
  assert.deepEqual(priceIndexFrom(byModel), {
    'newapi/k3-256k': FULL_PRICE,
    'openrouter/deepseek/deepseek-chat': { input: 1, output: 2 },
  })
  assert.deepEqual(priceIndexFrom(undefined), {})
  assert.deepEqual(priceIndexFrom('nope'), {})
})

test('computeCost：全价全桶精确定价；不产生任何虚构成分（D4 唯一计费点）', () => {
  const cost = computeCost(FULL_BUCKETS, FULL_PRICE)
  closeTo(cost.value, 2 + 16 + 0.2 + 1)
  assert.equal(cost.partial, false)
})

test('computeCost：缺价桶 token>0 → 下界 partial（Z4）；token=0 不触发', () => {
  const partialCost = computeCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 100, cacheWriteTokens: null }, { input: 2, output: 8 })
  closeTo(partialCost.value, 2)
  assert.equal(partialCost.partial, true, 'cacheRead 有量无价 → ≥')
  const zeroCost = computeCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: null }, { input: 2, output: 8 })
  assert.equal(zeroCost.partial, false, '未定价桶 token=0 不构成下界')
})

test('computeCost：price 缺 → null（Z3 纯 token）；桶 null 不计价不 partial（Z1 由 usagePartial 走）', () => {
  assert.equal(computeCost(FULL_BUCKETS, null), null)
  assert.equal(computeCost(FULL_BUCKETS, undefined), null)
  const cost = computeCost({ inputTokens: null, outputTokens: 1_000_000 }, { input: 2, output: 8 })
  closeTo(cost.value, 8)
  assert.equal(cost.partial, false, '未上报桶的 partial 由行级 usagePartial 传染，此处不重复判定')
})

test('combineCosts：空/全 null → null；求和且 partial OR', () => {
  assert.equal(combineCosts([]), null)
  assert.equal(combineCosts([null, null]), null)
  assert.equal(combineCosts(undefined), null)
  const sum = combineCosts([{ value: 1, partial: false }, null, { value: 2.5, partial: true }])
  closeTo(sum.value, 3.5)
  assert.equal(sum.partial, true)
})

test('computeChildCost：segments 跨模型逐段乘价求和，unmatched 段跳过；无 segments → null', () => {
  const priceIndex = { 'newapi/k3-256k': FULL_PRICE }
  const child = {
    segments: [
      { provider: 'newapi', model: 'k3-256k', buckets: { inputTokens: 1_000_000, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } },
      { provider: 'acme', model: 'unmatched', buckets: { inputTokens: 999, outputTokens: 999, cacheReadTokens: null, cacheWriteTokens: null } },
    ],
  }
  const cost = computeChildCost(child, priceIndex)
  closeTo(cost.value, 2)
  assert.equal(cost.partial, false)
  assert.equal(computeChildCost({ segments: [] }, priceIndex), null, '无消息子代无成本')
  assert.equal(computeChildCost(undefined, priceIndex), null)
})

test('computeTotalCost：跨 byModel 行求和（覆盖全部段）；hasAnyPrice 判成本列显隐', () => {
  const report = {
    byModel: [
      { provider: 'a', model: 'b', buckets: FULL_BUCKETS, price: FULL_PRICE },
      { provider: null, model: null, buckets: { inputTokens: 1_000_000 }, price: null },
    ],
  }
  const total = computeTotalCost(report)
  closeTo(total.value, 2 + 16 + 0.2 + 1, '未定价行不计入，已定价行整段计入')
  assert.equal(total.partial, false)
  assert.equal(hasAnyPrice(report.byModel), true, '有定价行 → 成本列显示')
  assert.equal(hasAnyPrice([{ price: null }]), false, '全部未定价 → 隐藏成本列（不填就不记录）')
  assert.equal(hasAnyPrice([]), false)
  assert.equal(hasAnyPrice(undefined), false)
})

test('modelDisplayKey：双 null → 「未知模型」（Z5），单 null → ? 占位', () => {
  assert.equal(modelDisplayKey(null, null), '未知模型')
  assert.equal(modelDisplayKey('acme', null), 'acme/?')
  assert.equal(modelDisplayKey(null, 'gpt'), '?/gpt')
  assert.equal(modelDisplayKey('openrouter', 'deepseek/deepseek-chat'), 'openrouter/deepseek/deepseek-chat')
})

test('formatCompactTokens：面板 320px 紧凑记法边界，非有限数 → null', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(980), '980')
  assert.equal(formatCompactTokens(9999), '9999')
  assert.equal(formatCompactTokens(10_000), '10k')
  assert.equal(formatCompactTokens(12_345), '12.3k')
  assert.equal(formatCompactTokens(999_999), '1000k')
  assert.equal(formatCompactTokens(1_000_000), '1M')
  assert.equal(formatCompactTokens(1_234_567), '1.2M')
  assert.equal(formatCompactTokens(1_500_000), '1.5M')
  assert.equal(formatCompactTokens(null), null)
  assert.equal(formatCompactTokens(NaN), null)
  assert.equal(formatCompactTokens(Infinity), null)
})

test('formatFullTokens：千分位精确值给 title；formatBucketCell：null→「—」不补 0、partial 加 ≥', () => {
  assert.equal(formatFullTokens(1_234_567), '1,234,567')
  assert.equal(formatFullTokens(null), null)
  assert.equal(formatBucketCell(null, false), '—', '§4：缺席桶显示 —，绝不补 0')
  assert.equal(formatBucketCell(undefined, true), '—')
  assert.equal(formatBucketCell(980, false), '980')
  assert.equal(formatBucketCell(12_345, true), '≥12.3k')
})

test('formatCost：$0.1234 格式，下界加 ≥ 前缀；无成本 → null', () => {
  assert.equal(formatCost(null), null)
  assert.equal(formatCost({ value: 0.1234, partial: false }), '$0.1234')
  assert.equal(formatCost({ value: 19.2, partial: true }), '≥$19.2000')
  assert.equal(formatCost({ value: 0, partial: false }), '$0.0000', '全零成本如实显示（0 是事实）')
})

test('currencySymbol / formatCost 币种参数（D1a）：CNY → ¥，未知/缺省回落 $', () => {
  assert.equal(currencySymbol('CNY'), '¥')
  assert.equal(currencySymbol('USD'), '$')
  assert.equal(currencySymbol('EUR'), '$', '未知币种绝不渲染裸数字')
  assert.equal(currencySymbol(undefined), '$')
  assert.equal(formatCost({ value: 0.1234, partial: false }, 'CNY'), '¥0.1234')
  assert.equal(formatCost({ value: 19.2, partial: true }, 'CNY'), '≥¥19.2000', '下界前缀与币种符号共存')
})

test('usageSessionTarget：当前会话在席直通；缺失时唯一真实 parent 回落，legacy 幽灵桶永不借用', () => {
  // pid 在席：直通，parents 形状无关
  assert.equal(usageSessionTarget('sess-1', { a: { parentSessionId: 'p-1' }, b: { parentSessionId: 'p-2' } }), 'sess-1')
  assert.equal(usageSessionTarget('sess-1', undefined), 'sess-1')
  // pid 缺失 + 恰一个真实 parent → 回落借用（auto-jump 单 parent 退化门禁同款）
  assert.equal(usageSessionTarget(undefined, { a: { parentSessionId: 'p-1' } }), 'p-1')
  assert.equal(usageSessionTarget('', { a: { parentSessionId: 'p-1' } }), 'p-1')
  // 多 parent → null（宁可不显示也不张冠李戴）
  assert.equal(usageSessionTarget(undefined, { a: { parentSessionId: 'p-1' }, b: { parentSessionId: 'p-2' } }), null)
  // 'legacy' 台账兼容桶不是真实编排：唯一桶是它 → null；与真实 parent 并存 → 回落真实那个
  assert.equal(usageSessionTarget(undefined, { ghost: { parentSessionId: 'legacy' } }), null)
  assert.equal(usageSessionTarget(undefined, { ghost: { parentSessionId: 'legacy' }, a: { parentSessionId: 'p-1' } }), 'p-1')
  // 0 parent / 坏形状 → null
  assert.equal(usageSessionTarget(undefined, {}), null)
  assert.equal(usageSessionTarget(undefined, undefined), null)
  assert.equal(usageSessionTarget(undefined, 'nope'), null)
  assert.equal(usageSessionTarget(undefined, { a: null, b: 'garbage' }), null)
  // parentSessionId 缺失/非串的条目不计入
  assert.equal(usageSessionTarget(undefined, { a: {} }), null)
  assert.equal(usageSessionTarget(undefined, { a: { parentSessionId: 42 }, b: { parentSessionId: 'p-2' } }), 'p-2')
})

test('sessionsListPhase：防御式读 sessions.list 快照 phase，缺席/漂移 → null（不算 pending）', () => {
  assert.equal(sessionsListPhase({ list: { getSnapshot: () => ({ phase: 'pending', current: undefined }) } }), 'pending')
  assert.equal(sessionsListPhase({ list: { getSnapshot: () => ({ phase: 'ready', current: 's1' }) } }), 'ready')
  assert.equal(sessionsListPhase({ list: { getSnapshot: () => ({}) } }), null, 'phase 缺失不算 pending')
  assert.equal(sessionsListPhase({ list: { getSnapshot: () => { throw new Error('store shape drift') } } }), null, '快照抛错不炸')
  assert.equal(sessionsListPhase({}), null, '无 list store')
  assert.equal(sessionsListPhase(undefined), null, '无 sessions 服务')
  assert.equal(sessionsListPhase({ list: {} }), null, 'store 形状漂移（无 getSnapshot）')
})

test('usageEmptyState：loading/idle/session-pending/无会话/RPC 失败/未编排/无用量 七态文案（D5 Z8/Z17）', () => {
  assert.equal(usageEmptyState(null).message, '正在读取用量…')
  assert.equal(usageEmptyState({ state: 'idle' }).message, '正在读取用量…')
  assert.equal(usageEmptyState({ state: 'loading' }).kind, 'plain')
  const pending = usageEmptyState({ state: 'session-pending' })
  assert.equal(pending.kind, 'plain', '会话列表首拉期是普通空态，不是错误横幅')
  assert.equal(pending.message, '会话列表加载中…', 'pending 与识别失败分文案，不再共用一句')
  assert.match(usageEmptyState({ state: 'no-session' }).message, /无法确定当前会话/, '真识别失败保留原文案')
  const err = usageEmptyState({ state: 'error', detail: 'ledger exploded' })
  assert.equal(err.kind, 'error', 'RPC 失败走横幅型')
  assert.match(err.message, /用量数据读取失败：ledger exploded/)
  assert.match(err.hint, /自动重试/)
  assert.equal(usageEmptyState({ state: 'ok', report: { found: false } }).message, '当前会话无编排记录')
  assert.equal(usageEmptyState({ state: 'ok', report: { found: true, children: [] } }).message, '本会话暂无用量')
  assert.equal(usageEmptyState({ state: 'ok', report: { found: true, children: [{ childId: 'c1' }] } }), null, '有数据 → 无空态')
  assert.equal(usageEmptyState({ state: 'ok', report: null }).message, '正在读取用量…', '坏报告回落 loading 文案，不炸')
})

test('globalPartial / sumMessageCount：children OR、byModel 兜底；计数 0 是事实', () => {
  assert.equal(globalPartial({ children: [{ partial: false }, { partial: true }] }), true)
  assert.equal(globalPartial({ children: [], byModel: [{ partial: true }] }), true)
  assert.equal(globalPartial({ children: [{ partial: false }], byModel: [{ partial: false }] }), false)
  assert.equal(globalPartial({ children: null, byModel: undefined }), false)
  assert.equal(sumMessageCount({ children: [{ messageCount: 3 }, { messageCount: 0 }] }), 3)
  assert.equal(sumMessageCount({ children: [{ messageCount: null }] }), 0, '坏计数按 0 计，不 NaN')
  assert.equal(sumMessageCount({ children: undefined }), 0)
})

test('childRowCount / self 行透传（D6）：子代计数排除 isSelf；partial 与消息合计照常并入 self 行', () => {
  const report = {
    children: [
      { childId: 'p1', isSelf: true, partial: true, messageCount: 4 },
      { childId: 'c1', partial: false, messageCount: 2 },
      { childId: 'c2', partial: false, messageCount: 1 },
    ],
  }
  assert.equal(childRowCount(report), 2, 'self 行是台账上的用量，不是子代')
  assert.equal(childRowCount({ children: [] }), 0)
  assert.equal(childRowCount({ children: [{ childId: 'p1', isSelf: true }] }), 0)
  assert.equal(childRowCount({ children: [{ childId: 'c1' }] }), 1, '无 isSelf 字段的行照旧计为子代（旧响应形状兼容）')
  assert.equal(childRowCount({}), 0)
  assert.equal(childRowCount(undefined), 0)
  assert.equal(globalPartial(report), true, 'self 行 partial 照常传染合计 ≥')
  assert.equal(sumMessageCount(report), 7, 'self 行消息数照常并入完整开销')
})

test('USAGE_TABS / BUCKET_COLUMNS：三视图与四桶列序固定（D1/D4）', () => {
  assert.deepEqual(USAGE_TABS.map((t) => t.key), ['models', 'children', 'totals'])
  assert.deepEqual(BUCKET_COLUMNS.map((c) => c.bucket), ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
})
