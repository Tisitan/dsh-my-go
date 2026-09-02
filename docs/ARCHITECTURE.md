# dsh-my-go 架构设计

> **设计哲学**：让对的工种用对的脑子，Sisyphus 是唯一的总指挥和质检官。

dsh-my-go 是构建在 DeepSeek Harness (DSH) 之上的智能体编排系统。它把
DSH 原生能力（continuable 子智能体、`subagents` 服务、`agent/request`
waterfall、Session 会话与投影）组合成 AGENTS.md 所描述的
**星型 + 单线嵌套**拓扑：Sisyphus 调度，子智能体执行并汇报。

## 1. 拓扑与职责

```
                    用户
                     │
              ┌──────▼──────┐
              │  Sisyphus    │  调度 + 审查 + 驳回（主会话，用户所选模型）
              │  (用户所选)  │
              └──────┬──────┘
     ┌───────────┬───┼───┬───────────┬───────────┐
     ▼           ▼       ▼           ▼           ▼
  Hermes      Explore  Librarian  Looker      Hephaestus
  (轻量模型)  (轻量模型) (轻量模型)  (轻量模型)   (中等模型/high)
     ▲           ▲       ▲           ▲           ▲
     │           │       │           │           │
     └───────────┴───┬───┴───────────┴───────────┘
                    Oracle        Prometheus
                    (强模型/max)   (强模型/max, 仅流程开始一次)
```

> 图中模型仅为能力档位建议；插件不内置任何默认模型（0.2.3-tisitan.7 起默认
> 空绑定，全部继承环境路由），具体模型由使用者在设置中按工种配置。

- **所有子智能体（叶子）不直接通信**，必须经由 Sisyphus 中转。
- **执行模式**：单线阻塞，同一时段只能有一个子智能体运行；tisitan.10 起按
  编排会话隔离——每个父会话一条独立流水线，互不排队。
- **Sisyphus = 主会话**：用户对话所选模型即 Sisyphus 的模型；它不单独创建。
- **花名册可扩展**：七个内置工种之外，settings `roles` dict 支持自定义角色
  （键名 `^[a-z][a-z-]*$`，可绑定模型/人设/工具过滤），派发面按活名册校验
  ——扩展入口见 §2.4 与设置页角色编辑器。
- **子智能体 = DSH continuable subagent**：通过 `subagents.startContinuable`
  创建，持久化到独立 Session，支持后续邻接投递（`deliverToAdjacent` 适配层：
  alpha.4 走 internal 队列符号 / `sendMessage`，alpha.2-3 走 `followup`；
  对应 continue）。

## 2. 实现机制（对应 AGENTS.md 的 5 种通信）

> **单宿主编排时代（tisitan.21 起）**：编排的唯一实现是 preset 半
> `broker.mjs`（preset scope 注册，仅 MyGO 会话可见）；lib 半
> （`lib/index.js`，global 层）只承载存储 / 安装 / 面板面——preset 同步
> （`ensurePresetInstalled`）、settings 命名空间注册与 roles 迁移合并、
> 面板 RPC 端点全家、快照桥消费。lib-only 部署形态（preset 未装配）不再
> 提供任何编排能力：编排工具不存在，面板降级为空态
> `{ seq: 0, parents: {} }` + 花名册常驻。
>
> **两半间唯一运行时通道 = 快照桥单向语义**：broker 发布（
> `globalThis[Symbol.for('dsh-my-go.snapshot')] = () => latestSnapshot`）
> → lib 的 snapshot RPC 消费（实时读，零副本）。lib 半不再有自身编排
> 状态机，桥缺位即「preset 未装配」。
>
> **历史形态（tisitan.9→20）**：本节成文于双半同构时代——彼时 lib 半在
> global 层另持一份 fallback 编排（工具/状态机/模型绑定，供未装配 preset
> 的会话使用），两半经 tisitan.15 共享源层（§2.6）消除镜像双写，再由
> tisitan.20 快照桥只读化消灭台账双写竞态；tisitan.21 最终把编排面整体
> 收编进 broker 半，fallback 编排删除。下文机制描述均为 broker 半实况。

