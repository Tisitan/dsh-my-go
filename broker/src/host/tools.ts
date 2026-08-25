/**
 * dsh-my-go broker: the four communication tools (host plane).
 *
 *  - `go_work`    (Sisyphus → new sub-agent): startContinuable, returns childId
 *  - `continue`   (Sisyphus → suspended sub-agent): followup (reject / relay)
 *  - `need_help`  (sub-agent → Sisyphus): suspend self, inject help request id
 *  - `forward`    (Sisyphus → sub-agent): relay a help request by id or type
 *
 * Plus `orchestration_status` (read-only snapshot for Sisyphus).
 *
 * Registration follows the DSH custom-tool pattern (reference: internal
 * experimental presets): `register({ name, description, parameters, output, execute })`.
 * The tools service and subagents service are hard dependencies.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Orchestration, AGENT_TYPES, type AgentType, type HelpIntent } from './orchestration.ts'
import type { BindingTable } from './model-binding.ts'

export interface ToolDeps {
  orchestration: Orchestration
  bindings: BindingTable
  /** Durable session-id → agent-type map for the waterfall backstop. */
  sessionTypes: Map<string, string>
  /** Bridge to the client: push a snapshot update. */
  notifyClient: () => void
  /**
   * Internal dispatch implementation shared by the go_work tool, forward, and
   * queue advancement. `parent` may be undefined during queue advancement.
   */
  dispatchWork: (agentType: AgentType, prompt: string, parent: Agent | undefined, signal: AbortSignal | undefined) => Promise<{ childId: string; status: string; label?: string; queued?: boolean }>
}

