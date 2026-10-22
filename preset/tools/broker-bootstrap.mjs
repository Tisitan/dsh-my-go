/**
 * dsh-my-go — persona 装配 / prompt 加载簇。
 *
 * 两件事一族：① prompts/*.md 的读盘与人设缓存（promptCache / loadPrompt，
 * 纪律：缓存壳随挂载建立、失败不写缓存）；② system-prompt
 * 的人设/编排/名册三段组装（宿主代双分支注册，0.1.5 上游拆 prefix/suffix 的
 * 探测分界）。
 *
 * 拆分总原则的「簇模块零 ctx」在本簇的自洽解法（派工单第 2 条指定的口径）：
 * 碰 ctx 的动作（systemPrompt.section 注册 / ctx.effect 生命周期 / ctx.on 事件
 * 监听 / getSectionOrder 宿主代探针）全部以回调注入，由 broker.mjs 侧包一层，
 * 本簇只做纯组装与注册编排——注册时机、effect 名、段定义在本簇单点定义；簇内
 * 没有与 ctx 深度缠绕到无法纯化的函数，故零 ctx、零留守。
 *
 * 依赖注入面：
 *   - effect / registerSection / getSectionOrder / on：broker 侧的 ctx 包壳
 *     （getSectionOrder 保留可选链语义：更老宿主无该方法时判假走旧名分支）；
 *   - sessionTypes：登记表活句柄（roster 段儿童门控）；
 *   - getBindings：绑定表逐调用现读（宿主配置桥段变化后必须看到新值，
 *     与原闭包直读 `let bindings` 的时点一致）。
 * 纯函数层（loadAllPrompts / typeOfAgent / renderRosterBriefing）直引 ../shared/。
 * 接线位点注：本簇接线点前移至调度簇之前（promptCache/loadPrompt
 * 是调度簇 rolePersona 的注入源），promptCache 缓存壳与 sharedLoadAllPrompts 的
 * 预热随工厂调用建立；broker 等待 ready 后再注册工具，避免首请求竞态。
 *
 * 卸载口径：本簇无定时器/登记表类状态（promptCache 与挂载实例同寿），无 clear*
 * 需要导出；段注册的生命周期由注入的 effect 壳持有，卸载即随 broker 侧 effect
 * scope 回收。
 *
 * 形态：createBootstrapOps({ effect, registerSection, getSectionOrder, on,
 * sessionTypes, getBindings }) → { promptCache, loadPrompt, ready }。
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typeOfAgent, loadAllPrompts as sharedLoadAllPrompts } from '../shared/misc.mjs'
import { renderRosterBriefing as sharedRenderRosterBriefing } from '../shared/roles.mjs'

// ── prompt file loading ───────────────────────────────────────────────────
// Prompt files live in the installed package's prompts/ directory (two levels up
// from preset/tools/, i.e. <pkg>/prompts). 0.1.7 retired the preset-directory
// copy (ensurePresetInstalled), so the package layout is the only layout.
// 读盘与缓存分离：本函数只回答「读得到就给文本、读不到给
// null」，缓存策略见工厂体内的 promptCache/loadPrompt。
// 解析点：dirname(import.meta.url) = <pkg>/preset/tools，两级上跳 = <pkg>，
// prompts/ 与 preset/ 平级。
async function readPromptFile(agentType) {
  try {
    const here = dirname(fileURLToPath(import.meta.url)) // <pkg>/preset/tools
    const packageRoot = dirname(dirname(here)) // <pkg>
    return await readFile(join(packageRoot, 'prompts', `${agentType}.md`), 'utf-8')
  } catch {
    return null // 档案缺席：由调用方决定是否记账
  }
}

export function createBootstrapOps({
  effect,
  registerSection,
  getSectionOrder,
  sessionTypes,
  getBindings,
}) {
  // 人设缓存随挂载建立：模块级缓存跨挂载实例存活，一次读盘失败写进去的 null 会把
  // 本进程所有挂载的人设一起永久钉死（儿童带着「无 persona」上岗且无从自愈）。
  // 两条纪律：① 缓存壳在挂载作用域（一次挂载一份，重挂载即重新现读）；② 失败不写
  // 缓存（下次现读重试，与 effortCache / modelCache 的「只缓存成功结果」同一纪律）。
  const promptCache = new Map()
  async function loadPrompt(agentType) {
    if (promptCache.has(agentType)) return promptCache.get(agentType)
    const content = await readPromptFile(agentType)
    if (content !== null) promptCache.set(agentType, content)
    return content
  }

  // 联网搜索纪律段的人设档键：prompts/search-discipline.md 是一份
  // **公共纪律段**，不是工种人设——键名刻意与内置工种键空间同形（走同一个
  // readPromptFile/缓存），但绝不进 AGENT_TYPES，否则 typeOfAgent / 名册 /
  // 面板工种解析会凭空多出一个不存在的工种。
  const SEARCH_DISCIPLINE_PROMPT_KEY = 'search-discipline'

  // 纪律段的最小兜底串：档案读不到时给这三句，而不是空串。
  // 空串等于让子代理在「手里有 web_search/curl、脑里无任何联网纪律」的静默
  // 状态下上岗；兜底串至少把三条硬纪律说清。console.warn 走 once 标志位防刷屏
  // （段体是函数态，每次 assemble 现调，档案真缺席时会调很多次）。
  const SEARCH_DISCIPLINE_FALLBACK = '## 联网搜索纪律\n搜索前先把关键词想具体；采信搜索结果前用 curl 抓正文核实（curl -sL --max-time 20 <url> | head -c 30000）；报告中源自搜索的事实必须附 URL。\n'
  let searchDisciplineFallbackWarned = false

  // Load all prompt files from the prompts/ directory at startup
  const ready = sharedLoadAllPrompts(promptCache, loadPrompt)

  // 联网搜索纪律段的人设档预热：它**不是工种**，故刻意不进
  // AGENT_TYPES（那枚常量喂 typeOfAgent / 名册 / 面板工种解析，塞进去等于多出
  // 一个不存在的工种）——预热单独 fire-and-forget，工种预热则等待 ready，
  // 同守「失败不写缓存、下次现读重试」纪律。段体函数只读缓存（text 必须同步返
  // 回字符串），故读盘时机固定在挂载期，不在 assemble 路径上现读。
  void loadPrompt(SEARCH_DISCIPLINE_PROMPT_KEY)

  // ── per-agent persona + orchestration sections ───────────────────────────
  // Sub-agents inherit the preset's scope, so they DO see these sections.
  // We use text functions with parentSession detection (no race condition)
  // to differentiate Sisyphus from sub-agents.
  //
  // For sub-agents:
  //   - deployment persona section: role persona from the durable descriptor label
  //   - dsh-my-go:orchestration: empty (sub-agents don't orchestrate)
  //   - dsh-my-go:search-discipline: loaded from prompts/search-discipline.md
  //     (公共联网纪律，只对子代理发声)
  //   - systemPrompt.context: injects the sub-agent's role description
  //
  // For orchestrator sessions:
  //   - deployment:persona: loaded from prompts/sisyphus.md
  //   - dsh-my-go:orchestration: loaded from prompts/sisyphus.md (same file
  //     contains both persona and orchestration rules)
  //   - dsh-my-go:search-discipline: empty (Sisyphus 的搜索口径在 sisyphus.md)
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
    if (isSubAgentContext(context)) {
      const type = typeOfAgent(sessionTypes, context?.agent)
      if (!type) return ''
      const custom = getBindings()[type]?.persona
      return typeof custom === 'string' && custom.length > 0 ? custom
        : promptCache.get(type) ?? `You are a ${type} sub-agent in the dsh-my-go orchestration system.`
    }
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

  // 名册简报段：向根编排会话现渲活名册 + 失败通知协议指路
  // （harness 原生 failed 通知先于 broker 异步处置到达，真空期内主流程需
  // 知道备选链存在才不会自行报死）。函数态 text 每次 assemble 现调——
  // bindings 由宿主配置桥逐调用现读（段一变即新值），经 getBindings 转出，
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

  // 联网搜索纪律段：全体子代理可见的公共人设段，段体取自
  // prompts/search-discipline.md（挂载期预热进 promptCache，段体只读缓存——
  // 与 persona/orchestration 段同一读盘纪律：不现读、不炸；读不到时不给空串，
  // 给 SEARCH_DISCIPLINE_FALLBACK 最小兜底串 + 一次性告警，见常量处注释）。
  // 儿童门控与 roster 段**反向**：本段只对子代理发声，根编排会话（Sisyphus）
  // 返回空串——Sisyphus 的搜索口径在 sisyphus.md 里另有交代，此处不重复注入。
  // 门控只认 parentSession 直达（与 persona/orchestration 段同款），不加
  // typeOfAgent label 兜底：本段是子代公共段，冷恢复 label 兜底那套属 roster
  // 的「别把名册泄给儿童」场景，反向套用会把 Sisyphus 的冷恢复会话也判成儿童。
  // 与 sisyphus.md 的 `## 编排规则` 切分零交集：那段切分只读 promptCache 的
  // 'sisyphus' 键，本段读自己的键，互不可见。
  effect(() => registerSection({
    name: 'dsh-my-go:search-discipline',
    order: 30,
    text: (context) => {
      if (!isSubAgentContext(context)) return ''
      const cached = promptCache.get(SEARCH_DISCIPLINE_PROMPT_KEY)
      if (cached) return cached
      if (!searchDisciplineFallbackWarned) {
        searchDisciplineFallbackWarned = true
        console.warn('[dsh-my-go] search-discipline prompt missing, using fallback')
      }
      return SEARCH_DISCIPLINE_FALLBACK
    },
  }), 'dsh-my-go-broker.searchDiscipline()')

  return { promptCache, loadPrompt, ready }
}
