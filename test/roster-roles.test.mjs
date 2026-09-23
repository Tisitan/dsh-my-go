// 角色名册数据层（0.2.3-tisitan.14）：roles dict schema + 旧顶级键迁移 + 合并
// 泛化回归。本文件只加载 lib/index.js（独立进程，避免 Symbol.for 快照桥被
// broker 半覆盖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Config,
  ROLE_KEY_PATTERN,
  migrateLegacyRolesOps,
  mergeRoleBindings,
  apply as hostApply,
} from '../lib/index.js'
import { createPanelRpcTransport, resolvedHostConfig, createSettingsStub } from './helpers/mock-ctx.mjs'
import { buildSettingsOps, draftFromSection } from '../src/settings-ops.js'

// 写面判据用的层形状：value/user 同源、base 空——与被测编译器单测同口径。
const layersOf = (value) => ({ value, user: value, base: {} })

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-roster-home-'))

// 迁移源形状：旧 settings.yaml（0.2.3-tisitan.13 及之前）= sisyphus + 七个顶级
// 工种键。工种行含 fallbacks 全字段，验证无损搬运。（旧 toolMask 顶级键随屏蔽
// 功能迁移至 dsh-tool-guard 而废弃，不再进入迁移形状。）
const LEGACY_STORED = {
  sisyphus: { provider: 'p-s', model: 'm-s', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] },
  hermes: { provider: 'p1', model: 'm1', reasoningEffort: 'default', dsv4p0813: true, fallbacks: [{ provider: 'p2', model: 'm2' }] },
  explore: { provider: 'p1', model: 'm3', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  librarian: { provider: 'p1', model: 'm3', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  looker: { provider: 'p3', model: 'm4', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  hephaestus: { provider: 'p4', model: 'm5', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] },
  prometheus: { provider: 'p5', model: 'm6', reasoningEffort: 'max', dsv4p0813: false, fallbacks: [] },
  oracle: { provider: 'p5', model: 'm7', reasoningEffort: 'max', dsv4p0813: false, fallbacks: [] },
}
const WORKER_KEYS = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

function mockHostCtx({ settings } = {}) {
  const listeners = new Map()
  const panel = createPanelRpcTransport()
  const service = settings ?? createSettingsStub()
  const ctx = {
    get: (name) => {
      if (name === 'settings') return service
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, cb) => cb({ settings: service, effect: (fn) => fn(), get: (n) => ctx.get(n) }),
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    subagents: {},
  }
  return { ctx, listeners, rpc: panel.rpc }
}

// 把 LEGACY_STORED 里的七工种行搬进 roles（模拟迁移完成后的存储形状）
const MIGRATED_STORED = {
  sisyphus: LEGACY_STORED.sisyphus,
  roles: Object.fromEntries(WORKER_KEYS.map((k) => [k, LEGACY_STORED[k]])),
}

// ── schema：roles dict + 键名 pattern ────────────────────────────────────

// 0.1.7：schema 不再经 settings.register 上交，而是插件顶层导出的 `Config`——
// 宿主挂载期直接读它（entry.runtime.Config），并用 cordis resolveConfig 解析行
// config。故「校验一段配置」的忠实姿势是走同一条真路径：resolvedHostConfig(row)
// 抛错 = 宿主挂载期拒收。**注意**：直接调用 volatile 字段所在的 schema
// （`Config(row)`）返回的是默认值而非解析结果——`.volatile()` 会换掉该字段的可调用
// 语义（loader 经 updateVolatile 换引用），故测试不再用调用式校验。
async function captureSchema() {
  assert.ok(Config !== undefined, 'lib 半必须顶层导出 Config（0.1.7 声明式配置面）')
  return Config
}
const resolveSection = (row) => resolvedHostConfig(row)

test('schema：roles dict 接受 persona/toolFilter 且保持形状', async () => {
  const schema = await captureSchema()
  const row = {
    provider: 'p', model: 'm', reasoningEffort: 'high', dsv4p0813: false,
    fallbacks: [],
    persona: '你是自定义角色',
    toolFilter: { allow: ['read', 'glob'], deny: [] },
  }
  await captureSchema()
  const parsed = resolveSection({ roles: { 'custom-x': row } }).roles.get()
  assert.deepEqual(parsed['custom-x'].persona, '你是自定义角色', 'persona 原样保留')
  assert.deepEqual(parsed['custom-x'].toolFilter, { allow: ['read', 'glob'], deny: [] }, 'toolFilter 原样保留')
  assert.deepEqual(parsed['custom-x'].fallbacks, [], 'agent 基础字段与 agentSchema 同构')
})

test('schema：角色键名违反 ^[a-z][a-z-]*$ 在 schema 层拒绝', async () => {
  await captureSchema()
  for (const badKey of ['Hermes', 'r2d2', 'a_b', '中文角色', '-lead']) {
    assert.throws(() => resolveSection({ roles: { [badKey]: { provider: 'p', model: 'm' } } }), `非法键 "${badKey}" 必须被拒绝`)
  }
  assert.doesNotThrow(() => resolveSection({ roles: { 'custom-x': {}, vision: {} } }), '小写+连字符合法')
  assert.ok(ROLE_KEY_PATTERN.test('custom-x') && ROLE_KEY_PATTERN.test('vision'))
  assert.ok(!ROLE_KEY_PATTERN.test('R2D2') && !ROLE_KEY_PATTERN.test('a_b'))
})

test('schema 回归：sisyphus 顶级键不变；旧 toolMask 键透传不炸（消费面已拆）', async () => {
  await captureSchema()
  const parsed = resolveSection({ sisyphus: LEGACY_STORED.sisyphus, toolMask: { deny: ['mcp__a__x'] } })
  assert.deepEqual(parsed.sisyphus.get(), LEGACY_STORED.sisyphus, 'sisyphus 恒为顶级键')
  assert.deepEqual(parsed.toolMask, { deny: ['mcp__a__x'] }, '旧 toolMask 键原样透传（schemastery 未知键透传，消费面已拆除不再读它）')
  assert.ok(typeof parsed.roles.get() === 'object', 'roles 缺省为空 dict')
})

// ── 迁移：旧 9 键 → roles dict，无损、幂等 ───────────────────────────────

test('迁移：旧顶级工种键无损搬进 roles dict（含 fallbacks 全字段）', () => {
  const ops = migrateLegacyRolesOps(LEGACY_STORED)
  assert.ok(Array.isArray(ops), '旧形态必须产生迁移 ops')
  const sets = ops.filter((op) => op.op === 'set')
  const unsets = ops.filter((op) => op.op === 'unset')
  assert.deepEqual(sets.map((op) => op.path[1]).sort(), [...WORKER_KEYS].sort(), '七工种逐键 set 进 roles')
  assert.deepEqual(unsets.map((op) => op.path[0]).sort(), [...WORKER_KEYS].sort(), '旧键逐一 unset')
  for (const op of sets) {
    assert.deepEqual(op.path, ['roles', op.path[1]], 'set 路径为 roles.<key>')
    assert.deepEqual(op.value, LEGACY_STORED[op.path[1]], '整行无损搬运')
  }
  assert.deepEqual(
    sets.find((op) => op.path[1] === 'hermes').value.fallbacks,
    [{ provider: 'p2', model: 'm2' }],
    'fallbacks 全字段随行迁移',
  )
  assert.equal(ops.filter((op) => op.path[0] === 'sisyphus').length, 0, 'sisyphus 不参与迁移')
  assert.equal(ops.filter((op) => op.path[0] === 'toolMask').length, 0, 'toolMask 不参与迁移')
})

test('迁移幂等：迁移后形状再次检测返回 null', () => {
  assert.equal(migrateLegacyRolesOps(MIGRATED_STORED), null, '无顶级工种键 → 无 ops')
  assert.equal(migrateLegacyRolesOps({}), null)
  assert.equal(migrateLegacyRolesOps(undefined), null)
  assert.equal(migrateLegacyRolesOps(null), null)
})

test('迁移并存：roles 已有同名行时顶级旧行覆盖（旧顶级是权威来源）', () => {
  const stored = {
    ...MIGRATED_STORED,
    hermes: { provider: 'legacy-p', model: 'legacy-m', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  }
  const ops = migrateLegacyRolesOps(stored)
  assert.ok(ops)
  const hermesSet = ops.find((op) => op.op === 'set' && op.path[1] === 'hermes')
  assert.equal(hermesSet.value.model, 'legacy-m', '顶级行覆盖 roles.hermes')
  assert.equal(ops.filter((op) => op.path.includes('oracle')).length, 0, 'roles 已有的其余工种不被触碰')
})

// ── mergeRoleBindings：白名单泛化 + 自定义角色热更可见 ────────────────────

test('merge：roles.custom-x 键进入 bindings 并携带 persona/toolFilter', () => {
  const base = { sisyphus: {}, explore: {} }
  const bindings = mergeRoleBindings(base, {
    sisyphus: { provider: 'p-s', model: 'm-s' },
    roles: {
      explore: { provider: 'p1', model: 'm3' },
      'custom-x': {
        provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
        fallbacks: [{ provider: 'p8', model: 'm8' }],
        persona: '你是测试角色', toolFilter: { allow: ['read'], deny: ['write'] },
      },
    },
  })
  assert.deepEqual(bindings['custom-x'], {
    provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }],
    persona: '你是测试角色', toolFilter: { allow: ['read'], deny: ['write'] },
  }, '自定义角色行完整进入 bindings')
  assert.deepEqual(bindings.explore, { provider: 'p1', model: 'm3', reasoningEffort: undefined, dsv4p0813: false, fallbacks: undefined, persona: undefined, toolFilter: undefined }, '内置工种改从 roles 读取')
  assert.deepEqual(bindings.sisyphus, { provider: 'p-s', model: 'm-s', reasoningEffort: undefined, dsv4p0813: false, fallbacks: undefined, persona: undefined, toolFilter: undefined }, 'sisyphus 仍读顶级')
  assert.deepEqual(
    Object.keys(mergeRoleBindings(base, { roles: { 'custom-x': {} } })).filter((k) => !['sisyphus', 'explore', 'custom-x'].includes(k)),
    [],
    'base 之外的键只来自 roles dict',
  )
})

