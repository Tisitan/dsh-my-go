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

// 编排状态兜底闸（tisitan.15）：正常路径自会清理（finish 即删、history 自截断），
// 这两个上限只为异常路径兜底——end 事件永久缺席的滞留记录、编排会话无限累积。
// v1 不做配置化，避免 settings schema 面膨胀。
export const CURRENT_MAP_CAP = 500
export const LEDGER_PARENTS_CAP = 200

// 本插件注册的编排工具名：schemas() 无参只返回全局层视图（内建 + MCP），
// preset 层的自产工具不在其中——toolFilter 合法引用它们时不能误杀。
export const SELF_REGISTERED_TOOLS = ['go_work', 'continue', 'need_help', 'forward', 'orchestration_status', 'list_subagents']
