/**
 * dsh-my-go — 心跳速算区纯计算层直测（ 步2）。
 *
 * 风格同 usage-price-rows.test.mjs：不起浏览器、不 mock 宿主，直接 import
 * src/keepalive-calc.js（与 dist 产物同一份源码），把两个算式与降级口径逐条钉住。
 *
 * 这一层的价值全在「半输入是常态」：用户打到一半（''、'3.'、'abc'、'-1'）时，
 * 计算器必须给出「还算不出来」而不是 NaN/Infinity/0 这种看着像结果的假数——
 * 故每个非法分支都配一条断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { KEEP_ALIVE_CALC } from '../preset/shared/constants.mjs'
import { formatDurationHuman, intervalMsFromTtl, lookaheadMs, parseCalcNumber } from '../src/keepalive-calc.js'

// ── 输入解析 ────────────────────────────────────────────────────────────────

test('parseCalcNumber：空/非法/负数一律 null（半输入不当成 0）', () => {
  for (const bad of ['', '   ', 'abc', '3x', '-1', '-0.5', NaN, Infinity, -Infinity, null, undefined, {}, [], true]) {
    assert.equal(parseCalcNumber(bad), null, `不可算：${String(bad)}`)
  }
  assert.equal(parseCalcNumber('3.00'), 3, '价格原值照收（多余的零无所谓）')
  assert.equal(parseCalcNumber(' 0.30 '), 0.3, '两端空白不算错')
  assert.equal(parseCalcNumber('3600'), 3600)
  assert.equal(parseCalcNumber(0), 0, '0 是合法输入（是否可用归各算式判）')
  assert.equal(parseCalcNumber('3.'), 3, '打到一半的「3.」按 3 算（框不跟用户较劲）')
  assert.equal(parseCalcNumber(2.5), 2.5)
})

// ── 算式一：拍距 = TTL × 5/6 ────────────────────────────────────────────────

test('intervalMsFromTtl：拍距 = TTL × 5/6（两档 + 任意值 + 非法降级）', () => {
  assert.equal(KEEP_ALIVE_CALC.intervalRatio, 5 / 6, '系数单源在 constants（渲染层不许再抄一份）')
  // 验收点名的两档：300 秒 → 250 秒；3600 秒 → 3000 秒
  assert.equal(intervalMsFromTtl(300), 250000)
  assert.equal(intervalMsFromTtl('300'), 250000)
  assert.equal(intervalMsFromTtl(3600), 3000000)
  assert.equal(intervalMsFromTtl('3600'), 3000000)
  // 任意值：一条规则覆盖，不需要枚举档位
  assert.equal(intervalMsFromTtl(60), 50000)
  assert.equal(intervalMsFromTtl(600), 500000)
  assert.equal(intervalMsFromTtl(900), 750000)
  assert.equal(intervalMsFromTtl(1), 833, '1 秒 → 833ms（四舍五入成整数毫秒）')
  assert.equal(intervalMsFromTtl(7), 5833, '7 秒 → 5833.33 → 5833')
  // 降级：TTL 必须为正且可解析，否则不可算
  for (const bad of ['', 'abc', 0, '0', -300, NaN, Infinity, null, undefined]) {
    assert.equal(intervalMsFromTtl(bad), null, `TTL 非法 → null：${String(bad)}`)
  }
})

// ── 算式二：前瞻窗口 H ──────────────────────────────────────────────────────

test('lookaheadMs：H =（输入价 ÷ 缓存命中价 − 1）× 拍距', () => {
  const interval = intervalMsFromTtl(300)
  // 倍率 10（3.00 / 0.30）→ 9 × 拍距
  assert.equal(lookaheadMs('3.00', '0.30', interval), 2250000)
  assert.equal(lookaheadMs('3.00', '0.30', interval), 9 * 250000, '恰好是 9 倍拍距')
  assert.equal(lookaheadMs(3, 0.3, 250000), 2250000)
  // 别的倍率：5 倍 → 4 × 拍距；2 倍 → 1 × 拍距
  assert.equal(lookaheadMs('1.5', '0.30', 250000), 1000000)
  assert.equal(lookaheadMs('0.6', '0.30', 250000), 250000)
  // 1 小时档同理（拍距 3000 秒）
  assert.equal(lookaheadMs('3', '0.3', intervalMsFromTtl(3600)), 27000000)
  // 比价恰好 1 → H=0（没有省头），比价 < 1 夹到 0 而不是负数
  assert.equal(lookaheadMs('0.30', '0.30', 250000), 0)
  assert.equal(lookaheadMs('0.10', '0.30', 250000), 0, '命中更贵 → 夹到 0，不上负数')
})

test('lookaheadMs：边界（缓存价 0/空、任一项缺失）一律 null，绝不 Infinity/NaN', () => {
  const interval = 250000
  // 除零：缓存命中价 0 或空/非法 → 不可算（不返回 Infinity）
  for (const bad of ['', '0', 0, 'abc', '-1', null, undefined]) {
    const got = lookaheadMs('3', bad, interval)
    assert.equal(got, null, `缓存价不可算 → null：${String(bad)}`)
  }
  // 输入价不可算 → null
  for (const bad of ['', 'abc', '-3', null, undefined]) {
    assert.equal(lookaheadMs(bad, '0.3', interval), null, `输入价不可算 → null：${String(bad)}`)
  }
  // 拍距不可算（TTL 非法）→ null：H 依赖拍距，一半算不出来就是整体算不出来
  assert.equal(lookaheadMs('3', '0.3', null), null)
  assert.equal(lookaheadMs('3', '0.3', intervalMsFromTtl('0')), null)
  assert.equal(lookaheadMs(), null, '无参调用不炸')
  // 任何分支都不许出现非有限数（NaN/Infinity 端上界面就是「像结果的假数」）
  for (const got of [lookaheadMs('3', '0', 250000), lookaheadMs('', '', null), lookaheadMs(NaN, Infinity, 250000)]) {
    assert.equal(got, null)
  }
})

// ── 人类可读时长（配置卡内唯一的「秒/分/时」梯子）────────────────────────────

test('formatDurationHuman：秒/分/时自适应，非法输入按 0 兜（配置卡与速算区同源）', () => {
  assert.equal(formatDurationHuman(0), '0 秒')
  assert.equal(formatDurationHuman(45000), '45 秒')
  assert.equal(formatDurationHuman(59000), '59 秒')
  assert.equal(formatDurationHuman(60000), '1 分钟', '整分钟不带小数点')
  assert.equal(formatDurationHuman(120000), '2 分钟')
  assert.equal(formatDurationHuman(250000), '4.2 分钟')
  assert.equal(formatDurationHuman(3000000), '50 分钟')
  assert.equal(formatDurationHuman(2250000), '37.5 分钟')
  assert.equal(formatDurationHuman(3600000), '1.0 小时')
  assert.equal(formatDurationHuman(27000000), '7.5 小时')
  // 兜底：非有限/负值按 0，绝不产出 'NaN 秒'
  for (const bad of [NaN, Infinity, -5000, null, undefined, 'abc']) {
    assert.equal(formatDurationHuman(bad), '0 秒', `非法时长按 0：${String(bad)}`)
  }
})
