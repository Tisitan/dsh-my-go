// dsh-my-go — 会话档案取证 CLI（tisitan.16c）。
//
// 用法：
//   node scripts/dump-session.mjs <childId>          在 <DSH_HOME>/sessions 下
//     按 childId 全项目目录搜索定位档案（复用 preset/shared/archive.mjs 的
//     findArchivedLogByChildId，多命中取 mtime 最新）
//   node scripts/dump-session.mjs --file <path>      直读指定 session.jsonl.zstd
//
// 输出：逐帧逐事件一行摘要流（#<seq> <type> <关键字段>）。帧界扫描复用共享层
// scanZstdFrameRanges（多 zstd 帧追加容器，Node 单帧接口只吃首帧）；末帧不完整
// 时跳过并 warn，绝不因截断尾部整体判死。
// 退出码：档案找不到 / 帧扫描失败 / 解压全灭 → 非零 + stderr 明确报错。

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

import { findArchivedLogByChildId, scanZstdFrameRanges } from '../preset/shared/archive.mjs'

// 摘要只打单行：折叠换行再截断，避免 failure.message 里的多行 JSON 冲垮行格式。
function oneLine(text, limit) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat
}

// summarizeEvent：按事件类型取关键字段，其余类型只打 type（返回空串）。
// 字段行号以 dsh-agent-loop/lib/index.js 为准：tool/call(:293, data.name)、
// tool/result(:308, data.message.isError)、request/header(:733)、llm/retry
// (dsh-llm-retry, data.retry/failure.message)、turn/end(:592, data.reason)。
export function summarizeEvent(ev) {
  const data = ev?.data ?? {}
  switch (ev?.type) {
    case 'request/header': {
      const config = data.header?.config ?? {}
      return `provider=${config.provider ?? '?'} model=${config.model ?? '?'}`
    }
    case 'llm/retry':
      return `retry=${data.retry ?? '?'}/${data.maxRetries ?? '?'} failure=${oneLine(data.failure?.message, 120)}`
    case 'turn/end': {
      const reason = data.reason ?? {}
      let out = `kind=${reason.kind ?? '?'}`
      if (reason.error?.message) out += ` error=${oneLine(reason.error.message, 200)}`
      return out
    }
    case 'assistant/chunk':
      return `chunk=${data.chunk?.type ?? '?'}`
    case 'tool/call':
      return `name=${data.name ?? '?'}`
    case 'tool/result':
      return `isError=${data.message?.isError === true}`
    default:
      return ''
  }
}

// locateArchive：childId 模式定位。root 可注入（测试用）；缺省按 DSH_HOME 惯例。
export function locateArchive(childId, root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')) {
  return findArchivedLogByChildId(root, childId)
}

// dumpArchive：读档案 → 帧扫描 → 逐帧解压 → 逐行摘要。返回
// { lines, frames, events }；档案不可读/帧扫描失败/无完整帧/全部帧解压失败
// 抛 Error（CLI 层转非零退出码）。单帧解压失败/单行 JSON 损坏只 warn 跳过。
export function dumpArchive(logFile, warn = console.warn) {
  let buffer
  try {
    buffer = readFileSync(logFile)
  } catch (error) {
    throw new Error(`dump-session: 档案不可读 ${logFile}（${String(error?.code ?? error)}）`)
  }
  let ranges
  try {
    ranges = scanZstdFrameRanges(buffer)
  } catch (error) {
    throw new Error(`dump-session: 帧扫描失败 ${logFile}（${String(error)}）`)
  }
  if (ranges.length === 0) {
    throw new Error(`dump-session: 档案无完整 zstd 帧，解压全灭 ${logFile}`)
  }
  const lines = []
  let badFrames = 0
  for (let i = 0; i < ranges.length; i++) {
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(ranges[i].start, ranges[i].end)).toString('utf-8')
    } catch (error) {
      badFrames++
      warn(`dump-session: 第 ${i} 帧解压失败（${String(error)}），跳过`)
      continue
    }
    for (const raw of text.split('\n')) {
      if (!raw) continue
      let ev
      try {
        ev = JSON.parse(raw)
      } catch {
        warn(`dump-session: 第 ${i} 帧存在截断/损坏行，跳过`)
        continue
      }
      const summary = summarizeEvent(ev)
      lines.push(`#${ev?.seq ?? '-'} ${ev?.type ?? '(unknown)'}${summary ? ' ' + summary : ''}`)
    }
  }
  if (lines.length === 0) {
    throw new Error(`dump-session: 全部 ${ranges.length} 帧解压失败或无有效事件，解压全灭 ${logFile}`)
  }
  const tailEnd = ranges[ranges.length - 1].end
  if (tailEnd < buffer.length) {
    warn(`dump-session: 末帧截断，跳过不完整尾部 ${buffer.length - tailEnd} 字节`)
  }
  return { lines, frames: ranges.length, events: lines.length }
}

function main(argv) {
  const args = argv.slice(2)
  let logFile
  let projectDir
  if (args[0] === '--file') {
    logFile = args[1]
    if (!logFile) {
      console.error('用法: node scripts/dump-session.mjs <childId> | --file <archive-path>')
      process.exitCode = 1
      return
    }
  } else if (args[0] && !args[0].startsWith('-')) {
    const found = locateArchive(args[0])
    if (!found) {
      console.error(`dump-session: 未找到 childId=${args[0]} 的会话档案（sessions 根全项目目录搜索无命中）`)
      process.exitCode = 1
      return
    }
    logFile = found.logFile
    projectDir = found.projectDir
  } else {
    console.error('用法: node scripts/dump-session.mjs <childId> | --file <archive-path>')
    process.exitCode = 1
    return
  }
  try {
    const { lines, frames, events } = dumpArchive(logFile)
    console.log(`archive: ${logFile}${projectDir ? `（项目目录 ${projectDir}）` : ''}`)
    console.log(`frames: ${frames} events: ${events}`)
    for (const line of lines) console.log(line)
  } catch (error) {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) main(process.argv)
