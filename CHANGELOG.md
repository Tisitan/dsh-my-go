# Changelog

本文件记录 Tisitan fork 相对上游 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go) 的变更。
版本号规则：`上游版本-tisitan.N`。

## [0.2.3-tisitan.9] - 2026-08-25

「失败附因时序性失效」修复批：`preset/tools/broker.mjs` 与 `lib/index.js`
同构实施。

### 根因

`subagent/end` 的发射晚于 live store 摘除：continuable Activation 的销毁
顺序（dsh-subagent/lib/types/continuation.js ~L1016-1050）是 capture →
`handle.dispose()`（连带把子 session 从 sessions live store 摘除）→ 删
activation → `observer.settle()` 才 emit `subagent/end`。因此 tisitan.8 经
`sessions` 服务 API（`sessions.get(childId).events`）的失败附因读法在 end
处理器里必然落空、静默退回 undefined——真机实测 failed 记录只有
'(error)'。`'sessions'` 服务名与 API 形态均正确，唯一问题是时序。

### 修复：失败附因改读持久化档案（主路径）

- **主路径**：新增 `readArchivedTurnFailure(childId)`（模块级导出），按
  dsh-session-persistence-jsonl 的目录规则拼出
  `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(childId)>/
  session.jsonl.zstd`——`projectKey` / `encodeSegment` / 帧扫描
  `scanZstdFrameRanges` 逐行对齐其 lib/index.js:106-124 / :84-96 /
  :503-566（root 解析惯例：dsh-home-paths/lib/index.js:73）。
- **多帧逐帧解压**：`session.jsonl.zstd` 是多 zstd 帧追加容器，Node 的
  zlib 单帧接口只吃首帧；先扫描完整帧界（末帧不完整则截断），倒序逐帧
  `zstdDecompressSync`（最新帧最先，命中即早退），帧内倒序扫行取最后一条
  `turn/end` 且 `reason.kind==='error'` 的 `reason.error {message, code}`。
  持久化记录与 live events 同构（`{type, seq, time, data}`，真机档案实证）。
- **live 读法保留为快路径**：先 live 后落盘，哪边先拿到用哪边；live 快
  路径异常不再直接吞掉结果，而是放行档案主路径。
- **可观测性**：找不到档案 / 帧扫描失败 / 解压失败 / 无 error 事件，均维持
  静默退回 undefined（不阻塞 end 落账）但各加一条 `console.warn` 留痕，
  不再静默吞。
- 同步更新 FORK-GUIDE 已知陷阱（「读档兜底」→「读持久化档案兜底」+ 时序
  根因）与 ARCHITECTURE 的失败附因来源描述。

### 测试

- `test/bridge.test.mjs` 新增 2 例：真实多帧 zstd fixture（两帧真实压缩
  拼接，turn/end error 只在末帧，live store mock 摘除复刻销毁时序）断言
  附因 message/code 落入 history 结论与父通知；无档案时断言静默退回
  '(error)' + warn 留痕且不抛。

## [0.2.3-tisitan.8] - 2026-08-25

「可观测性」批：补齐编排黑盒的四条观测缝（队列映射、失败附因、截断阈值、
跨重启台账），`preset/tools/broker.mjs` 与 `lib/index.js` 同构实施。

### 父会话补充通知（经 harness 公开 API `parent.inject`，非唤醒注入）

- **队列上岗映射推送**：`advanceQueue` 派发成功、占位记录 `bindChild` 到
  真身后，向父会话注入一行短通知
  （`[dsh-my-go] 队列任务上岗: work-xxx → <childId> (<agentType>)`）——
  Sisyphus 手里的 `go_work` 返回值只有占位 id，映射关系此前只能靠
  `orchestration_status` 反查。注入失败静默兜底，绝不阻塞派发。
- **失败附因推送**：`subagent/end` 的 `stopReason` 为 error 类时，经
  `sessions` 服务读该子会话最后一条 `turn/end` 的 `reason.error`
  （harness 通知层载荷丢失 error.message，读档为兜底路径，失败静默退回
  无附因），向父会话注入
  `[dsh-my-go] 子代理失败: <childId> (<agentType>): <message> [code]`；
  同一原因同时追加进 history 记录的 conclusion 尾部
  （`orchestration_status` 可见完整原因）。`inject` 声明补 `'sessions'`。
