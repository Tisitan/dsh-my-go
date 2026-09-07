/**
 * dsh-my-go — metrics 观测事件日志（0.4.0-tisitan.0，第 0 期 0.1 步）。
 *
 * 规划出处：docs/plans/next-gen-architecture-0.4.0.md §第 0 期 步骤 0.1。
 * 刻意放 preset/tools/ 而不进 shared/：只有 broker 半消费它，收进 shared 会
 * 无谓扩大单源守卫面（host-parity 的 shared import 清单、安装目录断言都要
 * 跟着涨）。铁律与 shared 同款：不 import @deepseek-ai/*、零 ctx——本模块
 * 只认识「一个目录 + 一串事件对象」，编排语义一概不知。
 *
 * 形态：createMetrics({ dir, enabled }) → { record(event), close() }。
 *   - record：同步返回、fire-and-forget。内部一条 Promise 串行链保证追加顺序
 *     与调用顺序一致；任何 fs 异常只 console.warn 吞掉，绝不抛进编排热路径
 *     （规划风险表 R0.1）。调用方永远不 await、不 catch。
 *   - 事件行格式：JSONL，一行一事件 `{"ts":<ms>,"kind":..., ...fields}`。ts 由
 *     本模块统一注入（调用方显式给了 ts 则不覆盖）；字节数字段（promptBytes /
 *     conclusionBytes / bytes）量纲与规划 0.1 节逐字一致，取 .length。
 *   - 行数 cap（R0.2，仿 CURRENT_MAP_CAP 兜底哲学）：超过 cap 时截头保留最新
 *     一半（均摊重写成本），每次截头动作伴随恰好一条 warn——既留痕又不刷屏。
 *     跨重启有效：初始化时数一遍现存文件的行数。整文件重写走 tmp+rename 原子
 *     范式（broker.mjs writeLedgerSync 同款），撕裂的只会是 .tmp 残骸。
 *   - 按日轮转不做（YAGNI，规划 0.1 指令颗粒度明确排除）；cap 是唯一的
 *     无界增长兜底闸。
 *   - enabled=false：零盘触——不 mkdir、不读、不写，record 变纯 no-op。
 *     close 幂等：多次调用同值 resolve；close 后到达的 record 静默丢弃。
 */

import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// 事件行数上限（规划 0.1：cap 10 万行，D6 已裁决默认开 + cap 兜底）。
export const METRICS_EVENTS_CAP = 100_000

// 事件档固定文件名（规划 0.1 落盘路径：…/dsh-my-go/metrics/events.jsonl）。
export const METRICS_FILE = 'events.jsonl'

export function createMetrics({ dir, enabled = true, cap = METRICS_EVENTS_CAP } = {}) {
  if (!enabled) {
    // 关闭态零盘触：连目录都不建——「零写盘」是验收条款，不是实现副作用。
    return {
      record: () => {},
      close: async () => {},
    }
  }

  const filePath = join(dir, METRICS_FILE)
  // 截头保留量：最新的一半。留一半余量让截头均摊在每 cap/2 条事件上，
  // 而不是每追加一条就重写一次整文件。
  const keepOnTrim = Math.max(1, Math.floor(cap / 2))
  let chain = Promise.resolve()
  let lineCount = 0
  let initialised = false
  let closed = false
  let closePromise = null

  // 惰性初始化（挂在写链上，构造函数保持同步）：建目录 + 数现存行数，
  // 让 cap 在进程重启后仍然有效。数行失败按 0 行起步（无档/坏档不阻断）。
  async function ensureInit() {
    if (initialised) return
    initialised = true
    await mkdir(dir, { recursive: true })
    try {
      const raw = await readFile(filePath, 'utf-8')
      lineCount = countLines(raw)
    } catch { /* 首日无档：0 行起步 */ }
  }

  function countLines(raw) {
    if (raw === '') return 0
    const body = raw.endsWith('\n') ? raw.slice(0, -1) : raw
    return body.split('\n').length
  }

  async function trimExcess() {
    const raw = await readFile(filePath, 'utf-8')
    const keep = countLines(raw) > 0
      ? (raw.endsWith('\n') ? raw.slice(0, -1) : raw).split('\n').slice(-keepOnTrim)
      : []
    const tmpPath = `${filePath}.tmp`
    // 原子写范式（broker.mjs writeLedgerSync 同款）：先写同目录 .tmp 再 rename，
    // 失败尽力清掉 tmp 残骸；错误交给 record 的写链 catch 统一 warn。
    try {
      await writeFile(tmpPath, keep.length > 0 ? `${keep.join('\n')}\n` : '', 'utf-8')
      await rename(tmpPath, filePath)
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {})
      throw error
    }
    lineCount = keep.length
    // 每次截头动作恰好一条 warn（超限本身是观测面值得可见的事件；
    // 被截的每条事件各 warn 一条才是刷屏）。
    console.warn(`[dsh-my-go] metrics ${METRICS_FILE} exceeded ${cap} lines; trimmed head, kept the newest ${keep.length}`)
  }

  function record(event) {
    // 同步段闸一：close 之后到达的事件直接丢弃；非对象载荷防御性忽略
    // （观测面绝不成为编排侧 TypeError 的来源）。
    if (closed || event === null || typeof event !== 'object') return
    chain = chain.then(async () => {
      // 同步段闸二：close 等待排空的窗口里入队的事件，跑到这里时已闭，丢弃。
      if (closed) return
      try {
        await ensureInit()
        const line = `${JSON.stringify({ ts: Date.now(), ...event })}\n`
        await appendFile(filePath, line, 'utf-8')
        lineCount += 1
        if (lineCount > cap) await trimExcess()
      } catch (error) {
        // R0.1（规划 §三风险表）：观测 I/O 绝不抛进编排热路径——warn 吞掉。
        // 变异探针已实测（9-2 纪律）：删掉本 try/catch，test/metrics.test.mjs 的
        // 「fs 失败只 warn 不抛」用例必红（warn 缺席断言咬住；若连链尾的
        // catch 双保险也一并删掉，则升级为 unhandledRejection 打崩测试进程）。
        console.warn(`[dsh-my-go] metrics event write failed: ${String(error)}`)
      }
    })
    // 双保险：即便未来重构让 handler 在 try 外抛出，链身也永不 reject——
    // 不给 unhandledRejection 任何打进宿主进程的路径。
    chain = chain.catch(() => {})
  }

  function close() {
    // 幂等：所有调用共享同一个排空 promise；close 之后再入队的 record
    // 会挂在 close 标记之后，被闸二丢弃。
    if (!closePromise) {
      closePromise = chain.then(() => { closed = true })
      chain = closePromise.catch(() => {})
    }
    return closePromise
  }

  return { record, close }
}
