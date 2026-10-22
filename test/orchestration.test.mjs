// Unit tests for the Orchestration state machine (single-line-blocking core).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Orchestration, pruneLedgerParents } from '../preset/tools/broker.mjs'
import { laneOf, clampReadCapacity, clampWriteCapacity } from '../preset/shared/orchestration.mjs'

test('beginSpawning occupies the single slot (isBusy)', () => {
  const o = new Orchestration()
  assert.equal(o.isBusy(), false)
  const rec = o.beginSpawning('hermes', 'task')
  assert.equal(o.isBusy(), true)
  assert.equal(rec.status, 'spawning')
  assert.equal(o.snapshot().currentRecords[0].childId, rec.childId)
})

test('bindChild promotes placeholder to running with real childId', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  const bound = o.bindChild(rec.childId, 'sess-1')
  assert.equal(bound.status, 'running')
  assert.equal(o.snapshot().currentRecords[0].childId, 'sess-1')
  assert.equal(o.currentMap.has(rec.childId), false)
})

test('finish moves record to history and frees the slot', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  const done = o.finish('sess-1', 'conclusion text')
  assert.equal(done.status, 'done')
  assert.equal(o.isBusy(), false)
  assert.equal(o.history.length, 1)
  assert.equal(o.history[0].conclusion, 'conclusion text')
})

test('finish clears pending helpRequests for that child (no zombie help)', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'replan', content: 'x' })
  assert.equal(o.helpRequests.size, 1)
  o.finish('sess-1', 'done')
  assert.equal(o.helpRequests.size, 0)
})

test('clearHelpFor returns the removed count; finish exposes clearedHelp on the returned copy only ()', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'replan', content: 'x' })
  o.suspend('sess-1', { id: 'help-2', childId: 'sess-1', intent: 'execute', content: 'y' })
  assert.equal(o.helpRequests.size, 2)
  const done = o.finish('sess-1', 'done')
  assert.equal(done.clearedHelp, 2, '返回副本附带连带清理计数，供调用点做可见通知')
  assert.ok(!('clearedHelp' in o.history[0]), 'history/台账记录不携带该瞬态字段')
  assert.equal(o.helpRequests.size, 0)
  // 无求助单时保持旧返回形状（零变化）
  const rec2 = o.beginSpawning('hermes', 'task2')
  o.bindChild(rec2.childId, 'sess-2')
  const done2 = o.finish('sess-2', 'done2')
  assert.ok(!('clearedHelp' in done2))
})

test('suspend marks waiting; resume flips back to running', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'execute', content: 'cmd' })
  assert.equal(o.snapshot().currentRecords[0].status, 'waiting')
  o.resolveHelp('help-1')
  o.resume('sess-1')
  assert.equal(o.snapshot().currentRecords[0].status, 'running')
  assert.equal(o.helpRequests.size, 0)
})

test('stallNotified（挂起停摆的 episode 标记）随挂起/复籍/落账复位，且不随记录入史', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'execute', content: 'cmd' })
  // broker 报完停摆就是这么打的标（复制换槽，与本类迁移同形）
  o.currentMap.set('sess-1', { ...o.currentMap.get('sess-1'), stallNotified: true })
  assert.equal(o.currentMap.get('sess-1').stallNotified, true, '标在占槽记录上')
  o.resolveHelp('help-1')
  const back = o.resume('sess-1')
  assert.equal('stallNotified' in back, false, '复籍即 episode 结束：不清下一次挂起就永久哑火')
  // 异常路径（标还在册时又挂起）：suspend 同点复位，标记不可能跨挂起存活
  o.currentMap.set('sess-1', { ...o.currentMap.get('sess-1'), stallNotified: true })
  const again = o.suspend('sess-1', { id: 'help-2', childId: 'sess-1', intent: 'execute', content: 'cmd2' })
  assert.equal('stallNotified' in again, false, '再次挂起 = 新 episode')
  // 落账：标记不入 history（history 即台账持久化的桶），复活回来的记录因此恒干净
  o.currentMap.set('sess-1', { ...o.currentMap.get('sess-1'), stallNotified: true })
  const done = o.finish('sess-1', 'conclusion')
  assert.equal('stallNotified' in done, false, 'finish 剥除标记（返回副本）')
  assert.equal('stallNotified' in o.history[0], false, 'history/台账记录不携带该瞬态字段')
  assert.equal('stallNotified' in o.revive('sess-1'), false, '复活记录天然干净')
})