test('merge 回归：空/缺 roles 与旧基线语义一致', () => {
  const base = { sisyphus: { model: 'base-s' }, hermes: { model: 'base-h' } }
  assert.deepEqual(mergeRoleBindings(base, undefined).sisyphus.model, 'base-s')
  assert.deepEqual(mergeRoleBindings(base, {}).hermes.model, 'base-h')
  assert.deepEqual(mergeRoleBindings(base, null), base, 'null 存储原样回落基线')
})

test('merge：roles.sisyphus 死数据不消费——sisyphus 恒为顶级键（棒2-L1）', () => {
  const base = { sisyphus: {} }
  const merged = mergeRoleBindings(
    base,
    {
      sisyphus: { provider: 'top-p', model: 'top-m' },
      roles: { sisyphus: { provider: 'dict-p', model: 'dict-m' } },
    },
  )
  assert.equal(merged.sisyphus.provider, 'top-p', 'dict 里的 sisyphus 行不被消费，顶级键唯一生效')
  assert.equal(merged.sisyphus.model, 'top-m')
  // 排除而非并入：sisyphus 绑定不出现双权威（顶级 + dict 优先级凭空多一套）
  assert.deepEqual(mergeRoleBindings(base, { roles: { sisyphus: { provider: 'dict-p', model: 'dict-m' } } }).sisyphus, {}, '仅 dict 行时 sisyphus 回落基线，不读 dict')
})

