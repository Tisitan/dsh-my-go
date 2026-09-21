<!-- deepseek-harness-meta
{
  "name": "MyGO 编排器",
  "version": "0.5.0-tisitan.4",
  "tags": ["preset", "模式预设"],
  "description": "把每一步路由到最合适模型的智能体编排器"
}
-->

# MyGO!!!!! 编排调度 | DSH

> **My** tasks, where to **GO**?????

> 🔱 **Tisitan fork**：本仓库是 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go)
> 的维护性 fork，包含面板/拓扑闸/失败路径等一系列 Critical 修复，详见 [CHANGELOG.md](CHANGELOG.md)。

dsh-my-go 是构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 之上的**智能体编排系统**。

它以星型 + 单线嵌套拓扑把 DSH 主会话（Sisyphus）与 8 个专业子智能体组织起来：Sisyphus 负责调度、审查与驳回，子智能体负责执行与汇报。参考了 oh-my-openagent 的编排设计，针对 DSH 进行了优化调整。

上游作者开发手记（原项目背景，非 fork 文档）：https://khbit.cn/posts/dsh-my-go/

## 特性

- **星型拓扑**：所有子智能体（叶子）不直接通信，全部经 Sisyphus 中转。
- **单线阻塞**：同一时段每个编排会话内只有一个子智能体在运行，便于审查，增强可观测性；tisitan.10 起各会话流水线相互独立、互不排队。
- **8 个专业工种**：Hermes（快速执行）、Explore（检索）、Librarian（文档）、Multimodal Looker（看图）、Hephaestus（写代码）、Prometheus（规划）、Oracle（最后手段：疑难/极端复杂问题的架构调试，仅当其他工种无法胜任时启用；验收是 Sisyphus 的质检本职）、Apelles（可视化画师：结构图/流程图/海报 + UI 视觉稿）。
- **按工种绑定模型**：快活小工配便宜模型，重活配强模型——默认不绑任何模型（继承环境路由），按工种分流见下文「工种模型绑定」。
- **自定义角色名册（tisitan.14）**：内置八工种之外，可在 settings 的 `roles` dict 自由定义角色（键名 `^[a-z][a-z-]*$`），每个角色可配独立的模型绑定 / persona / 工具过滤；`go_work` 的 `agent` 参数接受名册内任意角色名，详见下文「自定义角色」。
- **内置角色 persona 覆盖（tisitan.15）**：除 Sisyphus 外的内置工种可在配置卡里覆盖编辑 persona（留空 = 用 prompts/ 档案人设），与自定义角色一样经 spawn 官方通道注入；「载入文件默认」按钮（tisitan.16）一键拉取档案原文进编辑框，覆盖前不再盲写。
- **角色卡导入导出（tisitan.15）**：每张角色卡可导出/导入全字段 JSON（剪贴板，失败降级 prompt 复制），导入前客户端校验（非法键名/重名/脏 JSON 等拒绝）。
- **面板花名册常驻区（tisitan.15）**：编排面板底部常驻显示活角色名册（内置 + 自定义）。0.3.0-tisitan.9 起面板直读 snapshot 的**结构化 `roster`** 字段（表头、计数、徽章由客户端自持），且三处消费面（面板 / `orchestration_status` / Sisyphus 系统提示简报）共用 `shared/roles.mjs` 的同一份语义源——旧写法是面板按「第一行必为表头」的位置约定切 host 文本、两半各抄一份 18 行摘要逻辑、shared 又是第三种格式，「同源同格式」名不副实。
- **未保存与并发写防线（0.3.0-tisitan.9 立规，0.5.0-tisitan.3 换信道不降级）**：草稿一旦改动即置 dirty，保存条挂「待保存：<改了什么> · r<版本>」，关页签/刷新前浏览器拦一道；保存带**草稿建立那一刻**的 revision 作栅栏，他处（另一页签 / 手改 settings.yaml）先写过则**不冲草稿**、亮漂移告示并给出唯一出路「丢弃草稿并重读」；写完一律读回比对，判「已保存」还是「没落盘」以宿主现值为准（官方 settingsScope 被拒时不抛异常，旧 `try/catch` 判冲突会把失败报成成功，0.5.0-tisitan.3 修）。
- **面板弹性（0.3.0-tisitan.8 起）**：快照轮询带 in-flight 门与失败退避（600 → 1500 → 3000ms，成功复位），host 端在出口把快照裁到面板可见规模（每桶 history 末 8 条、剔除 prompt 全文）；宿主 `timer` / `sessions` 服务缺席时面板真降级（自管定时器继续刷新 / 只关跳转）并一次性留痕，不再静默停摆。
- **10 个编排/通信/报告/接力链工具**：`go_work`（派发）、`continue`（驳回/追问）、`need_help`（求助挂起）、`forward`（转发）、`orchestration_status`（状态总览）、`list_subagents`（列出已有 sub-agent 及其最后 prompt）、`report_submit`/`report_fetch`（报告落板/读板，报告外部化总闸开时注册）、`chain_start`/`chain_resolve`（接力链声明/处置，接力链总闸开时注册）。
- **单宿主编排（tisitan.21 起）**：编排能力唯一由 MyGO preset 提供（broker 半，preset scope），装机后首启自动同步 preset，常态无感；lib-only 部署形态（preset 未装配）不提供编排能力，面板降级为空态 + 花名册常驻。
- **步骤级调度**：Prometheus 供应拆解素材（现状拆解/候选方向/风险清单，只交素材不交决断），方案与步骤定序归 Sisyphus，由 Sisyphus 逐步骤选择最省 token 的工种——**按任务难度分配（不按需求难度）**：指令明确、步骤具体的执行活优先派 Hermes，需要设计/推理的才升级 Hephaestus，仅疑难/极端复杂才到 Oracle；同工种上下文连续则 `continue` 复用。
- **Sisyphus 质检**：结论不达标驳回重做，被驳回的子智能体保留上下文继续。
- **WebUI 配置**：每个工种的模型 / 思考档位 / DSV4P0813 补丁开关 / 备选链，均在 **DSH Web → 插件 → dsh-my-go 的配置卡**里改（0.5.0-tisitan.3 起这是唯一入口，旧「MyGO 编排」设置页 section 已下岗）；布局是两块两列主从（模型与角色 / 用量单价表）+ 通栏注释区，tisitan.14 起含「自定义角色」CRUD，tisitan.19 起主选与备选链合并为单一「模型优先级列表」（#1 主选带徽章，备选 ↑ 到顶一键扶正），0.3.0-tisitan.9 起渠道与模型两栏是**可手填输入框**（input+datalist：清单在场点选、清单拉不到时直接键入，兑现页面一直许诺的「也可以直接输入自定义值」），且某渠道清单读取失败会行内标出原因（不再与「该渠道真的没模型」同形）。
- **用量统计（0.4.0 usage-stats 契约线，D6 起含父会话自身用量）**：配置卡可按 `{provider}/{model}` 自填四桶单价（USD / 1M tokens，写入口双重净化，未定价只记 token、不计成本）；面板新增「用量统计」区——以当前打开的主会话为口径（会话 id 不可识别时回落唯一在飞编排会话，多编排不猜归属；会话列表首拉期显示「加载中」而非误报故障），按模型 / 按子代 / 合计三视图共用同一份 `getUsage` 响应（服务端预归并 byModel，渲染层乘价、单一计费点），**主编排会话自身的消耗同样入账**（isSelf 合成行排子代之前，合计=完整开销；自身无 assistant 消息时不出零值行），running 子代数字随 600ms 面板轮询实时增长；缺桶显示「—」不补 0，整列无单价时隐藏成本列，partial 数值带 `≥` 下界标记（含未上报分桶/未定价桶），切换主会话视图即时跟随（含清空态），RPC 失败显示横幅并随既有退避自愈。
- **DSH 适配**：权限请求、问题询问由主智能体执行。
- **节省主会话上下文**：Sisyphus 主会话不加载 Skill 工具（子智能体仍保留），跳过 Skill catalog 注入以压缩主会话上下文。
- **防旁路加固（0.3.0-tisitan.4 起）**：上游邻接消息三件套（`send_message` / `list_agents` / `interrupt_agent`）对 Sisyphus 与全部子代理双侧 deny——绕过台账与单线锁的旁路在工具目录层就不存在，子代理唯一的上报通道是 `need_help`；`continue` 的 `queued` 档走真 FIFO 队列（alpha.4 的 `sendMessage` 只有 steer，排队通路经 internal 符号队列适配器复活），`steer`/`abort` 也一律经 `subagents` 门面投递。原生派生工具（`subagent` / `subagent_fork` / `workflow` / `ralph`）仅在 Sisyphus 顶层保留为逃生舱，子代理侧照旧摘除。
- **DSV4P0813 补丁开关**：内置过拟合补丁，让 DeepSeek V4 Pro 0813 发挥最大的实力。

