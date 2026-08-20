/**
 * dsh-my-go broker: per-agent model / reasoning-effort binding (host plane).
 *
 * DSH does not let a caller dynamically pick a sub-agent's model from the
 * tool layer in every configuration, so the broker enforces the binding at
 * the `agent/request` waterfall: for any request whose agent carries a
 * `dsh-my-go:<type>` label (or matches a known child session), override
 * provider/model/reasoningEffort from the configured agent table.
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
  /** Desired reasoning effort; mapped to adapter-supported values. */
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

/** Effort values the DeepSeek official adapter accepts (off/high/max). */
const DEEPSEEK_EFFORTS = new Set(['off', 'high', 'max'])

/**
 * Map a desired effort to an adapter-supported value. `low` is not supported
 * by the deepseek-official adapter and falls back to `high`; everything else
 * passes through. Returns undefined when no mapping applies.
 */
export function mapEffort(effort: string | undefined): ReasoningEffortId | undefined {
  if (effort === undefined) return undefined
  if (effort === 'low') return 'high' as ReasoningEffortId
  if (DEEPSEEK_EFFORTS.has(effort)) return effort as ReasoningEffortId
  return effort as ReasoningEffortId
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
 * The provider defaults to the deployment's configured route where possible:
 * the octopus route is the user's OpenAI-completions gateway and serves
 * mimo-v2.5 / deepseek-v4-flash / deepseek-v4-pro (verified against
 * ~/.dsh/settings.yaml). `provider` stays `undefined` for the light agents so
 * the child inherits Sisyphus's provider route while the model is pinned.
 */
export const DEFAULT_BINDINGS: BindingTable = {
  sisyphus: { dsv4p0813: false },
  hermes: { model: 'mimo-v2.5', reasoningEffort: 'default' as ReasoningEffortId, dsv4p0813: false },
  explore: { model: 'mimo-v2.5', reasoningEffort: 'default' as ReasoningEffortId, dsv4p0813: false },
  librarian: { model: 'mimo-v2.5', reasoningEffort: 'default' as ReasoningEffortId, dsv4p0813: false },
  looker: { model: 'mimo-v2.5', reasoningEffort: 'default' as ReasoningEffortId, dsv4p0813: false },
  hephaestus: { provider: 'octopus', model: 'deepseek-v4-flash', reasoningEffort: 'high' as ReasoningEffortId, dsv4p0813: false },
  prometheus: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max' as ReasoningEffortId, dsv4p0813: false },
  oracle: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max' as ReasoningEffortId, dsv4p0813: false },
}