test('revive moves a finished record from history back into currentMap', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hephaestus', 'task')
  o.bindChild(rec.childId, 'sess-1')
  o.finish('sess-1', 'conclusion')
  assert.equal(o.isBusy(), false)
  const revived = o.revive('sess-1')
  assert.equal(revived.status, 'running')
  assert.equal(o.isBusy(), true)
  assert.equal(o.history.length, 0)
  assert.equal(o.snapshot().currentRecords[0].childId, 'sess-1')
})

test('revive is a no-op for unknown ids', () => {
  const o = new Orchestration()
  assert.equal(o.revive('nope'), undefined)
})

test('requeueHead puts work back at the front of the queue', () => {
  const o = new Orchestration()
  const w1 = { id: 'work-1', agentType: 'hermes', prompt: 'a' }
  const w2 = { id: 'work-2', agentType: 'explore', prompt: 'b' }
  o.queue.push(w2)
  o.requeueHead(w1)
  assert.equal(o.dequeue().id, 'work-1')
  assert.equal(o.dequeue().id, 'work-2')
})

test('history is capped at 200 entries', () => {
  const o = new Orchestration()
  for (let i = 0; i < 210; i++) {
    const rec = o.beginSpawning('hermes', `task-${i}`)
    o.bindChild(rec.childId, `sess-${i}`)
    o.finish(`sess-${i}`, `c-${i}`)
  }
  assert.equal(o.history.length, 200)
  assert.equal(o.history.at(-1).conclusion, 'c-209')
  assert.equal(o.history[0].conclusion, 'c-10')
})

test('record() finds both running and finished children', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'task')
  o.bindChild(rec.childId, 'sess-1')
  assert.equal(o.record('sess-1').status, 'running')
  o.finish('sess-1', 'done')
  assert.equal(o.record('sess-1').status, 'done')
  assert.equal(o.record('unknown'), undefined)
})

test('followupPrompt updates last prompt for running and history records', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'original')
  o.bindChild(rec.childId, 'sess-1')
  o.followupPrompt('sess-1', 'rejected, redo')
  assert.equal(o.currentMap.get('sess-1').prompt, 'rejected, redo')
  o.finish('sess-1', 'done')
  o.followupPrompt('sess-1', 'followup after done')
  assert.equal(o.history[0].prompt, 'followup after done')
})

test('followupPrompt urgency tag: 入账/扩散/清除三态', () => {
  const o = new Orchestration()
  const rec = o.beginSpawning('hermes', 'original')
  o.bindChild(rec.childId, 'sess-1')
  // 非空字符串入账
  o.followupPrompt('sess-1', 'mid-run correction', 'steer')
  assert.equal(o.currentMap.get('sess-1').urgency, 'steer')
  // 随 finish 扩散进 history（台账落盘全链路的前置）
  o.finish('sess-1', 'done')
  assert.equal(o.history[0].urgency, 'steer')
  // 缺省清除残留：字段语义恒为「最新一条 prompt 的投递档」
  o.followupPrompt('sess-1', 'plain queued followup')
  assert.equal(o.history[0].urgency, undefined)
  assert.ok(!('urgency' in o.history[0]), '清除是删字段而非置 undefined——旧记录形状零变化')
  // 空串同缺省
  o.followupPrompt('sess-1', 'abort-tagged', 'abort')
  assert.equal(o.history[0].urgency, 'abort')
  o.followupPrompt('sess-1', 'empty string clears', '')
  assert.ok(!('urgency' in o.history[0]))
})

test('bindChild on a missing placeholder warns and returns undefined', () => {
  const o = new Orchestration()
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    const result = o.bindChild('child-missing', 'sess-1')
    assert.equal(result, undefined)
    assert.equal(o.currentMap.size, 0)
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes('bindChild failed'))
    assert.ok(warnings[0].includes('sess-1'))
  } finally {
    console.warn = origWarn
  }
})

