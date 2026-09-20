// roster-rows 纯函数（设置页角色的存储投影层）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
// 0.5.0-tisitan.3 批次 3：行级编辑迁移（增删改行 / tool 条目 / 卡摘要 / 卡
// JSON 导入导出）已随 0.5.0 设置页重写成为孤儿导出并删除；批次 4+6：
// normalizeRoleToolNames 同判孤儿（零生产引用）随之清理——本文件只守
// 存储投影活面（normalize / persona 覆盖 / RPC 结果归一），行编辑行为由
// test/settings-core-projections.test.mjs 与 client-card 行为档持有。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_KEY_PATTERN,
  isValidRoleKey,
  normalizeRoleRows,
  withPersonaOverride,
  personaOverrideSource,
  resolveBuiltinPersonaResult,
} from '../src/roster-rows.js'
import { ROLE_KEY_PATTERN as SHARED_PATTERN } from '../preset/shared/constants.mjs'

const BUILTIN = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

test('ROLE_KEY_PATTERN 与 preset/shared 单源一致（re-export 同一对象）', () => {
  assert.equal(ROLE_KEY_PATTERN, SHARED_PATTERN, '客户端不再抄第二份 pattern（双处定义是历史教训）')
})

test('isValidRoleKey：^[a-z][a-z-]*$ 客户端即时校验，与服务端 schema 同则', () => {
  assert.ok(isValidRoleKey('a'))
  assert.ok(isValidRoleKey('custom-x'))
  assert.ok(isValidRoleKey('vision-two-step'))
  for (const bad of ['', 'Hermes', 'r2d2', 'a_b', '中文', '-lead', null, undefined, 42]) {
    assert.equal(isValidRoleKey(bad), false, `非法名 ${String(bad)} 必须被拒`)
  }
  assert.deepEqual(
    ['ab', 'Ab', 'a-b', 'a_b', 'a2', '2a', ''].map((k) => ROLE_KEY_PATTERN.test(k)),
    [true, false, true, false, false, false, false],
  )
})

test('normalizeRoleRows：脏数据归一 + 内置键剔除 + toolFilter 摊平', () => {
  assert.deepEqual(normalizeRoleRows(undefined, BUILTIN), [])
  assert.deepEqual(normalizeRoleRows([], BUILTIN), [])
  assert.deepEqual(normalizeRoleRows('nope', BUILTIN), [])
  const rows = normalizeRoleRows({
    hermes: { provider: 'keep-out' },
    'custom-x': {
      provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
      fallbacks: [{ provider: 'p8', model: 'm8' }],
      persona: 'X 的人设',
      toolFilter: { allow: ['read', 'read', '', 42], deny: ['write'] },
    },
    bad_key: { provider: 'p1' },
    broken: 'not-an-object',
  }, BUILTIN)
  assert.deepEqual(rows, [{
    key: 'custom-x',
    provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }],
    persona: 'X 的人设',
    allow: ['read'], deny: ['write'],
  }], '内置键/非法键名/非对象值被剔除，allow 去重防脏')
})

test('纯函数纪律：投影与覆盖不变异输入', () => {
  const dict = {
    'custom-x': { provider: 'p1', model: 'm1', toolFilter: { allow: ['read'], deny: [] } },
    bad_key: { provider: 'p1' },
  }
  const stored = { provider: 'p9', model: 'm9', fallbacks: [{ provider: 'p8', model: 'm8' }] }
  const snapshot = JSON.stringify({ dict, stored })
  normalizeRoleRows(dict, BUILTIN)
  withPersonaOverride(stored, 'x')
  personaOverrideSource(stored)
  resolveBuiltinPersonaResult({ ok: true, value: { persona: 'x' } })
  assert.equal(JSON.stringify({ dict, stored }), snapshot, '输入深度未被触碰')
})

// ── 人设覆盖 + getBuiltinPersona 归一（0.2.3-tisitan.15/16b 起的活面） ────────

test('withPersonaOverride：部分行只带 persona 字段并透传既有字段；空文本 = 清除覆盖', () => {
  const stored = { provider: 'p9', model: 'm9', fallbacks: [{ provider: 'p8', model: 'm8' }] }
  const partial = withPersonaOverride(stored, '覆盖人设')
  assert.deepEqual(Object.keys(partial).sort(), ['fallbacks', 'model', 'persona', 'provider'], '既有字段透传，只新增 persona')
  assert.equal(partial.persona, '覆盖人设')
  assert.deepEqual(withPersonaOverride(stored, ''), { ...stored, persona: '' }, '空文本 = 显式清除（host 保存为 unset，恢复文件默认）')
  assert.deepEqual(withPersonaOverride(undefined, 'x'), { persona: 'x' }, '无存量行时纯净部分行')
  assert.deepEqual(withPersonaOverride('dirty', 'x'), { persona: 'x' }, '脏存量归空基线')
})

test('personaOverrideSource：状态行文案两态', () => {
  assert.equal(personaOverrideSource({ persona: '已覆盖' }), '已覆盖（保存后替换文件默认）')
  assert.equal(personaOverrideSource({ persona: '' }), '文件默认')
  assert.equal(personaOverrideSource({}), '文件默认')
  assert.equal(personaOverrideSource(undefined), '文件默认')
  assert.equal(personaOverrideSource({ persona: 42 }), '文件默认', '非字符串视为未覆盖')
})

test('resolveBuiltinPersonaResult：getBuiltinPersona RPC 结果归一（0.2.3-tisitan.16b）', () => {
  assert.deepEqual(
    resolveBuiltinPersonaResult({ ok: true, value: { type: 'hermes', persona: '原文' } }),
    { ok: true, persona: '原文' },
    '成功 → 填 textarea 草稿',
  )
  assert.deepEqual(
    resolveBuiltinPersonaResult({ ok: false, error: { code: 'not-found', message: 'prompts/x.md 不存在' } }),
    { ok: false, message: 'prompts/x.md 不存在' },
    '结构化失败透出 host 消息',
  )
  assert.deepEqual(
    resolveBuiltinPersonaResult({ ok: true, value: {} }),
    { ok: false, message: '人设文件读取失败' },
    'ok 但 persona 非字符串按失败处理',
  )
  assert.deepEqual(
    resolveBuiltinPersonaResult({ ok: false }),
    { ok: false, message: '人设文件读取失败' },
    'error.message 缺失兜底文案',
  )
  assert.deepEqual(
    resolveBuiltinPersonaResult(undefined),
    { ok: false, message: '人设文件读取失败' },
    '传输层异常（catch 传入 undefined）兜底文案',
  )
})
