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

export const name = 'dsh-my-go-broker'

export const inject = ['tools', 'subagents', 'systemPrompt', 'llm', 'settings']

import { access, cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const AGENT_TYPES = ['hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']

/**
 * Install the bundled agent preset into the user preset root once, so the
 * "MyGO!!!!! 模式" preset appears in the session picker after `dsh plugin
 * add dsh-my-go`. DSH discovers presets only from configured roots
 * (~/.dsh/.agent-presets/), never from node_modules, so the npm bundle must
 * copy its preset/ directory there. Idempotent: skips when already present.
 * Failures are logged and swallowed — the host plugin must keep working even
 * when the preset copy is not possible.
 */
async function ensurePresetInstalled() {
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // .../dsh-my-go/lib
    const packageRoot = dirname(here) // .../dsh-my-go
    const source = join(packageRoot, 'preset')
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const userPresetRoot = join(dshHome, '.agent-presets')
    const target = join(userPresetRoot, 'dsh-my-go')
    try {
      await access(target)
      return // already installed
    } catch {
      // not present — install below
    }
    await access(source)
    await mkdir(userPresetRoot, { recursive: true })
    await cp(source, target, { recursive: true })
    console.log(`[dsh-my-go] installed agent preset to ${target} — restart dsh web if the picker is already open`)
  } catch (error) {
    console.error(`[dsh-my-go] could not install agent preset: ${String(error)}`)
  }
}

const AGENT_TYPE_PREFIX = 'dsh-my-go:'

function agentLabel(type, summary) {
  return `${AGENT_TYPE_PREFIX}${type}${summary ? `: ${summary}` : ''}`
}

