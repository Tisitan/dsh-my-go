/**
 * dsh-my-go — 邻接消息通道适配（alpha.2/3 ↔ alpha.4，两半共用）。
 *
 * 本模块是 fork 与上游「邻接消息面」的唯一耦合点：上游 0.1.2-alpha.4 把
 * SubagentRuntime.followup 并入 sendMessage、reportFrom 整个删除、
 * Session.events getter 删除（→ snapshotEvents(start?, end?)）。已核实
 * alpha.2/alpha.3 的 runtime 只有 followup/reportFrom（无 sendMessage），
 * alpha.4 只有 sendMessage（无 followup/reportFrom）——按方法存在性特性探测
 * 即干净分界：新 API 在就走新路，否则走旧路，升级顺序无关。
 *
 * 从 misc.mjs 独立出来（健康度批）的理由：misc 是台账/名册/展示字符串那一档
 * 纯函数，与本文件的「上游 API 形状」耦合毫无共同点；契约探测代码混在里面，
 * 上游再改一次签名时要改的文件数被人为放大。契约哨兵测试（compat-alpha4）
 * 与两半的全部调用点都只认这一个出处。
 *
 * 0.3.0-tisitan.12（N15）：投递路由收进 **planAdjacentDelivery 一张表**。此前
 * canQueueAdjacent（探测）与 deliverToAdjacent（投递）各抄一遍分支顺序，靠一句
 * 「判定顺序必须与投递一致」的注释维持同构——那是本文件最容易在改动里失守的耦合：
 * 漏改一侧不报错，只表现为「探测说能排队、投递实际走了 steer」的静默塌档。
 * 现在两个入口都从同一个 plan 取答案，同构由构造保证（回归用例见
 * compat-alpha4.test.mjs 的「N15 同构不变量」）。
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * runtime 对象（subagents/session/agent）一律由调用方注入。
 */

// sendMessage 的 options.signal 在 alpha.4 为运行期必填（throwIfAborted 直
// 解引用），旧 followup 接受 undefined——缺省给一枚永不中止的信号，两路同形。
const NEVER_ABORTED = new AbortController().signal

// 真 FIFO 排队投递（R4）：alpha.4 的 sendMessage 在 continuation manager 里
// 固定 delivery:'steer'（父→子只在 next-step 边界插话），排队档只剩 internal
// 子路径 queueHostSubagentPrompt —— 而它就是 runtime 上一枚 Symbol 键方法
// （Symbol.for('dsh.subagent.queuePrompt')，上游注释明确「进程稳定、捆绑入口
// 与 unbundled internal 子路径共享」）。preset 无法 import 该内部子路径：
// 安装目录 ~/.dsh/.agent-presets/dsh-my-go/ 上溯整链都没有 node_modules，
// 裸名 '@deepseek-ai/dsh-subagent/internal' 解析必炸（已实测 MODULE_NOT_FOUND），
// 故按同款注册符号直取，与上游适配器逐参数同形（position: parent, childId,
// content, source, signal）。
//
// 上游 0.1.3-alpha.1（commit 040d73871b）把这枚符号改名并加宽为 6 参：
// Symbol.for('dsh.subagent.deliverPrompt')，第 6 参 delivery，传字符串 'queue'
// 即得原 FIFO 语义。两版通吃是硬要求（旧宿主只有 queuePrompt、新宿主只有
// deliverPrompt，两者都会在本 fork 的存活期出现）：新符号在就走 6 参，不在则
// 回退旧符号 5 参，两者都不在才允许塌到 steer。
// 旧常量名 QUEUE_PROMPT 原样保留——它同时是 broker 侧既有语义的锚点。
const QUEUE_PROMPT = Symbol.for('dsh.subagent.queuePrompt')
const DELIVER_PROMPT = Symbol.for('dsh.subagent.deliverPrompt')

// 宿主排队投递的持久署名：V4（运行时 0.1.7-alpha.2）已删除共享 `plugin` kind，
// 改为生产者自持 kind —— 写成 `plugin:<插件名>`，`plugin` 字段一并丢弃。
// 该命名与 V3→V4 迁移链抬升历史日志时 producerKind() 的兜底约定一致（该函数
// 未导出，只能硬编码），保证新旧日志落到同一 kind；form 'relay'（「另一 Agent
// 发给它的消息」）在六值 ContextForm 内仍合法，与旧 relay 语义最贴。
const HOST_QUEUE_SOURCE = Object.freeze({ kind: 'plugin:dsh-my-go', form: 'relay' })

// 会话事件读取：alpha.4 起 Session.events getter 删除 → snapshotEvents()。
// 读取失败（日志已关/坏档）回落空数组，维持旧 getter 绝不抛错的行为口径。
export function sessionEvents(session) {
  if (!session || typeof session !== 'object') return []
  if (typeof session.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents()
      return Array.isArray(events) ? events : []
    } catch {
      return []
    }
  }
  return Array.isArray(session.events) ? session.events : []
}

// 排队原语的 arity 适配器（断裂①）：两代上游符号在此收敛成一个 invoke 形状，
// 新符号（deliverPrompt，6 参，末位 delivery='queue'）优先，旧符号
// （queuePrompt，5 参）回退，两者皆缺席返回 null。route 判定与投递动作仍只有
// planAdjacentDelivery 一张表——canQueueAdjacent 是其薄壳，双符号并查由构造保证。
function planQueueInvoker(subagents) {
  if (typeof subagents[DELIVER_PROMPT] === 'function') {
    return (fromAgent, targetId, content, signal) =>
      subagents[DELIVER_PROMPT](fromAgent, targetId, content, HOST_QUEUE_SOURCE, signal, 'queue')
  }
  if (typeof subagents[QUEUE_PROMPT] === 'function') {
    return (fromAgent, targetId, content, signal) =>
      subagents[QUEUE_PROMPT](fromAgent, targetId, content, HOST_QUEUE_SOURCE, signal)
  }
  return null
}

