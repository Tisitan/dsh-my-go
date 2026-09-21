/**
 * dsh-my-go — persisted session-archive readers (both halves).
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * node: builtins are fine.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { normalizeTurnFailure } from './failure.mjs'
import { sessionsHome } from './paths.mjs'

// ── 失败附因：持久化档案读取（0.2.3-tisitan.9）────────────────────────────────
// 根因：continuable Activation 的销毁顺序（dsh-subagent/lib/types/continuation.js
// ~L1016-1050）是先 dispose 子 session（连带从 sessions live store 摘除）、删
// activation，最后 observer.settle() 才发射 subagent/end——end 处理器读 live
// store 必然落空，附因永远丢失（0.2.3-tisitan.8 实锤：failed 记录只有 '(error)'）。
// 主路径改读持久化档案，live 读法保留为快路径。
// 档案目录规则与 dsh-session-persistence-jsonl 完全一致（行号以 npm 检出
// @deepseek-ai/dsh 为准）：
//   root     = <DSH_HOME>/sessions（home 解析：dsh-home-paths/lib/index.js:73，
//              DSH_HOME 缺省 join(homedir(), '.dsh')）
//   项目目录 = root/<projectKey(cwd)>           （lib/index.js:106-124, 133-136）
//   会话目录 = 项目目录/<encodeSegment(childId)>（lib/index.js:84-96, 145-147）
//   日志文件 = 会话目录/<档案名>                （lib/index.js:156-158；档案名按格式
//              代版本变化，见下方 SESSION_ARCHIVE_NAME_RE，写死单名会全灭）
const ZSTD_FRAME_MAGIC = 0xfd2fb528

// 档案文件名按 Session 格式「代版本」命名，不是固定名：宿主
// dsh-session-format/lib/index.js:472-475 `sessionFormatLogFilename(version)` 对
// version===0 返回 `session.jsonl`，其余返回 `session.v${version}.jsonl`；再由
// dsh-session-persistence-jsonl/lib/index.js:745-763 `generationLogFilename` 拼压缩
// 后缀（zstd → `.zstd`）。宿主现行 SESSION_FORMAT_VERSION=3（dsh-session/lib/
// index.js:56），故生产档案实为 `session.v3.jsonl.zstd`；`session.jsonl.zstd` 是
// v0 无版本后缀旧名。此前本模块写死 v0 名 ⇒ 按 childId 定位生产档案永远不命中
// （0.5.0-tisitan.4 修复：改「候选枚举」，现行名优先、旧名兜底，且天然兼容
// 未来代升级）。规范名判据与宿主 parseGenerationLogFilename 一致：小写、无
// 前导零、无 v0 标记、非临时文件。
export const SESSION_ARCHIVE_NAME_RE = /^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$/
// 现行代档案名：仅用于「未命中」时报错文案里的期望路径（真实定位走上面的枚举）。
export const SESSION_ARCHIVE_CURRENT_NAME = 'session.v3.jsonl.zstd'
// v0 旧档名：同上，仅文案用；命中与否一律由 SESSION_ARCHIVE_NAME_RE 枚举决定。
export const SESSION_ARCHIVE_LEGACY_NAME = 'session.jsonl.zstd'

// projectKey：与 dsh-session-persistence-jsonl/lib/index.js:106-124 同算法。
// 分隔符与盘符冒号折叠成单个 '-'，不安全码位转义 ~XXXX，'--...--' 包裹并截断
// 251 码元（故意有损，人类可导航优先）。
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

// encodeSegment：与同文件 :84-96 同算法，把 session id 编码成单安全路径段
// （UUID 恒为恒等映射；'.'/'..' 与不安全码位转义防目录穿越）。
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

// scanZstdFrameRanges：与同文件 scanZstdFrames(:503-566) 同算法（裁掉 torn
// 修复分支）。会话档案是多 zstd 帧追加容器，Node 的 zlib 单帧接口
// 只吃首帧，必须先扫描出完整帧界再逐帧解压；末帧不完整（追加写到一半）时截断，
// 只读已完整的帧。
export function scanZstdFrameRanges(buffer) {
  const ranges = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break // 截断的末帧头
    if (buffer.readUInt32LE(offset) !== ZSTD_FRAME_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerBytes) break
    offset += headerBytes
    let complete = true
    for (;;) {
      if (buffer.length - offset < 3) { complete = false; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { complete = false; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!complete) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    ranges.push({ start, end: offset })
  }
  return ranges
}

// 兜底搜索（0.2.3-tisitan.16b）：枚举 root 下全部项目目录，找
// <项目目录>/<encodeSegment(childId)> 下任一规范档案名存在的候选；多命中
// 取 mtime 最新。单个项目目录的 readdir/stat 失败（权限/竞态删除）跳过，
// 不挡全局搜索。返回 { projectDir, logFile, version, mtimeMs } 或 undefined。
export function findArchivedLogByChildId(root, childId) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  const segment = encodeSegment(childId)
  let best
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = selectArchiveLog(join(root, entry.name, segment))
    if (!found) continue
    if (!best || found.mtimeMs > best.mtimeMs) {
      best = { projectDir: entry.name, ...found }
    }
  }
  return best
}

// selectArchiveLog：在一个会话目录内枚举规范档案名候选（正则见
// SESSION_ARCHIVE_NAME_RE 注释），取版本最高的一代——同目录并存的低代文件是
// 宿主格式迁移遗留，非可信数据源；同版本再取 mtime 最新。目录不存在/不可读
// → undefined（调用方按未命中处理）。
export function selectArchiveLog(sessionDir) {
  let names
  try {
    names = readdirSync(sessionDir)
  } catch {
    return undefined
  }
  let best
  for (const name of names) {
    const match = SESSION_ARCHIVE_NAME_RE.exec(name)
    if (!match) continue
    const version = match[1] === undefined ? 0 : Number(match[1])
    const logFile = join(sessionDir, name)
    let stat
    try {
      stat = statSync(logFile)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (!best || version > best.version || (version === best.version && stat.mtimeMs > best.mtimeMs)) {
      best = { logFile, version, mtimeMs: stat.mtimeMs }
    }
  }
  return best
}

// readArchivedTurnFailure：持久化档案主路径。倒序逐帧解压（最新帧最先），帧内
// 倒序扫行，取最后一条 turn/end 且 reason.kind==='error' 的 reason.error，经
// normalizeTurnFailure 归一为 {message, code?, status?}（fallback 备选链 step-2
// 结构化契约）。找不到档案/解压失败/无 error 事件均静默退回 undefined 并
// console.warn 留痕（可观测性，不静默吞）。options.root / options.cwd 供测试
// 注入；缺省按 DSH_HOME 惯例与 process.cwd() 解析。
// 0.2.3-tisitan.16b：dsh web 宿主进程 cwd 与用户工作区不一致时 projectKey(cwd) 解析
// 错项目目录，档案永远找不到（生产上「未读到附因」从未成功过）。默认路径不可
// 读时兜底按 childId 全局搜索 root 下各项目目录（多命中取 mtime 最新）。
export function readArchivedTurnFailure(childId, options = {}) {
  const root = options.root ?? sessionsHome()
  const cwd = options.cwd ?? process.cwd()
  const defaultDir = join(root, projectKey(cwd), encodeSegment(childId))
  let logFile = selectArchiveLog(defaultDir)?.logFile ?? join(defaultDir, SESSION_ARCHIVE_CURRENT_NAME)
  let buffer
  try {
    buffer = readFileSync(logFile)
  } catch (error) {
    const found = findArchivedLogByChildId(root, childId)
    if (!found) {
      console.warn(`[dsh-my-go] readTurnFailure: 持久化档案不可读 ${logFile}（${String(error?.code ?? error)}），静默退回无附因`)
      return undefined
    }
    console.warn(`[dsh-my-go] readTurnFailure: 默认项目目录未命中，兜底搜索命中项目目录 ${found.projectDir}，改读 ${found.logFile}`)
    logFile = found.logFile
    try {
      buffer = readFileSync(logFile)
    } catch (fallbackError) {
      console.warn(`[dsh-my-go] readTurnFailure: 兜底命中档案不可读 ${logFile}（${String(fallbackError?.code ?? fallbackError)}），静默退回无附因`)
      return undefined
    }
  }
  let ranges
  try {
    ranges = scanZstdFrameRanges(buffer)
  } catch (error) {
    console.warn(`[dsh-my-go] readTurnFailure: 档案帧扫描失败 ${logFile}（${String(error)}），静默退回无附因`)
    return undefined
  }
  for (let i = ranges.length - 1; i >= 0; i--) {
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(ranges[i].start, ranges[i].end)).toString('utf-8')
    } catch (error) {
      console.warn(`[dsh-my-go] readTurnFailure: 档案第 ${i} 帧解压失败 ${logFile}（${String(error)}），静默退回无附因`)
      return undefined
    }
    const lines = text.split('\n')
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j]
      if (!line || !line.includes('"turn/end"')) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue /* 截断的末行：跳过 */ }
      if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'error') {
        const failure = normalizeTurnFailure(ev.data.reason.error)
        if (failure) return failure
      }
    }
  }
  console.warn(`[dsh-my-go] readTurnFailure: 档案 ${logFile} 内无 turn/end error 事件，静默退回无附因`)
  return undefined
}

