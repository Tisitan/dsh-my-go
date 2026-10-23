# 配置参考

[返回 README](../README.md) · [使用与排错](USAGE.md)

本文区分两层配置：**用户设置**在 DSH Web → 插件 → dsh-my-go 修改，支持热更；**broker 行为参数**位于包内预设，组装会话时读取。代码兜底值与随包预设值分别列出。

## 用户设置

入口为 **DSH Web → 插件 → dsh-my-go → 配置区**。插件行 config 提供基线，用户设置覆盖基线；「恢复默认」回到基线或 schema 默认值。

- 编辑草稿后，点击「立即保存」才写入设置；模型与角色变更在下次派发时生效。保存期间可继续编辑，新改动会保留为「待保存」草稿，需要再次保存。
- 保存失败时草稿保留；根据回执处理连接或配置问题后可重试。若其他窗口或文件编辑已改动同一配置，页面会提示冲突：先复制需要保留的内容，再点「丢弃草稿并重读」，重新编辑后保存。
- 清空可空字段会撤销用户覆盖，回落到基线或默认值。手工编辑 `settings.yaml` 的 `dsh-my-go:` 段属于同一设置层，支持热更。
- 宿主保存时会重写 `settings.yaml`，手写注释可能丢失。非 loopback 来源可能为只读态，应检查保存回执。

| 配置项                          | 默认值         | 说明 |
|---------------------------------|----------------|-------------------------------------------------------------------------|
| `<type>.provider`               | 不指定（继承） | 该工种的 provider 路由；缺省时继承父会话渠道 |
| `<type>.model`                  | 不指定（继承） | 该工种的模型；缺省时继承父会话模型 |
| `<type>.reasoningEffort`        | 不指定         | 期望思考档位（如 high/max）；**只在模型实际支持时应用**，否则走模型默认 |
| `<type>.fallbacks`              | 空（不启用）   | 备选链 [{provider, model}]，主绑定失败时按序重派 |
| `roles`                         | 空（仅内置工种）| 内置工种覆盖与自定义角色名册 dict：`roles.<role>` 键名须 `^[a-z][a-z-]*$`，绑定字段同 `<type>.*`，另加 persona（见下方「自定义角色」） |
| `usagePrices`                   | 空（不计成本）  | 用量单价表 dict：键为 `{provider}/{model}`（在**第一个** `/` 处切分，OpenRouter 式 `openrouter/deepseek/deepseek-chat` 无歧义），每行四桶单价——`input` / `output` 必填（缺一整行丢弃），`cacheRead` / `cacheWrite` 可选（未定价 = 该桶只记 token 不计成本），单位随 `usageCurrency` 币种 / 1M tokens；空表 = 只记 token 不算钱 |
| `usageCurrency`                 | USD             | 单价表全局币种，`USD` \| `CNY` 单选（整表一个币种，不按行混币——混币种合计随汇率漂移无意义）；面板用量统计的成本列按它渲染符号 |
| `keepAlive`                     | 关（enabled=false）| 主编缓存心跳四子项：`enabled`（默认**关**，须显式打开）/ `orchestratorIntervalMs` 主编拍距（250000 ms = 5 分钟档 TTL × 5/6）/ `childPingAfterMs` 子代静默多久算「该探活」（1800000 ms = 30 分钟）/ `escalateAfterPings` 连续几轮建议 ping 仍无信号就升红（3）；**界面按秒示人、存量仍是毫秒**，把某项改回默认值保存 = 撤销该项覆盖（机制见下） |

