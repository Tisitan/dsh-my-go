# dsh-my-go（Tisitan fork）架构导览

> 面向使用者的「逻辑图 + 文件目录 + 机制映射」说明：系统改成什么样了、
> 每个功能由哪个文件通过什么原理实现。配套修复台账见 [CHANGELOG.md](../CHANGELOG.md)。

## 一、全景逻辑图

```
                        ┌──────────────────────── 同一 Node 进程（同一棵 cordis fiber 树）────────────────────────┐
                        │                                                                                        │
 用户 ──► DSH WebUI ──► │  【client 半】dist/client.js（React 插件）                                            │
 （浏览器）             │   ├─ 🧭 侧栏按钮 ──► shell.overlay 树状图面板（current/queue/help/history）            │
                        │   ├─ 设置页「MyGO 编排」（8 工种 × provider/model/effort/dsv4p0813）                   │
                        │   └─ 600ms 轮询 ──┐                                                                   │
                        │                   ▼ RPC call('/dsh-my-go', endpoint)                                  │
                        │  【host 半】lib/index.js（profile bundle，global 层注册）                              │
                        │   ├─ connection.rpc.handle('/dsh-my-go')                                             │
                        │   │    ├─ snapshot ──► 优先读 Symbol.for('dsh-my-go.snapshot') 全局桥 ──────┐         │
                        │   │    │                  （桥不在 → 回落自身状态机，非 MyGO 会话用）        │         │
                        │   │    ├─ loadSettings / saveSettings ──► settings 命名空间 'dsh-my-go'    │         │
                        │   │    └─ listModels ──► llm.listProviders/listModels                      │         │
                        │   ├─ ensurePresetInstalled：按版本标记同步 preset/ 到 ~/.dsh/.agent-presets/│         │
                        │   └─ fallback 编排全家桶（工具+状态机，非 MyGO 会话生效）                    │         │
                        │                                                                          │ 实时读    │
                        │  【agent 半】preset/tools/broker.mjs（MyGO preset 装配时加载，preset 层注册）◄┘（零副本）│
                        │   ├─ Orchestration 状态机（编排真源）                                      │         │
                        │   │    currentMap(单槽) / queue(FIFO) / helpRequests / history(≤200)      │         │
                        │   │        ▲ 每次迁移 bump() ──► 发布 latestSnapshot 到 Symbol.for 全局桥 ──┘         │
                        │   ├─ 6 工具：go_work / continue / need_help / forward /                                │
                        │   │   orchestration_status / list_subagents（preset 层覆盖 global 同名）             │
                        │   ├─ systemPrompt 注入：Sisyphus persona + 编排规则（主会话）/ 工种 persona（子代理）  │
                        │   ├─ agent/request waterfall：按工种绑定 provider/model/reasoningEffort              │
                        │   ├─ agent/created：拓扑闸（子代理禁派生）+ skill 隐藏（主会话）                       │
                        │   └─ subagent/end：结论落账 + 队列推进；agent|session/disposed：状态回收             │
                        │                   │                                                                    │
                        │                   ▼ ctx.subagents.startContinuable / followup / reportFrom             │
                        │  【DSH 内核】subagents 服务 ──► 7 种 continuable 子代理会话（独立 Session，可续接）     │
                        └────────────────────────────────────────────────────────────────────────────────────────┘

 工具可见性规则（dsh-scope 合并语义）：global 层（lib 注册）+ preset 层（broker 注册），
 同名时「最近的 scope 胜出」→ MyGO 会话用 broker 的工具；其他会话用 lib 的工具。互不串台。
```

## 二、文件目录（fork 现状）

