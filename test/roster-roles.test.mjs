// 角色名册数据层（0.2.3-tisitan.14）：roles dict schema + 旧顶级键迁移 + 合并
// 泛化回归。本文件只加载 lib/index.js（独立进程，避免 Symbol.for 快照桥被
// broker 半覆盖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ROLE_KEY_PATTERN,
  migrateLegacyRolesOps,
  mergeRoleBindings,
  apply as hostApply,
} from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-roster-home-'))

// 迁移源形状：旧 settings.yaml（0.2.3-tisitan.13 及之前）= sisyphus + 七个顶级
// 工种键 + toolMask。工种行含 fallbacks 全字段，验证无损搬运。
const LEGACY_STORED = {
  sisyphus: { provider: 'p-s', model: 'm-s', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] },
  hermes: { provider: 'p1', model: 'm1', reasoningEffort: 'default', dsv4p0813: true, fallbacks: [{ provider: 'p2', model: 'm2' }] },
  explore: { provider: 'p1', model: 'm3', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  librarian: { provider: 'p1', model: 'm3', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  looker: { provider: 'p3', model: 'm4', reasoningEffort: 'default', dsv4p0813: false, fallbacks: [] },
  hephaestus: { provider: 'p4', model: 'm5', reasoningEffort: 'high', dsv4p0813: false, fallbacks: [] },
  prometheus: { provider: 'p5', model: 'm6', reasoningEffort: 'max', dsv4p0813: false, fallbacks: [] },
  oracle: { provider: 'p5', model: 'm7', reasoningEffort: 'max', dsv4p0813: false, fallbacks: [] },
  toolMask: { deny: ['mcp__a__x'] },
}
const WORKER_KEYS = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

function mockHostCtx({ settings } = {}) {
  const listeners = new Map()
  const rpcHandlers = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'settings') return settings
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    inject: (_deps, cb) => {
      try { cb({ connection: { rpc: { handle: (channel, fn) => { rpcHandlers.set(channel, fn) } } } }) } catch { /* no connection */ }
    },
    effect: (fn) => { try { fn() } catch { /* section mocks */ } },
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    subagents: {},
  }
  return { ctx, listeners, rpc: (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload) }
}

// 把 LEGACY_STORED 里的七工种行搬进 roles（模拟迁移完成后的存储形状）
const MIGRATED_STORED = {
  sisyphus: LEGACY_STORED.sisyphus,
  toolMask: LEGACY_STORED.toolMask,
  roles: Object.fromEntries(WORKER_KEYS.map((k) => [k, LEGACY_STORED[k]])),
}

// ── schema：roles dict + 键名 pattern ────────────────────────────────────

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

test('schema：roles dict 接受 persona/toolFilter 且保持形状', async () => {
  const schema = await captureSchema()
  const row = {
    provider: 'p', model: 'm', reasoningEffort: 'high', dsv4p0813: false,
    fallbacks: [],
    persona: '你是自定义角色',
    toolFilter: { allow: ['read', 'glob'], deny: [] },
  }
  const parsed = schema({ roles: { 'custom-x': row } })
  assert.deepEqual(parsed.roles['custom-x'].persona, '你是自定义角色', 'persona 原样保留')
  assert.deepEqual(parsed.roles['custom-x'].toolFilter, { allow: ['read', 'glob'], deny: [] }, 'toolFilter 原样保留')
  assert.deepEqual(parsed.roles['custom-x'].fallbacks, [], 'agent 基础字段与 agentSchema 同构')
})

test('schema：角色键名违反 ^[a-z][a-z-]*$ 在 schema 层拒绝', async () => {
  const schema = await captureSchema()
  for (const badKey of ['Hermes', 'r2d2', 'a_b', '中文角色', '-lead']) {
    assert.throws(() => schema({ roles: { [badKey]: { provider: 'p', model: 'm' } } }), `非法键 "${badKey}" 必须被拒绝`)
  }
  assert.doesNotThrow(() => schema({ roles: { 'custom-x': {}, vision: {} } }), '小写+连字符合法')
  assert.ok(ROLE_KEY_PATTERN.test('custom-x') && ROLE_KEY_PATTERN.test('vision'))
  assert.ok(!ROLE_KEY_PATTERN.test('R2D2') && !ROLE_KEY_PATTERN.test('a_b'))
})

