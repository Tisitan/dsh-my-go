// usagePrices schema（0.4.0 用量统计契约 D1，步骤 2/7）：单价表 dict 的注册、
// 校验与设置读写 round-trip。本文件只加载 lib/index.js（独立进程，避免
// Symbol.for 快照桥被 broker 半覆盖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRICE_KEY_PATTERN,
  apply as hostApply,
} from '../lib/index.js'
import { createPanelRpcTransport } from './helpers/mock-ctx.mjs'
import { buildSettingsOps, draftFromSection } from '../src/settings-ops.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-usage-prices-home-'))

// 契约 D1 示例形状：model 余部可含 "/"；cache 桶可选（缺省 = 该桶未定价）。
const PRICE_ROW_FULL = { input: 2, output: 8, cacheRead: 0.4, cacheWrite: 1.25 }
const PRICE_ROW_NO_CACHE = { input: 0.27, output: 1.1 }
const USAGE_PRICES = {
  'newapi/k3-256k': PRICE_ROW_FULL,
  'openrouter/deepseek/deepseek-chat': PRICE_ROW_NO_CACHE,
}

function mockHostCtx({ settings } = {}) {
  const listeners = new Map()
  const panel = createPanelRpcTransport()
  const ctx = {
    get: (name) => {
      if (name === 'settings') return settings
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: panel.inject,
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    subagents: {},
  }
  return { ctx, listeners, rpc: panel.rpc }
}

async function captureSchema() {
  let registered
  const settings = {
    register: (ns, schema) => { registered = schema; return {} },
    get: () => undefined,
    mutate: async () => {},
  }
  const { ctx } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  assert.ok(registered, 'settings.register 应被调用且捕获 schema')
  return registered
}

// ── schema：dict 形状 / 空表默认 / round-trip ─────────────────────────────

test('schema：usagePrices 合法表原样解析，model 含 / 的键与可选桶缺省行均保留', async () => {
  const schema = await captureSchema()
  const parsed = schema({ usagePrices: USAGE_PRICES })
  assert.deepEqual(parsed.usagePrices['newapi/k3-256k'], PRICE_ROW_FULL, '四桶齐全的行原样保留')
  assert.deepEqual(parsed.usagePrices['openrouter/deepseek/deepseek-chat'], PRICE_ROW_NO_CACHE, 'model 余部含 / 的键原样保留')
  assert.deepEqual(Object.keys(parsed.usagePrices['openrouter/deepseek/deepseek-chat']), ['input', 'output'], '可选桶缺省 = 输出行键省略（PriceInfo 语义）')
})

test('schema：usagePrices 缺省解析为空 dict（空表 = 不计成本），既有顶级键行为不变', async () => {
  const schema = await captureSchema()
  const legacy = { sisyphus: { provider: 'p', model: 'm', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] }, toolMask: { deny: ['mcp__a__x'] } }
  const parsed = schema(legacy)
  assert.deepEqual(parsed.usagePrices, {}, '无 usagePrices 键 = 空表默认，不 undefined 不炸')
  assert.deepEqual(parsed.sisyphus, legacy.sisyphus, '既有字段不受新字段影响')
  assert.deepEqual(parsed.toolMask, legacy.toolMask, '旧 toolMask 键原样透传（schemastery 未知键透传，消费面已拆除不再读它），存量文件解析不炸')
})

test('schema：键违反「第一个 / 切分、两段非空」被拒；PRICE_KEY_PATTERN 与 re-export 同源', async () => {
  const schema = await captureSchema()
  const good = { 'p/m': PRICE_ROW_NO_CACHE, 'a/b/c': PRICE_ROW_NO_CACHE }
  assert.doesNotThrow(() => schema({ usagePrices: good }), 'provider 不含 /、model 余部可含 /')
  for (const badKey of ['/model', 'provider/', 'noslash', '/']) {
    assert.throws(() => schema({ usagePrices: { [badKey]: PRICE_ROW_NO_CACHE } }), `非法键 "${badKey}" 必须被拒绝`)
  }
  for (const k of Object.keys(good)) assert.ok(PRICE_KEY_PATTERN.test(k))
  assert.ok(!PRICE_KEY_PATTERN.test('/model') && !PRICE_KEY_PATTERN.test('provider/'))
})