```
dsh-my-go/
├── package.json              # 包声明；版本 0.2.3-tisitan.7；test = 冒烟 + 单测
├── cordis.patch.yml          # bundle patch：dsh plugin add 后自动把 lib 挂进 profile（global 层）
├── CHANGELOG.md              # fork 修复台账（相对上游的全部差异）
├── README.md                 # 项目说明（含 fork 标识段）
│
├── lib/
│   └── index.js              # 【host 半】settings 命名空间 + RPC 桥 + preset 同步器
│                             #   + global 层 fallback 编排（工具/状态机/模型绑定）
│
├── preset/                   # agent preset「MyGO!!!!! 模式」（被同步到 ~/.dsh/.agent-presets/）
│   ├── preset.yml            #   preset 元信息（名称/排序）
│   ├── agent.cordis.yml      #   agent 平面组合：DSH 官方工具行 + 本地 broker 行 + tool-mask 行
│   ├── tool-mask.mjs         #   工具屏蔽：按清单藏环境特定工具（默认 7 个示例，
│   │                         #     可用 agent.cordis.yml 行的 config.deny 覆盖）
│   └── tools/
│       └── broker.mjs        #   【agent 半 · 编排真源】状态机 + 6 工具 + prompt 注入
│                             #     + 模型绑定 + 拓扑闸 + 快照桥发布（★ 大部分修复在这里）
│
├── prompts/                  # 8 个工种 persona（broker.mjs 运行时读取并注入）
│   ├── sisyphus.md           #   总调度+质检官（persona 段进 deployment:persona，
│   │                         #     「## 编排规则」之后进 dsh-my-go:orchestration section）
│   ├── hermes.md             #   快速执行（指令明确的体力活）
│   ├── explore.md            #   快速检索（只读）
│   ├── librarian.md          #   文档查询
│   ├── looker.md             #   多模态识别
│   ├── hephaestus.md         #   代码编写
│   ├── prometheus.md         #   需求规划（流程开始一次）
│   └── oracle.md             #   疑难/极端复杂兜底
│
├── src/
│   └── client.js             # 【client 半源码】面板/设置页/自动跳转（React.createElement 手写）
├── scripts/
│   └── build-client.mjs      # esbuild 打包：src/client.js → dist/client.js（CJS + ModuleLoader 包装）
├── dist/                     # 构建产物（gitignore，发布/构建时生成）
│
├── test/
│   ├── apply.mjs             # 冒烟：模块可加载 + client 可解析 + dist 存在
│   ├── orchestration.test.mjs# 状态机 14 单测（占位占锁/revive/requeue/幽灵求助/上限…）
│   └── bridge.test.mjs       # apply 级集成 9 例（快照桥/队列重试/disposed 竞态/
│                             #   派发模型绑定/settings 重基线）
│
├── broker/                   # ⚠️ 归档的 TS 参考实现（见 broker/README.md），不参与构建运行
├── docs/
│   ├── ARCHITECTURE.md       # 原始架构设计（已与实现同步）
│   └── FORK-GUIDE.md         # 本文档
└── AGENTS.md                 # 编排规格书（设计哲学 + 通信协议 + 禁止事项）
```

## 三、机制映射（什么功能 → 哪个文件 → 怎么实现）

### 调度与编排

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 派发子代理（go_work） | `preset/tools/broker.mjs` `dispatchWork()` | 检查 `isBusy()` → 忙则 `enqueue()` 排队（返回 `work-*` 占位 id）；闲则 `beginSpawning()` 占位占锁（同步原子）→ `ctx.subagents.startContinuable()` 创建持久子会话 → `bindChild()` 绑定真实 childId |
| 单线阻塞 | `broker.mjs` `Orchestration.currentMap` | 单槽 Map；`isBusy()` 到 `beginSpawning()` 之间无 await，Node 单线程下天然原子 |
| 队列推进 | `broker.mjs` `advanceQueue()` | `subagent/end` 或 spawn 失败时触发：dequeue 队首 → dispatch；**失败自动 `requeueHead()` 回补**（fork 修复：任务不再蒸发） |
| 求助挂起（need_help） | `broker.mjs` need_help 工具 | `suspend()` 标记 waiting + `reportFrom` 把求助单注入 Sisyphus 下一步。注：台账层挂起，无强制 interrupt（评估结论见第五节） |
| 驳回/追问（continue） | `broker.mjs` continue 工具 | **先 `followup` 投递成功，后落账**（fork 修复时序病）；目标 waiting 则 resolveHelp+resume；目标已结束则 `revive()` 重新入册 + 恢复 sessionTypes 登记（fork 修复：结论不再丢失、单线不再被打破） |
| 转发（forward） | `broker.mjs` forward 工具 | 同上「先投递后销账」；target 为工种名时等效 go_work，为 childId 时等效 continue |
| 结论回流 | DSH 内核通知 + `broker.mjs` `subagent/end` | 子会话结束时内核通知父会话（broker 不重复注入）；broker 在 `subagent/end` 里 `finish()` 落账 → 清该子的求助单 → 删 sessionTypes → 推进队列。快速死亡的子会话（resolve 前就 end）归因到唯一 spawning 占位记录（fork 修复竞态冻结） |
| 状态回收 | `broker.mjs` `agent/disposed` / `session/disposed` 钩子 | 子代理被销毁但错过 end 事件：兜底清槽防队列冻结；Sisyphus 会话被删：丢弃其排队任务 |

