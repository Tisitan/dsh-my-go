# Changelog

本文件记录 Tisitan fork 相对上游 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go) 的变更。
版本号规则：`上游版本-tisitan.N`。

## [0.2.3-tisitan.4] - 2026-08-25

### 部署适配（Tisitan 环境）

- **tool-mask 同步**：新增 `preset/tool-mask.mjs`（配方取自本机 `nova` preset），
  在 preset 作用域屏蔽 Rei 角色记忆工具与 OpenCode 桥接共 7 个
  `mcp__vcp__*` 工具——对 Sisyphus 与全部子代理同时生效（preset scope 覆盖
  整个 standing mount）。逐名 try/catch + 失败 `console.warn` 告警，
  工具缺席不炸挂载。`preset/agent.cordis.yml` 末尾新增 tool-mask 行。

## [0.2.3-tisitan.3] - 2026-08-25

### 修正（安装前自查发现）

- **摘除 lib 的 `agent/created` 钩子**：tisitan.1 镜像拓扑闸时误给 lib（global
  层插件）也挂了 skill 隐藏/拓扑闸钩子——该事件在 global 层会收到 profile 内
  **所有**会话（含非 MyGO 会话），装上去会拔掉其他 preset 会话的 skill 工具。
  钩子只应作用于 MyGO preset 会话，由 preset 作用域的 broker.mjs 独占负责
  （standing scope listener 只接收 join 它的 agent 的事件）。lib 恢复上游行为。

## [0.2.3-tisitan.2] - 2026-08-25

在 tisitan.1 基础上的稳步升级批（全部经测试验证；评估后不安全的改动仅文档化）。

### 功能补全

- **client 自动跳回父会话**：子智能体结束后 `sessions.open(parentSessionId)`
  跳回 Sisyphus（ARCHITECTURE.md §3 的闭环此前未实现）；手动跳转不再传空
  `parentSessionId`（读快照字段）。

### 清理

- 删除 `lib/index.js` 与 `preset/tools/broker.mjs` 中的死代码 `parseAgentType`
  （仅归档的 TS 参考实现使用，保留在 `broker/src`）。
- `broker/README.md`：明确标注 TS 目录为归档参考实现，不参与构建运行。

### 文档

- 新增 `docs/FORK-GUIDE.md`：全景逻辑图 + 文件目录树 + 机制映射表
  （什么功能由哪个文件通过什么原理实现）+ 未实施升级的评估结论
  （need_help 真 interrupt / isolate 服务桥 / projection 推流）。

## [0.2.3-tisitan.1] - 2026-08-25

基于上游 v0.2.3（main @ cf2d802）。修复来源：全项目三方交叉审查（详见审查报告）。

### Critical 修复

- **client：编排面板打不开**——`panelOpen` 外部变量与组件内 `open` state 脱钩，
  且 `force()` 无参调用触发 React bailout（面板首次刷新后永久 stale）。
  改为统一读外部 `panelOpen` + `force((c) => c + 1)` 重渲染（`src/client.js`）。
- **星型拓扑击穿**：preset 中原生 `subagent`/`subagent_fork`/`workflow`/`ralph`
  工具对子智能体可用，子代理可私自派生孙代。现于 `agent/created` 钩子在
  工具目录层对子代理摘除上述工具及 `go_work`/`continue`/`forward`
  （与 `canOrchestrate` 运行时守卫双保险）（`preset/tools/broker.mjs`、`lib/index.js`）。
- **复活死子代理不入册**：`continue`/`forward` 到已结束 childId 时不回
  currentMap 且 sessionTypes 已删，导致单线阻塞失效 + 结论静默丢弃。
  现投递成功后 `revive` 重新入册并恢复类型登记；有子代理运行中时拒绝复活。
- **失败路径失守组**：
  - 队列推进先 dequeue 后 dispatch 且错误被吞 → 任务蒸发。现抽出
    `advanceQueue()`，派发失败自动回补队首并记日志。
  - spawn 失败 abort 后不推进队列 → 死锁。现立即推进队首。
  - `forward` 先 resolveHelp、`continue` 先 resume 后投递 → 中途失败即
    求助丢失/假 running。现统一「先投递成功，后落账」。
  - spawn 竞态：子会话先于 `startContinuable` resolve 结束 → 永久卡
    spawning/running。现归因到唯一 spawning 占位记录并正常收尾。
