<!-- deepseek-harness-meta
{
  "name": "MyGO 编排器",
  "version": "0.2.3-tisitan.4",
  "tags": ["preset", "模式预设"],
  "description": "把每一步路由到最合适模型的智能体编排器"
}
-->

# MyGO!!!!! 编排调度 | DSH

> **My** tasks, where to **GO**?????

> 🔱 **Tisitan fork**：本仓库是 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go)
> 的维护性 fork，包含面板/拓扑闸/失败路径等一系列 Critical 修复，详见 [CHANGELOG.md](CHANGELOG.md)。

dsh-my-go 是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 之上的**智能体编排系统**。

它以星型 + 单线嵌套拓扑把 DSH 主会话（Sisyphus）与 7 个专业子智能体组织起来：Sisyphus 负责调度、审查与驳回，子智能体负责执行与汇报。参考了 oh-my-openagent 的编排设计，针对 DSH 进行了优化调整。

开发手记：https://khbit.cn/posts/dsh-my-go/

## 特性

- **星型拓扑**：所有子智能体（叶子）不直接通信，全部经 Sisyphus 中转。
- **单线阻塞**：同一时段只有一个子智能体运行，便于审查，增强可观测性。
- **7 个专业工种**：Hermes（快速执行）、Explore（检索）、Librarian（文档）、Multimodal Looker（看图）、Hephaestus（写代码）、Prometheus（规划）、Oracle（最后手段：调试 + 终验，仅当其他工种无法胜任时启用）。
- **按工种绑定模型**：快活小工用轻模型（如 mimo-v2.5），重活用重模型（如 deepseek-v4-pro-0813）。
- **4 个通信工具**：`go_work`（派发）、`continue`（驳回/追问）、`need_help`（求助挂起）、`forward`（转发），加 `orchestration_status`（状态总览）和 `list_subagents`（列出已有 sub-agent 及其最后 prompt）。
- **步骤级调度**：Prometheus 把需求拆成步骤序列，Sisyphus 逐步骤选择最省 token 的工种——**按任务难度分配（不按需求难度）**：指令明确、步骤具体的执行活优先派 Hermes，需要设计/推理的才升级 Hephaestus，仅疑难/极端复杂才到 Oracle；同工种上下文连续则 `continue` 复用。
- **Sisyphus 质检**：结论不达标驳回重做，被驳回的子智能体保留上下文继续。
- **WebUI 配置**：每个工种的模型 / 思考档位 / DSV4P0813 补丁开关，均可在 DSH 设置页配置。
- **DSH 适配**：权限请求、问题询问由主智能体执行。
- **节省主会话上下文**：Sisyphus 主会话不加载 Skill 工具（子智能体仍保留），跳过 Skill catalog 注入以压缩主会话上下文。
- **DSV4P0813 补丁开关**：内置过拟合补丁，让 DeepSeek V4 Pro 0813 发挥最大的实力。

_真正实现 “按量付费”_

## 环境要求

### 理论最低要求

- DeepSeek Harness `0.1.0-rc.6`+（基于 `agent/request` waterfall 与 continuable subagent API）
- Node.js 20+
- 一个可用的 LLM provider
- Windows / macOS / Linux（DSH 均支持）

### 开发时的环境

- DSH `0.1.0-rc.8` + Windows 11 + Node.js 22（作者实际组合）

## 快速开始

### 安装（推荐：npm 插件）

```bash
# 一条命令安装到 web profile
dsh plugin --profile web add dsh-my-go@latest --config.minimumReleaseAge=0
# 重启 dsh web 生效
dsh web
```

安装后 broker 插件（编排工具 + 模型绑定 + 树状图面板 + 设置页）自动挂载；
会话预设「MyGO!!!!! 模式」提供 Sisyphus 的完整编排。

### 最小示例

新开一个 DSH 会话，预设选择 **MyGO!!!!! 模式**
然后对 Sisyphus 说：

> 告诉我这个项目是干啥的。

### 运行

```bash
dsh web   # 启动 Web GUI，新会话选择 MyGO!!!!! 模式
```

## 架构

```
用户 ──► Sisyphus（调度+质检）──► Hermes / Explore / Librarian / Looker
            │                        Hephaestus / Prometheus / Oracle
            └── 单线阻塞队列 ◄── 所有子智能体结论回流
```

- 子智能体 = DSH **continuable subagent**（`subagents.startContinuable`），
  持久化独立 Session，支持 `followup` 续接。
- 模型绑定 = 创建时 `agentOptions` + `agent/request` waterfall 覆盖
  `reasoningEffort`（**跟随 DSH 模型目录**：只设置该模型实际支持的思考档位；
  模型无思考选项或档位不支持时不设置，走模型默认）。
