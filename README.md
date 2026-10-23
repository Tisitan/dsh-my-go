<!-- deepseek-harness-meta
{
  "name": "MyGO 编排器",
  "version": "0.6.0",
  "tags": ["preset", "模式预设"],
  "description": "把每一步路由到最合适模型的智能体编排器"
}
-->

![MyGO 多智能体编排器：由 Sisyphus 统一调度的角色网络](docs/assets/readme-hero.png)

# MyGO!!!!! · DSH 多智能体编排

**让合适的模型执行合适的步骤，由 Sisyphus 统一调度与验收。**

dsh-my-go 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的多智能体编排预设。它把一个主会话与 8 个专业工种组织起来，提供模型分流、读写泳道、报告板和 Web 面板。本仓由 Tisitan 独立维护。

[快速开始](#快速开始) · [配置参考](docs/CONFIGURATION.md) · [使用与排错](docs/USAGE.md) · [更新日志](CHANGELOG.md)

## 一眼看懂

你把任务交给主编 **Sisyphus**。它拆分步骤，派给合适的工种，检查结果，必要时要求同一个子代理继续修改。子代理把完整报告写入报告板，主编先读概要，需要细节时再按行取回。

```text
                         用户
                          │
                 Sisyphus · 调度与验收
                    ╱             ╲
         读泳道 · 最多 3 槽        写泳道 · 最多 3 槽
         Explore / Librarian      其他内置与自定义工种
                    ╲             ╱
                     报告板与状态面板
```

子代理之间的协作由主编和 broker 中转；报告全文无需逐次进入主编上下文。

## 特性

- **按工种绑定模型**：为检索、执行、实现和疑难分析分别选模型，支持备选链、persona 覆盖与自定义角色。
- **读写双泳道**：随包预设读池 3 槽、写池 3 槽，每个编排会话最多同时运行 6 个子代理；各会话独立排队。
- **报告落板**：子代理提交结论、证据与未决事项，完整报告持久化，主编按需读取。
- **接力链**：声明连续执行的步骤，报告作为下一步的数据输入；需要审阅的节点暂停等待主编裁决。
- **Web 配置与观测**：配置角色与模型，查看运行、队列、求助、历史及用量；费用按宿主用量和用户填写的单价估算。

<a id="8-工种名册"></a><a id="智能体-prompt"></a>

## 角色分工

| 角色 | 适合的工作 |
|---|---|
| **[Sisyphus](prompts/sisyphus.md)** | 主会话：拆分步骤、调度、验收与裁决 |
| [Hermes](prompts/hermes.md) | 指令明确的执行工作、批量修改、格式化 |
| [Explore](prompts/explore.md) | 搜索代码、定位符号、读取文件 |
| [Librarian](prompts/librarian.md) | 阅读文档、查询 API 与参考资料 |
| [Multimodal Looker](prompts/looker.md) | 理解截图、设计稿和图表 |
| [Hephaestus](prompts/hephaestus.md) | 实现模块、重构代码、编写测试 |
| [Prometheus](prompts/prometheus.md) | 分析需求，整理候选方向与风险，供主编决策 |
| [Oracle](prompts/oracle.md) | 其他工种无法解决的复杂调试与架构问题 |
| [Apelles](prompts/apelles.md) | 可视化、UI 视觉稿与结构 demo |

**插件不预置任何模型或渠道。** 未绑定的工种继承父会话路由；分工收益取决于你实际配置的模型。Looker 需要具备相应视觉能力的模型。

<a id="理论最低要求"></a><a id="开发时的环境"></a>

## 环境要求

- **Node.js 22.15+**，以及已安装的 DSH、Git、pnpm。
- DSH 相关包的 peer 范围：**`>=0.1.7-alpha.1 <0.3.0`**，以 [package.json](package.json) 为准。
- 至少一个已配置且可用的 LLM provider。
- 预设适配 Windows 与 macOS / Linux 的 shell；CI 配置了 Ubuntu / Windows 测试矩阵。声明的依赖范围不等于逐版本实机验证。

## 快速开始

### 安装（从 git clone）

先按 [DSH 官方说明](https://github.com/deepseek-ai/deepseek-harness) 安装宿主。确认 `node -v`、`dsh --version`、`pnpm -v` 可用；缺少 pnpm 时可运行 `npm install -g pnpm`。

将下面的 `<your-dsh-plugins>` 替换为你准备长期保留的**绝对路径**：

```bash
git clone --depth 1 https://github.com/Tisitan/dsh-my-go.git "<your-dsh-plugins>/dsh-my-go"
cd "<your-dsh-plugins>/dsh-my-go"
npm ci
npm run build
dsh plugin --profile web add "<your-dsh-plugins>/dsh-my-go"
dsh web
```

本地安装创建指向 clone 目录的链接。**安装后请保留该目录和其中的依赖**；需要迁移位置时，先 remove，再从新路径 add。构建步骤确保客户端与当前源码一致。

<a id="最小示例"></a><a id="运行"></a>

### 开始一次编排

1. 打开 DSH Web，新建会话，选择 **MyGO!!!!! 模式**。
2. 在 **插件 → dsh-my-go → 配置区** 设置工种模型；也可以先用继承路由体验流程。
3. 对主编说：「阅读这个项目，说明主要模块、运行方式和需要优先检查的问题。」
4. 通过侧栏 **🧭** 打开编排面板，查看任务、求助和交付结果。

预设缺失或导入失败时，按 [安装验证与排错](docs/USAGE.md#验证安装) 检查本地链接、依赖与 bundle 登记。

### 升级

在原 clone 目录运行，再停止旧 Web 实例并重新启动：

```bash
git pull --ff-only
npm ci
npm run build
dsh web
```

### 卸载

```bash
dsh plugin --profile web remove dsh-my-go
```

重启 DSH 后生效。该命令移除 profile 登记，保留 clone 目录。更多平台说明与手动兜底步骤见 [使用指南](docs/USAGE.md)。

<a id="配置面"></a><a id="工种模型绑定"></a><a id="自定义角色roles"></a><a id="备选链fallbacks自动重派"></a><a id="插件-config-键broker-行为调参"></a>

## 配置

常用设置在 Web 配置卡中编辑，点击 **立即保存** 后生效。模型、人设、备选链、心跳与用量单价的字段和 YAML 示例见 [配置参考](docs/CONFIGURATION.md)。

| 设置 | 随包预设 / 初始行为 |
|---|---|
| 工种模型绑定 | 空，继承父会话 |
| 报告外部化 `reportExternalization` | 开启 |
| 读池 / 写池 `readPoolSize` / `writePoolSize` | 各 3 槽 |
| 接力链 `relayChains` | 开启，依赖报告外部化 |
| 主编缓存心跳 `keepAlive.enabled` | 关闭，按需手动开启 |
| 用量单价 `usagePrices` | 空；填写后才能估算对应费用 |

**用户设置与 broker 参数是两层配置。** 模型等用户设置支持热更；泳道容量、报告外部化和接力链在包内 `preset/agent.patch.yml` 的 broker 行配置，新会话组装时读取。删除显式配置时，读写池的代码兜底各为 `1`，接力链兜底为 `false`。

<a id="编排拓扑"></a><a id="泳道双池"></a><a id="接力链"></a><a id="接力链relay-chains默认关"></a><a id="报告板"></a><a id="防旁路"></a><a id="工具屏蔽已迁移至-dsh-tool-guard"></a><a id="维护状态"></a>

## 使用边界

- 写泳道并行需要主编确认任务写集不相交、没有数据依赖；泳道容量本身不提供文件锁。
- 各工种继承宿主工具权限，并保留宿主沙箱、审批及 MyGO 的防递归和通信约束。旧 `toolFilter` 已忽略，用户工具屏蔽交由独立的 dsh-tool-guard 插件。
- `continue` 的排队能力取决于宿主 API；缺少排队通路时会退为 steer，返回实际模式并记录警告。
- 心跳会额外唤醒主编并消耗 token，是否有缓存收益取决于供应商规则与实际任务。

<a id="面板"></a><a id="用量统计"></a><a id="产品术语"></a><a id="架构"></a><a id="故障排查--faq"></a><a id="平台差异小注"></a><a id="目录结构"></a>

## 文档地图

| 想了解什么 | 文档 |
|---|---|
| 安装验证、排错、术语、项目结构 | [使用与维护指南](docs/USAGE.md) |
| 模型绑定、自定义角色、备选链、用量与 broker 参数 | [配置参考](docs/CONFIGURATION.md) |
| 通信工具协议与质检规则 | [AGENTS.md](AGENTS.md) |
| 调度、报告板、接力链与宿主适配的实现 | [架构设计](docs/ARCHITECTURE.md) |
| 模块映射、发布流程与维护注意事项 | [架构导览](docs/FORK-GUIDE.md) |
| 隔离 DSH_HOME、启动宿主与实机验收 | [开发沙箱指南](docs/DEV-SANDBOX.md) |
| 用量聚合、价格与 RPC 契约 | [用量统计设计](docs/usage-stats-design.md) |

[版本记录](CHANGELOG.md) · [历史规划](docs/plans/) · [历史审查](docs/archive/) · [归档 TS 实现](docs/legacy-broker-ts/)

[头图](docs/assets/README.md)是项目概念视觉；[面板设计演示](docs/USAGE.md#面板设计演示)来自早期设计稿，不代表当前产品的真实运行截图。全部工种提示词与公共[搜索纪律](prompts/search-discipline.md)保存在 [prompts/](prompts/)。

<a id="等待口径"></a>

## 贡献

```bash
npm ci
npm run lint
npm run typecheck:archive
npm test
```

`npm test` 会构建客户端，运行加载冒烟与 Node 测试。`typecheck:archive` 仅检查归档 TS 参考实现，不覆盖生产 JS/mjs。测试等待与临时目录清理规则见 [贡献约定](docs/USAGE.md#贡献)。

提交问题时，请提供 DSH / Node 版本、操作系统、最小复现步骤和相关错误信息：[GitHub Issues](https://github.com/Tisitan/dsh-my-go/issues)。

<a id="附录手动兜底安装dsh-plugin-cli-不可用时"></a>

## 致谢

本仓最初分叉自 KuoHu 的 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go) v0.2.3。编排设计参考 [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)（前身 oh-my-openagent），并针对 DSH 调整。

## 许可证

[MIT](LICENSE)。上游原作 © KuoHu，分叉后的开发 © Tisitan。