- 双通知（reported + settled）为 dsh-subagent 硬编码模板，插件无法抑制
  或改写——留档不动，补充通知走自己的 `plugin/notice` 通道。

### 截断可配置（新增 4 个插件 config 键）

- `statusHistoryLimit`（默认 12）：`orchestration_status` 历史条数（原硬编码 5）。
- `statusConclusionMax`（默认 400）：单条结论截断（原 80）；**failed
  记录的结论不截断**——错误信息必须完整到达。
- `helpContentMax`（默认 240）：单条求助内容截断（原 120）。
- `subagentPromptMax`（默认 200）：`list_subagents` prompt 摘要（原 140）
  及会话 label / `go_work` 返回 label 的 prompt 摘要（原 60）。

### continue 体验

- 「unknown sub-agent id」报错文案附操作提示（该 id 不在编排台账；进程
  重启过且台账未覆盖时请用 `go_work` 重派），`continue` / `forward`
  两处同改。
- **台账持久化**：history 记录（done/failed，上限与内存 cap 200 对齐）
  防抖 250ms 落盘为 `<DSH_HOME>/dsh-my-go/orchestration-ledger.json`
  （沿用 `ensurePresetInstalled` 的 DSH_HOME 惯例，独立插件状态目录，
  不进 preset 同步目录）；插件加载时读回。任何台账变化经 `onChange`
  调度落盘，写盘走 Promise 链串行化，热路径零同步阻塞。持久化让跨重启
  `continue` 经 harness coldResume 可用（继续失败的语义不变）。

### 面板可见性（`src/client.js`，已重建 `dist/client.js`）

- 队列分区节点补渲染 work-id（此前只有工种名，占位 id 不可见）。
- snapshot RPC 桥未就绪时面板显示「编排桥未就绪」提示态（refresh 全路径
  标记 `bridgeOk`，仅状态迁移时 emit，600ms 轮询不重复渲染），不再静默空白。
- 设置页 Oracle 工种标签残留的「疑难兜底·终验 Oracle」改为
  「疑难/极端复杂兜底 Oracle」（tisitan.7 遗留，与 oracle.md 新口径对齐）。

### 测试与文档

- `test/bridge.test.mjs` 新增 4 例：队列上岗映射通知（mock agents inject
  通道断言）、error stopReason 附因入 history + 父通知（mock sessions
  读档）、截断 config 生效且 failed 结论不截断、台账持久化 round-trip
  （写盘后重载可 revive）。`mockCtxFull` 默认按用例隔离 DSH_HOME 临时
  目录，防跨用例台账串档。27/27 全绿，`tsc --noEmit` 干净。
- `docs/FORK-GUIDE.md`「已知陷阱 / 限制」补两条（双通知机制性重复不可
  抑制；harness 通知层丢失 error.message，broker 读子会话档兜底）；
  `docs/ARCHITECTURE.md` 同步台账持久化与补充通知机制；README 新增
  「插件 config 键」小节。

## [0.2.3-tisitan.7] - 2026-08-25

「去私有化 + 泛化完善」批：清除上游作者与使用者个人环境的残留，让 fork
在任意 DSH 环境开箱可用。

### 去环境私货

- **默认绑定清空**：`defaultBindings()`（`preset/tools/broker.mjs`、
  `lib/index.js`）七工种全部改为 `{}`——不再内置任何 provider/model 名，
  子代理完全继承环境默认路由。按工种分流改为纯用户配置，README 新增
  「工种模型绑定」小节（WebUI / `settings.yaml` YAML 示例）。
- **tool-mask 参数化**：`preset/tool-mask.mjs` 的屏蔽清单支持
  `agent.cordis.yml` 行 `config.deny` 覆盖；原 7 个 `mcp__vcp__*` 名字
  保留为默认示例并标注「按你的环境裁剪」；逐名 try/catch 静默跳过语义
  不变。nova/Rei 等个人环境注释改写为中性描述（含 `agent.cordis.yml`）。
- **包身份切换**：`package.json` 的 author/repository/bugs/homepage 指向
  Tisitan/dsh-my-go；`files` 白名单补 `CHANGELOG.md`、`AGENTS.md`；
  publish.yml 的 OIDC 提示改为泛指「你的 fork 仓库」。
