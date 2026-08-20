/**
 * dsh-my-go broker: orchestration state machine (host plane).
 *
 * Owns the star-topology, single-line-blocking executor state:
 *  - the currently running sub-agent (at most one),
 *  - the pending go_work queue,
 *  - suspended need_help requests,
 *  - the run history with conclusions.
 *
 * Pure state container: it does not touch DSH services itself. The plugin's
 * tools and event listeners drive it through the documented methods.
 */

export type AgentType =
  | 'hermes'
  | 'explore'
  | 'librarian'
  | 'looker'
  | 'hephaestus'
  | 'prometheus'
  | 'oracle'

export const AGENT_TYPES: readonly AgentType[] = [
  'hermes',
  'explore',
  'librarian',
  'looker',
  'hephaestus',
  'prometheus',
  'oracle',
]

export const AGENT_TYPE_PREFIX = 'dsh-my-go:'

/** Encode an agent type into a durable subagent label. */
export function agentLabel(type: AgentType, summary: string): string {
  return `${AGENT_TYPE_PREFIX}${type}${summary ? `: ${summary}` : ''}`
}

/** Parse a durable subagent label back into its agent type (or undefined). */
export function parseAgentType(label: string | undefined): AgentType | undefined {
  if (typeof label !== 'string') return undefined
  const match = /^dsh-my-go:([a-z-]+)/.exec(label)
  if (!match) return undefined
  const type = match[1] as AgentType
  return AGENT_TYPES.includes(type) ? type : undefined
}

export type RunStatus =
  | 'queued'      // waiting in the go_work queue
  | 'spawning'    // startContinuable in flight
  | 'running'     // child is actively working
  | 'waiting'     // child suspended on need_help
  | 'done'        // child produced a conclusion
  | 'failed'      // child errored / aborted

export type HelpIntent = 'explore' | 'read_doc' | 'look_image' | 'replan'

export interface HelpRequest {
  /** Stable id injected into Sisyphus context (used by forward). */
  readonly id: string
  /** The child that asked for help. */
  readonly childId: string
  readonly agentType: AgentType | undefined
  readonly intent: HelpIntent
  readonly content: string
  readonly createdAt: number
}

export interface PendingWork {
  /** Queue id; stable across enqueue until start. */
  readonly id: string
  readonly agentType: AgentType
  readonly prompt: string
  /** Session id of the parent (Sisyphus) that queued this work. */
  readonly parentId?: string
  readonly createdAt: number
}

export interface RunRecord {
  readonly childId: string
  readonly agentType: AgentType
  readonly prompt: string
  readonly status: RunStatus
  /** Conclusion content delivered to Sisyphus (set when done/failed). */
  conclusion?: string
  /** Stable conclusion id (set when done/failed). */
  conclusionId?: string
  readonly createdAt: number
  updatedAt: number
}

export interface OrchestrationSnapshot {
  readonly current: RunRecord | null
  readonly queue: PendingWork[]
  readonly helpRequests: HelpRequest[]
  readonly history: RunRecord[]
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

export class Orchestration {
  private readonly currentMap = new Map<string, RunRecord>()
  private queue: PendingWork[] = []
  private helpRequests = new Map<string, HelpRequest>()
  private history: RunRecord[] = []
  private listeners = new Set<(snapshot: OrchestrationSnapshot) => void>()

  /** Subscribe to snapshot changes (for the client bridge / UI). */
  onChange(listener: (snapshot: OrchestrationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): OrchestrationSnapshot {
    return {
      current: this.currentMap.size > 0 ? [...this.currentMap.values()][0] ?? null : null,
      queue: [...this.queue],
      helpRequests: [...this.helpRequests.values()],
      history: [...this.history],
    }
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch {
        // A broken listener must never break the orchestrator.
      }
    }
  }

  /** The single currently-running/waiting child, if any. */
  current(): RunRecord | null {
    return this.snapshot().current
  }

  isBusy(): boolean {
    return this.currentMap.size > 0
  }

  /** Enqueue a go_work request; returns the pending work id. */
  enqueue(agentType: AgentType, prompt: string, parentId?: string): string {
    const id = nextId('work')
    this.queue.push({ id, agentType, prompt, parentId, createdAt: Date.now() })
    this.emit()
    return id
  }

  /** Mark a child as spawning (startContinuable in flight). */
  beginSpawning(agentType: AgentType, prompt: string): RunRecord {
    const record: RunRecord = {
      childId: nextId('child'),
      agentType,
      prompt,
      status: 'spawning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.currentMap.set(record.childId, record)
    this.emit()
    return record
  }

  /** Bind the real child session id once startContinuable resolves. */
  bindChild(placeholderId: string, childId: string): RunRecord | undefined {
    const record = this.currentMap.get(placeholderId)
    if (!record) return undefined
    this.currentMap.delete(placeholderId)
    this.currentMap.set(childId, { ...record, childId, status: 'running', updatedAt: Date.now() })
    this.emit()
    return this.currentMap.get(childId)
  }

  /** Remove the head of the queue (after the current child settled). */
  dequeue(): PendingWork | undefined {
    const work = this.queue.shift()
    if (work) this.emit()
    return work
  }

  /** Transition one child into waiting (need_help). */
  suspend(childId: string, help: HelpRequest): RunRecord | undefined {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    this.helpRequests.set(help.id, help)
    this.currentMap.set(childId, { ...record, status: 'waiting', updatedAt: Date.now() })
    this.emit()
    return this.currentMap.get(childId)
  }

  /** Mark a help request resolved (forward / continue consumed it). */
  resolveHelp(id: string): HelpRequest | undefined {
    const help = this.helpRequests.get(id)
    if (help) this.helpRequests.delete(id)
    if (help) this.emit()
    return help
  }

  /** Transition one child back to running (continue / forward delivered). */
  resume(childId: string): RunRecord | undefined {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    if (record.status !== 'waiting') return record
    this.currentMap.set(childId, { ...record, status: 'running', updatedAt: Date.now() })
    this.emit()
    return this.currentMap.get(childId)
  }

  /** Finalize one child with its conclusion (subagent/end or explicit report). */
  finish(childId: string, conclusion: string, failed = false): RunRecord | undefined {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    const conclusionId = nextId('conclusion')
    const done: RunRecord = {
      ...record,
      status: failed ? 'failed' : 'done',
      conclusion,
      conclusionId,
      updatedAt: Date.now(),
    }
    this.currentMap.delete(childId)
    this.history = [...this.history, done]
    // Cap history at 200 entries to bound memory.
    if (this.history.length > 200) this.history = this.history.slice(-200)
    this.emit()
    return done
  }

  /** Forget the current child without recording it (spawn failure). */
  abort(childId: string): void {
    this.currentMap.delete(childId)
    this.emit()
  }

  /** Recover a finished/waiting record by id (for continue on done children). */
  record(childId: string): RunRecord | undefined {
    return this.currentMap.get(childId) ?? this.history.find((r) => r.childId === childId)
  }

  help(id: string): HelpRequest | undefined {
    return this.helpRequests.get(id)
  }
}