test('dropQueuedFailed removes the work item and records a failed history entry', () => {
  const o = new Orchestration()
  o.enqueue('hermes', 'a', 'parent-1')
  o.enqueue('explore', 'b', 'parent-1')
  const work = o.queue[0]
  work.retries = 4
  const done = o.dropQueuedFailed(work, new Error('spawn boom'))
  assert.equal(o.queue.length, 1)
  assert.equal(o.queue[0].agentType, 'explore')
  assert.equal(done.status, 'failed')
  assert.equal(done.agentType, 'hermes')
  assert.ok(done.conclusion.includes('spawn boom'))
  assert.equal(o.history.length, 1)
  assert.equal(o.history[0].childId, work.id)
})

// ── 兜底闸与台账养护 ──────────────────────────────────────

test('enforceCurrentCap：超限淘汰 updatedAt 最旧的滞留记录，未超限原样', () => {
  const o = new Orchestration()
  for (let i = 0; i < 500; i++) o.currentMap.set(`c${i}`, { childId: `c${i}`, updatedAt: 1000 + i })
  o.enforceCurrentCap()
  assert.equal(o.currentMap.size, 500)
  assert.ok(o.currentMap.has('c0'), '未超限不淘汰')
  o.currentMap.set('c500', { childId: 'c500', updatedAt: 1500 })
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    o.enforceCurrentCap()
  } finally {
    console.warn = origWarn
  }
  assert.equal(o.currentMap.size, 500, '超限后回落到上限')
  assert.equal(o.currentMap.has('c0'), false, 'updatedAt 最旧者被淘汰')
  assert.ok(o.currentMap.has('c500'))
  assert.equal(warnings.length, 1, '淘汰留痕 console.warn')
  assert.ok(warnings[0].includes('currentMap cap'))
})

test('beginSpawning 路径闸生效：连发超限后 currentMap 稳定在上限', () => {
  const o = new Orchestration()
  for (let i = 0; i < 501; i++) o.beginSpawning('hermes', 't')
  assert.equal(o.currentMap.size, 500)
})

test('pruneLedgerParents：超量按桶内最新 updatedAt 保留最近桶', () => {
  assert.deepEqual(pruneLedgerParents(undefined), {})
  assert.deepEqual(pruneLedgerParents('nope'), {})
  const mk = (id, latest) => ({ [id]: [{ childId: id, agentType: 'hermes', updatedAt: latest }] })
  const parents = { ...mk('a', 100), ...mk('b', 300), ...mk('c', 200) }
  const kept = pruneLedgerParents(parents, 2)
  assert.deepEqual(Object.keys(kept).sort(), ['b', 'c'], '按桶内最新 updatedAt 保留最近 2 桶，a 整桶淘汰')
  assert.deepEqual(pruneLedgerParents(parents, 5), parents, '未超限原样返回')
  const withDirty = { ...mk('a', 100), ...mk('b', 300), empty: [], dirty: 'x', ...mk('c', 200) }
  const kept2 = pruneLedgerParents(withDirty, 2)
  assert.deepEqual(Object.keys(kept2).sort(), ['b', 'c'], '空桶与非数组桶不参与计数')
  const kept3 = pruneLedgerParents({ ...mk('a', 100), x: [{ childId: 'x', agentType: 'hermes' }] }, 1)
  assert.deepEqual(kept3, mk('a', 100), '缺失 updatedAt 视为 0，最旧被淘汰')
})

// ── 二期 2.2 泳道化（read-pool-semantics.md §一；D7/D8/D5 已裁决） ─────────────

test('laneOf 判定表：explore/librarian→read，其余含 looker/自定义/未知→write（D7/D8）', () => {
  assert.equal(laneOf('explore'), 'read')
  assert.equal(laneOf('librarian'), 'read')
  for (const t of ['hermes', 'hephaestus', 'prometheus', 'oracle', 'looker']) {
    assert.equal(laneOf(t), 'write', `${t} 归写 lane`)
  }
  assert.equal(laneOf('my-custom-role'), 'write', '自定义角色恒写 lane 且不可配（D8）')
  assert.equal(laneOf(undefined), 'write', '未知/缺名一律写 lane 兜底')
  assert.equal(laneOf(''), 'write')
})