_真正实现 “按量付费”_

## 环境要求

### 理论最低要求

- DeepSeek Harness `0.1.2-alpha.2`+（与 package.json peer `>=0.1.2-alpha.2 <0.1.7` 一致；基于 `agent/request` waterfall 与 continuable subagent API）
  peer 上界在 0.5.0-tisitan.2 从 `<0.2.0` 收到 `<0.1.6`，现为 `<0.1.7`：Web 设置面板的通道注册现在依赖
  `dsh-host-webserver` 的 `WebRoute{kind,path,handler(req,res)}` 与 `connection.requestRejection`
  两枚公开面，它们只在 `0.1.5-alpha.1` 上真机验过——没验过的版本不号称支持。
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
git clone --depth 1 https://github.com/Tisitan/dsh-my-go.git "<your-dsh-plugins>/dsh-my-go"

# 2) 装进 web profile（路径写绝对路径最稳；相对路径 dsh 会按你当前目录解析）
dsh plugin --profile web add "<your-dsh-plugins>/dsh-my-go"

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

之后新建会话的预设选择器里会出现 **「MyGO!!!!! 模式」**——编排十工具 + 模型绑定
由 preset 半 broker 在该会话内提供，树状图面板数据经快照桥实时透出。看不到这一行
日志、或选择器里没有该模式，说明 preset 半没装上（多半是第 2 步的路径写错了）。

