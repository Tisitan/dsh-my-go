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
              │  (deepseek-  │
              │   v4-flash)  │
              └──────┬──────┘
     ┌───────────┬───┼───┬───────────┬───────────┐
     ▼           ▼       ▼           ▼           ▼
  Hermes      Explore  Librarian  Looker      Hephaestus
  (mimo-v2.5) (mimo-   (mimo-     (mimo-      (deepseek-
   default     v2.5)    v2.5)      v2.5)       v4-flash/high)
     ▲           ▲       ▲           ▲           ▲
     │           │       │           │           │
     └───────────┴───┬───┴───────────┴───────────┘
                    Oracle        Prometheus
                    (deepseek-v4-pro/max)   (deepseek-v4-pro/max, 仅流程开始一次)
```

- **所有子智能体（叶子）不直接通信**，必须经由 Sisyphus 中转。
- **执行模式**：单线阻塞，同一时段只能有一个子智能体运行。
- **Sisyphus = 主会话**：用户对话所选模型即 Sisyphus 的模型；它不单独创建。
- **子智能体 = DSH continuable subagent**：通过 `subagents.startContinuable`
  创建，持久化到独立 Session，支持后续 `followup`（对应 continue）。

## 2. 实现机制（对应 AGENTS.md 的 5 种通信）

| AGENTS.md 通信 | 实现 | DSH 能力 |
| --- | --- | --- |
| `need_help`（子→Sisyphus） | broker 注册给子智能体的工具；调用后挂起自己，通过 `reportFrom` 把请求注入父会话，并生成 helpRequestId | `subagents.reportFrom` + broker 状态 |
| `go_work`（Sisyphus→新子智能体） | broker 注册给 Sisyphus 的工具；`subagents.startContinuable` 创建空上下文子智能体，返回 childId | `subagents.startContinuable` |
| `continue`（Sisyphus→挂起子智能体） | `subagents.followup(parent, childId, content)` 发送驳回/追问 | `subagents.followup` |
| `forward`（Sisyphus 转发 need_help） | 读 helpRequest 记录 → 对既有 childId 用 continue，对类型用 go_work | broker 状态 + followup/startContinuable |
| 结论（子→Sisyphus） | 子智能体最后输出经 `subagent/end`（或 reportFrom）注入父会话，带 conclusionId | `subagent/end` 事件 |

### 2.1 单线阻塞

broker 的 `Orchestration` 状态机维护：

```ts
interface OrchestrationState {
  current: { childId, agentType, prompt, status } | null;  // 当前运行
  queue: PendingWork[];      // 排队中的 go_work
  helpRequests: HelpRequest[];  // 挂起的 need_help
  history: RunRecord[];      // 已完成记录（含结论）
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

### 2.2 模型与 effort 绑定

每个智能体类型（agentType）在 settings 中可配置 `provider` / `model` /
`reasoningEffort` / `dsv4p0813`（DSV4P0813 补丁开关）。

- **创建时**：`SubagentStartRequest.agentOptions = { provider, model }` 直接
  指定模型；`persona` 用该类型的 prompt 覆盖。
- **请求时**：`agent/request` waterfall 拦截，按 agent 类型覆盖
  `reasoningEffort`（以及兜底 provider/model）。类型识别通过会话 label
  前缀约定：`dsh-my-go:<agentType>`。

> ⚠️ effort 档位跟随 DSH 模型目录：仅在目标模型实际支持所配档位时才设置；
> 不支持或能力未知时**不设置**（走适配器默认），拒绝硬映射/钳位
> （如 deepseek-official 仅 off/high/max，配 `low` 则留空而不是改成 high）。

### 2.3 DSV4P0813 补丁（参考 tmp/liangshen）

DSV4P0813 需要「两阶段锚定」上下文注入流程才能发挥全部能力：

- **Phase 1（未锚定）**：子智能体只见最小工具集 + 单行 persona +
  白名单消息源（user/goal），锚定 minimal 推理轨迹（首块含 `we` 且无
  `let me`）。
- **晋升**：首块锚定后放开完整工具目录与全部 prompt section。
  （注：「compaction 后回落受控阶段」尚未实现——晋升状态目前一经提升
  不回落。）

broker 为每个智能体提供 `dsv4p0813: boolean` 开关。开启时给该子智能体
注入阶段化引导（复用 liangshen 的 tool-bootstrap 语义，按子智能体类型
配置工具白名单）。Sisyphus 本身不启用（它是调度者）。

## 3. UI 适配

- **overlay 树状图面板**：`shell.overlay` 浮层显示子 Agent 运行情况
  （current / queue / help / history），由侧栏底部 🧭 按钮开关，
  点击节点可跳转子会话（经 host 半的 connection.rpc 快照桥轮询）。
- **自动跳转**：子智能体运行时，client 通过 `sessions.openSubagent({
  parentSessionId, childSessionId, mode: 'continuable' })` 自动跳转到子会话，
  展示其上下文；子智能体结束（`subagent/end`）后跳回 Sisyphus 父会话。
  中间保持 DSH 原生会话视图，不自建上下文面板。
- **settings.section**：broker 注册「dsh-my-go 编排」设置页，配置每个
  智能体的 provider / model / reasoningEffort / dsv4p0813。

## 4. 交付物

| 目录 | 内容 |
| --- | --- |
| `preset/` | dsh-my-go agent preset（复制到 `~/.dsh/.agent-presets/dsh-my-go/`） |
| `broker/` | host+client broker 插件（npm 包，挂到 profile 或动态运行） |
| `prompts/` | 每个智能体的 persona/prompt 文件 |
| `docs/` | 本文档 |
| `README.md` | 项目说明 |

## 5. 安装

1. 复制 `preset/` → `~/.dsh/.agent-presets/dsh-my-go/`（会话预设可选「dsh-my-go」）。
2. 安装 broker 插件：
   - 动态：本会话 `cordis_define` + `cordis_run`（开发验证）。
   - 持久：在 `~/.dsh/profiles/web/package.json` 加依赖，`cordis.patch.yml`
     `insert` 挂载，重启 `dsh web`。
3. 新会话选择「dsh-my-go」预设，开始编排。