test('schema 回归：sisyphus 顶级键与 toolMask 行为不变', async () => {
  const schema = await captureSchema()
  const parsed = schema({ sisyphus: LEGACY_STORED.sisyphus, toolMask: { deny: ['mcp__a__x'] } })
  assert.deepEqual(parsed.sisyphus, LEGACY_STORED.sisyphus, 'sisyphus 恒为顶级键')
  assert.deepEqual(parsed.toolMask.deny, ['mcp__a__x'], 'toolMask 行为不变')
  assert.ok(typeof parsed.roles === 'object', 'roles 缺省为空 dict')
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
  let current = LEGACY_STORED
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => current,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, listeners } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  assert.equal(mutates.length, 1, '初载恰好迁移一次')
  assert.equal(mutates[0].ns, 'dsh-my-go')
  assert.equal(mutates[0].ops.filter((op) => op.op === 'unset').length, WORKER_KEYS.length, '七个旧键 unset')
  // 模拟落盘后热更：存储已变（settings/updated 再入），不得二次迁移
  current = MIGRATED_STORED
  listeners.get('settings/updated')('dsh-my-go')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(mutates.length, 1, '迁移幂等：热更重入不产生第二次 mutate')
})

test('apply：迁移失败保留原配置且 apply 不中断（mutate 抛错）', async () => {
  const settings = {
    register: () => ({}),
    get: () => LEGACY_STORED,
    mutate: async () => { throw new Error('settings-rejected') },
  }
  const { ctx } = mockHostCtx({ settings })
  await assert.doesNotReject(() => hostApply(ctx, {}), '迁移失败只 warn，不炸插件装载')
})

// ── RPC：loadSettings 形状提升 + saveSettings 泛化 ────────────────────────

test('loadSettings：roles 内置工种行提升回顶级（旧前端形状），roles 原样附带', async () => {
  const settings = {
    register: () => ({}),
    get: () => MIGRATED_STORED,
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  const res = await rpc('/dsh-my-go', 'loadSettings', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.hermes, LEGACY_STORED.hermes, '内置工种从 roles 提升回顶级')
  assert.deepEqual(res.value.roles.hermes, LEGACY_STORED.hermes, 'roles 原样附带')
  assert.deepEqual(res.value.sisyphus, LEGACY_STORED.sisyphus, 'sisyphus 顶级不变')
  assert.deepEqual(res.value.toolMask, LEGACY_STORED.toolMask, 'toolMask 顶级不变')
})

test('saveSettings：sisyphus 顶级路径不变，draft 顶级工种键写入 roles 路径', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    sisyphus: { provider: 'p-s', model: 'm-s' },
    hermes: { provider: 'p1', model: 'm1' },
    roles: { 'custom-x': { provider: 'p9', model: 'm9' } },
  })
  assert.equal(res.ok, true)
  const ops = mutates[0].ops
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

test('saveSettings：draft 顶级值优先于 roles 同名旧值（用户编辑面生效）', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  await rpc('/dsh-my-go', 'saveSettings', {
    hermes: { model: 'edited' },
    roles: { hermes: { model: 'stale' } },
  })
  const op = mutates[0].ops.find((o) => o.path[1] === 'hermes' && o.path[2] === 'model')
  assert.deepEqual(op, { op: 'set', path: ['roles', 'hermes', 'model'], value: 'edited' }, '顶级编辑值胜出')
})

test('saveSettings：draft.roles.sisyphus 不产生任何写面（sisyphus 恒为顶级键，棒2-L1 写面）', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    roles: {
      sisyphus: { provider: 'dict-p', model: 'dict-m' },
      hermes: { provider: 'p1', model: 'm1' },
    },
  })
  assert.equal(res.ok, true)
  const ops = mutates[0].ops
  assert.equal(ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'sisyphus').length, 0, 'roles.sisyphus 零写入（schema 拦不住的死数据在写面落盘前拦下）')
  assert.ok(ops.some((o) => o.path[1] === 'hermes' && o.path[2] === 'provider'), '正常角色行不受影响（哨兵）')
})

// ── 0.2.3-tisitan.15 前端功能批：persona 部分行 + snapshot 花名册 ──────────────

test('saveSettings：只带 persona 的部分行不产生 5 字段 ops（已配绑定绝不被误清）', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    roles: { hermes: { persona: '覆盖人设' }, explore: { persona: '' } },
  })
  assert.equal(res.ok, true)
  const ops = mutates[0].ops
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
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async () => {},
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await hostApply(ctx, {})
  const res = await rpc('/dsh-my-go', 'snapshot', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.parents, {}, '无编排会话时回落空编排状态')
  const lines = res.value.rosterLines
  assert.ok(Array.isArray(lines) && lines.length > 1, 'rosterLines 是非空行数组')
  assert.match(lines[0], /角色名册/, '首行是区标题')
  for (const key of ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']) {
    assert.ok(lines.some((l) => l.startsWith(`- ${key} |`)), `内置键 ${key} 有一行摘要`)
  }
  assert.ok(!lines.some((l) => l.startsWith('- sisyphus')), 'sisyphus 是编排者单例，永不在可派花名册')
  assert.ok(lines.some((l) => l.includes('跟随环境')), '无绑定时标注跟随环境')
})
