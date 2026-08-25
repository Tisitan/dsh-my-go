/**
 * dsh-my-go — Sisyphus agent orchestration (HOST half, npm bundle).
 *
 * The host plugin of the `dsh-my-go` npm package. Registered through the
 * package's own `cordis.patch.yml` (dsh.bundle.patch), so `dsh plugin add
 * dsh-my-go` activates it automatically as a profile layer.
 *
 * Provides:
 *   - orchestration tools: go_work / continue / need_help / forward /
 *     orchestration_status
 *   - per-agent model/effort binding at the `agent/request` waterfall
 *   - conclusion injection + queue advancement on `subagent/end`
 *   - settings namespace `dsh-my-go` (provider/model/reasoningEffort/
 *     dsv4p0813 per agent type) when a settings service is mounted
 */

export const name = 'dsh-my-go'

export const inject = ['tools', 'subagents', 'systemPrompt', 'llm', 'settings']

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const AGENT_TYPES = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

/**
 * Install the bundled agent preset into the user preset root once, so the
 * "MyGO!!!!! 模式" preset appears in the session picker after `dsh plugin
 * add dsh-my-go`. DSH discovers presets only from configured roots
 * (~/.dsh/.agent-presets/), never from node_modules, so the npm bundle must
 * copy its preset/ directory there. Idempotent: synced only when the package
 * version changes (marker file `.dsh-my-go-version`), so manual tweaks to the
 * installed preset survive same-version reloads.
 * Failures are logged and swallowed — the host plugin must keep working even
 * when the preset copy is not possible.
 */
async function ensurePresetInstalled() {
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // .../dsh-my-go/lib
    const packageRoot = dirname(here) // .../dsh-my-go
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const userPresetRoot = join(dshHome, '.agent-presets')
    const target = join(userPresetRoot, 'dsh-my-go')
    const markerPath = join(target, '.dsh-my-go-version')
    // Version marker: skip sync when the installed copy matches this package
    let version = '0.0.0'
    try {
      const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf-8'))
      version = String(pkg.version ?? version)
    } catch { /* fall through with default */ }
    try {
      const installed = (await readFile(markerPath, 'utf-8')).trim()
      if (installed === version) return // already synced for this version
    } catch { /* no marker → first install or legacy copy: sync below */ }
    await mkdir(userPresetRoot, { recursive: true })
    // Sync preset/ directory (composition + tools)
    const presetSource = join(packageRoot, 'preset')
    await access(presetSource)
    await cp(presetSource, target, { recursive: true, force: true })
    // Sync prompts/ directory (persona markdown files)
    const promptsSource = join(packageRoot, 'prompts')
    const promptsTarget = join(target, 'prompts')
    try {
      await access(promptsSource)
      await cp(promptsSource, promptsTarget, { recursive: true, force: true })
    } catch { /* prompts/ optional — degrade gracefully */ }
    await writeFile(markerPath, version, 'utf-8')
    console.log(`[dsh-my-go] preset synced to ${target} (v${version})`)
  } catch (error) {
    console.error(`[dsh-my-go] could not sync preset: ${String(error)}`)
  }
}

const AGENT_TYPE_PREFIX = 'dsh-my-go:'

function agentLabel(type, summary) {
  return `${AGENT_TYPE_PREFIX}${type}${summary ? `: ${summary}` : ''}`
}

/** Default bindings per AGENTS.md. Provider stays unset for light agents so
 * they inherit Sisyphus's route; heavy agents pin the octopus gateway.
 * reasoningEffort is only ever applied when the exact model supports that
 * level (checked against the DSH model catalog at request time); light agents
 * leave it unset so the model's own default applies. */
function defaultBindings() {
  return {
    sisyphus: { dsv4p0813: false },
    hermes: { model: 'mimo-v2.5', dsv4p0813: false },
    explore: { model: 'mimo-v2.5', dsv4p0813: false },
    librarian: { model: 'mimo-v2.5', dsv4p0813: false },
    looker: { model: 'mimo-v2.5', dsv4p0813: false },
    hephaestus: { provider: 'octopus', model: 'deepseek-v4-flash', reasoningEffort: 'high', dsv4p0813: false },
    prometheus: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max', dsv4p0813: false },
    oracle: { provider: 'octopus', model: 'deepseek-v4-pro', reasoningEffort: 'max', dsv4p0813: false },
  }
}

