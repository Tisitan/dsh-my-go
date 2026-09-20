/**
 * dsh-my-go — persona 装配 / prompt 加载 / DSV4P0813 bootstrap 簇（5.3 波自
 * broker.mjs 抽出）。
 *
 * 三件事一族：① prompts/*.md 的读盘与人设缓存（promptCache / loadPrompt，
 * 0.3.0-tisitan.7 N11 纪律：缓存壳随挂载建立、失败不写缓存）；② system-prompt
 * 的人设/编排/名册三段组装（宿主代双分支注册，0.1.5 上游拆 prefix/suffix 的
 * 探测分界）；③ DSV4P0813 两段式 bootstrap（phase-1 只给 persona 段 +
 * 7 具 bootstrap 工具，首响/首工具调用后晋升全量）。
 *
 * 拆分总原则的「簇模块零 ctx」在本簇的自洽解法（派工单第 2 条指定的口径）：
 * 碰 ctx 的动作（systemPrompt.section 注册 / ctx.effect 生命周期 / ctx.on 事件
 * 监听 / getSectionOrder 宿主代探针）全部以回调注入，由 broker.mjs 侧包一层，
 * 本簇只做纯组装与注册编排——注册时机、effect 名、段定义逐字节与原实现一致。
 * 实读确认无「与 ctx 深度缠绕到无法纯化」的函数，本簇整体迁出，零留守。
 *
 * 依赖注入面：
 *   - effect / registerSection / getSectionOrder / on：broker 侧的 ctx 包壳
 *     （getSectionOrder 保留可选链语义：更老宿主无该方法时判假走旧名分支）；
 *   - sessionTypes：登记表活句柄（roster 段儿童门控 + assemble 的工种解析）；
 *   - getBindings：绑定表逐调用现读（settings/updated 整表重建后必须看到新值，
 *     与原闭包直读 `let bindings` 的时点一致）。
 * 纯函数层（loadAllPrompts / typeOfAgent / renderRosterBriefing）直引 ../shared/。
 * 接线位点注（5.4 声明重排）：本簇接线点前移至调度簇之前（promptCache/loadPrompt
 * 是调度簇 rolePersona 的注入源），promptCache 缓存壳与 sharedLoadAllPrompts 的
 * fire-and-forget 预热随工厂调用建立——位移不改注册序，预热不 await 不阻塞挂载。
 *
 * 卸载口径：本簇无定时器/登记表类状态（promptCache 与挂载实例同寿，晋升表是
 * WeakMap），无 clear* 需要导出；段注册的生命周期由注入的 effect 壳持有，
 * 卸载即随 broker 侧 effect scope 回收。
 *
 * 形态：createBootstrapOps({ effect, registerSection, getSectionOrder, on,
 * sessionTypes, getBindings }) → { promptCache, loadPrompt }。
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typeOfAgent, loadAllPrompts as sharedLoadAllPrompts } from '../shared/misc.mjs'
import { renderRosterBriefing as sharedRenderRosterBriefing } from '../shared/roles.mjs'

// ── prompt file loading ───────────────────────────────────────────────────
// Prompt files live in the prompts/ directory alongside the preset.
// They are copied to ~/.dsh/.agent-presets/dsh-my-go/prompts/ by
// ensurePresetInstalled (lib/index.js).
// 读盘与缓存分离（0.3.0-tisitan.7 N11）：本函数只回答「读得到就给文本、读不到给
// null」，缓存策略见工厂体内的 promptCache/loadPrompt。
// import.meta.url 解析点从 broker.mjs 换到本模块：两者同在 preset/tools/，
// dirname(import.meta.url) 两级上跳落点逐字节一致（prompts/ 与 tools/ 平级）。
async function readPromptFile(agentType) {
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // .../dsh-my-go/tools
    const presetRoot = dirname(here) // .../dsh-my-go
    const promptsDir = join(presetRoot, 'prompts')
    return await readFile(join(promptsDir, `${agentType}.md`), 'utf-8')
  } catch {
    return null // 档案缺席 / 安装拷贝竞态：由调用方决定是否记账
  }
}

export function createBootstrapOps({
  effect,
  registerSection,
  getSectionOrder,
  on,
  sessionTypes,
  getBindings,
}) {
  // 人设缓存随挂载建立（0.3.0-tisitan.7 N11）：原本它是模块级的，失败还写 null——
  // 首次加载撞上 ensurePresetInstalled 的后台拷贝竞态（prompts/ 尚未落全）时，
  // 那条 null 就把本进程所有挂载的人设一起永久钉死，儿童带着「无 persona」
  // 上岗且无从自愈。两条改动同点落地：① 缓存壳从模块作用域移进挂载作用域（一次
  // 挂载一份，重挂载即重新现读）；② 失败不写缓存（下次现读重试，与
  // effortCache / modelCache 的「只缓存成功结果」同一纪律）。
  const promptCache = new Map()
  async function loadPrompt(agentType) {
    if (promptCache.has(agentType)) return promptCache.get(agentType)
    const content = await readPromptFile(agentType)
    if (content !== null) promptCache.set(agentType, content)
    return content
  }

  // Load all prompt files from the prompts/ directory at startup
  void sharedLoadAllPrompts(promptCache, loadPrompt)

  // ── per-agent persona + orchestration sections ───────────────────────────
  // Sub-agents inherit the preset's scope, so they DO see these sections.
  // We use text functions with parentSession detection (no race condition)
  // to differentiate Sisyphus from sub-agents.
  //
  // For sub-agents:
  //   - deployment:persona: empty (sub-agent persona is injected via context)
  //   - dsh-my-go:orchestration: empty (sub-agents don't orchestrate)
  //   - systemPrompt.context: injects the sub-agent's role description
  //
  // For orchestrator sessions:
  //   - deployment:persona: loaded from prompts/sisyphus.md
  //   - dsh-my-go:orchestration: loaded from prompts/sisyphus.md (same file
  //     contains both persona and orchestration rules)
  //   - systemPrompt.context: empty

  // Fallback if file hasn't loaded yet
  const SISYPHUS_PERSONA_FALLBACK = 'You are Sisyphus, the master orchestrator.'
  const ORCHESTRATION_FALLBACK = ''

  const isSubAgentContext = (context) => {
    return context?.agent?.session?.header?.parentSession != null
  }

  // Use loaded sisyphus.md for persona section
  // 段体只有一份，宿主代差异全在注册面（见下方双代分支）。
  const personaSectionText = (context) => {
    if (isSubAgentContext(context)) return ''
    const file = promptCache.get('sisyphus')
    // sisyphus.md contains both persona and orchestration;
    // extract just the persona (everything before ## 编排规则)
    if (file) {
      const cutPoint = file.indexOf('## 编排规则')
      return cutPoint > 0 ? file.slice(0, cutPoint).trim() : file.trim()
    }
    return SISYPHUS_PERSONA_FALLBACK
  }

  // 宿主代探测：0.1.5 上游把内建 persona 段拆成 deployment:persona-prefix
  // (order 0) + deployment:persona-suffix (order 10200) 两段。getSectionOrder
  // 两版都只是 SECTION_ORDERS 查表（未知键返回 undefined，不抛），故探针天然
  // 分界：新宿主认 DEPLOYMENT_PERSONA_PREFIX，旧宿主（含无此方法的更老形态）判假。
  // **两代名字绝不并注**：旧宿主上 'deployment:persona-prefix' 是自由名，注册它
  // 等于在真 persona 段之外多塞一份人设。
  const PERSONA_PREFIX_ORDER = getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')
  if (PERSONA_PREFIX_ORDER !== undefined) {
    effect(() => registerSection({
      name: 'deployment:persona-prefix',
      order: PERSONA_PREFIX_ORDER,
      text: personaSectionText,
    }), 'dsh-my-go-broker.persona()')
    // 遮蔽新宿主多出来的 suffix 槽位：本插件不追加后缀，但必须占住这个名字，
    // 否则部署方的 personaSuffix 会原样泄进每一个子代上下文。
    effect(() => registerSection({
      name: 'deployment:persona-suffix',
      order: getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
      text: '',
    }), 'dsh-my-go-broker.personaSuffix()')
  } else {
    effect(() => registerSection({
      name: 'deployment:persona',
      order: 0,
      text: personaSectionText,
    }), 'dsh-my-go-broker.persona()')
  }

  // Orchestration section: loaded from prompts/sisyphus.md (after persona)
  effect(() => registerSection({
    name: 'dsh-my-go:orchestration',
    order: 20,
    text: (context) => {
      if (isSubAgentContext(context)) return ''
      const file = promptCache.get('sisyphus')
      if (file) {
        const cutPoint = file.indexOf('## 编排规则')
        return cutPoint > 0 ? file.slice(cutPoint).trim() : ORCHESTRATION_FALLBACK
      }
      return ORCHESTRATION_FALLBACK
    },
  }), 'dsh-my-go-broker.orchestration()')

  // 名册简报段（0.2.3-tisitan.18）：向根编排会话现渲活名册 + 失败通知协议指路
  // （harness 原生 failed 通知先于 broker 异步处置到达，真空期内主流程需
  // 知道备选链存在才不会自行报死）。函数态 text 每次 assemble 现调——
  // bindings 由 settings/updated 整表重建，经 getBindings 逐调用现读最新值，
  // 天然免刷新管道。
  // 儿童门控：子代理（parentSession 直达 + typeOfAgent 冷恢复 label 兜底）
  // 返回空串，不消费子代理上下文预算。字节稳定：渲染器（shared 单一源）
  // 键排序、无时间戳/无随机。
  effect(() => registerSection({
    name: 'dsh-my-go:roster',
    order: 10,
    text: (context) => {
      if (isSubAgentContext(context) || typeOfAgent(sessionTypes, context?.agent) !== undefined) return ''
      return sharedRenderRosterBriefing(getBindings())
    },
  }), 'dsh-my-go-broker.roster()')

  // ── DSV4P0813 bootstrap (liangshen pattern) ──────────────────────────────
  // When dsv4p0813 is enabled for an agent type, the first request uses
  // minimal prompt + minimal tools. After the model responds (anchor
  // detected), expand to full tools and prompt.
  //
  // Phase 1: only persona section + bootstrap tools (bash/pwsh/read/write/edit)
  // Phase 2: full sections + full tools + orchestration rules
  //
  // Detection: session/event listener reacts to the tool/call and turn/end
  // events themselves (append-then-notify makes any array scan of the
  // *current* step blind — see the listener below).
  // Promotion: after first tool call or first response (per policy).

  const PROMOTED_BY_SESSION = new WeakMap()
  // 并集非替换：新宿主上我方注册的是 prefix/suffix 两个新名，但旧名仍可能来自
  // 更老形态的装配输入（以及旧宿主兼容分支注册的 'deployment:persona'）；
  // phase-1 白名单漏掉任何一代的真名段，开了开关的工种第一轮就是零人设。
  const PERSONA_SECTION_NAMES = new Set(['deployment:persona', 'persona', 'deployment:persona-prefix', 'deployment:persona-suffix'])

  function promotionStateFor(session) {
    let state = PROMOTED_BY_SESSION.get(session)
    if (state === undefined) {
      state = { promoted: false, toolCalled: false, responded: false }
      PROMOTED_BY_SESSION.set(session, state)
    }
    return state
  }

  // Listen to the session event firehose to detect promotion triggers.
  // 判据是**当前事件自身的类型**，不是事件数组（0.3.0-tisitan.7 N7）：宿主 append
  // 先 push 再派发（@deepseek-ai/dsh-session/lib/index.js:1433-1435），处理器
  // 收到 step/end 时末位恒为该 step/end 自己——旧实现「从末位倒扫到上一个
  // step/end 找 tool/call」当场 break，toolCalled 永假（tool/call 在 agent-loop
  // 里先于 step/end 落账：dsh-agent-loop/lib/index.js:295 vs :563）。phase-1 是
  // 「只给 persona + 7 具 bootstrap 工具、零运行期上下文」的重压形态，这支
  // 死掉就意味着开了开关的工种整个第一轮都在戴着镣铐跑。
  // 直判同时消掉一次全量事件快照重建（sessionEvents → alpha.4 的
  // snapshotEvents() 每次 append 后都要重算缓存）。
  on('session/event', (_session, event) => {
    if (event.type !== 'tool/call' && event.type !== 'turn/end') return
    const state = promotionStateFor(_session)
    if (state.promoted) return
    if (event.type === 'tool/call') {
      state.toolCalled = true
    } else {
      state.responded = true
    }
    // Promote after first tool call or first response
    if (state.toolCalled || state.responded) {
      state.promoted = true
    }
  })

  // Filter tools/sections during phase 1 via system-prompt/assemble
  on('system-prompt/assemble', (_assembly, _context, next) => {
    return next().then((assembled) => {
      const agent = _context?.agent
      if (agent === undefined) return assembled
      // Check if dsv4p0813 is enabled for this agent type
      // (0.2.3-tisitan.15: sessionTypes-first lookup, persisted label as fallback)
      const agentType = typeOfAgent(sessionTypes, agent)
      if (!agentType) return assembled
      const binding = getBindings()[agentType]
      if (!binding?.dsv4p0813) return assembled

      const state = promotionStateFor(agent.session)
      if (state.promoted) return assembled

      // Phase 1: filter to persona section only + bootstrap tools
      const BOOTSTRAP_TOOLS = new Set(['bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep'])
      return {
        ...assembled,
        sections: Array.isArray(assembled.sections)
          ? assembled.sections.filter(s => PERSONA_SECTION_NAMES.has(s?.name))
          : assembled.sections,
        tools: Array.isArray(assembled.tools)
          ? assembled.tools.filter(t => BOOTSTRAP_TOOLS.has(t?.name))
          : assembled.tools,
        contexts: [],  // no runtime context during phase 1
      }
    })
  })

  return { promptCache, loadPrompt }
}
