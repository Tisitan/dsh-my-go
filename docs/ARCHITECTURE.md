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
- **台账持久化（tisitan.8）**：history（done/failed，上限 200 条）防抖落盘
  `<DSH_HOME>/dsh-my-go/orchestration-ledger.json`，插件加载时读回——进程
  重启后 `continue` 已完工 childId 仍能命中台账（revive → harness coldResume
  续聊），而不是报 unknown sub-agent id。
- **父会话补充通知（tisitan.8）**：harness 的双通知（reported/settled）是
  dsh-subagent 硬编码模板，插件不可抑制/改写；broker 经公开 API
  `parent.inject`（非唤醒）自行注入两条低频高价值短通知——队列上岗映射
  （`work-* → childId`）与失败附因。失败附因来源：`subagent/end` 载荷无
  error 字段，broker 读子会话最后一条 `turn/end` 的 `reason.error`——
  tisitan.9 起 live store（`sessions` 服务）降级为快路径，主路径读持久化
  档案 `<DSH_HOME>/sessions/<projectKey(cwd)>/<childId>/session.jsonl.zstd`
  （多帧 zstd 逐帧解压；continuable 销毁顺序使 end 发射晚于 live store
  摘除，live 读法必然落空）。读档失败静默退回无附因（console.warn 留痕），
  同一原因同时追加进 history 结论尾部。

### 2.2 模型与 effort 绑定

每个智能体类型（agentType）在 settings 中可配置 `provider` / `model` /
`reasoningEffort` / `dsv4p0813`（DSV4P0813 补丁开关）。

- **创建时**：`SubagentStartRequest.agentOptions = { provider, model }` 直接
  指定模型（`provider` 缺省时继承父会话渠道；`model` 先经 `modelExists()`
  用 `llm.listModels` 校验真实存在才应用，且只缓存非空查询结果——瞬时
  失败不留负缓存）；`persona` 用该类型的 prompt 覆盖。
- **请求时**：`agent/request` waterfall 拦截，按 agent 类型覆盖
  `reasoningEffort`（以及兜底 provider/model）。类型识别以 broker 的
  `sessionTypes` 注册表为准：spawn 成功时登记 `childId → 工种`，
  `agent/disposed` 时移入有界墓碑表（防 disposed 先于 `subagent/end`
  的竞态串号），`subagent/end` 消费后清除。会话 label 前缀约定
  `dsh-my-go:<agentType>` 仅用于 DSV4P0813 的 assemble 过滤识别。

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
Sisyphus 本身不启用（它是调度者）。

## 3. UI 适配

- **overlay 树状图面板**：`shell.overlay` 浮层显示子 Agent 运行情况
  （current / queue / help / history），由侧栏底部 🧭 按钮开关，
  点击节点可跳转子会话（经 host 半的 connection.rpc 快照桥轮询）。
  队列节点渲染 work-id 占位；快照桥未就绪时显示「编排桥未就绪」提示态
  而非静默空白（tisitan.8）。
- **自动跳转**：子智能体运行时，client 通过 `sessions.openSubagent({
  parentSessionId, childSessionId, mode: 'continuable' })` 自动跳转到子会话，
  展示其上下文；子智能体结束（`subagent/end`）后跳回 Sisyphus 父会话。
  中间保持 DSH 原生会话视图，不自建上下文面板。
- **设置页**：client 半（`src/client.js`）注册「MyGO 编排」设置页 UI；
  settings 命名空间 `dsh-my-go` 由 host 半（`lib/index.js`）注册，
  broker 半只读取，配置每个智能体的 provider / model /
  reasoningEffort / dsv4p0813。

## 4. 交付物

| 目录 | 内容 |
| --- | --- |
| `preset/` | dsh-my-go agent preset（由 lib 同步到 `~/.dsh/.agent-presets/dsh-my-go/`） |
| `broker/` | ⚠️ 归档的 TS 参考实现（见 `broker/README.md`），不参与构建与运行 |
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
