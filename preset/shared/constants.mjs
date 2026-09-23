/**
 * dsh-my-go — shared constants (single source for both runtime halves).
 *
 * Imported by preset/tools/broker.mjs (relative path inside preset/) and
 * lib/index.js (in-package path into preset/shared/). The preset/ tree is
 * read in place from the installed package (0.1.7: no preset-directory copy),
 * so one relative layout serves every deployment form.
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * constants only.
 */

export const AGENT_TYPES = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle', 'apelles']

export const AGENT_TYPE_PREFIX = 'dsh-my-go:'

// 键名约束与工种 label 提取正则同构：小写字母开头、只含小写与连字符。
// 数字/下划线/大写必须在 schema 层拒绝——进入存储后 label 正则会静默
// 不匹配，排查成本远高于写入时报错。
export const ROLE_KEY_PATTERN = /^[a-z][a-z-]*$/

// "{provider}/{model}" usage-price keys split at the FIRST "/" only: anchoring
// provider as [^/]+ keeps model-side slashes (OpenRouter-style ids like
// "openrouter/deepseek/deepseek-chat") unambiguous — a looser pattern would
// make "a/b/c" rows misattribute at aggregation time.
export const PRICE_KEY_PATTERN = /^[^/]+\/.+/

// 编排状态兜底闸（0.2.3-tisitan.15）：正常路径自会清理（finish 即删、history 自截断），
// 下面三枚上限只为异常路径兜底——end 事件永久缺席的滞留记录（CURRENT_MAP_CAP）、
// 属主会话无限累积（LEDGER_PARENTS_CAP）、单桶 history 无界增长（HISTORY_CAP）。
// v1 不做配置化，避免 settings schema 面膨胀。
export const CURRENT_MAP_CAP = 500
// 桶数上限（台账 parents 保留多少个属主会话）——与 HISTORY_CAP 是两个维度
export const LEDGER_PARENTS_CAP = 200
// 每桶 history 行数上限：单个属主会话保留多少条完成记录（内存实例与落盘
// 账本同口径，orchestration 自截断 + broker 读写两侧共用）
export const HISTORY_CAP = 200

// Code Mode 保留传输名：不进 schemas() 视图、服务端过滤不可屏蔽，也不是可
// 派生的编排对象——花名册与角色工具过滤清单都按名剔除（lib 半与 broker 半同源）。
export const RUN_CODE_TOOL = 'run_code'

// 本插件注册的编排工具名：schemas() 无参只返回全局层视图（内建 + MCP），
// preset 层的自产工具不在其中——toolFilter 合法引用它们时不能误杀。
// 0.4.0 线第一期追加 report_submit / report_fetch（规划 1.3 名单一次登记两个
// 名字；report_fetch 工具本体随 1.6 注册，名单先行对未注册名无实害——两处
// 消费点（roles 过滤 / liveToolNames）只是「允许 toolFilter 合法引用」）。
// 0.4.0 线第三期追加 chain_start / chain_resolve（D11 工具对；本体随 3.3 注册，
// relayChains 缺省关——名单先行与 report_fetch 同款「无实害」口径）。
export const SELF_REGISTERED_TOOLS = ['go_work', 'continue', 'need_help', 'forward', 'orchestration_status', 'list_subagents', 'report_submit', 'report_fetch', 'chain_start', 'chain_resolve']

// 上游邻接消息三件套（dsh-tool-subagent-control 注册）：绕过 broker 台账与
// 单线锁的旁路面，MyGO 会话的 Sisyphus 与子代理两侧都在 agent/created 里
// deny 掉（防旁路加固 R1/R2/R3）。need_help 的上报走运行时 API
// （ctx.subagents.sendMessage / internal 队列符号），与模型可见工具名无关，
// deny 不影响它。
//
// 收口范围只到「邻接消息通道 = broker 六件套」：原生派生工具
// （subagent / subagent_fork / workflow / ralph）在顶层 Sisyphus 保留为逃生舱
// （仅用户显式要求直派时使用），只在子代理侧 deny——星型拓扑要禁的是叶子派生，
// 不是主编排会话的原生入口。
export const ADJACENT_BYPASS_TOOLS = ['send_message', 'list_agents', 'interrupt_agent']

