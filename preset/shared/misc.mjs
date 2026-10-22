/**
 * dsh-my-go — misc shared helpers (both halves): agent presentation strings,
 * default bindings, XML escaping, agent-type resolution, ledger pruning and
 * the prompt preload loop.
 *
 * 上游邻接消息面（sessionEvents/canQueueAdjacent/deliverToAdjacent/reportToParent）
 * 不在此档：那一档「跟着上游 API 形状变」的契约适配独立在 shared/adjacent.mjs。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * closure dependencies (sessionTypes, promptCache, loadPrompt) are explicit
 * injection parameters.
 */

import { sessionEvents } from './adjacent.mjs'
import { AGENT_TYPES, AGENT_TYPE_PREFIX, LEDGER_PARENTS_CAP } from './constants.mjs'

export function describeAgent(type, persona) {
  switch (type) {
    case 'hermes': return 'fast execution: batch replace, formatting, imports, copy-paste'
    case 'explore': return 'fast search: grep, read files, locate symbols, scan structure'
    case 'librarian': return 'document lookup: README, API reference, comments'
    case 'looker': return 'multimodal recognition: UI screenshots, designs, PDF charts'
    case 'hephaestus': return 'code writing: single-file refactor, module implementation, unit tests'
    case 'prometheus': return 'requirement planning: break vague requirements into executable steps (call once at flow start)'
    case 'oracle': return 'architecture debugging (last resort): cross-module analysis, deep bugs, complex review'
    case 'apelles': return 'visual artist: diagrams/flowcharts/posters, UI mockups and structure demos'
    default: {
      const firstLine = String(persona ?? '').split('\n').map((s) => s.trim()).find(Boolean)
      return firstLine ? `custom role: ${firstLine.slice(0, 60)}` : 'custom role'
    }
  }
}

export function agentLabel(type, summary) {
  return `${AGENT_TYPE_PREFIX}${type}${summary ? `: ${summary}` : ''}`
}

/** Default bindings: intentionally EMPTY for every agent type — the fork
 * ships no hardcoded provider/model, so sub-agents fully inherit the
 * environment's default route (Sisyphus's provider/model). Per-type
 * bindings are user configuration: set them in the WebUI settings page or
 * via plugin config `bindings` (see README「工种模型绑定」).
 * reasoningEffort is only ever applied when the exact model supports that
 * level (checked against the DSH model catalog at request time). */
export function defaultBindings() {
  return {
    sisyphus: {},
    hermes: {},
    explore: {},
    librarian: {},
    looker: {},
    hephaestus: {},
    prometheus: {},
    oracle: {},
    apelles: {},
  }
}

// XML 实体转义：need_help 上报体与 forward 转发信封共用同一套，防止
// 求助单 content 内的伪闭合标签逃逸出包裹结构。
export function escapeXml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// 工种识别：活登记优先；rc.2 把 label 持久化在 descriptor，旧宿主留在 header。
// descriptor 在 agent/created 和首次请求之前写入，故新建与冷恢复都无需等 start 返回。
export function typeOfAgent(sessionTypes, agent) {
  const live = sessionTypes.get(agent?.id)
  if (live !== undefined) return live
  return /^dsh-my-go:([a-z-]+)/.exec(agentRoleLabel(agent))?.[1]
}

export function agentRoleLabel(agent) {
  const descriptor = sessionEvents(agent?.session).findLast((event) => event.type === 'subagent/descriptor')
  return descriptor?.data?.label ?? agent?.session?.header?.label ?? ''
}

// 备选重派覆盖合并：重派成功时两半把备选 {provider, model} 登记进
// activeFallback（childId 键），agent/request waterfall 每请求经本函数求有效
// 绑定——覆盖存在时只换 provider/model，工种其余字段（reasoningEffort/
// fallbacks…）原样保留。返回新对象，绝不原地改 bindings[type]：
// 绑定表按工种共享，原地写会把备选泄漏给同工种的常规派发。缺/畸形覆盖原样返回。
export function resolveEffectiveBinding(binding, override) {
  if (typeof override?.provider !== 'string' || typeof override?.model !== 'string') return binding
  return { ...binding, provider: override.provider, model: override.model }
}

// ── 邻接消息通道适配（sessionEvents/canQueueAdjacent/deliverToAdjacent/
//    reportToParent）住在 shared/adjacent.mjs：本文件只留台账/名册/展示字符串
//    一档纯函数，两档的上游耦合点互不牵连 ──────────────────────────────────

// 台账养护：parents 桶数超限时按桶内最新 updatedAt 保留最近的
// LEDGER_PARENTS_CAP 个桶，更旧的桶整桶淘汰。加载时与落盘前各修剪一次。
export function pruneLedgerParents(parents, cap = LEDGER_PARENTS_CAP) {
  if (!parents || typeof parents !== 'object' || Array.isArray(parents)) return {}
  const entries = Object.entries(parents).filter(([, list]) => Array.isArray(list) && list.length > 0)
  if (entries.length <= cap) return parents
  const scored = entries
    .map(([pid, list]) => ({ pid, list, latest: Math.max(...list.map((r) => Number(r?.updatedAt) || 0)) }))
    .sort((a, b) => b.latest - a.latest)
  const kept = {}
  for (const entry of scored.slice(0, cap)) kept[entry.pid] = entry.list
  return kept
}

// Pre-load all prompts at startup (non-blocking, errors swallowed).
// promptCache 与 loadPrompt 由各半注入——缓存壳共享，路径根是每半的本质差异。
export async function loadAllPrompts(promptCache, loadPrompt) {
  for (const type of [...AGENT_TYPES, 'sisyphus']) {
    await loadPrompt(type)
  }
}