单价不会自动从 provider 获取。未定价且有 token 消耗的模型或缓存分桶会使可计算费用成为部分估计，显示 `≥`；空价格表只展示 token。符号和历史完整性说明见[用量与费用](USAGE.md#用量与费用)。

**主编缓存心跳（`keepAlive`，默认关）**：开启后，broker 为各主编编排会话管理定时器，主编空闲时通过 `followup` 唤醒维护回合，并显示长期没有信号的子代理。这个过程会消耗 token，也会改变派发后的等待节奏。

默认间隔为 250 秒，即每小时约 14.4 次定时检查；实际唤醒次数和成本取决于会话状态、上下文与模型。配置卡按缓存 TTL × 5/6 计算建议拍距，5 分钟只是速算区默认输入，**不是所有供应商缓存时长的保证**。请按所用模型的缓存规则和实际用量决定是否开启。

机制细节（定时器、探活阈值、热更和边界）见 [架构文档](ARCHITECTURE.md) §2.12；功能沿革见 [CHANGELOG](../CHANGELOG.md) `[0.5.0]`。

表中的 `<type>` 是角色占位符：子工种字段实际写为 `roles.<type>.*`，Sisyphus 使用顶级 `sisyphus.*`。schema 的五个顶级字段为 `sisyphus`、`roles`、`usagePrices`、`usageCurrency`、`keepAlive`。

旧顶级子工种写法（例如 `hermes.model`）仍兼容：缺少同名 `roles` 行时自动迁移；显式 `roles` 行优先。`roles.sisyphus` 不参与运行时合并，不能用于配置主编。

### 工种模型绑定

插件**不内置任何模型名/渠道名**——所有工种默认空绑定，
子代理完全继承环境默认路由（与 Sisyphus 同渠道同模型）。需要按工种分流
（快活走便宜模型、重活走强模型）时，在 DSH Web → 插件 → dsh-my-go 的配置卡「模型与角色」
逐工种填写（左列选角色、右列改这一行），或直接编辑 `<DSH_HOME>/settings.yaml`（`DSH_HOME` 未设置时为 `~/.dsh`）：

```yaml
dsh-my-go:
  roles:
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

字段缺省即不覆盖。示例使用当前的 `roles.<type>` 存储形状；旧顶级写法仍按上文规则迁移。`model` 在派发前会经 `llm.listModels` 校验真实存在
才应用（不存在则跳过并回落父会话模型，日志 warn）；`reasoningEffort`
跟随 DSH 模型目录，模型不支持所配档位时留空走适配器默认。两份查询结果
按「只缓存结论」的纪律缓存：清单**列举成功**（哪怕为空）才入缓存，抛错/
服务缺席留待下次重试；能力表只有查到非空档位才入缓存（查不到＝未知，不
判死）。设置热更时两枚缓存整体作废，且此刻**在飞的旧响应不回写**（改完模型
清单/能力表无需重启即生效，也不会被一次陈旧拉取撤销）。

配置卡的模型下拉来自宿主模型目录。渠道或设置更新、连接恢复时会重新加载；目录暂时为空或渠道读取失败时，可先手填真实模型 ID，读取失败不会阻止保存。实际派发仍按上述模型校验规则处理。

建议分工：Sisyphus / Hephaestus 用中等能力模型，Hermes / Explore /
Librarian / Looker 用便宜轻量模型，Prometheus / Oracle / Apelles 用最强模型。

### 自定义角色（roles）

内置工种之外，可在 `roles` dict 定义自己的角色——每个角色拥有与内置
工种相同的绑定字段（provider / model / reasoningEffort /
fallbacks），另可加 `persona`（通过动态系统提示段注入子代理的人设文本）。角色键名须匹配
`^[a-z][a-z-]*$`：

```yaml
dsh-my-go:
  roles:
    reviewer:                       # 键名：^[a-z][a-z-]*$
      provider: your-provider
      model: your-model
      reasoningEffort: high
      persona: 你是严谨的代码评审员，只查逻辑硬伤。
```

- **派发**：`go_work` / `forward` 的 `agent` / `target` 参数接受名册内
  任意角色名（未注册名结构化报错并附当前可用清单）；
  `orchestration_status` 尾部展示活花名册。
- **迁移**：缺少同名 `roles` 行时自动补写旧顶级绑定；显式 `roles` 行优先。
  保留旧键且不向宿主提交非法 unset；写入失败仍可从旧键读取。
- **工具权限**：工种 allow/deny 功能已移除；旧配置中的 `toolFilter` 明确忽略。
  各工种继承宿主工具权限，宿主沙箱与审批边界、MyGO 防递归和邻接通信约束保留。
  历史子会话若已由旧宿主持久化过滤 descriptor，恢复时仍由宿主重放；本次不改写
  会话档案，需要完整继承新行为时请新派子会话。

配置卡「模型与角色」可新建、删除自定义角色，编辑模型优先级、persona，以及导入/导出单角色 JSON。改名时编辑「角色键名」并移开焦点：合法且未重名的新键名写入草稿；非法或重名时提示原因并恢复原名，清空也会恢复原名。点击「立即保存」后才持久化，后续派发使用新键名。

### 备选链（fallbacks，自动重派）

每个工种可配 `fallbacks` 备选链：链首是上文的 `provider`/`model` 主绑定
（attempt 0），其后每条备选依次为 attempt 1、2、…：

```yaml
dsh-my-go:
  roles:
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
  超时在 DSH 内建重试耗尽后）且错误分类器放行。用户中断/abort 类不触发切换；
  附因读不到（档案缺失）但有链时保守切换，日志注明「未读到附因，保守切换」。
- **动作**：同 prompt、同父会话、同工种自动重派，`agentOptions` 覆盖为备选
  条目；不入队、不占新槽位（原槽位语义内换键），不与泳道阻塞/队列交互。
- **预检**：备选条目同样经 `llm.listModels` 校验，无效条目 warn 跳过并尝试
  下一条；链尽即止（attempt 严格递增），全部失败落既有失败
  历史并保留失败附因。
- **留痕**：每次切换在历史/台账标注 `[备选 n/m] 失败 → 自动切换备选
  provider/model 重派`，并向原父会话推送一行重派通知。
- **已知限制**：备选重派的历史结论措辞先于 spawn 成功落史——重派 spawn
  失败时不改写已落历史，以 `console.error` 留痕并向原父会话推送修正通知。

配置卡每个角色的详情栏内置模型优先级列表编辑器（主选
与备选链合并）：#1 即主选（带徽章，空值=跟随 Sisyphus），#2..N 即
备选链顺序；逐行编辑 provider/model、↑↓ 跨边界调整链序（备选 ↑ 到顶 =
提升为主选，删 #1 则 #2 自动成为主选，列表至少保留主选位 1 条）、模型
下拉按所选渠道过滤，与 YAML 手工编辑等价（保存时拆解 #1→provider/
model、#2..N→fallbacks）。

### 接力链（relay chains）

**随包预设已启用接力链**；代码在未配置此键时回落 `false`。`relayChains=true` 时主编可声明**接力链**：一串按序执行的子代理跳
（2~8 跳），上一跳的完工报告全文经 board 直投为下一跳的输入数据块
（`<mygo_relay_input trusted="false">`），读→读跳之间免审自动接力，
主编上下文零全文过路。每个编排会话同时最多有一条活动链。两枚工具：

- **`chain_start`**：声明链并派发首跳。`hops = [{ agent, prompt?, gate? }]`，
  gate ∈ `auto`（缺省；首跳须为 auto，后续仅读→读可自动接力，prompt 必填预写）/
  `review`（挂起待主编审阅后放行）/
  `sync`（不可逆跳强制同步门，指令必须现场给）。
- **`chain_resolve`**：处置挂起的链——`continue` 放行/续命（review
  可带新 prompt 覆盖预写，sync 必带现场 prompt）、`abort` 弃链。

挂起的链不会因超时自动放行，进度可从 `orchestration_status` 和快照读取。报告不合格时先尝试补发，仍不合格则挂起为 `gate-verdict`，由主编决定继续或弃链。子代理 error 终局按备选重派流程处理。

下一跳输入缺失（board 不可读）时挂起为 `input-missing`。若子代理收到语义不可用的输入，例如空报告、无关内容或上游声明失败，应通过 `need_help` 请主编处理。

### 工具屏蔽（已迁移至 dsh-tool-guard）

本项目不再提供 preset 级用户工具屏蔽。需要维护工具拒绝名单时，使用独立部署的 **dsh-tool-guard** 插件及其 `denyTools` 设置；旧 `toolMask.deny` 不由本插件消费。

MyGO 仍在 broker 的 `agent/created` 环节维护编排拓扑约束：限制原生邻接消息通道及子代理自行派生，包含宿主启用的 Agent Teams 子作用域工具。各工种继承宿主权限，旧 `toolFilter` 被忽略；这与用户自定义工具名单是不同层次的规则。

### 插件 config 键（broker 行为调参）

以下参数位于包内 [`preset/agent.patch.yml`](../preset/agent.patch.yml) 的 **broker 行 `config:`**，由新会话组装时读取，不通过用户设置热更。修改后重启宿主并新建 MyGO 会话。

下表区分代码兜底值和随包预设值。显式配置优先；「同左」表示预设未另行改变行为。时间参数单位为毫秒。

| config 键 | 代码兜底 | 随包预设 | 说明 |
|---|---|---|---|
| `disposeEndGraceMs` | 500 | 同左 | `agent/disposed` 后等待 `subagent/end` 的宽限，超时兜底清槽推进队列 |
| `queueRetryBaseMs` | 1000 | 同左 | 队列派发失败的线性退避基数（1× / 2× / 3×，最多重试 3 次） |
| `statusHistoryLimit` | 12 | 同左 | 状态工具展示的历史条数 |
| `statusConclusionMax` | 400 | 同左 | 状态工具的结论截断长度；failed 记录不截断 |
| `helpContentMax` | 240 | 同左 | 状态工具的单条求助内容截断长度 |
| `subagentPromptMax` | 200 | 同左 | `list_subagents` 与会话 label 的 prompt 摘要长度 |
| `metrics` | true | 同左 | 写入 `<DSH_HOME>/dsh-my-go/metrics/events.jsonl`，上限 10 万行，超限截去旧行；false 关闭观测写盘 |
| `reportExternalization` | true | true | 注册报告工具，启用报告条款、落板与交付闸门；关闭时使用无报告板流程 |
| `readPoolSize` | 1 | **3** | Explore / Librarian 的读泳道容量；范围 1–3，超过 3 钳制为 3，非法值回落 1 |
| `writePoolSize` | 1 | **3** | Hermes / Hephaestus / Prometheus / Oracle / Looker / Apelles / 自定义角色的写泳道容量；范围与读池相同 |
| `spawnEndGraceMs` | 2000 | 同左 | spawn 登记前到达的 end 事件缓冲宽限；按真实 ID 登记后重放，超时则记录未归属事件并回收滞留占位 |
| `relayChains` | false | **true** | 注册 `chain_start` / `chain_resolve`；依赖 `reportExternalization=true`，否则 `chain_start` 报错 |

两池都为 1 时退化为全局单线；其他配置按泳道独立计数。并行写任务需确认写集不相交且无数据依赖。

台账与报告的存储位置、保留上限见[术语与存储](USAGE.md#术语与存储)，统计范围和估算限制见[用量与费用](USAGE.md#用量与费用)。配置源见 [`lib/config.js`](../lib/config.js)、[`constants.mjs`](../preset/shared/constants.mjs) 与 [`broker.mjs`](../preset/tools/broker.mjs)。
