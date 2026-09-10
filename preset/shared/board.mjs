/**
 * dsh-my-go — board 存储层（第一期报告外部化的读写唯一出处，步骤 1.1）。
 *
 * 规划出处：docs/plans/next-gen-architecture-0.4.0.md §第一期 步骤 1.1。
 * 子代报告全文经 report_submit（1.3）与收尾自动落板（1.5）双通道写入这里，
 * 主编经 report_fetch（1.6）按行切片取回——本模块是 board 读写的唯一出处：
 * 原子写、行切片读、路径焊死三件事只在这里做一遍。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx。
 * 依赖只有 node:fs/promises、node:path、node:os 与 shared/archive.mjs 的
 * encodeSegment（复用既有实现，broker.mjs:65 已有同源导出先例）。
 *
 * 路径模型（双保险）：
 *   <boardRoot()>/<encodeSegment(sessionId)>/<encodeSegment(childId)>.md
 *   - 根焊死：boardRoot() = join(DSH_HOME || ~/.dsh, 'dsh-my-go', 'board')
 *     （台账路径惯例同款）；所有读写出自本函数，不存在第二处拼路径的点。
 *   - 段编码：sessionId/childId 一律过 encodeSegment——安全段恒等、分隔符与
 *     冒号等不安全码位转义 ~XXXX、纯 '.'/'..' 特判转义（archive.mjs:56-68）。
 *     '../x'、'a/b'、'C:\x' 编码后都是不含路径分隔符的单一段，join 恒落在
 *     焊死的根目录之内，穿越与盘符逃逸在编码层即被消除。
 *
 * 错误语义（刻意不对称，都是明确契约）：
 *   - writeBoard 失败 = 抛错（tmp 残骸清理后 rethrow 原错误）：board 是业务
 *     数据，报告落板失败必须让调用方（report_submit / 收尾落板）处置，绝不
 *     静默吞——与观测面 metrics 的「只 warn 不抛」相反，两者语义各自正确。
 *   - readBoardSlice 文件缺席 = 返回 { error: 'not-found', path } 错误对象而
 *     不抛出（读取缺席是主编取回的正常形态，不该当异常炸工具栈）；其余 fs
 *     异常（权限等）仍然 rethrow。
 *
 * 切片语义（D1 已裁决：按行计量）：
 *   - 行口径与 metrics 落盘同款：文件按 '\n' 切分、尾随换行不计入行数、
 *     空文件 0 行；内容字节保真（不归一 CRLF——写进去什么字节、切片取回
 *     就是什么字节，round-trip 无损）。
 *   - offset 为 0-based 跳过行数（分页 API 公共语义：SQL OFFSET /
 *     Array.slice 同构；1.6 的 report_fetch description 将显式声明），limit
 *     为取回行数上限；两者越界一律钳制，返回体回显钳制后实际生效的
 *     offset/limit（offset ∈ [0, totalLines]，limit = min(limit, totalLines
 *     - offset)，text 行数恒等于回显 limit），调用方无需自己再猜边界。
 *   - 非有限 offset/limit（undefined/NaN）：offset 按 0、limit 按「不限」
 *     处理（读到底）。
 *
 * 容量观测（D14 已裁决：本期不做 GC）：本模块不依赖 metrics（1.1 无消费
 * 点）；writeBoard 返回的 bytes（content 的 UTF-8 真实字节数——容量量纲，
 * 与 metrics 事件字段的 .length 量纲不同、语义各自正确）就是观测原料，
 * 第一期 broker 接线点（1.3/1.5）持 metrics 实例处直接打新 kind 事件，
 * metrics 模块零改动。
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { encodeSegment } from './archive.mjs'

// board 根目录（台账路径惯例同款：DSH_HOME 缺省 join(homedir(), '.dsh')）。
// 每次调用现算——测试靠改 DSH_HOME 注入隔离目录，不设模块级缓存。
export function boardRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-my-go', 'board')
}

// 唯一拼路径点：根焊死 + 双段编码（session 目录 + child 文件名）。
// ext 只有两枚取值：'.md' 正板、'.prev.md' 覆盖写留痕（见 writeBoard 顺手项A）。
// 后缀差异留在文件名内部，会话段与编码规则完全同源——不存在第二处拼路径的点。
function boardPath(sessionId, childId, ext = '.md') {
  return join(boardRoot(), encodeSegment(sessionId), `${encodeSegment(childId)}${ext}`)
}

// 行切分（字节保真：不归一 CRLF；尾随换行不计行数；空文件 0 行）。
function splitLines(raw) {
  if (raw === '') return []
  const body = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  return body.split('\n')
}

// 写入报告全文（覆盖语义：同 (sessionId, childId) 重写即替换）。
// tmp+rename 原子范式（broker.mjs writeLedgerSync 同款）：撕裂的只会是 .tmp，
// 残骸尽力清理后把原错误抛给调用方处置。
// 覆盖留痕（报告板覆盖卫生）：正板已存在时，先把旧板改名 <childId>.prev.md 再写
// 新板——被顶掉的上一版不至于无声蒸发（取证现场：一次落板把 4993B 原文压成
// 777B 摘要，无从对照）。只保留最近一版（同名 .prev 直接被覆盖），且刻意不参与
// 任何读取路径：hasBoardEntry / readBoardSlice 都只认正板 <childId>.md。
export async function writeBoard(sessionId, childId, content) {
  if (typeof content !== 'string') {
    throw new TypeError(`writeBoard: content must be a string, got ${typeof content}`)
  }
  const path = boardPath(sessionId, childId)
  const prevPath = boardPath(sessionId, childId, '.prev.md')
  const tmpPath = `${path}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    // 只让位给「确实是文件」的旧板：路径被目录等异常形态占住时不碰它，
    // 让下面真正的 rename 去暴露冲突（失败语义与既有实现一致）。
    const existing = await stat(path).catch(() => null)
    if (existing?.isFile()) await rename(path, prevPath)
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => { /* 残骸本就不在 */ })
    throw error
  }
  // bytes = UTF-8 真实字节数（R1.5/D14 容量观测的原料，见文件头注释）。
  return { path, bytes: Buffer.byteLength(content, 'utf-8') }
}

