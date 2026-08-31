# dsh-my-go（Tisitan fork）架构导览

> 面向使用者的「逻辑图 + 文件目录 + 机制映射」说明：系统改成什么样了、
> 每个功能由哪个文件通过什么原理实现。配套修复台账见 [CHANGELOG.md](../CHANGELOG.md)。

## 一、全景逻辑图

```
                        ┌──────────────────────────────────────────────────────────────────────────────────────────┐
                        │                                                                                          │
 用户 ──► DSH WebUI ──► │  【client 半】dist/client.js（React 插件）                                               │
 （浏览器）             │   ├─ 🧭 侧栏按钮 ──► shell.overlay 树状图面板（current/queue/help/history/roster）     │
                        │   ├─ 设置页「MyGO 编排」（内置 8 工种绑定五字段 + persona 覆盖 + 角色 CRUD               │
                        │   │   导入导出 + 工具屏蔽双列表 + 全卡片手风琴）                                         │
                        │   ├─ tisitan.15 拆分：panel-tree / settings-core / roles-editor /                        │
                        │   │   tool-mask-editor / client-constants（client.js 57 行装配层）                       │
                        │   └─ 600ms 轮询 ──┐                                                                      │
                        │                   ▼ RPC call('/dsh-my-go', endpoint)                                     │
                        │  【host 半】lib/index.js（profile bundle，global 层注册）                                │
                        │   ├─ connection.rpc.handle('/dsh-my-go')                                                 │
                        │   │    ├─ snapshot ──► 优先读 Symbol.for('dsh-my-go.snapshot') 全局桥 ──────┐            │
                        │   │    │                  （桥不在 → 回落自身状态机，非 MyGO 会话用）        │           │
                        │   │    ├─ loadSettings / saveSettings ──► settings 命名空间 'dsh-my-go'    │             │
                        │   │    ├─ listModels ──► llm.listProviders/listModels                      │             │
                        │   │    └─ listTools ──► tools.schemas() 全局花名册，服务端滤保留名 │                     │
                        │   ├─ ensurePresetInstalled：按版本标记同步 preset/ 到 ~/.dsh/.agent-presets/│            │
                        │   └─ fallback 编排全家桶（工具+状态机，非 MyGO 会话生效）                    │           │
                        │                                                                          │ 实时读        │
                        │  【agent 半】preset/tools/broker.mjs（MyGO preset 装配时加载，preset 层注册）◄┘（零副本）│
                        │   ├─ Orchestration 状态机（编排真源）                                      │             │
                        │   │    currentMap(单槽,≤500) / queue(FIFO) / helpRequests / history(≤200) │              │
                        │   │        ▲ 每次迁移 bump() ──► 发布 latestSnapshot 到 Symbol.for 全局桥 ──┘            │
                        │   ├─ 6 工具：go_work / continue / need_help / forward /                                  │
                        │   │   orchestration_status / list_subagents（preset 层覆盖 global 同名）                 │
                        │   ├─ systemPrompt 注入：Sisyphus persona + 编排规则（主会话）；                          │
                        │   │   子代理 persona/toolFilter 走 spawn 官方通道（tisitan.14）                          │
                        │   ├─ 双半共享源 tisitan.15：import preset/shared/（状态机/失败分类/                      │
                        │   │   档案读取/名册路由/工种识别/台账养护，两半同一实现）                                │
                        │   ├─ agent/request waterfall：按工种绑定 provider/model/reasoningEffort                  │
                        │   ├─ agent/created：拓扑闸（子代理禁派生）+ skill 隐藏（主会话）                         │
                        │   └─ subagent/end：结论落账 + 队列推进；agent|session/disposed：状态回收                 │
                        │                   │                                                                      │
                        │                   ▼ ctx.subagents.startContinuable / followup / reportFrom               │
                        │  【DSH 内核】subagents 服务 ──► continuable 子代理会话（内置七工种 + roles 自定义名册）  │
                        └──────────────────────────────────────────────────────────────────────────────────────────┘

 工具可见性规则（dsh-scope 合并语义）：global 层（lib 注册）+ preset 层（broker 注册），
 同名时「最近的 scope 胜出」→ MyGO 会话用 broker 的工具；其他会话用 lib 的工具。互不串台。
```