| AGENTS.md 通信 | 实现 | DSH 能力 |
| --- | --- | --- |
| `need_help`（子→Sisyphus） | broker 注册给子智能体的工具；调用后挂起自己，经 `reportToParent` 适配层把请求注入父会话，并生成 helpRequestId | alpha.4：`subagents.sendMessage(child, parentId)`，被拒兜底 `parent.inject`；alpha.2/3：`subagents.reportFrom` |
| `go_work`（Sisyphus→新子智能体） | broker 注册给 Sisyphus 的工具；`subagents.startContinuable` 创建空上下文子智能体，返回 childId | `subagents.startContinuable` |
| `continue`（Sisyphus→挂起子智能体） | `deliverToAdjacent` 适配层按档位投递驳回/追问：`queued` 走真 FIFO（alpha.4 internal 的 `queuePrompt` 符号 / alpha.2-3 的 `followup`），`steer` 同经该门面（alpha.4 的 `sendMessage` 即 next-step 插话；不再直调 `Agent.steer`），`abort` 先 `subagents.interrupt` 再排队 | alpha.4：`subagents[Symbol.for('dsh.subagent.queuePrompt')]` / `sendMessage`；alpha.2/3：`subagents.followup` |
| `forward`（Sisyphus 转发 need_help） | 读 helpRequest 记录 → 对既有 childId 走 `deliverToAdjacent`（queued 档），对类型用 go_work | broker 状态 + 邻接适配 / startContinuable |
| 结论（子→Sisyphus） | 子智能体最后输出经 `subagent/end` 注入父会话（alpha.4 的完工通知自带 closing message），broker 落账带 conclusionId | `subagent/end` 事件 |

> 另有 broker 注册给 Sisyphus 的两个观测工具（不属五种通信）：
> `orchestration_status`（编排状态全景 + 花名册简报区）与
> `list_subagents`（已派子代理清单：类型/childId/状态/最近一次 prompt）。

### 2.1 单线阻塞与会话隔离

编排状态按编排会话分桶维护（tisitan.10 起）：`orchestrations:
Map<parentSessionId, Orchestration>` 惰性创建——每个 Sisyphus 会话独立一条
流水线（队列/槽位/求助单/历史互不共享）；另有 `childOwner:
Map<childId, parentSessionId>` 路由表把子代理侧事件与工具调用送回属主流水线。
子代理侧八张桥接登记表（含 `childOwner`）与它们的跨表不变量自健康度批起住
`shared/child-registry.mjs`，broker 只按策略调用（见 §2.6）。
单个 Orchestration 维护：

```ts
// 实况（shared/orchestration.mjs:20-27，Orchestration 类实例字段）
interface OrchestrationState {
  currentMap: Map<childId, RunRecord>;  // 活记录（含 spawning 占位；滞留上限 500，超闸淘汰最旧，见 §2.7）
  queue: PendingWork[];                 // 排队中的 go_work
  helpRequests: Map<helpRequestId, HelpRequest>;  // 挂起的 need_help
  history: RunRecord[];                 // 已完成记录（含结论）
}
```

- `go_work` 在已有运行子智能体时进入队列，返回排队提示；子智能体结束
  （`subagent/end`）后自动启动队首。
- `need_help` 挂起当前子智能体（状态机标记 waiting + 工具描述约定「调用后停止」；
  注意：当前为台账层挂起，无强制 interrupt，子智能体若在返回后继续行动靠
  prompt 约束兜底），记录 helpRequestId 注入 Sisyphus。其中 `intent=execute` 用于子智能体被沙箱/权限拒绝时，
  将待执行的具体指令发给 Sisyphus 代为执行。`intent=ask_user` 用于子智能体需要向用户
  提问澄清需求时，将问题清单发给 Sisyphus 代为转达给用户，拿到答案后续回请求者。
- `continue` 唤醒挂起/已结束的子智能体（`deliverToAdjacent`，默认 queued =
  真 FIFO 排队；steer 档同经该门面（alpha.4 即 `sendMessage` 的 next-step 语义），
  abort 先 `subagents.interrupt`——**掐断前认活体**：儿童不在活注册表就没有 turn
  可掐（alpha.4 的 interrupt 对缺席目标是 accepted no-op，不抛错），此时不登记
  护航、直接降级 queued；护航也只吞**非 completed** 的终局，掐断与完工赛跑时
  那条真结论照常落账，tisitan.7）；记录仍在 spawning（真身未 resolve）时一律
  结构化拒绝——占位 id 背后还没有会话，投了就是假 accepted；
  对已结束的子智能体会重新入册（revive 回 currentMap + 恢复类型/备选覆盖/属主
  三张表，并把上一代际留下的两张一次性表——备选 once-guard 与 abort 护航——
  同点清零，复活即新世代），保持单线阻塞与结论回收。
- **属主路由与竞态墓碑（tisitan.10）**：`subagent/end` 经 `childOwner` 直达
  属主实例（未登记则全局扫描活记录/历史兜底）；`agent/disposed` 恒先于 end
  到达的竞态由有界墓碑表（`disposedTypes`，cap 50）+ 宽限期兜底消化——宽限
  期内 end 正常落账，真缺席才清槽推进队列（兜底掐断走 `retireChild`，类型侧
  三表与属主路由同点翻篇，不留墓碑给迟到的 end 制造「结论被丢弃」误报，
  tisitan.7）。多个 spawning 占位并存时仅在
  「恰有一个可归因」时绑定，歧义即留痕忽略（绝不串号）。
