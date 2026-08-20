/**
 * dsh-my-go broker — HOST half.
 *
 * Wires together:
 *  - the orchestration state machine (single-line blocking),
 *  - the four communication tools (go_work / continue / need_help / forward),
 *  - per-agent model/effort binding at the agent/request waterfall,
 *  - conclusion injection on subagent/end + queue advancement,
 *  - a private RPC bridge the client half polls for snapshot updates.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Orchestration, AGENT_TYPES, agentLabel, type AgentType } from './orchestration.ts'
import { BindingTable, DEFAULT_BINDINGS, bindingFor, supportedEfforts, effortSupported, type LlmServiceLike } from './model-binding.ts'
import { registerOrchestrationTools } from './tools.ts'

export interface BrokerHostConfig {
  /** Per-agent binding table (from settings). */
  bindings?: Partial<BindingTable>
  /** Whether Sisyphus itself is excluded from binding overrides. */
  bindSisyphus?: boolean
}

export function apply(ctx: Context, config: BrokerHostConfig = {}): (() => void) | void {
  const bindings: BindingTable = { ...DEFAULT_BINDINGS, ...(config.bindings ?? {}) }
  const bindSisyphus = config.bindSisyphus ?? false

  const orchestration = new Orchestration()
  const sessionTypes = new Map<string, string>()

  // ── client bridge: package-private RPC (Client → Host) ──────────────────
  const { harness } = globalThis as unknown as {
    harness?: { handle: (method: string, handler: (args: unknown) => unknown | Promise<unknown>) => () => void }
  }
  let latestSnapshot: unknown = null
  let snapshotSeq = 0
  orchestration.onChange((snapshot) => {
    snapshotSeq += 1
    latestSnapshot = { seq: snapshotSeq, ...snapshot }
  })
  const disposers: Array<() => void> = []
  if (harness) {
    disposers.push(harness.handle('dsh-my-go/snapshot', async () => latestSnapshot ?? { seq: 0, current: null, queue: [], helpRequests: [], history: [] }))
    disposers.push(harness.handle('dsh-my-go/notify', async () => {
      // Force a snapshot bump so the client re-polls.
      snapshotSeq += 1
      latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
      return { seq: snapshotSeq }
    }))
  }

  // ── internal dispatch (shared by go_work tool, forward, queue) ──────────
  const dispatchWork = async (
    agentType: AgentType,
    prompt: string,
    parent: Agent | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ childId: string; status: string; label?: string; queued?: boolean }> => {
    if (!AGENT_TYPES.includes(agentType)) throw new Error(`unknown agent type: ${String(agentType)}`)
    const binding = bindings[agentType] ?? {}
    if (!parent) {
      // Queue advancement may lose the live parent object; fall back to a
      // live root agent (the Sisyphus session).
      const agents = ctx.get('agents')
      const root = agents?.roots?.()?.find((a: Agent) => a && typeof a.id === 'string')
      if (root) parent = root
    }
    if (!parent) throw new Error('go_work requires a live parent agent to delegate from')
    if (orchestration.isBusy()) {
      const workId = orchestration.enqueue(agentType, prompt, parent.id)
      snapshotSeq += 1
      latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
      return { childId: workId, status: 'queued', label: agentLabel(agentType, prompt.slice(0, 60)), queued: true }
    }
    const placeholder = orchestration.beginSpawning(agentType, prompt)
    try {
      const subagents = ctx.get('subagents') as {
        startContinuable: (spec: Record<string, unknown>) => Promise<{ childId: string; messageId: string }>
      } | undefined
      if (subagents === undefined) throw new Error('subagents service unavailable')
      const label = agentLabel(agentType, prompt.slice(0, 60))
      const request: Record<string, unknown> = {
        label,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(binding.provider !== undefined || binding.model !== undefined
          ? {
              agentOptions: {
                ...(binding.provider !== undefined ? { provider: binding.provider } : {}),
                ...(binding.model !== undefined ? { model: binding.model } : {}),
              },
            }
          : {}),
      }
      const spec: Record<string, unknown> = { provider: 'spawn', label, request }
      if (signal !== undefined) spec.signal = signal
      const { childId } = await subagents.startContinuable(spec)
      sessionTypes.set(childId, agentType)
      orchestration.bindChild(placeholder.childId, childId)
      snapshotSeq += 1
      latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
      return { childId, status: 'running', label, queued: false }
    } catch (error) {
      orchestration.abort(placeholder.childId)
      snapshotSeq += 1
      latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
      throw new Error(`go_work failed: ${String(error)}`)
    }
  }

  // ── tools (visible to Sisyphus AND, minus the deny-list, to children) ───
  disposers.push(registerOrchestrationTools(ctx, {
    orchestration,
    bindings,
    sessionTypes,
    notifyClient: () => {
      snapshotSeq += 1
      latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
    },
    dispatchWork,
  }))

  // ── model/effort binding at the request waterfall ───────────────────────
  // Scoped to the calling agent so Sisyphus itself is untouched unless
  // bindSisyphus is set. Children carry their type in sessionTypes.
  // reasoningEffort follows the DSH model catalog: only set an effort the
  // exact model supports (queried via llm.resolveModelInfo, cached); an
  // unsupported or unknown desired effort leaves the field unset so the
  // adapter's own default applies.
  const llm = ctx.get('llm') as LlmServiceLike | undefined
  const effortCache = new Map<string, Set<string> | null>()
  const resolvedEfforts = async (provider: string, model: string): Promise<Set<string> | null> => {
    const key = `${provider}/${model}`
    const cached = effortCache.get(key)
    if (cached !== undefined) return cached
    const value = await supportedEfforts(llm, provider, model)
    effortCache.set(key, value)
    return value
  }
  ctx.on('agent/request', async (payload, next) => {
    const seed = await next()
    const agent = payload.agent
    const type = sessionTypes.get(agent.id)
    if (type === undefined && !bindSisyphus) return seed
    const binding = bindingFor(bindings, type ?? 'sisyphus')
    const nextConfig = { ...seed }
    if (binding.provider !== undefined) nextConfig.provider = binding.provider
    if (binding.model !== undefined) nextConfig.model = binding.model
    if (binding.reasoningEffort !== undefined) {
      const provider = String(nextConfig.provider ?? binding.provider ?? '')
      const model = String(nextConfig.model ?? binding.model ?? '')
      const efforts = await resolvedEfforts(provider, model)
      if (effortSupported(efforts, binding.reasoningEffort)) {
        nextConfig.reasoningEffort = binding.reasoningEffort
      }
    }
    return nextConfig
  })

  // ── conclusion injection + queue advancement on subagent/end ────────────
  // DSH's npm packages do not re-export the module-augmented event map, so
  // widen at the boundary (documented rc-phase pattern, dsh-handbook ch.4).
  const onAny = ctx.on as unknown as (event: string, listener: (info: Record<string, unknown>) => void) => () => void
  onAny('subagent/end', (info) => {
    const childId = String(info.id)
    const type = sessionTypes.get(childId)
    if (type === undefined) return // not one of ours
    const last = info.lastAssistantMessage as Array<{ type?: string; text?: string }> | undefined
    const text = (last ?? [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('\n')
    const failed = String(info.stopReason) !== 'completed'
    const record = orchestration.finish(childId, text || `(${String(info.stopReason)})`, failed)
    sessionTypes.delete(childId)
    snapshotSeq += 1
    latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }

    // Advance the queue: if a pending go_work exists, re-dispatch it. The
    // recorded parent session id resolves to a live Agent when available;
    // otherwise the internal dispatch falls back to a live root agent.
    if (record && orchestration.snapshot().queue.length > 0 && !orchestration.isBusy()) {
      const work = orchestration.dequeue()
      if (work) {
        const agents = ctx.get('agents') as { get: (id: string) => Agent | undefined } | undefined
        const parentAgent = work.parentId && agents ? agents.get(work.parentId) : undefined
        void dispatchWork(work.agentType, work.prompt, parentAgent, undefined).catch(() => undefined)
      }
    }
  })

  // ── cleanup ─────────────────────────────────────────────────────────────
  const dispose = () => {
    for (const item of disposers) item()
  }
  return dispose
}
