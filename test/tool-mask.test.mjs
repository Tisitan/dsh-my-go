// tool-mask 屏蔽清单解析（0.2.3-tisitan.13，并集语义自防旁路加固批）用例：三源
// 并集（config.deny ∪ settings toolMask.deny ∪ DEFAULT_DENY，去重保序）+
// DEFAULT_DENY 泛化清空回归 + agent.cordis.yml 安全条目 pin。
// 模块零依赖，node --test 直接 import（resolveDeny 为纯函数）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'
import { apply, resolveDeny } from '../preset/tool-mask.mjs'

// 宿主 dsh-tools 未注册具的真实报错形状（tools.restrict() 抛出的原文），
// 分类器就按这段文案判「未注册」，改口径必须同步这里。
const unknownTool = (name) => new Error(
  `tools.restrict() names unknown global tool "${name}"; known global tools: "read", "write"`,
)

test('resolveDeny：config.deny 与 settings 是并集，互不覆盖（防旁路加固批）', () => {
  assert.deepEqual(
    resolveDeny({ deny: ['mcp__a__x'] }, { toolMask: { deny: ['mcp__b__y'] } }),
    ['mcp__a__x', 'mcp__b__y'],
    '行级条目不得吃掉用户设置页清单（旧覆盖语义会让 config.deny 一填就把用户的屏蔽全清掉）',
  )
  assert.deepEqual(
    resolveDeny({ deny: [] }, { toolMask: { deny: ['mcp__b__y'] } }),
    ['mcp__b__y'],
    'config.deny: [] 只是不贡献条目，设置页清单照常生效（不再是「显式屏蔽空」）',
  )
  assert.deepEqual(
    resolveDeny({ deny: ['a', 'b', 'a'] }, { toolMask: { deny: ['b', 'c'] } }),
    ['a', 'b', 'c'],
    '去重且按贡献顺序（config 先、settings 后）稳定输出',
  )
  assert.deepEqual(resolveDeny({ deny: [1, 'x'] }), ['1', 'x'], '条目统一转 string')
})

test('resolveDeny：settings toolMask.deny 非数组视为缺省；两源皆缺省 → 空', () => {
  assert.deepEqual(resolveDeny({}, { toolMask: { deny: ['mcp__b__y', 'tool_z'] } }), ['mcp__b__y', 'tool_z'])
  assert.deepEqual(resolveDeny({}, { toolMask: { deny: 'mcp__b__y' } }), [], '非数组 deny 视为缺省')
  assert.deepEqual(resolveDeny({}, { toolMask: null }), [], 'toolMask 非对象视为缺省')
  assert.deepEqual(resolveDeny({}, 'garbage'), [], 'stored 非对象视为缺省')
  assert.deepEqual(resolveDeny({ deny: 'garbage' }, { toolMask: { deny: ['keep'] } }), ['keep'], 'config 非数组不贡献条目')
  assert.deepEqual(resolveDeny({}), [], '两源皆缺省 → 空默认')
})

test('resolveDeny：DEFAULT_DENY 已泛化清空——源码不再含任何私有工具名', async () => {
  const src = await readFile(new URL('../preset/tool-mask.mjs', import.meta.url), 'utf-8')
  assert.match(src, /const DEFAULT_DENY = \[\];/, 'DEFAULT_DENY 必须是空数组')
  assert.doesNotMatch(src, /_for_rei|opencode|rei_memo/, '私有部署工具名一个不留')
})

// agent.cordis.yml 用了宿主自定义的 `!!js` 标签（disabled: !!js process.platform…），
// js-yaml 默认 schema 不认它。本用例只读 tool-mask 行的 deny 清单，不需要求值那
// 段表达式，故补一枚 scalar passthrough 类型（原样返回文本）即可真解析。
const cordisSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
])

test('pin：agent.cordis.yml 的 config.deny 必须含上游邻接消息三件套（防回潮）', async () => {
  // C-10 P9：原先是「从 '- id: tool-mask' 起截取文本 + 正则扫行」——那等于用
  // 眼睛读 yml，缩进一变、条目换成 flow 风格 `[a, b]` 就静默假绿。改真解析。
  const text = await readFile(new URL('../preset/agent.cordis.yml', import.meta.url), 'utf-8')
  const doc = yaml.load(text, { schema: cordisSchema })
  assert.ok(Array.isArray(doc), 'agent.cordis.yml 是组合列表')
  const maskRow = doc.find((row) => row?.id === 'tool-mask')
  assert.ok(maskRow, 'tool-mask 行在册')
  const deny = maskRow?.config?.deny
  assert.ok(Array.isArray(deny), 'tool-mask 行 config.deny 是数组')
  for (const name of ['send_message', 'list_agents', 'interrupt_agent']) {
    assert.ok(deny.includes(name), `tool-mask 行 config.deny 缺少 ${name}`)
  }
  // 原第二条 pin（yml 里不得出现「explicit override, highest」字样）已按 C-10 口径
  // 退役：那是注释措辞而非行为，改文案不该红；并集语义本身由上方 resolveDeny
  // 那两组用例逐条钉着。
})

