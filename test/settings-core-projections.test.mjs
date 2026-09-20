/**
 * settings-core 纯投影/校验层直测（0.5.0-tisitan.3 批次 6A）。
 *
 * 0.5.0 设置页重写后，配置卡的行级编辑状态迁移内联进了 settings-core.js；
 * 这批函数此前是模块私有、零直接单测——真正在生产跑的 parseRoleText（宽松
 * 语义：空 key 放行、字段收窄、列表元素不强洗）与已退役的 parseRoleCardJson
 * （严格轨）是分叉的两轨。批次 3 删除孤儿轨后，这里给活轨补上纯函数直测。
 * 风格同 settings-ops.test.mjs：不起浏览器、不 mock 宿主，deepEqual 具体
 * 形状，脏输入分支逐条钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  statusText,
  roleEntry,
  chainText,
  roleDetailText,
  priceMetaText,
  priceDetailText,
  priceSuggestions,
  isValidRoleKey,
  isValidPriceKey,
  parseRoleText,
  blankRole,
  blankPriceRow,
  emptyDraft,
} from '../src/settings-core.js'
import { effortLabel } from '../src/roles-editor.js'
import { AGENT_TYPES } from '../src/client-constants.js'

// ── 种子形状：新建行 / 新草稿 ───────────────────────────────────────────────

test('emptyDraft/blankRole/blankPriceRow：种子形状逐字钉住', () => {
  assert.deepEqual(blankRole(), {
    provider: '', model: '', reasoningEffort: '', dsv4p0813: false,
    fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] },
  }, '新建自定义角色的整行种子（含嵌套 toolFilter）')
  assert.deepEqual(blankPriceRow(), { input: '', output: '', cacheRead: '', cacheWrite: '' }, '新建计价行的四桶空串种子')
  const draft = emptyDraft()
  assert.equal(draft.usageCurrency, 'USD', '币种缺省 USD')
  assert.deepEqual(draft.roles, {})
  assert.deepEqual(draft.usagePrices, {})
  assert.deepEqual(Object.keys(draft).filter((k) => AGENT_TYPES.includes(k)), AGENT_TYPES, '九个内置工种顶级空行齐备、顺序同名单')
  assert.deepEqual(draft.hermes, { provider: '', model: '', reasoningEffort: '', dsv4p0813: false, fallbacks: [] })
})

// ── parseRoleText：生产在跑的宽松导入轨 ────────────────────────────────────

test('parseRoleText：合法卡白名单收窄入册（key 在顶层、行本体不带 key）', () => {
  const parsed = parseRoleText(JSON.stringify({
    key: 'coder-x', provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }],
    persona: 'X 人设', toolFilter: { allow: ['read', 'read', '', 42], deny: ['write'] }, hackerField: 'strip-me',
  }))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.key, 'coder-x', 'key 提到顶层供 importRole 二段校验')
  assert.deepEqual(parsed.row, {
    provider: 'p9', model: 'm9', reasoningEffort: 'high', dsv4p0813: true,
    fallbacks: [{ provider: 'p8', model: 'm8' }], persona: 'X 人设',
    toolFilter: { allow: ['read', 'read', '42'], deny: ['write'] },
  }, '宽松语义实锤：多余字段剥离，但 allow 只 map(String)+剔空串——重复条目保留、非串强转，不去重')
})

test('parseRoleText：脏输入分支——空输入/脏 JSON/非对象/多角色块全拒', () => {
  assert.deepEqual(parseRoleText(null), { ok: false, error: '没有输入内容' })
  assert.deepEqual(parseRoleText('   '), { ok: false, error: '没有输入内容' }, '纯空白 = 没有输入')
  assert.deepEqual(parseRoleText(undefined), { ok: false, error: '不是合法 JSON' }, 'undefined 经 String() 变 "undefined" 字样，落到脏 JSON 分支（现状行为）')
  assert.deepEqual(parseRoleText('not-json'), { ok: false, error: '不是合法 JSON' })
  assert.deepEqual(parseRoleText('[{"key":"a"},{"key":"b"}]'), { ok: false, error: 'JSON 必须是一个角色对象' }, '多角色块（数组顶层）拒绝：一次只导一个角色')
  assert.deepEqual(parseRoleText('null'), { ok: false, error: 'JSON 必须是一个角色对象' })
  assert.deepEqual(parseRoleText('"str"'), { ok: false, error: 'JSON 必须是一个角色对象' })
  assert.deepEqual(parseRoleText('42'), { ok: false, error: 'JSON 必须是一个角色对象' })
})

test('parseRoleText：宽松边界——空 key 放行、标量收窄、fallbacks 元素原样透传', () => {
  // 空 key 放行：parseRoleText 只解析不判键——键合法性由调用方 isValidRoleKey
  // 二段把关（importRole 先 parse 后校验）。这是与已退役严格轨的关键分叉。
  const emptyKey = parseRoleText(JSON.stringify({ provider: 'p' }))
  assert.equal(emptyKey.ok, true)
  assert.equal(emptyKey.key, '')
  assert.deepEqual(emptyKey.row, {
    provider: 'p', model: '', reasoningEffort: '', dsv4p0813: false,
    fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] },
  })
  const coerced = parseRoleText(JSON.stringify({
    key: 'k', provider: 42, model: null, reasoningEffort: {}, dsv4p0813: 'yes',
    fallbacks: 'nope', persona: 7, toolFilter: null,
  }))
  assert.deepEqual(coerced.row, {
    provider: '', model: '', reasoningEffort: '', dsv4p0813: false,
    fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] },
  }, '非字符串标量归空、布尔严格 === true、非数组列表与 toolFilter 归空')
  const keptChain = parseRoleText(JSON.stringify({ key: 'k', fallbacks: [{ provider: 'p8' }, 'junk', null] }))
  assert.deepEqual(keptChain.row.fallbacks, [{ provider: 'p8' }, 'junk', null], 'fallbacks 元素宽松透传（脏条目写回时由 decomposeChain 归一，导入时不洗）')
  const stringified = parseRoleText(JSON.stringify({ key: 'k', toolFilter: { allow: [null, 'ok'], deny: [7, ''] } }))
  assert.deepEqual(stringified.row.toolFilter, { allow: ['null', 'ok'], deny: ['7'] }, 'tool 条目 String() 强转后剔空串')
})

// ── 键校验：与 shared 同则的新语义 ─────────────────────────────────────────

test('isValidPriceKey：shared 新语义（model 段可含 /）、重名与脏输入拒绝', () => {
  assert.equal(isValidPriceKey('deepseek/deepseek-chat', { usagePrices: {} }), true)
  assert.equal(isValidPriceKey('openrouter/deepseek/deepseek-chat', { usagePrices: {} }), true, 'OpenRouter 式多级 model 段合法（批次 2 起的 shared 语义）')
  assert.equal(isValidPriceKey('a/b', { usagePrices: { 'a/b': {} } }), false, '重名拒绝')
  assert.equal(isValidPriceKey('a/b', {}), true, '无单价表 = 无重名（新建首行不炸）')
  for (const bad of ['noslash', '/lead', 'trail/', '', '   ', null, undefined, 42]) {
    assert.equal(isValidPriceKey(bad, { usagePrices: {} }), false, `脏键 ${String(bad)} 拒绝`)
  }
})

test('isValidRoleKey：pattern 内 + 排除内置名 + 排除 customRows 重名', () => {
  assert.equal(isValidRoleKey('custom-x', []), true)
  assert.equal(isValidRoleKey('hermes', []), false, '内置工种名拒绝')
  assert.equal(isValidRoleKey('sisyphus', []), false, 'sisyphus 同在排除面')
  assert.equal(isValidRoleKey('taken', [{ key: 'taken' }]), false, '与既有自定义角色重名拒绝')
  assert.equal(isValidRoleKey('taken', [{ key: 'other' }]), true)
  for (const bad of ['', 'Bad_Key', 'r2d2', '-lead', 'a b', null, undefined, 42]) {
    assert.equal(isValidRoleKey(bad, []), false, `非法名 ${String(bad)} 拒绝`)
  }
})

// ── 文案投影：状态行 / 名册行 / 详情区 ─────────────────────────────────────

test('statusText：未就绪/无改动/待保存三态 + revision 尾注', () => {
  assert.equal(statusText({ ready: false, dirty: false, pending: [], revision: undefined }), '配置未就绪')
  assert.equal(statusText({ ready: false, dirty: false, pending: [], revision: 3 }), '配置未就绪 · r3')
  assert.equal(statusText({ ready: true, dirty: false, pending: [], revision: 7 }), '无改动 · r7')
  assert.equal(statusText({ ready: true, dirty: true, pending: ['币种', '角色名册'], revision: 7 }), '待保存：币种 · 角色名册 · r7')
  assert.equal(statusText({ ready: true, dirty: true, pending: [], revision: undefined }), '待保存：草稿与现值同形')
})

test('chainText：主选形态与链长尾注（脏行降级为全跟随）', () => {
  assert.equal(chainText({}), '跟随 Sisyphus')
  assert.equal(chainText(undefined), '跟随 Sisyphus', '脏行降级为全跟随不炸')
  assert.equal(chainText({ provider: 'p', model: 'm' }), 'p/m')
  assert.equal(chainText({ provider: 'p', model: '' }), 'p/', '半配主选照实拼（宽松显示，不藏一半配置）')
  assert.equal(chainText({ provider: 'p', model: 'm', fallbacks: [{ provider: 'p2', model: 'm2' }] }), 'p/m →1')
  assert.equal(chainText({ provider: 'p', model: 'm', fallbacks: [{ provider: 'p2', model: 'm2' }, 'junk'] }), 'p/m →1', '链长按 composeChain 归一后计数（非对象条目被剔）')
})

test('roleEntry：badges 三源组合，meta 委托 chainText', () => {
  assert.deepEqual(
    roleEntry('hermes', '快速执行 Hermes', { provider: 'p', model: 'm' }, undefined, true),
    { key: 'hermes', label: '快速执行 Hermes', meta: 'p/m', badges: [], builtin: true },
  )
  assert.deepEqual(
    roleEntry('custom', 'custom', { provider: 'p', model: 'm', dsv4p0813: true }, { persona: '覆盖' }, false).badges,
    [{ text: '覆盖', tone: 'warn' }, { text: 'DSV', tone: 'on' }, { text: '自定义' }],
  )
  assert.deepEqual(roleEntry('k', 'K', {}, {}, false).badges, [{ text: '自定义' }])
  assert.deepEqual(roleEntry('k', 'K', {}, {}, true).badges, [], '内置无 persona 覆盖时零徽章')
})

test('roleDetailText：内置/自定义/sisyphus 特例/未选中四种面', () => {
  assert.equal(roleDetailText(null, {}), '左列选一个角色来编辑。')
  assert.equal(roleDetailText('', {}), '左列选一个角色来编辑。')
  const current = {
    hermes: { provider: 'p1', model: 'm1', fallbacks: [{ provider: 'p2', model: 'm2' }], reasoningEffort: 'high', dsv4p0813: true },
    roles: {
      hermes: { persona: '覆盖人设' },
      'custom-x': { provider: 'p9', model: 'm9', toolFilter: { allow: ['read'], deny: ['write'] }, persona: 'X' },
    },
  }
  const hermesDetail = roleDetailText('hermes', current)
  assert.match(hermesDetail, /^快速执行 Hermes（hermes）· 内置工种$/m)
  assert.match(hermesDetail, /^模型优先级：#1 p1\/m1  #2 p2\/m2$/m)
  assert.match(hermesDetail, /^思考档位：high；DSV4P0813：开$/m)
  assert.match(hermesDetail, /^人设来源：已覆盖（保存后替换文件默认）$/m, '内置工种的人设覆盖来源读 roles 行')
  assert.equal(/工具面/.test(hermesDetail), false, '内置行无工具面行')
  const customDetail = roleDetailText('custom-x', current)
  assert.match(customDetail, /^custom-x（custom-x）· 自定义角色$/m)
  assert.match(customDetail, /^工具面：白名单 1 条（read）；黑名单 1 条（write）$/m)
  assert.match(customDetail, /^派发时 go_work 用键名点名该角色；删除后下次保存整键从 roles 字典移除。$/m)
  const sisyphusDetail = roleDetailText('sisyphus', { sisyphus: {} })
  assert.equal(/人设来源/.test(sisyphusDetail), false, 'sisyphus 不提供人设覆盖行（编排纪律人设不开放面板覆盖）')
})

test('priceMetaText：入/出两桶缩略，空桶占位 —', () => {
  assert.equal(priceMetaText(undefined), '')
  assert.equal(priceMetaText(null), '')
  assert.equal(priceMetaText({ input: 1, output: 2 }), '入 1 / 出 2')
  assert.equal(priceMetaText({ input: '', output: 2 }), '入 — / 出 2')
  assert.equal(priceMetaText({ input: '1.5', output: 0 }), '入 1.5 / 出 0', '数字串与 0 价照实显示')
})

test('priceDetailText：无键提示 / 新键未存 / 已有宿主现值三面', () => {
  assert.equal(
    priceDetailText(null, {}, { value: {} }),
    '还没有任何计价行：用量面板只报 token 数，不折算成本。',
  )
  const current = { usagePrices: { 'a/b': { input: 1, output: 2, cacheRead: 0.4 } }, usageCurrency: 'CNY' }
  const detail = priceDetailText('a/b', current, { value: { usagePrices: { 'a/b': { input: 1, output: 2 } } } })
  assert.match(detail, /^a\/b · 人民币 \/ 1M tokens$/m, 'CNY 映射人民币')
  assert.match(detail, /^输入：1  输出：2  缓存读取：0.4  缓存写入：未定价$/m, '四桶口径，未定价占位')
  assert.match(detail, /^宿主现值：入 1 \/ 出 2，缓存读 未定价 \/ 写 未定价。$/m, '宿主现值逐桶带出')
  assert.match(detail, /不完整的行保存时整行跳过（fail-closed）/)
  const fresh = priceDetailText('c/d', { usagePrices: { 'c/d': {} }, usageCurrency: 'USD' }, { value: {} })
  assert.match(fresh, /^c\/d · 美元 \/ 1M tokens$/m, '缺省币种渲染美元')
  assert.match(fresh, /^该键在宿主现值里还不存在：保存后新增。$/m)
})

test('priceSuggestions：provider/model 组装去重保序，models 形状畸形容错', () => {
  assert.deepEqual(priceSuggestions({ models: { a: ['m1', 'm2'], b: ['m3'] } }), ['a/m1', 'a/m2', 'b/m3'])
  assert.deepEqual(priceSuggestions({ models: { a: ['m1'], b: ['m1'] } }), ['a/m1', 'b/m1'], '跨渠道同名不误剔（键含 provider）')
  assert.deepEqual(priceSuggestions({ models: { a: ['m1', 'm1'], b: 'x' } }), ['a/m1'], '渠道内重复去重、非数组渠道跳过')
  assert.deepEqual(priceSuggestions({ models: { a: [null, '', 'ok'] } }), ['a/null', 'a/', 'a/ok'], '宽松投影：模型项不做非串过滤，原样拼进键（datalist 提示项的容差与 parseRoleText 同风格）')
  assert.deepEqual(priceSuggestions({}), [], 'models 缺席 → 空选项（组合框保持手填）')
})

// ── roles-editor 的同款纯投影 ──────────────────────────────────────────────

test('effortLabel：空档位/三档映射/枚举外透传', () => {
  assert.equal(effortLabel(''), '跟随模型默认（不单独指定）')
  assert.equal(effortLabel('low'), '低（low）')
  assert.equal(effortLabel('high'), '高（high）')
  assert.equal(effortLabel('max'), '最高（max）')
  assert.equal(effortLabel('medium'), 'medium', '枚举外原样透传（不炸、不吞）')
})
