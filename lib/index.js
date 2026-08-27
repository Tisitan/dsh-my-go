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

// 'agents' 入 inject：队列推进需按 parentId 重解析父会话对象；
// 'sessions' 入 inject：失败附因推送需读子会话事件档兜底（subagent/end
// 的通知层载荷丢失 error.message）。显式声明依赖保证服务在本 scope 可用
// （与 preset 半 broker.mjs 一致）。
export const inject = ['tools', 'subagents', 'systemPrompt', 'llm', 'settings', 'agents', 'sessions']

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

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

/** Default bindings: intentionally EMPTY for every agent type — the fork
 * ships no hardcoded provider/model, so sub-agents fully inherit the
 * environment's default route (Sisyphus's provider/model). Per-type
 * bindings are user configuration: set them in the WebUI settings page or
 * via plugin config `bindings` (see README「工种模型绑定」).
 * reasoningEffort is only ever applied when the exact model supports that
 * level (checked against the DSH model catalog at request time). */
function defaultBindings() {
  return {
    sisyphus: {},
    hermes: {},
    explore: {},
    librarian: {},
    looker: {},
    hephaestus: {},
    prometheus: {},
    oracle: {},
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
    case 'oracle': return 'architecture debugging (last resort): cross-module analysis, deep bugs, complex review'
  }
}

// ── 失败附因：持久化档案读取（tisitan.9，与 broker.mjs 同构）───────────────
// 根因：continuable Activation 的销毁顺序（dsh-subagent/lib/types/continuation.js
// ~L1016-1050）是先 dispose 子 session（连带从 sessions live store 摘除）、删
// activation，最后 observer.settle() 才发射 subagent/end——end 处理器读 live
// store 必然落空，附因永远丢失（tisitan.8 实锤：failed 记录只有 '(error)'）。
// 主路径改读持久化档案，live 读法保留为快路径。
// 档案目录规则与 dsh-session-persistence-jsonl 完全一致（行号以 npm 检出
// @deepseek-ai/dsh 为准）：
//   root     = <DSH_HOME>/sessions（home 解析：dsh-home-paths/lib/index.js:73，
//              DSH_HOME 缺省 join(homedir(), '.dsh')）
//   项目目录 = root/<projectKey(cwd)>           （lib/index.js:106-124, 133-136）
//   会话目录 = 项目目录/<encodeSegment(childId)>（lib/index.js:84-96, 145-147）
//   日志文件 = 会话目录/session.jsonl.zstd      （lib/index.js:156-158）
const ZSTD_FRAME_MAGIC = 0xfd2fb528

// projectKey：与 dsh-session-persistence-jsonl/lib/index.js:106-124 同算法。
// 分隔符与盘符冒号折叠成单个 '-'，不安全码位转义 ~XXXX，'--...--' 包裹并截断
// 251 码元（故意有损，人类可导航优先）。
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

// encodeSegment：与同文件 :84-96 同算法，把 session id 编码成单安全路径段
// （UUID 恒为恒等映射；'.'/'..' 与不安全码位转义防目录穿越）。
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

// scanZstdFrameRanges：与同文件 scanZstdFrames(:503-566) 同算法（裁掉 torn
// 修复分支）。session.jsonl.zstd 是多 zstd 帧追加容器，Node 的 zlib 单帧接口
// 只吃首帧，必须先扫描出完整帧界再逐帧解压；末帧不完整（追加写到一半）时截断，
// 只读已完整的帧。
function scanZstdFrameRanges(buffer) {
  const ranges = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break // 截断的末帧头
    if (buffer.readUInt32LE(offset) !== ZSTD_FRAME_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerBytes) break
    offset += headerBytes
    let complete = true
    for (;;) {
      if (buffer.length - offset < 3) { complete = false; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) { complete = false; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!complete) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    ranges.push({ start, end: offset })
  }
  return ranges
}

