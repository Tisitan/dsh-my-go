/**
 * dsh-my-go — 声明式接力链状态机（三期步骤 3.2）。
 *
 * 规划出处：docs/plans/next-gen-architecture-0.4.0.md :297-303（步骤 3.2）；
 * 语义唯一出处：docs/plans/relay-chain-semantics.md §二（六态状态机 + T1~T17
 * 迁移表）、§四（链 × 九出口交互矩阵）。设计文档的决策空白 D21~D29 已由主人
 * 全数按建议值裁决（D21 hop 冻结 / D22 suspended('gate-verdict') / D23 fail-fast /
 * D24 严格 read→read / D25 活跃链恒 1 / D26 两处解释收束 / D27 桶删双留痕 /
 * D28 suspended('restart') / D29 全文直投），本文按裁决值实现，不再留开关。
 *
 * 风格仿 shared/end-attribution.mjs：**决策纯函数**，输入链记录与事件的只读
 * 视角，输出 `{ decision, patch, ops, notices, facts }`——本模块不持有任何一条
 * 链记录，dispatcher（broker 半，3.3~3.5 接线）按返回值落地。与 end-attribution
 * 的一点结构差异：链记录是状态机**自有状态**（不像 abortExpected 那种共享表），
 * 字段变更不走 ops 而走 `patch`（链记录增量，dispatcher 原样 Object.assign）；
 * ops 只承载**跨域副作用**（enqueue/通知素材），词表刻意收窄为唯一成员
 * `enqueue-hop`——链请求派发只有入队一条通道，直派词表根本不存在（INV-1 锁
 * 不可绕的结构面，变异探针见 test/relay-chain.test.mjs P1）。
 *
 * 调用方协议（三条，接线前必读）：
 *  1. **先匹配后决策**：end/queue-dropped 事件必须先经 matchChainForEnd /
 *     matchChainForWork 确认归属，才能把事件喂给 advanceChain。匹配键恒为
 *     当前世代 id（hopChildId / hopWorkId）——旧世代 end 天然查不到链（E1/E5
 *     幽灵防线的结构面，设计文档 §4.1）。回填契约：hopChildId 只能经
 *     reconcileHopDispatch 在 spawn 登记同步段回填（先于 E2 认领重放，§4.2-①）。
 *  2. **advance 决策必须显式登记**：advanceChain 对「事件 × 链状态」的每一组
 *     合合法定义了 decision；非法组合一律 decision='idle' 且 patch/ops 全空
 *     （宁可不动，也不猜——协议同 end-attribution 第 2 条）。P1 探针同时锁
 *     decision 词表的封闭性。
 *  3. **同步段零 await**：advanceChain 是纯同步函数，dispatcher 落地 patch 与
 *     ops 之间不得插 await（协议第 1 条同律）——挂起通知（notices）必须先于
 *     enqueue-hop 的异步落地链。
 *
 * 恢复归一（D28 裁决 + 一处对设计文档 §5.3 的精化，报备在案）：台账 v3 行经
 * normalizeRestoredChain 归一——running→suspended('restart')、pending-fallback
 * →failed；hopWorkId 恒作废（work-* 纯内存挂靠）。精化点：**suspended('fallback')
 * 的 hopChildId 保留**——它是 T8 自查（§4.2-③ D10 裁决赛跑）的查询键，台账
 * history 恢复后该查询跨重启仍有效；其余情形 hopChildId 作废置 null。精化
 * 依据：设计文档 §5.3「一律作废」字面与 §4.2-③ 自查机制冲突，以机制为准；
 * fallback 挂起恢复时若代际未终局（hasSettledGeneration 谓词为假），归一为
 * suspended('restart')——重派口径，防「换绑等一个永不到来的 end」真空变体。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx。
 * 依赖只有 shared/orchestration.mjs 的 laneOf（泳道判定表复用，二期 §1.1 同源
 * ——设计文档 §八预埋兑现）。
 */

import { laneOf } from './orchestration.mjs'

