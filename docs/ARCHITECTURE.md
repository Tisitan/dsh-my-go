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

> 图中模型仅为能力档位建议；插件不内置任何默认模型（tisitan.7 起默认
> 空绑定，全部继承环境路由），具体模型由使用者在设置中按工种配置。

- **所有子智能体（叶子）不直接通信**，必须经由 Sisyphus 中转。
- **执行模式**：单线阻塞，同一时段只能有一个子智能体运行；tisitan.10 起按
  编排会话隔离——每个父会话一条独立流水线，互不排队。
- **Sisyphus = 主会话**：用户对话所选模型即 Sisyphus 的模型；它不单独创建。
- **花名册可扩展**：七个内置工种之外，settings `roles` dict 支持自定义角色
  （键名 `^[a-z][a-z-]*$`，可绑定模型/人设/工具过滤），派发面按活名册校验
  ——扩展入口见 §2.4 与设置页角色编辑器。
- **子智能体 = DSH continuable subagent**：通过 `subagents.startContinuable`
  创建，持久化到独立 Session，支持后续 `followup`（对应 continue）。

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
| `need_help`（子→Sisyphus） | broker 注册给子智能体的工具；调用后挂起自己，通过 `reportFrom` 把请求注入父会话，并生成 helpRequestId | `subagents.reportFrom` + broker 状态 |
| `go_work`（Sisyphus→新子智能体） | broker 注册给 Sisyphus 的工具；`subagents.startContinuable` 创建空上下文子智能体，返回 childId | `subagents.startContinuable` |
| `continue`（Sisyphus→挂起子智能体） | `subagents.followup(parent, childId, content)` 发送驳回/追问 | `subagents.followup` |
| `forward`（Sisyphus 转发 need_help） | 读 helpRequest 记录 → 对既有 childId 用 continue，对类型用 go_work | broker 状态 + followup/startContinuable |
| 结论（子→Sisyphus） | 子智能体最后输出经 `subagent/end`（或 reportFrom）注入父会话，带 conclusionId | `subagent/end` 事件 |

> 另有 broker 注册给 Sisyphus 的两个观测工具（不属五种通信）：
> `orchestration_status`（编排状态全景 + 花名册简报区）与
> `list_subagents`（已派子代理清单：类型/childId/状态/最近一次 prompt）。

### 2.1 单线阻塞与会话隔离

编排状态按编排会话分桶维护（tisitan.10 起）：`orchestrations:
Map<parentSessionId, Orchestration>` 惰性创建——每个 Sisyphus 会话独立一条
流水线（队列/槽位/求助单/历史互不共享）；另有 `childOwner:
Map<childId, parentSessionId>` 路由表把子代理侧事件与工具调用送回属主流水线。
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
- `continue` 唤醒挂起/已结束的子智能体（`followup`）；对已结束的子智能体会
  重新入册（revive 回 currentMap + 恢复类型登记），保持单线阻塞与结论回收。
- **属主路由与竞态墓碑（tisitan.10）**：`subagent/end` 经 `childOwner` 直达
  属主实例（未登记则全局扫描活记录/历史兜底）；`agent/disposed` 恒先于 end
  到达的竞态由有界墓碑表（`disposedTypes`，cap 50）+ 宽限期兜底消化——宽限
  期内 end 正常落账，真缺席才清槽推进队列。多个 spawning 占位并存时仅在
  「恰有一个可归因」时绑定，歧义即留痕忽略（绝不串号）。
- **台账持久化（tisitan.8）**：history（done/failed，上限 200 条）防抖落盘
  `<DSH_HOME>/dsh-my-go/orchestration-ledger.json`，插件加载时读回——进程
  重启后 `continue` 已完工 childId 仍能命中台账（revive → harness coldResume
  续聊），而不是报 unknown sub-agent id。tisitan.10 起落盘形状为
  `{ version: 2, parents: { [parentSessionId]: history[] } }` 分桶；v1 旧档
  载入 'legacy' 兜底桶，跨重启经全局扫描命中。
- **父会话补充通知（tisitan.8）**：harness 的双通知（reported/settled）是
  dsh-subagent 硬编码模板，插件不可抑制/改写；broker 经公开 API
  `parent.inject`（非唤醒）自行注入两条低频高价值短通知——队列上岗映射
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
  用 `llm.listModels` 校验真实存在才应用，且只缓存非空查询结果——瞬时
  失败不留负缓存）；`persona` 用该类型的 prompt 覆盖。
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
- **晋升**：监听 `session/event`，首次 `tool/call` 或首次 `turn/end`
  （模型产生首轮响应）即晋升，放开完整工具目录与全部 prompt section。
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

### 2.6 共享源层 preset/shared/（tisitan.15；tisitan.21 起编排面 broker 独有）

broker.mjs（preset 层）与 lib/index.js（global 层）import 同一份
`preset/shared/` 六模块（tisitan.15 净消 1,251 行镜像双写）：