### 模型与提示词

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 按工种绑模型 | `broker.mjs` `dispatchWork()`（创建时 `agentOptions`）+ `agent/request` waterfall（请求时兜底） | 创建前 `modelExists()` 用 `llm.listModels` 验证模型真实存在才应用；只缓存非空结果（fork 修复负缓存中毒） |
| reasoningEffort | `broker.mjs` `supportedEfforts()` | 查 DSH 模型目录 `llm.resolveModelInfo`，**仅当模型实际支持该档位才设置**，否则留空走适配器默认（拒绝硬映射） |
| Sisyphus persona/规则 | `broker.mjs` 两个 `systemPrompt.section` | 读 `prompts/sisyphus.md`，按 `## 编排规则` 切两半：前段进 `deployment:persona`、后段进 `dsh-my-go:orchestration`；子代理会话返回空串（靠 parentSession 判定） |
| 子代理 persona | `broker.mjs` `dispatchWork()` | 把对应 `prompts/<type>.md` 全文包进 `<system-reminder>` 随首条 prompt 注入 |
| DSV4P0813 两阶段 | `broker.mjs` `system-prompt/assemble` 监听 | 开启该开关的工种：phase-1 只放行 persona section + 白名单工具（`bash/pwsh/read/write/edit/glob/grep`，fork 已修正为 DSH 真实工具名）；首次 tool call 或 turn 结束后晋升放开全部 |
| skill 隐藏 | `broker.mjs` `agent/created` | 主会话 `tools.restrict({ deny: ['skill'] })`，使 skill catalog 注入守门失效，节省主会话上下文；子代理保留 |

### 安全与边界

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 编排权限 | `broker.mjs` `canOrchestrate()` | go_work/continue/forward 仅「无 parentSession 的会话」可调（工具层强制，不靠 prompt 自觉）；need_help 仅被跟踪的子代理可调 |
| 星型拓扑闸（fork 新增） | `broker.mjs` `agent/created`（tisitan.3 起 lib 不再挂钩——global 层会误伤非 MyGO 会话） | 子代理在工具目录层被摘除 `subagent/subagent_fork/workflow/ralph/go_work/continue/forward`——无法私自派生孙代，也无法直接调度（与运行时守卫双保险） |
| 沙箱外执行通道 | need_help `intent=execute` | 子代理把被拒命令发给 Sisyphus 代执行。注意：这是设计的权限提升通道，缓解靠 Sisyphus 的质检 prompt |

### UI 与配置

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 树状图面板 | `src/client.js` `TreePanel` | `shell.overlay` 浮层 + 侧栏 🧭 开关；600ms 轮询 RPC `snapshot` 端点，seq 变化才重渲染（fork 修复：开关脱钩 + force bailout） |
| 快照桥（fork 新增） | `broker.mjs` 发布 ↔ `lib/index.js` RPC 消费 | broker 把 `() => latestSnapshot` 挂到 `globalThis[Symbol.for('dsh-my-go.snapshot')]`；lib 的 RPC handler 优先实时读取（零副本），桥不在则回落自身状态机 |
| 自动跳转 | `src/client.js` 定时器 | 子代理 running → `sessions.openSubagent()` 跟跳子会话；结束后 `sessions.open(parentSessionId)` 跳回（fork 补全跳回闭环 + 快照补上 parentSessionId） |
| 设置页 | `src/client.js` `SettingsPage` ↔ `lib/index.js` RPC | 8 工种 × 4 字段；loadSettings 失败时 `draft=null` 禁止保存（fork 修复：不再一键清空配置）；saveSettings 空值 unset、显式 false 可表达（fork 修复） |
| settings 合并 | `broker.mjs` / `lib/index.js` | 永远从 `baseBindings`（默认值+插件 config）起算合并 stored（fork 修复：WebUI 取消配置可回落）；`||` 语义统一（空串=未设置） |
| preset 同步 | `lib/index.js` `ensurePresetInstalled()` | 版本标记文件 `.dsh-my-go-version`：版本不变则跳过（fork 修复：不再每次强制覆盖用户手改） |

### 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| 冒烟 | `test/apply.mjs` | 模块加载/导出面/client 语法/dist 存在 |
| 单测 | `test/orchestration.test.mjs` | 状态机 14 例：占锁原子性、bindChild（含缺位告警）、finish 清求助、suspend/resume、revive、requeueHead、dropQueuedFor、dropQueuedFailed、history 200 上限、record/followupPrompt |
| 集成 | `test/bridge.test.mjs` | mock cordis ctx 跑 `broker.apply()` 共 9 例：Symbol.for 快照桥 ×2、队列回补重试/超上限放弃/disposed 竞态 ×4（tisitan.6）、dispatchWork 模型绑定解析 ×2、settings 重基线 ×1（tisitan.7） |

