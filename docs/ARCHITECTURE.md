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
          Oracle        Prometheus      Apelles
         (强模型/max)   (强模型/max,    (强模型/大模,
                         仅流程开始一次)  可视化画师，0.5.0 起)
```

> 图中模型仅为能力档位建议；插件不内置任何默认模型（0.2.3-tisitan.7 起默认
> 空绑定，全部继承环境路由），具体模型由使用者在设置中按工种配置。

- **所有子智能体（叶子）不直接通信**，必须经由 Sisyphus 中转。
- **执行模式**：单线阻塞，同一时段只能有一个子智能体运行；tisitan.10 起按
  编排会话隔离——每个父会话一条独立流水线，互不排队。
- **Sisyphus = 主会话**：用户对话所选模型即 Sisyphus 的模型；它不单独创建。
- **花名册可扩展**：八个内置工种（0.5.0-tisitan.3 起含可视化画师 Apelles——
  `AGENT_TYPES` 末位追加、`prompts/apelles.md` 人设、名册三处消费面自动带上，
  见 §2.4）之外，settings `roles` dict 支持自定义角色
  （键名 `^[a-z][a-z-]*$`，可绑定模型/人设/工具过滤），派发面按活名册校验
  ——扩展入口见 §2.4 与配置卡角色详情栏。
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
| 结论（子→Sisyphus） | `reportExternalization` 开（装机口径，缺省即开）时：子代完工调 `report_submit` 四字段落板 + 成功登记，`subagent/end` 走 E7' 报告闸门——主编收到的终局摘要是 broker 从**已校验字段**合成的概要（`buildOwnerSummary`：conclusion 全文 + evidence 逐行 + open + `report_fetch` 取阅指引），子代最后一条消息不参与任何解析；全文在板上，主编按需切片取阅。闸关时回落旧口径：子智能体最后输出经 `subagent/end` 注入父会话（alpha.4 的完工通知自带 closing message），broker 落账带 conclusionId | `report_submit` 落板 + `subagent/end` 事件（E7' 闸门，见 §2.8）；回退面同左 |

> 五种通信之外，broker 注册的其余工具（现共 10 个编排/通信/报告/接力链工具，
> 名单常量 `SELF_REGISTERED_TOOLS`，shared/constants 单源）：观测两枚
> `orchestration_status`（编排状态全景 + 花名册简报区 + 接力链状态行）与
> `list_subagents`（已派子代理清单：类型/childId/状态/最近一次 prompt）；报告
> 外部化两枚 `report_submit`（子代完整报告落板 + 成功事实登记）与 `report_fetch`
> （主编切片读板，默认 200 行 / 上限 2000 行），受 `reportExternalization` 总闸
> 控制注册；接力链两枚 `chain_start`（声明链并派首跳）与 `chain_resolve`（处置
> 挂起的链），受 `relayChains` 总闸控制注册（机制分见 §2.8/§2.9/§2.10）。闸控
> 四枚是**主编职权工具**：`canOrchestrate` 运行时守卫（有 parentSession 的会话
> 调用即结构化拒绝）+ 子代理侧 `agent/created` 目录 deny 双保险，且 deny 名单
> 随各自注册开关联动——开关关 = 工具未注册 = 无需 deny（闸的意图被「工具根本
> 不存在」真空满足），开关开 = deny 必须生效。

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
  `shared/end-attribution.mjs` 的 `attributeEnd()` 里（十条出口，输入是状态快照 +
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
（preset 部署形态）：lib-only 部署形态下此开关不生效（tisitan.20 起配置卡
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

**apelles 的名册容纳（0.5.0-tisitan.3）**：新增内置工种不需要任何路由
改动——`AGENT_TYPES` 末位追加 `'apelles'`（shared/constants 单源）后，
既有管线自动收编：可派名册 `rosterKeys` = 内置 ∪ 自定义（sisyphus 恒
除外），`go_work`/`forward` 校验、`orchestration_status` 尾册、Sisyphus
系统提示简报、面板结构化 roster 三处消费面（均投影自 `rosterEntries`）
原样带上；persona 走 `prompts/apelles.md` 既有加载链（rolePersona：
自定义覆盖 → 内置文件 → 兜底文案）；泳道归属 `laneOf('apelles')` =
write（不在 READ_LANE_TYPES，§2.9）。需要手工同步的只有展示面三处
（`src/client-constants.js` 标签/色板/卡面说明、`shared/misc.mjs` 工种
说明与 `defaultBindings`、prompts 档案）与配置卡卡数（8→9）。职责为
结构图/流程图/海报 + UI 视觉稿与结构 demo，设计岗不施工（主编侧协作
规程见 prompts/sisyphus.md「apelles 协作规程」）。

### 2.5 draft 双形状契约（命名空间存储 ↔ 配置卡草稿）

配置卡编辑面与宿主命名空间之间的形状约定（tisitan.15 起白纸黑字、测试锚定；
0.5.0-tisitan.3 起两侧都在 `src/settings-ops.js` 里，投影 `draftFromSection`、
写回 `buildSettingsOps`，读回判落盘 `writeLanded`）：

- **内置键提升回顶级**：`draftFromSection` 把 roles 内的内置工种行投影为
  `<type>` 顶级键供页面渲染（历史沿用形状），roles dict 原样带在草稿里；
  写回时顶级行**优先于** roles 里的同名旧行（用户编辑面胜出）；
- **roles 原样附带**：投影恒保留 roles dict 本体（含自定义行），是角色清单的
  数据源；`sisyphus` 例外——它永远是顶级键，roles 里出现即视为死数据，
  读面不复活、写面不落、存量靠删除面自然清出；
- **顶级形状不消费 persona/toolFilter**：`<type>` 顶级键只承载绑定五字段
  （provider / model / reasoningEffort / dsv4p0813 / fallbacks），
  persona 与 toolFilter 只存在于 roles 行形状；
- **显式携带才写**：`src/settings-ops.js` 的 `buildSettingsOps` 只对草稿行显式
  携带的字段产生 set/unset ops——部分行（如只带 persona）绝不误清已配的 provider /
  model 绑定（tisitan.15 修复「部分行误清」回归），空值 unset。0.5.0-tisitan.3 起
  这套编译规则**只有浏览器一份**（原先住 lib 半 `saveSettings` 闭包，随写通道迁
  settingsScope 整体搬来，lib 那份单价净化副本一起删除）；`false`
  与空串/空数组同列为「无事可记」，改发 unset，不再把默认值钉进用户层。
- **revision 围栏（tisitan.9 E6/A-03 立规，0.5.0-tisitan.3 交给宿主）**：配置卡把
  宿主命名空间的 `revision` 当**不透明凭据**存着——记的是**草稿建立那一刻**的版本号，
  保存时作为 `scope.mutate(ops, fence)` 的第三参交给宿主执行（提交在命名空间写队列里
  串行，检查与写入之间没有 TOCTOU 窗，不符即整批拒）。版本号唯一真源是宿主
  `describe()`：lib 半原先自造的 `localRevision` 计数与 `currentRevision()` 出口已随
  端点一起删除（两处真相必然漂移）。
- **未保存防线（tisitan.9 E6/A-03）**：所有草稿变更一律经配置卡的 `stage` 汇聚口置
  dirty；dirty 期间挂 beforeunload，保存条挂「待保存：<改了哪几块> · r<版本>」。
  外部提交**不冲草稿**（旧写法「revision 一变就重灌」会吞掉用户正在输入的东西），
  而是亮漂移告示，唯一出路是显式「丢弃草稿并重读」。写完后必须**读回比对**才出
  「已保存」回执：官方 `scope.mutate` 被拒时不抛异常（自己 recover 重读后照常
  resolve），旧设置页的 `try/catch` 判冲突因此把失败报成成功——本单修掉的就是这一类。
  「保存并关闭」随 `close` affordance 一起退役（官方页的开合归 shell）。
- **脏键 fail-closed（tisitan.8 E7/B-05）**：`draft.roles` 的键先过
  `ROLE_KEY_PATTERN` 才生成 ops。mutate 是**整批原子**的，旧写法只要 draft 里
  混进一枚 schema 必拒的脏键（手改 settings.yaml 塞进来的大写名或路径串），
  整次保存就被毒杀——用户在 WebUI 上改什么都不再能落盘。脏键就地丢弃，
  其余行照常写。
- **读面态（tisitan.8 E4/B-04 立规，0.5.0-tisitan.3 换成快照四态）**：
  `resolveCardView(snapshot)` 把 loading / ready / unavailable / memory 四态分清楚，
  读不到就撤走整个编辑器只留状态与「重试」（内存档不给重试）。旧 loadSettings 曾
  把读盘异常回成 `ok:true + {}`，谎报成功会让页面把「没读到」渲染成一张干净的空表单，
  用户点保存就把未读到的真配置洗掉。
- **错误信封合规（tisitan.8 B-06 半面）**：lib 半每个 `ok:false` 分支都带
  `details: {}`——宿主 `ConnectionRpcFailure` 的三字段契约（code/message/
  details）不容缺项。错误码体系本身（unavailable / bad-request / not-found /
  internal / settings-rejected 各自为政）另批再议。
- **注册失败面隔离（tisitan.8 E1/B-02）**：settings 命名空间注册（0.5.0-tisitan.3 起
  首选 `installSection`，老宿主回落 `register`）与「读盘 + `ctx.on('settings/updated')`
  接线」分开且各自 `console.error` 留痕；读面失败只在 `refreshBindings` 一处留痕
  （叠第二层等于把原因藏进另一个口径）。
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
- **面板通道注册壳（0.5.0-tisitan.2 F1）**：`/dsh-my-go` 不再经
  `connection.rpc.handle` 注册，而是本半自己
  `webServer.register({ kind: 'prefix', path: '/dsh-my-go', handler })`（宿主自身
  `/api` 的同款写法）。起因：宿主 0.1.5-alpha.1 的 `rpc.handle` 在注册时读
  `owner.webServer`，owner 被钉死在 client-connection 只 inject 了 credentials 的
  apply fiber 上，cordis 门禁当场拒读 → 通道静默失踪、面板 RPC 全量吃 405。
  `connection` 与 `webServer` 一律经 `ctx.get(...)` 取用（`get` 在门禁之外，属性访问
  不在），两者任缺其一即 `console.warn` 留痕跳过注册，headless/CLI 形态零影响。
  handler 内补回 `rpc.handle` 代做的两件事：`connection.requestRejection(req)` 鉴权
  直出（未认证 401/403，绝不进业务分发）+ `client-request`/`server-response` 信封
  封装（endpoint 从 pathname 去前缀，判定表与宿主同构；信封不合法回
  `gateway/bad-request` 帧而非 4xx）。分发体七支端点一字未改。

### 2.6 共享源层 preset/shared/（tisitan.15；tisitan.21 起编排面 broker 独有）

broker.mjs（preset 层）与 lib/index.js（global 层）import 同一份
`preset/shared/` 十三模块（tisitan.15 净消 1,251 行镜像双写；健康度批再拆出
child-registry / adjacent 两档；0.3.0-tisitan.12 再拆出 end-attribution；
0.5.0 线批次再补 board / paths / report-format / relay-chain 四档）：

| 模块 | 住户 |
| --- | --- |
| constants.mjs | 双半共享常量单一来源 |
| failure.mjs | 失败归一化 + 备选链错误分类器（tisitan.21 起仅 broker 消费） |
| archive.mjs | 持久化 turn-failure 档案读取（多帧 zstd 逐帧解压；tisitan.21 起仅 broker 消费） |
| roles.mjs | 角色名册数据 + 路由 helpers（bindings / promptCache 注入）；名册条目 `rosterEntries` 是三处消费面（面板 roster / 编排状态文本 / 系统提示简报）的唯一语义源（0.3.0-tisitan.9 A-05） |
| orchestration.mjs | 单线阻塞编排状态机（tisitan.21 起 broker 独有；tisitan.15-20 为两半同一实现）。0.4.0 线二期起泳道化：`laneOf` 泳道判定表、`readCapacity` 读池容量、`laneCount`/`isLaneFree` 复合忙判定、`dequeueById` lane-aware 出队原语，Orchestration 兼持声明式接力链桶 `chains`（链是账本不是槽位持有者，不参与 laneCount/isBusy）；快照增发 `currentRecords` 全量数组与 `chains` 字段 |
| misc.mjs | 展示字符串 / 默认绑定 / XML 转义 / typeOfAgent / 台账修剪 / prompt 预载 |
| child-registry.mjs | 子代理侧八张桥接登记表 + 跨表不变量（墓碑/收尾/备选两段式登记/复活重建——复活即新世代，同点清备选 once-guard 与 abort 护航两张一次性表）；`createChildRegistry()` 工厂，broker 独有（健康度批） |
| end-attribution.mjs | **subagent/end 归因决策纯函数**（0.3.0-tisitan.12 B5，自 broker 的事件回调抽出）：十条控制出口（ignore / late-duplicate / unattributable / no-owning-orchestration / expected-abort / fallback-in-flight / fallback-evaluation / finalize / suspended-help-hold / report-gate-repair）返回 `{decision, ops, notices, facts}`——改哪些表、对谁说什么、槽位还占不占；写副作用与异步重派链全在 broker 的 dispatcher。`shouldAdvanceQueue` 把「finalizeEnd 不推进队列」从注释协议升级为返回值里的显式口径（R3/R4）。失败附因经 `readFailure` 回调注入（本模块不认识文件也不认识会话）。0.5.0-tisitan.1 起增 **E7' 报告提交制闸门**与第九出口 `report-gate-repair`（判定源 = 成功提交登记而非消息解析，机制见 §2.8）；E8 `suspended-help-hold` 接住 need_help 挂起回合的中场哨 end（台账 status=waiting 时闸门不适用、记录留 waiting） |
| adjacent.mjs | 上游邻接消息面唯一耦合点：`planAdjacentDelivery`（**路由表单一出处**，0.3.0-tisitan.12 N15：route ∈ queue / steer / legacy / unavailable + invoke）+ `sessionEvents` / `canQueueAdjacent`（plan 薄壳）/ `deliverToAdjacent`（委托 plan）/ `reportToParent`，按方法存在性在 alpha.2/3 ↔ alpha.4 间特性探测分界；broker 独有（自 misc 独立，健康度批） |
| board.mjs | 报告板存储层（报告外部化与接力链共用，0.5.0 线一期建、三期 D23 复用）：`writeBoard`（tmp+rename 原子写，覆盖留痕 `.prev.md`）/ `readBoardSlice`（行切片分页，offset/limit 越界钳制；not-found 回错误对象不抛）/ `hasBoardEntry`（同步 existsSync，E7' 闸门兜底判定）。根焊死 `boardRoot()` = `<DSH_HOME>/dsh-my-go/board`，sessionId/childId 双段编码防穿越；broker 独有（机制见 §2.8） |
| paths.mjs | DSH_HOME / MyGO 数据目录路径解析（`dshHome` / `mygoHome` / `sessionsHome`，lib 与 broker 共用，0.5.0 线批次；DSH_HOME 缺席或空串一律回落 `~/.dsh`，空串语义有钉测） |
| report-format.mjs | 报告外部化格式条款（`REPORT_CLAUSE` / `RELAY_CLAUSE` / `REDISPATCH_RESUME_PREFIX`）、report_submit 四字段校验 `validateReportArgs` 与主编回执合成 `buildOwnerSummary`（conclusion + evidence 逐行 + open + 取阅指引）；broker 独有 |
| relay-chain.mjs | 接力链状态机纯函数（`createChain` / `advanceChain` / `matchChainForEnd` / `matchChainForWork` / `validateChainDeclaration` / 链恢复归一 `normalizeRestoredChain` / `RELAY_CHAINS_CAP`）；broker 独有（0.5.0 线三期 D21~D29，机制见 §2.10） |

tisitan.21 起 lib 半只引存储/面板面符号（constants 的名册键集与键名
pattern、paths 的 `dshHome`、roles 的迁移/合并、misc 的 `defaultBindings`），
编排面符号一律
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

### 2.8 报告外部化（reportExternalization，0.4.0 线一期）

子代报告不再走「最后一条消息 + 消息侧解析」，改为 **report_submit 一次交齐
四字段落板 + broker 确定性合成回执**（规划 docs/plans/next-gen-architecture-0.4.0.md
第一期；0.5.0-tisitan.1 起第一代退役）。总闸 `config.reportExternalization`
（缺省 `?? true`，挂载期读一次不做运行时切换；装机 yml 显式 `true`，防回潮
哨兵站岗）：关 = `report_submit`/`report_fetch` 不注册、报告条款不注入、
完工闸门不启用——三条同闸，编排退回 0.3.x 现状。

- **报告条款（REPORT_CLAUSE）**：spawnChild 注入子代 prompt 尾部的提交条款
  （`shared/report-format.mjs` 单源），机械闸措辞：完工 = 调用 `report_submit`
  交齐 report（完整全文）/ conclusion（2-4 句）/ evidence（每项一条裸
  「路径:行号」，或 `test:`/`image:` 前缀行，或 `["无"]`）/ open（无则写
  「无」）；**本条款压制 prompts/*.md 中一切旧的收尾/交付约定**（条款第二行，
  report-format.mjs:27）——运行时人设里的旧收尾口径与之冲突时以此为准。
- **validateReportArgs（机械闸）**：四字段校验唯一出处（report-format.mjs）。
  evidence 逐项按形态正则校验，非法项报错带数组索引，工具层原样回给子代
  原地修正重调；空数组/`["无"]` 归一化为「无」。施工层工种
  （REPORT_SECTION_TYPES = hermes/hephaestus）的 report 正文另过**节标闸**：
  缺「偏差记录」「未验项」任一小节即逐条拒收（写「无」也算合格）。
- **报告板（shared/board.mjs，读写唯一出处）**：路径焊死
  `<DSH_HOME>/dsh-my-go/board/<encodeSegment(sessionId)>/<encodeSegment(childId)>.md`
  （双段编码，穿越与盘符逃逸在编码层消除）；写入 tmp+rename 原子序，正板被
  覆盖时旧板改名 `.prev.md` 留痕（只留最近一版，不参与读取）；读取按行切片
  （offset 0-based、越界钳制并回显实际生效值、字节保真），文件缺席返回
  `{error:'not-found'}` 不抛——主编「读了没货」是正常形态。
- **report_submit（子代侧）**：`isSubAgent` 目录闸（主编会话调用即拒——主编
  永远只经 `report_fetch` 读板）→ validateReportArgs → writeBoard 落板 →
  `markSubmitted` 成功登记（child-registry 持有，E7' 的判定源）→ metrics
  `board-write` 事件（bytes 容量观测）。
- **report_fetch（主编侧）**：切片读板，offset/limit 分页（默认 200 行、
  上限 2000 行）；根焊死取 `exec.agent.id`（主编会话自身）不经参数面，子代
  即便绕过 deny 闸也读不到别家板。
- **E7' 闸门（shared/end-attribution.mjs，第九出口 report-gate-repair）**：
  completed 终局且开关开时过闸。**判定源是成功提交登记，子代最后一条消息
  不参与任何解析**；表（内存登记，跨终局保留）为快路径、板（`hasBoardEntry`
  现算）为兜底——兜底补的病灶：进程重启后内存表必然为空，而报告全文还在板
  上，只查表会把「交过」的儿童误判「从未提交」再发射补发。已交付 → 仍走
  finalize，主编收到的终局摘要是 `buildOwnerSummary` 从已校验字段合成的概要
  （conclusion 全文 + evidence 逐行 + open + 「全文落板，report_fetch
  childId=… 切片取阅」一行；harness 固有完工通知承担外包装）；登记值缺席仅
  板命中 → 显式最小四字段兜底，phase 记 `pass-board-fallback` 与真登记的
  `pass` 分开统计。从未提交 → **report-gate-repair**：once-guard 同步落地 +
  同步预告 + queued 补发（固定措辞 repairPrompt，内容可完全复用已完成工作）；
  补发期间记录留在 currentMap 实体占槽（advance='no'），guard 存续到补发轮
  end 的转裁决——防「补发 → 再补发」无限循环；已补发过仍不交 → 「未交付：」
  前缀转主编裁决落账，不再二次补发。failed 终局永不过闸。
- **收尾落板兜底（persistReportBoard）**：finalize 与 verdict/repair-failed
  路径的优雅降级底座——report_submit 已落板则跳过（幂等），未落过 → 落最后
  消息全文；失败只 warn，绝不改变编排终局流程。红线（刻意取向）：verdict
  路径会给从未成功提交的儿童也落板，此后闸门的板兜底对该 childId 恒真、
  不再发射第二次补发——「骚扰过一次就不再骚扰」，统计口径靠 phase 分开。

### 2.9 读平面并行池（readPoolSize，0.4.0 线二期）

写平面恒单线是地基不动；读平面（explore/librarian）可扩为 N 并发
（规划 docs/plans/read-pool-semantics.md，D5/D7/D8/D9 已裁决）。

- **容量**：`config.readPoolSize`（缺省 `?? 1` = 关闭 = 全局单线现状，逐字节
  等价改造前；2~3 启用，>3 钳 3，非法值回落 1 而非抛错；挂载期读一次）。
  装机 yml 显式 `3`（顶格，防回潮哨兵站岗）。
- **泳道判定（laneOf）**：explore/librarian 入 read lane；looker（多模态
  成本异质）与自定义角色及一切未知名恒 write lane，**不可配**（D8）——
  lane 落在 `beginSpawning` 的 `...extra` 之后强制重算，调用方越权注入
  `lane` 字段会被纠正；revive 从旧台账回槽时按 laneOf 归一化补写（防旧格式
  记录回槽后漏统计，单线锁被一条旧档案架空）。
- **占槽口径**：在 currentMap 即占槽（spawning/waiting/running 同权）。
  `isBusy` 从「size>0」改为复合判定「任何 lane 满」；readCapacity=1 时
  `isLaneFree` 退化为 `size===0`（全局单线，而非「read 1 + write 1 各占
  一槽」——否则默认配置下 write 在跑时 read 会被放行，违背 D5）。
- **lane-aware 上岗**：满池 lane 的队首任务不阻塞另一 lane——出队走
  `dequeueById` 按 id 精确移除（被跳过者原地保留、队列序不重排），lane 内
  仍 FIFO；接力链 hop 与人派 work 同队同律（读池放开的是**跨任务**并发，
  链内恒一次只有一个在飞 hop）。

### 2.10 接力链（relayChains，0.4.0 线三期）

主编声明一串按序执行的子代理跳（2~8），上一跳完工报告全文经 board 直投为
下一跳输入数据块，读→读跳之间免审自动接力，主编上下文零全文过路
（规划 docs/plans/relay-chain-semantics.md，D21~D29 已裁决；状态机纯函数在
shared/relay-chain.mjs，broker 只做 dispatcher）。

- **总闸与依赖**：`config.relayChains`（缺省 `?? false`，挂载期读一次）；
  **依赖 reportExternalization=true**（D23 fail-fast——链的数据面从 board
  直投上一棒全文，报告闸关则 `chain_start` 直接报错指路，绝不静默降级）。
- **声明校验（validateChainDeclaration）**：`hops = [{ agent, prompt?, gate? }]`，
  gate ∈ `auto`（缺省；读→读免审自动接力，prompt 必填预写）/ `review`（本跳
  派发前挂起待主编审阅）/ `sync`（不可逆跳强制同步门）；首跳 gate 恒 auto
  （主编亲笔写的 prompt，无「上一棒产出」可审）；auto 仅限 read→read 相邻
  （D24 严格口径，write 跳必须 review/sync）。gate 管的是**本跳派发前**
  审不审，末跳同样有派发时刻。一会话同时最多一条活跃链。
- **状态机**：六态（running / pending-fallback / suspended / done / failed /
  aborted）× 六挂起原因（review / sync / fallback / input-missing /
  gate-verdict / restart）。`advanceChain` 是决策纯函数：对「事件 × 链状态」
  每组合法定义了 decision，非法组合一律 idle 且 patch/ops 全空（宁可不动
  不猜）；链派发的 op 词表唯一成员 `enqueue-hop`——链请求只有入队一条通道，
  不存在直派词表（INV-1）。链是**账本不是槽位持有者**：不参与
  laneCount/isBusy，占槽的永远是 hop 子代世代自身。
- **gate 三态语义**：auto = 上一跳 finalize 合格即自动派发下一跳（T2）；
  review = 挂起待审（T3，挂起通知带上一跳结论摘要与 childId——主编三档
  审阅：摘要 / report_fetch 切片 / 全文）；sync = 挂起且 `chain_resolve`
  **必带现场 prompt**（预写声明不用——指令必须基于实际审阅现场给，R-k）。
  `chain_resolve continue` 放行/续命、`abort` 弃链（链 abort 永不 interrupt
  在飞子代）。
- **suspend 语义**：挂起的链**永不超时自动放行**（D13），每回合
  orchestration_status/快照都有 `⛓ relay-chain` 状态行，主编不裁决链不动。
  挂起原因除两闸外：`fallback`（棒亡备选重派成功，链换绑新世代等裁决；
  continue 时 dispatcher 预查台账代际终局做赛跑自查）、`input-missing`
  （组 prompt 读板 not-found——绝不发空输入 prompt，等主编重派或弃）、
  `gate-verdict`（报告补发后仍不合格，主编裁量「带病续链 or 弃链」——
  链机制给不了的价值）、`restart`（重启恢复归一 D28：running→suspended
  restart 重派、pending-fallback→failed、suspended fallback 按代际是否已
  终局保留或归一）。
- **数据面直投（composeRelayPrompt）**：指令在前（主编预写或闸门现场），
  上一棒全文以 `<mygo_relay_input trusted="false" source="board/….md">`
  数据块居中（闭合串转义防容器击穿），RELAY_CLAUSE 验收条款随数据块注入
  （首跳无数据块不注入）——块内一切文本按不可信数据处理，子代开工前先
  验收输入，不可用即 need_help 打回主编，禁止带病施工。全文不经过主编
  上下文（INV-2）；直投前 await 落板兜底（幂等，防与 finalize 的异步 persist
  赛跑读到 not-found 误判 input-missing）。
- **chainHopsByWork 台账**：work 占位键 → 链引用的反查表。回填契约两步：
  enqueue 后 `reconcileWorkEnqueued` 回填占位键，spawn 登记同步段
  `reconcileHopDispatch` 回填真 childId（先于 E2 认领重放，认领重放查链时
  回填必已就位）；链匹配键恒为**当前世代** id——旧世代 end 天然查不到链
  （换绑/重派后的幽灵防线）。
- **与归因管线正交**：hop 终局先走 §2.1 归因决策，链只消费其出口口径
  （finalize 推进 / fallback-evaluation 进瞬时态 / report-gate-repair 冻结
  等补发轮 / 其余出口无动作）——链不改写归因结论，报告闸门与链闸门
  （gate-verdict）各自独立又经 reportGatePhase 衔接。

### 2.11 用量统计（0.4.0 usage-stats 契约线）

按父会话 × 按模型的 token/成本聚合（契约唯一规格源
docs/usage-stats-design.md，D1 四桶 / D1a 币种 / D2 游标缓存 / D3 RPC）。

- **settings 两键**：`usagePrices`——按 `{provider}/{model}` 的单价表 dict，
  键名 `PRICE_KEY_PATTERN = /^[^/]+\/.+/`（在**第一个** `/` 处切分，provider
  锚为 `[^/]+`，OpenRouter 式 `openrouter/deepseek/deepseek-chat` 无歧义；
  宽松式会让 `a/b/c` 行在聚合时错归）；每行四桶——input/output 必填（缺一
  整行 fail-closed 丢弃）、cacheRead/cacheWrite 可选（未定价 = 键省略，只记
  token 不计成本），数值 `min(0)` 拒负。`usageCurrency`——整张单价表共用一个
  币种，`'USD' | 'CNY'` 单选默认 USD（混合币种合计随汇率漂移无意义，币种是
  表级元数据不是行级字段）；`getUsage` 响应随价格 join 一并回显。
- **lib 半 getUsage 端点**：面板 RPC 单通道四端点之一（snapshot / listTools /
  getBuiltinPersona / getUsage，shared/constants 单源）。`{parentSessionId}`
  入参 → 台账枚举 children → `lib/usage-aggregator.mjs` 聚合 → 价格实时
  join（R6：token 事实与钱解耦，价格不进聚合缓存，改价不失效聚合状态）→
  组装响应（found / children[] / byModel[] / totals / currency）。
- **聚合引擎（usage-aggregator.mjs，依赖注入纯模块）**：台账驱动按需聚合——
  每 child 游标增量扫描（live store 快路径 + 持久化 zstd 档案主路径，end 时
  live 已摘除是预期不是错误）；LRU 只留最近 4 个被轮询的父（R2）；终态
  child 一次全扫后冻结、复活（continue/forward）即解冻续扫（R3/R4，复活即
  新世代）；**父会话自身用量恒扫**（D6，专用 self 槽：活父走 live 增量、冷父
  走档案，isSelf 合成行排子代之前——合计 = 完整开销）。缺失桶 null 不补 0、
  partial 沿聚合链逐级 OR（面板显 `≥` 下界）。
- **面板**：三视图（按模型 / 按子代 / 合计）共用**同一次** getUsage 响应
  （D4，byModel 服务端预归并、渲染层乘价、单一计费点）；轮询挂既有 600ms
  面板节拍，running 子代数字随轮询实时增长。

### 2.12 配置面迁移（0.5.0-tisitan.3）

设置面从自注册的 `settings.section`「MyGO 编排」整块搬进**官方插件页配置卡**
（`plugins.bundle.config` 槽，实现面 `src/settings-core.js`——两块两列主从：
模型与角色 / 用量单价表，通栏注释区），旧入口连代码退役，配置卡是唯一入口。
配套迁移四件事：

- **三私有端点退役**：`loadSettings` / `saveSettings` / `listModels` 删除
  （lib 半 grep 负向钉死，host-parity 留负向防复活），读写全走宿主
  `settingsScope`——存储形状不再有两处真相。
- **写通道换宿主**：ops 编译面（显式携带才写、脏键 fail-closed、整键删除、
  读回判落盘）唯一一份住浏览器侧 `src/settings-ops.js`（lib 半闭包副本随
  端点删除）；revision 围栏交宿主 `scope.mutate(ops, fence)` 在命名空间写
  队列内执行（检查与写入之间无 TOCTOU 窗），版本号唯一真源 = 宿主
  `describe()`（lib 半 `localRevision` 自造计数删除）。draft 双形状契约与
  未保存防线见 §2.5。
- **模型目录换官方面**：配置卡下拉清单来自 `remote.session.modelCatalog()`
  （与官方 Subagent 卡同源），lib 半 `inject` 去掉 `llm`（唯一消费端点已
  退役）；渠道读失败逐渠道行内标因，与「该渠道真的没模型」可分。
- **宿主半注册姿势**：`settings.register` → `installSection(ctx, ns, schema,
  compositionBase(config), {setSource, onChange})`——cordis 行 config 的
  settings 形状部分（sisyphus / roles / usagePrices / usageCurrency）挂成
  composition base，读面吃活源（provider 被摘自动回落 base）；老宿主无
  installSection 时回落 `register(ns, schema, {base})`，分层语义一致。

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
- **配置卡读写（0.5.0-tisitan.3 换信道）**：读写全走宿主 `settingsScope`
  （namespace `dsh-my-go`），path-ops 编译在 `src/settings-ops.js`（唯一一份，
  lib 半闭包版随 `saveSettings` 端点退役）；`bindings` 合并仍归 lib 半。
  渠道与模型两栏是 input + datalist **可手填组合框**（清单在场点选、缺席直接键入，
  空值 = 跟随 Sisyphus），清单来自宿主 `remote.session.modelCatalog()`——与官方
  Subagent 卡同源，读失败的渠道仍逐渠道进 `errors` 行内提示，不再把「清单没拉上来」
  渲染成「这个渠道没有模型」。dirty / beforeunload / revision 围栏见 §2.5。
- **轮询的三道闸（tisitan.8 E5/A-02 + E10/B-03）**：① **in-flight 门**——
  上一发快照没回来时后续 tick 一律不重入（慢宿主下 600ms 定频会自我堆叠在飞
  请求）；② **失败退避**——连续失败按 600 → 1500 → 3000ms 抬升（封顶），
  成功即复位到基准档；③ **迁移点各留一行 console.warn**——只在桥状态翻转时
  打，绝不被自己的 600ms 节奏刷屏。桥故障分两型提示：host 端 RPC 根本没应答
  （未激活/仍在启动）与 host 在、桥函数抛错（`internal`，附原因），文案与
  配色不同——前者该等，后者该查。
- **用量统计区（usage-stats 契约线）**：面板新增「用量统计」区
  （`src/usage-panel.js` 纯展示不发 RPC），轮询挂既有 600ms 节拍、每次节拍
  搭载一发 `getUsage`（panel-tree.js），折叠该区即停发；口径、三视图与
  partial 语义见 §2.11。RPC 失败 join 既有退避梯自愈。
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
- **配置卡**：client 半（`src/client.js`）把配置卡注入官方插件页的
  `plugins.bundle.config` 槽（key = 包名 `dsh-my-go`），并只在宿主 describe 真的在
  服务该命名空间时挂载、掉了立刻撤；settings 命名空间由 host 半（`lib/index.js`）以
  `installSection` 注册（cordis 行 config 的 settings 形状部分是 composition base，
  老宿主回落 `register(ns, schema, {base})`），broker 半只读取。
  编排面板的两个非设置 slot（`shell.overlay` / `sidebar.footer.action`）与本单无关，
  原样保留。每工种绑定五字段：provider / model / reasoningEffort /
  dsv4p0813 / fallbacks（与 §2.2 一致；UI 经 tisitan.19 链编辑器合并编辑
  主选 + 备选链）。tisitan.13-19 UI 增量：自定义角色编辑器（roles dict
  增删改 + 导入导出，tisitan.14）、内置工种人设覆盖（persona textarea +
  载入文件默认，tisitan.15）、模型优先级链编辑器（#1 主选 + #2..N 备选，
  一键扶正，
  tisitan.19）。0.5.0-tisitan.3 起信息架构重画为两块两列主从（§2.12），
  第二块即用量单价表（`src/usage-price-rows.js` / `usage-prices-editor.js`：
  四桶 + 表级币种旋钮，键名即时校验），`usage-views.js` 承接面板三视图的
  派生纯函数（价格索引 / 成本 / 紧凑格式化 / 空态）。

## 4. 交付物

| 目录 | 内容 |
| --- | --- |
| `preset/` | dsh-my-go agent preset（由 lib 同步到 `~/.dsh/.agent-presets/dsh-my-go/`； tisitan.15 起含 shared/ 共享源，健康度批起共八模块，0.3.0-tisitan.12 起共九模块（+ end-attribution），0.5.0 线批次再补 board / paths / report-format / relay-chain，现共十三模块） |
| `lib/` | host 半（global 层插件 `index.js`）：settings 命名空间 installSection 注册 + 活源读面 / RPC（快照出口裁剪 + 结构化名册 + 端点自带 try + `getUsage` 用量端点；0.5.0-tisitan.3 起 loadSettings / saveSettings / listModels 退役）/ preset 同步器（版本+内容摘要 marker，逐文件与镜像两种语义）；tisitan.21 起零编排面（台账持久化归属 broker 半） |
| `src/` | client 半源码：配置卡（含 ops 编译层与样式表）、overlay 树状图面板、用量面板（三视图纯展示 + 单价表编辑）、自动跳转、守卫纯函数。**纯构建输入——0.3.0-tisitan.11（D-15）起不再进发布包**（运行期只加载 `dist/client.js`，lib/preset/prompts 对 src 零引用已 grep 核实） |
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
