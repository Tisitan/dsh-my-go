<!-- deepseek-harness-meta
{
  "name": "MyGO 编排器",
  "version": "0.2.3-tisitan.20",
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

上游作者开发手记（原项目背景，非 fork 文档）：https://khbit.cn/posts/dsh-my-go/

## 特性

- **星型拓扑**：所有子智能体（叶子）不直接通信，全部经 Sisyphus 中转。
- **单线阻塞**：同一时段每个编排会话内只有一个子智能体在运行，便于审查，增强可观测性；tisitan.10 起各会话流水线相互独立、互不排队。
- **7 个专业工种**：Hermes（快速执行）、Explore（检索）、Librarian（文档）、Multimodal Looker（看图）、Hephaestus（写代码）、Prometheus（规划）、Oracle（最后手段：疑难/极端复杂问题的架构调试，仅当其他工种无法胜任时启用；验收是 Sisyphus 的质检本职）。
- **按工种绑定模型**：快活小工配便宜模型，重活配强模型——默认不绑任何模型（继承环境路由），按工种分流见下文「工种模型绑定」。
- **自定义角色名册（tisitan.14）**：内置七工种之外，可在 settings 的 `roles` dict 自由定义角色（键名 `^[a-z][a-z-]*$`），每个角色可配独立的模型绑定 / persona / 工具过滤；`go_work` 的 `agent` 参数接受名册内任意角色名，详见下文「自定义角色」。
- **内置角色 persona 覆盖（tisitan.15）**：除 Sisyphus 外的内置工种可在设置页覆盖编辑 persona（留空 = 用 prompts/ 档案人设），与自定义角色一样经 spawn 官方通道注入；「载入文件默认」按钮（tisitan.16）一键拉取档案原文进编辑框，覆盖前不再盲写。
- **角色卡导入导出（tisitan.15）**：每张角色卡可导出/导入全字段 JSON（剪贴板，失败降级 prompt 复制），导入前客户端校验（非法键名/重名/脏 JSON 等拒绝）。
- **面板花名册常驻区（tisitan.15）**：编排面板底部常驻显示活角色名册（内置 + 自定义），与 `orchestration_status` 同源同格式。
- **4 个通信工具**：`go_work`（派发）、`continue`（驳回/追问）、`need_help`（求助挂起）、`forward`（转发），加 `orchestration_status`（状态总览）和 `list_subagents`（列出已有 sub-agent 及其最后 prompt）。
- **步骤级调度**：Prometheus 把需求拆成步骤序列，Sisyphus 逐步骤选择最省 token 的工种——**按任务难度分配（不按需求难度）**：指令明确、步骤具体的执行活优先派 Hermes，需要设计/推理的才升级 Hephaestus，仅疑难/极端复杂才到 Oracle；同工种上下文连续则 `continue` 复用。
- **Sisyphus 质检**：结论不达标驳回重做，被驳回的子智能体保留上下文继续。
- **WebUI 配置**：每个工种的模型 / 思考档位 / DSV4P0813 补丁开关 / 备选链，均可在 DSH 设置页配置；tisitan.13 起含工具屏蔽（Tool Mask）双列表编辑器，tisitan.14 起含「自定义角色」CRUD 卡片区，tisitan.15 起全卡片手风琴折叠，tisitan.19 起主选与备选链合并为单一「模型优先级列表」（#1 主选带徽章，备选 ↑ 到顶一键扶正）。
- **DSH 适配**：权限请求、问题询问由主智能体执行。
- **节省主会话上下文**：Sisyphus 主会话不加载 Skill 工具（子智能体仍保留），跳过 Skill catalog 注入以压缩主会话上下文。
- **DSV4P0813 补丁开关**：内置过拟合补丁，让 DeepSeek V4 Pro 0813 发挥最大的实力。

_真正实现 “按量付费”_

## 环境要求

### 理论最低要求

- DeepSeek Harness `0.1.0-rc.6`+（基于 `agent/request` waterfall 与 continuable subagent API）
- Node.js 22.15+（`node:zlib` 的 zstd 压缩接口实需 22.15+/23.8+，与 package.json `engines` 一致）
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
- 单线阻塞 = broker 编排状态机按编排会话分桶（tisitan.10 起 Map&lt;会话id&gt; 各持一份 当前运行 / 队列 / 求助 / 历史）。
- 详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 配置

host 半（lib）注册 settings 命名空间 `dsh-my-go`，client 半提供设置页
（WebUI「MyGO 编排」），broker 半只读取：

| 配置项                          | 默认值         | 说明                                                                    |
|---------------------------------|----------------|-------------------------------------------------------------------------|
| `<type>.provider`               | 不指定（继承） | 该工种的 provider 路由；缺省时继承父会话渠道                            |
| `<type>.model`                  | 不指定（继承） | 该工种的模型；缺省时继承父会话模型                                      |
| `<type>.reasoningEffort`        | 不指定         | 期望思考档位（如 high/max）；**只在模型实际支持时应用**，否则走模型默认 |
| `<type>.dsv4p0813`              | false          | 是否对该工种启用 DSV4P0813 两阶段引导补丁                               |
| `<type>.fallbacks`              | 空（不启用）   | 备选链 [{provider, model}]，主绑定失败时按序重派                        |
| `roles`                         | 空（仅内置工种）| 自定义角色名册 dict：`roles.<role>` 键名须 `^[a-z][a-z-]*$`，绑定字段同 `<type>.*`，另加 persona / toolFilter（见下方「自定义角色」） |
| `toolMask.deny`                 | 空（不屏蔽）   | 工具名数组：从 MyGO 会话目录屏蔽指定工具（见下方「工具屏蔽」）           |

`<type>` 取值：sisyphus / hermes / explore / librarian / looker / hephaestus /
prometheus / oracle。键为扁平结构（如 `hermes.model`，无 `agents.` 前缀），
与下方 YAML 示例及设置页 schema 一致。

### 工种模型绑定

自 tisitan.7 起，插件**不再内置任何模型名/渠道名**——所有工种默认空绑定，
子代理完全继承环境默认路由（与 Sisyphus 同渠道同模型）。需要按工种分流
（快活走便宜模型、重活走强模型）时，在 DSH 设置页「MyGO 编排」逐工种填写，
或直接编辑 `~/.dsh/settings.yaml`：

```yaml
dsh-my-go:
  hermes:
    model: your-cheap-model        # 高频体力活：便宜快模型
  explore:
    model: your-cheap-model
  librarian:
    model: your-cheap-model
  looker:
    model: your-multimodal-model   # 看图需要多模态能力
  hephaestus:
    provider: your-gateway         # provider 缺省 = 继承父会话渠道
    model: your-mid-model
    reasoningEffort: high          # 仅当该模型实际支持此档位时应用
  prometheus:
    provider: your-gateway
    model: your-strong-model
    reasoningEffort: max
  oracle:
    provider: your-gateway
    model: your-strong-model
    reasoningEffort: max
```

字段缺省即不覆盖。`model` 在派发前会经 `llm.listModels` 校验真实存在
才应用（不存在则跳过并回落父会话模型，日志 warn）；`reasoningEffort`
跟随 DSH 模型目录，模型不支持所配档位时留空走适配器默认。

建议分工：Sisyphus / Hephaestus 用中等能力模型，Hermes / Explore /
Librarian / Looker 用便宜轻量模型，Prometheus / Oracle 用最强模型。

### 自定义角色（roles，tisitan.14 起）

内置七工种之外，可在 `roles` dict 定义自己的角色——每个角色拥有与内置
工种相同的绑定字段（provider / model / reasoningEffort / dsv4p0813 /
fallbacks），另可加 `persona`（人设文本，经 spawn 官方通道注入子代理）
与 `toolFilter`（`allow` / `deny` 工具名清单）。角色键名强制
`^[a-z][a-z-]*$`：

```yaml
dsh-my-go:
  roles:
    reviewer:                       # 键名：^[a-z][a-z-]*$
      provider: your-provider
      model: your-model
      reasoningEffort: high
      persona: 你是严谨的代码评审员，只查逻辑硬伤。
      toolFilter:
        allow: [read, glob, grep]   # 只放行名单内工具；只宜写核心稳定工具名
```

- **派发**：`go_work` / `forward` 的 `agent` / `target` 参数接受名册内
  任意角色名（未注册名结构化报错并附当前可用清单）；
  `orchestration_status` 尾部展示活花名册。
- **迁移**：旧顶级七工种键在装载与热更时自动无损搬入 `roles`（幂等；
  失败保留原配置仅 warn），YAML 手写的旧形状无需立即改写。
- **注意**：`toolFilter` 随 descriptor v2 持久化、冷恢复按原样重放——
  只宜写核心稳定工具名，重启后工具集变化（如 MCP 未连接）会导致
  冷恢复失败（NOT_RESUMABLE）。

设置页「MyGO 编排 → 自定义角色」提供 CRUD 卡片区：模型优先级列表
（tisitan.19 起主选 + 备选链合并编辑）、persona 与 toolFilter，键名即
时校验，与 YAML 手工编辑等价。

### 备选链（fallbacks，自动重派）

每个工种可配 `fallbacks` 备选链：链首是上文的 `provider`/`model` 主绑定
（attempt 0），其后每条备选依次为 attempt 1、2、…：

```yaml
dsh-my-go:
  hermes:
    provider: your-primary-gateway
    model: your-cheap-model
    fallbacks:                      # 主绑定失败时依序切换
      - provider: your-backup-gateway
        model: your-cheap-model-b
      - provider: your-backup-gateway
        model: your-cheap-model-c
```

重派语义：

- **触发**：子代理以 `error` 终局（404/模型不存在等立即败，或 429/5xx/
  超时在 DSH 内建重试耗尽后）且错误分类器放行。用户中断/abort 类绝不切换；
  附因读不到（档案缺失）但有链时保守切换，日志注明「未读到附因，保守切换」。
- **动作**：同 prompt、同父会话、同工种自动重派，`agentOptions` 覆盖为备选
  条目；不入队、不占新槽位（原槽位语义内换键），不与单线阻塞/队列交互。
- **预检**：备选条目同样经 `llm.listModels` 校验，无效条目 warn 跳过并尝试
  下一条；链尽即止（attempt 严格递增，绝无无限循环），全部失败落既有失败
  历史并保留失败附因。
- **留痕**：每次切换在历史/台账标注 `[备选 n/m] 失败 → 自动切换备选
  provider/model 重派`，并向原父会话推送一行重派通知。
- **已知限制**：备选重派的历史结论措辞先于 spawn 成功落史——重派 spawn
  失败时不改写已落历史，以 `console.error` 留痕并向原父会话推送修正通知。

设置页「MyGO 编排」每工种卡片内置模型优先级列表编辑器（tisitan.19 起
主选与备选链合并）：#1 即主选（带徽章，空值=跟随 Sisyphus），#2..N 即
备选链顺序；逐行编辑 provider/model、↑↓ 跨边界调整链序（备选 ↑ 到顶 =
一键扶正为主选，删 #1 则 #2 自动扶正，列表至少保留主选位 1 条）、模型
下拉按所选渠道过滤，与 YAML 手工编辑等价（保存时拆解 #1→provider/
model、#2..N→fallbacks，存储形状零变更）。

### 工具屏蔽（tool-mask）

把指定工具从 MyGO 会话目录里藏起（对 Sisyphus 与全部子代理同时生效），
例如屏蔽环境特定、不想让编排体系碰到的 MCP 工具。settings 键为
`toolMask.deny`（工具名数组），YAML 写法：

```yaml
dsh-my-go:
  toolMask:
    deny:
      - mcp__your-origin__tool_a    # 按注册名屏蔽，缺席工具自动跳过（warn）
      - mcp__your-origin__tool_b
```

设置页「MyGO 编排 → 工具屏蔽（Tool Mask）」提供双列表编辑器（tisitan.13
起）：左列「当前可用工具」经 `listTools` RPC 实时枚举注册表（保留名
`run_code` 服务端过滤、不可屏蔽），支持名称过滤；右列「已屏蔽」中不在当前
花名册的条目带「未连接」灰徽章——保留不删，MCP 重连后即被屏蔽；花名册外
工具可手填添加。与 YAML 手工编辑等价，空清单提交即视为不屏蔽。

优先级与生效时机：

- **优先级**：agent.cordis.yml tool-mask 行的 `config.deny`（显式覆盖，最高，
  空数组=显式屏蔽空）＞ settings `toolMask.deny`（设置页写入）＞ 空默认。
- **生效时机 = 新会话**：屏蔽清单在 preset 挂载（会话组装）时解析一次，
  变更只对之后新建的会话生效，当前会话不受影响。
- **容错**：缺席工具按名跳过（warn 留痕），绝不炸 preset 挂载；每次挂载
  输出一行汇总日志（屏蔽数量 + 来源）。
- **迁移**：tisitan.12 及之前版本内置的 `DEFAULT_DENY` 私有示例清单已在
  tisitan.13 清空——升级后默认不屏蔽任何工具，原用户请在设置页重新配置。

### 插件 config 键（broker 行为调参）

以下为插件级 config（`dsh plugin add` 的 config / bundle 层），与上面的
settings 命名空间正交；默认值即旧硬编码口径（tisitan.8 起截断阈值可配）：

> ⚠️ **仅 host 半（lib）读取这些 config 键**。MyGO 主形态（preset 会话）由
> broker 行驱动，不暴露任何插件 config——在 preset 会话上调参不改变其行为；
> 这些键只对未装配 MyGO preset 的 fallback 部署形态生效。

| config 键               | 默认值 | 说明                                                                 |
|-------------------------|--------|----------------------------------------------------------------------|
| `disposeEndGraceMs`     | 500    | `agent/disposed` 后等待 `subagent/end` 的宽限期，超时兜底清槽推进队列 |
| `queueRetryBaseMs`      | 1000   | 队列派发失败回补后的线性退避基数（1×/2×/3×，上限 3 次后放弃）         |
| `statusHistoryLimit`    | 12     | `orchestration_status` 展示的历史条数                                 |
| `statusConclusionMax`   | 400    | `orchestration_status` 单条结论截断长度（**failed 记录不截断**）      |
| `helpContentMax`        | 240    | `orchestration_status` 单条求助内容截断长度                           |
| `subagentPromptMax`     | 200    | `list_subagents` prompt 摘要及会话 label 的 prompt 摘要截断长度       |

编排台账（history，上限 200 条）持久化在
`<DSH_HOME>/dsh-my-go/orchestration-ledger.json`（`DSH_HOME` 缺省
`~/.dsh`），进程重启后读回——跨重启 `continue` 已完工子代理经 harness
coldResume 续聊可用。

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
| [prompts/oracle.md](prompts/oracle.md)         | 架构调试（疑难兜底）|

## 目录结构

```
dsh-my-go/
├── AGENTS.md              # 本项目的编排规格（Sisyphus 系统）
├── README.md              # 本文档
├── package.json           # npm 包声明（dsh.bundle.patch → cordis.patch.yml）
├── cordis.patch.yml       # bundle patch（dsh plugin add 后自动挂载 host 插件）
├── lib/index.js           # npm 包 host 半（编排工具 + 状态机 + 模型绑定，import preset/shared/）
├── src/                   # client 半源码（tisitan.15 起装配层 + 模块化）
│   ├── client.js          #   装配层（57 行）：接线五模块 + 注册 DSH slots
│   ├── client-constants.js#   共享常量（色板/标签/intent 文案，零 React）
│   ├── panel-tree.js      #   树状图面板 + 600ms 轮询 + 自动跳转（花名册常驻区）
│   ├── settings-core.js   #   设置页主组件（工种卡手风琴 / persona 覆盖 / 保存行）
│   ├── roles-editor.js    #   自定义角色区（CRUD / persona 覆盖 / 导入导出）
│   ├── tool-mask-editor.js#   工具屏蔽双列表编辑器
│   ├── chain-rows.js      #   模型优先级列表编辑器纯函数（node --test 与 bundle 内联同源）
│   ├── tool-mask-rows.js  #   工具屏蔽纯函数（同上）
│   ├── roster-rows.js     #   自定义角色纯函数（同上，含卡摘要/导入导出/persona 覆盖）
│   └── panel-format.js    #   面板格式化纯函数（同上）
├── scripts/build-client.mjs  # esbuild 打包 client → dist/client.js
├── scripts/dump-session.mjs  # 会话档案取证 CLI（tisitan.16，npm run dump:session）
├── test/                  # 冒烟 + 189 例单测（13 个 *.test.mjs）
├── dist/                  # 构建产物（发布时生成）
├── preset/                # agent preset「MyGO!!!!! 模式」（复制到 ~/.dsh/.agent-presets/）
│   ├── preset.yml
│   ├── agent.cordis.yml
│   ├── shared/            # 双半共享源（tisitan.15）：constants / failure / archive /
│   │                      #   roles / orchestration / misc（零 @deepseek-ai、零 ctx）
│   └── tools/broker.mjs   # 自包含 host 插件（工具 + 模型绑定 + 状态机）
├── prompts/               # 8 个智能体 prompt
└── docs/                  # ARCHITECTURE.md / FORK-GUIDE.md / archive/（审查报告归档）
    └── legacy-broker-ts/  #   归档 TS 参考实现（停维护，原根目录 broker/）
```

## 贡献

```bash
git clone git@github.com:Tisitan/dsh-my-go.git
cd dsh-my-go
bun install
bun run build:client    # 构建 client bundle
bunx tsc --noEmit       # 类型检查
bun run test            # 冒烟 + 189 例单测套件
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
