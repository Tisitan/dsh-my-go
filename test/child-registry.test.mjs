// 子代理登记表（preset/shared/child-registry.mjs）单元回归批（健康度批新增）。
// 八张表原本住在 broker 的 apply() 闭包里，跨表不变量只能靠 bridge 集成用例
// 间接触发；抽出后这里直测四组「漏一张就静默串号」的不变量：墓碑镜像清理与
// 有界驱逐、end 收尾的两个面（retireChild / retireTypeRecords 不可互换，以及
// 两者都**不清**提交登记 + 提交登记的有界 FIFO）、备选覆盖的两段式登记
// （pending → promote 的优先级回退）、复活重建的守卫。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChildRegistry, DISPOSED_TYPES_CAP, REPORT_SUBMITTED_CAP } from '../preset/shared/child-registry.mjs'

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

test('retireChild 与 retireTypeRecords 的分工：后者故意保留属主路由；两者都不摘提交登记', () => {
  const r = newRegistry()
  const arm = (id) => {
    r.sessionTypes.set(id, 'librarian')
    r.disposedTypes.set(id, 'librarian')
    r.activeFallback.set(id, { provider: 'p', model: 'm' })
    r.childOwner.set(id, 'parent-1')
    r.markSubmitted(id, { conclusion: '交过了', evidence: ['src/a.ts:1'], open: '无' })
  }
  arm('a')
  r.retireChild('a')
  for (const table of [r.sessionTypes, r.disposedTypes, r.activeFallback, r.childOwner]) {
    assert.equal(table.has('a'), false, 'end 收尾四张表一起翻篇')
  }
  assert.equal(r.reportSubmitted.has('a'), true, '提交成功是永久历史事实，终局不摘（复活轮误判的根因点）')
  arm('b')
  r.retireTypeRecords('b')
  assert.equal(r.sessionTypes.has('b'), false)
  assert.equal(r.disposedTypes.has('b'), false)
  assert.equal(r.activeFallback.has('b'), false)
  assert.equal(r.childOwner.get('b'), 'parent-1', '属主已消亡分支不得抢先摘掉属主路由')
  assert.equal(r.reportSubmitted.has('b'), true, '属主先走一步同样不撤销「它交过」这件事实')
})

// 复活轮报告误判修复批（主修）：reportSubmitted 曾随终局清空，而 rearmChild 不
// 回灌，于是 continue/forward 复活轮只要不重交报告，闸门就判「从未提交」并发射
// 补发（历史现场 2026-09-07 7f6c44fa）。现在这张表跨终局保留，唯一的收缩手段是
// 有界 FIFO 容量——下面两例钉住「保留」与「有界」两端。
test('提交登记跨终局仍在：retireChild 后 rearmChild 复活，闸门读到的一直是已交付', () => {
  const r = newRegistry()
  r.markSubmitted('c1', { conclusion: '一轮结论', evidence: ['src/a.ts:1'], open: '无' })
  r.sessionTypes.set('c1', 'hermes')
  r.retireChild('c1')
  assert.equal(r.reportSubmitted.get('c1').conclusion, '一轮结论', '终局只翻类型侧四表，登记原样在')
  r.rearmChild('c1', { agentType: 'hermes' }, 'parent-1')
  assert.equal(r.reportSubmitted.has('c1'), true, '复活不需要回灌——条目从未离开')
  assert.equal(r.reportSubmitted.get('c1').conclusion, '一轮结论', '复活轮读到的仍是上一代交过的那份')
})

test('提交登记有界 FIFO：超 REPORT_SUBMITTED_CAP 驱逐最旧；重交刷新最近性', () => {
  const r = newRegistry()
  for (let i = 0; i < REPORT_SUBMITTED_CAP; i++) r.markSubmitted(`c${i}`, { conclusion: `#${i}`, evidence: [], open: '无' })
  assert.equal(r.reportSubmitted.size, REPORT_SUBMITTED_CAP, '恰好到容量不驱逐')
  r.markSubmitted('c-extra', { conclusion: '溢出者', evidence: [], open: '无' })
  assert.equal(r.reportSubmitted.size, REPORT_SUBMITTED_CAP, '超容即驱逐，表长恒不越 CAP')
  assert.equal(r.reportSubmitted.has('c0'), false, '最旧的 c0 出局')
  assert.equal(r.reportSubmitted.has('c1'), true, '只驱逐一枚')
  assert.equal(r.reportSubmitted.has('c-extra'), true)
  // delete→set 刷新最近性：把最旧者重登一次，它就该站到最新侧、随下一轮驱逐活下来
  r.markSubmitted('c1', { conclusion: 'c1 重交', evidence: [], open: '无' })
  assert.equal(r.reportSubmitted.size, REPORT_SUBMITTED_CAP, '重交不占第二个位置')
  r.markSubmitted('c-extra2', { conclusion: '再溢出', evidence: [], open: '无' })
  assert.equal(r.reportSubmitted.has('c1'), true, '刷新过最近性的条目不该被当成最旧驱逐')
  assert.equal(r.reportSubmitted.has('c2'), false, '真正最旧的 c2 才是本轮牺牲者')
  assert.equal(r.reportSubmitted.get('c1').conclusion, 'c1 重交', '重交的值覆盖旧值')
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

// 1.5 方案甲裁决：repairRetried 的清理双点各司其职——retireChild 是防无限循环的
// 关键（补发链不走 rearmChild，guard 存续到补发轮 end 的转裁决），rearmChild 防
// 主编复活做新任务被旧 guard 误吞补发资格。两处都只清自己。
// 对照面（复活轮误判修复批）：同两个清理点上 reportSubmitted **一律不跟着翻篇**——
// 授权是「本代际还能不能再补发」（一次性），提交是「它历史上交过报告」（永久事实），
// 两者语义相反，曾经被写在同一处正是误判的源头。
test('repairRetried（报告补发 once-guard）：retireChild 终局清 + rearmChild 复活清，且只清自己', () => {
  const r = newRegistry()
  r.repairRetried.add('c1')
  r.repairRetried.add('c-other')
  r.markSubmitted('c1', { conclusion: 'c1 交过', evidence: [], open: '无' })
  r.markSubmitted('c-other', { conclusion: 'c-other 交过', evidence: [], open: '无' })
  r.retireChild('c1')
  assert.equal(r.repairRetried.has('c1'), false, '终局翻篇：授权随任何终局落账清零（转裁决后主编复活不误吞新任务）')
  assert.equal(r.repairRetried.has('c-other'), true, '他人授权不受牵连')
  assert.equal(r.reportSubmitted.has('c1'), true, '同一清理点：提交登记不随授权翻篇')
  r.rearmChild('c-other', { agentType: 'hermes' }, 'parent-1')
  assert.equal(r.repairRetried.has('c-other'), false, '复活即新世代同点清（规格字面；补发链不走此处，不构成死循环回路）')
  assert.equal(r.reportSubmitted.get('c-other').conclusion, 'c-other 交过', '复活点同样不清提交登记')
})
