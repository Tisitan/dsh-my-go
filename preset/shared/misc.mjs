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
//
// **淘汰痕迹**（P23）：整桶淘汰是不可逆的信息损失——被淘汰父会话的 history 全没了，
// 而下游统计只能看到「桶不存在」，无法与「这个会话真的没有子代」区分，于是把漏算
// 的用量当成完整值报出去。故返回对象上挂一份**不可枚举**的 evictedParents 列表
// （本函数历次调用新淘汰的 parentId，去重、有界）：
//   - 不可枚举 ⇒ Object.keys / JSON.stringify(parents) / 桶数判定 / deepEqual
//     全部零扰动（现有调用方与测试语义不变）；
//   - broker-ledger 落盘时显式取它写进 payload 顶层 evictedParents（可跨重启），
//     lib/usage-aggregator 据此把「被淘汰过」标成 partial（下界）。
export const EVICTED_PARENTS_CAP = 512

/**
 * 把痕迹挂成**不可枚举**属性：Object.keys / JSON.stringify(parents) / 桶数判定 /
 * deepEqual 全部零扰动，调用方显式读才看得到。
 */
function attachMeta(parents, key, value) {
  if (!parents || typeof parents !== 'object') return parents
  Object.defineProperty(parents, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return parents
}

function attachEvicted(parents, evicted, truncated, intact = []) {
  if (!parents || typeof parents !== 'object') return parents
  if (evicted.length > 0) attachMeta(parents, 'evictedParents', evicted)
  if (truncated) {
    attachMeta(parents, 'enumerationTruncated', true)
    // 裁剪态下**无条件**挂名单——空数组 `[]` 与「没有名单字段」是两件不同的事：
    // 前者表示当前没有可证明完整的桶（可能全部退场，也可能旧档缺乏历史证据），
    // 后者表示旧档从未记录名单；两者均不能为残缺桶背书。
    // 挂空数组而不是不挂，才不会让下一次落盘把它当「从未立过名单」重新播种。
    attachMeta(parents, 'intactParents', intact)
  }
  return parents
}

/** 该 parents 对象上是否**确立过**名单（空数组算已确立；完全没有该字段则不是）。 */
export function hasIntactParentsMeta(parents) {
  return Boolean(parents) && typeof parents === 'object' && Array.isArray(parents.intactParents)
}

/**
 * 读出「裁剪纪元幸存桶白名单」（不可枚举时也能读到）。
 *
 * 语义：台账第一次进入「不可精确归因的裁剪态」那一刻，**在场且幸存**的父会话
 * parentId 快照。之后：
 *   - 名单内的桶 ⇒ 历史自那一刻起连续在场 ⇒ 枚举可视为完整；
 *   - 名单外的桶 ⇒ 可能是当年被静默裁掉、后来才恢复重建的旧父会话（桶里只有
 *     重建之后的新记录，旧子代历史早已不在台账里）⇒ 历史有缺口。
 * 这是 `enumerationTruncated` 无法单独表达的那一半事实：全局标志只能说「这个
 * 台账漏过人」，说不了「漏的是不是这一个 parentId」。
 */
export function intactParentsOf(parents) {
  const listed = parents && typeof parents === 'object' ? parents.intactParents : undefined
  return Array.isArray(listed) ? listed : []
}

// 读出某个 parents 对象上的淘汰痕迹（不可枚举时也能读到）。
export function evictedParentsOf(parents) {
  const listed = parents && typeof parents === 'object' ? parents.evictedParents : undefined
  return Array.isArray(listed) ? listed : []
}

/**
 * 台账是否**曾经**发生裁剪（P22 收口）。粘滞标志：一旦为真永不回退，且随台账
 * 落盘持久化。为什么必须有它——下面两条路都能让「痕迹表 + 桶数触顶」这对判据
 * 同时失效，把不可逆的漏算谎报成完整：
 *   ① 升级前的旧台账已裁到 200 桶、文件里没有 evictedParents：加载时不触发新
 *      淘汰，痕迹永远为空；此时一旦某个保留桶被 session/disposed 删掉，桶数
 *      200→199，两条判据同时不成立；
 *   ② 淘汰累计超过 EVICTED_PARENTS_CAP(512)，最早那批 parentId 被挤出痕迹表；
 *      随后再删一个保留桶，桶数同样跌破 200。
 * 两个场景的共同点是「该台账曾经饱和过」这一事实已经无法从当前形状反推，
 * 只能在事实发生的那一刻记下来、之后永不忘记。
 */
export function enumerationTruncatedOf(parents) {
  return parents && typeof parents === 'object' && parents.enumerationTruncated === true
}

export function pruneLedgerParents(
  parents,
  cap = LEDGER_PARENTS_CAP,
  previouslyEvicted = [],
  previouslyIntact = undefined,
  wasTruncatedFlag = undefined,
) {
  if (!parents || typeof parents !== 'object' || Array.isArray(parents)) return {}
  const carried = [...previouslyEvicted, ...evictedParentsOf(parents)]
  // 注意：默认值是 `undefined` 而不是 `[]`——「调用方没给名单」与「调用方明确给了
  // 一个空名单」必须可分，否则名单退空后会被当成从未立过而重新播种（洗白）。
  const hasPriorIntact = Array.isArray(previouslyIntact) || hasIntactParentsMeta(parents)
  const carriedIntact = [...(Array.isArray(previouslyIntact) ? previouslyIntact : []), ...intactParentsOf(parents)]
  // 「已经处于裁剪态」这件事有两个来源：parents 对象上的不可枚举元数据（调用方把
  // 上一次的返回值原样传回），或调用方自己维护的累加状态（broker-ledger 传的是
  // 内存标志）。两者取或——只认元数据会让「每轮都传裸 parents 的落盘路径」把
  // 纪元当成每轮重新开始，于是每轮都把后建的桶补进白名单（洗白）。
  // 已有淘汰痕迹本身也证明裁剪早已发生，不能因旧档缺少标志而当成首次裁剪。
  // 本次新淘汰的 ID 在下方才追加，不影响干净台账首次裁剪时建立幸存名单。
  const wasTruncated = wasTruncatedFlag === true || enumerationTruncatedOf(parents)
    || carried.some((pid) => typeof pid === 'string' && pid !== '')
  const entries = Object.entries(parents).filter(([, list]) => Array.isArray(list) && list.length > 0)
  // 既有裁剪事实或父桶数触顶均置真；加载与落盘持续携带这一事实。
  const trail = dedupeEvicted(carried)
  const truncated = wasTruncated || entries.length >= cap
  if (entries.length <= cap) {
    // 本次无需再裁桶，仍须按历史完整性维护名单。
    const intact = truncated
      ? intactFrom(carriedIntact, wasTruncated, hasPriorIntact, Object.keys(parents))
      : []
    return attachEvicted(parents, trail, truncated, intact)
  }
  const scored = entries
    .map(([pid, list]) => ({ pid, list, latest: Math.max(...list.map((r) => Number(r?.updatedAt) || 0)) }))
    .sort((a, b) => b.latest - a.latest)
  const kept = {}
  const evicted = [...carried]
  for (const entry of scored.slice(cap)) evicted.push(entry.pid)
  for (const entry of scored.slice(0, cap)) kept[entry.pid] = entry.list
  const intact = truncated
    ? intactFrom(carriedIntact, wasTruncated, hasPriorIntact, Object.keys(kept))
    : []
  return attachEvicted(kept, dedupeEvicted(evicted), truncated, intact)
}

/**
 * 幸存桶名单的三种状态：首次裁剪建立名单；已裁剪但缺名单时保守置空；
 * 已有名单只与当前在场桶取交集，空名单也不会重新播种。
 * 淘汰痕迹只能证明发生过丢失，不能证明其余桶完整：它可能晚于静默裁剪才开始
 * 记录，也可能早已裁成 512 项再落盘，当前非空或未超限均不是完整性证据。
 */
function intactFrom(carriedIntact, wasTruncated, hasPriorIntact, presentIds) {
  const present = presentIds.filter((pid) => typeof pid === 'string' && pid !== '')
  // ① 首次进入裁剪态：在场桶就是本次裁剪的幸存者。
  if (!wasTruncated) {
    return present.slice(0, LEDGER_PARENTS_CAP)
  }
  if (!hasPriorIntact) return []
  // ③ 已立名单：只减不增。
  const carriedSet = new Set(carriedIntact.filter((pid) => typeof pid === 'string' && pid !== ''))
  return present.filter((pid) => carriedSet.has(pid)).slice(0, LEDGER_PARENTS_CAP)
}

// 去重 + 有界（保留最近的 EVICTED_PARENTS_CAP 个：旧痕迹先出）。
function dedupeEvicted(list) {
  const seen = new Set()
  const out = []
  for (const pid of list) {
    if (typeof pid !== 'string' || pid === '' || seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
  }
  return out.slice(-EVICTED_PARENTS_CAP)
}

// Pre-load all prompts at startup (non-blocking, errors swallowed).
// promptCache 与 loadPrompt 由各半注入——缓存壳共享，路径根是每半的本质差异。
export async function loadAllPrompts(promptCache, loadPrompt) {
  for (const type of [...AGENT_TYPES, 'sisyphus']) {
    await loadPrompt(type)
  }
}
