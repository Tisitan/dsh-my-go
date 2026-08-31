// chain-rows 纯函数（设置页模型优先级列表编辑器的状态迁移）用例。
// 模块零依赖，node --test 直接 import——与 client bundle 内联同源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeChainRows,
  composeChain,
  decomposeChain,
  addChainEntry,
  removeChainEntry,
  moveChainEntry,
  updateChainEntry,
  stripEmptyFallbackRows,
} from '../src/chain-rows.js'

test('normalizeChainRows：脏数据归一为干净行数组', () => {
  assert.deepEqual(normalizeChainRows(undefined), [])
  assert.deepEqual(normalizeChainRows(null), [])
  assert.deepEqual(normalizeChainRows('nope'), [])
  assert.deepEqual(normalizeChainRows([]), [])
  // 非对象条目（null/字符串/数字）被过滤；缺字段 / 非字符串字段全部防御
  assert.deepEqual(
    normalizeChainRows([{ provider: 'p1', model: 'm1' }, null, 'x', 42, { model: 'm2' }, { provider: 7, model: 'm3' }]),
    [{ provider: 'p1', model: 'm1' }, { provider: '', model: 'm2' }, { provider: '', model: 'm3' }],
  )
})

test('composeChain：存储形状投影为优先级列表（#1 主选 + fallbacks 依序）', () => {
  assert.deepEqual(
    composeChain({ provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] }),
    [{ provider: 'p0', model: 'm0' }, { provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }],
  )
  // 空存储形状 → 单空行（全部跟随 Sisyphus 的合法持久态）
  assert.deepEqual(composeChain({}), [{ provider: '', model: '' }])
  assert.deepEqual(composeChain(undefined), [{ provider: '', model: '' }])
  assert.deepEqual(composeChain(null), [{ provider: '', model: '' }])
  // fallbacks 脏数据归一；非字符串主绑定字段防御为空串
  assert.deepEqual(
    composeChain({ provider: 7, model: 'm0', fallbacks: [null, { provider: 'p1' }] }),
    [{ provider: '', model: 'm0' }, { provider: 'p1', model: '' }],
  )
})

test('decomposeChain：拆解回存储形状（#1→provider/model，#2..N→fallbacks）', () => {
  assert.deepEqual(
    decomposeChain([{ provider: 'p0', model: 'm0' }, { provider: 'p1', model: 'm1' }]),
    { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] },
  )
  // 单条 → fallbacks 空链
  assert.deepEqual(
    decomposeChain([{ provider: 'p0', model: 'm0' }]),
    { provider: 'p0', model: 'm0', fallbacks: [] },
  )
  // 空链 → 规范全空形状（UI 永不产出：removeChainEntry 拒绝清空）
  assert.deepEqual(decomposeChain([]), { provider: '', model: '', fallbacks: [] })
  // 脏条目归一后再拆
  assert.deepEqual(
    decomposeChain([{ provider: 'p0', model: 'm0' }, null, { provider: 'p1' }]),
    { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: '' }] },
  )
})

test('compose/decompose round-trip 恒等（干净形状双向无损）', () => {
  const row = { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] }
  assert.deepEqual(decomposeChain(composeChain(row)), row)
  const chain = [{ provider: 'p0', model: 'm0' }, { provider: 'p1', model: 'm1' }]
  assert.deepEqual(composeChain(decomposeChain(chain)), chain)
  // 空存储形状的投影往返：compose({}) = 单空行，decompose 回到规范全空形状
  assert.deepEqual(decomposeChain(composeChain({})), { provider: '', model: '', fallbacks: [] })
})

test('addChainEntry：尾部追加（最低优先级）；默认空行 / 指定条目 / 非法条目防御', () => {
  assert.deepEqual(addChainEntry([]), [{ provider: '', model: '' }])
  assert.deepEqual(
    addChainEntry([{ provider: 'p1', model: 'm1' }]),
    [{ provider: 'p1', model: 'm1' }, { provider: '', model: '' }],
  )
  assert.deepEqual(
    addChainEntry([{ provider: 'p1', model: 'm1' }], { provider: 'p9', model: 'm9' }),
    [{ provider: 'p1', model: 'm1' }, { provider: 'p9', model: 'm9' }],
  )
  // 非法 entry（非对象 / 非字符串字段）→ 空行
  assert.deepEqual(addChainEntry([], 'nope'), [{ provider: '', model: '' }])
  assert.deepEqual(addChainEntry([], { provider: 42 }), [{ provider: '', model: '' }])
})

test('removeChainEntry：删 #1 则 #2 自动扶正；最小长度守卫拒绝清空', () => {
  const rows = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }, { provider: 'p3', model: 'm3' }]
  assert.deepEqual(removeChainEntry(rows, 0), [rows[1], rows[2]], '删 #1 → 原 #2 扶正为主选')
  assert.deepEqual(removeChainEntry(rows, 1), [rows[0], rows[2]])
  assert.deepEqual(removeChainEntry(rows, 2), [rows[0], rows[1]])
  assert.deepEqual(removeChainEntry(rows, 99), rows, '越界不改')
  assert.deepEqual(removeChainEntry(rows, -1), rows)
  // 守卫：链长 1 时拒绝删除（主选位恒存在，空值=跟随 Sisyphus）
  const single = [{ provider: 'p1', model: 'm1' }]
  assert.deepEqual(removeChainEntry(single, 0), single)
  // 删到剩 1 条后再次删除仍拒绝
  const afterPromote = removeChainEntry([rows[0], rows[1]], 0)
  assert.deepEqual(afterPromote, [rows[1]])
  assert.deepEqual(removeChainEntry(afterPromote, 0), [rows[1]])
})

