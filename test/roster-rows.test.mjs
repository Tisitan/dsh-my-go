// roster-rows 纯函数（设置页自定义角色编辑器的状态迁移）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_KEY_PATTERN,
  isValidRoleKey,
  normalizeRoleRows,
  mergeRoleRowsIntoRoles,
  normalizeRoleToolNames,
  addRoleRow,
  removeRoleRow,
  updateRoleRow,
  addRoleToolEntry,
  removeRoleToolEntry,
  roleSummaryText,
  builtinSummaryText,
  withPersonaOverride,
  personaOverrideSource,
  resolveBuiltinPersonaResult,
  buildRoleCardJson,
  parseRoleCardJson,
} from '../src/roster-rows.js'

const BUILTIN = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

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

test('normalizeRoleToolNames：去重、剔空、剔非字符串', () => {
  assert.deepEqual(normalizeRoleToolNames(['b', 'a', 'b', '', 1, 'a']), ['b', 'a'])
  assert.deepEqual(normalizeRoleToolNames(undefined), [])
})

test('addRoleRow：合法新建空行；非法名/重名 no-op', () => {
  const rows = [{ key: 'a', provider: 'p', model: 'm', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: [], deny: [] }]
  const next = addRoleRow(rows, 'b-x')
  assert.equal(next.length, 2)
  assert.deepEqual(next[1], { key: 'b-x', provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: [], deny: [] })
  assert.equal(addRoleRow(rows, 'Bad_Key'), rows, '非法名原样返回')
  assert.equal(addRoleRow(rows, 'a'), rows, '重名原样返回')
})

test('removeRoleRow：按 key 删除；未知 key 原样', () => {
  const a = { key: 'a' }
  const b = { key: 'b' }
  assert.deepEqual(removeRoleRow([a, b], 'a'), [b])
  assert.deepEqual(removeRoleRow([a, b], 'zz'), [a, b])
})

test('updateRoleRow：provider 变更重置 model；标量/列表替换；非法 field 与未知 key no-op', () => {
  const row = { key: 'a', provider: 'p1', model: 'm1', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: [], deny: [] }
  assert.deepEqual(updateRoleRow([row], 'a', 'provider', 'p2'), [{ ...row, provider: 'p2', model: '' }])
  assert.deepEqual(updateRoleRow([row], 'a', 'model', 'm9'), [{ ...row, model: 'm9' }])
  assert.deepEqual(updateRoleRow([row], 'a', 'reasoningEffort', 'high'), [{ ...row, reasoningEffort: 'high' }])
  assert.deepEqual(updateRoleRow([row], 'a', 'dsv4p0813', true), [{ ...row, dsv4p0813: true }])
  assert.deepEqual(updateRoleRow([row], 'a', 'dsv4p0813', 'yes'), [{ ...row, dsv4p0813: false }], '布尔字段严格 === true')
  const fb = [{ provider: 'p8', model: 'm8' }]
  assert.deepEqual(updateRoleRow([row], 'a', 'fallbacks', fb)[0].fallbacks, fb)
  assert.deepEqual(updateRoleRow([row], 'a', 'allow', ['read'])[0].allow, ['read'])
  assert.deepEqual(updateRoleRow([row], 'a', 'persona', '人设')[0].persona, '人设')
  assert.deepEqual(updateRoleRow([row], 'a', 'nope', 1), [row], '非法 field 原样')
  assert.deepEqual(updateRoleRow([row], 'zz', 'model', 'm'), [row], '未知 key 原样')
  assert.deepEqual(updateRoleRow([row], 'a', 'fallbacks', 'nope')[0].fallbacks, [], '列表字段非数组归空')
})

test('addRoleToolEntry / removeRoleToolEntry：trim、去重、空忽略、越界 no-op', () => {
  const row = { key: 'a', allow: ['read'], deny: [] }
  const rows = [row]
  const afterAdd = addRoleToolEntry(rows, 'a', 'allow', '  mcp__x__t  ')
  assert.deepEqual(afterAdd[0].allow, ['read', 'mcp__x__t'], 'trim 后加入')
  assert.deepEqual(addRoleToolEntry(afterAdd, 'a', 'allow', 'mcp__x__t')[0].allow, ['read', 'mcp__x__t'], '重名 no-op')
  assert.deepEqual(addRoleToolEntry(rows, 'a', 'allow', '   ')[0].allow, ['read'], '纯空白忽略')
  assert.deepEqual(addRoleToolEntry(rows, 'a', 'both', 'x'), rows, '非法 side 原样')
  const withDeny = addRoleToolEntry(rows, 'a', 'deny', 'write')
  const afterRemove = removeRoleToolEntry(withDeny, 'a', 'deny', 0)
  assert.deepEqual(afterRemove[0].deny, [])
  assert.deepEqual(removeRoleToolEntry(withDeny, 'a', 'deny', 5)[0].deny, ['write'], '越界原样')
  assert.deepEqual(removeRoleToolEntry(withDeny, 'a', 'allow2', 0), withDeny, '非法 side 原样')
})