export function registerOrchestrationTools(ctx: Context, deps: ToolDeps): () => void {
  const { orchestration } = deps
  // DSH's npm packages do not re-export module-augmented service types, so
  // widen at the boundary (documented rc-phase pattern, dsh-handbook ch.4).
  // The tool definition shape mirrors ToolDefinition loosely (parameters /
  // output schema / execute / render); callbacks are untyped at the boundary.
  type AnyTool = {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render: (_args: unknown, value: Record<string, unknown>) => Array<Record<string, unknown>>
    }
    isConcurrencySafe?: () => boolean
    execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
  }
  const tools = ctx.get('tools') as {
    register: (definition: AnyTool) => () => void
    get: (name: string) => { execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown> } | undefined
  } | undefined
  if (!tools) throw new Error('tools service unavailable')
  const subagents = ctx.get('subagents') as {
    followup: (parent: Agent, childId: string, content: Array<{ type: string; text: string }>, options: Record<string, unknown>) => Promise<string>
    reportFrom: (child: Agent, content: Array<{ type: string; text: string }>, options: Record<string, unknown>) => Promise<string>
  } | undefined
  const disposers: Array<() => void> = []
  const register = (def: AnyTool): void => {
    disposers.push(tools.register(def))
  }

  // ── go_work: Sisyphus dispatches a new sub-agent (empty context) ────────
  register({
    name: 'go_work',
    description: [
      'Dispatch a new sub-agent to work on a task. The sub-agent starts with an empty context and only the tools of its type.',
      'Available agent types:',
      ...AGENT_TYPES.map((t) => `- ${t}: ${describeAgent(t)}`),
      'Single-line blocking: if a sub-agent is already running, this task is queued and starts when the current one finishes.',
      'The result contains a childId you keep for later continue/forward operations, and the sub-agent label.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: [...AGENT_TYPES],
          description: 'Which sub-agent type to dispatch.',
        },
        prompt: {
          type: 'string',
          description: 'The complete, self-contained task prompt for the sub-agent.',
        },
      },
      required: ['agent', 'prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childId: { type: 'string' },
          status: { type: 'string' },
          label: { type: 'string' },
          queued: { type: 'boolean' },
        },
        required: ['childId', 'status'],
      },
      render: (_args, value) => [{ type: 'text', text: `go_work → ${value.status}: ${value.childId}${value.queued ? ' (queued)' : ''}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent as { id: string } | undefined
      if (!parent) throw new Error('go_work requires a calling agent (exec.agent was undefined)')
      const agentType = args.agent as AgentType
      if (!AGENT_TYPES.includes(agentType)) throw new Error(`unknown agent type: ${String(args.agent)}`)
      return deps.dispatchWork(agentType, String(args.prompt), parent as never, exec.signal as AbortSignal | undefined)
    },
  })

  // ── continue: Sisyphus resumes a suspended/done sub-agent (reject / relay)
  register({
    name: 'continue',
    description: [
      'Resume a sub-agent by its childId with a new prompt. Use this to reject its conclusion (state the reason and the correction) or to relay a follow-up.',
      'The sub-agent keeps its current turn context and continues working.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The childId of the sub-agent to resume (from go_work or a conclusion/help id).',
        },
        prompt: {
          type: 'string',
          description: 'The new prompt: rejection reason + correction direction, or a follow-up task.',
        },
      },
      required: ['id', 'prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean' },
          messageId: { type: 'string' },
        },
        required: ['accepted'],
      },
      render: (_args, value) => [{ type: 'text', text: `continue → ${value.accepted ? `delivered ${value.messageId}` : 'rejected'}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent as { id: string } | undefined
      if (!parent) throw new Error('continue requires a calling agent (exec.agent was undefined)')
      if (!subagents) throw new Error('subagents service unavailable')
      const record = orchestration.record(String(args.id))
      if (!record) throw new Error(`unknown sub-agent id: ${String(args.id)}`)
      // If the child was suspended on need_help, resolve the pending help.
      if (record.status === 'waiting') {
        for (const help of orchestration.snapshot().helpRequests) {
          if (help.childId === record.childId) orchestration.resolveHelp(help.id)
        }
        orchestration.resume(record.childId)
      }
      const messageId = await subagents.followup(parent as never, record.childId, [{ type: 'text', text: String(args.prompt) }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec.signal as AbortSignal,
      })
      deps.notifyClient()
      return { accepted: true, messageId }
    },
  })

  // ── need_help: sub-agent → Sisyphus, suspends itself ────────────────────
  register({
    name: 'need_help',
    description: [
      'Request assistance from Sisyphus. Use when you need another sub-agent\'s capability (explore/read_doc/look_image), your operation is sandbox/permission denied (execute), you need user clarification (ask_user), or the task is beyond your ability (replan).',
      'Calling this suspends you: Sisyphus will review the request and either forward it or continue you with a new prompt.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['explore', 'read_doc', 'look_image', 'replan', 'execute', 'ask_user'],
          description: 'explore: need Explore to read files/search code. read_doc: need Librarian for docs. look_image: need Multimodal Looker for an image. replan: task exceeds your ability, request reassignment. execute: permission/sandbox denied — ask Sisyphus to run it for you (attach the exact command/operation in content). ask_user: need user input to clarify requirements — ask Sisyphus to relay questions to the user (list questions in content).',
        },
        content: {
          type: 'string',
          description: 'The concrete situation, reason, and details of what you need.',
        },
      },
      required: ['intent', 'content'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          suspended: { type: 'boolean' },
          helpRequestId: { type: 'string' },
        },
        required: ['suspended', 'helpRequestId'],
      },
      render: (_args, value) => [{ type: 'text', text: `need_help → suspended, request ${value.helpRequestId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const child = exec.agent as { id: string } | undefined
      if (!child) throw new Error('need_help requires a calling agent (exec.agent was undefined)')
      const intent = args.intent as HelpIntent
      const id = `help-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const content = String(args.content)
      const agentType = deps.sessionTypes.get(child.id) as AgentType | undefined
      const help = {
        id,
        childId: child.id,
        agentType,
        intent,
        content,
        createdAt: Date.now(),
      }
      const suspended = orchestration.suspend(child.id, help)
      if (suspended === undefined) {
        // The caller is not a tracked sub-agent (e.g. Sisyphus itself).
        throw new Error('need_help is only available to tracked sub-agents (this session is not one)')
      }
      deps.notifyClient()
      // Deliver the help request into the parent (Sisyphus) session.
      if (subagents !== undefined) {
        await subagents.reportFrom(child as never, [
          {
            type: 'text',
            text: [
              `<need_help id="${id}" intent="${intent}" child="${child.id}">`,
              content,
              '</need_help>',
            ].join('\n'),
          },
        ], {
          delivery: 'next-step',
          signal: exec.signal,
        })
      }
      return { suspended: true, helpRequestId: id }
    },
  })

  // ── forward: Sisyphus relays a help request to a target agent ───────────
  register({
    name: 'forward',
    description: [
      'Forward a pending need_help request to a target sub-agent.',
      '- target = childId: equivalent to continue with the help content as prompt (same sub-agent resumes).',
      '- target = agent type: dispatch a NEW sub-agent of that type with the help content as prompt (go_work).',
      'The forwarded help request is resolved; the requesting child stays suspended until you continue it explicitly.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'The helpRequestId to forward (from a need_help injection).',
        },
        target: {
          type: 'string',
          description: 'Target childId (resume) or agent type name (dispatch new).',
        },
      },
      required: ['from', 'target'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          targetId: { type: 'string' },
          resolved: { type: 'boolean' },
        },
        required: ['kind', 'targetId'],
      },
      render: (_args, value) => [{ type: 'text', text: `forward → ${value.kind}: ${value.targetId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent as { id: string } | undefined
      if (!parent) throw new Error('forward requires a calling agent (exec.agent was undefined)')
      const help = orchestration.help(String(args.from))
      if (!help) throw new Error(`unknown help request id: ${String(args.from)}`)
      const prompt = help.content
      const target = String(args.target)
      orchestration.resolveHelp(help.id)
      if (AGENT_TYPES.includes(target as AgentType)) {
        // Dispatch a new sub-agent of that type.
        const result = await deps.dispatchWork(target as AgentType, prompt, parent as never, exec.signal as AbortSignal | undefined)
        deps.notifyClient()
        return { kind: 'go_work', targetId: String(result?.childId ?? ''), resolved: true }
      }
      // Resume an existing child.
      if (!subagents) throw new Error('subagents service unavailable')
      const messageId = await subagents.followup(parent as never, target, [{ type: 'text', text: prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec.signal as AbortSignal,
      })
      orchestration.resume(target)
      deps.notifyClient()
      return { kind: 'continue', targetId: messageId, resolved: true }
    },
  })

  // ── orchestration_status: read-only snapshot for Sisyphus ──────────────
  register({
    name: 'orchestration_status',
    description: 'Read the current orchestration state: running sub-agent, queue, pending help requests, and run history with conclusions.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const s = orchestration.snapshot()
      const lines: string[] = []
      if (s.current) {
        lines.push(`● running: ${s.current.agentType} (${s.current.childId}) — ${s.current.status}`)
      } else {
        lines.push('○ idle')
      }
      if (s.queue.length > 0) {
        lines.push(`⏳ queue: ${s.queue.map((w) => `${w.agentType}#${w.id}`).join(', ')}`)
      }
      for (const help of s.helpRequests) {
        lines.push(`❓ help ${help.id}: [${help.intent}] ${help.content.slice(0, 120)}`)
      }
      const recent = s.history.slice(-5)
      for (const r of recent) {
        const summary = (r.conclusion ?? '').replace(/\s+/g, ' ').slice(0, 80)
        lines.push(`✓ ${r.agentType} (${r.childId}) ${r.status}: ${summary}`)
      }
      return { text: lines.join('\n') }
    },
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function describeAgent(type: AgentType): string {
  switch (type) {
    case 'hermes': return 'fast execution: batch replace, formatting, imports, copy-paste'
    case 'explore': return 'fast search: grep, read files, locate symbols, scan structure'
    case 'librarian': return 'document lookup: README, API reference, comments'
    case 'looker': return 'multimodal recognition: UI screenshots, designs, PDF charts'
    case 'hephaestus': return 'code writing: single-file refactor, module implementation, unit tests'
    case 'prometheus': return 'requirement planning: break vague requirements into executable steps (call once at flow start)'
    case 'oracle': return 'architecture debugging + final acceptance: cross-module analysis, deep bugs, review'
  }
}

/** One-shot helper: deliver a conclusion notice into the parent session. */
export function conclusionBlocks(record: { agentType: string; childId: string; conclusion: string }): ContentBlock[] {
  return [{
    type: 'text',
    text: [
      `<conclusion child="${record.childId}" agent="${record.agentType}">`,
      record.conclusion,
      '</conclusion>',
    ].join('\n'),
  }]
}