test('beginSpawning 写入 lane 且 extra 不可越权覆盖（D8 泳道归属不可配）', () => {
  const o = new Orchestration()
  const readRec = o.beginSpawning('explore', 't')
  assert.equal(readRec.lane, 'read')
  const writeRec = o.beginSpawning('hermes', 't', { lane: 'read' })
  assert.equal(writeRec.lane, 'write', 'extra 注入的 lane 被强制重算纠正')
  // lane 随记录全链路存续（重派继承 / 挪史 / 回槽均经 {...record}）
  o.bindChild(writeRec.childId, 'sess-w')
  assert.equal(o.currentMap.get('sess-w').lane, 'write')
  o.finish('sess-w', 'done')
  assert.equal(o.history[0].lane, 'write')
})

test('并行容量与泳道隔离：read 满池只冻 read，write 恒 1 独立成闸', () => {
  const o = new Orchestration({ readCapacity: 2 })
  o.beginSpawning('explore', 'a')
  assert.equal(o.isLaneFree('read'), true)
  assert.equal(o.isBusy(), false, 'read 在飞 1（未满）、write 空 → 并行是设计内状态，不是忙（新语义关键差异点）')
  o.beginSpawning('librarian', 'b')
  assert.equal(o.isLaneFree('read'), false, 'read 在飞 2 = 满池')
  assert.equal(o.isLaneFree('write'), true, 'read 满不冻 write（泳道隔离）')
  assert.equal(o.isBusy(), true, 'read 满池 → 任何 lane 满 → 忙')
  // 变异探针咬点（T3 数据层预演）：写平面恒 1 是地基——capacityOf 若随 readCapacity
  // 联动，两条写平面记录会被误判「未满」，单线锁架空
  const w = new Orchestration({ readCapacity: 2 })
  w.beginSpawning('hermes', 'w1')
  w.beginSpawning('prometheus', 'w2')
  assert.equal(w.isLaneFree('write'), false, '写平面第二条即满（capacityOf(write) 恒 1）')
  assert.equal(w.isBusy(), true, '写平面占用 → 忙')
  assert.equal(w.laneCount('read'), 0)
  assert.equal(w.laneCount('write'), 2)
})

test('默认容量 1 下 isBusy 与旧 size>0 语义逐点等价（readPoolSize ?? 1 = 现状逐字节）', () => {
  const o = new Orchestration()
  assert.equal(o.isBusy(), false)
  const r = o.beginSpawning('explore', 't')
  assert.equal(o.isBusy(), true)
  assert.equal(o.isBusy(), o.currentMap.size > 0)
  o.bindChild(r.childId, 'sess-1')
  // waiting 同样占槽：占槽口径 = 在 currentMap 即占槽，不看 status
  o.suspend('sess-1', { id: 'help-1', childId: 'sess-1', intent: 'execute', content: 'x' })
  assert.equal(o.isBusy(), true)
  assert.equal(o.isBusy(), o.currentMap.size > 0)
  o.finish('sess-1', 'done')
  assert.equal(o.isBusy(), false)
  assert.equal(o.isBusy(), o.currentMap.size > 0)
})

test('revive 带 lane 回槽：字段保持；旧格式台账记录（无 lane）归一化补写', () => {
  const o = new Orchestration()
  const r = o.beginSpawning('librarian', 't')
  o.bindChild(r.childId, 'sess-1')
  o.finish('sess-1', 'done')
  const revived = o.revive('sess-1')
  assert.equal(revived.lane, 'read', '回槽即回原 lane，字段随 {...record} 保持')
  assert.equal(o.laneCount('read'), 1)
  // 旧台账回填（loadLedger 产出的旧格式记录）没有 lane 字段 → revive 归一化，
  // 否则 laneCount 漏统计 write 占用 → isBusy 放行第二个写平面子代（单线锁架空）
  o.history.push({ childId: 'legacy-1', agentType: 'oracle', status: 'done', conclusion: 'x', updatedAt: 1 })
  const revivedLegacy = o.revive('legacy-1')
  assert.equal(revivedLegacy.lane, 'write', '旧格式记录回槽时按 laneOf 归一化')
  assert.equal(o.laneCount('write'), 1)
  assert.equal(o.isBusy(), true)
})