// ── apply 行为级：初载迁移真实发生 + 热更幂等 + bindings 消费 roles ────────

test('apply：旧 9 键存储触发一次迁移 mutate，热更后不再重复迁移', async () => {
  const mutates = []
  const settings = createSettingsStub({ mutate: async (ns, ops) => { mutates.push({ ns, ops }) } })
  const { ctx, listeners } = mockHostCtx({ settings })
  await hostApply(ctx, resolvedHostConfig(LEGACY_STORED))
  assert.equal(mutates.length, 1, '初载恰好迁移一次')
  assert.equal(mutates[0].ns, 'dsh-my-go')
  assert.equal(mutates[0].ops.filter((op) => op.op === 'unset').length, WORKER_KEYS.length, '七个旧键 unset')
  // 模拟迁移落盘后的重入：行 config 已无旧顶级键（迁移 ops 已把它们 unset 掉）。
  const after = mockHostCtx({ settings })
  await hostApply(after.ctx, resolvedHostConfig(MIGRATED_STORED))
  assert.equal(mutates.length, 1, '迁移幂等：迁移后形状重入不产生第二次 mutate')
  // 本插件自己的 volatile 字段热更（宿主发 loader/volatile-update）同样不得重复迁移
  after.listeners.get('loader/volatile-update')([['roles']])
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(mutates.length, 1, '迁移幂等：volatile 热更重入不产生第二次 mutate')
  assert.ok(listeners.has('loader/volatile-update'), '热更监听挂在外层 ctx（settings 缺席也照挂）')
})

