// panel-format 纯函数（编排面板标识符截断/相对时间/[备选]标注提取）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortId, oneLine, formatRelativeTime, extractFallbackNote } from '../src/panel-format.js'

test('shortId：取前 8 位；空值安全', () => {
  assert.equal(shortId('a1b2c3d4e5f6-uuid-rest'), 'a1b2c3d4')
  assert.equal(shortId('short'), 'short', '不足 8 位原样返回')
  assert.equal(shortId(''), '')
  assert.equal(shortId(undefined), '')
  assert.equal(shortId(null), '')
  assert.equal(shortId(123456789012), '12345678', '非字符串先 String 化')
  assert.equal(shortId('a1b2c3d4e5f6', 4), 'a1b2', '自定义长度')
})

test('oneLine：折叠空白并去首尾', () => {
  assert.equal(oneLine('  a\n\nb\tc  '), 'a b c')
  assert.equal(oneLine('x'), 'x')
  assert.equal(oneLine(undefined), '')
  assert.equal(oneLine(null), '')
})

test('formatRelativeTime：秒/分/时/天阶梯', () => {
  const now = Date.parse('2026-07-01T12:00:00Z')
  assert.equal(formatRelativeTime(now - 3_000, now), '刚刚')
  assert.equal(formatRelativeTime(now - 30_000, now), '30 秒前')
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(formatRelativeTime(now - 59 * 60_000, now), '59 分钟前')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3 小时前')
  assert.equal(formatRelativeTime(now - 23 * 3_600_000, now), '23 小时前')
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2 天前')
  assert.equal(formatRelativeTime(now - 29 * 86_400_000, now), '29 天前')
})

test('formatRelativeTime：>30 天回落绝对日期；非法/缺时间戳返回 null', () => {
  const now = Date.parse('2026-07-01T12:00:00Z')
  assert.equal(formatRelativeTime(now - 45 * 86_400_000, now), '2026-05-17')
  assert.equal(formatRelativeTime(undefined, now), null, '缺字段 → null（调用方隐藏元素）')
  assert.equal(formatRelativeTime(null, now), null)
  assert.equal(formatRelativeTime(0, now), null)
  assert.equal(formatRelativeTime(-5, now), null)
  assert.equal(formatRelativeTime('not-a-number', now), null)
  assert.equal(formatRelativeTime(now, NaN), null, 'now 非法 → null')
})

test('formatRelativeTime：未来时间戳（时钟偏差）读作刚刚', () => {
  const now = Date.parse('2026-07-01T12:00:00Z')
  assert.equal(formatRelativeTime(now + 120_000, now), '刚刚')
})

test('extractFallbackNote：提取 [备选 n/m] 标注并剥离原文', () => {
  const raw = '探索完成，找到 3 处匹配。\n[备选 1/3] 失败 → 自动切换备选 gateway-b/model-b 重派'
  const { note, text } = extractFallbackNote(raw)
  assert.equal(note, '备选 1/3')
  assert.equal(text, '探索完成，找到 3 处匹配。 失败 → 自动切换备选 gateway-b/model-b 重派')
})

test('extractFallbackNote：无标注原样单行化', () => {
  assert.deepEqual(extractFallbackNote('结论正常'), { note: null, text: '结论正常' })
  assert.deepEqual(extractFallbackNote('a\n b\nc'), { note: null, text: 'a b c' })
  assert.deepEqual(extractFallbackNote(undefined), { note: null, text: '' })
})

test('extractFallbackNote：标注容错（空格/首尾文本保留/只取首个）', () => {
  assert.equal(extractFallbackNote('前 [备选 2/4] 后').note, '备选 2/4')
  assert.equal(extractFallbackNote('前 [备选 12/34] 后').text, '前 后')
  const two = extractFallbackNote('[备选 1/2] x [备选 2/2] y')
  assert.equal(two.note, '备选 1/2', '只识别首个标注（broker 每条落史至多写一个）')
  assert.equal(two.text, 'x [备选 2/2] y')
})

test('formatRelativeTime 与 extractFallbackNote 组合：真实落史条目形状', () => {
  // broker.mjs finish() 落史行：{ agentType, status, conclusion, updatedAt }
  const rec = {
    agentType: 'hermes',
    status: 'failed',
    conclusion: '替换完成 2/5 处后遇权限拒绝\n[备选 2/3] 失败 → 自动切换备选 p2/m2 重派',
    updatedAt: Date.now() - 90_000,
  }
  const { note, text } = extractFallbackNote(rec.conclusion)
  assert.equal(note, '备选 2/3')
  assert.equal(formatRelativeTime(rec.updatedAt), '1 分钟前', '90s 按分钟向下取整')
  assert.ok(text.startsWith('替换完成'), '剩余文本可安全单行截断')
})