## 二、文件目录（fork 现状）

```
dsh-my-go/
├── package.json              # 包声明；版本 0.2.3-tisitan.20；test = 冒烟 + 189 例单测
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
│   ├── tool-mask.mjs         #   工具屏蔽：三级优先级解析（config.deny >
│   │                         #     settings toolMask.deny > 空 DEFAULT_DENY），
│   │                         #     挂载时读一次、只对新会话生效
│   ├── shared/               #   【共享源 tisitan.15】constants / failure / archive /
│   │                         #     roles / orchestration / misc 六模块：双半 import
│   │                         #     同一实现；铁律零 @deepseek-ai、零 ctx（§三/ARCHITECTURE）
│   └── tools/
│       └── broker.mjs        #   【agent 半 · 编排真源】6 工具 + prompt 注入 + 模型绑定
│                             #     + 拓扑闸 + 快照桥发布（状态机等核心已抽 shared/）
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
│   ├── client.js             # 【client 半装配层】57 行：接线五模块 + 注册 DSH slots（tisitan.15）
│   ├── client-constants.js   # client 共享常量（色板/标签/intent 文案，零 React）
│   ├── panel-tree.js         # 树状图面板 + 快照轮询 + 自动跳转（花名册常驻区）
│   ├── settings-core.js      # 设置页主组件（工种卡手风琴 / persona 覆盖 / 保存行）
│   ├── roles-editor.js       # 自定义角色区（CRUD / persona 覆盖 / JSON 导入导出）
│   ├── tool-mask-editor.js   # 工具屏蔽双列表编辑器
│   ├── chain-rows.js         # 模型优先级列表编辑器纯函数（node --test 与 bundle 内联同源，tisitan.19）
│   ├── tool-mask-rows.js     # 工具屏蔽双列表编辑器纯函数（同上，tisitan.13）
│   ├── roster-rows.js        # 自定义角色纯函数（同上；卡摘要/导入导出/persona 覆盖）
│   └── panel-format.js       # 面板格式化纯函数（同上）
├── scripts/
│   ├── build-client.mjs      # esbuild 打包：src/client.js → dist/client.js（CJS + ModuleLoader 包装）
│   └── dump-session.mjs      # 会话档案取证 CLI（tisitan.16）：多帧 zstd 摘要 + childId 全项目目录搜索
├── dist/                     # 构建产物（gitignore，发布/构建时生成）
│
├── test/
│   ├── apply.mjs             # 冒烟：模块可加载 + client 可解析 + dist 存在
│   ├── orchestration.test.mjs# 状态机 16 单测（占位占锁/revive/requeue/幽灵求助/上限/
│   │                         #   currentMap 500 闸/台账 200 桶修剪，tisitan.15；
│   │                         #   dropQueuedFor 废弃面收口，tisitan.20）
│   ├── bridge.test.mjs       # apply 级集成 31 例（快照桥/队列回补重试与放弃/
│   │                         #   disposed 竞态/派发模型绑定/settings 重基线/
│   │                         #   台账 v2 分桶/多帧 zstd 附因/台账文件兜底查找/
│   │                         #   need_help 上报失败可观测性/forward 信封化转义/
│   │                         #   once-guard 双发盲窗 棒2-Z1，tisitan.20）
│   ├── multi-session.test.mjs# 多会话隔离 5 例（A 忙 B 不排队/childOwner 路由/
│   │                         #   session 销毁隔离/revive 重登记属主（tisitan.10）/
│   │                         #   跨会话抢属主守卫 棒2-L2，tisitan.20）
│   ├── host-parity.test.mjs  # lib/broker 对称断言 33 例（模型校验 2 + fallbacks/
│   │                         #   重派 8 + toolMask schema/unset/listTools 4
│   │                         #   + roster spawn 通道/名册路由/settings 6
│   │                         #   + shared 单一源/接线断言 2（tisitan.15）
│   │                         #   + activeFallback 2/附因兜底 3/persona 端点 1（.16）
│   │                         #   + fallbackEntry 1（.17）+ 预告/名册 2（.18）
│   │                         #   + 台账只读化/waterfall 对齐 2（棒2-M1/L3，.20））
│   ├── roster-roles.test.mjs # roles schema/迁移/合并/apply 17 例（tisitan.14/15；
│   │                         #   roles.sisyphus 死数据不消费读写两面 棒2-L1，.20）
│   ├── roster-route.test.mjs # go_work/forward 名册路由 + spawn 通道 + typeOfAgent
│   │                         #   19 例（tisitan.14-17；spawn 前回跳两例 棒2-Z2 /
│   │                         #   DSV4 promotion 行为面 棒2-L7，tisitan.20）
│   ├── roster-rows.test.mjs  # 角色纯函数 16 例：编辑器/卡摘要/persona 覆盖/
│   │                         #   导入导出（tisitan.14/15）+ mergeRoleRowsIntoRoles
│   │                         #   脏行透传（tisitan.20 Z2'）
│   ├── chain-rows.test.mjs   # 模型优先级列表编辑器纯函数 11 例（tisitan.19；
│   │                         #   stripEmptyFallbackRows 保存边界，tisitan.20 D1）
│   ├── panel-format.test.mjs # 面板格式化纯函数 9 例（tisitan.12；徽章行首锚定 .20 D6）
│   ├── tool-mask.test.mjs    # 工具屏蔽解析优先级 5 例（tisitan.13）
│   ├── tool-mask-rows.test.mjs# 屏蔽双列表编辑器纯函数 7 例（tisitan.13）
│   ├── dump-session.test.mjs # 取证 CLI 9 例（摘要规则/多帧行为面/childId 搜索，tisitan.16）
│   └── failure-notice.test.mjs# 失败通知真空期三件套 11 例（名册简报段 + 同步预告
│                               #   e2e + 分类器否决终局，tisitan.18）
│
├── docs/
│   ├── ARCHITECTURE.md       # 原始架构设计（tisitan.11 起随实现同步更新，含
│   │                         #   tisitan.10 会话隔离/台账 v2/面板门禁）
│   ├── FORK-GUIDE.md         # 本文档
│   ├── archive/              # 历史审查报告归档（code-review-broker-lib-2026-08-27）
│   └── legacy-broker-ts/     # ⚠️ 归档的 TS 参考实现（原根目录 broker/，停维护，
│                             #   见其 README；不参与构建运行）
└── AGENTS.md                 # 编排规格书（设计哲学 + 通信协议 + 禁止事项）
```

