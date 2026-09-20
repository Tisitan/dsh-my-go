// usage-price-rows（0.4.0 用量统计契约 D1，步骤 3/7）：单价表编辑器纯函数——
// 桶值净化、行级校验、键格式提示。src/usage-price-rows.js 零依赖，node --test
// 直接 import（与 esbuild bundle 内联同源，无 DOM、无 React）。
// 0.5.0-tisitan.3 批次 3：行操作迁移（add/remove/update 行、model-picker 选项
// 投影）已随 0.5.0 设置页重写成为孤儿导出并删除——本文件只守净化/校验活面，
// 行编辑行为由 test/settings-core-projections.test.mjs 与 client-card 行为档持有。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeBucket,
  sanitizePriceRow,
  validatePriceRow,
  priceKeyHint,
  PRICE_KEY_PATTERN,
  PRICE_BUCKETS,
  REQUIRED_BUCKETS,
} from '../src/usage-price-rows.js'
import { PRICE_KEY_PATTERN as SHARED_PATTERN } from '../preset/shared/constants.mjs'

test('sanitizeBucket：数字与数字串收、NaN/Infinity/负数/空串/非数字串拒、0 合法', () => {
  assert.equal(sanitizeBucket(2), 2)
  assert.equal(sanitizeBucket(0), 0, '0 价合法（免费渠道）')
  assert.equal(sanitizeBucket('2.5'), 2.5, '数字串 coerce（number input 原始 string）')
  assert.equal(sanitizeBucket(' 2 '), 2, '首尾空白容忍')
  assert.equal(sanitizeBucket(NaN), null, 'schemastery .min(0) 拦不住的 NaN 在此拒')
  assert.equal(sanitizeBucket(Infinity), null, 'Infinity 同拒')
  assert.equal(sanitizeBucket(-1), null, '负数拒')
  assert.equal(sanitizeBucket(''), null, '空串 = 桶未填')
  assert.equal(sanitizeBucket('abc'), null, '非数字串拒')
  assert.equal(sanitizeBucket(undefined), null)
  assert.equal(sanitizeBucket(null), null)
})

test('sanitizePriceRow：合法行出全 number 副本、可选桶省略、缺必填/非对象拒', () => {
  assert.deepEqual(sanitizePriceRow({ input: 1, output: 2, cacheRead: 0.4, cacheWrite: 1 }), { input: 1, output: 2, cacheRead: 0.4, cacheWrite: 1 })
  assert.deepEqual(sanitizePriceRow({ input: '1', output: '2' }), { input: 1, output: 2 }, '数字串行 coerce')
  assert.deepEqual(sanitizePriceRow({ input: 1, output: 2, cacheRead: NaN }), { input: 1, output: 2 }, '非法可选桶剔除（键省略）')
  assert.equal(sanitizePriceRow({ input: 1 }), null, '缺 output = 整行拒')
  assert.equal(sanitizePriceRow({ output: 2 }), null, '缺 input = 整行拒')
  assert.equal(sanitizePriceRow('nope'), null, '非对象拒')
  assert.equal(sanitizePriceRow(null), null)
  assert.equal(sanitizePriceRow([1, 2]), null, '数组拒')
})

test('validatePriceRow：合法 null、报错中文含桶名，持久脏行可见不吞', () => {
  assert.equal(validatePriceRow({ input: 1, output: 2 }), null)
  assert.equal(validatePriceRow({ input: '1.5', output: 2, cacheRead: '' }), null, '编辑态中间形状合法（可选桶空串=未填）')
  assert.match(validatePriceRow({ output: 2 }), /input/, '缺必填报错点名桶')
  assert.match(validatePriceRow({ input: -1, output: 2 }), /input/, '负数报错点名桶')
  assert.match(validatePriceRow({ input: 1, output: 2, cacheWrite: -3 }), /cacheWrite/, '可选桶负数报错点名桶')
  assert.match(validatePriceRow('nope'), /不合法/, '非对象行报错（持久脏行在编辑器可见）')
})

test('priceKeyHint：空输入无提示、合法键无提示、坏键给格式提示', () => {
  assert.equal(priceKeyHint(''), null)
  assert.equal(priceKeyHint('  '), null)
  assert.equal(priceKeyHint('newapi/k3-256k'), null)
  assert.equal(priceKeyHint('openrouter/deepseek/deepseek-chat'), null, 'model 含 / 合法')
  assert.ok(priceKeyHint('noslash'), '无 / 拒')
  assert.ok(priceKeyHint('/lead'), 'provider 空拒')
  assert.ok(priceKeyHint('trail/'), 'model 空拒')
})

test('PRICE_BUCKETS 组成与 PRICE_KEY_PATTERN 与 preset/shared 单源一致', () => {
  assert.deepEqual(REQUIRED_BUCKETS, ['input', 'output'])
  assert.deepEqual(PRICE_BUCKETS, ['input', 'output', 'cacheRead', 'cacheWrite'])
  assert.equal(PRICE_KEY_PATTERN, SHARED_PATTERN, '客户端不再抄第二份 pattern（双处定义是历史教训）')
})