test('laneCount 对无 lane 记录按 laneOf(agentType) 兜底归类（防异常路径架空单线锁）', () => {
  const o = new Orchestration()
  o.currentMap.set('legacy', { childId: 'legacy', agentType: 'prometheus', status: 'running', updatedAt: 1 })
  assert.equal(o.laneCount('write'), 1, '无 lane 字段也必须计入写 lane')
  assert.equal(o.laneCount('read'), 0)
  assert.equal(o.isLaneFree('write'), false)
  assert.equal(o.isBusy(), true, '写平面占用 → 忙（漏计即放行双写，红线）')
})

test('readCapacity 钳制：非法值回落 1（=关闭），>3 钳 3；写池缺省 1 不随读池配置变', () => {
  assert.equal(clampReadCapacity(0), 1)
  assert.equal(clampReadCapacity(-2), 1)
  assert.equal(clampReadCapacity('x'), 1)
  assert.equal(clampReadCapacity(undefined), 1)
  assert.equal(clampReadCapacity(2), 2)
  assert.equal(clampReadCapacity(2.9), 2, '非整向下取整')
  assert.equal(clampReadCapacity(5), 3)
  assert.equal(new Orchestration().capacityOf('read'), 1, '默认 1 = 关闭 = 现状')
  assert.equal(new Orchestration({ readCapacity: 99 }).capacityOf('read'), 3)
  assert.equal(new Orchestration({ readCapacity: 99 }).capacityOf('write'), 1, '写池缺省 1，不被 readCapacity 波及')
  assert.equal(new Orchestration({ readCapacity: 99 }).capacityOf('anything-else'), 1, '未知 lane 名按最保守容量 1')
})

// ── 写池配置化（与读池对称）────────────────────────────────────────────────
test('writeCapacity 钳制：与读池同律（非法回落 1、>3 钳 3）；两池容量互相独立', () => {
  assert.equal(clampWriteCapacity(0), 1, '非法值回落 1 = 写平面恒单线现状')
  assert.equal(clampWriteCapacity(-2), 1)
  assert.equal(clampWriteCapacity('x'), 1)
  assert.equal(clampWriteCapacity(undefined), 1)
  assert.equal(clampWriteCapacity(null), 1)
  assert.equal(clampWriteCapacity(NaN), 1)
  assert.equal(clampWriteCapacity(2), 2)
  assert.equal(clampWriteCapacity(2.9), 2, '非整向下取整')
  assert.equal(clampWriteCapacity(5), 3, '>3 钳 3')
  assert.equal(new Orchestration().capacityOf('write'), 1, '缺省 1 = 关闭 = 写平面恒单线现状')
  assert.equal(new Orchestration({ writeCapacity: 3 }).capacityOf('write'), 3)
  assert.equal(new Orchestration({ writeCapacity: 3 }).capacityOf('read'), 1, 'writeCapacity 不波及读池')
  assert.equal(new Orchestration({ readCapacity: 3, writeCapacity: 3 }).capacityOf('read'), 3)
})

test('写池 3 数据层：写 lane 三条在飞未满、第四条即满；写池满不冻读 lane', () => {
  const o = new Orchestration({ readCapacity: 1, writeCapacity: 3 })
  o.beginSpawning('hermes', 'w1')
  o.beginSpawning('prometheus', 'w2')
  assert.equal(o.isLaneFree('write'), true, '写池 2/3 未满')
  assert.equal(o.isBusy(), false, '两池皆有空位 → 不忙（写池 ≥2 后 size>0 不再是忙判定）')
  o.beginSpawning('hephaestus', 'w3')
  assert.equal(o.laneCount('write'), 3)
  assert.equal(o.isLaneFree('write'), false, '写池 3/3 满——旧口径下第二条写即满')
  assert.equal(o.isLaneFree('read'), true, '写池满不冻读 lane（任一池开启即各 lane 独立计数）')
  assert.equal(o.isBusy(), true, '任一 lane 满 → 忙')
  o.beginSpawning('explore', 'r1')
  assert.equal(o.laneCount('read'), 1)
  assert.equal(o.isLaneFree('read'), false, '读池仍为 1：读 lane 自己满')
})