## 三、机制映射（什么功能 → 哪个文件 → 怎么实现）

### 调度与编排

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 派发子代理（go_work） | `preset/tools/broker.mjs` `dispatchWork()` | 检查属主会话实例的 `isBusy()` → 忙则 `enqueue()` 排队（返回 `work-*` 占位 id）；闲则 `beginSpawning()` 占位占锁（同步原子）→ `ctx.subagents.startContinuable()` 创建持久子会话 → `bindChild()` 绑定真实 childId 并登记 `childOwner` 属主映射 |
| 单线阻塞（tisitan.10 起按会话隔离） | `broker.mjs` `orchestrations: Map<会话id, Orchestration>` | 每个 Sisyphus 会话惰性建独立流水线（current/queue/history 各自为政，互不排队）；`childOwner` 路由表把子代理事件精准路由回属主流水线；会话销毁时整条回收。单槽内 `isBusy()` 到 `beginSpawning()` 之间无 await，Node 单线程下天然原子 |
| 队列推进 | `broker.mjs` `advanceQueue(orch)` | 属主实例的 `subagent/end` 或 spawn 失败时触发：dequeue 队首 → 按 `work.parentId` 重解析父会话 → dispatch；**失败自动 `requeueHead()` 回补**（fork 修复：任务不再蒸发） |
| 求助挂起（need_help） | `broker.mjs` need_help 工具 | `suspend()` 标记 waiting + `reportFrom` 把求助单注入 Sisyphus 下一步。注：台账层挂起，无强制 interrupt（评估结论见第五节） |
| 驳回/追问（continue） | `broker.mjs` continue 工具 | **先 `followup` 投递成功，后落账**（fork 修复时序病）；目标 waiting 则 resolveHelp+resume；目标已结束则 `revive()` 重新入册 + 恢复 sessionTypes 登记（fork 修复：结论不再丢失、单线不再被打破） |
| 转发（forward） | `broker.mjs` forward 工具 | 同上「先投递后销账」；target 为工种名时等效 go_work，为 childId 时等效 continue |
| 结论回流 | DSH 内核通知 + `broker.mjs` `subagent/end` | 子会话结束时内核通知父会话（broker 不重复注入）；broker 在 `subagent/end` 里 `finish()` 落账 → 清该子的求助单 → 删 sessionTypes → 推进队列。快速死亡的子会话（resolve 前就 end）归因到唯一 spawning 占位记录（fork 修复竞态冻结） |
| 附因档案兜底搜索（tisitan.16） | `preset/shared/archive.mjs` `findArchivedLogByChildId()` | `readArchivedTurnFailure` 默认按 `projectKey(process.cwd())` 定位项目目录——宿主进程 cwd≠用户工作区时永远找不到档案；默认路径不可读时枚举 sessions 根下全部项目目录按 childId 检测 `session.jsonl.zstd` 存在性，多命中取 mtime 最新，命中/零命中均 warn 留痕。修复生产上「未读到附因」从未成功 |
| 失败通知真空期消灭（tisitan.18） | 双半 `subagent/end` 同步段 + `attemptFallbackRedeploy` 终局分支；`shared/roles.mjs` `renderRosterBriefing()`；`prompts/sisyphus.md`「失败与备选通知协议」 | harness 原生 failed 通知（硬编码模板不可抑制）settle 瞬间同步唤醒主流程，broker 失败处置异步晚到——真空期主流程不知备选存在。修=三件套：①名册简报系统提示段（`dsh-my-go:roster`，order=10，函数态 text 现渲、儿童门控空串、键排序字节稳定）；②提示词协议（failed 先到是常态，有链静默等 broker、禁止自行报死/手动重派，重派通知新 childId 接管一切）；③end 处理器同步 inject 零延迟预告（有链「备选评估中（n 条）」/ 无链「无备选链，取证中」/ 有链非 error 终局「不进入备选评估，取证中」），终局分支显式通知（分类器否决 / 链尽 / 无法重派均「按失败终局落账」）；成功 end 零预告，同步段零 await |
| 状态回收 | `broker.mjs` `agent/disposed` / `session/disposed` 钩子 | 子代理被销毁但错过 end 事件：兜底清槽防队列冻结；Sisyphus 会话被删：丢弃其排队任务 |
| 双半共享源（tisitan.15） | `preset/shared/*`（constants / failure / archive / roles / orchestration / misc） | 两半 import 同一 ESM 实例：状态机/失败分类/档案读取/名册路由/工种识别/台账修剪单一源化（净消 1,251 行镜像双写）；铁律零 `@deepseek-ai/*`、零 ctx，依赖显式注入；promptCache 双根——broker 半以 preset 目录为根、lib 半以 `~/.dsh/.agent-presets/dsh-my-go` 为根，经 `loadPrompt` 注入 |