test('roleSummaryText：模型四形态、备选链数、toolFilter 三态、persona 首行截断', () => {
  const base = { key: 'a', provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: [], deny: [] }
  assert.equal(roleSummaryText(base), '跟随环境 | 备选0 | 全量（除全局掩码）')
  assert.equal(roleSummaryText({ ...base, provider: 'p9' }), 'p9·跟随环境 | 备选0 | 全量（除全局掩码）')
  assert.equal(roleSummaryText({ ...base, model: 'm9' }), '?·m9 | 备选0 | 全量（除全局掩码）')
  assert.equal(roleSummaryText({ ...base, provider: 'p9', model: 'm9', fallbacks: [{}, {}] }), 'p9·m9 | 备选2 | 全量（除全局掩码）')
  assert.equal(roleSummaryText({ ...base, allow: ['read', 'glob'] }), '跟随环境 | 备选0 | 仅 read, glob')
  assert.equal(roleSummaryText({ ...base, deny: ['write'] }), '跟随环境 | 备选0 | 除 write')
  assert.equal(roleSummaryText({ ...base, allow: ['read'], deny: ['write'] }), '跟随环境 | 备选0 | 仅 read；除 write', 'allow/deny 同时展示')
  const personaLine = 'x'.repeat(100)
  const summary = roleSummaryText({ ...base, persona: `首行人设\n第二行\n${personaLine}` })
  assert.ok(summary.includes('首行人设'), 'persona 首行进摘要')
  assert.ok(!summary.includes('第二行'), '只取首行')
})

test('builtinSummaryText：渠道·模型四形态、档位与备选数、脏数据防御', () => {
  assert.equal(builtinSummaryText({}), '跟随 Sisyphus | 跟随模型默认 | 备选 0 条')
  assert.equal(builtinSummaryText(undefined), '跟随 Sisyphus | 跟随模型默认 | 备选 0 条')
  assert.equal(builtinSummaryText({ provider: 'p9' }), 'p9·跟随 Sisyphus | 跟随模型默认 | 备选 0 条')
  assert.equal(builtinSummaryText({ model: 'm9' }), '跟随 Sisyphus·m9 | 跟随模型默认 | 备选 0 条')
  assert.equal(builtinSummaryText({ provider: 'p9', model: 'm9', reasoningEffort: 'high', fallbacks: [{}, {}] }), 'p9·m9 | high | 备选 2 条')
  assert.equal(builtinSummaryText({ reasoningEffort: 'max' }), '跟随 Sisyphus | max | 备选 0 条')
  assert.equal(builtinSummaryText({ provider: 42, model: 'm9', fallbacks: 'nope' }), '跟随 Sisyphus·m9 | 跟随模型默认 | 备选 0 条', '非字符串 provider/非数组 fallbacks 归默认')
})

test('纯函数纪律：所有操作不变异输入数组与行对象', () => {
  const row = { key: 'a', provider: 'p1', model: 'm1', reasoningEffort: '', dsv4p0813: false, fallbacks: [], persona: '', allow: ['read'], deny: [] }
  const rows = [row]
  const snapshot = JSON.stringify(rows)
  addRoleRow(rows, 'b')
  removeRoleRow(rows, 'a')
  updateRoleRow(rows, 'a', 'model', 'zz')
  addRoleToolEntry(rows, 'a', 'allow', 'new')
  removeRoleToolEntry(rows, 'a', 'allow', 0)
  withPersonaOverride(row, 'x')
  parseRoleCardJson('{}', [])
  assert.equal(JSON.stringify(rows), snapshot, '输入深度未被触碰')
})

// ── 人设覆盖 + 角色卡导入导出（tisitan.15 前端功能批） ─────────────────

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

