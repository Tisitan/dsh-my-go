<!-- deepseek-harness-meta
{
  "name": "MyGO 编排器",
  "version": "0.3.0-tisitan.10",
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
- **面板花名册常驻区（tisitan.15）**：编排面板底部常驻显示活角色名册（内置 + 自定义）。0.3.0-tisitan.9 起面板直读 snapshot 的**结构化 `roster`** 字段（表头、计数、徽章由客户端自持），且三处消费面（面板 / `orchestration_status` / Sisyphus 系统提示简报）共用 `shared/roles.mjs` 的同一份语义源——旧写法是面板按「第一行必为表头」的位置约定切 host 文本、两半各抄一份 18 行摘要逻辑、shared 又是第三种格式，「同源同格式」名不副实。
- **设置页未保存与并发写防线（0.3.0-tisitan.9）**：草稿一旦改动即置 dirty——关页签/刷新前浏览器拦一道、保存行挂「● 未保存」角标，另提供「保存并关闭」（保存失败或冲突时绝不关页）；保存携带加载时读到的 `revision` 凭据，他处（另一页签 / 手改 settings.yaml）先写过则回结构化 `conflict`，前端亮「他处已修改，请重新加载」并锁死保存直到显式重载。
- **面板弹性（0.3.0-tisitan.8 起）**：快照轮询带 in-flight 门与失败退避（600 → 1500 → 3000ms，成功复位），host 端在出口把快照裁到面板可见规模（每桶 history 末 8 条、剔除 prompt 全文）；宿主 `timer` / `sessions` 服务缺席时面板真降级（自管定时器继续刷新 / 只关跳转）并一次性留痕，不再静默停摆。
- **4 个通信工具**：`go_work`（派发）、`continue`（驳回/追问）、`need_help`（求助挂起）、`forward`（转发），加 `orchestration_status`（状态总览）和 `list_subagents`（列出已有 sub-agent 及其最后 prompt）。
- **单宿主编排（tisitan.21 起）**：编排能力唯一由 MyGO preset 提供（broker 半，preset scope），装机后首启自动同步 preset，常态无感；lib-only 部署形态（preset 未装配）不提供编排能力，面板降级为空态 + 花名册常驻。
- **步骤级调度**：Prometheus 把需求拆成步骤序列，Sisyphus 逐步骤选择最省 token 的工种——**按任务难度分配（不按需求难度）**：指令明确、步骤具体的执行活优先派 Hermes，需要设计/推理的才升级 Hephaestus，仅疑难/极端复杂才到 Oracle；同工种上下文连续则 `continue` 复用。
- **Sisyphus 质检**：结论不达标驳回重做，被驳回的子智能体保留上下文继续。
- **WebUI 配置**：每个工种的模型 / 思考档位 / DSV4P0813 补丁开关 / 备选链，均可在 DSH 设置页配置；tisitan.13 起含工具屏蔽（Tool Mask）双列表编辑器，tisitan.14 起含「自定义角色」CRUD 卡片区，tisitan.15 起全卡片手风琴折叠，tisitan.19 起主选与备选链合并为单一「模型优先级列表」（#1 主选带徽章，备选 ↑ 到顶一键扶正），0.3.0-tisitan.9 起渠道与模型两栏是**可手填输入框**（input+datalist：清单在场点选、清单拉不到时直接键入，兑现页面一直许诺的「也可以直接输入自定义值」），且某渠道清单读取失败会行内标出原因（不再与「该渠道真的没模型」同形）。
- **DSH 适配**：权限请求、问题询问由主智能体执行。
- **节省主会话上下文**：Sisyphus 主会话不加载 Skill 工具（子智能体仍保留），跳过 Skill catalog 注入以压缩主会话上下文。
- **防旁路加固（0.3.0-tisitan.4 起）**：上游邻接消息三件套（`send_message` / `list_agents` / `interrupt_agent`）对 Sisyphus 与全部子代理双侧 deny——绕过台账与单线锁的旁路在工具目录层就不存在，子代理唯一的上报通道是 `need_help`；`continue` 的 `queued` 档走真 FIFO 队列（alpha.4 的 `sendMessage` 只有 steer，排队通路经 internal 符号队列适配器复活），`steer`/`abort` 也一律经 `subagents` 门面投递。原生派生工具（`subagent` / `subagent_fork` / `workflow` / `ralph`）仅在 Sisyphus 顶层保留为逃生舱，子代理侧照旧摘除。
- **DSV4P0813 补丁开关**：内置过拟合补丁，让 DeepSeek V4 Pro 0813 发挥最大的实力。

_真正实现 “按量付费”_

## 环境要求

### 理论最低要求

- DeepSeek Harness `0.1.2-alpha.2`+（与 package.json peer `>=0.1.2-alpha.2 <0.2.0` 一致；基于 `agent/request` waterfall 与 continuable subagent API）
- Node.js 22.15+（`node:zlib` 的 zstd 压缩接口实需 22.15+/23.8+，与 package.json `engines` 一致）
- 一个可用的 LLM provider
- Windows / macOS / Linux（DSH 均支持）

### 开发时的环境

- DSH `0.1.2-alpha.4`（**实装/真机验证宿主**）+ Windows 11 + Node.js 22.15+（`.nvmrc` 为准，`package.json` engines 同源）。
  0.3.0-tisitan.11 起本仓库自身的 devDependencies 也升到 `^0.1.2-alpha.4`（实装解析到 `0.1.2-alpha.5`），与部署线对齐——
  此前它停在 `0.1.0-rc.8`（低于 peer floor），导致 `test/compat-alpha4.test.mjs` 的**宿主契约哨兵永远走 skip 分支**：
  那条哨兵是本仓唯一拿真宿主 `SubagentRuntime.prototype` 对账的闸门（上游把 `followup`/`reportFrom` 改名或删除时，
  所有 mock 测试都照样绿）。哨兵现已合闸真跑，`npm test` 的 `# skipped 0` 就是它在位的证据。
- 依赖安装走 **npm + 已提交的 `package-lock.json`**（CI 用 `npm ci`）。不再用 bun：仓库从未声明也从未提交
  bun 锁文件，那条腿解析出的树既不代表本地也不代表消费者装到的那棵。

## 快速开始

> ⚠️ **本 fork 只走 git 分发，不走公共 npm。别执行 `dsh plugin add dsh-my-go@latest`。**
> 公共 npm 上 `dsh-my-go` 这个包名**属于无关第三方**（0.3.0-tisitan.11 核对实况：
> maintainer `kuohu`、`latest = 0.4.3`、版本列表里**零**个 `-tisitan` 版本），那条命令
> 装到的是**别人的另一个包**，不是本仓库的代码——这是供应链级误导，不是「装了没效果」。
> 本 fork 的 `0.3.0-tisitan.N` 从未发布到该包名下；`.github/workflows/publish.yml`
> 处于**休眠**状态（未启用 npm 发布渠道，包名归属未解决），见 `docs/FORK-GUIDE.md`
> 「已知陷阱」与「发布流程」。

### 安装（从 git clone）

**前置要求**

| 项 | 要求 | 怎么确认 / 怎么补 |
|---|---|---|
| Node.js | `>=22.15` | `node -v`（低于则先升级 Node，别硬装） |
| dsh | 已全局安装 | `dsh --version`（装法见 DeepSeek Harness 官方文档） |
| pnpm | 在 PATH 上 | `pnpm -v`；报「不是内部或外部命令」/`command not found` 就 `npm i -g pnpm` 补装 |

> `dsh plugin` 本质是 **pnpm 转发器**：它在 profile 目录里跑 `pnpm add <你给的路径>`，
> 成功后再把 `dsh.profile.bundles` 对齐到实际装上的依赖。所以 pnpm 缺席时
> `dsh plugin` 直接失败（退出码 127），不是 dsh 的 bug。

**安装步骤**

```bash
# 1) clone 到【永久稳定路径】——见下方红字警告，这路径以后不能挪、不能删
git clone --depth 1 https://github.com/Tisitan/dsh-my-go.git "D:/dsh-plugins/dsh-my-go"

# 2) 装进 web profile（路径写绝对路径最稳；相对路径 dsh 会按你当前目录解析）
dsh plugin --profile web add "D:/dsh-plugins/dsh-my-go"

# 3) 重启 Web GUI
dsh web
```

**验证装对了**（第 3 步之前先做，三条全中才算装好）

```powershell
# Windows PowerShell（用 ConvertFrom-Json：把反斜杠路径塞进 `node -p "require('...')"`
# 会被 JS 当转义吃掉，别那么写。也别用 $profile 这个名字——它是 PowerShell 自动变量）
$pkg = "$env:USERPROFILE\.dsh\profiles\web\package.json"
(Get-Content $pkg -Raw | ConvertFrom-Json).dependencies.'dsh-my-go'                     # 期望 link:<你的 clone 路径>
(Get-Content $pkg -Raw | ConvertFrom-Json).dsh.profile.bundles -contains 'dsh-my-go'    # 期望 True
Get-Item "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-my-go" |
  Select-Object Name, LinkType, Target                                                   # 期望 LinkType = Junction
```

```bash
# POSIX（macOS / Linux）
profile="$HOME/.dsh/profiles/web"
node -p "require('$profile/package.json').dependencies['dsh-my-go']"           # link:.../dsh-my-go
node -p "require('$profile/package.json').dsh.profile.bundles.includes('dsh-my-go')"  # true
ls -l "$profile/node_modules/dsh-my-go"                                        # 指向 clone 路径的 symlink
```

三项分别是：profile 的 `package.json` 里出现 **`link:` 依赖**、`dsh.profile.bundles`
数组里**登记了 `dsh-my-go`**、`node_modules/dsh-my-go` 是一枚**指向 clone 目录的
junction/symlink**（不是拷贝）。

**首启会发生什么**：bundle 层自动应用插件自带的 `cordis.patch.yml`（无需手写 insert），
host 插件（`lib/index.js`：settings 存储 + 面板 RPC + preset 同步器）挂载，随后
`ensurePresetInstalled` 按「版本 + 内容摘要」双门把 `preset/` + `prompts/` 整拷到
`~/.dsh/.agent-presets/dsh-my-go/`。终端应看到一行：

```
[dsh-my-go] preset synced to <DSH_HOME>/.agent-presets/dsh-my-go (v<package.json 版本>+<内容摘要>)
```

之后新建会话的预设选择器里会出现 **「MyGO!!!!! 模式」**——编排六工具 + 模型绑定
由 preset 半 broker 在该会话内提供，树状图面板数据经快照桥实时透出。看不到这一行
日志、或选择器里没有该模式，说明 preset 半没装上（多半是第 2 步的路径写错了）。

> 🔴 **clone 路径必须永久稳定**。`dsh plugin ... add <本地目录>` 装的是 **junction
> （链接）而不是拷贝**：profile 的 `node_modules/dsh-my-go` 永远指回你 clone 的那个
> 目录。把那个目录**移动 / 改名 / 删除**，下次 `dsh web` 就直接启动失败（模块解析
> 不到）。想换地方：先 `dsh plugin --profile web remove dsh-my-go`，挪完再 add 新路径。

### 升级

```bash
cd "D:/dsh-plugins/dsh-my-go"   # 你的 clone 目录
git pull
dsh web                          # 重启即生效
```

不需要重装、不需要手动拷 preset：preset 同步器按 `package.json` 的 **version +
preset/prompts 内容摘要**双门判定，version 或内容任一变了就自动重同步。装机侧
手改过 `~/.dsh/.agent-presets/dsh-my-go/` 的话，同版本同内容才不会被覆盖（见
README「插件 config 键」段的提示）。

### 卸载

```bash
dsh plugin --profile web remove dsh-my-go
dsh web
```

卸载只摘 profile 的依赖与 bundle 登记；已 clone 的目录和已同步的
`~/.dsh/.agent-presets/dsh-my-go/` 副本都还在，需要的话自行删除。

### 平台差异小注

| 项 | Windows | macOS / Linux |
|---|---|---|
| profile / home 路径 | `%USERPROFILE%\.dsh\profiles\web`、preset 落 `%USERPROFILE%\.dsh\.agent-presets\` | `~/.dsh/profiles/web`、`~/.dsh/.agent-presets/` |
| 链接形态 | **junction**（`mklink /J`，普通权限即可创建） | **symlink**（`ln -s`，无需特权） |
| 命令差异 | `dsh plugin --profile web add "D:/dsh-plugins/dsh-my-go"` 写法与 POSIX 一致，路径分隔符 `/` `\` 都收 | 同左 |

行为完全一致，只有路径与链接类型两种叫法之差——上面「junction 不是拷贝、路径必须
永久稳定」这条在两边同样成立。

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
  持久化独立 Session，支持后续邻接投递（continue/forward 经 `deliverToAdjacent`
  适配层：queued 档走真 FIFO 队列，alpha.4 用 internal 队列符号、alpha.2/3 用
  旧 `followup`；**若该 runtime 给不出排队通路（alpha.4 `sendMessage` 只有 steer
  且队列符号缺席），queued 就地塌档为 steer 并 `console.warn` 留痕，返回体 `mode`
  如实回报，绝不静默降级**）。
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

自 0.2.3-tisitan.7 起，插件**不再内置任何模型名/渠道名**——所有工种默认空绑定，
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
跟随 DSH 模型目录，模型不支持所配档位时留空走适配器默认。两份查询结果
按「只缓存结论」的纪律缓存：清单**列举成功**（哪怕为空）才入缓存，抛错/
服务缺席留待下次重试；能力表只有查到非空档位才入缓存（查不到＝未知，不
判死）。设置热更（`settings/updated`）时两枚缓存整体作废，且此刻**在飞的
旧响应不回写**（改完模型清单/能力表无需重启即生效，也不会被一次陈旧拉取
撤销）。

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
      - mcp__your-origin__tool_a    # 按注册名屏蔽，缺席工具跳过并在汇总行点名
      - mcp__your-origin__tool_b
```

设置页「MyGO 编排 → 工具屏蔽（Tool Mask）」提供双列表编辑器（tisitan.13
起）：左列「当前可用工具」经 `listTools` RPC 实时枚举注册表（保留名
`run_code` 服务端过滤、不可屏蔽），支持名称过滤；右列「已屏蔽」中不在当前
花名册的条目带「未连接」灰徽章——保留不删，MCP 重连后即被屏蔽；花名册外
工具可手填添加。与 YAML 手工编辑等价，空清单提交即视为不屏蔽。

优先级与生效时机：

- **解析规则 = 三源并集（去重保序，互不覆盖）**：agent.cordis.yml tool-mask 行
  的 `config.deny`（fork 自带的安全条目：上游邻接消息三件套 `send_message` /
  `list_agents` / `interrupt_agent`）∪ settings `toolMask.deny`（设置页写入）∪
  空 `DEFAULT_DENY`。你在这三个双列表里加的条目不会被任何一侧吃掉，fork 自带的
  安全条目也无法被清除——想解除它们需自行改 `agent.cordis.yml`（见下条）。
- **可屏蔽面 = 继承名**：`tools.restrict()` 只过滤本作用域**继承**到的工具
  （global 层 + 祖先 preset 层），own-layer 豁免。所以本编辑器屏蔽宿主 bundle
  注册的工具（内建 + MCP + 邻接消息三件套）没问题；broker 自产的六件套
  （go_work/continue/…）与本行同层，屏蔽不掉——它们由 broker 的 `agent/created`
  闸在 agent 子作用域上 deny（同一份清单，双保险）。
- **生效时机 = 新会话**：屏蔽清单在 preset 挂载（会话组装）时解析一次，
  变更只对之后新建的会话生效，当前会话不受影响。
- **容错**：本作用域未注册的名字（宿主 `tools.restrict()` 报 `names unknown
  global tool`）静默跳过、只进汇总行的跳过清单，不逐名 warn——web 部署下
  host 不全局注册上游邻接消息三件套，preset 作用域屏蔽它们必然查无此具，
  真正的防线是 broker 在 agent 子作用域上的 `agent/created` 闸（清单同源，
  双保险）；其他类型的 restrict 报错属真异常，仍逐名 warn 留痕。两类都不炸
  preset 挂载。每次挂载输出一行汇总日志，形如 `masked 15 tool(s) this session
  (3 name(s) not registered at this scope; agent-scope gate covers them:
  send_message, list_agents, interrupt_agent) (source: config.deny+settings)`
  ——数字只算**实际屏蔽成功**的个数，跳过的名字在括号里点齐。
- **迁移**：tisitan.12 及之前版本内置的 `DEFAULT_DENY` 私有示例清单已在
  tisitan.13 清空——升级后默认不屏蔽任何工具，原用户请在设置页重新配置。
  防旁路加固批起 `config.deny` 改为与设置页清单**并集**（此前是覆盖语义，
  一旦行级非空就会把用户在设置页配的清单整体吃掉）。

### 插件 config 键（broker 行为调参）

以下为 broker 行为调参 config（tisitan.21 起由 preset 半 broker 行读取；
双半同构时代曾由 lib 半读取），与上面的 settings 命名空间正交；默认值即
旧硬编码口径（0.2.3-tisitan.8「可观测性」批起截断阈值可配）：

> ⚠️ **调参入口 = 已安装 preset 的 broker 行**。装机后编辑
> `~/.dsh/.agent-presets/dsh-my-go/agent.cordis.yml` 的 broker 行加
> `config:`（同名键），对新开的 MyGO 会话生效；preset 内容变化时同步会覆盖
> 该行（marker 记的是「版本 + preset/prompts 内容摘要」，摘要一变即整树重拷，
> 同版本热修也能生效），需重配。lib 半不再读取这些键。

| config 键               | 默认值 | 说明                                                                 |
|-------------------------|--------|----------------------------------------------------------------------|
| `disposeEndGraceMs`     | 500    | `agent/disposed` 后等待 `subagent/end` 的宽限期，超时兜底清槽推进队列 |
| `queueRetryBaseMs`      | 1000   | 队列派发失败回补后的线性退避基数（1×/2×/3×，上限 3 次后放弃）         |
| `statusHistoryLimit`    | 12     | `orchestration_status` 展示的历史条数                                 |
| `statusConclusionMax`   | 400    | `orchestration_status` 单条结论截断长度（**failed 记录不截断**）      |
| `helpContentMax`        | 240    | `orchestration_status` 单条求助内容截断长度                           |
| `subagentPromptMax`     | 200    | `list_subagents` prompt 摘要及会话 label 的 prompt 摘要截断长度       |

编排台账（history，每桶 `HISTORY_CAP` = 200 条，桶数上限
`LEDGER_PARENTS_CAP` = 200）持久化在
`<DSH_HOME>/dsh-my-go/orchestration-ledger.json`（`DSH_HOME` 缺省
`~/.dsh`），进程重启后读回——跨重启 `continue` 已完工子代理经 harness
coldResume 续聊可用。落盘按 250ms 防抖合并、同目录 `.tmp` + rename 原子写；
插件卸载时若防抖窗尚未到期，清理函数**同步补写**这一次变更（窗口内的最后
一次完工/复活不再随进程蒸发）。

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
├── lib/index.js           # npm 包 host 半（632 行：settings 存储 + revision 围栏 + 面板 RPC（快照裁剪/结构化名册/端点自带 try）+ preset 同步器（版本+内容摘要 marker）；tisitan.21 起零编排面）
├── src/                   # client 半源码（tisitan.15 起装配层 + 模块化）
│   ├── client.js          #   装配层（82 行）：接线五模块 + 注册 DSH slots + 宿主服务缺席时真降级
│   ├── client-constants.js#   共享常量（色板/标签/intent 文案，零 React）
│   ├── panel-tree.js      #   树状图面板 + 轮询（in-flight 门 / 失败退避 / 迁移留痕）+ 自动跳转（结构化花名册）
│   ├── settings-core.js   #   设置页主组件（手风琴卡 / persona 覆盖 / 可手填组合框 / dirty + revision 围栏）
│   ├── settings-guard.js  #   未保存与并发写守卫纯函数（结果归一 + beforeunload 挂钩，Node 侧可直测）
│   ├── roles-editor.js    #   自定义角色区（CRUD / persona 覆盖 / 导入导出）
│   ├── tool-mask-editor.js#   工具屏蔽双列表编辑器
│   ├── chain-rows.js      #   模型优先级列表编辑器纯函数（node --test 与 bundle 内联同源）
│   ├── tool-mask-rows.js  #   工具屏蔽纯函数（同上）
│   ├── roster-rows.js     #   自定义角色纯函数（同上，含卡摘要/导入导出/persona 覆盖）
│   └── panel-format.js    #   面板格式化纯函数（同上）
├── scripts/build-client.mjs  # esbuild 打包 client → dist/client.js
├── scripts/dump-session.mjs  # 会话档案取证 CLI（tisitan.16，npm run dump:session）
├── test/                  # 冒烟 + node --test 全档（21 个 *.test.mjs + test/helpers/
│                          #   共享 ctx 替身；例数以 `npm test` 机器读数为准，见「贡献」）
├── dist/                  # 构建产物（`client.js` **随 release commit 入库**，见 docs/FORK-GUIDE.md「发布流程」；其余中间产物不入库也不落盘）
├── preset/                # agent preset「MyGO!!!!! 模式」（复制到 ~/.dsh/.agent-presets/）
│   ├── preset.yml
│   ├── agent.cordis.yml
│   ├── shared/            # 共享源（tisitan.15）：constants / failure / archive /
│   │                      #   roles / orchestration / misc / child-registry /
│   │                      #   adjacent / end-attribution（零 @deepseek-ai、零 ctx；
│   │                      #   铁律见各自头注释；tisitan.21 起编排面模块仅 broker 消费）
│   └── tools/broker.mjs   # 自包含 host 插件（编排唯一实现：工具 + 模型绑定 + 状态机；
│                          #   可变状态、上游契约与 end 归因决策均已下沉 shared，本文件
│                          #   只剩策略调用 + continue/forward 投递链五件共用件）
├── prompts/               # 8 个智能体 prompt
└── docs/                  # ARCHITECTURE.md / FORK-GUIDE.md / archive/（审查报告归档）
    └── legacy-broker-ts/  #   归档 TS 参考实现（停维护，原根目录 broker/）
```

## 贡献

```bash
git clone git@github.com:Tisitan/dsh-my-go.git
cd dsh-my-go
npm ci                    # 依赖树由已提交的 package-lock.json 决定（可复现）
npm run build             # 构建 client bundle（直调 node，不再需要 bun）
npm run typecheck:archive # 类型检查（tsconfig include 只有 docs/legacy-broker-ts/src，即归档 TS 参考实现；生产 JS/mjs 面不在检查面）
npm test                  # 构建 bundle → dist 新鲜度冒烟 → node --test 全部测试档
```

`npm test` 自 0.3.0-tisitan.11 起不再维护手工文件清单（旧写法每加一档就要记得改
script，忘了就静默不跑），改由 node 自己展开通配 `test/*.test.mjs`。例数**以机器
读数为准**，不手写进文档：

```
ℹ tests 324   ℹ pass 324   ℹ fail 0   ℹ skipped 0
```

（`# skipped 0` 是宿主契约哨兵已合闸的证据——它以前恒为 1，因为 devDeps 停在
`0.1.0-rc.8` 而门槛是 `0.1.2-alpha.3`。）

**等待口径（0.3.0-tisitan.12 起为硬约定）**：断言之前的等待分两类，写法不可混。

- **正向等待**（等某件事发生）必须用 `helpers/mock-ctx.mjs` 的 `waitFor(谓词)`，
  且谓词要取**紧随其后那批断言真正读到的可观测量**——尤其「占位记录换成真身」
  这种链条末步：只等 `specs.length` 在 20+ 文件并行时会拿到 `child-*` 占位 id
  而假红（本批改造 25 处，实测固定 `await drain(20)` 全量约 1/5 概率假红）。
- **负向窗口**（等「什么都没发生」：宽限期不误伤、aborted 不重派、评估窗内忽略、
  迟到 disposed 不拖垮他会话、迁移幂等、`installPreset:false` 真短路）没有可等的
  条件，保留固定 `drain(N)`，但**先 `waitFor` 到正向终态再开窗**，否则窗口是在等
  一个还没开始的过程。
- 谓词写窄了会**自己制造竞态**：`status === 'spawning'` 早于门面调用、
  `agentType === 'hermes'` 在占位入槽时就成立——两者都不是各自用例真正断言的那个
  终态。这类坑在测试里各留了一条反面教材注释。

临时目录 teardown 同理：台账写有 50ms 防抖，`rm -rf` 会撞上它，用
`removeHomeWithRetry` 而不是裸 `rm`（有界退避只吞 ENOTEMPTY/EBUSY/EPERM）。

## 维护状态

- 仍在积极开发中，可能有少量 Bug 尚存，欢迎提交 Issue
- 已知限制：
  - 子智能体模型绑定依赖 `agent/request` waterfall（DSH 未原生支持动态子代理模型，
    见 [dsh-handbook 9.2](https://github.com/deepseek-ai/deepseek-harness/discussions/118)）；
  - 结论注入依赖 `subagent/end` 事件（alpha.4 的完工通知自带 closing message）；
    子→父的补充通道只有 `need_help`（运行时 API 投递），上游邻接消息工具
    （`send_message` 等）在 MyGO 会话已被 deny。
  - 单线阻塞由 broker 状态机执行；Sisyphus 需遵守编排规则（由 system-prompt section 约束）。
- 感谢以下三位开发者：（排名不分先后）
  - DeepSeek V4 Flash 0731
  - DeepSeek V4 Pro 0813
  - MiMo V2.5

## 附录：手动兜底安装（`dsh plugin` CLI 不可用时）

> 这是**最后手段**，只在 `dsh plugin` 本身跑不起来（dsh 版本过旧没有 plugin 子命令、
> profile 目录被手改坏、pnpm 转发器报错且无法立刻修）时才用。正常情况一律走上面的
> 「安装（从 git clone）」——那条路由 dsh 自己写 `link:` 依赖、建链接、对齐
> `dsh.profile.bundles`，本附录是把这三件事手抄一遍。

前提同样是：仓库已 clone 到**永久稳定路径**（下文记作 `<REPO>`），且 `dist/client.js`
已在该目录里（release commit 自带，无需你构建）。

1. **建链接**（不是拷贝！目录移动即失效）：

   ```bat
   :: Windows（普通 cmd 即可，junction 不需要管理员权限）
   mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-my-go" "<REPO>"
   ```

   ```bash
   # macOS / Linux
   ln -s "<REPO>" "$HOME/.dsh/profiles/web/node_modules/dsh-my-go"
   ```

   （链接路径的最后一层 `dsh-my-go` **不要预先创建**：`mklink /J` / `ln -s` 自己会建，
   目标名已存在时反而报错或套娃。父目录 `node_modules` 本来就在。）

2. **手改 profile 的 `package.json`**（`~/.dsh/profiles/web/package.json`），两处：
   `dependencies` 加一条 `link:` 依赖，`dsh.profile.bundles` 数组追加包名——bundle 层
   正是靠这个名字去解析并自动应用包自带的 `cordis.patch.yml`，**不需要你再手写 patch
   insert**：

   ```jsonc
   {
     "dependencies": {
       // Windows 实测形态用正斜杠 + 盘符，POSIX 用绝对路径，pnpm 两边都认
       "dsh-my-go": "link:D:/dsh-plugins/dsh-my-go"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-my-go"                      // ← 追加这一项
         ]
       }
     }
   }
   ```

3. **补运行时依赖**：手建链接不会替你装依赖，本包运行期唯一需要的非 peer 依赖是
   `@deepseek-ai/schemastery`。在 **profile 目录**里装（不是 `<REPO>` 里）：

   ```bash
   cd ~/.dsh/profiles/web && pnpm add @deepseek-ai/schemastery
   ```

   （这一步顺带会让 pnpm 按第 2 步写进去的 `link:` 规格复核并校正那枚链接，重复执行
   无害。）

4. **重启 `dsh web`**。之后与正常安装同轨：首启 `ensurePresetInstalled` 按
   version + 内容摘要双门把 preset/prompts 同步到 `~/.dsh/.agent-presets/dsh-my-go/`，
   日志见 `[dsh-my-go] preset synced ...`，会话选择器出现「MyGO!!!!! 模式」。

回到正常轨道随时可以：`dsh plugin --profile web remove dsh-my-go` 清掉手抄的登记，
再按上面的安装步骤重来一遍。**但如果你连第 2 步的 `bundles` 都懒得写、而是直接在
profile 的 `cordis.patch.yml` 里手写了 `- insert: - id: dsh-my-go`**（老装法，本机历史
上就是这么留的）——回到正常轨道前**必须把那条 insert 一并摘掉**：bundle 层会再自动
应用一次包自带 patch，两处并存等于同一个 `id` 挂两遍。

## 许可证

[MIT](LICENSE) © dsh-my-go contributors