- **私有路径清除**：AGENTS.md / docs/ARCHITECTURE.md / agent.cordis.yml /
  归档 broker/src 注释中的 `tmp/liangshen`、`tmp/oh-my-openagent`、
  `tmp/dsh-handbook` 引用改写为中性描述；归档 `model-binding.ts` 的
  默认值注释标注「tisitan.7 起运行时默认已泛化」（代码不改，见
  broker/README.md 归档说明）。
- README 的上游作者博客链接明确标注为「上游作者开发手记（原项目背景）」；
  AGENTS.md / README / ARCHITECTURE.md 中的具体模型名建议表泛化为
  能力档位（便宜轻量/中等能力/强能力模型）。

### prompt 与代码一致性

- `prompts/oracle.md` 删除「终验/最终验收/判定通过驳回」口径——验收是
  Sisyphus 的质检本职，Oracle 只做疑难/极端复杂的架构调试（对齐
  tisitan.1 后的 sisyphus.md）；同步修正 AGENTS.md、README、
  `describeAgent('oracle')` 与 sisyphus.md 工种清单的同款表述。
- `prompts/hermes.md` 工具名 `fs-search`/`fs/edit` 改为模型实际可见的
  glob/grep/edit。
- `broker.mjs` persona 切分注释修正（只按 `## 编排规则` 切，与代码一致）。

### 健壮性

- **supportedEfforts 负缓存修复**：capability 查询失败不再永久缓存 null
  （只缓存查询成功的结果，失败留待下次请求重试），与 modelExists 策略
  对齐（`broker.mjs` + `lib/index.js` 同构修复）。
- **模型校验日志降噪**：`agent/request` 每请求的 `console.log` 移除，
  仅在校验不通过时 `console.warn`。
- **settings schema 核查**：lib 的四字段 schema 经核实无需改动——
  schemastery 对象字段默认即非必填（仅 `.required()` 才强制），与
  saveSettings 空值 unset 语义无冲突（该库无 `.optional()` 方法，
  添加反而会让注册抛错被静默吞掉）。

### 工程

- **CI 修复**：`.gitignore` 不提交 lockfile 但 ci.yml / publish.yml 使用
  `bun install --frozen-lockfile`（新 clone 必败）——去掉两个 workflow
  的 `--frozen-lockfile`。
- **测试补强**：`test/bridge.test.mjs` 新增 3 例——空绑定继承父渠道
  且不设 model、指定 model 经 modelExists 通过与失败两分支、
  settings 重基线（WebUI 取消字段回落默认）回归保护。23/23 全绿，
  `tsc --noEmit` 干净；本批次不动 `src/client.js`，无需重建 dist。
- `docs/FORK-GUIDE.md` 新增「已知陷阱 / 限制」小节（合并语义无法表达
  「完全不指定模型」、`bindSisyphus=true` 全局副作用、默认绑定已清空
  需用户自配、tool-mask 默认清单只是示例）。

## [0.2.3-tisitan.6] - 2026-08-25

首次实战确认的编排故障修复批（`preset/tools/broker.mjs`，镜像同步 `lib/index.js`）。

### Critical 修复

- **队列停摆**：`advanceQueue` 派发失败回补队首后再无任何触发源，队列永久
  卡死（实战观察：`work-*` 条目滞留、currentMap 空、面板显示 idle）。
  现回补时挂带线性退避的重试定时器（默认 1s/2s/3s，上限 3 次；间隔
  仅 lib 半经插件 config `queueRetryBaseMs` 可调，preset 半 broker 行
  未暴露 config 字段）；超上限后 `dropQueuedFailed` 将任务从
  队列移除并写 failed 历史 + `console.error`，同时继续消化后续排队任务。
  另修两条隐性停摆路径：`subagent/end` 归随兜底失败时不再静默 return
  （留痕并照常推进队列）；`inject` 增补 `agents` 服务声明，保证队列路径
  按 parentId 重解析父会话时注册表可见（直发路径传活对象所以从未失败）。