test('apply：迁移失败保留原配置且 apply 不中断（mutate 抛错）', async () => {
  const settings = createSettingsStub({ mutate: async () => { throw new Error('settings-rejected') } })
  const { ctx } = mockHostCtx({ settings })
  await assert.doesNotReject(() => hostApply(ctx, resolvedHostConfig(LEGACY_STORED)), '迁移失败只 warn，不炸插件装载')
})

// ── 读面投影 + 写面泛化（0.5.0-tisitan.3 起随 ops 编译层搬到浏览器侧）──────

test('draftFromSection：roles 内置工种行提升回顶级，roles 原样附带', () => {
  const draft = draftFromSection(MIGRATED_STORED)
  for (const field of ['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'fallbacks']) {
    assert.deepEqual(draft.hermes[field], LEGACY_STORED.hermes[field], `内置工种 ${field} 从 roles 提升回顶级`)
  }
  assert.deepEqual(draft.roles.hermes, LEGACY_STORED.hermes, 'roles 原样附带')
  assert.deepEqual(draft.sisyphus, { ...LEGACY_STORED.sisyphus }, 'sisyphus 顶级不变')
})

test('写面：sisyphus 顶级路径不变，draft 顶级工种键写入 roles 路径', () => {
  const ops = buildSettingsOps({
    sisyphus: { provider: 'p-s', model: 'm-s' },
    hermes: { provider: 'p1', model: 'm1' },
    roles: { 'custom-x': { provider: 'p9', model: 'm9' } },
  }, layersOf({}))
  assert.deepEqual(
    ops.filter((op) => op.path[0] === 'sisyphus' && op.path[1] === 'provider'),
    [{ op: 'set', path: ['sisyphus', 'provider'], value: 'p-s' }],
    'sisyphus 保持顶级路径',
  )
  assert.deepEqual(
    ops.filter((op) => op.path[1] === 'hermes' && op.path[2] === 'model'),
    [{ op: 'set', path: ['roles', 'hermes', 'model'], value: 'm1' }],
    'draft 顶级工种键映射写 roles（旧前端形状兼容）',
  )
  assert.deepEqual(
    ops.filter((op) => op.path[1] === 'custom-x' && op.path[2] === 'provider'),
    [{ op: 'set', path: ['roles', 'custom-x', 'provider'], value: 'p9' }],
    'draft.roles 自定义键直接写 roles',
  )
  assert.equal(ops.filter((op) => op.path[0] === 'roles' && op.path[2] === 'persona').length, 0, '保存循环不触碰 persona')
  assert.equal(ops.filter((op) => op.path[0] === 'roles' && op.path[2] === 'toolFilter').length, 0, '保存循环不触碰 toolFilter')
})

test('写面：draft 顶级值优先于 roles 同名旧值（用户编辑面生效）', () => {
  const ops = buildSettingsOps({
    hermes: { model: 'edited' },
    roles: { hermes: { model: 'stale' } },
  }, layersOf({}))
  const op = ops.find((o) => o.path[1] === 'hermes' && o.path[2] === 'model')
  assert.deepEqual(op, { op: 'set', path: ['roles', 'hermes', 'model'], value: 'edited' }, '顶级编辑值胜出')
})

test('写面：draft.roles.sisyphus 不产生任何写面（sisyphus 恒为顶级键，棒2-L1 写面）', () => {
  const ops = buildSettingsOps({
    roles: {
      sisyphus: { provider: 'dict-p', model: 'dict-m' },
      hermes: { provider: 'p1', model: 'm1' },
    },
  }, layersOf({}))
  assert.equal(ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'sisyphus').length, 0, 'roles.sisyphus 零写入（schema 拦不住的死数据在写面落盘前拦下）')
  assert.ok(ops.some((o) => o.path[1] === 'hermes' && o.path[2] === 'provider'), '正常角色行不受影响（哨兵）')
})