- 单线阻塞 = broker 编排状态机（当前运行 / 队列 / 求助 / 历史）。
- 详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 配置

broker 注册 settings 命名空间 `dsh-my-go`（WebUI 设置页「MyGO 编排」）：

| 配置项                          | 默认值   | 说明                                                                    |
|---------------------------------|----------|-------------------------------------------------------------------------|
| `agents.<type>.provider`        | 继承父级 | 该工种的 provider 路由                                                  |
| `agents.<type>.model`           | 见表     | 该工种的模型                                                            |
| `agents.<type>.reasoningEffort` | 见表     | 期望思考档位（如 high/max）；**只在模型实际支持时应用**，否则走模型默认 |
| `agents.<type>.dsv4p0813`       | false    | 是否对该工种启用 DSV4P0813 两阶段锚定补丁                               |

工种模型（建议）：

| 工种                         | 模型              | Effort  | 备注         |
|------------------------------|-------------------|---------|--------------|
| Sisyphus                     | deepseek-v4-flash | high    | 中等能力模型 |
| Hermes / Explore / Librarian | mimo-v2.5         | default | 便宜模型     |
| Looker                       | mimo-v2.5         | default | 多模态模型   |
| Hephaestus                   | deepseek-v4-flash | high    | 中等能力模型 |
| Prometheus / Oracle          | deepseek-v4-pro   | max     | 强能力大模型 |

## 智能体 Prompt

每个工种的完整 persona / 职责 / 汇报格式见 [`prompts/`](prompts/)：

| 文件                                           | 工种            |
|------------------------------------------------|-----------------|
| [prompts/sisyphus.md](prompts/sisyphus.md)     | 总调度 + 质检官 |
| [prompts/hermes.md](prompts/hermes.md)         | 快速执行        |
| [prompts/explore.md](prompts/explore.md)       | 快速检索        |
| [prompts/librarian.md](prompts/librarian.md)   | 文档查询        |
| [prompts/looker.md](prompts/looker.md)         | 多模态识别      |
| [prompts/hephaestus.md](prompts/hephaestus.md) | 代码编写        |
| [prompts/prometheus.md](prompts/prometheus.md) | 需求规划        |
| [prompts/oracle.md](prompts/oracle.md)         | 架构调试 + 终验 |

## 目录结构

```
dsh-my-go/
├── AGENTS.md              # 本项目的编排规格（Sisyphus 系统）
├── README.md              # 本文档
├── package.json           # npm 包声明（dsh.bundle.patch → cordis.patch.yml）
├── cordis.patch.yml       # bundle patch（dsh plugin add 后自动挂载 host 插件）
├── lib/index.js           # npm 包 host 半（编排工具 + 状态机 + 模型绑定）
├── src/client.js          # client 半源码（树状图面板 / 设置页 / 自动跳转）
├── scripts/build-client.mjs  # esbuild 打包 client → dist/client.js
├── dist/                  # 构建产物（发布时生成）
├── preset/                # agent preset「MyGO!!!!! 模式」（复制到 ~/.dsh/.agent-presets/）
│   ├── preset.yml
│   ├── agent.cordis.yml
│   └── tools/broker.mjs   # 自包含 host 插件（工具 + 模型绑定 + 状态机）
├── broker/                # broker 插件 TS 源码（参考实现）
├── prompts/               # 8 个智能体 prompt
└── docs/ARCHITECTURE.md   # 架构设计
```

## 贡献

```bash
git clone git@github.com:daizihan233/dsh-my-go.git
cd dsh-my-go
bun install
bun run build:client    # 构建 client bundle
bunx tsc --noEmit       # 类型检查
bun run test            # 冒烟测试
```

## 维护状态

- 仍在积极开发中，可能有少量 Bug 尚存，欢迎提交 Issue
- 已知限制：
  - 子智能体模型绑定依赖 `agent/request` waterfall（DSH 未原生支持动态子代理模型，
    见 [dsh-handbook 9.2](https://github.com/deepseek-ai/deepseek-harness/discussions/118)）；
  - 结论注入依赖 `subagent/end` 事件；`reportFrom` 为子→父补充通道。
  - 单线阻塞由 broker 状态机执行；Sisyphus 需遵守编排规则（由 system-prompt section 约束）。
- 感谢以下三位开发者：（排名不分先后）
  - DeepSeek V4 Flash 0731
  - DeepSeek V4 Pro 0813
  - MiMo V2.5

## 许可证

[MIT](LICENSE) © dsh-my-go contributors
