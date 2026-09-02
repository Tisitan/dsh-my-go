// 子代理登记表（preset/shared/child-registry.mjs）单元回归批（健康度批新增）。
// 八张表原本住在 broker 的 apply() 闭包里，跨表不变量只能靠 bridge 集成用例
// 间接触发；抽出后这里直测四组「漏一张就静默串号」的不变量：墓碑镜像清理与
// 有界驱逐、end 收尾的两个面（retireChild / retireTypeRecords 不可互换）、
// 备选覆盖的两段式登记（pending → promote 的优先级回退）、复活重建的守卫。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChildRegistry, DISPOSED_TYPES_CAP } from '../preset/shared/child-registry.mjs'

const newRegistry = (cap) => createChildRegistry(cap === undefined ? {} : { disposedTypesCap: cap })

test('墓碑迁移：工种移入墓碑、活登记与备选覆盖同时摘除；无活登记返回 false', () => {
  const r = newRegistry()
  r.sessionTypes.set('c1', 'hermes')
  r.activeFallback.set('c1', { provider: 'p1', model: 'm1' })
  assert.equal(r.tombstoneType('c1'), true)
  assert.equal(r.sessionTypes.has('c1'), false, '活登记必须让位')
  assert.equal(r.disposedTypes.get('c1'), 'hermes', '晚到的 end 靠墓碑认工种')
  assert.equal(r.activeFallback.has('c1'), false, '墓碑期不再有运行期重绑需求')
  assert.equal(r.tombstoneType('c-unknown'), false, '无活登记不做迁移（调用方据此决定刷不刷快照）')
  assert.equal(r.disposedTypes.has('c-unknown'), false)
})

test('墓碑有界 FIFO：超容驱逐最旧条目，与其备选覆盖同进退', () => {
  const r = newRegistry(2)
  for (const id of ['c1', 'c2', 'c3']) {
    r.sessionTypes.set(id, 'explore')
    r.activeFallback.set(id, { provider: 'p', model: id })
    r.tombstoneType(id)
  }
  assert.equal(r.disposedTypes.size, 2, '容量 2 的墓碑只留最新两枚')
  assert.equal(r.disposedTypes.has('c1'), false, '最旧的 c1 被驱逐')
  assert.equal(r.disposedTypes.has('c3'), true)
  assert.equal(r.activeFallback.has('c1'), false, '被驱逐者的备选覆盖不得残留')
  assert.equal(r.activeFallback.has('c3'), false, '刚墓碑化的同点已摘')
})

test('墓碑容量缺省取 DISPOSED_TYPES_CAP：不传 option 也自洽', () => {
  const r = newRegistry()
  for (let i = 0; i < DISPOSED_TYPES_CAP + 5; i++) {
    r.sessionTypes.set(`c${i}`, 'oracle')
    r.tombstoneType(`c${i}`)
  }
  assert.equal(r.disposedTypes.size, DISPOSED_TYPES_CAP)
  assert.equal(r.disposedTypes.has('c0'), false)
  assert.equal(r.disposedTypes.has(`c${DISPOSED_TYPES_CAP + 4}`), true)
})

test('retireChild 与 retireTypeRecords 的分工：后者故意保留属主路由', () => {
  const r = newRegistry()
  const arm = (id) => {
    r.sessionTypes.set(id, 'librarian')
    r.disposedTypes.set(id, 'librarian')
    r.activeFallback.set(id, { provider: 'p', model: 'm' })
    r.childOwner.set(id, 'parent-1')
  }
  arm('a')
  r.retireChild('a')
  for (const table of [r.sessionTypes, r.disposedTypes, r.activeFallback, r.childOwner]) {
    assert.equal(table.has('a'), false, 'end 收尾四张表一起翻篇')
  }
  arm('b')
  r.retireTypeRecords('b')
  assert.equal(r.sessionTypes.has('b'), false)
  assert.equal(r.disposedTypes.has('b'), false)
  assert.equal(r.activeFallback.has('b'), false)
  assert.equal(r.childOwner.get('b'), 'parent-1', '属主已消亡分支不得抢先摘掉属主路由')
})