- **settings 合并不可撤销**：在已合并的活 bindings 上叠加，WebUI 取消配置后
  旧值残留。现始终从 `baseBindings`（默认值 + 插件 config）起算。

### Major 修复

- DSV4P0813 phase-1 工具白名单使用了不存在的工具名
  （`read_file`/`write_file`/`edit_file`）→ 改为 DSH 实际注册名
  （`read`/`write`/`edit`/`glob`/`grep`）。
- `finish()` 不清除该子代理的 pending helpRequests → 幽灵求助可被 forward。
  现随 finish 一并清理。
- `modelExists` 把瞬时 listModels 失败永久负缓存为空集 → 模型绑定静默失效。
  现只缓存非空结果。
- lib 队列回退使用 `agents.roots()[0]`，多会话下把排队任务派到别的会话 →
  改用 `lastOrchestratorSessionId` 回退（与 broker.mjs 一致）。
- lib 的 RPC 快照缺 `parentSessionId`，client 自动跳转永不触发 → 已补上。
- `loadSettings` 失败后 `draft={}`，点保存即清空全部配置 → 加载失败保持
  `draft=null` 并禁用保存。
- `saveSettings` 把显式 `false` 当 unset → `dsv4p0813: false` 现可正确表达。
- lib settings 合并操作符 `??` → `||`（与 broker.mjs 统一，空串视为未设置）。
- `go_work` 排队时返回的占位 id 与工具文档矛盾 → 文档澄清 +
  `continue` 对排队 id 给出明确错误提示。
- 新增 `agent/disposed` / `session/disposed` 生命周期清理钩子，回收编排状态，
  防止跨会话泄漏与队列冻结。

### 一致性 / 文档

- `prompts/sisyphus.md`：删除「检索/文档归 hermes」与负面清单的矛盾表述；
  删除与 Oracle 闸门冲突的「终验」触发词。
- `ensurePresetInstalled` 真幂等：按版本标记文件 `.dsh-my-go-version` 同步，
  同版本不再覆盖用户对手工安装 preset 的修改（原注释宣称幂等实则每次强制覆盖）。
- `docs/ARCHITECTURE.md`：修正三处过时描述（need_help 无 interrupt 实为台账层
  挂起；effort 不做 low→high 硬映射而是不支持则留空；details 栏 → overlay 面板；
  补充 revive 语义与 compaction 回落未实现标注）。

### 工程

- 新增 `test/orchestration.test.mjs`：Orchestration 状态机 12 个单元测试
  （占位占锁/finish 清求助/revive/requeue/dropQueuedFor/history 上限等）。
- `npm test` = 冒烟测试 + 单元测试；`tsc --noEmit` 通过。

### 双 host 收敛（v1）

调研确认两半同属一棵 cordis fiber 树、同一 Node 进程，且 tools 注册表合并
语义为「最近的 scope 覆盖同名项」（dsh-scope/lib/index.js:177-181）——
MyGO 会话里 broker.mjs（preset 层）的工具天然压制 lib（global 层）的同名
工具，每个会话只存在一个编排权威。在此事实上的收敛方案：

- **数据面统一**：broker.mjs 通过 `Symbol.for('dsh-my-go.snapshot')` 全局
  注册表发布只读快照访问器；lib 的 RPC `snapshot` 端点优先读取它（真源
  实时读、零副本），桥不存在时回落 lib 自身状态机（非 MyGO 会话/无 preset
  部署形态，行为与上游一致、无回归）。面板裂脑（RPC 数据源永远空闲）修复。
- **lib 定位**：保留为 global 层 fallback（非 MyGO 会话仍可用编排工具）+
  settings 命名空间 + RPC 桥 + preset 同步器的宿主，两平面状态机各自自治、
  经 sessionTypes 门控互不干扰。

未来方向（未做）：按 dsh-goal 官方范式升级为 broker publish isolate 服务 +
host 经 `agentPresets.serviceFor` 拉取 + `session.append` 全量快照 +
projection 推流（替代 600ms 轮询并解锁冷会话回放）。当前 Symbol.for 桥在
拉取路径上与之功能等价，升级属锦上添花。

### 已知未决

- `broker/src` TS 参考实现已过时（仍用 `globalThis.harness.handle` 桥），
  保留仅供参考，不参与构建。