### 模型与提示词

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 按工种绑模型 | `broker.mjs` `dispatchWork()`（创建时 `agentOptions`）+ `agent/request` waterfall（请求时兜底） | 创建前 `modelExists()` 用 `llm.listModels` 验证模型真实存在才应用；只缓存非空结果（fork 修复负缓存中毒） |
| 备选重派防回跳（tisitan.16/17） | 双半 `activeFallback: Map<childId, {provider, model}>` + `shared/misc.mjs` `resolveEffectiveBinding()` | spawn 注入的备选 agentOptions 只管首帧；重派成功登记覆盖表（与 sessionTypes 同点），waterfall 每请求合并出有效绑定——只换 provider/model，工种 reasoningEffort/fallbacks 等其余字段保留，返回新对象不污染共享绑定表；tombstone/finalizeEnd/重派换键/end 无属主兜底等五类清理点镜像清除。tisitan.17 起备选条目本体 `record.fallbackEntry` 与 fallbackAttempt 同点入账、随台账 v2 落盘，continue/forward 复活（含 cold-resume 后的台账 revive）在重建 sessionTypes 的同点回填覆盖表，复活后不再回跳主模型；链上下一跳重派时新占位记录携带新条目，天然覆盖上一跳 |
| reasoningEffort | `broker.mjs` `supportedEfforts()` | 查 DSH 模型目录 `llm.resolveModelInfo`，**仅当模型实际支持该档位才设置**，否则留空走适配器默认（拒绝硬映射） |
| 工种识别 typeOfAgent（tisitan.15） | `shared/misc.mjs`（双半同一实现） | sessionTypes 活登记优先 + 会话 label（`dsh-my-go:<type>` 前缀）正则兜底；`agent/request` 绑定覆盖与 DSV4P0813 assemble 识别同走此函数——修复 cold-resumed 子代理（活登记已失）模型绑定静默失效；双侧契约：角色键名 `^[a-z][a-z-]*$` 与 label 正则同构，任意名册角色都可从 label 还原 |
| Sisyphus persona/规则 | `broker.mjs` 三个 `systemPrompt.section` | 读 `prompts/sisyphus.md`，按 `## 编排规则` 切两半：前段进 `deployment:persona`、后段进 `dsh-my-go:orchestration`；子代理会话返回空串（靠 parentSession 判定）。tisitan.18 起第三个段 `dsh-my-go:roster`（order=10）向根会话现渲名册简报 |
| 子代理 persona / toolFilter | `broker.mjs` `dispatchWork()` | 经 `SubagentStartRequest.persona/toolFilter` 官方 spawn 通道注入（descriptor v2 持久化、冷恢复原样重放；tisitan.14 起 `<system-reminder>` 包装退役，prompt 保持纯任务）；toolFilter 缺名派发前按活目录过滤降级（warn），allow 全缺名时回落全量目录 |
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
| 快照桥（fork 新增） | `broker.mjs` 发布 ↔ `lib/index.js` RPC 消费 | broker 把 `() => latestSnapshot` 挂到 `globalThis[Symbol.for('dsh-my-go.snapshot')]`；lib 的 RPC handler 优先实时读取（零副本），桥不在则回落自身状态机。tisitan.10 起形状为 `{ seq, parents: { [会话id]: { current, queue, helpRequests, history } } }`（多会话聚合） |
| 自动跳转 | `src/client.js` 定时器 | 子代理 running → `sessions.openSubagent()` 跟跳子会话；结束后 `sessions.open(parentSessionId)` 跳回。tisitan.10 起加**会话门禁**：只跟随当前打开的会话（`sessions.list.getSnapshot().current`），多会话并行时绝不把用户拽去别的会话 |
| 设置页 | `src/settings-core.js` + `roles-editor.js` / `tool-mask-editor.js` ↔ `lib/index.js` RPC | 内置 8 工种 × 5 字段（provider/model/reasoningEffort/dsv4p0813/fallbacks）+ 工具屏蔽双列表编辑器（tisitan.13，`listTools` RPC 拉花名册、`toolMask.deny` 读写）+ 自定义角色 CRUD 卡片区（tisitan.14，roles dict 读写，纯函数在 `src/roster-rows.js`）+ 内置角色 persona 覆盖与角色卡 JSON 导入导出（tisitan.15，`withPersonaOverride`/`buildRoleCardJson`/`parseRoleCardJson`，导入 8 类拒绝分支白名单剥离）+ 全卡片手风琴折叠（tisitan.15，纯视图态）+ 主选/备选合并为单一模型优先级列表（tisitan.19，纯 UI 投影：`src/chain-rows.js` compose 投影/decompose 写回，#1 主选带徽章、跨边界 ↑↓ 一键扶正、删除守卫链长 ≥1，存储 schema 零变更）；loadSettings 失败时 `draft=null` 禁止保存（fork 修复：不再一键清空配置）；saveSettings 全字段显式携带才写（tisitan.15 修复部分行误清）、空值 unset、显式 false 可表达 |
| settings 合并 | `broker.mjs` / `lib/index.js` | 永远从 `baseBindings`（默认值+插件 config）起算合并 stored（fork 修复：WebUI 取消配置可回落）；`||` 语义统一（空串=未设置） |
| preset 同步 | `lib/index.js` `ensurePresetInstalled()` | 版本标记文件 `.dsh-my-go-version`：版本不变则跳过（fork 修复：不再每次强制覆盖用户手改）；tisitan.15 起校验 `preset/shared/` 存在性——broker 相对 import shared 六模块，同步必须整树复制 |
| 面板花名册常驻区（tisitan.15） | `src/panel-tree.js` + snapshot `rosterLines` | snapshot RPC 恒附 `rosterLines`（内置 + 自定义活名册，与 orchestration_status 同源同格式），桥未就绪（无编排会话）也产出；面板底部常驻渲染 |