> 🔴 **clone 路径必须永久稳定**。`dsh plugin ... add <本地目录>` 装的是 **junction
> （链接）而不是拷贝**：profile 的 `node_modules/dsh-my-go` 永远指回你 clone 的那个
> 目录。把那个目录**移动 / 改名 / 删除**，下次 `dsh web` 就直接启动失败（模块解析
> 不到）。想换地方：先 `dsh plugin --profile web remove dsh-my-go`，挪完再 add 新路径。

### 升级

```bash
cd "<your-dsh-plugins>/dsh-my-go"   # 你的 clone 目录
git pull
dsh web                          # 重启即生效
```

不需要重装、不需要手动拷 preset：preset 同步器按 `package.json` 的 **version +
preset/prompts 内容摘要**双门判定，version 或内容任一变了就自动重同步。装机侧
手改过 `~/.dsh/.agent-presets/dsh-my-go/` 的话，同版本同内容才不会被覆盖（见
README「插件 config 键」段的提示）。

> **dist/client.js 与 release commit**：Web UI 加载的客户端产物
> `dist/client.js` **随 release commit 入库**（见「目录结构」与
> docs/FORK-GUIDE.md「发布流程」，`git pull` 到 release commit 即自带，无需
> 构建）。但 depth-1 clone + `git pull` 若跟进的不是 release commit（例如跟了
> 开发分支的中间态），该文件可能缺失或过期——此时在 clone 目录自行
> `npm run build` 后再重启 `dsh web`。

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
| 命令差异 | `dsh plugin --profile web add "<your-dsh-plugins>/dsh-my-go"` 写法与 POSIX 一致，路径分隔符 `/` `\` 都收 | 同左 |

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
- 面板通道 = host 半在 `webServer` 上直注册 `/dsh-my-go` prefix 路由，单通道 + 端点分发
  （snapshot / listTools / getBuiltinPersona / getUsage 四枚），信封
  `{ok:true,value}` / `{ok:false,error:{code,message,details}}`。0.5.0-tisitan.2
  起不再走 `connection.rpc.handle`（宿主 0.1.5-alpha.1 上它注册即抛，通道静默失踪），而是
  照宿主自身 `/api` 的写法自行注册，并在 handler 内补回**鉴权直出**与**信封封装**两件事——
  URL、通道名、信封三者与旧路径逐字同形，client 半零改动（详见 docs/ARCHITECTURE.md 2.5）。
  0.5.0-tisitan.3 起设置面三私有端点（loadSettings / saveSettings / listModels）退役，
  设置读写走宿主 `settingsScope`、模型目录走 `remote.session.modelCatalog`（见 docs/ARCHITECTURE.md 2.12）。
- 详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
- 开发怎么起沙盒、验收判据与踩过的坑见 [docs/DEV-SANDBOX.md](docs/DEV-SANDBOX.md)。

## 配置

host 半（lib）以 `installSection` 注册 settings 命名空间 `dsh-my-go`（cordis 行 config
的 settings 形状部分是它的 composition base），client 半在**官方插件页**里提供该命名空间的
配置卡（DSH Web → 插件 → dsh-my-go → 配置区），broker 半只读取：

配置卡的两件事保证（0.5.0-tisitan.3 起）：

- **不点「立即保存」不写任何字节**；保存发的是一次原子的命名空间 ops，且带**草稿建立
  那一刻**的 revision 作栅栏——他处先写过则这次写入被拒，页面按**读回比对**出「没落盘」
  回执（官方信道被拒时不抛异常，靠 `try/catch` 判断等于骗自己）。
- **清空一个可空字段等于发 `unset`**，值随即回落到 composition base 或 schema 默认；
  手写 `settings.yaml` 的 `dsh-my-go:` 段与本页是同一层，改完热更即时生效。
  注意宿主的写路径会**整文件重写 `settings.yaml`、丢掉手写注释**，注释多的段落建议只读。
  非本机回环打开页面时该层是进程内内存档，配置卡照常渲染但保存按不落盘回执处理。

| 配置项                          | 默认值         | 说明                                                                    |
|---------------------------------|----------------|-------------------------------------------------------------------------|
| `<type>.provider`               | 不指定（继承） | 该工种的 provider 路由；缺省时继承父会话渠道                            |
| `<type>.model`                  | 不指定（继承） | 该工种的模型；缺省时继承父会话模型                                      |
| `<type>.reasoningEffort`        | 不指定         | 期望思考档位（如 high/max）；**只在模型实际支持时应用**，否则走模型默认 |
| `<type>.dsv4p0813`              | false          | 是否对该工种启用 DSV4P0813 两阶段引导补丁                               |
| `<type>.fallbacks`              | 空（不启用）   | 备选链 [{provider, model}]，主绑定失败时按序重派                        |
| `roles`                         | 空（仅内置工种）| 自定义角色名册 dict：`roles.<role>` 键名须 `^[a-z][a-z-]*$`，绑定字段同 `<type>.*`，另加 persona / toolFilter（见下方「自定义角色」） |
| `usagePrices`                   | 空（不计成本）  | 用量单价表 dict（0.4.0 usage-stats 线）：键为 `{provider}/{model}`（在**第一个** `/` 处切分，OpenRouter 式 `openrouter/deepseek/deepseek-chat` 无歧义），每行四桶单价——`input` / `output` 必填（缺一整行丢弃），`cacheRead` / `cacheWrite` 可选（未定价 = 该桶只记 token 不计成本），单位随 `usageCurrency` 币种 / 1M tokens；空表 = 只记 token 不算钱 |
| `usageCurrency`                 | USD             | 单价表全局币种，`USD` \| `CNY` 单选（0.4.0 线 D1a：整表一个币种，不按行混币——混币种合计随汇率漂移无意义）；面板用量统计的成本列按它渲染符号 |

`<type>` 取值：sisyphus / hermes / explore / librarian / looker / hephaestus /
prometheus / oracle / apelles。键为扁平结构（如 `hermes.model`，无 `agents.` 前缀），
与下方 YAML 示例及命名空间 schema 一致。

### 工种模型绑定

自 0.2.3-tisitan.7 起，插件**不再内置任何模型名/渠道名**——所有工种默认空绑定，
子代理完全继承环境默认路由（与 Sisyphus 同渠道同模型）。需要按工种分流
（快活走便宜模型、重活走强模型）时，在 DSH Web → 插件 → dsh-my-go 的配置卡「模型与角色」
逐工种填写（左列选角色、右列改这一行），或直接编辑 `~/.dsh/settings.yaml`：

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
  apelles:
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
Librarian / Looker 用便宜轻量模型，Prometheus / Oracle / Apelles 用最强模型。

### 自定义角色（roles，tisitan.14 起）

内置八工种之外，可在 `roles` dict 定义自己的角色——每个角色拥有与内置
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
- **迁移**：旧顶级八工种键在装载与热更时自动无损搬入 `roles`（幂等；
  失败保留原配置仅 warn），YAML 手写的旧形状无需立即改写。
- **注意**：`toolFilter` 随 descriptor v2 持久化、冷恢复按原样重放——
  只宜写核心稳定工具名，重启后工具集变化（如 MCP 未连接）会导致
  冷恢复失败（NOT_RESUMABLE）。

配置卡「模型与角色」的左列清单里，内置八工种之外都是自定义角色：新建/删除/改名、
模型优先级列表（tisitan.19 起主选 + 备选链合并编辑）、persona 与 toolFilter 白黑名单、
单角色 JSON 导出/导入，键名即时校验，与 YAML 手工编辑等价。

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

配置卡每个角色的详情栏内置模型优先级列表编辑器（tisitan.19 起
主选与备选链合并）：#1 即主选（带徽章，空值=跟随 Sisyphus），#2..N 即
备选链顺序；逐行编辑 provider/model、↑↓ 跨边界调整链序（备选 ↑ 到顶 =
一键扶正为主选，删 #1 则 #2 自动扶正，列表至少保留主选位 1 条）、模型
下拉按所选渠道过滤，与 YAML 手工编辑等价（保存时拆解 #1→provider/
model、#2..N→fallbacks，存储形状零变更）。

### 接力链（relay chains，tisitan.7 起默认关）

`relayChains=true` 时主编可声明**接力链**：一串按序执行的子代理跳
（2~8 跳），上一跳的完工报告全文经 board 直投为下一跳的输入数据块
（`<mygo_relay_input trusted="false">`），读→读跳之间免审自动接力，
主编上下文零全文过路。两枚工具：

- **`chain_start`**：声明链并派发首跳。`hops = [{ agent, prompt?, gate? }]`，
  gate ∈ `auto`（缺省；读→读免审自动接力，prompt 必填预写）/
  `review`（挂起待主编审阅后放行）/
  `sync`（不可逆跳强制同步门，指令必须现场给）。
- **`chain_resolve`**：处置挂起的链——`continue` 放行/续命（review
  可带新 prompt 覆盖预写，sync 必带现场 prompt）、`abort` 弃链。

挂起的链**永不超时放行**（D13）：每次回合的
`orchestration_status`/快照都有 `⛓ relay-chain` 状态行，主编不裁决链
不动。报告不合格的跳会先走一期报告补发，补发后仍不合格则挂起
`gate-verdict` 等主编裁量「带病续链 or 弃链」；跳子代 error 终局时自
动走备选重派，重派成功换绑新世代再等裁决。下一跳输入缺失（board
不可读）时链自动挂起 `input-missing`，绝不发空输入 prompt。子代若
发现输入语义不可用（空壳/无关/上游声明失败），按 prompt 尾部的验收
条款用 `need_help` 打回主编——禁止带病施工。

### 工具屏蔽（已迁移至 dsh-tool-guard）

本仓的 preset 级用户工具屏蔽（tool-mask preset 行、settings `toolMask.deny` 键、
设置页双列表编辑器）已整体拆除并迁移至 [dsh-tool-guard](../dsh-tool-guard)——
它以宿主平面插件对**所有 profile / preset / scope（含 MyGO 全部子代理）**生效，
且经 `settings/updated` 热更、呈示层 + `tools.guard` 双钩拦截，覆盖不降反升。
存量 `toolMask.deny` 名单已平移至 `dsh-tool-guard.denyTools`（2026-09-15 迁移）。

本仓**保留**两类工具层防线（编排拓扑防旁路，与用户屏蔽正交）：

- broker 的 `agent/created` 闸（星型拓扑六件套 + 邻接消息三件套 + Agent Teams
  实验面的 agent 子作用域 deny）；
- 角色级 `toolFilter`（allow/deny，随 roles 走，见「自定义角色」）。

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
| `metrics`               | true   | 观测埋点（0.4.0-tisitan.0）：编排动作追加写 `<DSH_HOME>/dsh-my-go/metrics/events.jsonl`（JSONL，10 万行 cap 超限截头）；`false` 零写盘 |
| `reportExternalization` | true   | 报告外部化总闸（0.4.0 线一期）：关 → `report_submit`/`report_fetch` 不注册、报告格式条款不注入、完工收尾不落板不闸门，编排退回 0.3.x 现状。**显式配置优先于代码默认**：当前装机 yml 显式 `true`（外部化实战期——2026-09-07 基线关窗后点亮，对照基线采集关窗期已结束；防回潮哨兵 test/report-clause.test.mjs 的 pin 已换向站岗，误关回 `false` 即红）；删除该行回落代码默认（同为 `true`，但失去显式哨兵锚点） |
| `readPoolSize`          | 1      | 读平面并行池（0.4.0 线二期，D5/D7/D8/D9）：读平面 = explore/librarian，写平面（Hermes/Hephaestus/Prometheus/Oracle/Looker/自定义角色）恒单线。`1` = 关闭 = 全局单线现状（逐字节等价改造前）；`2~3` = 读平面并发上限（写平面不受影响，读任务 lane-aware 上岗——队首读任务满池时写任务可越过上岗，lane 内仍 FIFO）。`>3` 钳制 3，非法值回落 1。挂载期读一次，不做运行时切换。当前装机 yml 显式 `3`（读平面并发上限顶格；2026-09-18 由保守起步的 `2` 扩到 `3`，防回潮哨兵 test/report-clause.test.mjs 的 readPoolSize pin 站岗） |
| `spawnEndGraceMs`       | 2000   | E2 end 缓冲宽限（0.4.0 线二期，D16）：`subagent/end` 抢在 spawn resolve 登记之前到达时暂存缓冲，等待登记追上后按真 id 精确认领重放全量归因管线；超此宽限未认领则按「无从归属」落档，并对滞留超时的 spawning 占位做 failed 落账回收（防 lane 槽泄漏）。等的是 spawn 网络窗口，慢网络部署可调大 |
| `relayChains`           | false  | 接力链总闸（0.4.0 线三期，D21~D29）：关 → `chain_start`/`chain_resolve` 不注册，编排退回无链现状；开 → **依赖 `reportExternalization=true`**（D23 fail-fast：链的数据面从 board 直投上一棒全文，总闸关则 `chain_start` 直接报错指路，绝不静默降级）。挂载期读一次，不做运行时切换。当前装机 yml 显式 `true`（与总闸同批点亮，依赖满足） |

编排台账（history，每桶 `HISTORY_CAP` = 200 条，桶数上限
`LEDGER_PARENTS_CAP` = 200）持久化在
`<DSH_HOME>/dsh-my-go/orchestration-ledger.json`（`DSH_HOME` 缺省
`~/.dsh`），进程重启后读回——跨重启 `continue` 已完工子代理经 harness
coldResume 续聊可用。落盘按 250ms 防抖合并、同目录 `.tmp` + rename 原子写；
插件卸载时若防抖窗尚未到期，清理函数**同步补写**这一次变更（窗口内的最后
一次完工/复活不再随进程蒸发）。

## 故障排查 / FAQ

集中入口。现象 → 判定 → 出路，细节见各自交叉引用。

- **预设选择器里没有「MyGO!!!!! 模式」**：preset 半没装上。先看启动日志有没有
  `[dsh-my-go] preset synced to ...` 一行——没有多半是 `dsh plugin add` 的路径
  写错（装的是 junction，路径必须永久稳定）。判定与出路见上文「验证装对了」
  与「首启会发生什么」。
- **面板空白 / 显示「编排桥未就绪」**：桥未就绪是提示态不是故障（host 在启动
  或快照桥缺位）；lib-only 部署形态（preset 未装配）面板**设计上**就降级为空态
  `{ seq: 0, parents: {} }` + 花名册常驻，不提供编排能力。headless/CLI profile
  无 `webServer`，面板通道不注册属正常。见 docs/ARCHITECTURE.md §2 与 §3。
- **面板 RPC 全吃 405 / 红字横幅常驻**：宿主 `0.1.5-alpha.1` 的
  `connection.rpc.handle` 注册即抛（宿主缺陷），`0.5.0-tisitan.2` 起已改
  `webServer` 直注册绕开——`git pull` 升级本插件即可，客户端零改动。
- **模型下拉清单拉不到**：清单来自宿主 `remote.session.modelCatalog()`（与官方
  Subagent 卡同源），读失败的渠道会**行内标出原因**，不与「该渠道真的没模型」
  同形；清单不在场时直接手填（input+datalist 组合框），插件不内置任何模型名。
- **重启后 `continue` 报 unknown sub-agent id（台账失忆）**：编排台账与报告板、
  观测埋点都在 `<DSH_HOME>/dsh-my-go/` 下——两次启动的 `DSH_HOME` 指向不同
  目录即「换家失忆」；确认环境变量一致。台账 v1 旧档落在 'legacy' 兜底桶
  （跨重启经全局扫描命中，面板父区不显示）。见 docs/ARCHITECTURE.md §2.1。
- **手改已安装 preset 被悄悄覆盖（版本标记幂等同步陷阱）**：同步判据是
  `<版本>+<内容摘要>` 双门——包内任何一次真实内容改动（**含同版本热修**）都会
  换摘要并触发重拷，「同版本就跳过」不成立；反之同版本同内容时装机侧手改
  存活。给 broker 行加调参 `config:` 后要记得：preset 同步会覆盖该行，改完
  须保留本键（防回潮哨兵站岗的键同理）。见 docs/ARCHITECTURE.md §5。
- **broker 调参 config 改了不生效**：这些键只由 preset 半 broker 行读取
  （tisitan.21 起 lib 半不再读取）——要改**已安装 preset** 的
  `~/.dsh/.agent-presets/dsh-my-go/agent.cordis.yml`，且只对新开的 MyGO 会话
  生效（挂载期读一次，不做运行时切换），改完重启 `dsh web`。见上文
  「插件 config 键」。
- **找不到设置页**：`0.5.0-tisitan.3` 起配置入口是官方插件页配置卡
  （DSH Web → 插件 → dsh-my-go → 配置区），旧「MyGO 编排」侧栏 section 已
  连代码退役；面板加载的是 `dist/client.js`，版本过旧时先升级（见「升级」节
  关于 release commit 的提示）。

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
| [prompts/prometheus.md](prompts/prometheus.md) | 拆解素材分析    |
| [prompts/oracle.md](prompts/oracle.md)         | 架构调试（疑难兜底）|
| [prompts/apelles.md](prompts/apelles.md)       | 可视化画师      |

## 目录结构

```
dsh-my-go/
├── AGENTS.md              # 本项目的编排规格（Sisyphus 系统）
├── README.md              # 本文档
├── package.json           # npm 包声明（dsh.bundle.patch → cordis.patch.yml）
├── cordis.patch.yml       # bundle patch（dsh plugin add 后自动挂载 host 插件）
├── lib/index.js           # npm 包 host 半（721 行：settings 存储 + revision 围栏 + 面板 RPC（快照裁剪/结构化名册/端点自带 try）+ preset 同步器（版本+内容摘要 marker + 5.3 波 tools/ 侧簇清单核验）；tisitan.21 起零编排面）
├── src/                   # client 半源码（tisitan.15 起装配层 + 模块化）
│   ├── client.js          #   装配层（265 行）：接线两模块 + 注册 DSH slots + 宿主服务缺席时真降级（sessions 惰性解析）
│   ├── client-constants.js#   共享常量（色板/标签/intent 文案，零 React）
│   ├── panel-tree.js      #   树状图面板 + 轮询（in-flight 门 / 失败退避 / 迁移留痕）+ 自动跳转（结构化花名册）
│   ├── settings-core.js   #   官方插件页配置卡（两块两列主从 / 草稿与栅栏 / 读回回执 / 保存条）
│   ├── settings-ops.js    #   命名空间 ops 编译层（读面投影 / 显式携带写面 / 读回判落盘 / 摘要，纯函数）
│   ├── client-styles.js   #   配置卡样式表（宿主 color token + 布局契约，随卡生命周期注入/摘除）
│   ├── settings-guard.js  #   未保存与并发写守卫纯函数（结果归一 + beforeunload 挂钩，Node 侧可直测）
│   ├── roles-editor.js    #   角色详情栏（模型优先级 / 档位 / persona / 工具名单 / 导入导出删除）
│   ├── chain-rows.js      #   模型优先级列表编辑器纯函数（node --test 与 bundle 内联同源）
│   ├── roster-rows.js     #   自定义角色纯函数（同上，含卡摘要/导入导出/persona 覆盖）
│   ├── panel-format.js    #   面板格式化纯函数（同上）
│   ├── usage-price-rows.js#   单价表编辑纯函数（桶净化/行校验/CRUD，同上）
│   ├── usage-prices-editor.js # 单价详情栏（四桶 + 币种，行级校验提示）
│   ├── usage-views.js     #   用量面板三视图派生纯函数（价格索引/成本/紧凑格式化/空态）
│   └── usage-panel.js     #   面板「用量统计」区（三视图 tab，纯展示不发 RPC）
├── scripts/build-client.mjs  # esbuild 打包 client → dist/client.js
├── scripts/dump-session.mjs  # 会话档案取证 CLI（tisitan.16，npm run dump:session）
├── test/                  # 冒烟 + node --test 全档（42 个 *.test.mjs + test/helpers/
│                          #   共享 ctx 替身；例数以 `npm test` 机器读数为准，见「贡献」）
├── dist/                  # 构建产物（`client.js` **随 release commit 入库**，见 docs/FORK-GUIDE.md「发布流程」；其余中间产物不入库也不落盘）
├── preset/                # agent preset「MyGO!!!!! 模式」（复制到 ~/.dsh/.agent-presets/）
│   ├── preset.yml
│   ├── agent.cordis.yml
│   ├── shared/            # 共享源（tisitan.15）：constants / failure / archive /
│   │                      #   roles / orchestration / misc / child-registry /
│   │                      #   adjacent / end-attribution / board / paths /
│   │                      #   report-format / relay-chain（零 @deepseek-ai、零 ctx；
│   │                      #   铁律见各自头注释；tisitan.21 起编排面模块仅 broker 消费）
│   └── tools/             # preset 层注册的 broker 工具半（批次 5 拆分后：接线骨架
│                          #   + 11 个同级簇模块。依赖单向：broker.mjs → 簇模块，簇
│                          #   模块零回引本体、簇间零互引，跨簇协作一律在本体接线段
│                          #   显式注入 deps；装机哨兵清单见 lib/index.js 的
│                          #   BROKER_CLUSTER_ROSTER）
│       ├── broker.mjs               # 编排接线骨架：活状态与 config 常量、settings 块、
│       │                            #   各簇实例化与接线、快照枢纽 bump、留守 helper（编排
│       │                            #   实例定位与报告落板兜底）、生命周期 handlers 与
│       │                            #   agent/request waterfall（工具面、模型能力、调度核、
│       │                            #   end 管线等实现本体都在下列 broker-*.mjs 里）
│       ├── metrics.mjs              # 观测埋点（编排动作追加写 events.jsonl，config.metrics 总闸）
│       ├── broker-ledger.mjs        # 台账持久化：history 落盘/读回（tmp+rename 原子写）与
│       │                            #   冷记录兜底查找，重启后 continue 已完工 childId 仍命中
│       ├── broker-notify.mjs        # 父会话补充通知：上岗/失败附因/求助清退的一行短通知
│       │                            #   经 parent.inject 注入（非唤醒），注入失败静默不阻塞
│       ├── broker-capability.mjs    # 模型能力缓存：modelExists / supportedEfforts 跟随 DSH
│       │                            #   模型目录，settings/updated 整体作废（结论三态不永挂）
│       ├── broker-dispose.mjs       # disposed 宽限期兜底：给活记录挂 grace 定时器（墓碑
│       │                            #   由本体立），end 真缺席才按 failed 落史 + retireChild
│       │                            #   + 推队列三连解冻
│       ├── broker-endbuffer.mjs     # E2 end 缓冲重放：抢跑 spawn resolve 的 end 暂存，登记
│       │                            #   追上后按真 id 精确认领重放全量归因管线；超时显式落档
│       ├── broker-delivery.mjs      # continue/forward 投递链五件共用件（定位 / 门面 steer /
│       │                            #   abort 掐断 / queued 投递 / 投递后复籍），同步段 await
│       │                            #   次数与原分支逐一对应
│       ├── broker-relay.mjs         # 接力链 dispatcher：链记录 patch/ops 写回、hop 占位键
│       │                            #   反查表、台账 bump/save 与队列驱动（决策在 shared）
│       ├── broker-bootstrap.mjs     # persona 装配 / prompts 读盘缓存 / DSV4P0813 两段式
│       │                            #   bootstrap（碰 ctx 的动作一律经回调注入，簇内纯组装）
│       ├── broker-tools.mjs         # 编排十具注册体（go_work / continue / need_help /
│       │                            #   forward / orchestration_status / list_subagents /
│       │                            #   report_submit / report_fetch / chain_start /
│       │                            #   chain_resolve）+ agent/created 双侧 deny 闸
│       ├── broker-scheduler.mjs     # 调度核：spawnChild 唯一派发出口、dispatchWork /
│       │                            #   advanceQueue / 队列重试（互递归环整体内聚本簇）+
│       │                            #   名册路由薄壳与停摆可观测
│       └── broker-ending.mjs        # end 管线：processEnd dispatcher、finalizeEnd 落账收尾、
│                                    #   失败备选链重派与报告补发链（归因决策在 shared）
├── prompts/               # 9 个智能体 prompt
└── docs/                  # ARCHITECTURE.md / FORK-GUIDE.md / DEV-SANDBOX.md（沙盒验收手册）/
    │                      #   usage-stats-design.md（用量统计设计）/ plans/（3 篇语义与架构方案）/
    │                      #   archive/（审查报告归档）
    └── legacy-broker-ts/  #   归档 TS 参考实现（停维护，原根目录 broker/）
