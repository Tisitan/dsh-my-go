/**
 * 配置卡写面：浏览器侧 ops 编译层。
 *
 * 这批规则原本住私有 RPC `saveSettings` 闭包里（lib 半唯一权威），随配置面迁
 * 官方 configForms 一起搬到 src/settings-ops.js——原 lib 侧同名用例逐条搬来，
 * 判据一字未改（脏键 fail-closed、显式携带才写、整键删除、sisyphus 恒顶级、
 * 单价四桶口径），只是被测对象从「宿主替身收到的 ops」变成「编译器的返回值」。
 * 纯函数层：不起浏览器、不 mock 宿主。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BINDING_FIELDS,
  buildSettingsOps,
  compareKey,
  dirtyLabels,
  keepAliveIntent,
  draftFromSection,
  sectionAfterWrite,
  summaryLine,
  writeLanded,
} from '../src/settings-ops.js'
import { KEEP_ALIVE_DEFAULTS } from '../preset/shared/constants.mjs'

const layers = (value, { user = value, base = {} } = {}) => ({ value, user, base })

const row = (over = {}) => ({ provider: '', model: '', reasoningEffort: '', fallbacks: [], ...over })

// ── 读面投影 ───────────────────────────────────────────────────────────────

test('draftFromSection：roles 内置行提升回顶级、roles 原样附带、sisyphus 顶级不变', () => {
  const stored = {
    sisyphus: row({ provider: 'p-s', model: 'm-s' }),
    roles: { hermes: row({ provider: 'p1', model: 'm1', persona: '覆盖' }), 'custom-x': row() },
    usagePrices: { 'a/b': { input: 1, output: 2 } },
    usageCurrency: 'CNY',
  }
  const draft = draftFromSection(stored)
  assert.deepEqual({ ...draft.hermes }, { ...row({ provider: 'p1', model: 'm1' }), persona: '覆盖' }, '内置工种从 roles 提升回顶级')
  assert.deepEqual(draft.roles.hermes, stored.roles.hermes, 'roles 原样附带（自定义角色编辑器的数据源）')
  assert.deepEqual(draft.sisyphus, { ...row({ provider: 'p-s', model: 'm-s' }) }, 'sisyphus 顶级不变')
  assert.equal(draft.usageCurrency, 'CNY')
})

test('draftFromSection：脏输入归一不炸，未知币种回落 USD，脏价键滤掉', () => {
  const draft = draftFromSection({
    sisyphus: null,
    roles: { hermes: 'not-a-row', 'BAD-KEY': row(), 'custom-ok': row({ model: 'm' }) },
    usagePrices: ['array-not-a-dict'],
    usageCurrency: 'EUR',
  })
  assert.deepEqual(draft.sisyphus, row(), 'null 行归一成空行')
  assert.deepEqual(Object.keys(draft.roles), ['hermes', 'BAD-KEY', 'custom-ok'], 'roles 本体透传，脏键在写面与比对面才拦')
  assert.deepEqual(draft.usagePrices, {}, '非对象单价表归空')
  assert.equal(draft.usageCurrency, 'USD', '枚举外按 USD 渲染（与聚合器同回落）')
})

// ── 写面：工种与角色 ───────────────────────────────────────────────────────

test('写面：sisyphus 保持顶级路径，draft 顶级工种键写入 roles 路径', () => {
  const ops = buildSettingsOps({
    sisyphus: { provider: 'p-s', model: 'm-s' },
    hermes: { provider: 'p1', model: 'm1' },
    roles: { 'custom-x': { provider: 'p9', model: 'm9' } },
  }, layers({}))
  assert.deepEqual(ops.filter((op) => op.path[0] === 'sisyphus' && op.path[1] === 'provider'),
    [{ op: 'set', path: ['sisyphus', 'provider'], value: 'p-s' }], 'sisyphus 保持顶级路径')
  assert.deepEqual(ops.filter((op) => op.path[1] === 'hermes' && op.path[2] === 'model'),
    [{ op: 'set', path: ['roles', 'hermes', 'model'], value: 'm1' }], 'draft 顶级工种键映射写 roles（旧形状兼容）')
  assert.deepEqual(ops.filter((op) => op.path[1] === 'custom-x' && op.path[2] === 'provider'),
    [{ op: 'set', path: ['roles', 'custom-x', 'provider'], value: 'p9' }], 'draft.roles 自定义键直接写 roles')
  assert.equal(ops.filter((op) => op.path[0] === 'roles' && op.path[2] === 'persona').length, 0, '未携带 persona 就不触碰')
  assert.equal(ops.filter((op) => op.path[0] === 'roles' && op.path[2] === 'toolFilter').length, 0, '未携带 toolFilter 就不触碰')
})

test('写面：draft 顶级值优先于 roles 同名旧值（用户编辑面生效）', () => {
  const ops = buildSettingsOps({ hermes: { model: 'edited' }, roles: { hermes: { model: 'stale' } } }, layers({}))
  assert.deepEqual(ops.find((op) => op.path[1] === 'hermes' && op.path[2] === 'model'),
    { op: 'set', path: ['roles', 'hermes', 'model'], value: 'edited' }, '顶级编辑值胜出')
})

test('写面：roles.sisyphus 不产生任何写面（sisyphus 恒为顶级键）', () => {
  const ops = buildSettingsOps({ roles: { sisyphus: { provider: 'dict-p', model: 'dict-m' }, hermes: row({ provider: 'p1' }) } }, layers({}))
  assert.equal(ops.filter((op) => op.path[0] === 'roles' && op.path[1] === 'sisyphus').length, 0, 'roles.sisyphus 零写入（schema 拦不住的死数据在写面落盘前拦下）')
  assert.ok(ops.some((op) => op.path[1] === 'hermes' && op.path[2] === 'provider'), '正常角色行不受影响（哨兵）')
})

test('写面：只带 persona 的部分行不产生 5 字段 ops（已配绑定绝不被误清）', () => {
  const stored = { roles: { hermes: row({ provider: 'p1', model: 'm1' }), explore: row({ provider: 'p2' }) } }
  const ops = buildSettingsOps({ roles: { hermes: { persona: '覆盖人设' }, explore: { persona: '' } } }, layers(stored))
  for (const field of BINDING_FIELDS) {
    assert.equal(ops.filter((op) => op.path[1] === 'hermes' && op.path[2] === field).length, 0, `hermes.${field} 无 ops（字段缺失 = 不触碰）`)
  }
  assert.deepEqual(ops.filter((op) => op.path[1] === 'hermes'), [{ op: 'set', path: ['roles', 'hermes', 'persona'], value: '覆盖人设' }], '部分行只写 persona 一条')
  assert.deepEqual(ops.filter((op) => op.path[1] === 'explore'), [{ op: 'unset', path: ['roles', 'explore', 'persona'] }], '显式空串 = unset（恢复文件默认）')
})

test('写面：脏角色键就地丢弃，其余行照常落盘（一枚脏键不毒杀整批原子写）', () => {
  const ops = buildSettingsOps({ roles: { 'BAD-KEY': row({ model: 'x' }), 'ok-key': row({ model: 'y' }), 123: row(), 'has space': row() } }, layers({}))
  assert.equal(ops.filter((op) => JSON.stringify(op.path).includes('BAD-KEY') || JSON.stringify(op.path).includes('has space')).length, 0, '非法键零 op')
  assert.ok(ops.some((op) => op.path[1] === 'ok-key' && op.path[2] === 'model'), '合法行照常')
})

test('写面：draft 提供 roles dict 时缺失的非内置键整键 unset；draft 无 roles 键不清册', () => {
  const stored = { roles: { 'custom-a': row(), 'custom-b': row(), hermes: row() } }
  const ops = buildSettingsOps({ roles: { 'custom-a': row({ model: 'kept' }) } }, layers(stored, { user: stored }))
  assert.deepEqual(ops.filter((op) => op.op === 'unset' && op.path.length === 2), [{ op: 'unset', path: ['roles', 'custom-b'] }], '缺失的自定义键整键 unset')
  assert.ok(ops.some((op) => op.op === 'set' && op.path[1] === 'custom-a' && op.path[2] === 'model'), '在场的键照常字段级写')
  const untouched = buildSettingsOps({ hermes: row({ model: 'm' }) }, layers(stored, { user: stored }))
  assert.equal(untouched.filter((op) => op.op === 'unset' && op.path[0] === 'roles' && op.path.length === 2).length, 0, '不带 roles dict = 不解释为名册清空')
})

test('写面：fallbacks 空数组转 unset，非空数组原样 set', () => {
  const empty = buildSettingsOps({ sisyphus: { fallbacks: [] } }, layers({}))
  assert.deepEqual(empty.filter((op) => op.path[1] === 'fallbacks'), [{ op: 'unset', path: ['sisyphus', 'fallbacks'] }])
  const full = buildSettingsOps({ sisyphus: { fallbacks: [{ provider: 'p', model: 'm' }] } }, layers({}))
  assert.deepEqual(full.find((op) => op.path[1] === 'fallbacks'), { op: 'set', path: ['sisyphus', 'fallbacks'], value: [{ provider: 'p', model: 'm' }] })
})

test('写面：新建但还没填完的角色整行 set（只发 unset 会保存后静默消失）', () => {
  // 页面的「新建角色」写的是完整一行（含 fallbacks 数组与 toolFilter 对象），
  // 这就是「新建」与「只改人设的部分行」的唯一可分标志。
  const blank = { ...row(), persona: '' }
  const ops = buildSettingsOps({ roles: { 'brand-new': blank } }, layers({}))
  assert.deepEqual(ops.filter((op) => op.path[1] === 'brand-new'),
    [{ op: 'set', path: ['roles', 'brand-new'], value: { ...row(), persona: '' } }], '整行落地，名册里立刻看得见')
  const typed = buildSettingsOps({ roles: { 'brand-new': row({ model: 'x' }) } }, layers({}))
  assert.ok(typed.some((op) => op.op === 'set' && op.path[1] === 'brand-new' && op.path[2] === 'model'), '填了值的新行走字段级 set（宿主 applyPathOp 自建中间对象）')
  assert.equal(typed.filter((op) => op.path.length === 2 && op.path[1] === 'brand-new').length, 0, '有 set 时不再整行覆写，免得把没碰的字段一并钉住')
})

// ── 写面：单价表（原 lib 用例逐条搬来）─────────────────────────────────────

const USAGE_STORED = { usagePrices: { 'a/b': { input: 1, output: 2 }, 'stale/old': { input: 3, output: 4 } } }

test('写面（单价局部合并）：draft 逐行 set、存储缺行 unset、其他命名空间零触碰', () => {
  const ops = buildSettingsOps({ usagePrices: { 'a/b': { input: 9, output: 8 }, 'c/d': { input: 0.5, output: 1 } } }, layers(USAGE_STORED, { user: USAGE_STORED }))
  const priceOps = ops.filter((op) => op.path[0] === 'usagePrices')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'a/b'), { op: 'set', path: ['usagePrices', 'a/b'], value: { input: 9, output: 8 } }, '已存行按 draft 新值 set')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'c/d'), { op: 'set', path: ['usagePrices', 'c/d'], value: { input: 0.5, output: 1 } }, '新增行 set')
  assert.deepEqual(priceOps.find((op) => op.path[1] === 'stale/old'), { op: 'unset', path: ['usagePrices', 'stale/old'] }, 'draft 缺的存量行 unset')
  assert.equal(priceOps.length, 3, '局部合并 = 恰好三枚 ops')
  assert.equal(ops.filter((op) => op.path[0] === 'roles' || op.path[0] === 'sisyphus').length, 0, 'roles/sisyphus 零触碰（draft 未携带）')
})

test('写面（空表语义）：draft.usagePrices = {} → 整键 unset，不留一行空字典', () => {
  const stored = { usagePrices: { 'a/b': { input: 1, output: 2 }, 'c/d': { input: 1, output: 2 } } }
  const ops = buildSettingsOps({ usagePrices: {} }, layers(stored, { user: stored }))
  assert.deepEqual(ops.filter((op) => op.path[0] === 'usagePrices'), [{ op: 'unset', path: ['usagePrices'] }], '清空整表 = 撤整键（逐行 unset 会落下 usagePrices: {} 噪声）')
})

test('写面（币种旋钮）：与宿主现值同形时不发 op，缺省不许被钉进用户层', () => {
  const stored = { usagePrices: {}, usageCurrency: 'USD' }
  const same = buildSettingsOps(draftFromSection(stored), layers(stored, { user: stored }))
  assert.equal(same.filter((op) => op.path[0] === 'usageCurrency').length, 0, '草稿就是现值 → 零 op')
  const switched = buildSettingsOps({ ...draftFromSection(stored), usageCurrency: 'CNY' }, layers(stored, { user: stored }))
  assert.deepEqual(switched.filter((op) => op.path[0] === 'usageCurrency'), [{ op: 'set', path: ['usageCurrency'], value: 'CNY' }], '真切换才写')
  const fromNothing = buildSettingsOps(draftFromSection({ usagePrices: {} }), layers({ usagePrices: {} }))
  assert.equal(fromNothing.filter((op) => op.path[0] === 'usageCurrency').length, 0, '现值缺省 = schema 已给 USD，不必再钉一遍')
})

test('写面（单价写入拒绝）：NaN/Infinity/负数/缺必填/脏键整行拒，合法行值为 number', () => {
  const draft = { usagePrices: {
    'good/k': { input: 1, output: 2 },
    'nan/k': { input: NaN, output: 2 },
    'inf/k': { input: 1, output: Infinity },
    'neg/k': { input: -1, output: 2 },
    'negopt/k': { input: 1, output: 2, cacheRead: -0.5 },
    'miss/k': { input: 1 },
    'str/k': { input: 'abc', output: 2 },
    'bad key': { input: 1, output: 2 },
    'trail/': { input: 1, output: 2 },
  } }
  const ops = buildSettingsOps(draft, layers({ usagePrices: {} }))
  const sets = ops.filter((op) => op.op === 'set' && op.path[0] === 'usagePrices')
  assert.deepEqual(sets.map((op) => op.path[1]).sort(), ['good/k', 'negopt/k'], '必填桶非法/脏键整行拒；可选桶非法 = 桶级剔除')
  assert.deepEqual(sets.find((op) => op.path[1] === 'negopt/k').value, { input: 1, output: 2 }, '非法可选桶剔除后键省略')
  assert.equal(typeof sets[0].value.input, 'number', '落盘值恒为 number（schema 可收）')
})

test('写面（单价数字串兜底）：数字串 coerce 成 number，非数字串仍整行拒', () => {
  const ops = buildSettingsOps({ usagePrices: { 'a/b': { input: '2.5', output: '8' }, 'c/d': { input: 'x', output: '1' } } }, layers({ usagePrices: {} }))
  const sets = ops.filter((op) => op.op === 'set' && op.path[0] === 'usagePrices')
  assert.deepEqual(sets.map((op) => op.path[1]), ['a/b'])
  assert.equal(sets[0].value.input, 2.5)
})

test('写面（usageCurrency）：合法值 set 顶级键、未携带零触碰、枚举外丢弃', () => {
  assert.deepEqual(buildSettingsOps({ usageCurrency: 'CNY' }, layers({})).filter((op) => op.path[0] === 'usageCurrency'),
    [{ op: 'set', path: ['usageCurrency'], value: 'CNY' }])
  assert.equal(buildSettingsOps({ usagePrices: {} }, layers({ usagePrices: {} })).filter((op) => op.path[0] === 'usageCurrency').length, 0, '无键 = 显式携带才写')
})

// ── 读回判定（官方信道被拒不抛，只有读回能证明落盘）────────────────────────

test('writeLanded：草稿与「ops 应用到现值」的投影同形才算落盘', () => {
  const stored = { roles: { hermes: row() }, usagePrices: {}, usageCurrency: 'USD' }
  const draft = draftFromSection(stored)
  const edited = structuredClone(draft)
  edited.oracle = { ...edited.oracle, model: 'deepseek-chat', provider: 'deepseek' }
  const ops = buildSettingsOps(edited, layers(stored))
  assert.equal(writeLanded(edited, layers(stored), ops), true, '正常写：读回等于草稿')
  assert.equal(writeLanded(edited, layers(stored), []), false, '宿主什么都没写（被拒）→ 判没落盘')
  const other = structuredClone(edited)
  other.oracle = { ...other.oracle, model: '别的' }
  assert.equal(writeLanded(other, layers(stored), ops), false, '草稿与 ops 不是一对时也判没落盘')
})

test('sectionAfterWrite：unset 露出 composition base，而不是留在原地', () => {
  const value = { usageCurrency: 'CNY', roles: { hermes: row({ model: 'user-set' }) } }
  const base = { usageCurrency: 'USD', roles: { hermes: row({ model: 'base-set' }) } }
  const next = sectionAfterWrite({ value, base }, [
    { op: 'unset', path: ['usageCurrency'] },
    { op: 'unset', path: ['roles', 'hermes', 'model'] },
  ])
  assert.equal(next.usageCurrency, 'USD', '清一个 base 声明过的字段 = 回 base')
  assert.equal(next.roles.hermes.model, 'base-set', '嵌套路径同样回 base')
})

test('sectionAfterWrite：set 会造出中间对象（新角色的第一条字段写不落空）', () => {
  const next = sectionAfterWrite({ value: {}, base: {} }, [{ op: 'set', path: ['roles', 'deep', 'model'], value: 'm' }])
  assert.deepEqual(next.roles.deep, { model: 'm' }, '宿主 applyPathOp 同款行为：路径 set 自建中间对象')
})

// ── 脏度与摘要 ─────────────────────────────────────────────────────────────

test('compareKey/dirtyLabels：改动可数，未改不可数；空串与缺键同形', () => {
  const stored = { sisyphus: row({ provider: '' }), roles: {}, usagePrices: {}, usageCurrency: 'USD' }
  const draft = draftFromSection(stored)
  assert.equal(compareKey(draft), compareKey(draftFromSection({ roles: {}, usagePrices: {} })), '缺键与解析出的空值同形')
  assert.deepEqual(dirtyLabels(draft, stored), [], '未改 = 无标签')
  const edited = structuredClone(draft)
  edited.usageCurrency = 'CNY'
  assert.deepEqual(dirtyLabels(edited, stored), ['币种'])
  edited.hermes = { ...edited.hermes, model: 'x' }
  assert.deepEqual(dirtyLabels(edited, stored), ['内置工种 1 项', '角色名册', '币种'])
})

test('summaryLine：内置数、自定义数、单价条数与币种一句话', () => {
  assert.equal(summaryLine({}), '编排 9 角色（0 个指定了模型） · 未配单价（只统计 token）')
  assert.equal(summaryLine({
    roles: { hermes: row({ provider: 'p', model: 'm' }), 'custom-a': row(), 'BAD-KEY': row() },
    usagePrices: { 'a/b': { input: 1, output: 1 } },
    usageCurrency: 'CNY',
  }), '编排 9 角色（1 个指定了模型） · 自定义 1 · 单价 1 条（CNY）')
})

// ── keepAlive（主编缓存心跳）：读面归一 / 只写真变的字段 / 改回默认 = 撤销覆盖 ──
// 第五个配置段。三条纪律与既有各段同源：缺席回落默认单源、显式携带才
// 写、草稿与现值同形时不发 op（否则每次保存都会把 schema 默认钉进用户层）。

test('keepAlive 读面：段缺席/值非法一律回落默认单源，段在席则逐字段收口', () => {
  assert.deepEqual(draftFromSection({}).keepAlive, { ...KEEP_ALIVE_DEFAULTS }, '缺席 = 默认段（enabled 关）')
  assert.deepEqual(
    draftFromSection({ keepAlive: { enabled: true, orchestratorIntervalMs: 60000 } }).keepAlive,
    { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 60000 },
    '段里给的用段，缺的补默认',
  )
  assert.deepEqual(
    draftFromSection({ keepAlive: { enabled: 'yes', orchestratorIntervalMs: 0, childPingAfterMs: -1, escalateAfterPings: 'x' } }).keepAlive,
    { ...KEEP_ALIVE_DEFAULTS },
    '非法值不冒充配置：布尔只要真 true，三个数字各按 >=1 的整数收口',
  )
  assert.equal(draftFromSection({ keepAlive: { orchestratorIntervalMs: '90000' } }).keepAlive.orchestratorIntervalMs, 90000, '数字串收口（settings.yaml 手改形态）')
})

test('keepAlive 写面：只发真变了的字段；未携带 = 零触碰；改回默认 = unset 撤销覆盖', () => {
  const stored = { roles: {}, usagePrices: {}, usageCurrency: 'USD', keepAlive: { ...KEEP_ALIVE_DEFAULTS } }
  const same = draftFromSection(stored)
  assert.deepEqual(buildSettingsOps(same, layers(stored, { user: { keepAlive: { enabled: true } } })).filter((op) => op.path[0] === 'keepAlive'),
    [], '草稿与现值同形 → 零 op（schema 默认不落用户层）')
  const enabled = { ...same, keepAlive: { ...same.keepAlive, enabled: true } }
  assert.deepEqual(buildSettingsOps(enabled, layers(stored, { user: {} })).filter((op) => op.path[0] === 'keepAlive'),
    [{ op: 'set', path: ['keepAlive', 'enabled'], value: true }], '只发开关这一条 set')
  // 用户层已有覆盖、草稿把值改回默认 → unset（露出行 config 的 base），不是再写一遍默认
  const backToDefault = { ...same, keepAlive: { ...same.keepAlive, orchestratorIntervalMs: KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs } }
  const withPinned = layers({ ...stored, keepAlive: { ...KEEP_ALIVE_DEFAULTS, orchestratorIntervalMs: 60000 } }, { user: { keepAlive: { orchestratorIntervalMs: 60000 } } })
  assert.deepEqual(buildSettingsOps(backToDefault, withPinned).filter((op) => op.path[0] === 'keepAlive'),
    [{ op: 'unset', path: ['keepAlive', 'orchestratorIntervalMs'] }], '改回默认 = 撤销该项覆盖')
  // 半输入 / 非法串：收口丢弃（与单价行 fail-closed 同款），不写盘也不会回退成默认
  for (const raw of ['', '  ', '-', 'abc', '1e']) {
    const half = { ...same, keepAlive: { ...same.keepAlive, orchestratorIntervalMs: raw } }
    assert.deepEqual(buildSettingsOps(half, layers(stored, { user: {} })).filter((op) => op.path[0] === 'keepAlive'), [], `半输入「${raw}」不写盘`)
  }
  // draft 不携带该段（脚本直调 / 老草稿）：零触碰
  assert.deepEqual(buildSettingsOps({ roles: {} }, layers(stored)).filter((op) => op.path[0] === 'keepAlive'), [])
})

test('keepAlive 写面：宿主没声明这一段 ⇒ 一条 op 都不发（不许把整批写入拖死）', () => {
  // 真事故（ 补测）：宿主半进程持有的是**旧** schema（插件经 import()
  // 装配、Node 的 ESM 缓存按 URL 命中，改过的 lib/config.js 换不掉已启动进程里的
  // fiber.runtime.Config）⇒ 宿主侧 volatile 闸判 `keepAlive.enabled is not volatile`。
  // 页面的读面此刻没有这一段（schema 默认没解析进现值），我们若照常发 op，后果不是
  // 「这一段没保存」而是**整次原子写入被拒**——同一次点击里改过的角色/单价一并陪葬。
  const undeclared = { roles: {}, usagePrices: {}, usageCurrency: 'USD' }
  const draft = draftFromSection(undeclared)
  draft.keepAlive = { ...draft.keepAlive, enabled: true, orchestratorIntervalMs: 600000 }
  draft.usageCurrency = 'CNY'
  draft.oracle = { ...draft.oracle, model: 'm2' }
  const ops = buildSettingsOps(draft, layers(undeclared, { user: { usageCurrency: 'USD', roles: { oracle: { model: 'm1' } } } }))
  assert.deepEqual(ops.filter((op) => op.path[0] === 'keepAlive'), [], '未声明段零 op（哪怕草稿把四个字段都改了个遍）')
  assert.deepEqual(ops.filter((op) => op.path[0] === 'usageCurrency'), [{ op: 'set', path: ['usageCurrency'], value: 'CNY' }], '同一次点击里的其它改动照常发')
  assert.ok(ops.some((op) => op.op === 'set' && op.path.join('.') === 'roles.oracle.model' && op.value === 'm2'), '同一次点击里的角色改动照常发')
  assert.equal(ops.some((op) => op.path[0] === 'keepAlive'), false, '整份 ops 里没有一条心跳 op')
  // 对照组：段在席（schema 已声明、默认已解析）时照旧只发真变了的字段
  const declared = { ...undeclared, keepAlive: { ...KEEP_ALIVE_DEFAULTS } }
  const declaredOps = buildSettingsOps(draft, layers(declared, { user: {} }))
  assert.deepEqual(declaredOps.filter((op) => op.path[0] === 'keepAlive'), [
    { op: 'set', path: ['keepAlive', 'enabled'], value: true },
    { op: 'set', path: ['keepAlive', 'orchestratorIntervalMs'], value: 600000 },
  ], '在席时：草稿真改了的两个字段照常发 op（段在席判据只看宿主现值，不看草稿）')
})

test('keepAlive 往返：脏标签「缓存心跳」、数字串编辑落盘后读回判定为已落盘', () => {
  const stored = { roles: {}, usagePrices: {}, usageCurrency: 'USD', keepAlive: { ...KEEP_ALIVE_DEFAULTS } }
  const draft = draftFromSection(stored)
  draft.keepAlive = { ...draft.keepAlive, enabled: true, orchestratorIntervalMs: '60' }
  assert.deepEqual(dirtyLabels(draft, stored), ['缓存心跳'])
  const ops = buildSettingsOps(draft, layers(stored, { user: stored }))
  assert.deepEqual(ops.filter((op) => op.path[0] === 'keepAlive'), [
    { op: 'set', path: ['keepAlive', 'enabled'], value: true },
    { op: 'set', path: ['keepAlive', 'orchestratorIntervalMs'], value: 60 },
  ])
  assert.equal(writeLanded(draft, layers(stored, { user: stored }), ops), true, '按 ops 模拟写回后草稿与现值同形（判定已落盘）')
  assert.equal(summaryLine({ ...stored, keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true } }).endsWith('缓存心跳开'), true, '开启态进 summary 一行')
  assert.ok(!summaryLine(stored).includes('缓存心跳'), '默认关不进 summary（不在折叠行里占字数）')
})

// ── 半输入的两条不一致路径─────────────────────

test('keepAliveIntent：不可用原文 = 未触碰（null）；越界值按 min(1) 回落，不再被读成「回到默认」', () => {
  // 不可用原文：空、空白、只有个减号、非数字残字、指数残字、非字符串容器
  for (const raw of ['', '  ', '-', 'abc', '1e', 'x1', null, undefined, {}, [], true]) {
    for (const field of ['orchestratorIntervalMs', 'childPingAfterMs', 'escalateAfterPings']) {
      assert.equal(keepAliveIntent(field, raw), null, `未触碰：${field} = ${String(raw)}`)
    }
  }
  // 域内照收：数字毫秒原样、数字串与读面同读法（n≥1 当毫秒）
  assert.equal(keepAliveIntent('orchestratorIntervalMs', 600000), 600000)
  assert.equal(keepAliveIntent('orchestratorIntervalMs', 250000), 250000)
  assert.equal(keepAliveIntent('orchestratorIntervalMs', '90000'), 90000, 'settings.yaml 手改形态的数字串照 keepAliveFrom 读法')
  assert.equal(keepAliveIntent('escalateAfterPings', '3'), 3)
  assert.equal(keepAliveIntent('escalateAfterPings', 5), 5)
  assert.equal(keepAliveIntent('enabled', true), true)
  assert.equal(keepAliveIntent('enabled', false), false, '关掉开关是一次真意图，不是「未触碰」')
  // 越界（可解析但 < 下限）：时长项夹到 1 秒 = 1000ms；连拍数夹到 1
  for (const raw of ['0', 0, '-5', -5, '0.5']) {
    assert.equal(keepAliveIntent('orchestratorIntervalMs', raw), 1000, `越界 → min(1 秒)：${String(raw)}`)
    assert.equal(keepAliveIntent('childPingAfterMs', raw), 1000)
  }
  assert.equal(keepAliveIntent('escalateAfterPings', '0'), 1, '连拍数的下限是 1 拍')
  assert.equal(keepAliveIntent('escalateAfterPings', 0), 1)
  // 非有限数（NaN/Infinity 以数字形态混进来）仍算未触碰
  assert.equal(keepAliveIntent('orchestratorIntervalMs', NaN), null)
  assert.equal(keepAliveIntent('orchestratorIntervalMs', Infinity), null)
})

test('keepAlive 半输入口子一：清空拍距框不算改动——不报脏、零 op、读回判定不相诉', () => {
  // 现场：用户层钉过拍距 60000（非默认）。旧口径把「清空」投影成默认值 → 与现值
  // 不等 → 页面报脏 + 发 0 条 op + 读回判「没落盘」= 一次纯属虚构的红字。
  const pinned = {
    roles: {}, usagePrices: {}, usageCurrency: 'USD',
    keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 60000 },
  }
  const userLayer = { keepAlive: { enabled: true, orchestratorIntervalMs: 60000 } }
  const stored = draftFromSection(pinned)
  for (const raw of ['', '  ', '-', 'abc', '1e']) {
    const cleared = { ...stored, keepAlive: { ...stored.keepAlive, orchestratorIntervalMs: raw } }
    assert.equal(compareKey(cleared, stored), compareKey(stored), `清空「${raw}」= 未触碰：两侧同形（页面不报脏）`)
    assert.deepEqual(dirtyLabels(cleared, pinned), [], `待保存清单里没有「缓存心跳」：[${raw}]`)
    const ops = buildSettingsOps(cleared, layers(pinned, { user: userLayer }))
    assert.deepEqual(ops.filter((op) => op.path[0] === 'keepAlive'), [], `零 op（不写盘、也不悄悄回退成默认）：[${raw}]`)
    assert.equal(writeLanded(cleared, layers(pinned, { user: userLayer }), ops), true, `零 op 的保存照判「已落盘」：[${raw}]`)
    assert.deepEqual(sectionAfterWrite(layers(pinned, { user: userLayer }), ops).keepAlive.orchestratorIntervalMs, 60000, '用户层那条覆盖原封不动')
  }
  // 对照（没有用户层覆盖、现值为默认）：清空同样零 op、同样不报脏
  const plain = { roles: {}, usagePrices: {}, usageCurrency: 'USD', keepAlive: { ...KEEP_ALIVE_DEFAULTS } }
  const plainStored = draftFromSection(plain)
  const plainCleared = { ...plainStored, keepAlive: { ...plainStored.keepAlive, orchestratorIntervalMs: '' } }
  assert.deepEqual(dirtyLabels(plainCleared, plain), [])
  assert.deepEqual(buildSettingsOps(plainCleared, layers(plain)).filter((op) => op.path[0] === 'keepAlive'), [])
})

test('keepAlive 半输入口子二：敲 0 按 min(1) 回落成 set（不是 unset 掉用户的覆盖）', () => {
  const pinned = {
    roles: {}, usagePrices: {}, usageCurrency: 'USD',
    keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 60000 },
  }
  const userLayer = { keepAlive: { enabled: true, orchestratorIntervalMs: 60000 } }
  const stored = draftFromSection(pinned)
  const zeroed = { ...stored, keepAlive: { ...stored.keepAlive, orchestratorIntervalMs: '0' } }
  assert.deepEqual(dirtyLabels(zeroed, pinned), ['缓存心跳'], '敲 0 是一次真改动（不是「回到默认」）')
  const ops = buildSettingsOps(zeroed, layers(pinned, { user: userLayer }))
  assert.deepEqual(ops.filter((op) => op.path[0] === 'keepAlive'),
    [{ op: 'set', path: ['keepAlive', 'orchestratorIntervalMs'], value: 1000 }],
    '0 → 夹到下限 1 秒并 set；旧口径会误发 unset，把用户层那条覆盖悄悄删掉')
  assert.equal(writeLanded(zeroed, layers(pinned, { user: userLayer }), ops), true, '写回后判据一致（不是每次都红）')
  assert.deepEqual(sectionAfterWrite(layers(pinned, { user: userLayer }), ops).keepAlive.orchestratorIntervalMs, 1000, '落盘值就是 1 秒')
  // 越界家族同类：负数 / 0.5 都夹到 1 秒，且都不碰别的字段
  for (const raw of ['-5', '0.5', 0]) {
    const bad = { ...stored, keepAlive: { ...stored.keepAlive, childPingAfterMs: raw } }
    assert.deepEqual(buildSettingsOps(bad, layers(pinned, { user: userLayer })).filter((op) => op.path[0] === 'keepAlive'),
      [{ op: 'set', path: ['keepAlive', 'childPingAfterMs'], value: 1000 }], `越界「${String(raw)}」→ 1 秒`)
  }
  // 连拍数越界：下限 1 拍（不是 1000）
  const pings = { ...stored, keepAlive: { ...stored.keepAlive, escalateAfterPings: '0' } }
  assert.deepEqual(buildSettingsOps(pings, layers(pinned, { user: userLayer })).filter((op) => op.path[0] === 'keepAlive'),
    [{ op: 'set', path: ['keepAlive', 'escalateAfterPings'], value: 1 }])
  // 「改回默认 = 撤销覆盖」的老口径不受影响（默认值仍走 unset）
  const backToDefault = { ...stored, keepAlive: { ...stored.keepAlive, orchestratorIntervalMs: KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs } }
  assert.deepEqual(buildSettingsOps(backToDefault, layers(pinned, { user: userLayer })).filter((op) => op.path[0] === 'keepAlive'),
    [{ op: 'unset', path: ['keepAlive', 'orchestratorIntervalMs'] }], '真改回默认值仍是 unset')
})