// ── 词表常量 ────────────────────────────────────────────────────────────────
// gate 入闸语义（设计文档 §2.3）：hop[i].gate 管 hop[i] 派发前审不审。
export const RELAY_GATES = Object.freeze(['auto', 'review', 'sync'])
export const RELAY_CHAIN_STATES = Object.freeze([
  'running', // 当前跳在飞（spawning/queued/running/报告补发轮/E4 续轮均在此外观内）
  'pending-fallback', // 当前跳 error 进备选评估窗口（瞬时态：必有终局，§四 E6 格）
  'suspended', // 等主编，suspendReason 分派
  'done', // 末跳 finalize 合格落账，链完成
  'failed', // 链死亡：跳失败且无续接可能
  'aborted', // 主编 abort 或属主销毁连带清理
])
export const RELAY_SUSPEND_REASONS = Object.freeze([
  'review', // 入闸挂起：审阅后放行/驳回
  'sync', // 不可逆跳强制同步门：指令必须现场给（R-k）
  'fallback', // D10：棒亡备选重派成功，链绑新世代 childId 等裁决
  'input-missing', // board 缺席，数据面直投无输入
  'gate-verdict', // D22：报告补发后仍不合格，等主编裁量（带病续链 or 弃）
  'restart', // D28：重启恢复 / 恢复时代际未终局的 fallback 归一
])
// 每实例终态含存量上限（broker.mjs END_BUFFER_CAP=16 同款兜底常量口径，防异常路径无界）
export const RELAY_CHAINS_CAP = 32
export const RELAY_HOPS_MIN = 2
export const RELAY_HOPS_MAX = 8

// advanceChain 决策词表（事件 × 状态合法定义的出口；idle = 非法组合/无动作）。
// 刻意全表显式：新增决策不在此登记的判定分支写不出来（返回值形态在函数内收敛）。
export const RELAY_DECISIONS = Object.freeze([
  'idle', // 事件与链状态不匹配或该出口无动作（T15 hold 同走此词）
  'hop-dispatch', // 派发 cursor 跳（T1/T2/T5/T6/T8 自查/T9 重派）——ops 恒 [enqueue-hop]
  'suspend', // 进入挂起（T3/T16：gate 类与 gate-verdict，cursor 已推进指向待派发跳）
  'suspend-fallback', // T11：D10 挂起，hopChildId 换绑新世代
  'resume', // T8 unsettled 分支：fallback 裁决 continue，换绑等待新世代 end
  'pending-fallback', // T10：当前跳 error 进备选评估
  'complete', // T4：末跳终局合格，链完成
  'fail', // T13/T12/T14：链死亡
  'abort', // T7：主编取消
  'aborted-by-dispose', // D27：属主销毁连带清理（patch aborted + 留痕 notice）
])

