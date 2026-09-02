/**
 * dsh-my-go — shared constants (single source for both runtime halves).
 *
 * Imported by preset/tools/broker.mjs (relative path inside the preset copy)
 * and lib/index.js (in-package path into preset/shared/). The preset/ tree is
 * copied verbatim by ensurePresetInstalled, so the relative layout survives
 * both deployment forms (repo checkout and ~/.dsh/.agent-presets install).
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * constants only.
 */

export const AGENT_TYPES = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

export const AGENT_TYPE_PREFIX = 'dsh-my-go:'

// 键名约束与工种 label 提取正则同构：小写字母开头、只含小写与连字符。
// 数字/下划线/大写必须在 schema 层拒绝——进入存储后 label 正则会静默
// 不匹配，排查成本远高于写入时报错。
export const ROLE_KEY_PATTERN = /^[a-z][a-z-]*$/

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
export const SELF_REGISTERED_TOOLS = ['go_work', 'continue', 'need_help', 'forward', 'orchestration_status', 'list_subagents']

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
