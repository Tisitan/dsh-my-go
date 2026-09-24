// dump-session 取证 CLI 单测（0.2.3-tisitan.16c）：zstdCompressSync 合成多帧档案
// hermetic 验证——摘要规则、逐帧事件流、末帧截断容错、解压全灭非零语义、
// childId 全项目目录搜索定位（档案名按 Session 格式代枚举：现行 v4 / 旧档 v0）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { summarizeEvent, dumpArchive, locateArchive } from '../scripts/dump-session.mjs'
import { readArchivedTurnFailure, selectArchiveLog, SESSION_ARCHIVE_CURRENT_NAME, SESSION_ARCHIVE_LEGACY_NAME } from '../preset/shared/archive.mjs'

// 合成多帧会话档案：每个元素一帧，帧内元素各占一行。缺省写现行代名
// session.v4.jsonl.zstd（宿主 SESSION_FORMAT_VERSION=4），旧档兼容用例显式传 name。
function writeArchive(dir, frames, { tail = '', name = SESSION_ARCHIVE_CURRENT_NAME } = {}) {
  const file = join(dir, name)
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

test('summarizeEvent：assistant/chunk 打 chunk.type；tool/call 打工具名；v3 旧档 tool/result 走 wrapper 兜底；其余空串', () => {
  assert.equal(summarizeEvent({ type: 'assistant/chunk', data: { chunk: { type: 'text' } } }), 'chunk=text')
  assert.equal(summarizeEvent({ type: 'tool/call', data: { name: 'pwsh' } }), 'name=pwsh')
  // v3 旧档兼容分支（本机仍有 395 份 v3 档案在读）：isError 挂在 message.content[0]
  // 的 tool-result 块上、message 顶层没有该键——顶层缺席时回落此处。
  assert.equal(summarizeEvent({ type: 'tool/result', data: { message: { content: [{ type: 'tool-result', isError: true }] } } }), 'isError=true')
  assert.equal(summarizeEvent({ type: 'tool/result', data: { message: { content: [{ type: 'tool-result' }] } } }), 'isError=false', '成功调用照常 false')
  assert.equal(summarizeEvent({ type: 'session/title', data: { title: 't' } }), '')
  assert.equal(summarizeEvent({ type: 'session' }), '')
  assert.equal(summarizeEvent(undefined), '')
})

test('summarizeEvent：tool/result 采信 V4 一等消息的顶层 isError（生产实形）', () => {
  // 宿主 0.1.7-alpha.2 的 createToolResultMessage（dsh-llm/lib/index.js:101-112）
  // 产出 { role:'tool', source:{kind:'tool',callId}, toolCallId, content, isError }
  // ——isError 在**消息顶层**；content[0] 是普通文本块，旧 tool-result wrapper 已被
  // v4 迁移链明令拒收。真机全量扫描：v4 档案的 tool/result 全走此形状（wrapper 零命中）。
  assert.equal(
    summarizeEvent({ type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'denied' }], isError: true } } }),
    'isError=true',
    'v4 顶层 isError=true 必须被采信（只读 wrapper 会把被拒调用全记成 false）',
  )
  assert.equal(
    summarizeEvent({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'ok' }], isError: false } } }),
    'isError=false',
    '成功调用照常 false',
  )
  assert.equal(summarizeEvent({ type: 'tool/result', data: { message: { content: [] } } }), 'isError=false', 'isError 键缺席（成功调用可省）不炸')
  assert.equal(summarizeEvent({ type: 'tool/result', data: { message: {} } }), 'isError=false', 'content 缺席不炸')
  assert.equal(summarizeEvent({ type: 'tool/result', data: {} }), 'isError=false', 'message 缺席不炸')
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
  const file = join(dir, SESSION_ARCHIVE_CURRENT_NAME)
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

// 档案名定位族：宿主 Session 档案名按格式代版本命名（v0 = session.jsonl.zstd，
// vN = session.vN.jsonl.zstd，现行 v4），生产上只有现行名 —— 写死旧名会让
// childId 定位全灭（tisitan.17 修复）。以下逐面覆盖：现行名命中 / 旧名兜底 /
// 同目录多代并存取最高代 / 跨项目目录多命中取 mtime 最新 / 全不存在。
function makeRoot(...projectDirs) {
  const root = mkdtempSync(join(tmpdir(), 'dump-session-root-'))
  for (const p of projectDirs) mkdirSync(join(root, p), { recursive: true })
  return root
}

