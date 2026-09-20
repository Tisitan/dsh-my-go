/**
 * dsh-my-go — Sisyphus 编排面真源（preset / agent 半）。
 *
 * 本文件承载全部编排实现：随 preset/ 目录由 ensurePresetInstalled 整拷到
 * ~/.dsh/.agent-presets/dsh-my-go/tools/，在会话组装时挂载；host 半
 * （lib/index.js）自 0.3.0-tisitan.0 起只做存储/安装/面板 RPC，零编排工具面。
 *
 * 提供：
 *   - 编排六件套（仅本层注册，其他会话不可见）：go_work / continue /
 *     need_help / forward / orchestration_status / list_subagents
 *   - agent/created 双侧闸：子代理侧星型拓扑（禁派生工具 + 邻接消息三件套
 *     ADJACENT_BYPASS_TOOLS），主编排侧 deny skill + 同批邻接三件套
 *   - agent/request waterfall：按工种绑定 provider/model/reasoningEffort
 *   - subagent/end：归因决策在 shared/end-attribution.mjs（纯函数出 decision/ops/
 *     notices/facts），本文件只做挂载；结论落账 + 失败备选链重派 + 单线
 *     队列推进；台账跨重启持久化
 *   - settings 命名空间 'dsh-my-go' 只读（注册与写面在 host 半）
 *   - 面板快照经 globalThis[Symbol.for('dsh-my-go.snapshot')] 单向发布给 host 半
 *
 * 邻接投递统一走 preset/shared/adjacent.mjs 适配层（planAdjacentDelivery 一张
 * 路由表 + deliverToAdjacent / reportToParent / canQueueAdjacent / sessionEvents），
 * 按 alpha.2/3 ↔ alpha.4 方法存在性特性探测分界——升级顺序无关，两代 runtime 同跑。
 * continue/forward 的投递链（定位 / steer / abort / queued 投递 / 投递后复籍）
 * 由 ./broker-delivery.mjs 的五个共用件承担（resolveContinueTarget /
 * tryFacadeSteer / interruptForAbort / deliverWithQueueFallback /
 * rearmAfterDelivery），同步段 await 次数与原分支逐一对应——三条协议随簇写在该
 * 模块头。批次 5 拆分进度：5.1 = 台账 / 通知 / 能力缓存，5.2 = E2 缓冲 / disposed
 * 宽限期兜底 / 上述投递链，5.3 = 接力链 dispatcher（./broker-relay.mjs）/
 * persona·bootstrap（./broker-bootstrap.mjs，碰 ctx 的动作以回调注入、簇内纯组装）/
 * 工具注册块（./broker-tools.mjs，十具注册体 + agent/created 双侧闸），5.4 =
 * 调度核（./broker-scheduler.mjs：名册路由薄壳 / spawnChild / dispatchWork /
 * advanceQueue / scheduleQueueRetry / 队列重试定时器 / 停摆可观测——互递归环
 * advanceQueue↔dispatchWork 整体随迁、环内聚同一模块）与 end 管线
 * （./broker-ending.mjs：processEnd / finalizeEnd / 备选重派 / 报告补发链与贴身
 * helper）。两簇的双向边（dispatchWork 登记同步段调 processEnd 重放、end 各决策
 * 点调 advanceQueue 推进）用**相互回调注入**解——接线见下方两簇实例化处，
 * 模块 import 环为零。本体各在同级 ./broker-<簇>.mjs（工厂 + deps 显式注入），
 * 本文件只留接线与调用点，导出面（S-1 机器闸：host-parity 的 16 键快照断言）
 * 与运行行为逐名/逐字节不变。
 *
 * ── bump 快照枢纽纪律（5.4 裁决：bump 留守本体，不随任何簇迁出）──────────────
 * bump() 是面板快照的唯一刷新点（整树重聚合 + seq 自增），扇入约三十处——散布
 * 本体与兄弟簇家族，各簇一律经本枢纽回调注入消费。**任何新的编排状态写点
 * （改 orchestrations / childRegistry 各表、占槽换键、落账清槽）都必须同点调用
 * bump()，或走 orch.onChange（其内已 bump）**——漏调的后果是面板快照静默过期，
 * 没有任何测试会替你兜住这一类债。快照可见性（bump）与持久性（scheduleLedgerSave）
 * 是两条独立义务：改活状态时按需同点双调，参照 dispose/endbuffer/relay 各簇的
 * 既有写法。
 *
 * ── 声明序口径（5.4 重排，D-4 布局雷清除）───────────────────────────────────
 * apply() 按「声明先于使用」物理排布：活状态与 config 常量 → settings 块 →
 * 快照枢纽 bump 与本体留守件（orchFor / orchOfChild / findRecordEverywhere /
 * findHelpEverywhere / persistReportBoard，函数声明提前的动机是可读而非提升）→
 * ledger / notify / bootstrap → 调度簇 → 两枚宽限期簇 → delivery → end 簇 →
 * relay → tools → 生命周期 handlers。刻意保留的「值后取」只剩一类：**接线包壳
 * 闭包调用时才读属性**——调度簇 deps 的 processEnd / relay 两件 / claimBufferedEnd
 * 与 end 簇 deps 的 relayChainOnEnd / resolveChainFallback（两簇相互回调注入的
 * 正反向边，与 endbuffer/dispose 的 advanceQueue 直传方向互补），以及留守函数
 * 声明闭包体内对 scheduleLedgerSave 等后接线 const 的读取。前提：这些包壳与
 * 闭包全部只在接线段结束后（事件驱动 / 定时器驱动 / 工厂内部首回调在 loadLedger
 * await 之后）才被调用，接线段内零同步回调消费，故无 TDZ 窗口。新增接线若要在
 * 工厂构造期同步调用 deps，先回来读这一段。
 */