- **end 归因是纯决策，执行只在 dispatcher（0.3.0-tisitan.12 B5）**：上面那段取证
  顺序连同 abort 护航消费、备选 once-guard 登记、同步预告与队列推进时机，全部收在
  `shared/end-attribution.mjs` 的 `attributeEnd()` 里（八条出口，输入是状态快照 +
  只读谓词，输出 `{decision, ops, notices, facts}`）；broker 侧的
  `ctx.on('subagent/end')` 只剩「取快照 → 落 ops → 发 notices → 起执行链 → 按
  `facts.advance` 推进队列」五步，**不含一条业务 if**。三条协议随之外显：
  ① `fallback-evaluation` 的 `fallbackDecided.add` 与其同步预告必须都在同步段
  （`void` 起异步重派链是这一步的最后一件事，0.3.0-tisitan.18 的零真空期协议）；
  ② 推进队列的时机由 `facts.advance`（now / no / if-owned）决定，
  `finalizeEnd` 自己永不推进（R3/R4 把这条注释协议变成返回值字段；新决策忘登记
  则默认**不推进**而非猜「推进」）；③ abort 护航的无条件消费以 op 形式显式返回
  （旧写法 `if (set.delete(id) && cond)` 把消费与判定写在一起）。
- **台账持久化（tisitan.8）**：history（done/failed，每桶 `HISTORY_CAP` 条上限，
  与内存实例同口径）防抖落盘
  `<DSH_HOME>/dsh-my-go/orchestration-ledger.json`，插件加载时读回——进程
  重启后 `continue` 已完工 childId 仍能命中台账（revive → harness coldResume
  续聊），而不是报 unknown sub-agent id。tisitan.10 起落盘形状为
  `{ version: 2, parents: { [parentSessionId]: history[] } }` 分桶；v1 旧档
  载入 'legacy' 兜底桶，跨重启经全局扫描命中。写盘走同目录 `.tmp` + rename
  的原子序（tisitan.3），串行化在 Promise 链上；**防抖窗（250ms）内的最后一次
  变更随插件卸载同步补写**（tisitan.7）——清理函数只 `clearTimeout` 会让窗口内
  的完工/复活整段蒸发，重启后那条记录连文件兜底查找都救不回来。
- **父会话补充通知（tisitan.8）**：harness 的完工通知（settled）是
  dsh-subagent 硬编码模板，插件不可抑制/改写（alpha.2/3 时代与其并存的
  reported 一条已随 `reportFrom` 删除，见 FORK-GUIDE 同源说明）；broker 经公开
  API `parent.inject`（非唤醒）自行注入两条低频高价值短通知——队列上岗映射
  （`work-* → childId`）与失败附因。失败附因来源：`subagent/end` 载荷无
  error 字段，broker 读子会话最后一条 `turn/end` 的 `reason.error`——
  tisitan.9 起 live store（`sessions` 服务）降级为快路径，主路径读持久化
  档案 `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(childId)>/session.jsonl.zstd`
  （多帧 zstd 逐帧解压；continuable 销毁顺序使 end 发射晚于 live store
  摘除，live 读法必然落空；tisitan.16b 起默认项目目录未命中时按 childId
  全局枚举 root 下各项目目录兜底，多命中取 mtime 最新）。读档失败静默退回无附因（console.warn 留痕），
  同一原因同时追加进 history 结论尾部。

### 2.2 模型与 effort 绑定

每个智能体类型（agentType）在 settings 中可配置 `provider` / `model` /
`reasoningEffort` / `dsv4p0813`（DSV4P0813 补丁开关）/ `fallbacks`
（备选链 `[{provider, model}]`，主绑定终局失败时按序自动重派；留空=不启用）。

- **创建时**：`SubagentStartRequest.agentOptions = { provider, model }` 直接
  指定模型（`provider` 缺省时继承父会话渠道；`model` 先经 `modelExists()`
  用 `llm.listModels` 校验真实存在才应用）；`persona` 用该类型的 prompt 覆盖。
  两份 provider/model 维度的缓存（`modelCache` / `effortCache`）同一纪律：
  **只缓存「查到了」的结论**（模型清单哪怕为空也算查到；能力表查得非空档位
  才算查到，`null`=未知不入表），抛错/服务缺席一律留待下次重试；两者都随
  `settings/updated` 整体作废，且热更后**在飞的旧响应不许回写**（epoch 比对，
  tisitan.7）——否则一次陈旧拉取就能把刚清掉的缓存原样塞回去，失效被无声撤销。
- **请求时**：`agent/request` waterfall 拦截，按 agent 类型覆盖
  `reasoningEffort`（以及兜底 provider/model）。类型识别以 broker 的
  `sessionTypes` 注册表为准：spawn 成功时登记 `childId → 工种`，
  `agent/disposed` 时移入有界墓碑表（防 disposed 先于 `subagent/end`
  的竞态串号），`subagent/end` 消费后清除。会话 label 前缀约定
  `dsh-my-go:<agentType>` 是 typeOfAgent 的兜底识别根（tisitan.15 起
  登记优先、label 兜底，见 §2.7）。

