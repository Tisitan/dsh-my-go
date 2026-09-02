// dump-session 取证 CLI 单测（0.2.3-tisitan.16c）：zstdCompressSync 合成多帧档案
// hermetic 验证——摘要规则、逐帧事件流、末帧截断容错、解压全灭非零语义、
// childId 全项目目录搜索定位。零外部依赖，不读真实 sessions 目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { summarizeEvent, dumpArchive, locateArchive } from '../scripts/dump-session.mjs'

// 合成多帧 session.jsonl.zstd：每个元素一帧，帧内元素各占一行。
function writeArchive(dir, frames, { tail = '' } = {}) {
  const file = join(dir, 'session.jsonl.zstd')
  const parts = frames.map((lines) => zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')))
  writeFileSync(file, Buffer.concat([...parts, Buffer.isBuffer(tail) ? tail : Buffer.from(tail)]))
  return file
}

test('summarizeEvent：request/header 打 provider/model，缺字段打 ?', () => {
  assert.equal(
    summarizeEvent({ type: 'request/header', data: { header: { config: { provider: 'prov-a', model: 'model-x' } } } }),
    'provider=prov-a model=model-x',
  )
  assert.equal(summarizeEvent({ type: 'request/header', data: {} }), 'provider=? model=?')
})

test('summarizeEvent：llm/retry 打 retry 序号，failure.message 折叠截断 120', () => {
  const long = 'x'.repeat(200) + '\n第二行'
  const out = summarizeEvent({ type: 'llm/retry', data: { retry: 2, maxRetries: 5, failure: { message: long } } })
  assert.match(out, /^retry=2\/5 failure=/, '打 retry 序号与上限')
  const failure = out.slice('retry=2/5 failure='.length)
  assert.ok(failure.length <= 121, `截断到 120+省略号，实际 ${failure.length}`)
  assert.ok(!failure.includes('\n'), '多行折叠成单行')
})

test('summarizeEvent：turn/end 打 reason.kind 与 error.message 前 200 字', () => {
  const out = summarizeEvent({
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'error', error: { message: 'y'.repeat(300) } } },
  })
  assert.match(out, /^kind=error error=y+…$/, 'error 截断带省略号')
  assert.equal(summarizeEvent({ type: 'turn/end', data: { reason: { kind: 'done' } } }), 'kind=done', '无 error 不追加')
})

test('summarizeEvent：assistant/chunk 打 chunk.type；tool 类打工具名；其余空串', () => {
  assert.equal(summarizeEvent({ type: 'assistant/chunk', data: { chunk: { type: 'text' } } }), 'chunk=text')
  assert.equal(summarizeEvent({ type: 'tool/call', data: { name: 'pwsh' } }), 'name=pwsh')
  assert.equal(summarizeEvent({ type: 'tool/result', data: { message: { isError: true } } }), 'isError=true')
  assert.equal(summarizeEvent({ type: 'session/title', data: { title: 't' } }), '')
  assert.equal(summarizeEvent({ type: 'session' }), '')
  assert.equal(summarizeEvent(undefined), '')
})

test('dumpArchive：合成两帧档案逐事件输出摘要，顺序与计数正确', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dump-session-'))
  const file = writeArchive(dir, [
    [{ type: 'session', id: 'child-1' }, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }],
    [
      { type: 'request/header', seq: 1, time: 2, data: { header: { config: { provider: 'prov-a', model: 'model-x' } } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'pwsh' } },
    ],
  ])
  const { lines, frames, events } = dumpArchive(file)
  assert.equal(frames, 2)
  assert.equal(events, 4)
  assert.deepEqual(lines, [
    '#- session',
    '#0 turn/start',
    '#1 request/header provider=prov-a model=model-x',
    '#2 tool/call name=pwsh',
  ])
})

test('dumpArchive：末帧截断容错——跳过不完整尾部并 warn，完整帧事件不受影响', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dump-session-'))
  const file = writeArchive(dir, [
    [{ type: 'turn/end', seq: 9, time: 1, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } } }],
  ], { tail: Buffer.of(0x28, 0xb5, 0x2f) }) // 帧魔数写到一半：扫帧器截断，dump 层应 warn 而非判死
  const warnings = []
  const { lines, frames } = dumpArchive(file, (m) => warnings.push(m))
  assert.equal(frames, 1)
  assert.deepEqual(lines, ['#9 turn/end kind=error error=boom'])
  assert.ok(warnings.some((m) => m.includes('末帧截断')), `应 warn 截断尾部，实际 ${JSON.stringify(warnings)}`)
})

test('dumpArchive：帧内损坏行 warn 跳过，不挡同行其余事件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dump-session-'))
  const good = JSON.stringify({ type: 'step/start', seq: 3, time: 1, data: { turn: 1, step: 1 } })
  const file = join(dir, 'session.jsonl.zstd')
  writeFileSync(file, zstdCompressSync(Buffer.from(good + '\n{"type":"truncat\n' + good + '\n')))
  const warnings = []
  const { lines } = dumpArchive(file, (m) => warnings.push(m))
  assert.deepEqual(lines, ['#3 step/start', '#3 step/start'])
  assert.ok(warnings.some((m) => m.includes('损坏行')), `应 warn 损坏行，实际 ${JSON.stringify(warnings)}`)
})

test('dumpArchive：档案不可读 / 无完整帧 → 抛错（CLI 转非零退出码）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dump-session-'))
  assert.throws(() => dumpArchive(join(dir, 'missing.zstd')), /档案不可读/)
  const garbage = join(dir, 'garbage.zstd')
  writeFileSync(garbage, Buffer.from('not a zstd container at all'))
  assert.throws(() => dumpArchive(garbage), /解压全灭|帧扫描失败/)
})

test('locateArchive：childId 全项目目录搜索命中 / 未命中', () => {
  const root = mkdtempSync(join(tmpdir(), 'dump-session-root-'))
  const projectDir = join(root, '--proj-a--')
  mkdirSync(join(projectDir, 'child-1'), { recursive: true })
  writeArchive(join(projectDir, 'child-1'), [[{ type: 'session', id: 'child-1' }]])
  const found = locateArchive('child-1', root)
  assert.ok(found, '应命中')
  assert.equal(found.projectDir, '--proj-a--')
  assert.ok(found.logFile.endsWith('session.jsonl.zstd'))
  assert.equal(locateArchive('child-nope', root), undefined, '未命中返回 undefined')
})