### 测试

| 层 | 文件 | 覆盖 |
|---|---|---|
| 冒烟 | `test/apply.mjs` | 模块加载/导出面/client 语法/dist 存在 |
| 单测 | `test/orchestration.test.mjs` | 状态机 16 例：占锁原子性、bindChild（含缺位告警）、finish 清求助、suspend/resume、revive、requeueHead、dropQueuedFailed、history 200 上限、record/followupPrompt、enforceCurrentCap（currentMap 500 闸）、beginSpawning 路径闸、pruneLedgerParents（台账 200 桶修剪，tisitan.15；dropQueuedFor 废弃面收口，tisitan.20） |
| 单测 | `test/chain-rows.test.mjs` | 模型优先级列表编辑器纯函数 11 例：normalize、compose/decompose 投影拆解与 round-trip 恒等、addEntry、删除扶正 + 最小长度守卫、跨边界双向移动、updateEntry（provider 重置 model）、stripEmptyFallbackRows 保存边界过滤（tisitan.20 D1）、不突变输入、draft 往返写回形状（tisitan.19；前身 fallback-rows 7 例行为面并入，tisitan.12） |
| 单测 | `test/panel-format.test.mjs` | 面板格式化纯函数 9 例：shortId/oneLine、formatRelativeTime 阶梯与边界、extractFallbackNote 标注提取（tisitan.20 D6 起匹配收窄为行首/前缀位置，假徽章治理）、组合形状（tisitan.12） |
| 单测 | `test/tool-mask.test.mjs` | 工具屏蔽解析 5 例：resolveDeny 三级优先级三态、DEFAULT_DENY 泛化清空源码断言、apply 容错（缺席跳过/服务缺席回落）与汇总日志（tisitan.13） |
| 单测 | `test/tool-mask-rows.test.mjs` | 屏蔽双列表编辑器纯函数 7 例：normalize 去重保序、block/unblock、availableTools 过滤、denyEntries 未连接徽章、不突变输入（tisitan.13） |
| 单测 | `test/roster-roles.test.mjs` | roles 名册 17 例：dict schema 形状、键名 `^[a-z][a-z-]*$` schema 层拒绝、旧顶级键无损迁移/幂等/并存覆盖、merge 携带 persona·toolFilter、apply 迁移容错（失败保留原配置仅 warn）、load/saveSettings 形状、部分行只带 persona 不产生 5 字段 ops（tisitan.14/15）、snapshot 恒附 rosterLines（tisitan.15）、roles.sisyphus 死数据不消费（merge 读面 + saveSettings 写面两例，棒2-L1，tisitan.20） |
| 集成 | `test/roster-route.test.mjs` | 名册路由 19 例：go_work 自定义角色 persona/toolFilter 经 spawn 通道注入、未注册名结构化报错附可用清单、toolFilter 缺名过滤降级与全缺名回落、内置工种 spawn 通道兜底、fallback 重派与首派同源、orchestration_status 尾部花名册区、describeAgent default 分支、forward 自定义 target（tisitan.14）、typeOfAgent 三例（cold-resumed 恢复绑定/登记优先于畸形 label/DSV4P0813 assemble 识别，tisitan.15）、waterfall 运行期防回跳两例（备选不回跳 + effort 保留 + 常规派发不受影响 / 清理后覆盖消失，tisitan.16）、备选覆盖复活重建两例（continue 复活后 waterfall 保持备选不回跳 / 链上第二跳覆盖第一跳且历史保留各自条目，tisitan.17）、spawn 前回跳两例（请求先于 resolve 到达 waterfall 保持备选 / spawn 失败 pending 登记同步清理，棒2-Z2，tisitan.20）、DSV4P0813 promotion 行为面一例（toolCalled 扫描/turn-end 翻转/单向切换，棒2-L7，tisitan.20） |
| 单测 | `test/roster-rows.test.mjs` | 角色纯函数 16 例：isValidRoleKey 与服务端同则、normalizeRoleRows 脏数据归一、增删改行、tool 条目增删、roleSummaryText/builtinSummaryText 卡摘要、不突变输入（tisitan.14）、withPersonaOverride/personaOverrideSource/buildRoleCardJson/parseRoleCardJson（tisitan.15）、resolveBuiltinPersonaResult RPC 结果归一（tisitan.16）、mergeRoleRowsIntoRoles 内置透传 + 脏行原样保留 + 投影行重建 + 删除语义（tisitan.20 Z2'） |
| 集成 | `test/bridge.test.mjs` + `test/multi-session.test.mjs` | mock cordis ctx 跑 `broker.apply()`：bridge 31 例（Symbol.for 快照桥两例、队列回补重试/超上限放弃、disposed 竞态两例、dispatchWork 模型绑定解析两例、settings 重基线、队列上岗映射通知、失败附因 live 推送、截断 config、台账 v2 分桶 round-trip、tisitan.9 持久化档案附因两例、tisitan.11 need_help 上报失败 warn+通知与 forward 信封化转义、tisitan.12 备选链重派等十二例（含 step-3 a–h）、tisitan.17 fallbackEntry 入账 + 台账 round-trip、现场-Z3 台账文件兜底查找、tisitan.20 棒2-Z1 once-guard 双发盲窗）；multi-session 5 例（A 忙 B 不排队、childOwner 路由、session 销毁隔离、revive 重登记属主）（tisitan.10）+ 跨会话抢属主守卫（棒2-L2，tisitan.20） |
| 半对齐 | `test/host-parity.test.mjs` | lib 半与 broker 半对称断言 33 例：dispatchWork 模型校验 2（tisitan.11）+ fallbacks/重派通路 8（tisitan.12）+ toolMask schema/空数组 unset/listTools mock 注册表 4（tisitan.13）+ roster spawn 通道/名册路由/save·loadSettings roles 6（tisitan.14）+ shared 单一源断言 2（tisitan.15：import 存在性 + ESM 同一性行为直测 + typeOfAgent/养护闸接线，字符串对称断言已退役）+ activeFallback 双半对称与 resolveEffectiveBinding 行为面 2、附因档案 cwd 兜底搜索 3、getBuiltinPersona 端点 1（tisitan.16）+ fallbackEntry 入账/复活重建点对称 1（tisitan.17）+ 失败同步预告/终局通知双半对称与名册简报段注册形态 2（tisitan.18）+ 快照桥下台账只读化 1（棒2-M1）与 waterfall 校验对齐 1（棒2-L3）（tisitan.20） |
| 集成 | `test/failure-notice.test.mjs` | 失败通知真空期三件套 11 例（tisitan.18）：名册简报段注册形态/儿童门控两路/内容全要素/字节稳定（含键插入序无关）/settings 更新免刷新管道 5 + 同步预告 e2e 5（有链失败评估中先于重派通知 / 无链失败取证中先于附因通知 / aborted 有链不谎报评估中 / 链尽终局通知 / 成功 end 零预告）+ 分类器否决终局通知 1 |
| 单测 | `test/dump-session.test.mjs` | 取证 CLI（`scripts/dump-session.mjs`）9 例：summarizeEvent 摘要规则 4（request/header 打 provider/model、llm/retry 序号、turn/end reason、assistant/chunk 与 tool 名）、dumpArchive 合成多帧档案行为面 4（逐帧事件流/末帧截断容错/帧内损坏行跳过/档案不可读与解压全灭非零语义）、locateArchive childId 全项目目录搜索 1；zstdCompressSync 合成档案全 hermetic（tisitan.16） |

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
- **默认绑定已清空（tisitan.7 起）**：`defaultBindings()` 八键（含 sisyphus）
  均为 `{}`，不内置任何模型/渠道名，子代理完全继承环境默认路由。需要按工种分流
  必须自行配置（WebUI 设置页「MyGO 编排」或 `~/.dsh/settings.yaml`，
  示例见 README「工种模型绑定」），否则所有子代理与 Sisyphus 同路由。