> ⚠️ effort 档位跟随 DSH 模型目录：仅在目标模型实际支持所配档位时才设置；
> 不支持或能力未知时**不设置**（走适配器默认），拒绝硬映射/钳位
> （如 deepseek-official 仅 off/high/max，配 `low` 则留空而不是改成 high）。

### 2.3 DSV4P0813 补丁（两阶段引导）

DSV4P0813 需要两阶段上下文注入流程才能发挥全部能力。实现现状：

- **Phase 1（未晋升）**：`system-prompt/assemble` 钩子过滤装配结果——
  只保留 persona section + 引导工具白名单
  （`bash/pwsh/read/write/edit/glob/grep`），清空 runtime contexts。
- **晋升**：监听 `session/event`，按**事件自身类型**判定——首次 `tool/call`
  或首次 `turn/end`（模型产生首轮响应）即晋升，放开完整工具目录与全部 prompt
  section。**不扫事件数组**（宿主 `Session.append` 先 push 再 notify，处理器
  看到的末位恒为当前这条事件，倒扫写法在真机上一律落空，tisitan.7 修正）；
  **无锚定文本检测**（不检查模型输出内容）。
  （注：「compaction 后回落受控阶段」尚未实现——晋升状态目前一经提升
  不回落。）

broker 为每个智能体提供 `dsv4p0813: boolean` 开关（默认关闭）。
Sisyphus 本身不启用（它是调度者）——注入识别面 `typeOfAgent` 恒不命中
sisyphus 会话，该开关对其置灰锁定（tisitan.20）。**执行面仅 broker 半**
（preset 部署形态）：lib-only 部署形态下此开关不生效（tisitan.20 起设置页
文案已注明作用域）。

### 2.4 名册路由与 spawn 正统通道（tisitan.14）

settings `roles: dict(roleSchema)`，角色键名在 schema 层强制
`^[a-z][a-z-]*$`；旧顶级七工种键在装载与热更时自动无损迁入 `roles`
（幂等；失败保留原配置仅 warn，apply 不中断）。`go_work` / `forward` 的
`agent` / `target` 参数为自由 string 按活名册校验——未注册名结构化报错
并附当前可用清单；`orchestration_status` 尾部输出活花名册（sisyphus
不入可派名册）。子代理 persona / toolFilter 经 `SubagentStartRequest`
官方字段注入（descriptor v2 持久化、冷恢复原样重放），首条 prompt 的
`<system-reminder>` 包装退役；toolFilter 派发前按活工具目录过滤降级
（warn 留痕），allow 全缺名时丢弃 toolFilter 回落全量目录。

### 2.5 draft 双形状契约（loadSettings ↔ saveSettings）

client 编辑面与 host 存储面之间的形状约定（tisitan.15 起白纸黑字，
测试锚定）：

- **内置键提升回顶级**：loadSettings 把 roles 内的内置工种行提升为
  `<type>` 顶级键回传（兼容旧前端形状），roles dict 原样附带；
- **roles 原样附带**：loadSettings 恒回传 roles dict 本体（含自定义行），
  是角色编辑器的数据源；
- **顶级形状不消费 persona/toolFilter**：`<type>` 顶级键只承载绑定五字段
  （provider / model / reasoningEffort / dsv4p0813 / fallbacks），
  persona 与 toolFilter 只存在于 roles 行形状；
- **显式携带才写**：saveSettings 只对 draft 行显式携带的字段产生
  set/unset ops——部分行（如只带 persona）绝不误清已配的 provider /
  model 绑定（tisitan.15 修复「部分行误清」回归），空值 unset、显式
  false 可表达。
- **revision 围栏（tisitan.9 E6/A-03）**：loadSettings 额外回带
  `revision`（宿主 `settings.describe()` 给出的命名空间单调版本号；宿主不
  暴露时回落本半进程内计数，由 `settings/updated` 驱动），设置页把它当**不透明
  凭据**存着，保存时原样带回。版本号不符即回 `ok:false + conflict`
  （details 带 `{expected, actual}`），存储一次写都不发——旧写法是后写覆盖前写，
  用户拿一份旧快照就能悄悄洗掉别人刚存的配置。凭据缺失（旧前端 / 脚本直调）=
  无条件写，语义不变；宿主 `mutate` 支持第三参时把围栏交给它执行（提交在命名空间
  写队列里串行，检查与写入之间没有 TOCTOU 窗），并映射 `SETTINGS_CONFLICT`
  稳定错误码；保存成功回带**新版本号**，否则用户接着改第二处会自撞一次假冲突。