// Agent Teams 实验面（宿主侧注册，实验开关开了才有）：spawn_teammate 让子代自拉
// 队友、wait_agent 自等、team_task_* 自建任务板——四件合起来是一条完整的新旁路面：
// 叶子自己派生孙代并自管任务，完全绕开 go_work / need_help 的星型收口与台账。
//
// 与上面邻接三件套的两点关键差异：
//   1. **只摘子代理侧**。Agent Teams 是主会话的实验玩法，收口只到叶子派生——与
//      原生派生工具（subagent / subagent_fork / workflow / ralph）同款口径：编排
//      面保留原生入口，叶子不得自我派生。故 broker 的 agent/created 闸只把它并入
//      「sub-agent gate」的名单，主会话那一支（orchestrator scope）不碰。
//   2. **名单随宿主在册状态联动**（broker 侧 AGENT_TEAMS_TOOLS.filter(在册)）。
//      这三件是宿主注册的，不由本插件开关掌握；未注册时硬 deny 只会换来
//      restrict 批级拒绝 + 逐名兜底的「could not deny」查无此具噪音——与
//      report_fetch / 链两件同款口径（闸的意图被「工具根本不存在」真空满足）。
export const AGENT_TEAMS_TOOLS = ['spawn_teammate', 'wait_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update']

// ── settings 命名空间与面板 RPC 通道（同一身份的两种拼法）────────────────────
// SETTINGS_NAMESPACE：configForms.get 的条目 id（= 插件 Loader 行的 id）、config
// slot key——两处一个身份。PANEL_RPC_CHANNEL：面板 RPC
// 单通道名 = 命名空间的带斜杠形态（client.js「all one identity」注释的常量化），
// lib 半注册、src 半调用两侧同源。两者必须同步改，派生式定义让漂移不可能。
export const SETTINGS_NAMESPACE = 'dsh-my-go'
export const PANEL_RPC_CHANNEL = `/${SETTINGS_NAMESPACE}`

// 面板单通道分发的端点名全集（lib 半分发 ↔ src 半调用两侧同源）——端点改名
// 一侧漂移即 404/静默失效，键值同形枚举把协议面钉在一处。
export const PANEL_ENDPOINTS = Object.freeze({
  snapshot: 'snapshot',
  listTools: 'listTools',
  getBuiltinPersona: 'getBuiltinPersona',
  getUsage: 'getUsage',
})

// ── usage-price 四桶 ────────────────────────────────────────────────────────
// 桶序是承诺：保存行的序列化键序、编辑器渲染序、聚合行序都按它走。
// 前二必填（缺一整行 fail-closed 丢弃），后二可选（未定价 = 键省略）。
export const PRICE_REQUIRED_BUCKETS = ['input', 'output']
export const PRICE_OPTIONAL_BUCKETS = ['cacheRead', 'cacheWrite']
export const PRICE_BUCKETS = [...PRICE_REQUIRED_BUCKETS, ...PRICE_OPTIONAL_BUCKETS]
// 四桶的中文标签（设置页单价表渲染面），与桶序同源分发。
export const PRICE_BUCKET_LABELS = Object.freeze({ input: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入' })

// 台账 v1 兼容桶 id：broker 载入 v1 单 history 台账时把全部行放进 key 为本值
// 的幽灵父区（无属主会话、current 恒空、点开无处可跳）。面板父区列表与 usage
// 单父区借用判定都按名过滤它；跨重启的全局扫描兜底仍可命中这些记录。
export const LEGACY_PARENT_ID = 'legacy'
