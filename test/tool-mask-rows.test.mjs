// tool-mask-rows 纯函数（设置页工具屏蔽双列表编辑器的状态迁移）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDenyList,
  blockTool,
  unblockTool,
  availableTools,
  denyEntries,
} from '../src/tool-mask-rows.js'

test('normalizeDenyList：脏数据归一 + 去重保序', () => {
  assert.deepEqual(normalizeDenyList(undefined), [])
  assert.deepEqual(normalizeDenyList(null), [])
  assert.deepEqual(normalizeDenyList('nope'), [])
  assert.deepEqual(
    normalizeDenyList(['b', 'a', 'b', '', 42, null, 'a']),
    ['b', 'a'],
    '非字符串/空串过滤，重复去重且保持首次出现顺序',
  )
})

test('blockTool：追加去重；空名 no-op', () => {
  assert.deepEqual(blockTool([], 'tool_a'), ['tool_a'])
  assert.deepEqual(blockTool(['tool_a'], 'tool_a'), ['tool_a'], '重复屏蔽 no-op')
  assert.deepEqual(blockTool(['tool_a'], ''), ['tool_a'])
  assert.deepEqual(blockTool(['tool_a'], undefined), ['tool_a'])
})

test('unblockTool：按名移除；未知名原样', () => {
  assert.deepEqual(unblockTool(['tool_a', 'tool_b'], 'tool_a'), ['tool_b'])
  assert.deepEqual(unblockTool(['tool_a'], 'ghost'), ['tool_a'])
})

test('availableTools：花名册 − 已屏蔽 − 过滤词（大小写不敏感子串）', () => {
  const roster = ['mcp__vcp__alpha', 'mcp__vcp__beta', 'read', 'write']
  const deny = ['read']
  assert.deepEqual(availableTools(roster, deny, ''), ['mcp__vcp__alpha', 'mcp__vcp__beta', 'write'])
  assert.deepEqual(availableTools(roster, deny, 'VCP'), ['mcp__vcp__alpha', 'mcp__vcp__beta'], '过滤大小写不敏感')
  assert.deepEqual(availableTools(roster, deny, '  beta '), ['mcp__vcp__beta'], '过滤词 trim')
  assert.deepEqual(availableTools(undefined, [], ''), [], '花名册缺失防御')
  assert.deepEqual(availableTools(['dup', 'dup'], [], 'dup'), ['dup'], '花名册去重')
  assert.deepEqual(availableTools(roster, ['mcp__vcp__alpha', 'mcp__vcp__beta', 'read', 'write'], ''), [], '全部屏蔽后左列空')
})

test('denyEntries：花名册外条目标记未连接（保留不删）', () => {
  const roster = ['tool_a', 'tool_c']
  assert.deepEqual(
    denyEntries(['tool_a', 'tool_b', 'tool_c'], roster),
    [
      { name: 'tool_a', connected: true },
      { name: 'tool_b', connected: false },
      { name: 'tool_c', connected: true },
    ],
  )
  assert.deepEqual(denyEntries(['tool_x'], []), [{ name: 'tool_x', connected: false }], '空花名册全部未连接')
})

test('全部纯函数不突变输入数组（深比较输入前后）', () => {
  const deny = ['a', 'b']
  const roster = ['a', 'c']
  const denyBefore = JSON.stringify(deny)
  blockTool(deny, 'c')
  unblockTool(deny, 'a')
  availableTools(roster, deny, 'a')
  denyEntries(deny, roster)
  normalizeDenyList(deny)
  assert.equal(JSON.stringify(deny), denyBefore, 'deny 数组保持原样（React 状态不可变更新前提）')
})

test('与保存通路联动：屏蔽→解除→空列表提交 []（host 半转 unset）', () => {
  const added = blockTool(normalizeDenyList(undefined), 'mcp__x__y')
  assert.deepEqual(added, ['mcp__x__y'])
  const emptied = unblockTool(added, 'mcp__x__y')
  assert.deepEqual(emptied, [], '编辑器产出的空清单直接作为 toolMask.deny 提交')
})