test('schema：input/output 必填缺失即拒；负数拒；0 价合法（schemastery 层）', async () => {
  const schema = await captureSchema()
  assert.throws(() => schema({ usagePrices: { 'p/m': { output: 8 } } }), '缺 input 拒（required）')
  assert.throws(() => schema({ usagePrices: { 'p/m': { input: 2 } } }), '缺 output 拒（required）')
  assert.throws(() => schema({ usagePrices: { 'p/m': { input: -1, output: 8 } } }), 'input 负数拒（min 0）')
  assert.throws(() => schema({ usagePrices: { 'p/m': { input: 2, output: 8, cacheRead: -0.5 } } }), '可选桶负数拒')
  assert.doesNotThrow(() => schema({ usagePrices: { 'p/m': { input: 0, output: 0 } } }), '0 价合法（免费渠道）')
})

// ── usageCurrency（D1a 全局币种）──────────────────────────────────────────

test('schema：usageCurrency 缺省 USD、CNY 合法、非法枚举拒（D1a 全局单选）', async () => {
  const schema = await captureSchema()
  assert.equal(schema({}).usageCurrency, 'USD', '缺省 = USD（存量配置零迁移）')
  assert.equal(schema({ usageCurrency: 'CNY' }).usageCurrency, 'CNY')
  assert.equal(schema({ usageCurrency: 'USD' }).usageCurrency, 'USD')
  assert.throws(() => schema({ usageCurrency: 'EUR' }), '枚举外拒')
  assert.throws(() => schema({ usageCurrency: 42 }), '非串拒')
})

// ── round-trip：读面投影 / 写面不触碰存量 ─────────────────────────────────

const STORED_WITH_PRICES = {
  sisyphus: { provider: 'p-s', model: 'm-s', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] },
  roles: { hermes: { provider: 'p1', model: 'm1', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] } },
  usagePrices: USAGE_PRICES,
}

test('round-trip 加载面：命名空间值经 draftFromSection 原样抵达单价编辑器', () => {
  const draft = draftFromSection(structuredClone(STORED_WITH_PRICES))
  assert.deepEqual(draft.usagePrices, USAGE_PRICES, '存储里的单价表随读面投影完整到达')
})

// 写面从「宿主替身收到的 ops」变成「编译器的返回值」：判据一字未改。
function saveOpsOf(draft, stored = STORED_WITH_PRICES) {
  return buildSettingsOps(draft, { value: structuredClone(stored), user: structuredClone(stored), base: {} })
}

test('round-trip 保存面：draft 不带 usagePrices 时零触碰（存量单价表不被保存动作洗掉）', () => {
  const draft = { sisyphus: { provider: 'p2', model: 'm2' } }
  const ops = saveOpsOf(draft)
  assert.equal(ops.filter((op) => op.path?.[0] === 'usagePrices').length, 0, '显式携带才写：draft 无此键 = 完全不触碰')
})

test('round-trip 保存面：draft 携带完整存量表 → 逐行 set、无 unset（与存储一致时不产生删除面）', () => {
  const draft = structuredClone(STORED_WITH_PRICES)
  const ops = saveOpsOf(draft)
  const sets = ops.filter((op) => op.op === 'set' && op.path?.[0] === 'usagePrices')
  assert.deepEqual(sets.map((op) => op.path[1]).sort(), Object.keys(USAGE_PRICES).sort(), 'draft 全表显式携带 → 行级 set')
  assert.equal(ops.filter((op) => op.op === 'unset' && op.path?.[0] === 'usagePrices').length, 0, '存储行都在 draft 里 → 零删除面')
})

// ── 关键接缝 1：局部合并写回（步骤 3/7）─────────────────────────────────

test('写面（局部合并）：draft 逐行 set、存储缺行 unset、draft 未提及行不触碰其他字段', () => {
  const stored = {
    ...STORED_WITH_PRICES,
    usagePrices: { 'a/b': { input: 1, output: 2 }, 'stale/old': { input: 3, output: 4 } },
  }
  const draft = { usagePrices: { 'a/b': { input: 9, output: 8 }, 'c/d': { input: 0.5, output: 1 } } }
  const ops = saveOpsOf(draft, stored)
  const priceOps = ops.filter((op) => op.path?.[0] === 'usagePrices')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'a/b'), { op: 'set', path: ['usagePrices', 'a/b'], value: { input: 9, output: 8 } }, '已存行按 draft 新值 set')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'c/d'), { op: 'set', path: ['usagePrices', 'c/d'], value: { input: 0.5, output: 1 } }, '新增行 set')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'stale/old'), { op: 'unset', path: ['usagePrices', 'stale/old'] }, 'draft 缺的存量行 unset')
  assert.equal(priceOps.length, 3, '局部合并 = 恰好三枚 ops')
  assert.equal(ops.filter((op) => op.path?.[0] === 'roles' || op.path?.[0] === 'sisyphus').length, 0, 'roles/sisyphus 零触碰（toolMask ops 已随屏蔽功能拆除，不属本断言）')
})