export const name = 'dsh-my-go-broker'

// 'agents' 入 inject：队列推进需按 parentId 重解析父会话对象；
// 'sessions' 入 inject：失败附因推送需读子会话事件档兜底（subagent/end
// 的通知层载荷丢失 error.message）。显式声明依赖保证服务在本 scope 可用
// （cordis ctx.get 仅沿 isolate 链可见）。
export const inject = ['tools', 'subagents', 'systemPrompt', 'llm', 'settings', 'agents', 'sessions']

import { SETTINGS_NAMESPACE } from '../shared/constants.mjs'
// ── shared 源（0.2.3-tisitan.15）：与 lib 半共用的纯函数单一源 ──────────────────
// broker 以 preset 内相对路径 import（../shared/），lib 以包内路径 import
// （../preset/shared/）——两种部署形态下路径均成立（preset/ 由
// ensurePresetInstalled 整拷，shared/ 随拷且安装后有存在性校验）。5.3 拆分后
// 同目录簇模块（relay / tools / bootstrap）也按各自消费面直引 shared 纯函数层；
// 5.4 波起调度核 / end 管线两簇同款（roles / misc / orchestration / report-
// format / failure / archive / adjacent / board 按簇消费面直引，本体 import 面
// 随之收窄到挂载期实际读到的件）。
import { mygoHome } from '../shared/paths.mjs'
import { mergeRoleBindings } from '../shared/roles.mjs'
import { Orchestration } from '../shared/orchestration.mjs'
import { createChildRegistry } from '../shared/child-registry.mjs'
import { defaultBindings, typeOfAgent, resolveEffectiveBinding } from '../shared/misc.mjs'
// 观测埋点（0.4.0-tisitan.0 步骤 0.1）：broker 本地模块（只有本文件消费，不进
// shared——避免无谓扩大单源守卫面）。事件 JSONL 追加写 + 行数 cap 截头，
// 任何 fs 异常在模块内部吞掉，编排热路径零感知（规划风险表 R0.1）。
import { createMetrics } from './metrics.mjs'
// broker 本地簇模块（5.1 拆分，对齐 metrics.mjs 先例的扁平文件形态）：依赖
// 单向（本文件 → 簇模块），簇模块绝不回 import broker.mjs，簇间亦零互引——
// 跨簇协作一律在本文件接线注入。5.1 = 台账 / 通知 / 能力缓存；5.2 = 宽限期两簇
// （disposed 兜底 / E2 缓冲）与 continue-forward 投递链共用件；5.3 = 接力链
// dispatcher（broker-relay）、persona/bootstrap（broker-bootstrap）与工具注册块
// （broker-tools，registerAllTools 工厂）；5.4 = 调度核（broker-scheduler）与
// end 管线（broker-ending），两簇的相互回调边在本文件接线段互穿包壳闭包解环。
import { createLedgerOps } from './broker-ledger.mjs'
import { createNotifyOps } from './broker-notify.mjs'
import { createCapabilityOps } from './broker-capability.mjs'
import { createDisposeFallbackOps } from './broker-dispose.mjs'
import { createEndBufferOps } from './broker-endbuffer.mjs'
import { createDeliveryOps } from './broker-delivery.mjs'
import { createRelayOps } from './broker-relay.mjs'
import { createBootstrapOps } from './broker-bootstrap.mjs'
import { registerAllTools } from './broker-tools.mjs'
import { createSchedulerOps } from './broker-scheduler.mjs'
import { createEndingOps } from './broker-ending.mjs'
// board 存储层（第一期 1.1）：1.5 落板兜底 persistReportBoard（本体留守，注入
// relay 簇与 end 簇补发链共用）；report_submit / report_fetch 的读写点在
// ./broker-tools.mjs（簇自 import）。「已落板」探测 hasBoardEntry 的消费点随
// 5.4 processEnd 迁入 ./broker-ending.mjs（簇自 import）。段名编码与根焊死都在
// shared/board.mjs 单点。
import { writeBoard, readBoardSlice } from '../shared/board.mjs'
// 容量钳制（二期 2.3 接线）：clampReadCapacity 在挂载期读 READ_POOL_SIZE 时用。
// laneOf 的派发侧消费点（dispatchWork / advanceQueue / stallHolder）随 5.4 迁入
// ./broker-scheduler.mjs（Orchestration 本体仍在上方 import，此处不重复声明）。
import { clampReadCapacity } from '../shared/orchestration.mjs'
// 接力链状态机（三期 3.2/3.3，relay-chain-semantics.md）的 dispatcher 本体随
// 5.3 迁入 ./broker-relay.mjs；摘要格式条款（第一期 1.2 单源）的两个消费点
// （REPORT_CLAUSE → spawnChild、REDISPATCH_RESUME_PREFIX → 备选重派）随 5.4
// 迁入调度核 / end 两簇，本文件不再 import report-format。

// 保持两半既有导出面（测试与外部消费者经由两半入口引用共享实现）。
export { Orchestration }
export { pruneLedgerParents, describeAgent, resolveEffectiveBinding } from '../shared/misc.mjs'
export { sessionEvents, deliverToAdjacent, canQueueAdjacent, reportToParent } from '../shared/adjacent.mjs'
export { projectKey, encodeSegment, readArchivedTurnFailure } from '../shared/archive.mjs'
export { normalizeTurnFailure, isFallbackable } from '../shared/failure.mjs'