- **历史工种串号（系统性）**：根因是 `agent/disposed` 无条件
  `sessionTypes.delete`（若 disposed 先于 `subagent/end` 到达，end 丢失
  类型登记）+ 归随兜底把任何丢失类型的 end 盲目错绑到当前 spawning 记录
  （记录的 agentType 属于别人），错绑又导致真实 childId 的 `bindChild`
  静默失败、游离于编排之外，级联错乱。修复：销毁时代理类型移入有界墓碑表
  （`disposedTypes`，FIFO 50 条）而非直接删除；`subagent/end` 类型取证
  顺序改为 活登记 → 墓碑 → 编排台账（已有归属记录时以台账为准，迟到/
  重复 end 忽略并留痕）；归随兜底仅作最后手段且必留 `console.warn`。

### 隐患修复

- `bindChild` 占位记录缺失时不再静默 `return undefined`，改发
  `console.warn` 诊断（真实 childId 游离事件可观测）。
- `finish` 无活记录可落账时（如已被 disposed 兜底清槽）补 `console.warn`。

### 工程

- `test/orchestration.test.mjs` 新增 2 例（bindChild 告警 / dropQueuedFailed
  落账）；`test/bridge.test.mjs` 新增 3 例 apply 级回归（队列回补后重试
  消化、重试超上限放弃并写历史、disposed-先于-end 竞态不串号）。
- `npm test` 全绿；本批次未动 `src/client.js`，无需重建 dist。

### 二次修复（tisitan.6 部署后实测，并入本批次）

首次部署实测确认：重试/放弃/留痕机制工作正常，但暴露两处更深根因。

- **队列路径派发必败 TypeError（真正根因）**：`advanceQueue` 以
  `dispatchWork(work.agentType, work.prompt, parentAgent, undefined)` 调用，
  第 4 参数 signal 为 `undefined`；而 dsh-subagent 的
  `SubagentContinuationManager.startContinuable` 无条件调用
  `spec.signal.throwIfAborted()`（其 lib/index.js:797），signal 缺失即抛
  `TypeError: Cannot read properties of undefined (reading 'throwIfAborted')`。
  直发路径 `exec.signal` 由 DSH 工具执行器恒提供所以从未失败；此前的
  `inject: ['agents']` 增补并非真凶（父会话解析一直成功）。修复：
  `dispatchWork` 内归一化 `signal ?? new AbortController().signal`——队列
  路径没有调用方可取消，合成永不中止信号语义正确。
- **正常完工子代理不进历史**：DSH continuable 生命周期中 `agent/disposed`
  **恒先于** `subagent/end`（finishDisposal 内 `handle.dispose()` 先于
  `observer.settle()`）。本批次初版的 disposed 兜底立即 `abort` 活记录，
  导致紧随的合法 end 被判「no live record」、结论丢弃（实测：explore
  完工但历史只有 hermes 的 failed 一条）。修复：disposed 时只立墓碑并挂
  宽限期兜底定时器（默认 500ms；仅 lib 半经插件 config
  `disposeEndGraceMs` 可调，preset 半 broker 行未暴露 config 字段）；end
  到达即取消兜底并正常 `finish` 落账；end 真缺席才由兜底 abort 清槽
  推进队列（防队列冻结的本意不变）。
- **回归测试补强**：`test/bridge.test.mjs` 的 mock 复刻 dsh-subagent 真实
  契约（`withRealSignalContract` 无条件解引用 `spec.signal`，exec 恒带
  signal）——旧 mock 完全忽略 spec，正是「队列回补后重试消化」通过了但
  实测败的原因；改写 disposed-先于-end 用例为生产时序（必须落账 +
  不串号 + 兜底被取消）；新增 disposed 后 end 缺席用例（宽限期兜底
  清槽并消化队列）。20/20 全绿，`tsc --noEmit` 干净。

## [0.2.3-tisitan.5] - 2026-08-25

### UI 中文化（Tisitan 环境）

- 设置页全面汉化：工种卡片改为「总调度·质检 Sisyphus / 快速执行 Hermes /
  快速检索 Explore / 文档查询 Librarian / 多模态看图 Looker / 代码编写
  Hephaestus / 需求规划 Prometheus / 疑难兜底·终验 Oracle」；字段标签
  Provider/Model/Reasoning Effort → 渠道/模型/思考档位；思考档位选项
  low/high/max → 低/高/最高；头部补充字段说明与 DSV4P0813 补丁的人类注释。
- 树状图面板汉化：工种名用中文角色标签，求助 intent 显示为
  「检索/查文档/看图/请求换工种/请求代执行/请求问用户」。

