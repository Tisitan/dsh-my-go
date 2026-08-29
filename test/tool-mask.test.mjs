// tool-mask 屏蔽清单解析（tisitan.13）用例：三级优先级（config.deny >
// settings toolMask.deny > DEFAULT_DENY）+ DEFAULT_DENY 泛化清空回归。
// 模块零依赖，node --test 直接 import（resolveDeny 为纯函数）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply, resolveDeny } from '../preset/tool-mask.mjs'

test('resolveDeny：config.deny 显式覆盖最高（含空数组=显式屏蔽空）', () => {
  assert.deepEqual(
    resolveDeny({ deny: ['mcp__a__x'] }, { toolMask: { deny: ['mcp__b__y'] } }),
    ['mcp__a__x'],
    'config.deny 压过 settings',
  )
  assert.deepEqual(
    resolveDeny({ deny: [] }, { toolMask: { deny: ['mcp__b__y'] } }),
    [],
    'config.deny: [] 是显式覆盖为空，不回落 settings',
  )
  assert.deepEqual(resolveDeny({ deny: [1, 'x'] }), ['1', 'x'], '条目统一转 string')
})

test('resolveDeny：settings toolMask.deny 次之；非数组视为缺省', () => {
  assert.deepEqual(resolveDeny({}, { toolMask: { deny: ['mcp__b__y', 'tool_z'] } }), ['mcp__b__y', 'tool_z'])
  assert.deepEqual(resolveDeny({}, { toolMask: { deny: 'mcp__b__y' } }), [], '非数组 deny 视为缺省')
  assert.deepEqual(resolveDeny({}, { toolMask: null }), [], 'toolMask 非对象视为缺省')
  assert.deepEqual(resolveDeny({}, 'garbage'), [], 'stored 非对象视为缺省')
  assert.deepEqual(resolveDeny({}), [], '两源皆缺省 → 空默认')
})

test('resolveDeny：DEFAULT_DENY 已泛化清空——源码不再含任何私有工具名', async () => {
  const src = await readFile(new URL('../preset/tool-mask.mjs', import.meta.url), 'utf-8')
  assert.match(src, /const DEFAULT_DENY = \[\];/, 'DEFAULT_DENY 必须是空数组')
  assert.doesNotMatch(src, /_for_rei|opencode|rei_memo/, '私有部署工具名一个不留')
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
      tools: { restrict: ({ deny }) => { if (deny[0] === 'ghost_tool') throw new Error('unknown global tool'); restricted.push(deny[0]) } },
      get: (name) => (name === 'settings' ? settingsService : undefined),
    }, {})
  } finally {
    console.warn = origWarn
    console.log = origLog
  }
  assert.deepEqual(restricted, ['good_tool'], '缺席工具 restrict 抛错被跳过，其余照常应用')
  assert.equal(warned.length, 1, '缺席工具有 warn 留痕')
  assert.ok(warned[0].includes('ghost_tool'))
  assert.ok(logs.some((l) => l.includes('masked 2 tool(s)') && l.includes('source: settings')), '汇总日志带数量与来源')
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