// ── 0.2.3-tisitan.15 前端功能批：persona 部分行 + snapshot 花名册 ──────────────

test('写面：只带 persona 的部分行不产生 5 字段 ops（已配绑定绝不被误清）', () => {
  const ops = buildSettingsOps({
    roles: { hermes: { persona: '覆盖人设' }, explore: { persona: '' } },
  }, layersOf({ roles: { hermes: { provider: 'p1', model: 'm1' }, explore: { provider: 'p2' } } }))
  for (const field of ['provider', 'model', 'reasoningEffort', 'dsv4p0813', 'fallbacks']) {
    assert.equal(ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'hermes' && o.path[2] === field).length, 0, `hermes.${field} 无 ops（字段缺失 = 不触碰）`)
  }
  assert.deepEqual(
    ops.filter((o) => o.path[1] === 'hermes'),
    [{ op: 'set', path: ['roles', 'hermes', 'persona'], value: '覆盖人设' }],
    '部分行只写 persona 一条',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[1] === 'explore'),
    [{ op: 'unset', path: ['roles', 'explore', 'persona'] }],
    '显式空 persona 仍 = unset（恢复文件默认）',
  )
  assert.equal(ops.filter((o) => o.path[0] === 'sisyphus').length, 0, 'draft 无 sisyphus 键 → 顶级循环全跳过')
})

test('snapshot 响应恒附 rosterLines：桥未就绪（无编排会话）也产出', async () => {
  const { ctx, rpc } = mockHostCtx({ settings: createSettingsStub() })
  await hostApply(ctx, resolvedHostConfig({}))
  const res = await rpc('/dsh-my-go', 'snapshot', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.parents, {}, '无编排会话时回落空编排状态')
  const lines = res.value.rosterLines
  assert.ok(Array.isArray(lines) && lines.length > 1, 'rosterLines 是非空行数组')
  assert.match(lines[0], /角色名册/, '首行是区标题')
  for (const key of ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle', 'apelles']) {
    assert.ok(lines.some((l) => l.startsWith(`- ${key} |`)), `内置键 ${key} 有一行摘要`)
  }
  assert.equal(res.value.roster.find((e) => e.role === 'apelles')?.builtin, true, 'apelles 是内置工种，结构化条目钉 builtin=true')
  assert.ok(!lines.some((l) => l.startsWith('- sisyphus')), 'sisyphus 是编排者单例，永不在可派花名册')
  assert.ok(lines.some((l) => l.includes('跟随环境')), '无绑定时标注跟随环境')
})