## [0.2.3-tisitan.4] - 2026-08-25

### 部署适配（Tisitan 环境）

- **tool-mask 同步**：新增 `preset/tool-mask.mjs`（配方取自本机 `nova` preset），
  在 preset 作用域屏蔽 Rei 角色记忆工具与 OpenCode 桥接共 7 个
  `mcp__vcp__*` 工具——对 Sisyphus 与全部子代理同时生效（preset scope 覆盖
  整个 standing mount）。逐名 try/catch + 失败 `console.warn` 告警，
  工具缺席不炸挂载。`preset/agent.cordis.yml` 末尾新增 tool-mask 行。

## [0.2.3-tisitan.3] - 2026-08-25

### 修正（安装前自查发现）

- **摘除 lib 的 `agent/created` 钩子**：tisitan.1 镜像拓扑闸时误给 lib（global
  层插件）也挂了 skill 隐藏/拓扑闸钩子——该事件在 global 层会收到 profile 内
  **所有**会话（含非 MyGO 会话），装上去会拔掉其他 preset 会话的 skill 工具。
  钩子只应作用于 MyGO preset 会话，由 preset 作用域的 broker.mjs 独占负责
  （standing scope listener 只接收 join 它的 agent 的事件）。lib 恢复上游行为。

## [0.2.3-tisitan.2] - 2026-08-25

在 tisitan.1 基础上的稳步升级批（全部经测试验证；评估后不安全的改动仅文档化）。

### 功能补全

- **client 自动跳回父会话**：子智能体结束后 `sessions.open(parentSessionId)`
  跳回 Sisyphus（ARCHITECTURE.md §3 的闭环此前未实现）；手动跳转不再传空
  `parentSessionId`（读快照字段）。

### 清理

- 删除 `lib/index.js` 与 `preset/tools/broker.mjs` 中的死代码 `parseAgentType`
  （仅归档的 TS 参考实现使用，保留在 `broker/src`）。
- `broker/README.md`：明确标注 TS 目录为归档参考实现，不参与构建运行。

### 文档

- 新增 `docs/FORK-GUIDE.md`：全景逻辑图 + 文件目录树 + 机制映射表
  （什么功能由哪个文件通过什么原理实现）+ 未实施升级的评估结论
  （need_help 真 interrupt / isolate 服务桥 / projection 推流）。

## [0.2.3-tisitan.1] - 2026-08-25

基于上游 v0.2.3（main @ cf2d802）。修复来源：全项目三方交叉审查（详见审查报告）。

### Critical 修复

- **client：编排面板打不开**——`panelOpen` 外部变量与组件内 `open` state 脱钩，
  且 `force()` 无参调用触发 React bailout（面板首次刷新后永久 stale）。
  改为统一读外部 `panelOpen` + `force((c) => c + 1)` 重渲染（`src/client.js`）。
- **星型拓扑击穿**：preset 中原生 `subagent`/`subagent_fork`/`workflow`/`ralph`
  工具对子智能体可用，子代理可私自派生孙代。现于 `agent/created` 钩子在
  工具目录层对子代理摘除上述工具及 `go_work`/`continue`/`forward`
  （与 `canOrchestrate` 运行时守卫双保险）（`preset/tools/broker.mjs`、`lib/index.js`）。
- **复活死子代理不入册**：`continue`/`forward` 到已结束 childId 时不回
  currentMap 且 sessionTypes 已删，导致单线阻塞失效 + 结论静默丢弃。
  现投递成功后 `revive` 重新入册并恢复类型登记；有子代理运行中时拒绝复活。
- **失败路径失守组**：
  - 队列推进先 dequeue 后 dispatch 且错误被吞 → 任务蒸发。现抽出
    `advanceQueue()`，派发失败自动回补队首并记日志。
  - spawn 失败 abort 后不推进队列 → 死锁。现立即推进队首。
  - `forward` 先 resolveHelp、`continue` 先 resume 后投递 → 中途失败即
    求助丢失/假 running。现统一「先投递成功，后落账」。
  - spawn 竞态：子会话先于 `startContinuable` resolve 结束 → 永久卡
    spawning/running。现归因到唯一 spawning 占位记录并正常收尾。