- **未保存防线（tisitan.9 E6/A-03）**：所有草稿变更（含 roles-editor 经
  `deps.setDraft` 的写）一律经 `mutateDraft` 汇聚口置 dirty；dirty 期间挂
  beforeunload（宿主 `settings.section` 只给 `close`，没有 onClose / 卸载时机可
  挂），保存行挂「● 未保存」角标 + 「保存并关闭」（保存失败或冲突绝不关页）。
  冲突后本地凭据作废并锁死两枚保存按钮，唯一出路是显式「重新加载」。
- **脏键 fail-closed（tisitan.8 E7/B-05）**：`draft.roles` 的键先过
  `ROLE_KEY_PATTERN` 才生成 ops。mutate 是**整批原子**的，旧写法只要 draft 里
  混进一枚 schema 必拒的脏键（手改 settings.yaml 塞进来的大写名或路径串），
  整次保存就被毒杀——用户在 WebUI 上改什么都不再能落盘。脏键就地丢弃，
  其余行照常写。
- **读面三态（tisitan.8 E4/B-04）**：loadSettings 的读盘异常回
  `ok:false + unavailable`，不再回 `ok:true + {}`。谎报成功会让设置页把
  「没读到」渲染成一张干净的空表单，用户点保存就把未读到的真配置洗掉；
  现在前端的 `loadError` 红字横幅当场亮出、表单不渲染，误写路径消失。
- **错误信封合规（tisitan.8 B-06 半面）**：lib 半每个 `ok:false` 分支都带
  `details: {}`——宿主 `ConnectionRpcFailure` 的三字段契约（code/message/
  details）不容缺项。错误码体系本身（unavailable / bad-request / not-found /
  internal / settings-rejected 各自为政）另批再议。
- **注册失败面隔离（tisitan.8 E1/B-02）**：settings 命名空间注册与「读盘 +
  `ctx.on('settings/updated')` 接线」分两个 try 且各自 `console.error` 留痕。
  旧写法一个 try 罩到底：register 抛（schemastery 解析不到 / 形状冲突）会连带
  吞掉热更监听，此后 WebUI 改绑定全部无声失效，而且 catch 体零日志——三重故障
  裹成一层"什么都不发生"。
- **快照出口裁剪（tisitan.8 E5/A-02）**：snapshot RPC 在出口把每桶 history
  裁到末 8 条并从 current/queue/history 剔除 `prompt`（面板零消费，而它是
  记录里最贵的字段），helpRequests 的 content 原样保留。等价性：面板历史区
  本就只渲染全局末 8，而各桶末 8 的并集恒 ⊇ 全局末 8。broker 侧实况对象
  零改写，台账真源不受影响。
- **snapshot 端点自带 try（tisitan.8 E10/B-03）**：桥函数抛错回
  `ok:false + internal`（附 message）而非抛穿 RPC 框架——旧写法让 Web 侧
  拿到一个没有信封的传输错，与「通道根本没注册」在客户端完全同形。
- **RPC 注册 arity 探测（tisitan.8 E9/B-07）**：`connection.rpc.handle` 的
  形参个数按宿主版本漂移（本机两参，更新版要第三参 `options.authority`），
  故 `handle.length >= 3` 才带 `{ authority: 'loopback' }`。探测偏保守：
  带默认值的形参不计入 `.length`，最坏情况退回旧的两参调用。

### 2.6 共享源层 preset/shared/（tisitan.15；tisitan.21 起编排面 broker 独有）

broker.mjs（preset 层）与 lib/index.js（global 层）import 同一份
`preset/shared/` 九模块（tisitan.15 净消 1,251 行镜像双写；健康度批再拆出
child-registry / adjacent 两档；0.3.0-tisitan.12 再拆出 end-attribution）：

| 模块 | 住户 |
| --- | --- |
| constants.mjs | 双半共享常量单一来源 |
| failure.mjs | 失败归一化 + 备选链错误分类器（tisitan.21 起仅 broker 消费） |
| archive.mjs | 持久化 turn-failure 档案读取（多帧 zstd 逐帧解压；tisitan.21 起仅 broker 消费） |
| roles.mjs | 角色名册数据 + 路由 helpers（bindings / promptCache 注入）；名册条目 `rosterEntries` 是三处消费面（面板 roster / 编排状态文本 / 系统提示简报）的唯一语义源（0.3.0-tisitan.9 A-05） |
| orchestration.mjs | 单线阻塞编排状态机（tisitan.21 起 broker 独有；tisitan.15-20 为两半同一实现） |
| misc.mjs | 展示字符串 / 默认绑定 / XML 转义 / typeOfAgent / 台账修剪 / prompt 预载 |
| child-registry.mjs | 子代理侧八张桥接登记表 + 跨表不变量（墓碑/收尾/备选两段式登记/复活重建——复活即新世代，同点清备选 once-guard 与 abort 护航两张一次性表）；`createChildRegistry()` 工厂，broker 独有（健康度批） |
| end-attribution.mjs | **subagent/end 归因决策纯函数**（0.3.0-tisitan.12 B5，自 broker 的事件回调抽出）：八条控制出口（ignore / late-duplicate / unattributable / no-owning-orchestration / expected-abort / fallback-in-flight / fallback-evaluation / finalize）返回 `{decision, ops, notices, facts}`——改哪些表、对谁说什么、槽位还占不占；写副作用与异步重派链全在 broker 的 dispatcher。`shouldAdvanceQueue` 把「finalizeEnd 不推进队列」从注释协议升级为返回值里的显式口径（R3/R4）。失败附因经 `readFailure` 回调注入（本模块不认识文件也不认识会话） |
| adjacent.mjs | 上游邻接消息面唯一耦合点：`planAdjacentDelivery`（**路由表单一出处**，0.3.0-tisitan.12 N15：route ∈ queue / steer / legacy / unavailable + invoke）+ `sessionEvents` / `canQueueAdjacent`（plan 薄壳）/ `deliverToAdjacent`（委托 plan）/ `reportToParent`，按方法存在性在 alpha.2/3 ↔ alpha.4 间特性探测分界；broker 独有（自 misc 独立，健康度批） |

