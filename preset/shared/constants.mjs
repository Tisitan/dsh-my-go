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

// 编排状态兜底闸：正常路径自会清理（finish 即删、history 自截断），
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
// 名单允许「先行登记」：工具本体稍后注册也无实害——report_submit /
// report_fetch / chain_start / chain_resolve 都按这一口径入册，两处消费点
// （roles 过滤 / liveToolNames）只把它当「允许 toolFilter 合法引用的名字」。
// **漏挂的代价**：不在名单里的自产工具会被 roster 的工具过滤当未知名剔除
//（roles.mjs 的 resolveRoleToolFilter），用户写 toolFilter 引用它时静默失效；
// heartbeat 是无条件注册的主编自助闸，同样按此入册。
export const SELF_REGISTERED_TOOLS = ['go_work', 'continue', 'need_help', 'forward', 'orchestration_status', 'list_subagents', 'heartbeat', 'report_submit', 'report_fetch', 'chain_start', 'chain_resolve']

// 上游邻接消息三件套（dsh-tool-subagent-control 注册）：绕过 broker 台账与
// 单线锁的旁路面，MyGO 会话的 Sisyphus 与子代理两侧都在 agent/created 里
// deny 掉（防旁路加固 R1/R2/R3）。need_help 的上报走运行时 API
// （ctx.subagents.sendMessage / internal 队列符号），与模型可见工具名无关，
// deny 不影响它。
//
// 收口范围只到「邻接消息通道 = broker 自产的编排工具集」（现七件：go_work /
// continue / need_help / forward / orchestration_status / list_subagents / heartbeat
// ——集合随工具面增长，这里数的是「哪些通路被收口」，不是某个固定数字）：原生派生工具
// （subagent / subagent_fork / workflow / ralph）在顶层 Sisyphus 保留为逃生舱
// （仅用户显式要求直派时使用），只在子代理侧 deny——星型拓扑要禁的是叶子派生，
// 不是主编排会话的原生入口。
export const ADJACENT_BYPASS_TOOLS = ['send_message', 'list_agents', 'interrupt_agent']

// Agent Teams 实验面（宿主侧注册，实验开关开了才有）：spawn_teammate 让子代自拉
// 队友、wait_agent 自等、team_task_* 自建任务板——四件合起来是一条完整的新旁路面：
// 叶子自己派生孙代并自管任务，完全绕开 go_work / need_help 的星型收口与台账。
//
// 与上面邻接三件套的两点关键差异：
//  1. **只摘子代理侧**。Agent Teams 是主会话的实验玩法，收口只到叶子派生——与
//   原生派生工具（subagent / subagent_fork / workflow / ralph）同款口径：编排
//   面保留原生入口，叶子不得自我派生。故 broker 的 agent/created 闸只把它并入
//   「sub-agent gate」的名单，主会话那一支（orchestrator scope）不碰。
//  2. **名单随宿主在册状态联动**（broker 侧 AGENT_TEAMS_TOOLS.filter(在册)）。
//   这三件是宿主注册的，不由本插件开关掌握；未注册时硬 deny 只会换来
//   restrict 批级拒绝 + 逐名兜底的「could not deny」查无此具噪音——与
//   report_fetch / 链两件同款口径（闸的意图被「工具根本不存在」真空满足）。
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

// ── 主编缓存心跳（keep-alive heartbeat）默认值单源 ──────────────────────────
// 三个消费面必须同值：lib/config.js 的 schema 默认（宿主读面）、
// src/settings-ops.js 的草稿归一（配置卡读面）、broker-heartbeat.mjs 的运行时
// 兜底（桥缺席 / 段缺席时的行为值）。任一处分头写死就等着三处漂移。
// enabled 默认 **关**：唤醒主编会真实打断「派发后静默等待」的节奏，且烧 token，
// 必须由用户显式打开。
export const KEEP_ALIVE_DEFAULTS = Object.freeze({
  enabled: false,
 // 主编拍距：空闲主编多久被唤醒一次跑维护回合。
 // **250 秒 = 5 分钟档 TTL × 5/6**（与配置卡速算区同一个安全余量口径，见
 // KEEP_ALIVE_CALC）：续命的拍子必须早于缓存过期，留 1/6 给投递与回合本身耗时。
 // 对 300 秒 TTL 而言，正好 5 分钟的拍距是**零余量**——拍子与过期同时到即白醒，
 // 与卡上那句「比 prompt 缓存 TTL 长的一拍等于白醒」是同一条口径。
  orchestratorIntervalMs: 250000,
 // 子代静默多久算「需要进度询问」（30 分钟：长任务正常节奏之上，误报成本低）。
  childPingAfterMs: 1800000,
 // 连续多少轮心跳建议 ping 而无任何信号 → 摘要标红请主编当场裁决。
  escalateAfterPings: 3,
})

// 心跳「界限」拍数（摘要头行那截 ｜界限≈Xm 的单源）：界限 = 本常量 × 拍距。
// 9 = 缓存命中价与未命中价十倍率减一（示例：$0.30 vs $3.00，5m 档）。若将来上
// 1h 档（写入价 $6、倍率 20），应改 19。供应商倍率不同亦需调整——主编人设以
// 摘要头行的生效值为准。
export const HEARTBEAT_LIMIT_TICKS = 9

// 心跳摘要的字节上限：它进的是主编上下文（每拍一条），必须短。超限按「先保
// 需要动作的行」截断，余下条数折成一行计数（详见 broker-heartbeat.mjs）。
export const HEARTBEAT_SUMMARY_MAX_BYTES = 500

// ── 心跳速算区（配置卡内的纯 UI 计算）公式常量单源 ──────────────────────────
// 配置卡第三块（主编缓存心跳）里有一个只做算术的小节：填「缓存 TTL」→ 算出
// 建议拍距（可一键填进正式字段）；再填「输入价 / 缓存命中价」→ 算出前瞻窗口 H。
// 这一节**零持久化字段**（不进 schema、不落库），值只是组件态，故公式与默认档
// 单源在这里：消费面是 src/keepalive-calc.js（纯函数层，配置卡与单测共用），
// 不许在渲染层再抄一份系数。
export const KEEP_ALIVE_CALC = Object.freeze({
 // 拍距 = TTL × 5/6：续命的唤醒必须**早于** TTL 过期（留 1/6 余量给投递与回合
 // 本身的耗时）。一条规则覆盖两档常见 TTL——300 秒 → 250 秒，3600 秒 → 3000 秒。
  intervalRatio: 5 / 6,
 // 速算区「缓存 TTL」的默认档：5 分钟，与 KEEP_ALIVE_DEFAULTS 的默认拍距同源。
  defaultTtlSeconds: 300,
 // 两个价格框的 placeholder（示例值，不是值）：输入价 / 缓存命中价（$/M tokens）。
 // 示例比价刻意取 10 倍——那正是「命中缓存值不值」的典型量级（3.00 / 0.30）。
  pricePlaceholder: { input: '3.00', cacheRead: '0.30' },
})