// 板上是否已有该儿童的报告（报告闸门兜底判定，复活轮误判修复批改点2）。
// 同步 fs：本函数被 end 归因的同步段消费（协议第 1 条「同步段零 await」），
// 一枚 existsSync 的代价即一次 stat——archive.mjs 的附因兜底读档早有同步先例。
// 拼路径恒过 boardPath（穿越面与读侧同一道闸）；段名畸形（空段）时按「无货」
// 回答，绝不让判定器抛出——闸门读不到货的后果是多问一次，不是炸整个 end 管线。
export function hasBoardEntry(sessionId, childId) {
  try {
    return existsSync(boardPath(sessionId, childId))
  } catch {
    return false
  }
}

// 按行切片读取（D1）。文件缺席返回 { error: 'not-found', path }，不抛出；
// offset/limit 越界一律钳制并在返回体回显实际生效值（语义见文件头注释）。
export async function readBoardSlice(sessionId, childId, offset, limit) {
  const path = boardPath(sessionId, childId)
  let raw
  try {
    raw = await readFile(path, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { error: 'not-found', path }
    throw error
  }
  const lines = splitLines(raw)
  const totalLines = lines.length
  const off = clampOffset(offset, totalLines)
  const lim = clampLimit(limit, totalLines - off)
  const end = off + lim
  return { totalLines, offset: off, limit: lim, text: lines.slice(off, end).join('\n') }
}

function clampOffset(offset, totalLines) {
  const n = typeof offset === 'number' && Number.isFinite(offset) ? Math.trunc(offset) : 0
  return Math.max(0, Math.min(n, totalLines))
}

function clampLimit(limit, remaining) {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.trunc(limit) : remaining
  return Math.max(0, Math.min(n, remaining))
}