export async function apply(ctx, config = {}) {
  // NOTE: ensurePresetInstalled runs from lib/index.js (npm package host
  // bundle), not here — when this file loads from the preset copy,
  // import.meta.url points to the copy, not the npm package source.

  // ══ 活状态与登记表（最先声明：一切簇接线都吃它的句柄）══════════════════════
  // 多会话编排隔离：每个 Sisyphus 编排会话一条独立流水线（队列/当前槽位/
  // 求助单/历史互不共享）， standing-scope 单例会让会话2的 go_work 被会话1
  // 的在跑子代理排队阻塞。Map 惰性创建，键为编排会话 id。
  const orchestrations = new Map()
  // 子代理侧进程内登记表：八张表的语义、镜像清理点、为何 retireChild 与
  // retireTypeRecords 不可互换——全部见 shared/child-registry.mjs 头注释（唯一出处）。
  // 本文件只按策略调用；5.4 拆分后本体侧直接消费面收窄为四件（sessionTypes /
  // childOwner 供生命周期 handlers 与 agent/request，abortExpected / modelCache
  // 供簇接线），pendingFallbackByLabel / fallbackDecided / disposedTypes 的裸表
  // 消费已整体迁入 end 簇（经同一 childRegistry 句柄），promoteFallback /
  // retireChild 等走方法。
  const childRegistry = createChildRegistry()
  const { sessionTypes, childOwner, abortExpected, modelCache } = childRegistry
  // 能力缓存簇（5.1 拆分 → ./broker-capability.mjs）：effortCache/modelCacheEpoch
  // 本体随簇迁入模块，实例化必须保持在 settings 块之前——本 apply 中段有 await
  // （loadLedger），settings/updated 若恰好在窗口里到达，处理器引用未初始化的
  // 接线 const 会撞 TDZ；失效入口 invalidateCaches 同理必须在处理器定义之前就位
  // （0.3.0-tisitan.7 N9/N10 时序约束）。modelCache 注入 childRegistry 的同一枚
  // Map 句柄（上方解构所得，不复制），llm 服务经回调逐点解析。
  const { supportedEfforts, modelExists, invalidateCaches } = createCapabilityOps({
    getLlm: () => ctx.get('llm'),
    modelCache,
  })

  // ══ config 常量（挂载期读一次，簇模块不碰 config）════════════════════════
  // DSH continuable 生命周期中 agent/disposed 恒先于 subagent/end（dispose
  // 内部 handle.dispose() 先于 observer.settle()，见 dsh-subagent finishDisposal）。
  // 因此活记录遭遇 disposed 时不能立即清槽——end 通常紧随而至，立即 abort 会让
  // 合法结论无处落账（0.2.3-tisitan.6 部署实测：正常完工的 explore 不进历史）。改为
  // 立墓碑 + 宽限期兜底：宽限期内 end 到达则正常 finish；end 真缺席才 abort
  // 清槽推进队列，防止队列永久冻结。兜底本体（表 + 三连落账）5.2 波迁出至
  // ./broker-dispose.mjs，接线见调度簇下方（grace 时长在此读 config 后注入）。
  const DISPOSE_END_GRACE_MS = config.disposeEndGraceMs ?? 500
  // 可观测性截断阈值（0.2.3-tisitan.8）：默认值即旧硬编码口径的放宽版，
  // 均可经插件 config 覆盖。failed 记录的结论不被 STATUS_CONCLUSION_MAX
  // 截断——错误信息必须完整到达 Sisyphus。
  const STATUS_HISTORY_LIMIT = config.statusHistoryLimit ?? 12
  const STATUS_CONCLUSION_MAX = config.statusConclusionMax ?? 400
  const HELP_CONTENT_MAX = config.helpContentMax ?? 240
  const SUBAGENT_PROMPT_MAX = config.subagentPromptMax ?? 200
  // 观测埋点开关（0.4.0-tisitan.0 步骤 0.1，D6 已裁决：第 0 期默认开——采基线是
  // 第一目的）。纯观测：只读既有状态快照组事件，零分支改动、零通知内容变化；
  // 落盘路径沿用台账惯例（DSH_HOME || ~/.dsh）/dsh-my-go/metrics/events.jsonl。
  const METRICS = createMetrics({
    dir: mygoHome('metrics'),
    enabled: config.metrics ?? true,
  })
  // 卸载收尾：排空在飞写入链（close 幂等，fire-and-forget——卸载路径不等异步，
  // 观测日志容忍尾巴，绝不阻塞卸载；与台账 closeLedger 同点职责、宽松一档）。
  ctx.effect(() => () => { void METRICS.close() }, 'dsh-my-go-broker.metrics()')
  // 报告提交制开关（第一期，D5 已裁决一期默认开）：关 → report_submit 不注册、
  // 提交闸门不启用、条款不注入——三条同闸。config 在会话组装期固定，
  // 挂载时读一次即可，不做运行时切换（规划 1.7 只补 agent.cordis.yml 与文档）。
  const REPORT_EXT = config.reportExternalization ?? true
  // 读平面并发容量（二期 2.3 接线，D5 已裁决）：?? 1 = 关闭 = 全局单线现状；
  // 2~3 启用读池（>3 钳制 3，钳制在 clampReadCapacity 内）。挂载期读一次，
  // 与 REPORT_EXT 同律不做运行时切换——orchFor 创建实例时注入。
  const READ_POOL_SIZE = clampReadCapacity(config.readPoolSize ?? 1)
  // 接力链开关（三期 3.3，D5 三期默认关口径）：关 = chain_start/chain_resolve
  // 不注册。与 REPORT_EXT 同律挂载期读一次，不做运行时切换。
  const RELAY_CHAINS = config.relayChains ?? false
  // E2 缓冲 grace（二期 2.4，D16 已裁决独立键）：抢跑 end 暂存后等 spawn 登记
  // 追上的宽限，超时按「无从归属」落档 + 占位审计回收。等的是 spawn 网络窗口
  // （天然长于 disposed 宽限的进程内事件赛跑），故不复用 DISPOSE_END_GRACE_MS。
  const SPAWN_END_GRACE_MS = config.spawnEndGraceMs ?? 2000
  // 队列重试线性退避基数（5.4 声明重排：读取上移到 config 段，值注入调度簇；
  // 重试上限 QUEUE_RETRY_MAX 是簇内协议常量，随簇落位 broker-scheduler.mjs）。
  const QUEUE_RETRY_BASE_MS = config.queueRetryBaseMs ?? 1000
  // 合并基线：默认值 + 插件 config。settings 覆盖永远从基线起算，
  // 这样 WebUI 取消某字段后能正确回落默认，而不是残留旧的已合并值。
  const baseBindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  let bindings = { ...baseBindings }
  const bindSisyphus = config.bindSisyphus === true

  // Track authorized orchestrators: any agent on this preset that is NOT
  // a sub-agent (has no parentSession) can use orchestration tools.
  // We do NOT use "first caller" — that breaks multi-session environments.
  const isSubAgent = (agent) => {
    if (!agent || typeof agent.id !== 'string') return false
    return agent?.session?.header?.parentSession != null
  }
  const canOrchestrate = (agent) => agent && typeof agent.id === 'string' && !isSubAgent(agent)

  // ══ settings-backed bindings（WebUI 可配；只读面）════════════════════════
  // NOTE: the settings namespace 'dsh-my-go' is registered by the host bundle
  // (lib/index.js). We only READ from it here — do NOT re-register it
  // or it throws "already registered".
  const settings = ctx.get('settings')
  if (settings !== undefined) {
    try {
      const stored = settings.get(SETTINGS_NAMESPACE)
      if (stored && typeof stored === 'object') {
        bindings = mergeRoleBindings(baseBindings, stored)
      }
      ctx.on('settings/updated', (ns) => {
        if (ns !== SETTINGS_NAMESPACE) return
        const next = settings.get(SETTINGS_NAMESPACE)
        if (next && typeof next === 'object') {
          bindings = mergeRoleBindings(baseBindings, next)
          // 模型能力缓存随绑定热更整体失效（5.1 拆分后三连收一线；注释细节
          // 在 broker-capability.mjs 的 invalidateCaches）：modelCache 根治
          // （0.3.0-tisitan.4，provider 模型清单随热更失效）+ epoch 自增作废
          // 在飞 listModels（0.3.0-tisitan.7 N9）+ effortCache 清空（N10）。
          invalidateCaches()
        }
      })
    } catch (e) {
      console.error('[dsh-my-go] settings load error:', e)
    }
  }

  // ══ 快照枢纽与本体留守件（声明先于一切工厂接线；bump 纪律见文件头）═══════
  // ── snapshot state (used by connection.rpc handlers in lib/index.js) ──────
  let latestSnapshot = null
  let snapshotSeq = 0
  // 多会话聚合形状：{ seq, parents: { [parentSessionId]: { parentSessionId,
  // current, queue, helpRequests, history } } }。任一实例变化都整树重聚合
  // （实例数 = 活跃编排会话数，量级小，聚合开销可忽略）。
  const bump = () => {
    snapshotSeq += 1
    const parents = {}
    for (const [pid, orch] of orchestrations) {
      parents[pid] = { parentSessionId: pid, ...orch.snapshot() }
    }
    latestSnapshot = { seq: snapshotSeq, parents }
  }
  // 惰性获取/创建某编排会话的流水线实例；每个实例的 onChange 同时驱动
  // 快照 bump 与台账防抖落盘。
  function orchFor(parentId) {
    let orch = orchestrations.get(parentId)
    if (!orch) {
      orch = new Orchestration({ readCapacity: READ_POOL_SIZE })
      orch.onChange(() => bump())
      orch.onChange(() => scheduleLedgerSave())
      orchestrations.set(parentId, orch)
    }
    return orch
  }
  // 子代理 → 属主流水线：childOwner 优先；未登记（如 disposed 已清除、台账
  // 复活的边缘情况）时全局扫描所有实例的活记录与历史兜底。
  function orchOfChild(childId) {
    const ownerId = childOwner.get(childId)
    if (ownerId !== undefined) {
      const orch = orchestrations.get(ownerId)
      if (orch) return { orch, parentId: ownerId }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch.record(childId)) return { orch, parentId: pid }
    }
    return undefined
  }
  // continue/forward 的 record 查找：先查调用方实例，找不到再全局扫描所有
  // 实例（兼容台账复活与跨会话边缘情况）。
  function findRecordEverywhere(childId, preferred, preferredPid) {
    if (preferred) {
      const rec = preferred.record(childId)
      if (rec) return { orch: preferred, parentId: preferredPid, record: rec }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch === preferred) continue
      const rec = orch.record(childId)
      if (rec) return { orch, parentId: pid, record: rec }
    }
    return undefined
  }
  function findHelpEverywhere(helpId, preferred) {
    if (preferred) {
      const help = preferred.help(helpId)
      if (help) return { orch: preferred, help }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch === preferred) continue
      const help = orch.help(helpId)
      if (help) return { orch, parentId: pid, help }
    }
    return undefined
  }
  // 全文落板兜底（1.5 优雅降级底座）：report_submit 已落板则跳过（board 上的
  // 是完整报告，finalize 的 lastAssistantMessage 只是摘要块，覆盖即退化）；未落
  // 过 → 落最后消息全文。失败只 warn——落板是降级底座，绝不改变编排终局流程。
  //
  // 红线（维护者裁决：接受保守漂移，不改 dump 锚）：本函数在 verdict / repair-failed
  // 路径上会给**从未成功提交报告**的儿童也落一块板。自那以后闸门的板兜底
  // （hasBoard）对该 childId 恒真——它若被复活重跑且仍不交报告，一律走
  // pass-board-fallback 直通，**不再发射第二次补发**。这是「骚扰过一次就不再骚扰」
  // 的故意取向：补发的意义在第一次提醒，反复唤醒一个顽固不交的子代只会冻结流水线。
  // 统计口径靠 phase 分开（'pass' 真登记 / 'pass-board-fallback' 仅板命中 /
  // 'verdict' 转裁决），看板观测时不要把 pass-board-fallback 当成干净直通。
  //
  // 留守裁决（5.3 B2，5.4 复核维持）：本体侧落板底座，end 簇补发链三处兜底与
  // relay 簇直投共用——注入两兄弟簇消费（随迁会让 relay 的注入源变成兄弟簇，
  // 破坏「簇间零互引」）；消费方只认这里的落盘语义。
  async function persistReportBoard(sessionId, childId, fullText) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (typeof fullText !== 'string' || fullText === '') return
    try {
      const existing = await readBoardSlice(sessionId, childId, 0, 1)
      if (!existing.error) return
      await writeBoard(sessionId, childId, fullText)
    } catch (error) {
      console.warn(`[dsh-my-go] 报告落板失败 (${sessionId}/${childId}): ${String(error)}`)
    }
  }

  // ══ 簇接线（按上方文件头声明序排布）══════════════════════════════════════
  // 台账簇接线（5.1 拆分 → ./broker-ledger.mjs）：防抖/串行写/卸载同步落盘的
  // 本体在工厂内；状态持有者（orchestrations）与回调（orchFor /
  // findRecordEverywhere / bump）、常量（ledgerPath）显式注入。5.4 重排后
  // orchFor / findRecordEverywhere 是上方留守函数声明，本工厂不再依赖提升取值；
  // 工厂对 orchFor 的存储发生在其首次被调用（loadLedger）之前，纪律不变。
  const ledgerPath = mygoHome('orchestration-ledger.json')
  const { loadLedger, scheduleLedgerSave, findRecordWithLedgerFallback, closeLedger } = createLedgerOps({
    ledgerPath,
    orchestrations,
    orchFor,
    findRecordEverywhere,
    bump,
  })

  // ── 跨平面快照桥 ────────────────────────────────────────────────────────
  // agent 平面（本插件，实际编排发生地）与 host 半（lib/index.js，持
  // connection.rpc 服务端）在同一 Node 进程但分属不同 cordis scope，
  // 无法直接共享模块状态。通过 Symbol.for 全局注册表发布只读快照访问器，
  // host 半的 RPC 层优先读取它；若不在同一进程（未来架构变化），host 半
  // 自动回落到自身状态机，行为与现在一致、无回归。
  globalThis[Symbol.for('dsh-my-go.snapshot')] = () => latestSnapshot

  // ── 编排台账持久化（接线；本体在 ./broker-ledger.mjs，5.1 拆分）──────────────
  // history 记录落盘/读回（v1/v2/v3 恢复归一 + chains 桶）、防抖串行写、卸载
  // 同步落盘的完整语义见 broker-ledger.mjs 模块头；此处只保留挂载与卸载两个
  // 时点的接线。
  await loadLedger()
  bump() // 保证快照桥首读即拿到完整 { seq, parents } 形状
  // 插件卸载收尾（0.3.0-tisitan.7 N8）：有 pending 防抖就同点做完这次写——
  // 撤定时器 → 作废在飞异步链 → 同步落最新 payload（closeLedger；「只
  // clearTimeout 会丢掉最后一次完工」的完整理由见模块内 closeLedger 头注释）。
  ctx.effect(() => () => { closeLedger() }, 'dsh-my-go-broker.ledger()')
  // ── 父会话补充通知（接线；本体在 ./broker-notify.mjs，5.1 拆分）─────────────
  // harness 的 inject 通道说明见模块头注释。agents 注册表经回调逐点读取，
  // METRICS（notifyParent 的 inject 字节埋点，0.4.0-tisitan.0）单点透传。
  const { notifyParent, resolveParentAgent, notifyOwner, notifyClearedHelp } = createNotifyOps({
    getAgents: () => ctx.get('agents'),
    metrics: METRICS,
  })
  // ── persona / prompt 缓存 / DSV4P0813 bootstrap 簇接线（5.3 拆分；本体在
  // ./broker-bootstrap.mjs）─────────────────────────────────────────────────────
  // promptCache / loadPrompt / sharedLoadAllPrompts 预热、persona·orchestration·
  // roster 三段的组装（宿主代双分支探测随簇走）、DSV4P0813 两段式晋升（session/
  // event 判据 + assemble 过滤）整体迁入模块。本簇是「碰 ctx 的动作以回调注入、
  // 簇内只做纯组装」口径的实现：effect / registerSection / getSectionOrder / on
  // 四件在此各包一层，注册时机、effect 名、段定义与两代分支逐字节不变；
  // sessionTypes 传活句柄（roster 段儿童门控 + assemble 工种解析），bindings 经
  // getter 现读（settings/updated 整表重建后必须看到新值，与原闭包直读时点一致）。
  // 5.4 重排注：本簇接线点前移到调度簇之前（其产物 promptCache/loadPrompt 是
  // 调度簇 rolePersona 的注入源）——工厂体内只有纯组装与 fire-and-forget 预热，
  // 位移不改变任何注册序/时序。
  const { promptCache, loadPrompt } = createBootstrapOps({
    effect: (fn, name) => ctx.effect(fn, name),
    registerSection: (def) => ctx.systemPrompt.section(def),
    getSectionOrder: (key) => ctx.systemPrompt?.getSectionOrder?.(key),
    on: (event, handler) => ctx.on(event, handler),
    sessionTypes,
    getBindings: () => bindings,
  })
  // ── 调度核簇接线（5.4 拆分；本体在 ./broker-scheduler.mjs）──────────────────
  // 名册路由薄壳（rosterKeys / rolePersona / resolveRoleToolFilter / liveToolNames）、
  // spawnChild 唯一派发出口、dispatchWork / advanceQueue / scheduleQueueRetry 与
  // queueRetryTimers（互递归环整体随迁、环内聚在簇内）、两枚停摆可观测件
  // （buildStallNotice / stallHolder——T1 消费方是 end 簇，经下方转注）迁入模块。
  // 相互回调注入的正向半边：processEnd（end 簇产物，此刻尚未实例化）与
  // relay 两件、claimBufferedEnd（endbuffer 产物，接线点在下方）都包成调用时
  // 读属性的闭包——前提见文件头「声明序口径」段。反向半边（advanceQueue 被
  // endbuffer / dispose / relay / end 四路消费）因本簇先实例化，全部直传取值。
  const {
    dispatchWork, advanceQueue, rosterKeys, liveToolNames,
    spawnChild, buildStallNotice, clearQueueRetryTimers, cancelQueueRetryTimer,
  } = createSchedulerOps({
    childRegistry,
    getBindings: () => bindings,
    getAgents: () => ctx.get('agents'),
    getTools: () => ctx.get('tools'),
    getSubagents: () => ctx.subagents,
    orchFor,
    bump,
    metrics: METRICS,
    notifyParent,
    modelExists,
    promptCache,
    loadPrompt,
    claimBufferedEnd: (childId) => claimBufferedEnd(childId),
    processEnd: (info) => processEnd(info),
    backfillHopOnArrival: (queuedWork, childId) => relay.backfillHopOnArrival(queuedWork, childId),
    handleQueueWorkDropped: (orch, work, error) => relay.handleQueueWorkDropped(orch, work, error),
    REPORT_EXT,
    SUBAGENT_PROMPT_MAX,
    HELP_CONTENT_MAX,
    QUEUE_RETRY_BASE_MS,
  })
  // ── 两枚宽限期簇接线（5.2 拆分；本体在 ./broker-dispose.mjs 与
  // ./broker-endbuffer.mjs）─────────────────────────────────────────────────
  // 两簇结构同构（Map + grace 定时器 + 超时三连落账）但刻意分成两模块各守一条
  // 红线（详见 broker-dispose.mjs 头注释的取舍段）。实例化需要的 notifyClearedHelp /
  // bump / advanceQueue 三件回调在上方都已就位——advanceQueue 随 5.4 迁调度簇，
  // 本波重排把两簇接线点移到调度簇之后，直传取值，原先「函数声明提升才安全」的
  // 布局雷（D-4）就此消掉。grace 时长仍在上方 config 段读取后注入（配置口径集中
  // 在 broker 本体，簇模块不碰 config）。
  const { scheduleDisposeFallback, cancelDisposeFallback, clearDisposeFallbackTimers } = createDisposeFallbackOps({
    graceMs: DISPOSE_END_GRACE_MS,
    abortExpected,
    childRegistry,
    notifyClearedHelp,
    bump,
    advanceQueue,
  })
  const { bufferEnd, claimBufferedEnd, clearEndBuffer } = createEndBufferOps({
    graceMs: SPAWN_END_GRACE_MS,
    metrics: METRICS,
    orchestrations,
    abortExpected,
    childRegistry,
    notifyClearedHelp,
    bump,
    advanceQueue,
  })
  // 插件卸载时清理重试定时器，并同点撤掉两枚宽限期簇的在飞定时器（5.2 拆分后
  // 表本体随簇迁入模块，收尾走各自导出的 clear*；5.4 波调度簇同款
  // clearQueueRetryTimers——同一枚 effect 名，注册序不变）
  ctx.effect(() => () => {
    clearQueueRetryTimers()
    clearDisposeFallbackTimers()
    clearEndBuffer()
  }, 'dsh-my-go-broker.queueRetry()')
  // ── continue/forward 投递链共用件（5.2 拆分；本体在 ./broker-delivery.mjs）─────
  // M1-M5 五件（定位 / 门面 steer / abort 掐断 / queued 投递 / 投递后复籍）连同
  // **同步段承诺**三条协议整体迁入模块（协议文本随簇走，改动前先读该模块头）。
  // 这里只剩接线：台账兜底查找与两件通知件从兄弟簇实例取（工厂产物不可 import，
  // 注入即单向依赖），活状态三件（orchestrations / abortExpected / childRegistry）
  // 传句柄，服务面两件（agents 注册表 / subagents 门面）传回调保持逐调用现取——
  // 与原实现读 ctx 的时点一致。coordinatorSource 随簇转为模块内私有（broker 半
  // 再无第二个消费点）。工具注册块（下方）的调用点与参数逐名不变。
  const { resolveContinueTarget, tryFacadeSteer, interruptForAbort, deliverWithQueueFallback, rearmAfterDelivery } = createDeliveryOps({
    getAgents: () => ctx.get('agents'),
    getSubagents: () => ctx.subagents,
    orchestrations,
    abortExpected,
    childRegistry,
    findRecordWithLedgerFallback,
    resolveParentAgent,
    notifyParent,
  })
  // ── end 管线簇接线（5.4 拆分；本体在 ./broker-ending.mjs）─────────────────────
  // processEnd（subagent/end dispatcher：缓冲闸、归因快照、ops/notices 落地、
  // 按 decision 起执行链、按 facts.advance 推进队列）与 finalizeEnd /
  // attemptFallbackRedeploy / attemptReportRepair / readTurnFailure /
  // pickFallbackEntry 整体迁入模块（归因三条协议仍见 shared/end-attribution.mjs
  // 文件头）。相互回调注入的反向半边：调度簇三件（advanceQueue / spawnChild /
  // buildStallNotice）此刻已就位直传；relay 两件在下方才实例化，包调用时读属性
  // 的闭包（同上方调度簇口径）。persistReportBoard 按 5.3 B2 裁定留守本体，
  // 以回调注入本簇。dispose / endbuffer / delivery / notify / capability 各簇
  // 产物按消费面转注；sessions 服务经回调逐调用现取（readTurnFailure 的 live
  // 快路径，与原读 ctx 时点一致）。
  const { processEnd } = createEndingOps({
    childRegistry,
    orchestrations,
    getBindings: () => bindings,
    orchOfChild,
    resolveParentAgent,
    notifyParent,
    notifyOwner,
    notifyClearedHelp,
    bump,
    metrics: METRICS,
    modelExists,
    advanceQueue,
    spawnChild,
    buildStallNotice,
    cancelDisposeFallback,
    bufferEnd,
    claimBufferedEnd,
    deliverWithQueueFallback,
    relayChainOnEnd: (orch, ownerPid, childId, payload) => relay.relayChainOnEnd(orch, ownerPid, childId, payload),
    resolveChainFallback: (orch, childId, verdict) => relay.resolveChainFallback(orch, childId, verdict),
    persistReportBoard,
    getSessions: () => ctx.get('sessions'),
    REPORT_EXT,
    SUBAGENT_PROMPT_MAX,
  })
  // ── 接力链 dispatcher 簇接线（5.3 拆分；本体在 ./broker-relay.mjs）───────────────
  // composeRelayPrompt / landHopOps / relayAdvanceHops / relayChainOnEnd /
  // runChainTransition / chainDeclarationError / resolveChainFallback 与反查表
  // chainHopsByWork 整体随簇迁入模块（调用方协议三条仍见 shared/relay-chain.mjs
  // 文件头）。跨簇协作件全部经本处注入——notifyOwner / resolveParentAgent 取 notify
  // 簇工厂产物，bump / scheduleLedgerSave / persistReportBoard 是本体侧的快照广播、
  // 台账防抖与落板兜底，advanceQueue 随 5.4 换源调度簇工厂产物（5.4 重排后全部
  // 在接线序前就位，直传取值，消掉原提升依赖）。反向两条边（本簇终局支调
  // advanceQueue、调度簇/end 簇消费 backfillHopOnArrival / handleQueueWorkDropped /
  // relayChainOnEnd / resolveChainFallback）已由上方两处包壳闭包承接，成环面为零。
  // 决策件（advanceChain / match* / reconcile* / readBoardSlice / RELAY_CLAUSE）
  // 由簇直引 shared 纯函数层；簇间零互引、零回引本体，与 5.1/5.2 各簇同律。
  const relay = createRelayOps({
    notifyOwner,
    resolveParentAgent,
    bump,
    scheduleLedgerSave,
    advanceQueue,
    metrics: METRICS,
    persistReportBoard,
  })
  const { runChainTransition, chainDeclarationError, releaseHopHolds, clearChainHops } = relay
  // 卸载收尾（新簇「卸载走 clear*」闸口径）：反查表条目与挂载实例同寿，清理行为
  // 中性，守的是「簇状态只经簇口回收」这条线（同 queueRetry/ledger 的 effect 惯例）。
  ctx.effect(() => () => { clearChainHops() }, 'dsh-my-go-broker.chainHops()')

  // ── tools（5.3 拆分；本体在 ./broker-tools.mjs）────────────────────────────────
  // 十具工具的注册体（含 report_submit/report_fetch 随 REPORT_EXT、chain_start/
  // chain_resolve 随 RELAY_CHAINS 的条件注册，及 agent/created 双侧 deny 闸与其随
  // 注册开关联动的名单口径）整体迁入模块，本处只剩接线：服务面四件包回调
  // （registerTool / on / getSubagents / getAgentTools——agent.ctx.tools 的读取点
  // 留在 broker 侧包一层，闸体对未 ready agent 的抛错仍落簇内同一个 try，N12 留痕
  // 口径不变）；活状态传句柄（orchestrations / sessionTypes / childRegistry /
  // abortExpected，Map/Set 本体不复制）；闭包可变值经 getter 现读（getBindings：
  // settings/updated 整表重建后 roster 行投影必须看到新值）；delivery / relay 两簇
  // 的工厂产物与本体侧共用件转注；5.4 波起调度核产物（dispatchWork /
  // rosterKeys / liveToolNames）同路径转注。挂载期固化的开关与截断常量按值注入。
  // 注册时序与原实现一致：工具与 agent/created 闸接在 delivery/relay 接线之后、
  // 生命周期 handlers（agent/disposed 等）之前。
  registerAllTools({
    registerTool: (tool) => ctx.tools.register(tool),
    on: (event, handler) => ctx.on(event, handler),
    getSubagents: () => ctx.subagents,
    getAgentTools: (agent) => agent.ctx.tools,
    liveToolNames,
    isSubAgent,
    canOrchestrate,
    dispatchWork,
    orchFor,
    orchOfChild,
    findHelpEverywhere,
    rosterKeys,
    orchestrations,
    sessionTypes,
    childRegistry,
    abortExpected,
    bump,
    metrics: METRICS,
    getBindings: () => bindings,
    notifyParent,
    notifyOwner,
    resolveParentAgent,
    resolveContinueTarget,
    tryFacadeSteer,
    interruptForAbort,
    deliverWithQueueFallback,
    rearmAfterDelivery,
    runChainTransition,
    chainDeclarationError,
    REPORT_EXT,
    RELAY_CHAINS,
    READ_POOL_SIZE,
    HELP_CONTENT_MAX,
    STATUS_HISTORY_LIMIT,
    STATUS_CONCLUSION_MAX,
    SUBAGENT_PROMPT_MAX,
  })

  // ── 生命周期清理：会话/代理销毁时回收编排状态，防止跨会话泄漏 ──────────
  ctx.on('agent/disposed', ({ agent }) => {
    const id = agent?.id
    if (!id) return
    // 经 childOwner 路由到属主实例；未登记时全局扫描活记录兜底
    const owned = orchOfChild(id)
    childOwner.delete(id)
    if (owned && owned.orch.currentMap.has(id)) {
      // 正常完工路径上 disposed 恒先于 subagent/end 到达：只立墓碑并挂
      // 宽限期兜底，活记录留给紧随的 end 正常落账；end 缺席才由兜底清槽。
      childRegistry.tombstoneType(id)
      scheduleDisposeFallback(id, owned.orch, owned.parentId)
    } else if (childRegistry.tombstoneType(id)) {
      bump()
    }
  })

  ctx.on('session/disposed', (session) => {
    const id = session?.id
    if (!id) return
    const orch = orchestrations.get(id)
    if (!orch) return
    // Sisyphus 编排会话被删除：整条流水线随之销毁（队列/当前槽位/求助单
    // 全清，实例摘出 Map），并清除其子代理的属主登记与兜底定时器，
    // 避免悬挂到永远不会来的父会话
    for (const cid of orch.currentMap.keys()) {
      childOwner.delete(cid)
      cancelDisposeFallback(cid)
    }
    for (const help of orch.helpRequests.values()) childOwner.delete(help.childId)
    // 链桶同点清（三期 3.5，§5.2/D27）：非终态链（running/suspended/
    // pending-fallback）绝不无声悬挂——每链 warn + metrics 'aborted-by-dispose'
    // 双留痕后清空；台账桶随 ledgerPayload 空桶不写而消失（D27：主编会话已灭，
    // 链账无消费方，不留 aborted 行）。终态链清掉即可，无留痕面。
    for (const chain of orch.chains) {
      if (['done', 'failed', 'aborted'].includes(chain.state)) continue
      console.warn(`[dsh-my-go] relay chain ${chain.id} aborted-by-dispose: owner session ${String(id)} disposed at hop ${chain.cursor + 1}/${chain.hops.length} [${chain.state}${chain.suspendReason ? ':' + chain.suspendReason : ''}]`)
      METRICS.record({ kind: 'relay-chain', phase: 'aborted-by-dispose', chainId: chain.id, cursor: chain.cursor, sessionId: id })
    }
    // 移交①（3.4 → 3.5）：spawn 悬挂残余的回填表项同点清理——该 orch 排队
    // work 的占位键还挂在 relay 簇的反查表里（dispatchWork 未走到回填），实例销毁
    // 后永远不会被消费，逐条摘除防累积（5.3 拆分后表本体随簇，走语义操作）。
    releaseHopHolds(orch)
    orch.queue = []
    orch.currentMap.clear()
    orch.helpRequests.clear()
    orch.chains = []
    orchestrations.delete(id)
    // 该实例的队列重试定时器同点摘除（5.4 拆分后表本体随调度簇，走簇口语义，
    // 与原三行裸操作逐字节同语义）
    cancelQueueRetryTimer(orch)
    bump()
    scheduleLedgerSave()
  })

  // ── model/effort binding at the request waterfall（接线；本体在
  // ./broker-capability.mjs，5.1 拆分）────────────────────────────────────
  // reasoningEffort 的档位判定（supportedEfforts）与模型校验（modelExists）
  // 连同 effortCache/modelCacheEpoch 随簇迁出；实例化在 settings 块上方
  // （N9/N10 时序约束），失效接线 settings/updated → invalidateCaches()。

  ctx.on('agent/request', async (payload, next) => {
    const seed = await next()
    const agent = payload?.agent
    if (!agent) return seed
    const type = typeOfAgent(sessionTypes, agent)
    if (type === undefined && !bindSisyphus) return seed
    // 备选重派儿童以登记表为准（只换 provider/model，保留工种 reasoningEffort/
    // fallbacks 等其余字段）；spawn 解析前窗口按 label 命中 pending 登记
    //（棒2-Z2，优先级回退在 child-registry 内实现）；常规派发无登记 → 原样 bindings[type]
    const override = childRegistry.fallbackOverrideFor(agent.id, agent?.session?.header?.label)
    const binding = resolveEffectiveBinding(bindings[type ?? 'sisyphus'] ?? {}, override)
    const nextConfig = { ...seed }
    if (binding.provider !== undefined) nextConfig.provider = binding.provider
    if (binding.model !== undefined) {
      // Validate model exists on the resolved provider before applying
      const resolvedProvider = String(nextConfig.provider ?? seed.provider ?? '')
      const exists = resolvedProvider ? await modelExists(resolvedProvider, binding.model) : false
      // 降噪：正常路径静默，只在绑定模型校验不过时告警（每请求 console.log 太吵）
      if (!exists && resolvedProvider) {
        console.warn(`[dsh-my-go] agent/request: model "${String(binding.model)}" not found on provider "${resolvedProvider}"; keeping the seed model`)
      }
      if (exists) {
        nextConfig.model = binding.model
      }
    }
    const desiredEffort = binding.reasoningEffort
    if (desiredEffort !== undefined && desiredEffort !== null) {
      const provider = String(nextConfig.provider ?? binding.provider ?? '')
      const model = String(nextConfig.model ?? binding.model ?? '')
      const efforts = await supportedEfforts(provider, model)
      if (efforts !== null && efforts.has(String(desiredEffort))) {
        nextConfig.reasoningEffort = desiredEffort
      }
      // Unsupported or unknown → leave reasoningEffort unset (adapter default).
    }
    return nextConfig
  })

  // ── conclusion injection + queue advancement on subagent/end ────────────
  // 归因决策与执行链本体在 ./broker-ending.mjs（5.4 拆分；注册时机与载荷转发
  // 逐字节不变：ctx.on 仍接在全部生命周期件之后）。once-guard / 推进时机 /
  // 终局真空三条协议见该模块头与 shared/end-attribution.mjs 文件头。
  ctx.on('subagent/end', (info) => processEnd(info))
}
