# MyGO!!!!! 编排调度 | DSH

> **My** tasks, where to **GO**?????

dsh-my-go 是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 之上的**智能体编排系统**。它以星型 + 单线嵌套拓扑把 DSH 主会话（Sisyphus）与 7 个专业子智能体组织起来：Sisyphus 负责调度、审查与驳回，子智能体负责执行与汇报。他参考了 oh-my-openagent 的编排设计。

## 特性

- **星型拓扑**：所有子智能体（叶子）不直接通信，全部经 Sisyphus 中转。
- **单线阻塞**：同一时段只有一个子智能体运行，多余任务自动排队。
- **7 个专业工种**：Hermes（快速执行）、Explore（检索）、Librarian（文档）、Multimodal Looker（看图）、Hephaestus（写代码）、Prometheus（规划）、Oracle（调试 + 终验）。
- **按工种绑定模型与思考档位**：快活小工用轻模型（mimo-v2.5），重活用重模型（deepseek-v4-pro + max）。
- **4 个通信工具**：`go_work`（派发）、`continue`（驳回/追问）、`need_help`（求助挂起）、`forward`（转发），加 `orchestration_status`（状态总览）和 `list_subagents`（列出已有 sub-agent 及其最后 prompt）。
- **步骤级调度**：Prometheus 把需求拆成步骤序列（每步标注工种/交付物/沿用或换人），Sisyphus 逐步骤选择最省 token 的工种——轻活派轻工种、重活派重工种、同工种上下文连续则 `continue` 复用。
- **Sisyphus 质检规则**：结论不达标可驳回重做，被驳回的子智能体保留上下文继续。
- **WebUI 配置**：每个工种的模型 / 思考档位 / DSV4P0813 补丁开关，均可在 DSH 设置页配置。
- **UI 适配**：右侧编排面板树状图实时显示运行/队列/求助/历史；子智能体运行时自动跳转子会话，结束后跳回。
- **DSV4P0813 补丁开关**：按工种可选启用两阶段锚定上下文注入（参考 liangshen 模式）。

## 环境要求

### 理论最低要求

- DeepSeek Harness `0.1.0-rc.8`+（基于 `agent/request` waterfall 与 continuable subagent API）
- Node.js 20+
- 一个可用的 LLM provider（模型路由默认 `octopus` / `pi-ai`，可配置）
- Windows / macOS / Linux（DSH 均支持）

### 开发时的环境

- DSH `0.1.0-rc.8` + Windows 11 + Node.js 22（作者实际组合）

## 快速开始

### 安装（推荐：npm 插件）

```bash
# 一条命令安装到 web profile（自动加入 dsh.profile.bundles 并激活）
dsh plugin --profile web add dsh-my-go
# 重启 dsh web 生效
dsh web
```

安装后 broker 插件（编排工具 + 模型绑定 + 树状图面板 + 设置页）自动挂载；
会话预设「MyGO!!!!! 模式」提供 Sisyphus 的完整编排 persona。

### 安装（备选：agent preset）

```bash
# 只装会话预设（broker 随 preset 加载，client UI 需另行挂载）
cp -r preset ~/.dsh/.agent-presets/dsh-my-go
```

动态验证（开发期，无需重启）：

```bash
# 在 DSH 会话中用动态 Cordis 插件跑 broker host 半：
#   cordis_define → cordis_run（见 docs/ARCHITECTURE.md §5）
```

### 最小示例

新开一个 DSH 会话，预设选择 **MyGO!!!!! 模式**
然后对 Sisyphus 说：

> 调研 src/ 目录结构，然后写一个 README 生成脚本，最后让 Oracle 终验。

Sisyphus 会自动：`go_work(prometheus, …)` 规划 → 按步骤 `go_work(explore, …)` 检索 →
`go_work(hephaestus, …)` 实现 → `go_work(oracle, …)` 终验，每个子智能体运行时界面自动跳到其子会话。

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

broker 注册 settings 命名空间 `dsh-my-go`（WebUI 设置页「dsh-my-go 编排」）：

| 配置项 | 默认值 | 说明 |
| ------ | ------ | ---- |
| `agents.<type>.provider` | 继承父级 | 该工种的 provider 路由 |
| `agents.<type>.model` | 见表 | 该工种的模型 |
| `agents.<type>.reasoningEffort` | 见表 | 期望思考档位（如 high/max）；**只在模型实际支持时应用**，否则走模型默认 |
| `agents.<type>.dsv4p0813` | false | 是否对该工种启用 DSV4P0813 两阶段锚定补丁 |

工种默认模型（AGENTS.md 建议）：

| 工种 | 模型 | Effort |
| --- | --- | --- |
| Sisyphus | 用户所选 | —（跟随用户选择） |
| Hermes / Explore / Librarian / Looker | mimo-v2.5 | —（跟随模型默认） |
| Hephaestus | deepseek-v4-flash | high（模型支持时） |
| Prometheus | deepseek-v4-pro | max（模型支持时） |
| Oracle | deepseek-v4-pro | max（模型支持时） |

## 智能体 Prompt

每个工种的完整 persona / 职责 / 汇报格式见 [`prompts/`](prompts/)：

| 文件 | 工种 |
| --- | --- |
| [prompts/sisyphus.md](prompts/sisyphus.md) | 总调度 + 质检官 |
| [prompts/hermes.md](prompts/hermes.md) | 快速执行 |
| [prompts/explore.md](prompts/explore.md) | 快速检索 |
| [prompts/librarian.md](prompts/librarian.md) | 文档查询 |
| [prompts/looker.md](prompts/looker.md) | 多模态识别 |
| [prompts/hephaestus.md](prompts/hephaestus.md) | 代码编写 |
| [prompts/prometheus.md](prompts/prometheus.md) | 需求规划 |
| [prompts/oracle.md](prompts/oracle.md) | 架构调试 + 终验 |

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

## 发布到 npm

```bash
# 1. 改版本号（package.json），按 Conventional Commits 提交
# 2. 打 tag 并推送（触发 .github/workflows/publish.yml 自动发布）
git tag v0.1.1 && git push origin v0.1.1
# 3. 需要 GitHub 仓库配置 NPM_TOKEN secret（npmjs.com 的 automation token）
```

## 维护状态

- 活跃开发中（v0.1.0）。
- 已知限制：
  - 子智能体模型绑定依赖 `agent/request` waterfall（DSH 未原生支持动态子代理模型，
    见 [dsh-handbook 9.2](https://github.com/deepseek-ai/deepseek-harness/discussions/118)）；
    effort 档位受适配器能力表约束（deepseek-official 仅 off/high/max）。
  - 结论注入依赖 `subagent/end` 事件；`reportFrom` 为子→父补充通道。
  - 单线阻塞由 broker 状态机执行；Sisyphus 需遵守编排规则（由 system-prompt section 约束）。

## 许可证

[MIT](LICENSE) © dsh-my-go contributors