- **settings 合并不可撤销**：在已合并的活 bindings 上叠加，WebUI 取消配置后
  旧值残留。现始终从 `baseBindings`（默认值 + 插件 config）起算。

### Major 修复

- DSV4P0813 phase-1 工具白名单使用了不存在的工具名
  （`read_file`/`write_file`/`edit_file`）→ 改为 DSH 实际注册名
  （`read`/`write`/`edit`/`glob`/`grep`）。
- `finish()` 不清除该子代理的 pending helpRequests → 幽灵求助可被 forward。
  现随 finish 一并清理。
- `modelExists` 把瞬时 listModels 失败永久负缓存为空集 → 模型绑定静默失效。
  现只缓存非空结果。
- lib 队列回退使用 `agents.roots()[0]`，多会话下把排队任务派到别的会话 →
  改用 `lastOrchestratorSessionId` 回退（与 broker.mjs 一致）。
- lib 的 RPC 快照缺 `parentSessionId`，client 自动跳转永不触发 → 已补上。
- `loadSettings` 失败后 `draft={}`，点保存即清空全部配置 → 加载失败保持
  `draft=null` 并禁用保存。
- `saveSettings` 把显式 `false` 当 unset → `dsv4p0813: false` 现可正确表达。
- lib settings 合并操作符 `??` → `||`（与 broker.mjs 统一，空串视为未设置）。
- `go_work` 排队时返回的占位 id 与工具文档矛盾 → 文档澄清 +
  `continue` 对排队 id 给出明确错误提示。
- 新增 `agent/disposed` / `session/disposed` 生命周期清理钩子，回收编排状态，
  防止跨会话泄漏与队列冻结。

### 一致性 / 文档

- `prompts/sisyphus.md`：删除「检索/文档归 hermes」与负面清单的矛盾表述；
  删除与 Oracle 闸门冲突的「终验」触发词。
- `ensurePresetInstalled` 真幂等：按版本标记文件 `.dsh-my-go-version` 同步，
  同版本不再覆盖用户对手工安装 preset 的修改（原注释宣称幂等实则每次强制覆盖）。
- `docs/ARCHITECTURE.md`：修正三处过时描述（need_help 无 interrupt 实为台账层
  挂起；effort 不做 low→high 硬映射而是不支持则留空；details 栏 → overlay 面板；
  补充 revive 语义与 compaction 回落未实现标注）。

### 工程

- 新增 `test/orchestration.test.mjs`：Orchestration 状态机 12 个单元测试
  （占位占锁/finish 清求助/revive/requeue/dropQueuedFor/history 上限等）。
- `npm test` = 冒烟测试 + 单元测试；`tsc --noEmit` 通过。

### 双 host 收敛（v1）

调研确认两半同属一棵 cordis fiber 树、同一 Node 进程，且 tools 注册表合并
语义为「最近的 scope 覆盖同名项」（dsh-scope/lib/index.js:177-181）——
MyGO 会话里 broker.mjs（preset 层）的工具天然压制 lib（global 层）的同名
工具，每个会话只存在一个编排权威。在此事实上的收敛方案：

- **数据面统一**：broker.mjs 通过 `Symbol.for('dsh-my-go.snapshot')` 全局
  注册表发布只读快照访问器；lib 的 RPC `snapshot` 端点优先读取它（真源
  实时读、零副本），桥不存在时回落 lib 自身状态机（非 MyGO 会话/无 preset
  部署形态，行为与上游一致、无回归）。面板裂脑（RPC 数据源永远空闲）修复。
- **lib 定位**：保留为 global 层 fallback（非 MyGO 会话仍可用编排工具）+
  settings 命名空间 + RPC 桥 + preset 同步器的宿主，两平面状态机各自自治、
  经 sessionTypes 门控互不干扰。

未来方向（未做）：按 dsh-goal 官方范式升级为 broker publish isolate 服务 +
host 经 `agentPresets.serviceFor` 拉取 + `session.append` 全量快照 +
projection 推流（替代 600ms 轮询并解锁冷会话回放）。当前 Symbol.for 桥在
拉取路径上与之功能等价，升级属锦上添花。

### 已知未决

- `broker/src` TS 参考实现已过时（仍用 `globalThis.harness.handle` 桥），
  保留仅供参考，不参与构建。