tisitan.21 起 lib 半只引存储/面板面符号（constants 的名册键集与键名
pattern、roles 的迁移/合并、misc 的 `defaultBindings`），编排面符号一律
不引入；npm 导出面同步切除编排 re-export（消费方直引 `preset/shared/`）。

**铁律**：零 `@deepseek-ai/*` import、零 ctx 触碰（node: builtins 允许），
依赖一律显式注入参数。**promptCache 双根**（历史形态，现仅 broker 消费）：
broker 半以 preset 装配目录为根读 prompts/，lib 半曾以
`~/.dsh/.agent-presets/dsh-my-go` 为根——shared 层只认注入的
`loadPrompt`。`ensurePresetInstalled`
同步时校验 shared/ 存在性（broker 相对 import 依赖 preset 整树到位；
0.3.0-tisitan.8 起同步从 `cp` 整拷改为逐文件字节比对只重写变化者，见 §5）。
host-parity 断言 tisitan.21 起重写为**反向 parity**：lib 编排标记 grep=0
哨兵（编排代码加回 lib 立即红）+ broker 原计数锁 + import 存在性 +
ESM 同一性 + 行为直测（逐字比源码的字符串对称断言早已退役）。

### 2.7 typeOfAgent 统一与养护上限（tisitan.15）

- **typeOfAgent（工种识别，misc.mjs 单一源；tisitan.21 起仅 broker
  消费）**：sessionTypes 活登记优先，会话 label（`dsh-my-go:<agentType>`
  前缀）正则兜底；`agent/request` waterfall 的绑定 / effort 覆盖、
  DSV4P0813 assemble 识别与 **need_help 求助单的 `agentType` 取证**同走此
  函数——修复 cold-resumed 子代理（进程重启后活登记已失）模型绑定静默失效、
  以及竞态归随/墓碑期儿童求助单工种落 undefined（面板色板落空，tisitan.7
  N13）这两类真 bug。**双侧契约**（历史名称，
  现即 broker 单边契约）：自定义角色键名 schema 强制
  `^[a-z][a-z-]*$`，与 label 识别正则同构（角色名 ⊆ `[a-z-]+`），
  任意名册角色都能从 label 还原。
- **台账与槽位养护**：编排台账 `parents` 分桶超 200 桶时按桶内最新
  updatedAt 修剪（load / save 双点接入）；`currentMap` 超 500 条滞留记录时
  `enforceCurrentCap`（`beginSpawning`/`spawn` 路径同点触发）按 updatedAt
  **淘汰最旧**的一条并 `console.warn` 留痕——防长生命周期进程失控泄漏（与
  §2.1 口径一致，绝非「拒绝新占位」）。

## 3. UI 适配