test('locateArchive：现行 v4 档案名能定位（生产实形）', () => {
  const root = makeRoot('--proj-a--')
  const dir = join(root, '--proj-a--', 'child-1')
  mkdirSync(dir, { recursive: true })
  writeArchive(dir, [[{ type: 'session', id: 'child-1' }]])
  const found = locateArchive('child-1', root)
  assert.ok(found, '现行名应命中')
  assert.equal(found.projectDir, '--proj-a--')
  assert.equal(found.logFile, join(dir, SESSION_ARCHIVE_CURRENT_NAME))
  assert.equal(found.version, 4, '档案代随文件名解析出来')
})

test('locateArchive：旧档 session.jsonl.zstd 兜底能定位（v0 语义）', () => {
  const root = makeRoot('--proj-b--')
  const dir = join(root, '--proj-b--', 'child-old')
  mkdirSync(dir, { recursive: true })
  writeArchive(dir, [[{ type: 'session', id: 'child-old' }]], { name: SESSION_ARCHIVE_LEGACY_NAME })
  const found = locateArchive('child-old', root)
  assert.ok(found, '旧名应兜底命中')
  assert.equal(found.logFile, join(dir, SESSION_ARCHIVE_LEGACY_NAME))
  assert.equal(found.version, 0)
})

test('selectArchiveLog：同目录多代并存取版本最高，不被旧迁移遗留误导', () => {
  const dir = join(makeRoot('--proj-c--'), '--proj-c--', 'child-dup')
  mkdirSync(dir, { recursive: true })
  writeArchive(dir, [[{ type: 'session', id: 'legacy' }]], { name: SESSION_ARCHIVE_LEGACY_NAME })
  writeArchive(dir, [[{ type: 'session', id: 'v1' }]], { name: 'session.v1.jsonl.zstd' })
  const current = writeArchive(dir, [[{ type: 'session', id: 'v4' }]])
  const picked = selectArchiveLog(dir)
  assert.equal(picked.logFile, current, '应选现行 v4')
  assert.equal(picked.version, 4)
  // 非规范名（临时/大写/前导零/明文/其他后缀）一律不采信
  for (const bogus of ['session.v3.jsonl', 'session.V3.jsonl.zstd', 'session.v03.jsonl.zstd', 'session.v0.jsonl.zstd', 'session.jsonl.zstd.tmp']) {
    writeFileSync(join(dir, bogus), Buffer.from('x'))
  }
  assert.equal(selectArchiveLog(dir).logFile, current, '非规范名不得抢位')
})

test('locateArchive：跨项目目录多命中取 mtime 最新（同旧口径）', () => {
  const root = makeRoot('--proj-old--', '--proj-new--')
  for (const [p, stamp] of [['--proj-old--', 2000], ['--proj-new--', 5000]]) {
    const dir = join(root, p, 'hsess-dup')
    mkdirSync(dir, { recursive: true })
    writeArchive(dir, [[{ type: 'session', id: 'hsess-dup' }]])
    utimesSync(dir, 0, stamp)
    utimesSync(join(dir, SESSION_ARCHIVE_CURRENT_NAME), 0, stamp)
  }
  const found = locateArchive('hsess-dup', root)
  assert.equal(found.projectDir, '--proj-new--', '多命中取 mtime 最新')
})

test('locateArchive：档案不存在返回 undefined，CLI/读取器报错文案指向现行名', () => {
  const root = makeRoot('--proj-empty--')
  mkdirSync(join(root, '--proj-empty--', 'child-missing'), { recursive: true })
  assert.equal(locateArchive('child-missing', root), undefined, '未命中返回 undefined')
  assert.equal(locateArchive('child-nope', root), undefined)
  const warnings = []
  const origin = console.warn
  console.warn = (m) => warnings.push(String(m))
  try {
    assert.equal(readArchivedTurnFailure('child-missing', { root, cwd: '/proj-empty' }), undefined)
  } finally {
    console.warn = origin
  }
  assert.ok(
    warnings.some((m) => m.includes(join(root, '--proj-empty--', 'child-missing', SESSION_ARCHIVE_CURRENT_NAME))),
    `报错文案应给现行名期望路径，实际 ${JSON.stringify(warnings)}`,
  )
})