| 模块 | 住户 |
| --- | --- |
| constants.mjs | 双半共享常量单一来源 |
| failure.mjs | 失败归一化 + 备选链错误分类器（tisitan.21 起仅 broker 消费） |
| archive.mjs | 持久化 turn-failure 档案读取（多帧 zstd 逐帧解压；tisitan.21 起仅 broker 消费） |
| roles.mjs | 角色名册数据 + 路由 helpers（bindings / promptCache 注入） |
| orchestration.mjs | 单线阻塞编排状态机（tisitan.21 起 broker 独有；tisitan.15-20 为两半同一实现） |
| misc.mjs | 展示字符串 / 默认绑定 / XML 转义 / typeOfAgent / 台账修剪 / prompt 预载 |

tisitan.21 起 lib 半只引存储/面板面符号（constants 的名册键集与键名
pattern、roles 的迁移/合并、misc 的 `defaultBindings`），编排面符号一律
不引入；npm 导出面同步切除编排 re-export（消费方直引 `preset/shared/`）。

**铁律**：零 `@deepseek-ai/*` import、零 ctx 触碰（node: builtins 允许），
依赖一律显式注入参数。**promptCache 双根**（历史形态，现仅 broker 消费）：
broker 半以 preset 装配目录为根读 prompts/，lib 半曾以
`~/.dsh/.agent-presets/dsh-my-go` 为根——shared 层只认注入的
`loadPrompt`。`ensurePresetInstalled`
同步时校验 shared/ 存在性（broker 相对 import 依赖 preset 整树复制）。
host-parity 断言 tisitan.21 起重写为**反向 parity**：lib 编排标记 grep=0
哨兵（编排代码加回 lib 立即红）+ broker 原计数锁 + import 存在性 +
ESM 同一性 + 行为直测（逐字比源码的字符串对称断言早已退役）。

### 2.7 typeOfAgent 统一与养护上限（tisitan.15）

- **typeOfAgent（工种识别，misc.mjs 单一源；tisitan.21 起仅 broker
  消费）**：sessionTypes 活登记优先，会话 label（`dsh-my-go:<agentType>`
  前缀）正则兜底；`agent/request` waterfall 的绑定 / effort 覆盖与
  DSV4P0813 assemble 识别同走此函数——修复 cold-resumed 子代理（进程
  重启后活登记已失）模型绑定静默失效的真 bug。**双侧契约**（历史名称，
  现即 broker 单边契约）：自定义角色键名 schema 强制
  `^[a-z][a-z-]*$`，与 label 识别正则同构（角色名 ⊆ `[a-z-]+`），
  任意名册角色都能从 label 还原。
- **台账与槽位养护**：编排台账 `parents` 分桶超 200 桶时按桶内最新
  updatedAt 修剪（load / save 双点接入）；`currentMap` 超 500 条滞留
  记录时 `beginSpawning` 路径闸拒绝新占位——防长生命周期进程失控泄漏。

## 3. UI 适配

- **overlay 树状图面板**：`shell.overlay` 浮层显示子 Agent 运行情况
  （current / queue / help / history），由侧栏底部 🧭 按钮开关，
  点击节点可跳转子会话（经 host 半的 connection.rpc 快照桥轮询）。
  队列节点渲染 work-id 占位；快照桥未就绪时显示「编排桥未就绪」提示态
  而非静默空白（tisitan.8）。tisitan.10 起面板摊平展示所有编排会话的
  条目，parents 多于一个时每条附会话短后缀区分。tisitan.15 起面板附
  **花名册常驻区**（可折叠）：快照桥下发的 rosterLines 展示可派角色与
  绑定摘要，host 未就绪时显示「花名册不可用」提示态。
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
| `preset/` | dsh-my-go agent preset（由 lib 同步到 `~/.dsh/.agent-presets/dsh-my-go/`； tisitan.15 起含 shared/ 共享源六模块） |
| `lib/` | host 半（global 层插件 `index.js`，391 行）：settings 命名空间 / RPC / preset 同步器；tisitan.21 起零编排面（台账持久化归属 broker 半） |
| `src/` | client 半：设置页、overlay 树状图面板、自动跳转（构建产物进 `dist/`，发布包随附） |
| `test/` | node:test 单测与桥接测试（npm test 入口） |
| `scripts/` | 构建与运维脚本：`build-client.mjs`（esbuild 打包 client 半）、`dump-session.mjs`（zstd 会话档案 CLI 转储） |
| `docs/legacy-broker-ts/` | ⚠️ 归档的 TS 参考实现（原根目录 `broker/`， tisitan.15 移入；见其 README），停维护、不参与构建与运行 |
| `prompts/` | 每个智能体的 persona/prompt 文件 |
| `docs/` | 本文档 |
| `README.md` | 项目说明 |

## 5. 安装（npm 插件流程）

1. `dsh plugin --profile web add dsh-my-go@latest --config.minimumReleaseAge=0`
   ——npm 包自带 `cordis.patch.yml`（`dsh.bundle.patch`），安装后 host
   插件（`lib/index.js`）自动挂载为 profile 层。
2. 重启 `dsh web`；lib 的 `ensurePresetInstalled()` 会按版本标记把
   `preset/` + `prompts/` 同步到 `~/.dsh/.agent-presets/dsh-my-go/`
   （幂等：同版本不覆盖手工修改）。
3. 新会话选择「MyGO!!!!! 模式」预设，开始编排。