// ── 声明校验（3.3 工具层在 schema 之外调用的结构校验；R-a 结构面 / R-b~R-e）──
// roster 存在性与双开关门（R-f~R-h）需要 live roster 与 config，归工具层，不在纯模块。
export function validateChainDeclaration(hops) {
  const errors = []
  if (!Array.isArray(hops)) return { ok: false, errors: ['hops-type'] }
  if (hops.length < RELAY_HOPS_MIN || hops.length > RELAY_HOPS_MAX) {
    return { ok: false, errors: [`hops-length:${hops.length}`] }
  }
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]
    if (!hop || typeof hop !== 'object' || Array.isArray(hop)) {
      errors.push(`hop-shape:${i}`)
      continue
    }
    if (typeof hop.agent !== 'string' || hop.agent.trim() === '') errors.push(`agent:${i}`)
    if (hop.prompt !== undefined && typeof hop.prompt !== 'string') errors.push(`prompt-type:${i}`)
    if (hop.gate !== undefined && !RELAY_GATES.includes(hop.gate)) errors.push(`gate-enum:${i}`)
  }
  if (errors.some((e) => e.startsWith('hop-shape:') || e.startsWith('agent:'))) {
    return { ok: false, errors }
  }
  // R-b：首跳声明即审（主编亲笔写的 prompt，无「上一棒产出」可审）——gate 非 auto 拒。
  // 末跳 gate 合法（review/sync）：入闸语义管「本跳派发前」，末跳同样有派发时刻
  // ——「两跳链、末跳写平面要 sync 审」正是核心场景（0.3 冒烟自检抓出的 R-c 设计
  // 矛盾，已回修设计文档 §一）。
  const gateOf = (i) => (hops[i].gate ?? 'auto')
  if (gateOf(0) !== 'auto') errors.push('first-gate')
  for (let i = 0; i < hops.length; i++) {
    const gate = gateOf(i)
    if (gate === 'auto') {
      // R-d：auto 跳的指令只能预写（无人守着，现场来源不存在）。
      if (typeof hops[i].prompt !== 'string' || hops[i].prompt.trim() === '') errors.push(`auto-prompt:${i}`)
      // R-e（D24 严格口径）：auto 仅限 read→read；write 跳必须 review/sync。
      if (i > 0 && (laneOf(hops[i - 1].agent) !== 'read' || laneOf(hops[i].agent) !== 'read')) {
        errors.push(`auto-lane:${i}`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// ── 链工厂（T1 前半；声明必须先过 validateChainDeclaration——防御性重跑）─────
// hops 存声明快照（gate 归一为缺省 auto），建链后不可变；cursor=0 且首跳立即
// start（T1 的 advanceChain 事件），链一出生就是 running。
export function createChain({ id, parentSessionId, hops, now }) {
  const verdict = validateChainDeclaration(hops)
  if (!verdict.ok) {
    throw new TypeError(`createChain: 无效链声明 (${verdict.errors.join('; ')})`)
  }
  return {
    id,
    parentSessionId,
    hops: hops.map((h) => ({ agent: h.agent, prompt: h.prompt, gate: h.gate ?? 'auto' })),
    cursor: 0,
    state: 'running',
    suspendReason: null,
    hopWorkId: null, // enqueue 后上岗前的占位键（reconcileWorkEnqueued 回填）
    hopChildId: null, // 当前世代真 id（reconcileHopDispatch 回填；匹配唯一键）
    // 上一跳最近世代 id（3.4 实现期字段补充，报备：设计文档 §2.4 未列）——
    // 数据面直投从 board 读它的报告（§3.1 时序），cursor 推进时由 settleCurrentHop
    // 写入；台账持久化（board 在磁盘，重启后 restart 重派仍可直投）。
    prevHopChildId: null,
    createdAt: now ?? Date.now(),
    updatedAt: now ?? Date.now(),
  }
}

// ── 匹配（调用方协议第 1 条：先匹配后决策）──────────────────────────────────
// end 归因回调的链匹配：running 且 hopChildId 精确等于 end.childId。三条幽灵
// 防线全在此收敛：① 旧世代 id 查不到（D10 换绑后）；② 未回填（hopChildId=null）
// 恒不命中——上岗前不存在 end 可言；③ 非 running 态不命中（suspended 挂起的
// 上一跳已置 null，pending-fallback 的亡棒 id 不再是推进键）。
export function matchChainForEnd(chains, childId) {
  if (!Array.isArray(chains) || typeof childId !== 'string' || childId === '') return undefined
  return chains.find((c) => c.state === 'running' && c.hopChildId === childId)
}

// queue-dropped 的链匹配（T14）：work 占位键只存在于「已 enqueue 未上岗」窗口
// （上岗即被 reconcileHopDispatch 置 null），被放弃只可能发生在该窗口内。
export function matchChainForWork(chains, workId) {
  if (!Array.isArray(chains) || typeof workId !== 'string' || workId === '') return undefined
  return chains.find((c) => c.state === 'running' && c.hopWorkId === workId)
}

// 回填 A：enqueue-hop op 落地后回填占位键（dispatcher 拿到 orch.enqueue 的
// workId 即调）。前置不符（state 非 running / 已有占位键）返回 null——幂等防御，
// 绝不覆盖。
export function reconcileWorkEnqueued(chain, workId, now) {
  if (!chain || chain.state !== 'running' || chain.hopWorkId !== null) return null
  if (typeof workId !== 'string' || workId === '') return null
  return { hopWorkId: workId, updatedAt: now ?? Date.now() }
}

// 回填 B（协议第 1 条时序契约的本体）：spawn 登记同步段回填真 id——调用点
// 必须在 broker.mjs dispatchWork 的三表登记（sessionTypes/bindChild/childOwner）
// 之后、claimBufferedEnd（E2 认领重放）之前，同步段零 await。认领重放走完整
// 归因管线后查链时回填必已就位，窗口结构性消失（设计文档 §4.2-①）。前置
// 不符（state 非 running / 占位键不等于传入 workId）返回 null。
export function reconcileHopDispatch(chain, { workId, childId, now } = {}) {
  if (!chain || chain.state !== 'running') return null
  if (chain.hopWorkId === null || chain.hopWorkId !== workId) return null
  if (typeof childId !== 'string' || childId === '') return null
  return { hopChildId: childId, hopWorkId: null, updatedAt: now ?? Date.now() }
}

// ── 状态机决策（核心；返回形态恒 { decision, patch, ops, notices, facts }）────
// 事件词表（全部由 dispatcher 在归因/裁决/运维点构造后喂入）：
//   { type:'start' }                                          T1（建链后首派）
//   { type:'hop-end', childId, endDecision, failed,           归因回调（§四矩阵：
//     reportGatePhase, conclusionExcerpt }                      finalize / fallback-evaluation /
//                                                               report-gate-repair / 其余）
//   { type:'resolve', decision:'continue'|'abort', prompt?,   chain_resolve（T5~T9）；
//     generationSettled? }                                      fallback continue 时由
//                                                               dispatcher 预查台账代际
//                                                               终局（§4.2-③ 赛跑自查）
//   { type:'fallback-redeployed', newChildId }                T11（重派成功挂起）
//   { type:'fallback-failed', reason? }                       T12（评估终局失败落账）
//   { type:'queue-dropped', workId, reason? }                 T14（队列重试放弃）
//   { type:'input-missing' }                                  board 缺席挂起（§3.1 时序）
//   { type:'dispose' }                                        D27 属主销毁连带清理
export function advanceChain(chain, event, now) {
  const at = now ?? Date.now()
  if (!chain || !event || typeof event.type !== 'string') return idle(at)
  switch (event.type) {
    case 'start':
      // T1：仅出生态（cursor=0、两键皆空、running）可首派；其余一律不动。
      if (chain.state !== 'running' || chain.cursor !== 0 || chain.hopWorkId !== null || chain.hopChildId !== null) return idle(at)
      return hopDispatch(chain, { cursor: 0, state: 'running', suspendReason: null, updatedAt: at }, at, chain.hops[0].prompt)
    case 'hop-end':
      return onHopEnd(chain, event, at)
    case 'resolve':
      return onResolve(chain, event, at)
    case 'fallback-redeployed':
      return onFallbackRedeployed(chain, event, at)
    case 'fallback-failed':
      // T12：评估终局失败（分类器否决/无法重派/链尽已落账）——链必死，无续接面。
      if (chain.state !== 'pending-fallback') return idle(at)
      return failChain(chain, at, '备选链评估终局为失败落账', event)
    case 'queue-dropped':
      // T14：与 matchChainForWork 同一匹配条件（防御性重述——dispatcher 可能
      // 绕过匹配函数直接喂事件）。
      if (chain.state !== 'running' || chain.hopWorkId !== event.workId) return idle(at)
      return failChain(chain, at, '队列派发重试放弃', event)
    case 'input-missing':
      // §3.1：组 prompt 读板 not-found——绝不发空输入 prompt，挂起等主编（T9 重派）。
      if (chain.state !== 'running') return idle(at)
      return suspendResult(chain, {
        state: 'suspended', suspendReason: 'input-missing', hopChildId: null, hopWorkId: null, updatedAt: at,
      }, at, `[dsh-my-go] 链 ${chain.id} 跳 ${chain.cursor + 1} 输入不可用（board 缺席），链挂起等主编裁决 [input-missing]（chain_resolve continue 重派 / abort 弃链）`)
    case 'dispose':
      // D27（裁决：桶删双留痕）：patch 置 aborted 供内存清桶前终态一致；留痕走
      // notices（warn 素材）与 facts（metrics 素材），台账侧删桶由 dispatcher 执行。
      return {
        decision: 'aborted-by-dispose',
        patch: { state: 'aborted', suspendReason: null, hopChildId: null, hopWorkId: null, updatedAt: at },
        ops: [],
        notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id}（state=${chain.state}, 跳 ${chain.cursor + 1}/${chain.hops.length}）已随编排会话销毁清理 [aborted-by-dispose]` }],
        facts: { chainId: chain.id, cursor: chain.cursor, phase: 'aborted-by-dispose' },
      }
    default:
      return idle(at)
  }
}

// hop-end 分派（§四矩阵的链轴实现：归因之后才轮到链，链不改写归因结论）。
function onHopEnd(chain, event, at) {
  if (chain.state !== 'running') return idle(at)
  if (chain.hopChildId !== event.childId) return idle(at) // 匹配双保险（E1/E5 防线）
  if (event.endDecision === 'fallback-evaluation') {
    // T10：瞬时态——评估必有终局（T11/T12 兜住），此处不发通知（E6 评估中预告已发）。
    return { decision: 'pending-fallback', patch: { state: 'pending-fallback', updatedAt: at }, ops: [], notices: [], facts: { chainId: chain.id, cursor: chain.cursor, phase: 'pending-fallback' } }
  }
  if (event.endDecision === 'report-gate-repair') {
    // T15：闸门补发轮在飞（同 childId 的 end 会再来），链 running 冻结无动作。
    return idle(at, { chainId: chain.id, hold: 'report-gate-repair' })
  }
  if (event.endDecision !== 'finalize') {
    // E4（D21 hop 冻结）/E0/E1/E2/E3/E5 等出口：链无动作。E4 的续轮（同
    // childId）end 到达时自然按 finalize 分支推进——不进主编挂起态。
    return idle(at)
  }
  if (event.failed === true) {
    // T13：无备选链失败终局（有备选链走 T10，到不了这里）。
    return failChain(chain, at, '该跳失败终局落账（无备选链续接面）', event)
  }
  return settleCurrentHop(chain, event, at)
}

// 终局推进核心（T2/T3/T4/T16 共用；前置 = cursor 跳已确定「合格 or verdict」终局）。
// cursor 推进口径（设计文档 §2.2）：凡「跳 k 终局已定、下一步动作待定」→ cursor+1
// 指向待派发/待审跳；末跳合格 → done（cursor 出界哨 = hops.length）。
function settleCurrentHop(chain, { reportGatePhase, conclusionExcerpt }, at) {
  const k = chain.cursor
  const next = k + 1
  const endedChildId = chain.hopChildId
  if (reportGatePhase === 'verdict') {
    // T16（D22 裁决案 a）：链挂起等主编裁量——「带病续链」这一链机制给不了的价值。
    return suspendResult(chain, {
      cursor: next, state: 'suspended', suspendReason: 'gate-verdict', hopChildId: null, hopWorkId: null,
      prevHopChildId: endedChildId, updatedAt: at,
    }, at, `[dsh-my-go] 链 ${chain.id} 跳 ${k + 1} 报告补发后仍不合格，链挂起等主编裁决 [gate-verdict]（chain_resolve continue = 带病续链派发下一跳 / abort = 弃链）`)
  }
  if (next >= chain.hops.length) {
    // T4：末跳合格，链完成。结论引用交主编（摘要块已随 finalize 落账）。
    return {
      decision: 'complete',
      patch: { cursor: next, state: 'done', suspendReason: null, hopChildId: null, hopWorkId: null, prevHopChildId: endedChildId, updatedAt: at },
      ops: [],
      notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id} 完成（${chain.hops.length} 跳）：末跳 ${chain.hops[k].agent} ${String(conclusionExcerpt ?? '').slice(0, 120)}` }],
      facts: { chainId: chain.id, cursor: next, phase: 'done' },
    }
  }
  const nextHop = chain.hops[next]
  if (nextHop.gate === 'auto') {
    // T2：读→读免审自动接力——派发指令只有入队通道（INV-1，op 词表封闭性见 P1）。
    return hopDispatch(chain, {
      cursor: next, state: 'running', suspendReason: null, hopChildId: null, hopWorkId: null,
      prevHopChildId: endedChildId, updatedAt: at,
    }, at, nextHop.prompt)
  }
  // T3：review/sync 入闸挂起（D24：write 跳恒走此路）。通知带上一跳结论摘要与
  // childId——主编三档审阅（摘要 / report_fetch 切片 / 全文）的自助取文入口。
  return suspendResult(chain, {
    cursor: next, state: 'suspended', suspendReason: nextHop.gate, hopChildId: null, hopWorkId: null,
    prevHopChildId: endedChildId, updatedAt: at,
  }, at, `[dsh-my-go] 链 ${chain.id} 跳 ${next + 1}/${chain.hops.length} (${nextHop.agent}) 挂起待审 [${nextHop.gate}]：上一跳 (${endedChildId}) ${String(conclusionExcerpt ?? '').slice(0, 120)}；细读 report_fetch childId=${endedChildId}，放行/驳回 chain_resolve`)
}

// ── 私有结果构造（保持返回形态恒定；idle 可携带解释性 facts）─────────────────
function idle(at, facts = {}) {
  return { decision: 'idle', patch: null, ops: [], notices: [], facts: { ...facts, at } }
}

function hopDispatch(chain, patch, at, instruction) {
  const hop = chain.hops[patch.cursor]
  return {
    decision: 'hop-dispatch',
    patch,
    // op 词表唯一成员：链派发 = 入队意图，数据面直投（board 取文 + 数据块包装）
    // 由 dispatcher 落地时补全（§3.1 时序），纯模块不做 I/O。
    ops: [{ op: 'enqueue-hop', chainId: chain.id, hopIndex: patch.cursor, agent: hop.agent, instruction }],
    notices: [],
    facts: { chainId: chain.id, cursor: patch.cursor, phase: 'hop-dispatch' },
  }
}

function suspendResult(chain, patch, at, text) {
  return {
    decision: 'suspend',
    patch,
    ops: [],
    notices: [{ target: 'owner', parentId: chain.parentSessionId, text }],
    facts: { chainId: chain.id, cursor: patch.cursor, phase: 'suspended', reason: patch.suspendReason },
  }
}

function failChain(chain, at, reason, event = {}) {
  const excerpt = typeof event.conclusionExcerpt === 'string' ? event.conclusionExcerpt.slice(0, 120) : ''
  return {
    decision: 'fail',
    patch: { state: 'failed', suspendReason: null, hopChildId: null, hopWorkId: null, updatedAt: at },
    ops: [],
    notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id} 失败于跳 ${chain.cursor + 1} (${chain.hops[chain.cursor]?.agent ?? '?'}): ${reason}${excerpt ? ` — ${excerpt}` : ''}` }],
    facts: { chainId: chain.id, cursor: chain.cursor, phase: 'failed', reason },
  }
}

// chain_resolve 分派（T5~T9；R-i/R-j/R-k 的纯函数面——工具层已校验，此处防御性
// 重述：任何不满足都以 idle + facts.error 收口，宁可不动不猜）。
function onResolve(chain, event, at) {
  if (chain.state !== 'suspended') return idle(at, { error: 'not-suspended' })
  const { decision, prompt, generationSettled } = event
  if (decision === 'abort') {
    // T7：链取消。链 abort 永不 interrupt 在飞子代（§4.2-③）——置空两键防该
    // 世代 end 误匹配（state 已 aborted 本就不命中，置 null 是纵深防御）。
    return {
      decision: 'abort',
      patch: { state: 'aborted', suspendReason: null, hopChildId: null, hopWorkId: null, updatedAt: at },
      ops: [],
      notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id} 已由主编裁决取消于跳 ${chain.cursor + 1}` }],
      facts: { chainId: chain.id, cursor: chain.cursor, phase: 'aborted' },
    }
  }
  if (decision !== 'continue') return idle(at, { error: 'bad-decision' })
  if (chain.suspendReason === 'fallback') {
    // T8（D10）：裁决对象 = 新世代（hopChildId 已在 T11 换绑）。
    if (generationSettled !== undefined) {
      // 赛跑自查（§4.2-③）：代际终局已落账（dispatcher 预查台账 history）——
      // 以该终局直接走推进核心。failed 终局（重派代际异常失败）→ 链死。
      if (generationSettled.failed === true) return failChain(chain, at, '裁决时代际已失败落账', generationSettled)
      return settleCurrentHop(chain, generationSettled, at)
    }
    // 未终局：换绑等待新世代 end（hopChildId 保持 T11 值）。
    return {
      decision: 'resume',
      patch: { state: 'running', suspendReason: null, updatedAt: at },
      ops: [],
      notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id} 跳 ${chain.cursor + 1} 已重绑世代 ${chain.hopChildId}，等待其终局继续推进` }],
      facts: { chainId: chain.id, cursor: chain.cursor, phase: 'resumed', generation: chain.hopChildId },
    }
  }
  // review / sync / gate-verdict / input-missing / restart：派发 cursor 跳
  // （review/gate-verdict = 放行下一跳；input-missing/restart = 重派受影响跳）。
  const hop = chain.hops[chain.cursor]
  if (!hop) return idle(at, { error: 'cursor-out-of-range' })
  const instruction = typeof prompt === 'string' && prompt.trim() !== '' ? prompt : hop.prompt
  // R-k：sync 恒现场必填；其余情形现场 ?? 预写，两者皆空 = 校验面失守，拒绝派发。
  if (typeof instruction !== 'string' || instruction.trim() === '') {
    return idle(at, { error: 'prompt-required', suspendReason: chain.suspendReason })
  }
  return hopDispatch(chain, {
    cursor: chain.cursor, // 挂起态 cursor 已指向待派发/待重派跳——patch 必须携带
    state: 'running', suspendReason: null, hopChildId: null, hopWorkId: null, updatedAt: at,
  }, at, instruction)
}

// T11（D10 裁决主格）：备选重派成功——链绑 childId 不绑槽位，hopChildId 换绑
// 新世代；主编不裁决链不动（suspended 恒态）。原世代 id 从此查不到链（E1 幽灵防线）。
function onFallbackRedeployed(chain, event, at) {
  if (chain.state !== 'pending-fallback') return idle(at, { error: 'not-pending-fallback' })
  const { newChildId } = event
  if (typeof newChildId !== 'string' || newChildId === '') return idle(at, { error: 'bad-generation' })
  return {
    decision: 'suspend-fallback',
    patch: { state: 'suspended', suspendReason: 'fallback', hopChildId: newChildId, hopWorkId: null, updatedAt: at },
    ops: [],
    notices: [{ target: 'owner', parentId: chain.parentSessionId, text: `[dsh-my-go] 链 ${chain.id} 跳 ${chain.cursor + 1} (${chain.hops[chain.cursor]?.agent ?? '?'}) 棒亡备选重派成功（新世代 ${newChildId}），链挂起等主编裁决 [fallback]（chain_resolve continue = 链绑新世代 / abort = 弃链，新世代自然跑完非链落账）` }],
    facts: { chainId: chain.id, cursor: chain.cursor, phase: 'suspended', reason: 'fallback', generation: newChildId },
  }
}

// ── 台账 v3 恢复归一（D12/D27/D28；broker 接线时由 loadLedger v3 分支调用）────
// 形态谓词：坏行一律整行拒收（warn 由调用方落），绝不做猜式修补——坏档空起步
// 不阻断加载（loadLedger v1→v2 兼容模式同款纪律）。
export function isChainRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (typeof row.id !== 'string' || row.id === '') return false
  if (typeof row.parentSessionId !== 'string' || row.parentSessionId === '') return false
  if (!Array.isArray(row.hops) || row.hops.length < RELAY_HOPS_MIN || row.hops.length > RELAY_HOPS_MAX) return false
  for (const hop of row.hops) {
    if (!hop || typeof hop !== 'object' || typeof hop.agent !== 'string' || hop.agent === '') return false
    if (hop.prompt !== undefined && typeof hop.prompt !== 'string') return false
    if (!RELAY_GATES.includes(hop.gate ?? 'auto')) return false
  }
  if (!Number.isInteger(row.cursor) || row.cursor < 0 || row.cursor > row.hops.length) return false
  if (!RELAY_CHAIN_STATES.includes(row.state)) return false
  if (row.suspendReason !== null && !RELAY_SUSPEND_REASONS.includes(row.suspendReason)) return false
  for (const key of ['hopWorkId', 'hopChildId']) {
    if (row[key] !== null && typeof row[key] !== 'string') return false
  }
  // prevHopChildId 可选（v3 早期档无此字段）：在场则必须 string|null——直投读板
  // 键，恢复时保留（board 在磁盘，restart 重派仍可直投）。
  if (row.prevHopChildId !== undefined && row.prevHopChildId !== null && typeof row.prevHopChildId !== 'string') return false
  return true
}

// 恢复归一（D28 裁决 + §5.3 精化，见文件头）。返回新记录（绝不 mutate 输入行）；
// 归一口径：
//   running            → suspended('restart')，两运行时键作废置 null（T17：在飞
//                        hop 的 end 不可跨进程复得，重派走全新 enqueue）
//   pending-fallback   → failed（评估窗口不可跨进程，机械终态 + 调用方 warn——
//                        比「挂着永不会被 resolve 的评估」诚实，§2.5）
//   suspended(fallback)→ hasSettledGeneration(hopChildId) 为真 → 原样保留
//                        （hopChildId 是 T8 自查键，台账 history 恢复后查询仍
//                        有效——文件头精化点）；为假 → suspended('restart') +
//                        hopChildId 作废（新世代已死，重派口径防换绑真空）
//   其余 suspended     → 原样（suspendReason/cursor/hops 保留），两运行时键置 null
//   done/failed/aborted→ 原样，两运行时键置 null
export function normalizeRestoredChain(row, { hasSettledGeneration, now } = {}) {
  if (!isChainRow(row)) return null
  const at = now ?? Date.now()
  const settled = typeof hasSettledGeneration === 'function' ? hasSettledGeneration : () => false
  const base = {
    id: row.id,
    parentSessionId: row.parentSessionId,
    hops: row.hops.map((h) => ({ agent: h.agent, prompt: h.prompt, gate: h.gate ?? 'auto' })),
    cursor: row.cursor,
    state: row.state,
    suspendReason: row.suspendReason ?? null,
    hopWorkId: null,
    hopChildId: row.hopChildId ?? null,
    prevHopChildId: row.prevHopChildId ?? null,
    createdAt: Number.isFinite(row.createdAt) ? row.createdAt : at,
    updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : at,
  }
  if (base.state === 'running') {
    return { ...base, state: 'suspended', suspendReason: 'restart', hopChildId: null, updatedAt: at }
  }
  if (base.state === 'pending-fallback') {
    return { ...base, state: 'failed', suspendReason: null, hopChildId: null, updatedAt: at }
  }
  if (base.state === 'suspended' && base.suspendReason === 'fallback') {
    if (typeof base.hopChildId === 'string' && settled(base.hopChildId)) return base
    return { ...base, state: 'suspended', suspendReason: 'restart', hopChildId: null, updatedAt: at }
  }
  return { ...base, hopChildId: null }
}