function parseAgentType(label) {
  if (typeof label !== 'string') return undefined
  const match = /^dsh-my-go:([a-z-]+)/.exec(label)
  if (!match) return undefined
  return AGENT_TYPES.includes(match[1]) ? match[1] : undefined
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
    this.history = [...this.history, done]
    if (this.history.length > 200) this.history = this.history.slice(-200)
    this.emit()
    return done
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
  let bindings = { ...defaultBindings(), ...(config.bindings ?? {}) }
  const bindSisyphus = config.bindSisyphus === true

  // Track the Sisyphus root session id: the first agent that calls a broker
  // tool is treated as the root. Children cannot delegate (guards below).
  let rootSessionId = null
  const isSisyphus = (agent) => {
    if (!agent || typeof agent.id !== 'string') return false
    if (rootSessionId === null) rootSessionId = agent.id
    return agent.id === rootSessionId
  }
  // ── settings-backed bindings (WebUI configurable) ───────────────────────
  // NOTE: the settings namespace 'dsh-my-go' is registered by the host bundle
  // (lib/index.js). We only READ from it here — do NOT call settings.register()
  // again or it throws "already registered".
  const settings = ctx.get('settings')
  if (settings !== undefined) {
    try {
      const stored = settings.get('dsh-my-go')
      if (stored && typeof stored === 'object') {
        const merged = { ...bindings }
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
          const merged = { ...bindings }
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
    } catch (e) {
      console.error('[dsh-my-go] settings load error:', e)
    }
  }

  // ── snapshot state (used by connection.rpc handlers in lib/index.js) ──────
  let latestSnapshot = null
  let snapshotSeq = 0
  const bump = () => {
    snapshotSeq += 1
    latestSnapshot = { seq: snapshotSeq, ...orchestration.snapshot() }
  }
  orchestration.onChange(() => bump())

  // ── per-agent persona + orchestration sections ───────────────────────────
  // The broker registers sections that differ by agent type:
  // - Sisyphus (root): full persona + orchestration instructions
  // - Sub-agents: minimal persona only (no orchestration rules)
  const SISYPHUS_PERSONA = `You are Sisyphus, the master orchestrator and quality gate of the dsh-my-go agent system. You run on the {{model}} model in {{cwd}}. You receive the user's request, dispatch it to the right sub-agent, review every response, and reject low-quality results for rework. You never do the sub-agent's work yourself when a sub-agent fits.`
  const SUBAGENT_PERSONA = `You are a specialist sub-agent in the dsh-my-go system. You execute one focused task and report results to Sisyphus. You do not delegate further.`
  const ORCHESTRATION_TEXT = `# Sisyphus 编排规则

你是 Sisyphus：总调度 + 质检官。子智能体不直接通信，全部经由你中转。

## 何时调用 Prometheus（重要）
**不要对每个任务都先调 Prometheus。** Prometheus 只在以下情况需要：
1. **需求模糊**：用户描述含混，有多种理解方式，需要调研、提问、细化后才能执行。
2. **任务庞大且复杂**：涉及多个模块、多步骤、需要先摸清现状再规划的大型任务。
3. **涉及不确定的依赖或技术选型**：需要先调研可行性再决定方案。

**以下情况直接派工种，跳过 Prometheus：**
1. **需求明确无歧义**：任务目标清晰、步骤可直接推断。
2. **单步可完成的轻活**：一个工种就能搞定的小任务。
3. **用户明确指定了工种和做法**。

简单判断标准：如果用户的话已经足够明确到你能直接写出子智能体的 prompt，就不要调 Prometheus。

## 工种清单（你可调用的子智能体）
- \`prometheus\` — 需求规划。调研、提问、细化需求，把模糊需求拆成**可执行步骤序列**。
- \`explore\` — 快速检索。grep、读文件、定位符号、扫描目录结构。
- \`librarian\` — 文档查询。读 README、API 参考、历史文档、注释提取。
- \`looker\` — 多模态识别。UI 截图、设计稿、PDF 图表。
- \`hermes\` — 快速执行。批量替换、代码格式化、统一 imports、纯文本搬运。
- \`hephaestus\` — 代码编写。单文件重构、模块实现、单元测试、常规代码生成。
- \`oracle\` — 架构调试 + 终验。跨模块依赖分析、深层 Bug 定位、代码审查、最终验收。

## 步骤级调度
当 Prometheus 交来计划（或你自己拆解了多步任务）时，**逐步骤决策**：
1. 看这一步的类型与难度（检索？实现？重构？验收？）。
2. 选择最省 token 的工种：轻活派轻工种，重活派重工种。
3. **沿用或换人**：下一步如果和上一步同一工种且上下文连续，\`continue\` 同一个 childId；如果换了工种，才 \`go_work\` 新派。
4. 每步结论回来后先质检再决定下一步，不要一次把所有步骤都发出去。

## 质检规则
收到子智能体结论后，你有权驳回或追问：
- 质量不达标 → \`continue\` 同一个 childId，附驳回理由和修正方向。
- 需要另一工种 → 先驳回/结束当前，再 \`go_work\` 派发合适的类型。
- 结论合格 → 向用户汇报，或按计划进入下一步。

## 禁止事项
1. 不要让子智能体直接调用其他子智能体（它们没有 go_work/continue/forward）。
2. 子智能体不得主动发起对话，只能被动响应你的分发。
3. 收到 intent=replan 时，必须切换智能体类型，而不是原地升级模型。
4. Prometheus 只做规划不执行；它的计划必须由你按步骤重新调度。`

  // Register persona section (visible to all preset agents — filtered below)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'deployment:persona',
    order: 0,
    text: SISYPHUS_PERSONA,
  }), 'dsh-my-go-broker.persona()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'dsh-my-go:orchestration',
    order: 20,
    text: ORCHESTRATION_TEXT,
  }), 'dsh-my-go-broker.orchestration()')

  // Filter sections per-agent via the system-prompt/assemble waterfall.
  // Sub-agents get a minimal persona and no orchestration rules.
  ctx.effect(() => ctx.systemPrompt?.waterfall?.(
    { section: 'system-prompt/assemble' },
    'dsh-my-go-broker.assemble-filter',
    (assembly) => {
      const agentId = assembly?.scope ?? assembly?.context?.agent?.id
      const isSubAgent = agentId && sessionTypes.has(agentId)
      if (!isSubAgent) return assembly // Sisyphus: keep all sections
      // Sub-agent: replace persona, remove orchestration
      const filtered = {
        ...assembly,
        sections: assembly.sections
          .filter((s) => s.name !== 'dsh-my-go:orchestration')
          .map((s) => s.name === 'deployment:persona'
            ? { ...s, text: SUBAGENT_PERSONA }
            : s
          ),
      }
      return filtered
    },
  ), 'dsh-my-go-broker.assemble-filter()')

  // ── internal go_work implementation (shared by the tool, forward, queue) ─
  async function dispatchWork(agentType, prompt, parent, signal) {
    if (!AGENT_TYPES.includes(agentType)) throw new Error(`unknown agent type: ${String(agentType)}`)
    const binding = bindings[agentType] ?? {}
    // Parent may be absent during queue advancement (agent object not retained);
    // fall back to the live Sisyphus root session so delegation still works.
    if (!parent) {
      const agents = ctx.get('agents')
      const root = agents?.roots?.()?.find((agent) => agent && typeof agent.id === 'string')
      if (root) parent = root
    }
    if (!parent) throw new Error('go_work requires a live parent agent to delegate from')
    if (orchestration.isBusy()) {
      const workId = orchestration.enqueue(agentType, prompt, parent?.id)
      bump()
      return { childId: workId, status: 'queued', label: agentLabel(agentType, prompt.slice(0, 60)), queued: true }
    }
    const placeholder = orchestration.beginSpawning(agentType, prompt)
    try {
      // Resolve provider: use binding's explicit provider, or inherit from parent agent options
      const parentProvider = parent?.options?.provider
      const resolvedProvider = binding.provider ?? parentProvider
      // Build agentOptions: always pass provider so sub-agent doesn't fall back to DSH default
      const agentOpts = {}
      if (resolvedProvider) agentOpts.provider = resolvedProvider
      // Only set model if it exists on the resolved provider
      if (binding.model !== undefined && resolvedProvider) {
        if (await modelExists(resolvedProvider, binding.model)) {
          agentOpts.model = binding.model
        }
      } else if (binding.model !== undefined && !resolvedProvider) {
        // No provider available — set model anyway, agent/request handler will validate
        agentOpts.model = binding.model
      }
      const request = {
        label: agentLabel(agentType, prompt.slice(0, 60)),
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(Object.keys(agentOpts).length > 0 ? { agentOptions: agentOpts } : {}),
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
      if (!isSisyphus(parent)) throw new Error('go_work is reserved for Sisyphus (the root session)')
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
      if (!isSisyphus(parent)) throw new Error('continue is reserved for Sisyphus (the root session)')
      const record = orchestration.record(args.id)
      if (!record) throw new Error(`unknown sub-agent id: ${String(args.id)}`)
      if (record.status === 'waiting') {
        for (const help of orchestration.snapshot().helpRequests) {
          if (help.childId === record.childId) orchestration.resolveHelp(help.id)
        }
        orchestration.resume(record.childId)
      }
      const messageId = await ctx.subagents.followup(parent, record.childId, [{ type: 'text', text: args.prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      orchestration.followupPrompt(record.childId, args.prompt)
      bump()
      return { accepted: true, messageId }
    },
  })

  ctx.tools.register({
    name: 'need_help',
    description: [
      'Request assistance from Sisyphus. Use when you need another sub-agent\'s capability (explore/read_doc/look_image) or the task is beyond your ability (replan).',
      'Calling this suspends you: Sisyphus will review the request and either forward it or continue you with a new prompt.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['explore', 'read_doc', 'look_image', 'replan'],
          description: 'explore: need Explore to read files/search code. read_doc: need Librarian for docs. look_image: need Multimodal Looker for an image. replan: task exceeds your ability, request reassignment.',
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
      if (!isSisyphus(parent)) throw new Error('forward is reserved for Sisyphus (the root session)')
      const help = orchestration.help(args.from)
      if (!help) throw new Error(`unknown help request id: ${String(args.from)}`)
      const prompt = help.content
      const target = String(args.target)
      orchestration.resolveHelp(help.id)
      if (AGENT_TYPES.includes(target)) {
        // Dispatch a new sub-agent of that type.
        const result = await dispatchWork(target, prompt, parent, exec?.signal)
        bump()
        return { kind: 'go_work', targetId: String(result?.childId ?? ''), resolved: true }
      }
      const messageId = await ctx.subagents.followup(parent, target, [{ type: 'text', text: prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      orchestration.followupPrompt(target, prompt)
      orchestration.resume(target)
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

  // ── model validation ─────────────────────────────────────────────────
  const modelCache = new Map()
  async function modelExists(provider, model) {
    const key = String(provider)
    let set = modelCache.get(key)
    if (set === undefined) {
      set = new Set()
      try {
        const llm = ctx.get('llm')
        if (llm) {
          const list = await llm.listModels(key)
          for (const m of list) set.add(m.id)
        }
      } catch { /* provider may not support listing */ }
      modelCache.set(key, set)
    }
    return set.has(String(model))
  }

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
      const exists = resolvedProvider ? await modelExists(resolvedProvider, binding.model) : false
      console.log(`[dsh-my-go] agent/request model validation: provider=${resolvedProvider} model=${binding.model} exists=${exists}`)
      if (exists) {
        nextConfig.model = binding.model
      }
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

  // ── conclusion injection + queue advancement on subagent/end ────────────
  ctx.on('subagent/end', (info) => {
    const childId = info?.id
    const type = sessionTypes.get(childId)
    if (type === undefined) return
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
    if (orchestration.snapshot().queue.length > 0 && !orchestration.isBusy()) {
      const work = orchestration.dequeue()
      if (work) {
        // Resolve the recorded parent agent (the Sisyphus session) and
        // dispatch the next queued work through the same internal path.
        const agents = ctx.get('agents')
        const parentAgent = work.parentId && agents ? agents.get(work.parentId) : undefined
        void dispatchWork(work.agentType, work.prompt, parentAgent, undefined).catch(() => undefined)
      }
    }
  })
}