test('备选覆盖两段式登记：pending 优先回退、promote 同点转正并撤临时', () => {
  const r = newRegistry()
  const entry = { provider: 'backup-p', model: 'backup-m' }
  r.pendingFallbackByLabel.set('dsh-my-go:hermes: p', entry)
  assert.deepEqual(r.fallbackOverrideFor('c-new', 'dsh-my-go:hermes: p'), entry, 'resolve 前按 label 命中')
  assert.equal(r.fallbackOverrideFor('c-new', 'unrelated'), undefined, 'label 不匹配不生效')
  r.promoteFallback({ label: 'dsh-my-go:hermes: p', childId: 'c-new', type: 'hermes', entry })
  assert.equal(r.pendingFallbackByLabel.size, 0, '转正即撤临时，不留悬空覆盖')
  assert.equal(r.sessionTypes.get('c-new'), 'hermes')
  assert.deepEqual(r.activeFallback.get('c-new'), entry)
  assert.deepEqual(r.fallbackOverrideFor('c-new', 'dsh-my-go:hermes: p'), entry, '此后按 childId 永久命中')
})

test('永久覆盖优先于同 label 的临时登记（并发重派不误伤已上岗儿童）', () => {
  const r = newRegistry()
  r.activeFallback.set('c1', { provider: 'active', model: 'm1' })
  r.pendingFallbackByLabel.set('same-label', { provider: 'pending', model: 'm2' })
  assert.equal(r.fallbackOverrideFor('c1', 'same-label').provider, 'active')
  assert.equal(r.fallbackOverrideFor('c2', 'same-label').provider, 'pending', '无永久登记者仍走临时')
})

test('复活重建：工种恒回填；备选覆盖只在条目畸形守卫通过时回填；属主 undefined 不写键', () => {
  const r = newRegistry()
  r.rearmChild('c1', { agentType: 'explore', fallbackEntry: { provider: 'p', model: 'm' } }, 'parent-1')
  assert.equal(r.sessionTypes.get('c1'), 'explore')
  assert.deepEqual(r.activeFallback.get('c1'), { provider: 'p', model: 'm' })
  assert.equal(r.childOwner.get('c1'), 'parent-1')
  r.rearmChild('c2', { agentType: 'oracle' }, undefined)
  assert.equal(r.sessionTypes.get('c2'), 'oracle')
  assert.equal(r.activeFallback.has('c2'), false, '无 fallbackEntry 视同常规工种')
  assert.equal(r.childOwner.has('c2'), false, 'ownerPid undefined 不得写入 undefined 键')
  r.rearmChild('c3', { agentType: 'hermes', fallbackEntry: { provider: 'p' } }, 'parent-2')
  assert.equal(r.activeFallback.has('c3'), false, '缺 model 的畸形条目不回填（与迁移前守卫同形）')
  r.rearmChild('c4', { agentType: 'hermes', fallbackEntry: { provider: 1, model: 'm' } }, 'parent-2')
  assert.equal(r.activeFallback.has('c4'), false, 'provider 非字符串同样拒填')
})

// 0.3.0-tisitan.7 N5：复活即新世代——两张一次性表必须同点清零。
// 病灶链（端到端行为面见 roster-route.test.mjs 的队列解冻用例）：childId 只要
// 进过一次备选评估（决策点在 end 入口，早于 attemptFallbackRedeploy 的三个早退
// 分支），fallbackDecided 里那条就随 childId 永挂（全仓此前零 .delete）；带着它
// 复活，复活轮**正常完工**的 end 会被「评估在飞」分支当自己人吞掉 → 记录永挂
// running → advanceQueue 被 isBusy 恒真堵死 → 该编排会话队列永久冻结。
test('复活即新世代：rearmChild 清备选 once-guard 与 abort 护航，且只清复活者自己', () => {
  const r = newRegistry()
  r.sessionTypes.set('c-other', 'hermes')
  r.fallbackDecided.add('c-other')
  r.abortExpected.add('c-other')
  r.fallbackDecided.add('c1')
  r.abortExpected.add('c1')
  r.rearmChild('c1', { agentType: 'hermes' }, 'parent-1')
  assert.equal(r.fallbackDecided.has('c1'), false, '上一代际的备选 once-guard 不得跟着复活体下世')
  assert.equal(r.abortExpected.has('c1'), false, '上一代际的 abort 护航同点清零')
  assert.equal(r.sessionTypes.get('c1'), 'hermes', '三张回填表照常回填')
  assert.equal(r.childOwner.get('c1'), 'parent-1')
  assert.equal(r.fallbackDecided.has('c-other'), true, '他人条目不受牵连（决策仍只一次）')
  assert.equal(r.abortExpected.has('c-other'), true, '他人护航不受牵连')
})