- **tool-mask 全默认不屏蔽（tisitan.13 起）**：`preset/tool-mask.mjs` 的
  `DEFAULT_DENY` 已清空（原 7 个私有示例名移除），屏蔽清单三级优先级：
  `config.deny`（行级显式覆盖）＞ settings `toolMask.deny`（设置页「工具
  屏蔽」双列表）＞ 空默认。清单在 preset 挂载时解析一次，**只对新会话
  生效**；缺席工具按名跳过（warn），不炸挂载。tisitan.12 及之前依赖内置
  清单的部署升级后需在设置页重配。
- **双通知（reported + settled）是机制性重复，不可抑制**：子代理完工时
  父会话会收到两条通知——子代理自己的 `reportFrom`（reported）与
  dsh-subagent 的 `notifySettlement`（settled）。两者都是 harness 硬编码
  模板（dsh-subagent/lib/index.js 的 `deliverReport` / `notifySettlement`），
  插件层无法抑制或改写，只能并存。tisitan.8 的补充通知（队列上岗映射 /
  失败附因）因此走自己的 `plugin/notice` inject 通道，不去碰 harness 模板。
- **harness 通知层丢失 error.message，且 live store 读档有时序性失效**：
  `subagent/end` 载荷的 `stopReason` 只有 kind（completed/error/...），
  不带 error 字段；完整的 `error.message` / `code` 只存在于子会话档案的
  `turn/end` 事件 `reason.error` 里。更隐蔽的是：continuable Activation
  的销毁顺序（dsh-subagent/lib/types/continuation.js ~L1016-1050）是先
  `handle.dispose()`（连带把子 session 从 sessions live store 摘除）、删
  activation，最后 `observer.settle()` 才发射 `subagent/end`——所以经
  `sessions` 服务 API（`sessions.get(childId).events`）的 live 读法在 end
  处理器里**必然落空**（tisitan.8 实锤：failed 记录只有 '(error)'）。
  tisitan.9 起 live 读法降级为快路径，主路径改读**持久化档案**：
  `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(childId)>/
  session.jsonl.zstd`（目录规则与 dsh-session-persistence-jsonl 同算法，
  broker 内 `projectKey`/`encodeSegment` 逐行对齐其 lib/index.js:106-124/
  84-96）；该文件是多 zstd 帧追加容器，Node 的 zlib 单帧接口只吃首帧，
  必须扫描帧界逐帧解压（broker 内 `scanZstdFrameRanges` 对齐其
  scanZstdFrames :503-566），倒序取最后一条 `turn/end` error。找不到
  档案/解压失败/无 error 事件均静默退回无附因 + `console.warn` 留痕。