test('写面（空表语义）：draft.usagePrices = {} → 整键 unset（清空 = 回到未配置，不落空字典）', () => {
  const ops = saveOpsOf({ usagePrices: {} }, { usagePrices: { 'a/b': { input: 1, output: 2 }, 'c/d': { input: 1, output: 2 } } })
  assert.deepEqual(ops.filter((op) => op.path?.[0] === 'usagePrices'), [{ op: 'unset', path: ['usagePrices'] }], '撤整键而不是逐行留一个 `usagePrices: {}` 噪声')
})

// ── 关键接缝 2：写入时拒绝 NaN/Infinity/负数（schemastery 拦不住的三种值）──

test('写面（写入拒绝）：NaN/Infinity/负数/缺必填/脏键行丢弃 fail-closed，合法行照常落盘且值为 number', () => {
  const draft = { usagePrices: {
    'good/k': { input: 1, output: 2 },
    'nan/k': { input: NaN, output: 2 },
    'inf/k': { input: 1, output: Infinity },
    'neg/k': { input: -1, output: 2 },
    'negopt/k': { input: 1, output: 2, cacheRead: -0.5 },
    'miss/k': { input: 1 },
    'str/k': { input: 'abc', output: 2 },
    'bad key': { input: 1, output: 2 },
    '/lead': { input: 1, output: 2 },
    'trail/': { input: 1, output: 2 },
  } }
  const ops = saveOpsOf(draft, { usagePrices: {} })
  const sets = ops.filter((op) => op.op === 'set' && op.path?.[0] === 'usagePrices')
  assert.deepEqual(sets.map((op) => op.path[1]).sort(), ['good/k', 'negopt/k'], '必填桶非法/脏键行整行拒；可选桶非法 = 桶级剔除（Z11 视同该桶未定价）')
  const negopt = sets.find((op) => op.path[1] === 'negopt/k')
  assert.deepEqual(negopt.value, { input: 1, output: 2 }, '非法可选桶剔除后键省略')
  assert.equal(typeof sets[0].value.input, 'number', '落盘值恒为 number（schema 可收）')
})

test('写面（数字串兜底）：脚本直调塞数字串 → coerce 成 number 落盘；非数字串仍拒', () => {
  const ops = saveOpsOf({ usagePrices: { 'a/b': { input: '2.5', output: '8' }, 'c/d': { input: 'x', output: '1' } } }, { usagePrices: {} })
  const sets = ops.filter((op) => op.op === 'set' && op.path?.[0] === 'usagePrices')
  assert.deepEqual(sets.map((op) => op.path[1]), ['a/b'], '数字串 coerce 合法、非数字串拒')
  assert.equal(sets[0].value.input, 2.5, 'coerce 后是 number 2.5')
})

test('写面（usageCurrency）：合法值 set 顶级键、无键零触碰、枚举外丢弃（D1a）', () => {
  const ops1 = saveOpsOf({ usageCurrency: 'CNY' }, {})
  assert.deepEqual(ops1.filter((op) => op.path?.[0] === 'usageCurrency'), [{ op: 'set', path: ['usageCurrency'], value: 'CNY' }], '合法值逐点 set')
  const ops2 = saveOpsOf({ usagePrices: {} }, { usagePrices: {} })
  assert.equal(ops2.filter((op) => op.path?.[0] === 'usageCurrency').length, 0, '无键 = 显式携带才写，零触碰')
  const ops3 = saveOpsOf({ usageCurrency: 'EUR' }, {})
  assert.equal(ops3.filter((op) => op.path?.[0] === 'usageCurrency').length, 0, '枚举外丢弃（不毒杀整批）')
})

// ── 热更通路：字段随 settings/updated 到达消费端，不炸不丢 ────────────────

test('热更通路：lib 侧 settings/updated 消费带 usagePrices 的存储不炸，迁移不误伤单价表', async () => {
  let latest
  const settings = {
    register: () => ({}),
    get: (ns) => (ns === 'dsh-my-go' ? structuredClone(STORED_WITH_PRICES) : undefined),
    mutate: async (_ns, ops) => { latest = ops },
  }
  const { ctx, listeners } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  assert.doesNotThrow(() => listeners.get('settings/updated')('dsh-my-go'))
  assert.equal(latest, undefined, 'usagePrices 不是旧顶级工种键，迁移零 ops（不搬不删）')
})