// 投递计划（N15，0.3.0-tisitan.12）：**路由判定与投递动作合一**。
// 旧写法是 canQueueAdjacent 与 deliverToAdjacent 各写一遍分支顺序，靠一句
// 「判定顺序必须与投递一致」的注释维持同构——上游再改一次 API 形状时要同时改对
// 两处，漏一处就是「探测说能排队、投递却走了 steer」这种静默塌档（外部完全看不出来，
// 因为两条路都返回 messageId）。现在两处都从本函数取同一个 plan，同构由构造保证。
//
// route 语义：
//   'queue'    真 FIFO 排队（上游 internal 符号队列：deliverPrompt 6 参优先，
//              queuePrompt 5 参回退，见 planQueueInvoker）
//   'steer'    next-step 边界插话（alpha.4 的 sendMessage，**不是排队**）
//   'legacy'   alpha.2/3 的 followup（原语本身即 FIFO；steer 档在旧门面没有对应
//              入口，同一条路——当前轮 drain 后可见，且只有这支消费 options.source）
//   'unavailable' 该 runtime 给不出任何邻接投递通路（invoke 为 null，调用方必须报错）
export function planAdjacentDelivery(subagents, delivery = 'queued') {
  if (typeof subagents?.sendMessage === 'function') {
    const queue = delivery === 'queued' ? planQueueInvoker(subagents) : null
    if (queue) {
      return {
        route: 'queue',
        invoke: (fromAgent, targetId, content, { signal } = {}) =>
          queue(fromAgent, targetId, content, signal ?? NEVER_ABORTED),
      }
    }
    return {
      route: 'steer',
      invoke: (fromAgent, targetId, content, { signal } = {}) =>
        subagents.sendMessage(fromAgent, targetId, content, { signal: signal ?? NEVER_ABORTED }),
    }
  }
  if (typeof subagents?.followup === 'function') {
    return {
      route: 'legacy',
      invoke: (fromAgent, targetId, content, { source, signal } = {}) =>
        subagents.followup(fromAgent, targetId, content, { source, signal }),
    }
  }
  return { route: 'unavailable', invoke: null }
}

// 本 runtime 是否具备「真排队」投递通路（queued 档能否成立）：plan 的薄壳——
// legacy 支（alpha.2/3 followup）天然 FIFO 也算可排队，'steer'/'unavailable' 不算。
export function canQueueAdjacent(subagents) {
  const { route } = planAdjacentDelivery(subagents, 'queued')
  return route === 'queue' || route === 'legacy'
}

// 父→子邻接投递（continue/forward 链路）：**路由判定全在 planAdjacentDelivery**，
// 本函数只做三件事——取 plan、无通路即抛错、把 fromAgent/targetId/content/options
// 交给那一支。调用方关心的两代 API 差异（alpha.4 的 sendMessage 由 sender 推导
// source、旧 followup 才吃 options.source；fromAgent 必须是精确 live Agent 对象，
// runtime 会校验 ctx.agents.get(sender.id) === sender）都写在各支的 invoke 里。
//
// options.delivery 声明投递档位（'queued' 默认 / 'steer'）：queued 优先走真 FIFO
// （alpha.4 符号队列 / alpha.2-3 followup 天然排队），排队通路缺席时该档就地落到
// sendMessage 的 steer 语义——**调用方必须如实回报退化**（先 canQueueAdjacent
// 探测，投递面本身不掺日志，保持纯函数）。
export async function deliverToAdjacent(subagents, fromAgent, targetId, content, options = {}) {
  const { delivery = 'queued', source, signal } = options
  const { invoke } = planAdjacentDelivery(subagents, delivery)
  if (!invoke) throw new Error('subagents runtime exposes neither sendMessage (alpha.4+) nor followup (alpha.2/3): cannot deliver adjacent message')
  return invoke(fromAgent, targetId, content, { source, signal })
}

// 子→父上报（need_help 链路）：alpha.2/3 走
// reportFrom(child, content, { delivery: 'next-step', signal })；alpha.4
// reportFrom 已删——优先 sendMessage(child, parentId, content, { signal })
// （child 必须是驻留 continuable 激活，sender 为精确 live Agent 对象），
// 投递被拒（非驻留/父不在线等）时经 options.injectFallback 兜底（parent.inject
// 通路 alpha.4 仍在，已验证）。injectFallback(error) 返回 true 表示兜底送达；
// 缺省或返回 false 时原错上抛，由调用方既有 catch 告警处置，绝不静默失败。
export async function reportToParent(subagents, child, parentId, content, options = {}) {
  if (typeof subagents?.reportFrom === 'function') {
    return subagents.reportFrom(child, content, { delivery: 'next-step', signal: options.signal })
  }
  if (typeof subagents?.sendMessage === 'function' && child && parentId != null) {
    try {
      return await subagents.sendMessage(child, parentId, content, { signal: options.signal ?? NEVER_ABORTED })
    } catch (error) {
      if (typeof options.injectFallback === 'function' && options.injectFallback(error)) return undefined
      throw error
    }
  }
  throw new Error('subagents runtime exposes neither reportFrom (alpha.2/3) nor sendMessage (alpha.4+): cannot deliver help report')
}