test('退化等价：write=1+read=1 与旧全局单线逐点等价；write=1+read=3 与写池批次前装机行为等价', () => {
  // 参考实现 = 写池批次前的判定式原文（readCapacity<=1 → 全局单线；写 lane 容量恒 1）
  const refLaneCount = (recs, lane) => recs.filter((r) => (r.lane ?? laneOf(r.agentType)) === lane).length
  const refIsLaneFree = (recs, lane, readCap) => {
    if (readCap <= 1) return recs.length === 0
    const cap = lane === 'read' ? readCap : 1
    return refLaneCount(recs, lane) < cap
  }
  // 状态矩阵：空 / 读1 / 写1 / 读满 / 写2 / 读写各1 / 写3
  const shapes = [
    [],
    [['explore']],
    [['hermes']],
    [['explore'], ['librarian'], ['explore']],
    [['hermes'], ['prometheus']],
    [['explore'], ['hermes']],
    [['hermes'], ['prometheus'], ['hephaestus']],
  ]
  for (const readCap of [1, 2, 3]) {
    for (const shape of shapes) {
      const o = new Orchestration({ readCapacity: readCap, writeCapacity: 1 })
      for (const [type, ...rest] of shape) o.beginSpawning(type, 't', ...rest)
      const recs = [...o.currentMap.values()]
      for (const lane of ['read', 'write']) {
        assert.equal(
          o.isLaneFree(lane), refIsLaneFree(recs, lane, readCap),
          `readCap=${readCap} 形态=${JSON.stringify(shape)} lane=${lane}：写池缺省 1 下与改造前同点同判`,
        )
      }
      assert.equal(o.capacityOf('write'), 1, '写池缺省 = 恒单线容量')
      // 两池皆 1 = 双池皆关 = 全局单线：两条判定线都必须退化为「全局空才 free」
      if (readCap === 1) {
        assert.equal(o.isLaneFree('read'), recs.length === 0, 'readCap=1+writeCap=1 → 全局单线')
        assert.equal(o.isLaneFree('write'), recs.length === 0, 'readCap=1+writeCap=1 → 全局单线')
        assert.equal(o.isBusy(), recs.length > 0, '两池皆 1 → isBusy 与旧 size>0 逐点等价')
      }
    }
  }
  // 显式双 1 与缺省构造同判（装机新态 writePoolSize 显式 1 的退化面）
  const explicit = new Orchestration({ readCapacity: 1, writeCapacity: 1 })
  explicit.beginSpawning('hermes', 'w')
  assert.equal(explicit.isLaneFree('read'), false, '显式双 1 = 全局单线（write 占用时 read 不上岗）')
  assert.equal(explicit.isBusy(), true)
})

test('退化口径（D5 默认关 = 全局单线）：容量 1 下 write 占用时 read 不得放行', () => {
  const o = new Orchestration()
  const r = o.beginSpawning('hermes', 't')
  assert.equal(o.isLaneFree('write'), false)
  assert.equal(o.isLaneFree('read'), false, '容量 1 = 全局单线：write 占用时 read 也不上岗（否则默认配置派生跨 lane 并行，违背逐字节现状）')
  assert.equal(o.isLaneFree('read'), o.currentMap.size === 0, '退化口径 = 全局空才 free')
  o.abort(r.childId)
  assert.equal(o.isLaneFree('read'), true)
  assert.equal(o.isLaneFree('write'), true)
  // 对照组：容量 ≥2 时泳道各自计数，write 占用不冻 read
  const p = new Orchestration({ readCapacity: 2 })
  p.beginSpawning('hermes', 't')
  assert.equal(p.isLaneFree('read'), true, '容量 2 下 write 占用不冻 read（并行设计内）')
  assert.equal(p.isLaneFree('write'), false)
})

test('dequeueById 按 id 精确出队：序不重排、未知 id 无害', () => {
  const o = new Orchestration()
  const w1 = o.enqueue('hermes', 'a', 'p')
  const w2 = o.enqueue('explore', 'b', 'p')
  const w3 = o.enqueue('librarian', 'c', 'p')
  let emitted = 0
  o.onChange(() => { emitted += 1 })
  const picked = o.dequeueById(w2)
  assert.equal(picked.id, w2, '按 id 取出中间元素（lane-aware skip 语义）')
  assert.deepEqual(o.queue.map((w) => w.id), [w1, w3], '其余 work 原地保留、相对序不变')
  assert.equal(emitted, 1, '与 dequeue() 同款 emit')
  assert.equal(o.dequeueById('work-none'), undefined, '未知 id 无害返回 undefined')
  assert.equal(o.queue.length, 2)
})

