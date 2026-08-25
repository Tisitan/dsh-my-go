/**
 * dsh-my-go broker: per-agent model / reasoning-effort binding (host plane).
 *
 * DSH does not let a caller dynamically pick a sub-agent's model from the
 * tool layer in every configuration, so the broker enforces the binding at
 * the `agent/request` waterfall: for any request whose agent carries a
 * `dsh-my-go:<type>` label (or matches a known child session), override
 * provider/model/reasoningEffort from the configured agent table.
 *
 * reasoningEffort follows the DSH model catalog: models differ in whether
 * they expose thinking levels at all, and in the exact level ids
 * (off/high/max, low, …). The broker therefore only sets an effort the exact
 * model supports (queried via `llm.resolveModelInfo` at request time); an
 * unsupported or unknown desired effort leaves the field unset so the
 * adapter's own default applies.
 *
 * The same module is used at spawn time to populate
 * `SubagentStartRequest.agentOptions` (provider/model) so the route is set
 * as early as possible; the waterfall is the enforcement backstop and the
 * only place `reasoningEffort` can be injected.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { parseAgentType } from './orchestration.ts'

/** One agent type's model binding. */
export interface AgentBinding {
  provider?: string
  model?: string
  /** Desired reasoning effort; applied only when the exact model supports it. */
  reasoningEffort?: ReasoningEffortId
  /** Whether the DSV4P0813 two-phase bootstrap applies to this agent type. */
  dsv4p0813: boolean
}

export interface BindingTable {
  sisyphus: AgentBinding
  hermes: AgentBinding
  explore: AgentBinding
  librarian: AgentBinding
  looker: AgentBinding
  hephaestus: AgentBinding
  prometheus: AgentBinding
  oracle: AgentBinding
}

/** Minimal llm-service shape used for capability lookup. */
export interface LlmServiceLike {
  resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<{
    reasoning?: { efforts?: readonly { id?: unknown }[] }
  }>
}

/**
 * Resolve the set of reasoning-effort ids one exact provider/model supports.
 * Returns `null` when the route is unknown or the model exposes no efforts —
 * callers must then leave `reasoningEffort` unset rather than guessing.
 */
export async function supportedEfforts(
  llm: LlmServiceLike | undefined,
  provider: string,
  model: string,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model) return null
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    const efforts = info?.reasoning?.efforts
    if (!Array.isArray(efforts) || efforts.length === 0) return null
    return new Set(efforts.map((e) => String(e?.id)))
  } catch {
    return null // capability lookup must never break the request
  }
}

/** Whether one desired effort is in a supported set (null set = unknown). */
export function effortSupported(supported: Set<string> | null, desired: ReasoningEffortId | undefined): boolean {
  return desired !== undefined && desired !== null && supported !== null && supported.has(String(desired))
}

/**
 * Resolve the agent type for one live agent: read its session label if the
 * session carries a subagent descriptor label, else fall back to a
 * session-scoped registration map maintained by the broker.
 */
export function agentTypeOf(
  agent: Agent,
  sessionTypes: ReadonlyMap<string, string>,
): string | undefined {
  const bySession = sessionTypes.get(agent.id)
  if (bySession) return bySession
  // Durable label convention: the session title or a descriptor label carries
  // `dsh-my-go:<type>`. The broker registers every child it spawns, so this
  // is only a cold-resume fallback.
  const label = (agent.session?.header as { title?: string } | undefined)?.title
  return parseAgentType(label)
}

/** Resolve the binding for one agent type (defaults: no override). */
export function bindingFor(table: BindingTable, type: string | undefined): AgentBinding {
  if (type === undefined) return { dsv4p0813: false }
  const key = type as keyof BindingTable
  return table[key] ?? { dsv4p0813: false }
}

/**
 * Default binding table matching AGENTS.md's suggested defaults.
 *
 * ⚠️ Archived snapshot: the concrete provider/model values below are the
 * original author's own deployment routes, kept here as historical reference
 * only. The runtime defaults were generalized in tisitan.7 — the live
 * implementations (preset/tools/broker.mjs, lib/index.js) now ship EMPTY
 * defaults (every agent type inherits the environment's default route) and
 * leave per-type binding entirely to user configuration.
 *
 * `provider` stays `undefined` for the light agents so the child inherits
 * Sisyphus's provider route while the model is pinned. Light agents leave
 * `reasoningEffort` unset (their models may not expose thinking levels);
 * heavy agents request high/max, applied only when the model supports it.
 */
export const DEFAULT_BINDINGS: BindingTable = {
  sisyphus: { dsv4p0813: false },
  hermes: { model: 'mimo-v2.5', dsv4p0813: false },
  explore: { model: 'mimo-v2.5', dsv4p0813: false },
  librarian: { model: 'mimo-v2.5', dsv4p0813: false },
  looker: { model: 'mimo-v2.5', dsv4p0813: false },
  hephaestus: { provider: 'octopus', model: 'deepseek-v4-flash', reasoningEffort: 'high' as ReasoningEffortId, dsv4p0813: false },
  prometheus: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max' as ReasoningEffortId, dsv4p0813: false },
  oracle: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max' as ReasoningEffortId, dsv4p0813: false },
}