## 四、fork 与上游的关系

- `upstream` = [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go)（本 fork 基于 v0.2.3 @ cf2d802）
- 版本号规则：`上游版本-tisitan.N`；完整差异台账见 [CHANGELOG.md](../CHANGELOG.md)
- 同步策略：定期 `git fetch upstream`，交集分析上游新提交与本 fork 补丁面，定点合并

## 五、评估过但**未实施**的升级（含结论）

| 候选 | 结论 | 原因 |
|---|---|---|
| need_help 改真 interrupt 硬挂起 | **暂缓** | `ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parentAgent })` API 存在（dsh-subagent/lib/types/continuation.d.ts:232），但中断时机（reportFrom 送达前杀回合会丢求助单）、恢复后模型如何感知被取消的 tool call，均需运行时实测验证。当前软挂起下：乱跑的子代理无法破坏队列（单线由状态机强制），仅浪费自身 token，残余风险可接受 |
| isolate 服务 + `agentPresets.serviceFor` 官方桥 | **暂缓** | 需把 broker 拆成 isolate realm 服务行 + root 消费行（mount 审计强制 preset 服务入 isolate，而 broker 的 systemPrompt.section 必须留在 agent scope），重构面大且挂载行为无法离线验证。当前 Symbol.for 桥在拉取路径上功能等价（同进程、零副本、实时读） |
| projection 推流替代 600ms 轮询 | **未来方向** | `session.append('mygo/state', 全量快照)` + `sessionProjections.register` + client `useProjection`（dsh-goal 官方范式），可解锁推流与冷会话回放。需 session 级事件写入，等运行时环境验证后实施 |

## 六、已知陷阱 / 限制

- **合并语义无法表达「完全不指定模型」**：settings 合并把空串/缺省视为
  「未设置」并回落基线（`baseBindings` = 默认值 + 插件 config）。若
  `config.bindings` 给某工种配了模型，在 WebUI 清空该字段只会回落到
  config 值，无法回到「不指定」；要彻底不指定，需同时摘掉 config 里的绑定。
- **`bindSisyphus: true` 是全局副作用**：`agent/request` waterfall 会对
  「未登记工种的会话」套用 sisyphus 绑定——lib 半注册在 global 层，开启后
  连非 MyGO 会话的主模型也会被覆盖。默认关闭，勿轻开。
- **默认绑定已清空（tisitan.7 起）**：`defaultBindings()` 七工种均为 `{}`，
  不内置任何模型/渠道名，子代理完全继承环境默认路由。需要按工种分流
  必须自行配置（WebUI 设置页「MyGO 编排」或 `~/.dsh/settings.yaml`，
  示例见 README「工种模型绑定」），否则所有子代理与 Sisyphus 同路由。
- **tool-mask 默认清单只是示例**：`preset/tool-mask.mjs` 的 `DEFAULT_DENY`
  里的 7 个 `mcp__vcp__*` 工具名来自特定部署；你的环境大概率没有这些
  工具（按名跳过、仅 warn）。按需在 `agent.cordis.yml` 的 tool-mask 行
  用 `config.deny` 覆盖成你自己的清单。
- **双通知（reported + settled）是机制性重复，不可抑制**：子代理完工时
  父会话会收到两条通知——子代理自己的 `reportFrom`（reported）与
  dsh-subagent 的 `notifySettlement`（settled）。两者都是 harness 硬编码
  模板（dsh-subagent/lib/index.js 的 `deliverReport` / `notifySettlement`），
  插件层无法抑制或改写，只能并存。tisitan.8 的补充通知（队列上岗映射 /
  失败附因）因此走自己的 `plugin/notice` inject 通道，不去碰 harness 模板。
- **harness 通知层丢失 error.message**：`subagent/end` 载荷的
  `stopReason` 只有 kind（completed/error/...），不带 error 字段；完整的
  `error.message` / `code` 只存在于子会话档案的 `turn/end` 事件
  `reason.error` 里。broker 的兜底路径是经 `sessions` 服务 API
  （`sessions.get(childId).events`）倒序读最后一条 `turn/end`——不要手解
  `session.jsonl.zstd` 多帧；读档失败（子会话已退出 live store）静默退回
  无附因。