test('buildRoleCardJson：rows 视图形状序列化为嵌套 toolFilter 的全字段卡片', () => {
  const row = { key: 'coder-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true, fallbacks: [{ provider: 'p8', model: 'm8' }], persona: 'X 人设', allow: ['read'], deny: ['write'] }
  const card = JSON.parse(buildRoleCardJson(row))
  assert.deepEqual(card, {
    key: 'coder-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }], persona: 'X 人设',
    toolFilter: { allow: ['read'], deny: ['write'] },
  })
  assert.deepEqual(JSON.parse(buildRoleCardJson(null)), {})
})

test('parseRoleCardJson：合法卡入册；脏 JSON/非法键/重名/非对象全拒；白名单剥离与类型粗检', () => {
  const good = JSON.stringify({
    key: 'coder-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }, { provider: 42 }, 'junk', null],
    persona: 'X 人设', toolFilter: { allow: ['read', 'read', '', 42], deny: ['write'] }, hackerField: 'strip-me',
  })
  const parsed = parseRoleCardJson(good, ['hermes'])
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.row, {
    key: 'coder-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }], persona: 'X 人设', allow: ['read'], deny: ['write'],
  }, '脏备选条目/非字符串工具名/重复名被清，多余字段剥离')
  for (const [text, reason] of [
    ['not-json', '脏 JSON'],
    ['[1,2]', '顶层数组'],
    ['null', '顶层 null'],
    [JSON.stringify({ key: 'Bad_Key' }), '非法键'],
    [JSON.stringify({ key: 'r2d2' }), '键含数字'],
    [JSON.stringify({}), '缺 key'],
    [JSON.stringify({ key: 'hermes' }), '与内置工种重名'],
    [JSON.stringify({ key: 'custom-x' }), '与已有自定义角色重名'],
  ]) {
    const r = parseRoleCardJson(text, ['hermes', 'custom-x'])
    assert.equal(r.ok, false, `${reason} 必须拒绝`)
    assert.equal(typeof r.error, 'string')
  }
  assert.match(parseRoleCardJson('not-json', []).error, /JSON/)
  assert.match(parseRoleCardJson(JSON.stringify({ key: 'hermes' }), ['hermes']).error, /已存在/)
})

test('resolveBuiltinPersonaResult：getBuiltinPersona RPC 结果归一（tisitan.16b）', () => {
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

test('mergeRoleRowsIntoRoles：内置透传 + 脏行原样保留 + 投影行重建 + 删除语义成立（tisitan.20 Z2\'）', () => {
  const old = {
    hermes: { provider: 'p-h', persona: '内置部分行' },
    'custom-x': { provider: 'old-p', model: 'old-m' },
    bad_key: { provider: 'p1' },
    broken: 'not-an-object',
  }
  const nextRows = [{
    key: 'custom-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [], persona: 'X 的人设', allow: ['read'], deny: [],
  }]
  const merged = mergeRoleRowsIntoRoles(old, nextRows, BUILTIN)
  assert.deepEqual(merged.hermes, old.hermes, '内置键部分行透传')
  assert.equal(merged.bad_key, old.bad_key, '非法键脏行原样保留，不被无关保存静默整键删除')
  assert.equal(merged.broken, old.broken, '非对象脏值同样透传')
  assert.deepEqual(merged['custom-x'], {
    provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [], persona: 'X 的人设', toolFilter: { allow: ['read'], deny: [] },
  }, '编辑期行重建为存储形状（toolFilter 回填嵌套）')
  // 删除语义：合法键从 rows 消失即随 dict 重建剔除（保存时整键 unset）——
  // 脏行保留仅限「投影会拒绝」的条目，不得吞掉用户的删除操作
  const removed = mergeRoleRowsIntoRoles(old, [], BUILTIN)
  assert.equal('custom-x' in removed, false, '用户删除的合法自定义键必须消失')
  assert.equal(removed.bad_key, old.bad_key, '脏行不受删除影响')
  assert.equal(removed.broken, 'not-an-object')
  assert.deepEqual(removed.hermes, old.hermes)
  // 防御：旧 roles 非对象 / rows 为空数组 → 只含重建结果
  assert.deepEqual(mergeRoleRowsIntoRoles(null, nextRows, BUILTIN)['custom-x'], merged['custom-x'])
  assert.deepEqual(mergeRoleRowsIntoRoles(undefined, [], BUILTIN), {})
  // 纯函数：入参不被突变
  const before = JSON.stringify(old)
  mergeRoleRowsIntoRoles(old, nextRows, BUILTIN)
  assert.equal(JSON.stringify(old), before)
})
