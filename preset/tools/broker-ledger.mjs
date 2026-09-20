/**
 * dsh-my-go — 编排台账持久化（0.2.3-tisitan.8 起本体；5.1 波自 broker.mjs 抽出）。
 *
 * history 记录（done/failed，每桶上限 HISTORY_CAP）落盘为 JSON，
 * 插件加载时读回：进程重启后 continue 一个已完工 childId 仍能命中台账
 * （revive → harness coldResume 续聊），而不是报 unknown sub-agent id。
 * 存放位置沿用 ensurePresetInstalled 的 DSH_HOME 惯例，独立插件状态目录，
 * 不进 preset 同步目录（避免被版本同步覆盖语义污染）。
 *
 * 放 preset/tools/ 扁平文件而不进 shared/（对齐 metrics.mjs 先例）：本模块
 * 操纵的是编排会话的活状态（orchestrations 实例表），不是纯函数层。铁律与
 * metrics 同款：不 import @deepseek-ai/*、零 ctx——状态持有者（orchestrations）
 * 与回调（orchFor / findRecordEverywhere / bump）、常量（ledgerPath）全部由
 * broker.mjs 的 apply() 显式注入，本模块自身不解析任何服务。
 *
 * 形态：createLedgerOps({ ledgerPath, orchestrations, orchFor,
 * findRecordEverywhere, bump }) → { loadLedger, ledgerPayload, writeLedgerSync,
 * scheduleLedgerSave, findRecordWithLedgerFallback, closeLedger }。
 *   - loadLedger：读档并逐 parentId 恢复到各流水线实例（orchFor 注入回调）；
 *     无档/坏档空台账起步，绝不阻断插件加载。
 *   - scheduleLedgerSave：任何台账变化都经它防抖落盘（合并同窗口内的连续
 *     突变），写盘走 Promise 链串行化，绝不在热路径同步阻塞。
 *   - closeLedger：卸载收尾（0.3.0-tisitan.7 N8），见函数头注释。
 *   - 防抖窗/串行链/关闭位三个可变位收进一个小 state 对象持有（saveState）。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
// 卸载路径的台账同步落盘（0.3.0-tisitan.7 N8）：清理函数里不等异步链，直接用
// node:fs 同步三件套（mkdir/writeFile/rename 的 sync 形态），原子语义与热路径一致。
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { HISTORY_CAP, LEGACY_PARENT_ID } from '../shared/constants.mjs'
import { pruneLedgerParents } from '../shared/misc.mjs'
import { normalizeRestoredChain } from '../shared/relay-chain.mjs'

export function createLedgerOps({ ledgerPath, orchestrations, orchFor, findRecordEverywhere, bump }) {
  const isLedgerRow = (r) => r && typeof r.childId === 'string' && typeof r.agentType === 'string'
  async function loadLedger() {
    try {
      const raw = JSON.parse(await readFile(ledgerPath, 'utf-8'))
      if (raw && (raw.version === 3 || raw.version === 2) && raw.parents && typeof raw.parents === 'object') {
        // v2/v3：按编排会话分桶的台账，逐 parentId 恢复到各流水线实例
        for (const [pid, list] of Object.entries(pruneLedgerParents(raw.parents))) {
          if (!Array.isArray(list)) continue
          orchFor(pid).history = list.filter(isLedgerRow).slice(-HISTORY_CAP)
        }
        // v3（三期 3.3，D12）：chains 桶——恢复经 normalizeRestoredChain 归一
        // （running→suspended('restart')、pending-fallback→failed、fallback 挂起
        // 的 hopChildId 按 T8 自查谓词保留/归 restart，D28 裁决 + §5.3 精化）。
        // 谓词查本实例 history（先于本循环恢复完毕，顺序即正确性）；坏行整行
        // 丢弃留痕，绝不猜式修补。v2 档无 chains 桶 → 空起步。
        if (raw.version === 3 && raw.chains && typeof raw.chains === 'object') {
          for (const [pid, list] of Object.entries(raw.chains)) {
            if (!Array.isArray(list)) continue
            const orch = orchFor(pid)
            for (const row of list) {
              const rec = normalizeRestoredChain(row, {
                hasSettledGeneration: (childId) => orch.history.some((r) => r.childId === childId),
              })
              if (rec) {
                orch.chains.push(rec)
                if (rec.state === 'suspended' && rec.suspendReason === 'restart') {
                  console.warn(`[dsh-my-go] relay chain ${rec.id} restored as suspended(restart) at hop ${rec.cursor + 1} — awaiting chain_resolve (D13 snapshot visibility)`)
                }
              } else {
                console.warn(`[dsh-my-go] relay chain ledger row dropped (malformed) under ${String(pid)}`)
              }
            }
          }
        }
      } else {
        // 向后兼容 v1（单份 history 数组）：载入 key 为 LEGACY_PARENT_ID 的实例，
        // continue/forward 的全局扫描兜底仍可命中这些跨重启记录。
        const list = Array.isArray(raw) ? raw : raw?.history
        if (!Array.isArray(list)) return
        orchFor(LEGACY_PARENT_ID).history = list.filter(isLedgerRow).slice(-HISTORY_CAP)
      }
      bump()
    } catch { /* 无档/坏档：空台账起步，不阻断插件加载 */ }
  }
  // 任何台账变化都经 onChange 调度一次防抖落盘（合并同窗口内的连续突变），
  // 写盘走 Promise 链串行化，绝不在热路径同步阻塞。
  // payload 构造与写盘动作分开：同一份口径供防抖路径与卸载收尾路径复用。
  // 防抖窗（timer）/串行链（chain）/关闭位（closed）三枚可变位集中持有；
  // closed 卸载后置真：在飞的异步写全部作废（收尾的同步写不能被一枚更旧的
  // payload 覆回去——异步链的 .then 在清理函数之后才跑）。
  const saveState = { timer: null, chain: Promise.resolve(), closed: false }
  function ledgerPayload() {
    // 占槽记录（currentMap：spawning/running/waiting）从来不入档，本档只有 history
    // 与 chains 两桶，挂起停摆的 episode 标记 stallNotified 因此天然不持久化
    // （finish 挪史时状态机同点剥除，见 shared/orchestration.mjs）——重启后
    // episode 归零，同一桩挂起最坏重报一次，比「带着死标记永久哑火」好。
    const parents = {}
    const chains = {}
    for (const [pid, orch] of orchestrations) {
      if (orch.history.length > 0) parents[pid] = orch.history.slice(-HISTORY_CAP)
      // v3 chains 桶（三期 3.3，D12）：终态含全量持久化（存量由 RELAY_CHAINS_CAP
      // 在 chain_start 入口钳制），主销毁路径的桶删（D27）随 orchestrations
      // 摘除自然生效。
      if (orch.chains.length > 0) chains[pid] = orch.chains
    }
    const payload = { version: 3, parents: pruneLedgerParents(parents) }
    if (Object.keys(chains).length > 0) payload.chains = chains
    return JSON.stringify(payload)
  }
  function writeLedgerSync(payload) {
    const tmpPath = `${ledgerPath}.tmp`
    try {
      mkdirSync(dirname(ledgerPath), { recursive: true })
      writeFileSync(tmpPath, payload, 'utf-8')
      renameSync(tmpPath, ledgerPath)
    } catch (error) {
      try { rmSync(tmpPath, { force: true }) } catch { /* 残骸本就不在 */ }
      console.warn(`[dsh-my-go] orchestration ledger save failed: ${String(error)}`)
    }
  }
  function scheduleLedgerSave() {
    if (saveState.timer) return
    saveState.timer = setTimeout(() => {
      saveState.timer = null
      const payload = ledgerPayload()
      saveState.chain = saveState.chain.then(async () => {
        if (saveState.closed) return
        // 原子写（0.3.0-tisitan.3）：先写同目录 .tmp 再 rename 覆盖——进程崩溃写
        // 到一半时撕裂的是 tmp，台账本体非旧即新恒完整，不再全量丢账。
        const tmpPath = `${ledgerPath}.tmp`
        try {
          await mkdir(dirname(ledgerPath), { recursive: true })
          await writeFile(tmpPath, payload, 'utf-8')
          await rename(tmpPath, ledgerPath)
        } catch (error) {
          // 写/rename 失败：尽力清掉 tmp 残骸，warn 留痕但不抛出打断串行链
          await rm(tmpPath, { force: true }).catch(() => {})
          console.warn(`[dsh-my-go] orchestration ledger save failed: ${String(error)}`)
        }
      })
    }, 250)
    saveState.timer.unref?.()
  }
  // 插件卸载收尾（0.3.0-tisitan.7 N8）：只 clearTimeout 等于把整个防抖窗（250ms）
  // 内的台账变更丢弃——最后一次完工/复活根本不入档，重启后 continue 报
  // unknown-id（现场-Z3 的文件兜底也救不了：文件里压根没有那条记录）。
  // 有 pending timer 就同点做完这次写：撤定时器 → 作废在飞的异步链 →
  // 同步落最新 payload（tmp+rename 原子语义不变；卸载路径接受同步 I/O）。
  function closeLedger() {
    if (saveState.timer === null) return
    clearTimeout(saveState.timer)
    saveState.timer = null
    saveState.closed = true
    writeLedgerSync(ledgerPayload())
  }

  // 台账文件兜底查找（现场-Z3）：continue/forward 内存全实例未命中时，回读
  // 台账文件再找一次。双半并行记账 + 各自的启动代际差（重启时点、防抖窗口）
  // 会让某一半的内存缺一条台账已有的记录（真机实锤：文件与面板均有该记录，
  // continue 却报 unknown-id，同桶邻记录命中）。文件是两半落盘的并集，命中即
  // 按 loadLedger 同款规则（isLedgerRow + 200 条上限）并入内存实例后再走一次
  // 常规查找；同 id 已在册则不重复追加。仅在未命中的冷路径多一次文件读，
  // 热路径零开销。
  async function findRecordWithLedgerFallback(childId, preferred, preferredPid) {
    const inMemory = findRecordEverywhere(childId, preferred, preferredPid)
    if (inMemory) return inMemory
    try {
      const raw = JSON.parse(await readFile(ledgerPath, 'utf-8'))
      const parents = raw && (raw.version === 3 || raw.version === 2) && raw.parents && typeof raw.parents === 'object'
        ? raw.parents
        : { legacy: Array.isArray(raw) ? raw : raw?.history }
      for (const [pid, list] of Object.entries(parents)) {
        if (!Array.isArray(list)) continue
        const row = list.find((r) => isLedgerRow(r) && r.childId === childId)
        if (!row) continue
        const orch = orchFor(pid)
        if (!orch.record(childId)) {
          orch.history = [...orch.history.filter((r) => r.childId !== childId), row].slice(-HISTORY_CAP)
          bump()
        }
        break
      }
    } catch { /* 无档/坏档：维持内存未命中的结论 */ }
    return findRecordEverywhere(childId, preferred, preferredPid)
  }

  return { loadLedger, ledgerPayload, writeLedgerSync, scheduleLedgerSave, findRecordWithLedgerFallback, closeLedger }
}
