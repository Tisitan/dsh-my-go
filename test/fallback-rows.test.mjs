// fallback-rows 纯函数（设置页备选链编辑器的状态迁移）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeFallbackRows,
  addFallbackRow,
  removeFallbackRow,
  moveFallbackRow,
  updateFallbackRow,
} from '../src/fallback-rows.js'

test('normalizeFallbackRows：脏数据归一为干净行数组', () => {
  assert.deepEqual(normalizeFallbackRows(undefined), [])
  assert.deepEqual(normalizeFallbackRows(null), [])
  assert.deepEqual(normalizeFallbackRows('nope'), [])
  assert.deepEqual(normalizeFallbackRows([]), [])
  // 非对象条目（null/字符串/数字）被过滤；缺字段 / 非字符串字段全部防御
  assert.deepEqual(
    normalizeFallbackRows([{ provider: 'p1', model: 'm1' }, null, 'x', 42, { model: 'm2' }, { provider: 7, model: 'm3' }]),
    [{ provider: 'p1', model: 'm1' }, { provider: '', model: 'm2' }, { provider: '', model: 'm3' }],
  )
})

test('addFallbackRow：尾部追加空行（最低优先级）', () => {
  assert.deepEqual(addFallbackRow([]), [{ provider: '', model: '' }])
  assert.deepEqual(
    addFallbackRow([{ provider: 'p1', model: 'm1' }]),
    [{ provider: 'p1', model: 'm1' }, { provider: '', model: '' }],
  )
})

test('removeFallbackRow：按索引删除；越界原样', () => {
  const rows = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }, { provider: 'p3', model: 'm3' }]
  assert.deepEqual(removeFallbackRow(rows, 1), [rows[0], rows[2]])
  assert.deepEqual(removeFallbackRow(rows, 0), [rows[1], rows[2]])
  assert.deepEqual(removeFallbackRow(rows, 2), [rows[0], rows[1]])
  assert.deepEqual(removeFallbackRow(rows, 99), rows, '越界不改')
  assert.deepEqual(removeFallbackRow(rows, -1), rows)
})

test('moveFallbackRow：相邻交换即链序调整；边界 clamp 为 no-op', () => {
  const a = { provider: 'p1', model: 'm1' }
  const b = { provider: 'p2', model: 'm2' }
  const c = { provider: 'p3', model: 'm3' }
  const rows = [a, b, c]
  // ↓ 首行：与第二行交换（顺序即优先级，交换后 p2 变为最先尝试）
  assert.deepEqual(moveFallbackRow(rows, 0, 1), [b, a, c])
  // ↑ 次行：同上
  assert.deepEqual(moveFallbackRow(rows, 1, -1), [b, a, c])
  // ↑ 首行 / ↓ 末行：no-op
  assert.deepEqual(moveFallbackRow(rows, 0, -1), rows)
  assert.deepEqual(moveFallbackRow(rows, 2, 1), rows)
  // 越界索引 / 非整数：no-op
  assert.deepEqual(moveFallbackRow(rows, 9, -1), rows)
  assert.deepEqual(moveFallbackRow(rows, 1.5, -1), rows)
})

test('updateFallbackRow：provider 变更重置该行 model（防悬空模型名），model 变更保留 provider', () => {
  const rows = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }]
  assert.deepEqual(
    updateFallbackRow(rows, 0, 'provider', 'p9'),
    [{ provider: 'p9', model: '' }, { provider: 'p2', model: 'm2' }],
    'provider 变更重置本行 model，他行不动',
  )
  assert.deepEqual(
    updateFallbackRow(rows, 1, 'model', 'm9'),
    [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm9' }],
  )
  // 非法 field / 越界 / 非字符串值：防御
  assert.deepEqual(updateFallbackRow(rows, 0, 'dsv4p0813', true), rows)
  assert.deepEqual(updateFallbackRow(rows, 7, 'model', 'x'), rows)
  assert.deepEqual(updateFallbackRow(rows, 0, 'model', 42), [{ provider: 'p1', model: '' }, rows[1]])
})

test('全部纯函数不突变输入数组（深比较输入前后）', () => {
  const rows = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }]
  const before = JSON.stringify(rows)
  addFallbackRow(rows)
  removeFallbackRow(rows, 0)
  moveFallbackRow(rows, 0, 1)
  updateFallbackRow(rows, 0, 'provider', 'px')
  normalizeFallbackRows(rows)
  assert.equal(JSON.stringify(rows), before, '输入数组保持原样（React 状态不可变更新前提）')
})

test('与主绑定联动语义：编辑器产出的形状可直接作为 fallbacks 提交（空链=[])', () => {
  // 用户添加一行又删光 → 提交 []（host 半转 unset）
  const added = addFallbackRow([])
  const emptied = removeFallbackRow(added, 0)
  assert.deepEqual(emptied, [])
  // 用户填完一行 → 形状与 schema fallbacks 条目一致
  const filled = updateFallbackRow(added, 0, 'provider', 'gateway-b')
  const filled2 = updateFallbackRow(filled, 0, 'model', 'model-b')
  assert.deepEqual(filled2, [{ provider: 'gateway-b', model: 'model-b' }])
})