- **overlay 树状图面板**：`shell.overlay` 浮层显示子 Agent 运行情况
  （current / queue / help / history），由侧栏底部 🧭 按钮开关，
  点击节点可跳转子会话（经 host 半的 connection.rpc 快照桥轮询）。
  队列节点渲染 work-id 占位；快照桥未就绪时显示「编排桥未就绪」提示态
  而非静默空白（tisitan.8）。tisitan.10 起面板摊平展示所有编排会话的
  条目，parents 多于一个时每条附会话短后缀区分。**'legacy' 幽灵父区被
  过滤**（tisitan.8 A-04）：台账 v1 兼容桶没有属主会话、current 恒空、
  点开无处可跳，出现在父区列表里只会被误认成一个真实编排会话。
  求助行的 React key 用**求助单 id**（tisitan.8 A-08）——同一儿童可先后挂
  两张不同 intent 的求助单，按 childId 做 key 会让第二张就地复用第一张。
  30s 相对时间自刷新 tick 只在面板可见时做功（tisitan.8 A-09）。
  tisitan.15 起面板附**花名册常驻区**（可折叠），host 未就绪时显示「花名册
  不可用」提示态；0.3.0-tisitan.9（A-05）起它吃 snapshot 的**结构化 `roster`**
  字段（`{role, builtin, provider, model, modelText, chain[], toolFilterText,
  personaSource}`），表头文案、计数、徽章全由客户端自持——旧写法是面板按
  「`rosterLines[0]` 必为表头、`length-1` 即角色数」的位置约定切 host 文本，
  等于把 host 的字符串措辞当 API，host 改一个字这里就静默错位。名册行文本
  （`rosterLines`）降级为同数据的 deprecated 镜像保留兼容期；三处消费面
  （面板 / `orchestration_status` 尾部 / Sisyphus 系统提示简报）从此共用
  `shared/roles.mjs` 的 `rosterEntries` 同一份语义源（此前 lib 与 broker 各持
  一份逐字相同的 18 行摘要逻辑，shared 简报又是第三种格式）。
- **设置页读写（0.3.0-tisitan.9 加固）**：读写全走 host RPC（`lib` 半是
  path-ops 编译与 bindings 合并的唯一权威），宿主注入的 `settingsScope` 只当
  服务可用性门禁；渠道与模型两栏是 input + datalist **可手填组合框**（清单在场
  点选、缺席直接键入，空值 = 跟随 Sisyphus），`listModels` 逐渠道并行
  （`Promise.allSettled`）并把失败渠道连同原因回进 `errors` 字典，前端按渠道
  行内提示——不再把「清单没拉上来」渲染成「这个渠道没有模型」。
  dirty / beforeunload / revision 围栏见 §2.5。
- **轮询的三道闸（tisitan.8 E5/A-02 + E10/B-03）**：① **in-flight 门**——
  上一发快照没回来时后续 tick 一律不重入（慢宿主下 600ms 定频会自我堆叠在飞
  请求）；② **失败退避**——连续失败按 600 → 1500 → 3000ms 抬升（封顶），
  成功即复位到基准档；③ **迁移点各留一行 console.warn**——只在桥状态翻转时
  打，绝不被自己的 600ms 节奏刷屏。桥故障分两型提示：host 端 RPC 根本没应答
  （未激活/仍在启动）与 host 在、桥函数抛错（`internal`，附原因），文案与
  配色不同——前者该等，后者该查。
- **客户端服务降级不静默（tisitan.8 E2/A-01）**：`sessions` / `timer` 有意
  不进 `inject`（拿不到就降级，绝不炸挂载），但降级必须留痕且有真功能：
  timer 缺席时回落到 `window.setInterval` 自管 disposer（unapply 一并清干净，
  不留孤儿轮询）并一次性 warn；sessions 缺席时快照照常刷新、只关掉跳转与
  自动跟随，同样一次性 warn。旧写法 `timer && timer.interval` 短路即
  **面板永不刷新且从不说明原因**。
- **自动跳转**：子智能体运行时，client 通过 `sessions.openSubagent({
  parentSessionId, childSessionId, mode: 'continuable' })` 自动跳转到子会话，
  展示其上下文；子智能体结束（`subagent/end`）后跳回 Sisyphus 父会话。
  中间保持 DSH 原生会话视图，不自建上下文面板。tisitan.10 起加**会话门禁**：
  只跟随当前打开会话的子代理（读 `sessions.list.getSnapshot().current`），
  跳回父会话同受门禁约束——多会话并行时绝不把用户拽去别的会话。
- **设置页**：client 半（`src/client.js`）注册「MyGO 编排」设置页 UI；
  settings 命名空间 `dsh-my-go` 由 host 半（`lib/index.js`）注册，
  broker 半只读取。每工种绑定五字段：provider / model / reasoningEffort /
  dsv4p0813 / fallbacks（与 §2.2 一致；UI 经 tisitan.19 链编辑器合并编辑
  主选 + 备选链）。tisitan.13-19 UI 增量：工具屏蔽编辑器（`toolMask.deny`
  双列，tisitan.13）、自定义角色编辑器（roles dict 增删改 + 导入导出，
  tisitan.14）、内置工种人设覆盖（persona textarea + 载入文件默认，
  tisitan.15）、模型优先级链编辑器（#1 主选 + #2..N 备选，一键扶正，
  tisitan.19）。

## 4. 交付物