function describeAgent(type) {
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

let seq = 0
function nextId(prefix) {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

/** Minimal single-line-blocking orchestration state. */
class Orchestration {
  constructor() {
    this.currentMap = new Map()
    this.queue = []
    this.helpRequests = new Map()
    this.history = []
    this.listeners = new Set()
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      current: this.currentMap.size > 0 ? [...this.currentMap.values()][0] ?? null : null,
      queue: [...this.queue],
      helpRequests: [...this.helpRequests.values()],
      history: [...this.history],
    }
  }

  emit() {
    const snapshot = this.snapshot()
    for (const listener of [...this.listeners]) {
      try { listener(snapshot) } catch { /* noop */ }
    }
  }

  isBusy() { return this.currentMap.size > 0 }

  enqueue(agentType, prompt, parentId) {
    const id = nextId('work')
    this.queue.push({ id, agentType, prompt, parentId, createdAt: Date.now() })
    this.emit()
    return id
  }

  beginSpawning(agentType, prompt) {
    const record = {
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

  bindChild(placeholderId, childId) {
    const record = this.currentMap.get(placeholderId)
    if (!record) return undefined
    this.currentMap.delete(placeholderId)
    const next = { ...record, childId, status: 'running', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  dequeue() {
    const work = this.queue.shift()
    if (work) this.emit()
    return work
  }

  suspend(childId, help) {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    this.helpRequests.set(help.id, help)
    const next = { ...record, status: 'waiting', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  resolveHelp(id) {
    const help = this.helpRequests.get(id)
    if (help) { this.helpRequests.delete(id); this.emit() }
    return help
  }

  resume(childId) {
    const record = this.currentMap.get(childId)
    if (!record || record.status !== 'waiting') return record
    const next = { ...record, status: 'running', updatedAt: Date.now() }
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  finish(childId, conclusion, failed = false) {
    const record = this.currentMap.get(childId)
    if (!record) return undefined
    const conclusionId = nextId('conclusion')
    const done = {
      ...record,
      status: failed ? 'failed' : 'done',
      conclusion,
      conclusionId,
      updatedAt: Date.now(),
    }
    this.currentMap.delete(childId)
    this.clearHelpFor(childId)
    this.history = [...this.history, done]
    if (this.history.length > 200) this.history = this.history.slice(-200)
    this.emit()
    return done
  }

  clearHelpFor(childId) {
    let removed = false
    for (const [id, help] of this.helpRequests) {
      if (help.childId === childId) {
        this.helpRequests.delete(id)
        removed = true
      }
    }
    if (removed) this.emit()
    return removed
  }

  requeueHead(work) {
    if (!work) return
    this.queue.unshift(work)
    this.emit()
  }

  dropQueuedFor(parentId) {
    const before = this.queue.length
    this.queue = this.queue.filter((w) => w.parentId !== parentId)
    if (this.queue.length !== before) this.emit()
    return before - this.queue.length
  }

  /** Move a done/failed history record back into currentMap as running (revive via continue/forward). */
  revive(childId) {
    if (this.currentMap.has(childId)) return this.currentMap.get(childId)
    const idx = this.history.findIndex((r) => r.childId === childId)
    if (idx < 0) return undefined
    const rec = this.history[idx]
    const next = { ...rec, status: 'running', updatedAt: Date.now() }
    this.history = [...this.history.slice(0, idx), ...this.history.slice(idx + 1)]
    this.currentMap.set(childId, next)
    this.emit()
    return next
  }

  abort(childId) {
    this.currentMap.delete(childId)
    this.emit()
  }

  record(childId) {
    return this.currentMap.get(childId) ?? this.history.find((r) => r.childId === childId)
  }

  /** Record the latest prompt Sisyphus sent to one child (go_work or continue). */
  followupPrompt(childId, prompt) {
    const rec = this.currentMap.get(childId)
    if (rec) {
      this.currentMap.set(childId, { ...rec, prompt, updatedAt: Date.now() })
      this.emit()
      return this.currentMap.get(childId)
    }
    const idx = this.history.findIndex((r) => r.childId === childId)
    if (idx >= 0) {
      const next = { ...this.history[idx], prompt, updatedAt: Date.now() }
      this.history = [...this.history.slice(0, idx), next, ...this.history.slice(idx + 1)]
      this.emit()
      return next
    }
    return undefined
  }

  help(id) { return this.helpRequests.get(id) }
}

export async function apply(ctx, config = {}) {
  void ensurePresetInstalled()
  const orchestration = new Orchestration()
  const sessionTypes = new Map()
  // 合并基线：默认值 + 插件 config。settings 覆盖永远从基线起算，
  // 这样 WebUI 取消某字段后能正确回落默认，而不是残留旧的已合并值。
  const baseBindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  let bindings = { ...baseBindings }
  const bindSisyphus = config.bindSisyphus === true

  // Track authorized orchestrators: any agent on this preset that is NOT
  // a sub-agent (has no parentSession) can use orchestration tools.
  // We do NOT use "first caller" — that breaks multi-session environments.
  const isSubAgent = (agent) => {
    if (!agent || typeof agent.id !== 'string') return false
    return agent?.session?.header?.parentSession != null
  }
  const canOrchestrate = (agent) => agent && typeof agent.id === 'string' && !isSubAgent(agent)
  // ── settings-backed bindings (WebUI configurable) ───────────────────────
  const settings = ctx.get('settings')
  let settingsScope
  if (settings !== undefined) {
    try {
      // Dynamic import so a loader without npm-package resolution for local
      // mjs files degrades to defaults instead of failing the preset mount.
      const mod = await import('@deepseek-ai/schemastery')
      const z = mod.default ?? mod
      const agentSchema = z.object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string(),
        dsv4p0813: z.boolean(),
      })
      settingsScope = settings.register(
        'dsh-my-go',
        z.object({
          sisyphus: agentSchema,
          hermes: agentSchema,
          explore: agentSchema,
          librarian: agentSchema,
          looker: agentSchema,
          hephaestus: agentSchema,
          prometheus: agentSchema,
          oracle: agentSchema,
        }),
        {},
      )
      const stored = settings.get('dsh-my-go')
      if (stored && typeof stored === 'object') {
        const merged = { ...baseBindings }
        for (const key of ['sisyphus', ...AGENT_TYPES]) {
          const row = stored[key]
          if (row && typeof row === 'object') {
            merged[key] = {
              provider: row.provider || merged[key]?.provider,
              model: row.model || merged[key]?.model,
              reasoningEffort: row.reasoningEffort || merged[key]?.reasoningEffort,
              dsv4p0813: row.dsv4p0813 ?? merged[key]?.dsv4p0813 ?? false,
            }
          }
        }
        bindings = merged
      }
      ctx.on('settings/updated', (ns) => {
        if (ns !== 'dsh-my-go') return
        const next = settings.get('dsh-my-go')
        if (next && typeof next === 'object') {
          const merged = { ...baseBindings }
          for (const key of ['sisyphus', ...AGENT_TYPES]) {
            const row = next[key]
            if (row && typeof row === 'object') {
              merged[key] = {
                provider: row.provider || merged[key]?.provider,
                model: row.model || merged[key]?.model,
                reasoningEffort: row.reasoningEffort || merged[key]?.reasoningEffort,
                dsv4p0813: row.dsv4p0813 ?? merged[key]?.dsv4p0813 ?? false,
              }
            }
          }
          bindings = merged
        }
      })
    } catch {
      // Settings optional — defaults apply.
    }
  }

  // ── client bridge via connection.rpc (bundle plugins use connection.rpc,
  // NOT harness.handle, which is reserved for dynamic cordis plugins) ──────
  let latestSnapshot = null
  let snapshotSeq = 0
  // Track the last orchestrator session for queue fallback and client auto-jump.
  let lastOrchestratorSessionId = null
  const bump = () => {
    snapshotSeq += 1
    latestSnapshot = { seq: snapshotSeq, parentSessionId: lastOrchestratorSessionId, ...orchestration.snapshot() }
  }
  orchestration.onChange(() => bump())

  ctx.inject(['connection'], (webContext) => {
    if (webContext.connection === undefined) return
    const rpc = webContext.connection.rpc
    if (!rpc || typeof rpc.handle !== 'function') return

    // Single channel with endpoint dispatch (same pattern as dsh-mnemon):
    // channel = "/dsh-my-go", endpoints = "snapshot" | "listModels"
    rpc.handle('/dsh-my-go', async (endpoint, payload) => {
      if (endpoint === 'snapshot') {
        // 优先读 agent 平面 broker 发布的真实编排快照（Symbol.for 全局桥）；
        // 桥不存在时回落到本实例自己的状态机（preset 未装配的部署形态）。
        const shared = globalThis[Symbol.for('dsh-my-go.snapshot')]
        const value = typeof shared === 'function' ? shared() : latestSnapshot
        return { ok: true, value: value ?? { seq: 0, current: null, queue: [], helpRequests: [], history: [] } }
      }
      if (endpoint === 'listModels') {
        const llm = ctx.get('llm')
        if (!llm) return { ok: true, value: { providers: [], models: {} } }
        let providers = []
        try {
          // Use listProviders() — returns only ACTIVE/configured providers,
          // NOT listConfigurableProviders() which includes unconfigured ones
          const active = await llm.listProviders()
          providers = active.map((p) => p.id)
        } catch { /* llm not available */ }
        const models = {}
        for (const pid of providers) {
          try {
            const list = await llm.listModels(pid)
            models[pid] = list.map((m) => m.id)
          } catch { /* provider may not support listing */ }
        }
        return { ok: true, value: { providers, models } }
      }
      if (endpoint === 'loadSettings') {
        const settingsService = ctx.get('settings')
        if (!settingsService) return { ok: true, value: {} }
        try {
          const stored = settingsService.get('dsh-my-go')
          return { ok: true, value: stored && typeof stored === 'object' ? stored : {} }
        } catch (e) {
          return { ok: true, value: {} }
        }
      }
      if (endpoint === 'saveSettings') {
        const draft = payload
        if (!draft || typeof draft !== 'object') return { ok: false, error: { code: 'bad-request', message: 'payload must be an object' } }
        const settingsService = ctx.get('settings')
        if (!settingsService) return { ok: false, error: { code: 'unavailable', message: 'settings service not available' } }
        try {
          const agentTypes = ['sisyphus', 'hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']
          const fields = ['provider', 'model', 'reasoningEffort', 'dsv4p0813']
          const ops = []
          for (const type of agentTypes) {
            for (const field of fields) {
              const val = draft[type]?.[field]
              if (val === undefined || val === null || val === '') {
                ops.push({ op: 'unset', path: [type, field] })
              } else {
                ops.push({ op: 'set', path: [type, field], value: val })
              }
            }
          }
          if (ops.length > 0) await settingsService.mutate('dsh-my-go', ops)
          return { ok: true, value: null }
        } catch (e) {
          return { ok: false, error: { code: 'settings-rejected', message: String(e) } }
        }
      }
      return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}` } }
    }, { authority: 'trusted-host' })
  })

  // ── internal go_work implementation (shared by the tool, forward, queue) ─
  // 队列推进：取出队首并派发；派发失败时回补队首——任务不蒸发、队列不停摆。
  function advanceQueue(parentHint) {
    if (orchestration.isBusy()) return
    const work = orchestration.dequeue()
    if (!work) return
    const agents = ctx.get('agents')
    const parentAgent = (work.parentId && agents ? agents.get(work.parentId) : undefined) ?? parentHint
    void dispatchWork(work.agentType, work.prompt, parentAgent, undefined).catch((error) => {
      orchestration.requeueHead(work)
      bump()
      console.error('[dsh-my-go] queued dispatch failed, task requeued:', error)
    })
  }

  async function dispatchWork(agentType, prompt, parent, signal) {
    if (!AGENT_TYPES.includes(agentType)) throw new Error(`unknown agent type: ${String(agentType)}`)
    const binding = bindings[agentType] ?? {}
    // Parent may be absent during queue advancement (agent object not retained);
    // fall back to the last orchestrator session so delegation still works.
    // (Do NOT use agents.roots()[0] — that leaks queued work into other sessions.)
    if (!parent) {
      const agents = ctx.get('agents')
      const fallback = lastOrchestratorSessionId ? agents?.get?.(lastOrchestratorSessionId) : undefined
      if (fallback) parent = fallback
    }
    if (!parent) throw new Error('go_work requires a live parent agent to delegate from')
    lastOrchestratorSessionId = parent.id
    if (orchestration.isBusy()) {
      const workId = orchestration.enqueue(agentType, prompt, parent?.id)
      bump()
      return { childId: workId, status: 'queued', label: agentLabel(agentType, prompt.slice(0, 60)), queued: true }
    }
    const placeholder = orchestration.beginSpawning(agentType, prompt)
    try {
      const request = {
        label: agentLabel(agentType, prompt.slice(0, 60)),
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(binding.provider !== undefined || binding.model !== undefined
          ? { agentOptions: { ...(binding.provider !== undefined ? { provider: binding.provider } : {}), ...(binding.model !== undefined ? { model: binding.model } : {}) } }
          : {}),
        signal,
      }
      const { childId } = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: request.label,
        request,
        signal,
      })
      sessionTypes.set(childId, agentType)
      orchestration.bindChild(placeholder.childId, childId)
      bump()
      return { childId, status: 'running', label: request.label, queued: false }
    } catch (error) {
      orchestration.abort(placeholder.childId)
      bump()
      // 槽位已腾出：立即推进队首，避免后续排队任务永久等待
      advanceQueue(parent)
      throw new Error(`go_work failed: ${String(error)}`)
    }
  }

  // ── tools ───────────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'go_work',
    description: [
      'Dispatch a new sub-agent to work on a task. The sub-agent starts with an empty context and only the tools of its type.',
      'Available agent types:',
      ...AGENT_TYPES.map((t) => `- ${t}: ${describeAgent(t)}`),
      'Single-line blocking: if a sub-agent is already running, this task is queued and starts when the current one finishes.',
      'The result contains a childId you keep for later continue/forward operations.',
      'If the task was queued (queued=true), the returned id is a queue placeholder (work-*), NOT a childId — once dispatched, find the real childId via orchestration_status.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: AGENT_TYPES, description: 'Which sub-agent type to dispatch.' },
        prompt: { type: 'string', description: 'The complete, self-contained task prompt for the sub-agent.' },
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
      const parent = exec?.agent
      if (!parent) throw new Error('go_work requires a calling agent (exec.agent was undefined)')
      if (!canOrchestrate(parent)) throw new Error('go_work is reserved for orchestrator sessions (agents without parentSession)')
      return dispatchWork(args.agent, args.prompt, parent, exec?.signal)
    },
  })

  ctx.tools.register({
    name: 'continue',
    description: 'Resume a sub-agent by its childId with a new prompt. Use to reject its conclusion (state reason + correction) or relay a follow-up. The sub-agent keeps its current turn context.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The childId of the sub-agent to resume.' },
        prompt: { type: 'string', description: 'The new prompt: rejection reason + correction, or a follow-up task.' },
      },
      required: ['id', 'prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { accepted: { type: 'boolean' }, messageId: { type: 'string' } },
        required: ['accepted'],
      },
      render: (_args, value) => [{ type: 'text', text: `continue → ${value.accepted ? `delivered ${value.messageId}` : 'rejected'}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec?.agent
      if (!parent) throw new Error('continue requires a calling agent (exec.agent was undefined)')
      if (!canOrchestrate(parent)) throw new Error('continue is reserved for orchestrator sessions (agents without parentSession)')
      const record = orchestration.record(args.id)
      if (!record) {
        const queued = orchestration.snapshot().queue.find((w) => w.id === args.id)
        if (queued) {
          throw new Error(`task ${String(args.id)} (${queued.agentType}) is still queued — wait for dispatch, then use its real childId (see orchestration_status)`)
        }
        throw new Error(`unknown sub-agent id: ${String(args.id)}`)
      }
      const isFinished = !orchestration.currentMap.has(record.childId)
      if (isFinished && orchestration.isBusy()) {
        throw new Error('another sub-agent is currently running; wait for it to finish before reviving a completed sub-agent (single-line blocking)')
      }
      // 先投递，成功后再落账：投递失败不会留下假 running、也不会弄丢求助单
      const messageId = await ctx.subagents.followup(parent, record.childId, [{ type: 'text', text: args.prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      if (record.status === 'waiting') {
        for (const help of orchestration.snapshot().helpRequests) {
          if (help.childId === record.childId) orchestration.resolveHelp(help.id)
        }
        orchestration.resume(record.childId)
      } else if (isFinished) {
        // 驳回/追问一个已结束的子智能体：重新入册并恢复类型登记，
        // 否则它游离在单线阻塞之外，且再次结束时结论会被静默丢弃
        orchestration.revive(record.childId)
        sessionTypes.set(record.childId, record.agentType)
      }
      orchestration.followupPrompt(record.childId, args.prompt)
      bump()
      return { accepted: true, messageId }
    },
  })

  ctx.tools.register({
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
        content: { type: 'string', description: 'The concrete situation, reason, and details of what you need.' },
      },
      required: ['intent', 'content'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { suspended: { type: 'boolean' }, helpRequestId: { type: 'string' } },
        required: ['suspended', 'helpRequestId'],
      },
      render: (_args, value) => [{ type: 'text', text: `need_help → suspended, request ${value.helpRequestId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const child = exec?.agent
      if (!child) throw new Error('need_help requires a calling agent (exec.agent was undefined)')
      const id = `help-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const help = {
        id,
        childId: child.id,
        agentType: sessionTypes.get(child.id),
        intent: args.intent,
        content: args.content,
        createdAt: Date.now(),
      }
      const suspended = orchestration.suspend(child.id, help)
      if (suspended === undefined) {
        // The caller is not a tracked sub-agent (e.g. Sisyphus itself).
        throw new Error('need_help is only available to tracked sub-agents (this session is not one)')
      }
      bump()
      try {
        await ctx.subagents.reportFrom(child, [{
          type: 'text',
          text: `<need_help id="${id}" intent="${args.intent}" child="${child.id}">\n${args.content}\n</need_help>`,
        }], { delivery: 'next-step', signal: exec?.signal })
      } catch {
        // Report failure must not break the suspension bookkeeping.
      }
      return { suspended: true, helpRequestId: id }
    },
  })

  ctx.tools.register({
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
        from: { type: 'string', description: 'The helpRequestId to forward.' },
        target: { type: 'string', description: 'Target childId (resume) or agent type name (dispatch new).' },
      },
      required: ['from', 'target'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { type: 'string' }, targetId: { type: 'string' }, resolved: { type: 'boolean' } },
        required: ['kind', 'targetId'],
      },
      render: (_args, value) => [{ type: 'text', text: `forward → ${value.kind}: ${value.targetId}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec?.agent
      if (!parent) throw new Error('forward requires a calling agent (exec.agent was undefined)')
      if (!canOrchestrate(parent)) throw new Error('forward is reserved for orchestrator sessions (agents without parentSession)')
      const help = orchestration.help(args.from)
      if (!help) throw new Error(`unknown help request id: ${String(args.from)}`)
      const prompt = help.content
      const target = String(args.target)
      if (AGENT_TYPES.includes(target)) {
        // Dispatch a new sub-agent of that type.
        const result = await dispatchWork(target, prompt, parent, exec?.signal)
        orchestration.resolveHelp(help.id) // 投递成功后才销账，失败则求助单保留
        bump()
        return { kind: 'go_work', targetId: String(result?.childId ?? ''), resolved: true }
      }
      const record = orchestration.record(target)
      if (!record) throw new Error(`unknown sub-agent id: ${target}`)
      const isFinished = !orchestration.currentMap.has(target)
      if (isFinished && orchestration.isBusy()) {
        throw new Error('another sub-agent is currently running; wait for it to finish before forwarding to a completed sub-agent (single-line blocking)')
      }
      const messageId = await ctx.subagents.followup(parent, target, [{ type: 'text', text: prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      orchestration.followupPrompt(target, prompt)
      if (record.status === 'waiting') {
        orchestration.resume(target)
      } else if (isFinished) {
        orchestration.revive(target)
        sessionTypes.set(target, record.agentType)
      }
      orchestration.resolveHelp(help.id)
      bump()
      return { kind: 'continue', targetId: messageId, resolved: true }
    },
  })

  ctx.tools.register({
    name: 'orchestration_status',
    description: 'Read the current orchestration state: running sub-agent, queue, pending help requests, and run history with conclusions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const s = orchestration.snapshot()
      const lines = []
      if (s.current) {
        lines.push(`● running: ${s.current.agentType} (${s.current.childId}) — ${s.current.status}`)
      } else {
        lines.push('○ idle')
      }
      if (s.queue.length > 0) lines.push(`⏳ queue: ${s.queue.map((w) => `${w.agentType}#${w.id}`).join(', ')}`)
      for (const help of s.helpRequests) lines.push(`❓ help ${help.id}: [${help.intent}] ${help.content.slice(0, 120)}`)
      for (const r of s.history.slice(-5)) {
        const summary = (r.conclusion ?? '').replace(/\s+/g, ' ').slice(0, 80)
        lines.push(`✓ ${r.agentType} (${r.childId}) ${r.status}: ${summary}`)
      }
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'list_subagents',
    description: [
      'List every sub-agent this orchestration has spawned: its agent type, childId, current status, and the LAST prompt Sisyphus sent it (go_work or continue).',
      'Use this to decide whether to continue an existing sub-agent (same task, keep context) or dispatch a new one — especially when reusing an idle/done worker for a follow-up step instead of paying for a fresh context.',
    ].join('\n'),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const s = orchestration.snapshot()
      const lines = ['# 当前 sub-agents']
      const all = [...(s.current ? [s.current] : []), ...s.history.slice(-50)]
      const seen = new Set()
      for (const r of all) {
        if (seen.has(r.childId)) continue
        seen.add(r.childId)
        const prompt = (r.prompt ?? '').replace(/\s+/g, ' ').slice(0, 140)
        lines.push(`- ${r.agentType} (${r.childId}) [${r.status}] 最后 prompt: ${prompt}`)
      }
      if (s.queue.length > 0) {
        lines.push('# 队列（等待中）')
        for (const w of s.queue) lines.push(`- ${w.agentType} (${w.id}) 排队中 prompt: ${w.prompt.replace(/\s+/g, ' ').slice(0, 140)}`)
      }
      if (lines.length === 1) lines.push('（还没有任何 sub-agent）')
      return { text: lines.join('\n') }
    },
  })

  // ── model/effort binding at the request waterfall ───────────────────────
  // reasoningEffort follows the DSH model catalog: some models have no
  // thinking levels, others expose a different set (off/high/max, low, etc.).
  // We only ever set an effort the exact model actually supports; when the
  // configured effort is unsupported (or the model exposes none), we leave
  // the field unset so the adapter's default behavior applies — never hard-map
  // or clamp, which would reject or silently alter the request.
  const llm = ctx.get('llm')
  const effortCache = new Map() // `${provider}/${model}` -> Set<effortId> | null
  async function supportedEfforts(provider, model) {
    const key = `${provider}/${model}`
    const cached = effortCache.get(key)
    if (cached !== undefined) return cached
    let result = null // null = unknown (leave effort unset)
    try {
      if (llm && typeof llm.resolveModelInfo === 'function') {
        const info = await llm.resolveModelInfo(provider, model)
        const efforts = info?.reasoning?.efforts
        if (Array.isArray(efforts) && efforts.length > 0) {
          result = new Set(efforts.map((e) => String(e?.id)))
        }
      }
    } catch {
      // Capability lookup must never break the request; unknown → leave unset.
    }
    effortCache.set(key, result)
    return result
  }

  // Model validation cache: provider -> Set of model ids
  const modelCache = new Map()
  async function modelExists(provider, model) {
    const key = String(provider)
    let set = modelCache.get(key)
    if (set === undefined) {
      set = new Set()
      try {
        const list = await llm.listModels(key)
        for (const m of list) set.add(m.id)
      } catch { /* provider may not support listing */ }
      // 只缓存非空结果：瞬时失败/空列表不永久缓存（负缓存会让模型绑定
      // 在本进程生命周期内静默失效），留待下次请求重试
      if (set.size > 0) modelCache.set(key, set)
    }
    return set.has(String(model))
  }

  // 仅对 Sisyphus 主会话（非子智能体）隐藏 skill 工具以节省主会话上下文；
  // 子智能体保留 skill，但在目录层摘除原生派生工具与编排工具（星型拓扑闸，
  // 与 canOrchestrate 运行时守卫互为双保险）。与 broker.mjs 保持一致。
  ctx.on('agent/created', ({ agent }) => {
    if (!agent) return
    try {
      if (isSubAgent(agent)) {
        agent.ctx.tools.restrict({
          deny: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'go_work', 'continue', 'forward'],
        })
        return
      }
      agent.ctx.tools.restrict({ deny: ['skill'] })
    } catch (e) {
      // agent.ctx 尚未 ready 或工具名未注册时兜底，不阻断流程
    }
  })

  ctx.on('agent/request', async (payload, next) => {
    const seed = await next()
    const agent = payload?.agent
    if (!agent) return seed
    const type = sessionTypes.get(agent.id)
    if (type === undefined && !bindSisyphus) return seed
    const binding = bindings[type ?? 'sisyphus'] ?? {}
    const nextConfig = { ...seed }
    if (binding.provider !== undefined) nextConfig.provider = binding.provider
    if (binding.model !== undefined) {
      // Validate model exists on the resolved provider before applying
      const resolvedProvider = String(nextConfig.provider ?? seed.provider ?? '')
      if (!resolvedProvider || await modelExists(resolvedProvider, binding.model)) {
        nextConfig.model = binding.model
      }
      // If model not found on provider, skip override — let seed's model apply
    }
    const desiredEffort = binding.reasoningEffort
    if (desiredEffort !== undefined && desiredEffort !== null) {
      const provider = String(nextConfig.provider ?? binding.provider ?? '')
      const model = String(nextConfig.model ?? binding.model ?? '')
      const efforts = await supportedEfforts(provider, model)
      if (efforts !== null && efforts.has(String(desiredEffort))) {
        nextConfig.reasoningEffort = desiredEffort
      }
      // Unsupported or unknown → leave reasoningEffort unset (adapter default).
    }
    return nextConfig
  })

  // ── 生命周期清理：会话/代理销毁时回收编排状态，防止跨会话泄漏 ──────────
  ctx.on('agent/disposed', ({ agent }) => {
    const id = agent?.id
    if (!id) return
    const tracked = sessionTypes.delete(id)
    if (orchestration.currentMap.has(id)) {
      // 子代理被销毁但错过了 subagent/end：兜底清槽，否则队列永久冻结
      orchestration.clearHelpFor(id)
      orchestration.abort(id)
      bump()
      advanceQueue()
    } else if (tracked) {
      bump()
    }
  })

  ctx.on('session/disposed', (session) => {
    const id = session?.id
    if (!id) return
    if (id === lastOrchestratorSessionId) {
      // Sisyphus 主会话被删除：丢弃其排队任务，避免悬挂到永远不会来的父会话
      lastOrchestratorSessionId = null
      orchestration.dropQueuedFor(id)
      bump()
    }
  })

  // ── conclusion injection + queue advancement on subagent/end ────────────
  ctx.on('subagent/end', (info) => {
    const childId = info?.id
    let type = sessionTypes.get(childId)
    if (type === undefined) {
      // 竞态兜底：快速失败的子会话可能在 startContinuable resolve 之前就触发
      // subagent/end（此时 sessionTypes 尚未登记）。单线阻塞下至多存在一条
      // spawning 记录，可安全归因到它，否则会永久卡在 spawning/running 冻结队列。
      const spawning = [...orchestration.currentMap.values()].find((r) => r.status === 'spawning')
      if (!spawning) return
      type = spawning.agentType
      orchestration.bindChild(spawning.childId, childId)
      console.warn('[dsh-my-go] subagent/end arrived before spawn resolved; attributed to spawning record', childId)
    }
    const blocks = info?.lastAssistantMessage ?? []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    const failed = info?.stopReason !== 'completed'
    orchestration.finish(childId, text || `(${String(info?.stopReason)})`, failed)
    sessionTypes.delete(childId)
    bump()
    // Advance queue.
    advanceQueue()
  })

  return () => {
    // connection.rpc handlers are owned by the ctx.inject(['connection'])
    // fiber and auto-dispose; nothing manual to clean up here.
  }
}
