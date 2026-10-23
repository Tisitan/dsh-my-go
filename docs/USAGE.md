# 使用与维护指南

[返回 README](../README.md) · [配置参考](CONFIGURATION.md)

- [安装与验证](#安装从-git-clone) · [升级](#升级) · [卸载](#卸载)
- [编排流程](#编排流程) · [用量与费用](#用量与费用) · [故障排查](#故障排查--faq)
- [目录结构](#目录结构) · [贡献](#贡献) · [手动兜底安装](#手动兜底安装)

## 安装（从 git clone）

前提：Node.js 22.15+，已安装 DSH，已配置至少一个可用的 LLM provider，Git 与 pnpm 位于 PATH 中。宿主安装方法见 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

DSH 相关包的 peer 范围为 `>=0.1.7-alpha.1 <0.3.0`，以 [package.json](../package.json) 为准。这是依赖声明范围，不代表所有宿主版本都已完成实机验证。

将 `<your-dsh-plugins>` 替换为长期保留的绝对路径：

```bash
git clone --depth 1 https://github.com/Tisitan/dsh-my-go.git "<your-dsh-plugins>/dsh-my-go"
cd "<your-dsh-plugins>/dsh-my-go"
npm ci
npm run build
dsh plugin --profile web add "<your-dsh-plugins>/dsh-my-go"
dsh web
```

`dsh plugin` 使用 pnpm 管理 profile 依赖。若 `pnpm -v` 不可用，先安装 pnpm，例如 `npm install -g pnpm`。

本地目录通过链接安装到 profile。运行时按 clone 的真实路径解析依赖，因此 `npm ci` 要在 clone 目录执行。安装后移动、改名或删除该目录会使链接失效；更换路径时先 remove，再从新路径 add。

包的 bundle 声明会应用两份 patch：[`cordis.patch.yml`](../cordis.patch.yml) 挂载 host 插件；[`preset/agent.patch.yml`](../preset/agent.patch.yml) 声明 **MyGO!!!!! 模式**。预设与提示词在包内直接读取，无须复制到用户目录，也不需要手写 insert。

## 验证安装

检查三项：profile 的依赖中存在 `dsh-my-go` 本地链接、`dsh.profile.bundles` 登记了包名、`node_modules/dsh-my-go` 指向 clone 目录。下面使用默认的 web profile；自定义 profile 时相应替换路径。

macOS / Linux：

```bash
mygo_profile="${DSH_HOME:-$HOME/.dsh}/profiles/web"
node -e 'const p = require(process.argv[1]); console.log(p.dependencies?.["dsh-my-go"]); console.log(p.dsh?.profile?.bundles?.includes("dsh-my-go"))' "$mygo_profile/package.json"
ls -l "$mygo_profile/node_modules/dsh-my-go"
```

前两项应显示指向 clone 的 `link:` 依赖与 `true`，最后一项应显示正确的链接目标。

Windows PowerShell：

```powershell
$mygoHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$mygoProfile = Join-Path $mygoHome 'profiles\web'
$mygoPackage = Get-Content (Join-Path $mygoProfile 'package.json') -Raw | ConvertFrom-Json
$mygoPackage.dependencies.'dsh-my-go'
$mygoPackage.dsh.profile.bundles -contains 'dsh-my-go'
Get-Item (Join-Path $mygoProfile 'node_modules\dsh-my-go') | Select-Object Name, LinkType, Target
```

Windows 通常使用 junction，macOS / Linux 使用 symlink。两者都指向原目录，移动原目录都会失效。预设在 Windows 加载 PowerShell 工具，其他平台加载 Bash 工具。

完成后新建会话，选择 **MyGO!!!!! 模式**，让主编阅读一个项目并说明模块划分。从侧栏 🧭 打开编排面板，检查任务能否派发、汇报并进入历史。

## 升级

先停止旧的 DSH Web 实例，再在原 clone 目录运行：

```bash
git pull --ff-only
npm ci
npm run build
```

完成后运行 `dsh web`。无须重新 add 或手工同步预设。若本地有修改导致快进失败，先处理修改与冲突，不要直接覆盖自己的配置。

`dist/client.js` 随 release commit 入库；开发提交可能未同步产物。上面的构建步骤确保当前源码与客户端一致，`npm ci` 则同步锁文件中的依赖。

## 卸载

```bash
dsh plugin --profile web remove dsh-my-go
```

重启 DSH 后生效。卸载移除 profile 依赖与 bundle 登记，clone 目录及 `<DSH_HOME>/dsh-my-go/` 中的历史数据仍保留。

## 编排流程

Sisyphus 是主会话的调度与质检角色；子代理是持有独立 DSH session 的任务执行单元。一个工种可以有多个执行实例，工种名本身不是会话 ID。

1. 主编通过 `go_work` 派发任务，broker 按工种选择模型与泳道。
2. 读泳道包含 `explore` / `librarian`；其余内置工种（包括 Apelles）与自定义角色进入写泳道。各泳道按容量独立计数，lane 内 FIFO。
3. 子代理需要帮助时用 `need_help` 挂起并向主编报告；主编可补充信息、代为执行、重派或转发。
4. 报告外部化开启时，子代理调用 `report_submit` 完成交付。主编收到结论、证据、未决项和取阅指引，需要全文时调用 `report_fetch`。
5. 验收不通过时，主编用 `continue` 让原子代理保留上下文继续修改。

随包预设两个泳道各 3 槽。只有 `readPoolSize=1` **且** `writePoolSize=1` 时才退化为全局单线。并行写任务需要主编确认写集不相交且无数据依赖，泳道容量不是文件锁。

| 工具 | 用途 |
|---|---|
| `go_work` | 派发新子代理 |
| `continue` | 给已有子代理补充任务或要求返工 |
| `need_help` | 子代理向主编求助并挂起 |
| `forward` | 主编转发求助内容给另一角色或已有子代理 |
| `orchestration_status` / `list_subagents` | 查询编排状态与子代理 |
| `heartbeat` | 查询、暂停或恢复心跳机制 |
| `report_submit` / `report_fetch` | 提交报告、按行读取报告；随报告外部化开关注册 |
| `chain_start` / `chain_resolve` | 声明接力链、处理挂起节点；随接力链开关注册 |

完整通信契约与质检要求见 [AGENTS.md](../AGENTS.md)。接力链的 gate、报告闸门与错误处理见 [配置参考](CONFIGURATION.md#接力链relay-chains)。

`continue` / `forward` 经宿主投递适配层执行：queued 使用可用的 FIFO 通路；宿主无法提供排队通路时退为 steer，返回实际 `mode` 并记录警告。各工种继承宿主工具权限，旧 `toolFilter` 不再应用。原生邻接消息工具在 MyGO 会话中被限制，子代理不能绕过主编自行派生或联络其他子代理。

模型绑定通过创建时的 `agentOptions` 与 `agent/request` waterfall 生效；背景可参考 [DSH handbook 9.2](https://github.com/deepseek-ai/deepseek-harness/discussions/118)。思考档位仅在宿主模型目录声明支持时应用，不支持则使用模型默认值。

## 术语与存储

| 名称 | 含义 |
|---|---|
| 主编 | Sisyphus，默认使用主会话选择的模型；设置键为顶级 `sisyphus` |
| 工种 / 花名册 | 内置与自定义角色集合，运行时来源为 `preset/shared/roles.mjs` |
| 泳道 | 子代理并发槽的分组，由 `readPoolSize` / `writePoolSize` 控制 |
| 报告板 | 保存完整报告，主编通过 `report_fetch` 切片读取 |
| 台账 | 持久化的编排历史与接力链状态，用于面板及冷恢复 |
| 拍距 | 主编心跳检查间隔；默认 250 秒，心跳默认关闭 |
| 前瞻窗口 H | 配置卡的成本辅助计算：`(输入价 ÷ 缓存命中价 − 1) × 拍距`；不替代供应商的实际计费规则 |

数据位于 `<DSH_HOME>/dsh-my-go/`，`DSH_HOME` 缺省为 `~/.dsh`。编排台账文件为 `orchestration-ledger.json`，每个父会话最多保留 200 条历史、最多保留 200 个父会话桶；写入采用 250ms 防抖与临时文件 rename，卸载时补写未完成的变更。报告板与观测日志也位于该插件目录中。

## 用量与费用

编排面板的用量区可按模型、子代和合计查看 token，包含主会话自身用量。费用根据宿主上报的用量和[用户单价表](CONFIGURATION.md#用户设置)估算，对账以 provider 账单为准。

| 显示 | 含义 |
|---|---|
| `—` | 用量未上报或费用未定价，不能当作 0 |
| `≥` | 已知部分的下界；可能缺少历史子代、用量分桶、可读归档或单价 |

历史裁剪后，恢复会话或重启不会自动补齐旧记录。无法确认历史完整的旧台账会保守显示下界；若宿主仍能提供完整子代目录（catalog），且对应归档可读，统计会补入这些子代的历史用量。仍有缺失或无法确认完整时，继续显示 `≥`。

费用只累计已知用量中已定价的部分。有实际 token 消耗的模型或缓存分桶未配单价时，其费用不计入，并在可计算的合计前显示 `≥`；全部模型都未定价时只展示 token。补齐单价可更新估算，但不会补回缺失的用量数据。

## 面板设计演示

![早期单写槽面板设计演示](design/graph-running.png)

此图来自 [`docs/design/`](design/)，是早期单写槽**设计演示，不是当前产品的真实运行截图**。当前实现依据配置显示写泳道多槽。历史交互稿见 [panel-graph-demo.html](design/panel-graph-demo.html)，其余状态图也属于该设计稿。

面板展示运行项、队列、求助、历史与花名册。快照轮询有在飞请求门和失败退避（600 → 1500 → 3000ms）；Web 服务缺席的 headless / CLI 环境不注册面板路由。实现说明见 [架构文档](ARCHITECTURE.md) §3。

## 故障排查 / FAQ

| 现象 | 检查与处理 |
|---|---|
| `pnpm` 未找到、安装命令退出 127 | 先确认 `pnpm -v` 可用，`dsh plugin` 依赖它管理 profile |
| `dsh-my-go: failed to import` / 找不到 schemastery | 在 **clone 目录**执行 `npm ci`，检查链接目标存在，再重启 DSH；仅在 profile 目录补依赖不能修复 clone 侧解析 |
| 预设选择器没有 MyGO!!!!! 模式 | 按[验证安装](#验证安装)检查链接和 bundle 登记，确认包内 `preset/agent.patch.yml` 可读取 |
| 面板显示「编排桥未就绪」 | 确认当前会话使用 MyGO 预设；host 单独挂载而 broker 未挂载时面板会降级为空态，启动中的短暂无桥状态也可能正常 |
| 面板请求返回 405 或持续红字 | 升级插件并重新构建客户端、重启宿主；当前实现自行注册前缀路由，避开旧宿主 RPC 注册接口问题 |
| 模型下拉列表为空 | 查看渠道行内错误并确认宿主 provider 配置；连接恢复或宿主配置更新后目录会重新加载，也可手填真实模型 ID，见[模型绑定](CONFIGURATION.md#工种模型绑定) |
| 配置保存后仍显示待保存或失败 | 保存期间的新编辑仍是草稿，需要再次保存；通道失败后可重试，外部修改冲突按[用户设置](CONFIGURATION.md#用户设置)处理；检查页面是否只读 |
| 重启后 `continue` 提示 unknown sub-agent id | 确认两次启动使用相同 `DSH_HOME`；也检查历史是否已超过保留上限 |
| 修改泳道 / 接力链参数不生效 | 修改包内 `preset/agent.patch.yml` 的 **broker 行 config**，重启并新建 MyGO 会话；这些不是用户设置字段 |
| 修改用户目录中的旧 preset 副本无效 | 本插件从包内读取预设，不使用旧安装副本 |
| 找不到旧侧栏设置页 | 当前入口为 **DSH Web → 插件 → dsh-my-go → 配置区**；若仍显示旧 UI，重建 `dist/client.js` 并重启 |

关于配置回落、热更、角色迁移及费用缺桶的具体规则，见 [配置参考](CONFIGURATION.md)。

## 目录结构

| 路径 | 职责 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | 编排行为、通信协议与仓内维护纪律 |
| [`package.json`](../package.json) / [`cordis.patch.yml`](../cordis.patch.yml) | 包入口、依赖范围与 host bundle 声明 |
| [`lib/`](../lib/) | host 配置 schema、面板端点与用量聚合 |
| [`src/`](../src/) | Web 面板、星图、配置卡与纯计算模块 |
| [`dist/client.js`](../dist/client.js) | Web 客户端构建产物 |
| [`preset/agent.patch.yml`](../preset/agent.patch.yml) | MyGO 预设、宿主工具与 broker 参数 |
| [`preset/tools/`](../preset/tools/) | broker 装配、调度、投递、收尾、台账、心跳与接力链 |
| [`preset/shared/`](../preset/shared/) | 角色、状态机、报告、路径、归因与通信适配等共享模块 |
| [`prompts/`](../prompts/) | Sisyphus 与 8 工种 persona，以及公共搜索纪律 |
| [`scripts/`](../scripts/) | 客户端构建、`npm run dump:session` 会话取证脚本 |
| [`test/`](../test/) | 冒烟、单元与集成测试、共享 mock 与等待工具 |
| [`docs/`](./) | 使用、配置、架构、维护与设计文档 |
| [`docs/legacy-broker-ts/`](legacy-broker-ts/) | 停维护的 TS 参考实现，不参与运行与生产构建 |

具体模块到功能的映射见 [架构导览](FORK-GUIDE.md)。[历史规划](plans/)与[审查归档](archive/)应按写作时点阅读，不作为当前实现的替代说明。

## 贡献

```bash
npm ci
npm run lint
npm run typecheck:archive
npm test
npm pack --dry-run
```

`npm test` 会构建客户端，运行加载与产物新鲜度冒烟，再运行 `test/**/*.test.mjs`。`typecheck:archive` 仅覆盖 `docs/legacy-broker-ts/src`，不检查生产 JS/mjs。测试数量以本次机器输出为准，确认宿主契约哨兵 `test/compat-alpha4.test.mjs` 是否实际执行；测试通过不代表完成了 WebUI 实机验收。

CI 的 Node 版本取自 [`.nvmrc`](../.nvmrc)，配置了 Ubuntu / Windows 矩阵。修改宿主交互时，按 [开发沙箱指南](DEV-SANDBOX.md) 使用独立 `DSH_HOME` 验证，避免影响正在使用的环境。

### 等待口径

- **正向等待**：用 `test/helpers/mock-ctx.mjs` 的 `waitFor(谓词)` 等待断言真正读取的可观测状态。等待占位记录换成真实子代理时，不能只等派发数量增加。
- **负向窗口**：验证「没有发生某件事」时可以保留固定 `drain(N)`，但先 `waitFor` 到正向终态，再开始计时。
- **临时目录清理**：台账写入有 250ms 防抖。使用 `removeHomeWithRetry` 避免与写盘竞态；它只对 ENOTEMPTY / EBUSY / EPERM 做有界退避。

broker 事件发射与心跳信号点的维护要求见 [AGENTS.md](../AGENTS.md)；发布步骤与 dist 入库规则见 [维护手册](FORK-GUIDE.md#发布流程发版固定动作dist-随-release-commit-入库)。

## 手动兜底安装

仅在 `dsh plugin` CLI 不可用时采用。优先修复正常安装路径；手动方式需要自己维护链接、依赖与 bundle 登记。

前提：仓库已 clone 到稳定绝对路径 `<REPO>`，在该目录执行过 `npm ci` 与 `npm run build`。以下使用默认 `~/.dsh`，自定义 `DSH_HOME` 时替换路径。不要覆盖已有的 `node_modules/dsh-my-go`。

1. 创建链接。父目录 `node_modules` 应存在，链接最后一层不要提前创建。

   ```bat
   :: Windows cmd
   mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-my-go" "<REPO>"
   ```

   ```bash
   # macOS / Linux
   ln -s "<REPO>" "$HOME/.dsh/profiles/web/node_modules/dsh-my-go"
   ```

2. 编辑 profile 的 `package.json`，**保留其他配置**，向 `dependencies` 添加本地 `link:`，向 `dsh.profile.bundles` 数组追加 `dsh-my-go`。下面仅展示需要合并的字段；Windows 使用正斜杠和盘符，POSIX 使用绝对路径。

   ```json
   {
     "dependencies": {
       "dsh-my-go": "link:C:/path/to/dsh-plugins/dsh-my-go"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-my-go"
         ]
       }
     }
   }
   ```

3. 重启 `dsh web`，按[验证安装](#验证安装)检查登记，并新建 MyGO 会话。

回到正常安装方式时，先 `dsh plugin --profile web remove dsh-my-go`，再按安装步骤 add。若旧装法还在 profile 的 `cordis.patch.yml` 中手写了 `id: dsh-my-go` 的 insert，需要移除那条旧行，避免与 bundle 自动应用的同名行重复。