| 目录 | 内容 |
| --- | --- |
| `preset/` | dsh-my-go agent preset（由 lib 同步到 `~/.dsh/.agent-presets/dsh-my-go/`； tisitan.15 起含 shared/ 共享源，健康度批起共八模块，0.3.0-tisitan.12 起共九模块（+ end-attribution）） |
| `lib/` | host 半（global 层插件 `index.js`，632 行）：settings 命名空间 + revision 并发写围栏 / RPC（快照出口裁剪 + 结构化名册 + 端点自带 try）/ preset 同步器（版本+内容摘要 marker，逐文件与镜像两种语义）；tisitan.21 起零编排面（台账持久化归属 broker 半） |
| `src/` | client 半源码：设置页、overlay 树状图面板、自动跳转、守卫纯函数。**纯构建输入——0.3.0-tisitan.11（D-15）起不再进发布包**（运行期只加载 `dist/client.js`，lib/preset/prompts 对 src 零引用已 grep 核实） |
| `test/` | node:test 单测与桥接测试。入口 `npm test` = 构建 bundle → `test/apply.mjs` 冒烟（含 dist 新鲜度）→ `node --test "test/*.test.mjs"` 通配发现（0.3.0-tisitan.11 C-12：不再手写文件清单，加档零动作）。共享 ctx 替身 `test/helpers/mock-ctx.mjs` 按真宿主语义从严（事件多播 + waterfall、重名注册即抛、effect 不吞异常、settings 读出深冻结副本），例数一律以 `npm test` 的 `# tests / # pass / # fail / # skipped` 机器读数为准，不写进文档 |
| `scripts/` | 构建与运维脚本：`build-client.mjs`（esbuild 打包 client 半，`write:false` 只出内存产物 → `dist/` 仅一份 `client.js`）、`dump-session.mjs`（zstd 会话档案 CLI 转储） |
| `dist/` | client 半构建产物。**`dist/client.js` 是 `exports["./client"]` 的指向、Web UI 加载的唯一入口，随 release commit 入库**（装方零构建权限）；其余中间产物不入库也不落盘（`build-client.mjs` 走 `write:false`）。政策与发版固定动作见 `FORK-GUIDE.md`「发布流程」 |
| `.github/workflows/` | `ci.yml`（npm ci + typecheck + test + pack 干跑，ubuntu/windows 双腿）/ `publish.yml`（tag↔version 断言 + 预发布 `--tag next` 派生 + OIDC Trusted Publishing；**休眠中——未启用 npm 发布渠道，本 fork 仅 git 分发**，见 `FORK-GUIDE.md`「发布流程」）。依赖版本由 `.nvmrc` + `package-lock.json` 双锚定（0.3.0-tisitan.11 D-14） |
| `docs/legacy-broker-ts/` | ⚠️ 归档的 TS 参考实现（原根目录 `broker/`， tisitan.15 移入；见其 README），停维护、不参与构建与运行 |
| `prompts/` | 每个智能体的 persona/prompt 文件 |
| `docs/` | 本文档 |
| `README.md` | 项目说明 |

## 5. 安装（git 分发 → profile bundle）

> ⚠️ 本 fork 只走 git 分发，**不要**执行 `dsh plugin add dsh-my-go@latest`——公共 npm
> 上该包名属于无关第三方，装到的是别的包。完整前置/验证/升级/卸载/兜底流程见
> README「安装（从 git clone）」，这里只讲架构侧关心的一步。

1. `git clone --depth 1 <本仓库地址> <永久稳定路径>` →
   `dsh plugin --profile web add <该路径>`：`dsh plugin` 是 pnpm 转发器，把本地目录写成
   profile 的 `link:` 依赖并建 junction/symlink，随后按已装状态自动把 `dsh-my-go` 登记
   进 `dsh.profile.bundles`；bundle 层再应用包自带的 `cordis.patch.yml`
   （`dsh.bundle.patch`），host 插件（`lib/index.js`）由此挂为 profile 层——**全程无需
   手写 patch insert，也无需装方构建**（`dist/client.js` 随 release commit 入库，见
   `FORK-GUIDE.md`「发布流程」）。clone 路径此后不可移动/删除：装的是链接不是拷贝。
2. 重启 `dsh web`；lib 的 `ensurePresetInstalled()` 把 `preset/` +
   `prompts/` 同步到 `~/.dsh/.agent-presets/dsh-my-go/`，幂等判据是 marker
   文件 `.dsh-my-go-version` 里的 **`<版本>+<内容摘要>`**（tisitan.8
   E8/B-08）：摘要覆盖两棵树每个文件的「路径 + 字节数 + sha256 前 12 位」，
   版本与内容同时一致才跳过——装机侧的手工修改在同版本同内容下继续存活，
   而包内任何一次真实内容改动（含同版本热修）都会换摘要并触发重拷，不再
   需要 bump 版本号解锁同步。同步语义：`preset/` 逐文件字节比对、只重写变化
   者（写窗口从整树缩到实际改动文件，tisitan.8 B-09）；`prompts/` 先删净
   再拷（纯资源镜像，上游退役的人设文件不留孤儿）。整段拷贝失败只
   `console.error` 留痕并吞掉，绝不打断挂载。
3. 新会话选择「MyGO!!!!! 模式」预设，开始编排。