// ── 复活预占的原子性（先占后断言）────────────────────────────────────────────
// 病灶：reserveRevival 原先是「先 isLaneFree 再 set」两步——同一 tick 内两个不同
// childId 的复活会双双看到最后一个空位并双双通过，复活完 lane 里挤进 cap+1 条。
test('reserveRevival 同 tick 双复活受容量约束：后到者必被拒，lane 占用不超容', () => {
  const o = new Orchestration({ readCapacity: 3, writeCapacity: 1 })
  // 已有一条读记录在飞 → 读池 1/3，只剩 2 个空位
  const running = o.beginSpawning('explore', '在飞')
  assert.equal(o.laneCount('read'), 1)
  // 同 tick 连续三次复活预占（无 await、无交错）：只有两条能过
  const r1 = o.reserveRevival('done-1', 'read')
  const r2 = o.reserveRevival('done-2', 'read')
  const r3 = o.reserveRevival('done-3', 'read')
  assert.equal(typeof r1, 'function', '第一个预占成立（读池 2/3）')
  assert.equal(typeof r2, 'function', '第二个预占成立（读池 3/3）')
  assert.equal(r3, undefined, '第三个同 tick 预占被容量拒绝——查-占两步竞态的现场')
  assert.equal(o.laneCount('read'), 3, 'laneCount 恰为容量，不超容')
  assert.equal(o.isLaneFree('read'), false)
  assert.equal(o.revivalReservations.size, 2, '被拒者不留预占残渣')
  // 归还一条后可再预占（拒绝不是永久性的）
  r1()
  assert.equal(typeof o.reserveRevival('done-3', 'read'), 'function', '空位归还后同一 childId 可再预占')
  assert.equal(o.laneCount('read'), 3, '再次回到容量上限')
  assert.equal(o.laneCount('write'), 0, '读池预占不污染写 lane')
  assert.ok(o.currentMap.has(running.childId))
})

test('reserveRevival 同一 childId 二次预占被拒（防重复计槽），写入不重复', () => {
  const o = new Orchestration({ writeCapacity: 2 })
  const first = o.reserveRevival('done-1', 'write')
  assert.equal(typeof first, 'function')
  assert.equal(o.reserveRevival('done-1', 'write'), undefined, '同一 childId 已在复活中 → 拒绝')
  assert.equal(o.revivalReservations.size, 1)
  assert.equal(o.laneCount('write'), 1)
})

// 交接窗口：revive 把记录搬回 currentMap 时预占可能还挂着（归还前的一拍）。
// 同一 childId 同时出现在两处只能算 1 槽——否则读数是「重复计槽」而非「多占槽」，
// 会让 isLaneFree 在交接窗口内误判满池，把本该上岗的排队任务冻住。
test('laneCount 对已在 currentMap 的 childId 跳过其预占：交接窗口内同一子代只算一槽', () => {
  const o = new Orchestration({ readCapacity: 2, writeCapacity: 1 })
  const rec = o.beginSpawning('librarian', 't')
  o.bindChild(rec.childId, 'sess-1')
  o.finish('sess-1', 'done')
  assert.equal(o.laneCount('read'), 0, '完工落史即释放读槽')
  const free = o.reserveRevival('sess-1', 'read')
  assert.equal(typeof free, 'function')
  assert.equal(o.laneCount('read'), 1, '仅预占：算 1 槽')
  o.revive('sess-1')
  assert.equal(o.currentMap.has('sess-1'), true)
  assert.equal(o.revivalReservations.has('sess-1'), true, '预占尚未归还（交接窗口）')
  assert.equal(o.laneCount('read'), 1, '同一 childId 跨两处只算一槽（重复计槽会误报满池）')
  assert.equal(o.isLaneFree('read'), true, '读池 1/2：交接窗口不得把自己算成 2/2')
  free()
  assert.equal(o.laneCount('read'), 1, '归还预占后口径不变（记录接管那一槽）')
  assert.equal(o.isLaneFree('read'), true)
  // 不同 childId 的预占照常叠加（跳过只针对同一 id，不放宽容量）
  assert.equal(typeof o.reserveRevival('other-done', 'read'), 'function')
  assert.equal(o.laneCount('read'), 2)
  assert.equal(o.isLaneFree('read'), false, '另一条子代确占第二槽 → 满池')
})