test('apply：逐名 try/catch restrict + 缺席工具跳过不炸挂载 + 汇总日志', () => {
  const restricted = []
  const warned = []
  const logs = []
  const settingsService = { get: () => ({ toolMask: { deny: ['good_tool', 'ghost_tool'] } }) }
  const origWarn = console.warn
  const origLog = console.log
  console.warn = (...a) => warned.push(a.join(' '))
  console.log = (...a) => logs.push(a.join(' '))
  try {
    apply({
      tools: { restrict: ({ deny }) => { if (deny[0] === 'ghost_tool') throw unknownTool('ghost_tool'); restricted.push(deny[0]) } },
      get: (name) => (name === 'settings' ? settingsService : undefined),
    }, {})
  } finally {
    console.warn = origWarn
    console.log = origLog
  }
  assert.deepEqual(restricted, ['good_tool'], '缺席工具 restrict 抛错被跳过，其余照常应用')
  assert.equal(warned.length, 0, 'unknown 名（预期形态）不再逐名刷屏，随汇总行一并报告')
  assert.ok(logs.some((l) => l.includes('masked 1 tool(s)') && l.includes('source: settings')),
    '汇总数字 = 实际 restrict 成功的个数，不再报解析名单大小')
  assert.ok(logs.some((l) => l.includes('1 name(s) not registered at this scope')
    && l.includes('agent-scope gate covers them: ghost_tool')), '汇总行附跳过清单')
})

test('apply：非 unknown 的 restrict 真异常仍逐名 warn（且不进跳过清单）', () => {
  const restricted = []
  const warned = []
  const logs = []
  const origWarn = console.warn
  const origLog = console.log
  console.warn = (...a) => warned.push(a.join(' '))
  console.log = (...a) => logs.push(a.join(' '))
  try {
    apply({
      tools: {
        restrict: ({ deny }) => {
          if (deny[0] === 'bad_tool') throw new Error('tools.restrict() cannot name reserved PTC mode presentation transport "run_code"')
          restricted.push(deny[0])
        },
      },
      get: () => undefined,
    }, { deny: ['good_tool', 'bad_tool'] })
  } finally {
    console.warn = origWarn
    console.log = origLog
  }
  assert.deepEqual(restricted, ['good_tool'], '真异常同样不炸挂载，其余照常应用')
  assert.equal(warned.length, 1, '真异常保留逐名 warn 留痕')
  assert.ok(warned[0].includes('bad_tool'))
  assert.ok(logs.some((l) => l.includes('masked 1 tool(s)') && !l.includes('not registered at this scope')),
    '真异常既不算屏蔽，也不冒充「未注册」跳过清单')
})

test('apply：三件套在 web 部署下全未注册 → masked 0 + 跳过清单点名（不刷屏）', () => {
  const warned = []
  const logs = []
  const origWarn = console.warn
  const origLog = console.log
  console.warn = (...a) => warned.push(a.join(' '))
  console.log = (...a) => logs.push(a.join(' '))
  try {
    apply({
      tools: { restrict: ({ deny }) => { throw unknownTool(deny[0]) } },
      get: () => ({ get: () => ({ toolMask: { deny: ['mcp__user__x'] } }) }),
    }, { deny: ['send_message', 'list_agents', 'interrupt_agent'] })
  } finally {
    console.warn = origWarn
    console.log = origLog
  }
  assert.equal(warned.length, 0, '启动日志零 warn（本批要消的就是这三条噪音）')
  assert.ok(logs.some((l) => l.includes('masked 0 tool(s) this session')
    && l.includes('4 name(s) not registered at this scope; agent-scope gate covers them: send_message, list_agents, interrupt_agent, mcp__user__x')
    && l.includes('source: config.deny+settings')), '汇总行一次点齐全部跳过名')
})

test('apply：config.deny 与设置页清单同时——两源都应用，来源标注合并', () => {
  const restricted = []
  const logs = []
  const origLog = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    apply({
      tools: { restrict: ({ deny }) => restricted.push(deny[0]) },
      get: (name) => (name === 'settings'
        ? { get: () => ({ toolMask: { deny: ['mcp__user__x'] } }) }
        : undefined),
    }, { deny: ['send_message', 'list_agents', 'interrupt_agent'] })
  } finally {
    console.log = origLog
  }
  assert.deepEqual(restricted, ['send_message', 'list_agents', 'interrupt_agent', 'mcp__user__x'],
    'fork 自带安全条目与用户清单并存（用户 15 项 mcp 屏蔽不被吃掉）')
  assert.ok(logs.some((l) => l.includes('masked 4 tool(s)') && l.includes('source: config.deny+settings')), '汇总日志标出合并来源')
})

test('apply：settings 服务缺席时静默回落（不炸 preset 挂载）', () => {
  const restricted = []
  const origLog = console.log
  console.log = () => {}
  try {
    apply({ tools: { restrict: ({ deny }) => restricted.push(deny[0]) } }, { deny: ['t1'] })
  } finally {
    console.log = origLog
  }
  assert.deepEqual(restricted, ['t1'], '无 settings 服务时 config.deny 仍然生效')
})