test('moveChainEntry：跨 #1/#2 边界双向移动；边界 clamp 为 no-op', () => {
  const a = { provider: 'p1', model: 'm1' }
  const b = { provider: 'p2', model: 'm2' }
  const c = { provider: 'p3', model: 'm3' }
  const rows = [a, b, c]
  // #2 点 ↑：跨边界与 #1 换位（一键扶正，原主选降 #2）
  assert.deepEqual(moveChainEntry(rows, 1, -1), [b, a, c])
  // #1 点 ↓：跨边界换位（原 #2 扶正）
  assert.deepEqual(moveChainEntry(rows, 0, 1), [b, a, c])
  // ↑ #1 / ↓ 末行：no-op
  assert.deepEqual(moveChainEntry(rows, 0, -1), rows)
  assert.deepEqual(moveChainEntry(rows, 2, 1), rows)
  // 越界索引 / 非整数：no-op
  assert.deepEqual(moveChainEntry(rows, 9, -1), rows)
  assert.deepEqual(moveChainEntry(rows, 1.5, -1), rows)
  assert.deepEqual(moveChainEntry(rows, 1, 1.5), rows)
})

test('updateChainEntry：provider 变更重置该行 model（防悬空模型名），model 变更保留 provider', () => {
  const rows = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }]
  assert.deepEqual(
    updateChainEntry(rows, 0, 'provider', 'p9'),
    [{ provider: 'p9', model: '' }, { provider: 'p2', model: 'm2' }],
    'provider 变更重置本行 model，他行不动',
  )
  assert.deepEqual(
    updateChainEntry(rows, 1, 'model', 'm9'),
    [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm9' }],
  )
  // 非法 field / 越界 / 非字符串值：防御
  assert.deepEqual(updateChainEntry(rows, 0, 'dsv4p0813', true), rows)
  assert.deepEqual(updateChainEntry(rows, 7, 'model', 'x'), rows)
  assert.deepEqual(updateChainEntry(rows, 0, 'model', 42), [{ provider: 'p1', model: '' }, rows[1]])
})

test('stripEmptyFallbackRows：保存边界剔除全空备选行（tisitan.20 D1）', () => {
  // provider/model 双空（含缺失、null、非对象条目）的备选不落盘；半填行保留
  assert.deepEqual(
    stripEmptyFallbackRows({ provider: 'p0', model: 'm0', fallbacks: [{ provider: '', model: '' }, { provider: 'p1', model: '' }, null, {}] }),
    { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: '' }] },
  )
  // 无空行 / 无 fallbacks 字段 / 非对象输入：同一引用原样返回（零拷贝）
  const clean = { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] }
  assert.equal(stripEmptyFallbackRows(clean), clean)
  const noFb = { provider: 'p0', model: 'm0' }
  assert.equal(stripEmptyFallbackRows(noFb), noFb)
  assert.equal(stripEmptyFallbackRows(null), null)
  assert.equal(stripEmptyFallbackRows('nope'), 'nope')
  // 纯函数：入参不被突变
  const dirty = { fallbacks: [{ provider: '', model: '' }] }
  stripEmptyFallbackRows(dirty)
  assert.equal(dirty.fallbacks.length, 1)
})

test('全部纯函数不突变输入（深比较输入前后）', () => {
  const row = { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] }
  const chain = [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }]
  const rowBefore = JSON.stringify(row)
  const chainBefore = JSON.stringify(chain)
  composeChain(row)
  decomposeChain(chain)
  addChainEntry(chain)
  removeChainEntry(chain, 0)
  moveChainEntry(chain, 0, 1)
  updateChainEntry(chain, 0, 'provider', 'px')
  normalizeChainRows(chain)
  assert.equal(JSON.stringify(row), rowBefore, '存储形状输入保持原样')
  assert.equal(JSON.stringify(chain), chainBefore, '链输入保持原样（React 状态不可变更新前提）')
})

test('draft 往返语义：视图编辑经 decompose 写回后与存储形状等价（扶正一键完成）', () => {
  // 加载：存储形状 → 投影
  const stored = { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] }
  const chain = composeChain(stored)
  // 用户把 #2 点 ↑ 扶正：写回后 provider/model = 原备选一，fallbacks = [原主选, 原备选二]
  const promoted = decomposeChain(moveChainEntry(chain, 1, -1))
  assert.deepEqual(promoted, {
    provider: 'p1',
    model: 'm1',
    fallbacks: [{ provider: 'p0', model: 'm0' }, { provider: 'p2', model: 'm2' }],
  })
  // 删 #1（扶正后的主选）：原主选（现 #2）再次扶正
  const deleted = decomposeChain(removeChainEntry(chain, 0))
  assert.deepEqual(deleted, {
    provider: 'p1',
    model: 'm1',
    fallbacks: [{ provider: 'p2', model: 'm2' }],
  })
  // 追加空行 → fallbacks 尾部多一条空条目（形状与 schema fallbacks 条目一致）
  const appended = decomposeChain(addChainEntry(chain))
  assert.deepEqual(appended.fallbacks, [...stored.fallbacks, { provider: '', model: '' }])
})