// readArchivedTurnFailure：持久化档案主路径。倒序逐帧解压（最新帧最先），帧内
// 倒序扫行，取最后一条 turn/end 且 reason.kind==='error' 的 reason.error
// {message, code}。找不到档案/解压失败/无 error 事件均静默退回 undefined 并
// console.warn 留痕（可观测性，不静默吞）。options.root / options.cwd 供测试
// 注入；缺省按 DSH_HOME 惯例与 process.cwd() 解析。
export function readArchivedTurnFailure(childId, options = {}) {
  const root = options.root ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
  const cwd = options.cwd ?? process.cwd()
  const logFile = join(root, projectKey(cwd), encodeSegment(childId), 'session.jsonl.zstd')
  let buffer
  try {
    buffer = readFileSync(logFile)
  } catch (error) {
    console.warn(`[dsh-my-go] readTurnFailure: 持久化档案不可读 ${logFile}（${String(error?.code ?? error)}），静默退回无附因`)
    return undefined
  }
  let ranges
  try {
    ranges = scanZstdFrameRanges(buffer)
  } catch (error) {
    console.warn(`[dsh-my-go] readTurnFailure: 档案帧扫描失败 ${logFile}（${String(error)}），静默退回无附因`)
    return undefined
  }
  for (let i = ranges.length - 1; i >= 0; i--) {
    let text
    try {
      text = zstdDecompressSync(buffer.subarray(ranges[i].start, ranges[i].end)).toString('utf-8')
    } catch (error) {
      console.warn(`[dsh-my-go] readTurnFailure: 档案第 ${i} 帧解压失败 ${logFile}（${String(error)}），静默退回无附因`)
      return undefined
    }
    const lines = text.split('\n')
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j]
      if (!line || !line.includes('"turn/end"')) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue /* 截断的末行：跳过 */ }
      if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'error') {
        const failure = ev.data.reason.error
        if (failure && typeof failure.message === 'string') return failure
      }
    }
  }
  console.warn(`[dsh-my-go] readTurnFailure: 档案 ${logFile} 内无 turn/end error 事件，静默退回无附因`)
  return undefined
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
    if (!record) {
      // 占位记录被误删/误改键时真实 childId 会游离于编排状态外——必须留痕，
      // 否则该子代理的结束事件将走归随兜底，引发历史工种串号
      console.warn(`[dsh-my-go] bindChild failed: placeholder ${String(placeholderId)} not found, child ${String(childId)} is now untracked`)
      return undefined
    }
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

  /** Give up on a queued work item after retry exhaustion: remove it from the
   * queue and record a failed history entry — never strand it silently. */
  dropQueuedFailed(work, error) {
    this.queue = this.queue.filter((w) => w.id !== work.id)
    const done = {
      childId: work.id,
      agentType: work.agentType,
      prompt: work.prompt,
      status: 'failed',
      conclusion: `queued dispatch abandoned after ${work.retries ?? 0} attempts: ${String(error)}`,
      conclusionId: nextId('conclusion'),
      createdAt: work.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    this.history = [...this.history, done]
    if (this.history.length > 200) this.history = this.history.slice(-200)
    this.emit()
    return done
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
  // 多会话编排隔离（与 broker.mjs 同构）：每个 Sisyphus 编排会话一条独立
  // 流水线，standing-scope 单例会让会话2的 go_work 被会话1的在跑子代理
  // 排队阻塞。Map 惰性创建，键为编排会话 id。
  const orchestrations = new Map()
  // 子代理属主路由表：childId → 属主编排会话 id。bindChild（含 subagent/end
  // 的 spawning 竞态归因路径）登记，finish/abort/disposed 清除；continue
  // revive 已完工子代理时重新登记。生命周期参考 disposedTypes。
  const childOwner = new Map()
  const sessionTypes = new Map()
  // 墓碑表：agent/disposed 可能先于 subagent/end 到达。代理销毁时不直接丢弃
  // 类型登记，而是移入墓碑（有界 FIFO），保证迟到的 end 事件仍能拿到正确
  // 工种，不会误入「归随到唯一 spawning 记录」的兜底而串号；end 消费后清除。
  const disposedTypes = new Map()
  const DISPOSED_TYPES_CAP = 50
  function tombstoneType(id) {
    const type = sessionTypes.get(id)
    if (type === undefined) return false
    sessionTypes.delete(id)
    disposedTypes.set(id, type)
    if (disposedTypes.size > DISPOSED_TYPES_CAP) {
      disposedTypes.delete(disposedTypes.keys().next().value)
    }
    return true
  }
  // DSH continuable 生命周期中 agent/disposed 恒先于 subagent/end（dispose
  // 内部 handle.dispose() 先于 observer.settle()，见 dsh-subagent finishDisposal）。
  // 因此活记录遭遇 disposed 时不能立即清槽——end 通常紧随而至，立即 abort 会让
  // 合法结论无处落账（tisitan.6 部署实测：正常完工的 explore 不进历史）。改为
  // 立墓碑 + 宽限期兜底：宽限期内 end 到达则正常 finish；end 真缺席才 abort
  // 清槽推进队列，防止队列永久冻结。
  const DISPOSE_END_GRACE_MS = config.disposeEndGraceMs ?? 500
  // 可观测性截断阈值（tisitan.8，与 broker.mjs 同构）：默认值即旧硬编码
  // 口径的放宽版，均可经插件 config 覆盖。failed 记录的结论不被
  // STATUS_CONCLUSION_MAX 截断——错误信息必须完整到达 Sisyphus。
  const STATUS_HISTORY_LIMIT = config.statusHistoryLimit ?? 12
  const STATUS_CONCLUSION_MAX = config.statusConclusionMax ?? 400
  const HELP_CONTENT_MAX = config.helpContentMax ?? 240
  const SUBAGENT_PROMPT_MAX = config.subagentPromptMax ?? 200
  const disposeFallbackTimers = new Map()
  function cancelDisposeFallback(id) {
    const entry = disposeFallbackTimers.get(id)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      disposeFallbackTimers.delete(id)
    }
  }
  function scheduleDisposeFallback(id, orch) {
    if (disposeFallbackTimers.has(id)) return
    const timer = setTimeout(() => {
      disposeFallbackTimers.delete(id)
      if (!orch.currentMap.has(id)) return
      console.warn(`[dsh-my-go] subagent/end never arrived for disposed child ${String(id)} within ${DISPOSE_END_GRACE_MS}ms; aborting record to unblock the queue`)
      orch.clearHelpFor(id)
      orch.abort(id)
      childOwner.delete(id)
      bump()
      advanceQueue(orch)
    }, DISPOSE_END_GRACE_MS)
    timer.unref?.()
    disposeFallbackTimers.set(id, { timer, orch })
  }
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
  // 多会话聚合形状（与 broker.mjs 同构）：{ seq, parents: {
  // [parentSessionId]: { parentSessionId, current, queue, helpRequests,
  // history } } }。任一实例变化都整树重聚合。
  const bump = () => {
    snapshotSeq += 1
    const parents = {}
    for (const [pid, orch] of orchestrations) {
      parents[pid] = { parentSessionId: pid, ...orch.snapshot() }
    }
    latestSnapshot = { seq: snapshotSeq, parents }
  }
  // 惰性获取/创建某编排会话的流水线实例；每个实例的 onChange 同时驱动
  // 快照 bump 与台账防抖落盘。
  function orchFor(parentId) {
    let orch = orchestrations.get(parentId)
    if (!orch) {
      orch = new Orchestration()
      orch.onChange(() => bump())
      orch.onChange(() => scheduleLedgerSave())
      orchestrations.set(parentId, orch)
    }
    return orch
  }
  // 子代理 → 属主流水线：childOwner 优先；未登记（如 disposed 已清除、台账
  // 复活的边缘情况）时全局扫描所有实例的活记录与历史兜底。
  function orchOfChild(childId) {
    const ownerId = childOwner.get(childId)
    if (ownerId !== undefined) {
      const orch = orchestrations.get(ownerId)
      if (orch) return { orch, parentId: ownerId }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch.record(childId)) return { orch, parentId: pid }
    }
    return undefined
  }
  // continue/forward 的 record 查找：先查调用方实例，找不到再全局扫描所有
  // 实例（兼容台账复活与跨会话边缘情况）。
  function findRecordEverywhere(childId, preferred, preferredPid) {
    if (preferred) {
      const rec = preferred.record(childId)
      if (rec) return { orch: preferred, parentId: preferredPid, record: rec }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch === preferred) continue
      const rec = orch.record(childId)
      if (rec) return { orch, parentId: pid, record: rec }
    }
    return undefined
  }
  function findHelpEverywhere(helpId, preferred) {
    if (preferred) {
      const help = preferred.help(helpId)
      if (help) return { orch: preferred, help }
    }
    for (const [pid, orch] of orchestrations) {
      if (orch === preferred) continue
      const help = orch.help(helpId)
      if (help) return { orch, parentId: pid, help }
    }
    return undefined
  }

  // ── 编排台账持久化（tisitan.8，与 broker.mjs 同构） ────────────────────
  // history 记录（done/failed，上限与内存 cap 200 对齐）落盘为 JSON，
  // 插件加载时读回：进程重启后 continue 一个已完工 childId 仍能命中台账
  // （revive → harness coldResume 续聊），而不是报 unknown sub-agent id。
  // 存放位置沿用 ensurePresetInstalled 的 DSH_HOME 惯例，独立插件状态目录，
  // 不进 preset 同步目录（避免被版本同步覆盖语义污染）。
  const ledgerPath = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-my-go', 'orchestration-ledger.json')
  const isLedgerRow = (r) => r && typeof r.childId === 'string' && typeof r.agentType === 'string'
  async function loadLedger() {
    try {
      const raw = JSON.parse(await readFile(ledgerPath, 'utf-8'))
      if (raw && raw.version === 2 && raw.parents && typeof raw.parents === 'object') {
        // v2：按编排会话分桶的台账，逐 parentId 恢复到各流水线实例
        for (const [pid, list] of Object.entries(raw.parents)) {
          if (!Array.isArray(list)) continue
          orchFor(pid).history = list.filter(isLedgerRow).slice(-200)
        }
      } else {
        // 向后兼容 v1（单份 history 数组）：载入 key 为 'legacy' 的实例，
        // continue/forward 的全局扫描兜底仍可命中这些跨重启记录。
        const list = Array.isArray(raw) ? raw : raw?.history
        if (!Array.isArray(list)) return
        orchFor('legacy').history = list.filter(isLedgerRow).slice(-200)
      }
      bump()
    } catch { /* 无档/坏档：空台账起步，不阻断插件加载 */ }
  }
  // 任何台账变化都经 onChange 调度一次防抖落盘（合并同窗口内的连续突变），
  // 写盘走 Promise 链串行化，绝不在热路径同步阻塞。
  let ledgerSaveTimer = null
  let ledgerSaveChain = Promise.resolve()
  function scheduleLedgerSave() {
    if (ledgerSaveTimer) return
    ledgerSaveTimer = setTimeout(() => {
      ledgerSaveTimer = null
      const parents = {}
      for (const [pid, orch] of orchestrations) {
        if (orch.history.length > 0) parents[pid] = orch.history.slice(-200)
      }
      const payload = JSON.stringify({ version: 2, parents })
      ledgerSaveChain = ledgerSaveChain.then(async () => {
        try {
          await mkdir(dirname(ledgerPath), { recursive: true })
          await writeFile(ledgerPath, payload, 'utf-8')
        } catch (error) {
          console.warn(`[dsh-my-go] orchestration ledger save failed: ${String(error)}`)
        }
      })
    }, 250)
    ledgerSaveTimer.unref?.()
  }
  await loadLedger()
  bump() // 保证快照首读即拿到完整 { seq, parents } 形状

  // ── 父会话补充通知（tisitan.8，与 broker.mjs 同构） ────────────────────
  // harness 的双通知（reported/settled）是 dsh-subagent 硬编码模板，插件无法
  // 抑制或改写；但可经 harness 公开 API（parent.inject，见 dsh-subagent
  // notifySettlement 的用法）向父会话注入自己的一行短通知。选用非唤醒的
  // inject：两条通知都伴随既有的唤醒事件，不额外打断父会话。注入失败静默
  // 兜底，绝不阻塞派发。
  function notifyParent(parent, text) {
    try {
      if (!parent || typeof parent.inject !== 'function') return
      parent.inject({
        id: `mygo-notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-my-go',
          form: 'notice',
          summary: text.length <= 120 ? text : `${text.slice(0, 119)}…`,
        },
      })
    } catch { /* 父会话已销毁/注入被拒：静默兜底 */ }
  }
  function resolveParentAgent(parentId) {
    const agents = ctx.get('agents')
    return parentId ? agents?.get?.(parentId) : undefined
  }
  // 失败附因兜底：subagent/end 的通知层载荷只有 stopReason 的 kind，
  // error.message 完整存在于子会话档案的 turn/end reason.error。
  // tisitan.9：continuable 销毁顺序使 subagent/end 发射晚于 live store 摘除，
  // live 读法（sessions 服务 API）降级为快路径；主路径读持久化档案
  // （readArchivedTurnFailure，多帧 zstd 逐帧解压）。哪边先拿到用哪边。
  function readTurnFailure(childId) {
    try {
      const session = ctx.get('sessions')?.get?.(childId)
      const events = session?.events
      if (Array.isArray(events)) {
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'error') {
            const failure = ev.data.reason.error
            if (failure && typeof failure.message === 'string') return failure
          }
        }
      }
    } catch { /* live 快路径失败不挡档案主路径 */ }
    return readArchivedTurnFailure(childId)
  }

  ctx.inject(['connection'], (webContext) => {
    if (webContext.connection === undefined) return
    const rpc = webContext.connection.rpc
    if (!rpc || typeof rpc.handle !== 'function') return

    // Single channel with endpoint dispatch (same pattern as dsh-mnemon):
    // channel = "/dsh-my-go", endpoints = "snapshot" | "listModels"
    rpc.handle('/dsh-my-go', async (endpoint, payload) => {
      if (endpoint === 'snapshot') {
        // 优先读 agent 平面 broker 发布的真实编排快照（Symbol.for 全局桥）；
        // 桥不存在时回落到本实例自己的聚合状态机（preset 未装配的部署形态）。
        // 两侧形状必须一致：{ seq, parents: { [parentSessionId]: {...} } }。
        const shared = globalThis[Symbol.for('dsh-my-go.snapshot')]
        const value = typeof shared === 'function' ? shared() : latestSnapshot
        return { ok: true, value: value ?? { seq: 0, parents: {} } }
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
  //
  // 回补之后没有任何事件源会再触发推进（tisitan.6 实战确认的队列停摆），
  // 因此回补时挂一个带线性退避的重试定时器；超过上限则放弃该任务——
  // 从队列移除并写 failed 历史 + console.error，绝不静默滞留。
  const QUEUE_RETRY_MAX = 3
  const QUEUE_RETRY_BASE_MS = config.queueRetryBaseMs ?? 1000
  // 每条流水线各自的重试定时器（键为 Orchestration 实例），互不挤占
  const queueRetryTimers = new Map()

  function scheduleQueueRetry(orch, work, parentHint, error) {
    work.retries = (work.retries ?? 0) + 1
    if (work.retries > QUEUE_RETRY_MAX) {
      orch.dropQueuedFailed(work, error)
      console.error(`[dsh-my-go] queued task ${work.id} (${work.agentType}) abandoned after ${QUEUE_RETRY_MAX} failed dispatch attempts:`, error)
      bump()
      // 继续消化后续排队任务
      advanceQueue(orch, parentHint)
      return
    }
    const prev = queueRetryTimers.get(orch)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      queueRetryTimers.delete(orch)
      advanceQueue(orch, parentHint)
    }, QUEUE_RETRY_BASE_MS * work.retries)
    // 重试定时器不应阻止进程退出
    timer.unref?.()
    queueRetryTimers.set(orch, timer)
  }

  function advanceQueue(orch, parentHint) {
    if (!orch || orch.isBusy()) return
    const work = orch.dequeue()
    if (!work) return
    const agents = ctx.get('agents')
    // 父会话兜底：按 work.parentId 从 agents 注册表重解析（队列推进没有
    // 调用方 agent 对象可留存）；解析不到则由 dispatchWork 抛错走回补重试
    const parentAgent = (work.parentId && agents ? agents.get(work.parentId) : undefined) ?? parentHint
    void dispatchWork(work.agentType, work.prompt, parentAgent, undefined, work, orch).catch((error) => {
      orch.requeueHead(work)
      bump()
      console.error('[dsh-my-go] queued dispatch failed, task requeued:', error)
      scheduleQueueRetry(orch, work, parentAgent, error)
    })
  }

  async function dispatchWork(agentType, prompt, parent, signal, queuedWork, orchHint) {
    if (!AGENT_TYPES.includes(agentType)) throw new Error(`unknown agent type: ${String(agentType)}`)
    const binding = bindings[agentType] ?? {}
    // 队列路径的父会话兜底已上移到 advanceQueue（按 work.parentId 从
    // agents 注册表重解析）；此处 parent 缺失即抛错，由调用方回补重试。
    // (Do NOT use agents.roots()[0] — that leaks queued work into other sessions.)
    if (!parent) throw new Error('go_work requires a live parent agent to delegate from')
    const orch = orchHint ?? orchFor(parent.id)
    // startContinuable 无条件调用 spec.signal.throwIfAborted()（dsh-subagent
    // SubagentContinuationManager.startContinuable）：直发路径 exec.signal 恒在，
    // 队列路径（advanceQueue）没有调用方信号可传——必须合成一个永不中止的信号，
    // 否则队列派发必败 TypeError（tisitan.6 部署实测：重试 4 次全败后放弃）。
    const sig = signal ?? new AbortController().signal
    if (orch.isBusy()) {
      const workId = orch.enqueue(agentType, prompt, parent?.id)
      bump()
      return { childId: workId, status: 'queued', label: agentLabel(agentType, prompt.slice(0, SUBAGENT_PROMPT_MAX)), queued: true }
    }
    const placeholder = orch.beginSpawning(agentType, prompt)
    try {
      const request = {
        label: agentLabel(agentType, prompt.slice(0, SUBAGENT_PROMPT_MAX)),
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(binding.provider !== undefined || binding.model !== undefined
          ? { agentOptions: { ...(binding.provider !== undefined ? { provider: binding.provider } : {}), ...(binding.model !== undefined ? { model: binding.model } : {}) } }
          : {}),
        signal: sig,
      }
      const { childId } = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: request.label,
        request,
        signal: sig,
      })
      sessionTypes.set(childId, agentType)
      orch.bindChild(placeholder.childId, childId)
      childOwner.set(childId, parent.id)
      bump()
      // 队列任务上岗映射推送：占位 work-* 与真身 childId 的对应关系低频高价值
      // （Sisyphus 手里的 go_work 返回值只有占位 id），注入一行短通知补齐。
      if (queuedWork) {
        notifyParent(parent, `[dsh-my-go] 队列任务上岗: ${queuedWork.id} → ${childId} (${agentType})`)
      }
      return { childId, status: 'running', label: request.label, queued: false }
    } catch (error) {
      orch.abort(placeholder.childId)
      bump()
      // 槽位已腾出：立即推进队首，避免后续排队任务永久等待
      advanceQueue(orch, parent)
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
      'Blocking is scoped to YOUR orchestration session: other sessions run their own independent pipelines and never queue behind yours (and vice versa).',
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
      const callerOrch = orchFor(parent.id)
      // record 查找：先查调用方流水线，找不到再全局扫描所有实例（兼容
      // v1 台账复活的 'legacy' 实例与跨会话边缘情况）
      const found = findRecordEverywhere(args.id, callerOrch, parent.id)
      if (!found) {
        for (const orch of [callerOrch, ...orchestrations.values()]) {
          const queued = orch.snapshot().queue.find((w) => w.id === args.id)
          if (queued) {
            throw new Error(`task ${String(args.id)} (${queued.agentType}) is still queued — wait for dispatch, then use its real childId (see orchestration_status)`)
          }
        }
        throw new Error(`unknown sub-agent id: ${String(args.id)} — 该 id 不在编排台账；若进程重启过且台账持久化未覆盖该记录（或已被 200 条上限挤出），请用 go_work 重新派发`)
      }
      const { orch, parentId: ownerPid, record } = found
      const isFinished = !orch.currentMap.has(record.childId)
      if (isFinished && orch.isBusy()) {
        throw new Error('another sub-agent is currently running; wait for it to finish before reviving a completed sub-agent (single-line blocking)')
      }
      // 先投递，成功后再落账：投递失败不会留下假 running、也不会弄丢求助单
      const messageId = await ctx.subagents.followup(parent, record.childId, [{ type: 'text', text: args.prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      if (record.status === 'waiting') {
        for (const help of orch.snapshot().helpRequests) {
          if (help.childId === record.childId) orch.resolveHelp(help.id)
        }
        orch.resume(record.childId)
      } else if (isFinished) {
        // 驳回/追问一个已结束的子智能体：重新入册并恢复类型登记，
        // 否则它游离在单线阻塞之外，且再次结束时结论会被静默丢弃
        orch.revive(record.childId)
        sessionTypes.set(record.childId, record.agentType)
        // 复活后重新登记属主，保证再次 subagent/end 时路由回本实例
        if (ownerPid !== undefined) childOwner.set(record.childId, ownerPid)
      }
      orch.followupPrompt(record.childId, args.prompt)
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
      // 子代理侧工具：经 childOwner 路由回属主编排会话的流水线；
      // 未登记时全局扫描活记录兜底（disposed 已清除登记等边缘情况）
      const owned = orchOfChild(child.id)
      const suspended = owned?.orch.suspend(child.id, help)
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
      const callerOrch = orchFor(parent.id)
      const foundHelp = findHelpEverywhere(args.from, callerOrch)
      if (!foundHelp) throw new Error(`unknown help request id: ${String(args.from)}`)
      const { orch: helpOrch, help } = foundHelp
      const prompt = help.content
      const target = String(args.target)
      if (AGENT_TYPES.includes(target)) {
        // Dispatch a new sub-agent of that type.
        const result = await dispatchWork(target, prompt, parent, exec?.signal)
        helpOrch.resolveHelp(help.id) // 投递成功后才销账，失败则求助单保留
        bump()
        return { kind: 'go_work', targetId: String(result?.childId ?? ''), resolved: true }
      }
      const found = findRecordEverywhere(target, callerOrch, parent.id)
      if (!found) throw new Error(`unknown sub-agent id: ${target} — 该 id 不在编排台账；若进程重启过且台账持久化未覆盖该记录（或已被 200 条上限挤出），请用 go_work 重新派发`)
      const { orch, parentId: ownerPid, record } = found
      const isFinished = !orch.currentMap.has(target)
      if (isFinished && orch.isBusy()) {
        throw new Error('another sub-agent is currently running; wait for it to finish before forwarding to a completed sub-agent (single-line blocking)')
      }
      const messageId = await ctx.subagents.followup(parent, target, [{ type: 'text', text: prompt }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id },
        signal: exec?.signal,
      })
      orch.followupPrompt(target, prompt)
      if (record.status === 'waiting') {
        orch.resume(target)
      } else if (isFinished) {
        orch.revive(target)
        sessionTypes.set(target, record.agentType)
        // 复活后重新登记属主，保证再次 subagent/end 时路由回本实例
        if (ownerPid !== undefined) childOwner.set(target, ownerPid)
      }
      helpOrch.resolveHelp(help.id)
      bump()
      return { kind: 'continue', targetId: messageId, resolved: true }
    },
  })

  // 只读状态工具的路由：Sisyphus 会话读自己的流水线；子代理经
  // childOwner/record 扫描读属主流水线；无调用方上下文（测试/RPC 场景）
  // 且全网只有一个实例时读它；多实例又无调用方时拒绝猜测，报 idle。
  function orchForStatus(exec) {
    const id = exec?.agent?.id
    if (typeof id === 'string') {
      const direct = orchestrations.get(id)
      if (direct) return direct
      const owned = orchOfChild(id)
      if (owned) return owned.orch
      return orchFor(id) // 新编排会话首次读状态：惰性建空流水线
    }
    if (orchestrations.size === 1) return [...orchestrations.values()][0]
    return undefined
  }

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
    async execute(_args, exec) {
      const orch = orchForStatus(exec)
      if (!orch) return { text: '○ idle' }
      const s = orch.snapshot()
      const lines = []
      if (s.current) {
        lines.push(`● running: ${s.current.agentType} (${s.current.childId}) — ${s.current.status}`)
      } else {
        lines.push('○ idle')
      }
      if (s.queue.length > 0) lines.push(`⏳ queue: ${s.queue.map((w) => `${w.agentType}#${w.id}`).join(', ')}`)
      for (const help of s.helpRequests) lines.push(`❓ help ${help.id}: [${help.intent}] ${help.content.slice(0, HELP_CONTENT_MAX)}`)
      for (const r of s.history.slice(-STATUS_HISTORY_LIMIT)) {
        const flat = (r.conclusion ?? '').replace(/\s+/g, ' ')
        // failed 记录的结论不被截断：错误信息必须完整可见
        const summary = r.status === 'failed' ? flat : flat.slice(0, STATUS_CONCLUSION_MAX)
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
    async execute(_args, exec) {
      const orch = orchForStatus(exec)
      if (!orch) return { text: '# 当前 sub-agents\n（还没有任何 sub-agent）' }
      const s = orch.snapshot()
      const lines = ['# 当前 sub-agents']
      const all = [...(s.current ? [s.current] : []), ...s.history.slice(-50)]
      const seen = new Set()
      for (const r of all) {
        if (seen.has(r.childId)) continue
        seen.add(r.childId)
        const prompt = (r.prompt ?? '').replace(/\s+/g, ' ').slice(0, SUBAGENT_PROMPT_MAX)
        lines.push(`- ${r.agentType} (${r.childId}) [${r.status}] 最后 prompt: ${prompt}`)
      }
      if (s.queue.length > 0) {
        lines.push('# 队列（等待中）')
        for (const w of s.queue) lines.push(`- ${w.agentType} (${w.id}) 排队中 prompt: ${w.prompt.replace(/\s+/g, ' ').slice(0, SUBAGENT_PROMPT_MAX)}`)
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
    let resolved = false
    try {
      if (llm && typeof llm.resolveModelInfo === 'function') {
        const info = await llm.resolveModelInfo(provider, model)
        resolved = true
        const efforts = info?.reasoning?.efforts
        if (Array.isArray(efforts) && efforts.length > 0) {
          result = new Set(efforts.map((e) => String(e?.id)))
        }
      }
    } catch {
      // Capability lookup must never break the request; unknown → leave unset.
    }
    // 只缓存查询成功的结果：瞬时失败/服务缺席不永久缓存（负缓存会让
    // effort 绑定在本进程生命周期内静默失效），留待下次请求重试
    if (resolved) effortCache.set(key, result)
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

  // 注意：此处刻意【不】挂 agent/created 钩子。lib 是 global 层插件，该事件
  // 会收到 profile 内【所有】会话（含非 MyGO 会话）——skill 隐藏与拓扑闸只应
  // 作用于 MyGO preset 会话，由 preset 作用域的 broker.mjs 负责（standing scope
  // 的 listener 只接收 join 它的 agent 的事件）。在此全局挂钩会误伤其他 preset。

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
    // 经 childOwner 路由到属主实例；未登记时全局扫描活记录兜底
    const owned = orchOfChild(id)
    childOwner.delete(id)
    if (owned && owned.orch.currentMap.has(id)) {
      // 正常完工路径上 disposed 恒先于 subagent/end 到达：只立墓碑并挂
      // 宽限期兜底，活记录留给紧随的 end 正常落账；end 缺席才由兜底清槽。
      tombstoneType(id)
      scheduleDisposeFallback(id, owned.orch)
    } else if (tombstoneType(id)) {
      bump()
    }
  })

  ctx.on('session/disposed', (session) => {
    const id = session?.id
    if (!id) return
    const orch = orchestrations.get(id)
    if (!orch) return
    // Sisyphus 编排会话被删除：整条流水线随之销毁（队列/当前槽位/求助单
    // 全清，实例摘出 Map），并清除其子代理的属主登记与兜底定时器，
    // 避免悬挂到永远不会来的父会话
    for (const cid of orch.currentMap.keys()) {
      childOwner.delete(cid)
      cancelDisposeFallback(cid)
    }
    for (const help of orch.helpRequests.values()) childOwner.delete(help.childId)
    orch.queue = []
    orch.currentMap.clear()
    orch.helpRequests.clear()
    orchestrations.delete(id)
    const retryTimer = queueRetryTimers.get(orch)
    if (retryTimer) {
      clearTimeout(retryTimer)
      queueRetryTimers.delete(orch)
    }
    bump()
    scheduleLedgerSave()
  })

  // ── conclusion injection + queue advancement on subagent/end ────────────
  ctx.on('subagent/end', (info) => {
    const childId = info?.id
    if (!childId) return
    // end 到达即取消 disposed 宽限期兜底——正常完工路径上兜底定时器必然在挂着
    cancelDisposeFallback(childId)
    // 类型取证顺序：活登记 → 墓碑（disposed 先于 end 的竞态）→ 编排台账。
    // 绝不盲目归随到当前 spawning 记录——那会把别人的结束事件错绑到
    // 正在派发的工种上，造成历史记录系统性串号（tisitan.6 实战确认）。
    // 属主路由：childOwner 直达 → 全实例 record 扫描兜底（竞态/复活边缘）
    const routed = orchOfChild(childId)
    let orch = routed?.orch
    let ownerPid = routed?.parentId
    let type = sessionTypes.get(childId) ?? disposedTypes.get(childId)
    if (type === undefined) {
      const existing = orch?.record(childId)
      if (existing) {
        // 台账有归属：以台账为准
        type = existing.agentType
        if (!orch.currentMap.has(childId)) {
          // 已完工子代理的迟到/重复 end：忽略并留痕，不重复落账
          console.warn(`[dsh-my-go] late/duplicate subagent/end for finished child ${String(childId)} (${type}); ignored`)
          advanceQueue(orch)
          return
        }
      } else {
        // 竞态兜底（最后手段）：快速失败的子会话可能在 startContinuable
        // resolve 之前就触发 subagent/end（此时 sessionTypes 尚未登记）。
        // 逐实例找 spawning 记录：恰有一个可归因时才安全绑定（多会话并行
        // 派发可能出现多个 spawning，无法安全归因时留痕忽略，绝不乱绑）。
        let hit
        for (const [pid, o] of orchestrations) {
          const spawning = [...o.currentMap.values()].find((r) => r.status === 'spawning')
          if (spawning) {
            if (hit) { hit = 'ambiguous'; break }
            hit = { pid, orch: o, spawning }
          }
        }
        if (!hit || hit === 'ambiguous') {
          // 无从归属的 end：留痕；已知属主则照常推进其队列，绝不静默吞掉
          console.warn(`[dsh-my-go] subagent/end for untracked child ${String(childId)}, no record to attribute; ignored`)
          if (orch) advanceQueue(orch)
          return
        }
        orch = hit.orch
        ownerPid = hit.pid
        type = hit.spawning.agentType
        hit.orch.bindChild(hit.spawning.childId, childId)
        childOwner.set(childId, hit.pid)
        console.warn('[dsh-my-go] subagent/end arrived before spawn resolved; attributed to spawning record', childId)
      }
    }
    if (!orch) {
      // 类型有登记但实例已销毁（编排会话先走一步）：结论无处安放，留痕
      console.warn(`[dsh-my-go] subagent/end for child ${String(childId)} (${type}) has no owning orchestration; conclusion dropped`)
      sessionTypes.delete(childId)
      disposedTypes.delete(childId)
      return
    }
    const blocks = info?.lastAssistantMessage ?? []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    const failed = info?.stopReason !== 'completed'
    // 失败附因兜底：subagent/end 载荷无 error 字段，读子会话最后一条
    // turn/end 的 reason.error（live 快路径 + 持久化档案主路径，tisitan.9）；
    // 读档失败静默退回无附因（console.warn 留痕，不报错）。
    const failure = failed ? readTurnFailure(childId) : undefined
    let conclusion = text || `(${String(info?.stopReason)})`
    if (failure) {
      conclusion += `\n失败原因: ${failure.message} [${failure.code ?? 'UNKNOWN'}]`
    }
    const done = orch.finish(childId, conclusion, failed)
    if (failed && failure) {
      // 失败附因推送：harness 的 settled 通知只带 stopReason，补一行完整原因
      notifyParent(resolveParentAgent(ownerPid), `[dsh-my-go] 子代理失败: ${childId} (${type}): ${failure.message} [${failure.code ?? 'UNKNOWN'}]`)
    }
    if (!done) {
      // 有类型登记但台账无活记录（如已被 disposed 兜底清槽）：结论无处安放，留痕
      console.warn(`[dsh-my-go] subagent/end for child ${String(childId)} (${type}) has no live record; conclusion dropped`)
    }
    sessionTypes.delete(childId)
    disposedTypes.delete(childId)
    childOwner.delete(childId)
    bump()
    // Advance queue.
    advanceQueue(orch)
  })

  return () => {
    // connection.rpc handlers are owned by the ctx.inject(['connection'])
    // fiber and auto-dispose; manual cleanup covers the queue retry timers,
    // the disposed-grace fallback timers and the ledger debounce timer.
    for (const timer of queueRetryTimers.values()) clearTimeout(timer)
    queueRetryTimers.clear()
    if (ledgerSaveTimer) clearTimeout(ledgerSaveTimer)
    for (const entry of disposeFallbackTimers.values()) clearTimeout(entry.timer)
    disposeFallbackTimers.clear()
  }
}