```

## 文档地图

docs/ 各篇定位与阅读顺序（各篇文首自述其 scope，此处按「想干什么」索引）：

| 先读 | 文档 | 定位 |
|---|---|---|
| ① | 本 README | 使用与安装 |
| ② | [AGENTS.md](AGENTS.md) | 编排行为**运行时规格**（通信工具协议 / 质检规则，Sisyphus 系统提示的权威源） |
| ③ | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **架构真相**：实现机制、两半分工、报告外部化 / 接力链 / 读池 / 用量 / 配置迁移各新面 |
| ④ | [docs/FORK-GUIDE.md](docs/FORK-GUIDE.md) | fork 维护手册：逻辑图 + 机制到文件的映射 + 发布流程与已知陷阱 |
| ⑤ | [docs/DEV-SANDBOX.md](docs/DEV-SANDBOX.md) | 开发沙箱：改代码前必读（第二 DSH_HOME 实验纪律、验收判据） |

按需查阅：

- [docs/usage-stats-design.md](docs/usage-stats-design.md) —— 用量统计的**契约**文档（唯一规格源，非实现说明；settings 两键 / 聚合规则 / RPC 形状的裁决都在这）。
- [docs/plans/](docs/plans/) —— 历史规划，**已全部兑现**：0.4.0 三期改造总规划（next-gen-architecture-0.4.0.md）、读平面并行池语义（read-pool-semantics.md）、接力链状态机语义（relay-chain-semantics.md）。查设计裁决出处（D 编号）时来。
- [docs/archive/](docs/archive/) —— 历次评审归档（2026-08-30 总审查 / 2026-09-19 全面体检 / broker-lib 双半审查），行号与结论冻结在各自时点，不随实现更新。
- `docs/legacy-broker-ts/` —— 归档 TS 参考实现，停维护、不参与构建。

[prompts/](prompts/) 的 9 篇是**运行时人设资产**（Sisyphus + 八工种，职责见上文
「智能体 Prompt」表）：spawn 时按工种加载，同步器对 prompts 树做「先删净再拷」
的镜像同步；配置卡「载入文件默认」按钮拉取的就是这些档案原文。

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
ℹ tests 605   ℹ pass 605   ℹ fail 0   ℹ skipped 0
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
       "dsh-my-go": "link:C:/path/to/dsh-plugins/dsh-my-go"
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