// readArchivedUsage: archive main path for the usage aggregator (contract D2,
// docs/usage-stats-design.md). Same family as readArchivedTurnFailure —
// root/cwd resolution, findArchivedLogByChildId fallback, per-frame zstd
// decompression, per-line JSON parse. Returns { events, complete }:
//   events   — log-order entries with seq >= fromSeq (inclusive lower bound,
//              matching Session.snapshotEvents semantics, index.d.ts:184)
//   complete — false marks a partial scan: unreadable archive, frame scan
//              failure, any frame or line skipped, or a torn append tail
//              (D2 partial definition covers exactly these). A single bad
//              frame never fails the whole read (Z6/Z7) — the caller turns
//              complete=false into child partial, never an error, so this
//              function never throws.
export function readArchivedUsage(childId, fromSeq, options = {}) {
  const noEvents = { events: [], complete: false }
  const root = options.root ?? sessionsHome()
  const cwd = options.cwd ?? process.cwd()
  const defaultDir = join(root, projectKey(cwd), encodeSegment(childId))
  let logFile = selectArchiveLog(defaultDir)?.logFile ?? join(defaultDir, SESSION_ARCHIVE_CURRENT_NAME)
  let buffer
  try {
    buffer = readFileSync(logFile)
  } catch (error) {
    const found = findArchivedLogByChildId(root, childId)
    if (!found) {
      console.warn(`[dsh-my-go] readArchivedUsage: 持久化档案不可读 ${logFile}（${String(error?.code ?? error)}），本次扫描按不完整处理`)
      return noEvents
    }
    logFile = found.logFile
    try {
      buffer = readFileSync(logFile)
    } catch (fallbackError) {
      console.warn(`[dsh-my-go] readArchivedUsage: 兜底命中档案不可读 ${logFile}（${String(fallbackError?.code ?? fallbackError)}），本次扫描按不完整处理`)
      return noEvents
    }
  }
  let ranges
  try {
    ranges = scanZstdFrameRanges(buffer)
  } catch (error) {
    console.warn(`[dsh-my-go] readArchivedUsage: 档案帧扫描失败 ${logFile}（${String(error)}），本次扫描按不完整处理`)
    return noEvents
  }
  const floor = typeof fromSeq === 'number' && Number.isFinite(fromSeq) && fromSeq > 0 ? fromSeq : 0
  const events = []
  let complete = true
  for (let i = 0; i < ranges.length; i++) {
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(ranges[i].start, ranges[i].end)).toString('utf-8')
    } catch (error) {
      console.warn(`[dsh-my-go] readArchivedUsage: 档案第 ${i} 帧解压失败 ${logFile}（${String(error)}），跳过该帧继续扫`)
      complete = false
      continue
    }
    for (const line of text.split('\n')) {
      if (!line) continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        console.warn(`[dsh-my-go] readArchivedUsage: 档案第 ${i} 帧存在截断/损坏行，跳过该行继续扫`)
        complete = false
        continue
      }
      if (typeof ev?.seq === 'number' && Number.isFinite(ev.seq) && ev.seq >= floor) events.push(ev)
    }
  }
  // Torn append tail: scanZstdFrameRanges already cut the incomplete last
  // frame, so leftover bytes mean the newest frame is still being written —
  // this snapshot is missing it, hence partial rather than a clean empty scan.
  const tailEnd = ranges.length > 0 ? ranges[ranges.length - 1].end : 0
  if (tailEnd < buffer.length) complete = false
  return { events, complete }
}
