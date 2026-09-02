# dsh-my-go（Tisitan fork）架构导览

> 面向使用者的「逻辑图 + 文件目录 + 机制映射」说明：系统改成什么样了、
> 每个功能由哪个文件通过什么原理实现。配套修复台账见 [CHANGELOG.md](../CHANGELOG.md)。

## 一、全景逻辑图

```
                        ┌──────────────────────────────────────────────────────────────────────────────────────────┐
                        │                                                                                          │
 用户 ──► DSH WebUI ──► │  【client 半】dist/client.js（React 插件）                                               │
 （浏览器）             │   ├─ 🧭 侧栏按钮 ──► shell.overlay 树状图面板（current/queue/help/history/roster）     │
                        │   ├─ 设置页「MyGO 编排」（内置 8 工种绑定五字段 + persona 覆盖 + 角色 CRUD               │
                        │   │   导入导出 + 工具屏蔽双列表 + 全卡片手风琴）                                         │
                        │   ├─ tisitan.15 拆分：panel-tree / settings-core / roles-editor /                        │
                        │   │   tool-mask-editor / client-constants（client.js 82 行装配层）                       │
                        │   └─ 600ms 轮询 ──┐                                                                      │
                        │                   ▼ RPC call('/dsh-my-go', endpoint)                                     │
                        │  【host 半】lib/index.js（profile bundle，global 层注册；632 行零编排面）              │
                        │   ├─ connection.rpc.handle('/dsh-my-go')                                                 │
                        │   │    ├─ snapshot ──► 读 Symbol.for('dsh-my-go.snapshot') 全局桥 ──────────┐            │
                        │   │    │                  （桥不在 = preset 未装配 → 降级空态               │            │
                        │   │    │                    {seq:0,parents:{}} + roster 常驻）          │           │
                        │   │    ├─ loadSettings / saveSettings ──► settings 命名空间 'dsh-my-go'    │             │
                        │   │    ├─ listModels ──► llm.listProviders + 逐渠道 allSettled 并行 listModels │             │
                        │   │    └─ listTools ──► tools.schemas() 全局花名册，服务端滤保留名 │                     │
                        │   └─ ensurePresetInstalled：按「版本+内容摘要」marker 同步 preset+prompts│            │
                        │                                                                          │ 实时读        │
                        │  【agent 半】preset/tools/broker.mjs（MyGO preset 装配时加载，preset 层注册）◄┘（零副本）│
                        │   ├─ Orchestration 状态机（编排真源）                                      │             │
                        │   │    currentMap(单槽,≤500) / queue(FIFO) / helpRequests / history(≤200) │              │
                        │   │        ▲ 每次迁移 bump() ──► 发布 latestSnapshot 到 Symbol.for 全局桥 ──┘            │
                        │   ├─ 6 工具：go_work / continue / need_help / forward /                                  │
                        │   │   orchestration_status / list_subagents（preset 层注册；                             │
                        │   │   tisitan.21 起编排唯一实现，lib 已无同名面）                                        │
                        │   ├─ systemPrompt 注入：Sisyphus persona + 编排规则（主会话）；                          │
                        │   │   子代理 persona/toolFilter 走 spawn 官方通道（tisitan.14）                          │
                        │   ├─ 共享源 tisitan.15：import preset/shared/（状态机/失败分类/                          │
                        │   │   档案读取/名册路由/工种识别/台账养护；tisitan.21 起编排面                           │
                        │   │   模块 broker 独有，lib 只引存储/面板面三模块）                                    │
                        │   ├─ agent/request waterfall：按工种绑定 provider/model/reasoningEffort                  │
                        │   ├─ agent/created：拓扑闸（子代理禁派生 + 邻接三件套）+ skill 隐藏                      │
                        │   └─ subagent/end：结论落账 + 队列推进；agent|session/disposed：状态回收                 │
                        │                   │                                                                      │
                        │                   ▼ ctx.subagents.startContinuable / queuePrompt/sendMessage             │
                        │  【DSH 内核】subagents 服务 ──► continuable 子代理会话（内置七工种 + roles 自定义名册）  │
                        └──────────────────────────────────────────────────────────────────────────────────────────┘

 工具可见性规则（tisitan.21 起）：编排六工具仅 preset 层（broker）注册——MyGO 会话
 独享；lib 半零编排工具面，其他会话不再有 fallback 编排工具。面板数据经快照桥单向流动：
 broker 发布 → lib RPC 消费（两半间唯一运行时通道）。
 防旁路加固批起，上游邻接消息三件套（`send_message` / `list_agents` /
 `interrupt_agent`）在 MyGO 会话的 Sisyphus 与子代理两侧都被 deny：**邻接消息
 通道**收口为 broker 六件套，`need_help` 的上报走运行时 API，与工具名无关。
 收口不含**派生**面——原生 `subagent` / `subagent_fork` / `workflow` / `ralph`
 在 Sisyphus 顶层保留为逃生舱（仅用户显式要求直派时用），只在子代理侧摘除。

 共享源 preset/shared/ 九模块（健康度批后八模块；0.3.0-tisitan.12 再拆出 end-attribution；上图模块括注沿用早期六档口径）：
 constants（共享常量）/ failure（失败归一与备选分类器）/ archive（档案取证）/
 roles（名册与路由）/ orchestration（单线状态机）/ misc（台账修剪·展示串·工种
 识别·绑定合并）/ child-registry（子代理侧八张桥接登记表 + 跨表不变量）/
 adjacent（上游邻接消息面唯一耦合点，alpha.2/3 ↔ alpha.4 特性探测）。
 铁律：零 @deepseek-ai、零 ctx；编排面五模块（orchestration / failure /
 archive / child-registry / adjacent）仅 broker 消费，lib 只引 constants /
 roles / misc 的存储面符号。
```

## 二、文件目录（fork 现状）

```
dsh-my-go/
├── package.json              # 包声明；版本 0.3.0-tisitan.11；test = 构建 bundle +
│                             #   dist 新鲜度冒烟 + node --test 通配 20 档（不再手写清单）
├── package-lock.json         # **已入库**（D-14）：CI 走 npm ci，本地/CI/发布同一棵树
├── .nvmrc                    # 22.15 = CI 的 Node 版本单一来源（engines 同源）
├── cordis.patch.yml          # bundle patch：dsh plugin add 后自动把 lib 挂进 profile（global 层）
├── CHANGELOG.md              # fork 修复台账（相对上游的全部差异）
├── README.md                 # 项目说明（含 fork 标识段）
│
├── lib/
│   └── index.js              # 【host 半】settings 命名空间 + revision 围栏 + RPC 桥 + preset 同步器
│                             #   （632 行；tisitan.21 起零编排面——fallback 编排
│                             #     已整体切除，编排唯一归属 broker 半）
│
├── preset/                   # agent preset「MyGO!!!!! 模式」（被同步到 ~/.dsh/.agent-presets/）
│   ├── preset.yml            #   preset 元信息（名称/排序）
│   ├── agent.cordis.yml      #   agent 平面组合：DSH 官方工具行 + 本地 broker 行 + tool-mask 行
│   ├── tool-mask.mjs         #   工具屏蔽：三源并集解析（config.deny ∪
│   │                         #     settings toolMask.deny ∪ 空 DEFAULT_DENY，
│   │                         #     去重保序互不覆盖），挂载时读一次、只对新
│   │                         #     会话生效；现含上游邻接消息三件套；汇总行只数
│   │                         #     实际屏蔽成功的名字，未注册名并表点名
│   ├── shared/               #   【共享源 tisitan.15】constants / failure / archive /
│   │                         #     roles / orchestration / misc / child-registry /
│   │                         #     adjacent 共八模块；0.3.0-tisitan.12 起共九模块（+
│   │                         #     end-attribution，end 归因决策纯函数）；铁律：零
│   │                         #     @deepseek-ai、零 ctx（readFailure 由调用方注入例外）
│   │                         #     tisitan.21 起编排面模块（orchestration/failure/
│   │                         #     archive/child-registry/adjacent）仅 broker 消费，
│   │                         #     lib 只引 constants/roles/misc 的存储面符号
│   └── tools/
│       └── broker.mjs        #   【agent 半 · 编排真源】6 工具 + prompt 注入 + 模型绑定
│                             #     + 拓扑闸 + 快照桥发布（状态机/失败取证/子代理登记表
│                             #     /上游邻接契约/end 归因决策均已抽 shared/）。本文件
│                             #     只剩策略调用 + 两组共用件：continue/forward 投递链
│                             #     五件（resolveContinueTarget / tryFacadeSteer /
│                             #     interruptForAbort / deliverWithQueueFallback /
│                             #     rearmAfterDelivery）与 subagent/end dispatcher
│
├── prompts/                  # 8 个工种 persona（broker.mjs 运行时读取并注入）
│   ├── sisyphus.md           #   总调度+质检官（persona 段进 deployment:persona，
│   │                         #     「## 编排规则」之后进 dsh-my-go:orchestration section）
│   ├── hermes.md             #   快速执行（指令明确的体力活）
│   ├── explore.md            #   快速检索（只读）
│   ├── librarian.md          #   文档查询
│   ├── looker.md             #   多模态识别
│   ├── hephaestus.md         #   代码编写
│   ├── prometheus.md         #   需求规划（流程开始一次）
│   └── oracle.md             #   疑难/极端复杂兜底
│
├── src/
│   ├── client.js             # 【client 半装配层】82 行：接线五模块 + 注册 DSH slots +
│   │                         #   宿主服务缺席时真降级（0.3.0-tisitan.8 E2/A-01）
│   ├── client-constants.js   # client 共享常量（色板/标签/intent 文案，零 React）
│   ├── panel-tree.js         # 树状图面板 + 快照轮询（in-flight 门 / 失败退避 /
│   │                         #   迁移留痕）+ 自动跳转（结构化花名册）
│   ├── settings-core.js      # 设置页主组件（工种卡手风琴 / persona 覆盖 / 保存行 /
│   │                         #   dirty + revision 围栏 / 可手填组合框，0.3.0-tisitan.9）
│   ├── settings-guard.js     # 未保存与并发写守卫纯函数（load/save 结果归一 +
│   │                         #   beforeunload 挂钩，Node 侧可直测，0.3.0-tisitan.9）
│   ├── roles-editor.js       # 自定义角色区（CRUD / persona 覆盖 / JSON 导入导出）
│   ├── tool-mask-editor.js   # 工具屏蔽双列表编辑器
│   ├── chain-rows.js         # 模型优先级列表编辑器纯函数（node --test 与 bundle 内联同源，tisitan.19）
│   ├── tool-mask-rows.js     # 工具屏蔽双列表编辑器纯函数（同上，tisitan.13）
│   ├── roster-rows.js        # 自定义角色纯函数（同上；卡摘要/导入导出/persona 覆盖）
│   └── panel-format.js       # 面板格式化纯函数（同上）
├── scripts/
│   ├── build-client.mjs      # esbuild 打包：src/client.js → dist/client.js（CJS + ModuleLoader 包装）
│   └── dump-session.mjs      # 会话档案取证 CLI（tisitan.16）：多帧 zstd 摘要 + childId 全项目目录搜索
├── dist/                     # 构建产物。**client.js 随 release commit 入库**（方案 A：
│                             #   朋友零构建权限，clone 即装即用），其余中间产物不入库
│                             #   （`.gitignore` 写 `dist/*` + `!dist/client.js`）；
│                             #   详见下方「工程链路 → 发布流程」
│
├── test/
│   ├── apply.mjs             # 冒烟：模块可加载 + client 可解析 + dist 存在 + dist 新鲜度
│   ├── orchestration.test.mjs# 状态机 18 单测（占位占锁/revive/requeue/幽灵求助/上限/
│   │                         #   currentMap 500 闸/台账 200 桶修剪，tisitan.15；
│   │                         #   dropQueuedFor 废弃面收口，tisitan.20）
│   ├── bridge.test.mjs       # apply 级集成 48 例（快照桥/队列回补重试与放弃/
│   │                         #   disposed 竞态/派发模型绑定/settings 重基线/
│   │                         #   台账 v2 分桶/多帧 zstd 附因/台账文件兜底查找/
│   │                         #   need_help 上报失败可观测性/forward 信封化转义/
│   │                         #   once-guard 双发盲窗 棒2-Z1，tisitan.20；
│   │                         #   abort 活体门槛与护航收紧/卸载 flush 台账窗/
│   │                         #   兜底走 retireChild/spawning 拒绝闸/need_help
│   │                         #   工种兜底六例，tisitan.7 N6/N8/N13/N14/N18）
│   ├── multi-session.test.mjs# 多会话隔离 5 例（A 忙 B 不排队/childOwner 路由/
│   │                         #   session 销毁隔离/revive 重登记属主（tisitan.10）/
│   │                         #   跨会话抢属主守卫 棒2-L2，tisitan.20）
│   ├── host-parity.test.mjs  # 反向 parity 28 例（tisitan.21 全量重写；健康度批
│   │                         #   增状态族断言：八张登记表定义唯一归属
│   │                         #   shared/child-registry.mjs，lib 与 broker 双双
│   │                         #   零残留——登记表回流 broker 立即红；tisitan.7 另
│   │                         #   锁本批十一条语义修复的「在册 pin」十二条，并把
│   │                         #   retireChild 计数 needle 放宽到调用前缀 ×3；
│   │                         #   tisitan.8 再增两例：lib 侧修复在册 pin（留痕/
│   │                         #   失败隔离/参数化安装/marker 摘要/裁剪/镜像/
│   │                         #   arity/信封合规）+ 客户端侧修复在册 pin
│   │                         #   （降级定时器/退避/legacy 过滤/求助 key/
│   │                         #   deps.React 退役））：
│   │                         #   ① lib 编排标记 grep=0 + broker 原计数锁（编排
│   │                         #     代码加回 lib 立即红）+ RPC/settings 分界契约
│   │                         #     + snapshot 降级空态锁；② lib 存储/面板面行为批
│   │                         #     原样保留；④ shared 面行为直测（直引 preset/
│   │                         #     shared/，不经 lib re-export）
│   ├── host-lib-fixes.test.mjs# lib 半存储/安装面回归 14 例（0.3.0-tisitan.8：
│   │                         #   settings 注册失败面隔离与热更存活 / 读盘失败
│   │                         #   独立留痕 / loadSettings 谎报改判 / saveSettings
│   │                         #   脏键 fail-closed / snapshot 桥抛错回 internal /
│   │                         #   出口裁剪（末 8 + 剔 prompt，broker 实况零改写）/
│   │                         #   桥缺席降级空态不变 / rpc.handle arity 双形态 /
│   │                         #   installPreset 真短路 / marker=版本+摘要三态 /
│   │                         #   shared 缺席 warn + 源缺席吞异常 / prompts 镜像
│   │                         #   清孤儿 + 未变更不重写 / getBuiltinPersona 回落
│   │                         #   包内原文 / presetInstallRoot 两口径）
│   ├── client-smoke.test.mjs # 客户端半冒烟 6 例（0.3.0-tisitan.8：timer 在席走
│   │                         #   timer.interval 双链 / timer 缺席回落自管
│   │                         #   setInterval 且 unapply 清零 / sessions 缺席留痕
│   │                         #   且跳转链不点火 / in-flight 门不重入 / 失败退避
│   │                         #   600→1500→3000 成功复位 / internal 与 absent
│   │                         #   两型留痕分流；Node 侧跑，假时钟推进）
│   ├── settings-fence.test.mjs# 设置页加固 lib 面 13 例（0.3.0-tisitan.9：
│   │                         #   revision 真源 describe / 回落进程内计数器 /
│   │                         #   过期凭据零写拒绝 / expectedRevision 透传 /
│   │                         #   宿主冲突码映射 / 无凭据兼容写 / 旧宿主不越签名
│   │                         #   传第三参 / listModels 并行与失败渠道 / 结构化
│   │                         #   roster 形状 / 三处同源锁 / bindings 漂移防御）
│   ├── settings-guard.test.mjs# 设置页守卫纯函数 11 例（0.3.0-tisitan.9：load
│   │                         #   归一剥凭据、旧 host 无凭据不发明 0、畸形响应
│   │                         #   按失败；save 三态归一 + 冲突作废凭据 +
│   │                         #   SETTINGS_CONFLICT 也认；beforeunload 注册/精确
│   │                         #   解除/幂等、非浏览器环境空 disposer）
│   ├── roster-roles.test.mjs # roles schema/迁移/合并/apply 17 例（tisitan.14/15；
│   │                         #   roles.sisyphus 死数据不消费读写两面 棒2-L1，.20）
│   ├── roster-route.test.mjs # go_work/forward 名册路由 + spawn 通道 + typeOfAgent
│   │                         #   21 例（tisitan.14-17；spawn 前回跳两例 棒2-Z2 /
│   │                         #   DSV4 promotion 行为面 棒2-L7，tisitan.20；
│   │                         #   复活清 once-guard + prompt 失败不入缓存两例，
│   │                         #   tisitan.7 N5/N7/N11）
│   ├── roster-rows.test.mjs  # 角色纯函数 16 例：编辑器/卡摘要/persona 覆盖/
│   │                         #   导入导出（tisitan.14/15）+ mergeRoleRowsIntoRoles
│   │                         #   脏行透传（tisitan.20 Z2'）
│   ├── chain-rows.test.mjs   # 模型优先级列表编辑器纯函数 11 例（tisitan.19；
│   │                         #   stripEmptyFallbackRows 保存边界，tisitan.20 D1）
│   ├── panel-format.test.mjs # 面板格式化纯函数 9 例（tisitan.12；徽章行首锚定 0.2.3-tisitan.20 D6）
│   ├── tool-mask.test.mjs    # 工具屏蔽三源并集解析 9 例（tisitan.13；并集与
│   │                         #   config.deny 邻接三件套 pin 自防旁路加固批；
│   │                         #   unknown 名降噪 + 计数口径自 0.3.0-tisitan.6 日志卫生批）
│   ├── tool-mask-rows.test.mjs# 屏蔽双列表编辑器纯函数 7 例（tisitan.13）
│   ├── dump-session.test.mjs # 取证 CLI 9 例（摘要规则/多帧行为面/childId 搜索，tisitan.16）
│   ├── failure-notice.test.mjs# 失败通知真空期三件套 11 例（名册简报段 + 同步预告
│   │                         #   e2e + 分类器否决终局，tisitan.18）
│   ├── compat-alpha4.test.mjs# alpha.2/3↔alpha.4 适配 32 例（shared/adjacent.mjs
│   │                         #   双路径特性探测，queued 真 FIFO 三路径 + broker
│   │                         #   档位退化回报 + steer 经门面收口 + 宿主契约哨兵
│   │                         #   —— 读仓库自身 node_modules；0.3.0-tisitan.11 N1
│   │                         #   起 devDeps 升 alpha 线（实装 0.1.2-alpha.5 ≥
│   │                         #   alpha.3 门槛）→ 哨兵**真跑不再 skip**，上游改
│   │                         #   门面形状/删符号在本仓当场可见；0.3.0-tisitan.12
│   │                         #   N15 加两例：plan 路由枚举全表 + 探测/投递同构不变量）
│   ├── anti-bypass.test.mjs  # 防旁路加固 7 例（邻接三件套双侧 deny 行为面 +
│   │                         #   值集合 pin + 门面收口 pin + 逐名兜底不连坐；
│   │                         #   C-10 P6 退役「两侧 deny 接线计数」一例）
│   ├── child-registry.test.mjs# 子代理登记表 8 例（健康度批直测 shared）：墓碑迁移
│   │                         #   与有界 FIFO 驱逐 / retireChild 与 retireTypeRecords
│   │                         #   分工 / 备选两段式登记的优先级回退 / 复活重建守卫
│   ├── end-attribution.test.mjs# end 归因决策 23 例（0.3.0-tisitan.12 B5 直测
│   │                         #   shared/end-attribution.mjs，**不起 ctx 替身**）：
│   │                         #   八条出口逐条 + ops 内容/顺序 + notices 文案与送达
│   │                         #   顺序 + facts.advance 口径；三例**换序回归**（E4→E5
│   │                         #   双 guard 同册只吞不重评 / E5→E6 在飞优先于新评估，
│   │                         #   否则双发 end 二次重派出两个儿童 / E3→E4 属主已毁
│   │                         #   时不得消费 abort 护航；编号与模块 DECISIONS 表一致）；一例 DECISIONS 全表完整性
│   │                         #   ——新增决策忘登记推进口径即红（宁可冻结也不放行
│   │                         #   两个并行）；readFailure 惰性由计数器钉住
│   └── helpers/mock-ctx.mjs  # broker.apply 集成测试统一 ctx 替身（六文件共用，健康
│                             #   度批收敛）+ 共享夹具 withRealSignalContract / execOf
│                             #   / snapshotNow / snapOf / drain；0.3.0-tisitan.12 加
│                             #   **waitFor(谓词)**（正向等待等条件不等毫秒，全量
│                             #   20+ 文件并行时固定 sleep 会假红）与
│                             #   **removeHomeWithRetry**（防抖台账写落临时目录的
│                             #   卸载竞态，ENOENT 外三类可重试错有界退避）
│
├── docs/
│   ├── ARCHITECTURE.md       # 原始架构设计（tisitan.11 起随实现同步更新，含
│   │                         #   tisitan.10 会话隔离/台账 v2/面板门禁）
│   ├── FORK-GUIDE.md         # 本文档
│   ├── archive/              # 历史审查报告归档（code-review-broker-lib-2026-08-27
│   │                         #   / code-review-2026-08-30，0.3.0-tisitan.10 归档）
│   └── legacy-broker-ts/     # ⚠️ 归档的 TS 参考实现（原根目录 broker/，停维护，
│                             #   见其 README；不参与构建运行）
└── AGENTS.md                 # 编排规格书（设计哲学 + 通信协议 + 禁止事项）
```

## 三、机制映射（什么功能 → 哪个文件 → 怎么实现）

### 调度与编排

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 派发子代理（go_work） | `preset/tools/broker.mjs` `dispatchWork()` → `spawnChild()` | 检查属主会话实例的 `isBusy()` → 忙则 `enqueue()` 排队（返回 `work-*` 占位 id）；闲则 `beginSpawning()` 占位占锁（同步原子）→ `spawnChild()`（persona/toolFilter 组装 + `ctx.subagents.startContinuable()`，与备选重派**共用同一实现**）创建持久子会话 → `bindChild()` 绑定真实 childId 并登记 `childOwner` 属主映射 |
| 单线阻塞（tisitan.10 起按会话隔离） | `broker.mjs` `orchestrations: Map<会话id, Orchestration>` | 每个 Sisyphus 会话惰性建独立流水线（current/queue/history 各自为政，互不排队）；`childOwner` 路由表把子代理事件精准路由回属主流水线；会话销毁时整条回收。单槽内 `isBusy()` 到 `beginSpawning()` 之间无 await，Node 单线程下天然原子 |
| 派发与复活共用体（健康度批） | `broker.mjs` `spawnChild()` + `childRegistry.rearmChild()` | 直派（`dispatchWork`）与备选重派（`attemptFallbackRedeploy`）的 spawn 组合子合一：persona/toolFilter 解析 + `SubagentStartRequest` 组装 + 门面 `startContinuable`，差异全部参数化（agentOptions 来源、label、signal）；continue 与 forward 的复活登记（工种 + 备选覆盖守卫 + 属主回填，**外加两张一次性表清零**，tisitan.7 N5）也合一（`orch.revive` 是台账动作，留在调用方）。台账动作（`beginSpawning`/`bindChild`/`revive`）与通知仍留在各调用方——两路占槽语义不同，强行合并会改行为 |
| 队列推进 | `broker.mjs` `advanceQueue(orch)` | 属主实例的 `subagent/end` 或 spawn 失败时触发：dequeue 队首 → 按 `work.parentId` 重解析父会话 → dispatch；**失败自动 `requeueHead()` 回补**（fork 修复：任务不再蒸发） |
| 求助挂起（need_help） | `broker.mjs` need_help 工具 | `suspend()` 标记 waiting + `reportToParent` 适配层（`shared/adjacent.mjs`）把求助单注入 Sisyphus（alpha.4 sendMessage，被拒兜底 `parent.inject`；alpha.2-3 reportFrom）。求助单的 `agentType` 经 `typeOfAgent` 取证（活登记优先、label 兜底，tisitan.7 N13）——竞态归随/墓碑期/冷恢复这些「活登记已失而记录仍在槽」的形态下裸查 `sessionTypes` 会落成 undefined，面板按工种上色直接落空。注：台账层挂起，无强制 interrupt（评估结论见第五节） |
| 驳回/追问（continue） | `broker.mjs` continue 工具 | **先经 `deliverToAdjacent`（`shared/adjacent.mjs`）投递成功，后落账**（fork 修复时序病）；三档一律走 subagents 门面：queued 真 FIFO（alpha.4 internal 队列符号 / alpha.2-3 followup），steer 走 alpha.4 的 `sendMessage`（next-step 边界，不再直调 `Agent.steer`；被拒则 warn + 回落 queued），无排队通路时 queued 退化 steer 并如实回报 mode；目标 waiting 则 resolveHelp+resume；目标已结束则 `revive()` 重新入册 + 恢复 sessionTypes 登记（fork 修复：结论不再丢失、单线不再被打破）。两处门槛（tisitan.7）：**abort 档掐断前认活体**——alpha.4 的 `interrupt` 对缺席目标是 accepted no-op（不抛错），旧写法把 `abortExpected` 护航登记在一次什么都没掐断的回合上、随后吞掉真那一轮的 end；拿不到活体就跳过 interrupt、降级 queued 并留痕。护航端侧同步收紧为**只吞非 completed 终局**（interrupt 只是同步受理，被掐轮完全可能跑到 completed——那是真结论）。**spawning 占位记录直接结构化拒绝**：真身未 resolve 时投给谁都不存在，旧路径照样走完落账并回 `accepted:true` |
| 转发（forward） | `broker.mjs` forward 工具 | 同上「先投递后销账」：`deliverToAdjacent` queued 档 + `canQueueAdjacent` 探测，塌档时 warn 且返回体 `mode` 如实回报（终审 U2）；target 为工种名时等效 go_work，为 childId 时等效 continue |
| 结论回流 | DSH 内核通知 + `broker.mjs` `subagent/end` + `shared/end-attribution.mjs` | 子会话结束时内核通知父会话（broker 不重复注入）；broker 的 handler 自 0.3.0-tisitan.12 起是**纯 dispatcher**：取表状态快照 → `attributeEnd()` 出 `{decision, ops, notices, facts}` → 照单落 ops（bindChild / childOwner.set / 两张一次性表 / retireTypeRecords）→ 发 notices → `fallback-evaluation` 时 `void attemptFallbackRedeploy(...)`、`finalize` 时 `finalizeEnd(...)` → 末尾按 `facts.advance` 单点决定是否 `advanceQueue(orch)`。`finalizeEnd` 自身永不推进队列（R3/R4 把这条从注释协议变成返回值字段）。快速死亡的子会话（resolve 前就 end）归因到唯一 spawning 占位记录（fork 修复竞态冻结），归因后即视为在册（否则会把刚入册的记录误判成迟到 end） |
| 附因档案兜底搜索（tisitan.16） | `preset/shared/archive.mjs` `findArchivedLogByChildId()` | `readArchivedTurnFailure` 默认按 `projectKey(process.cwd())` 定位项目目录——宿主进程 cwd≠用户工作区时永远找不到档案；默认路径不可读时枚举 sessions 根下全部项目目录按 childId 检测 `session.jsonl.zstd` 存在性，多命中取 mtime 最新，命中/零命中均 warn 留痕。修复生产上「未读到附因」从未成功 |
| 失败通知真空期消灭（tisitan.18） | broker `subagent/end` 同步段 + `attemptFallbackRedeploy` 终局分支；`shared/roles.mjs` `renderRosterBriefing()`；`prompts/sisyphus.md`「失败与备选通知协议」（tisitan.21 前为双半镜像，现 broker 单边） | harness 原生 failed 通知（硬编码模板不可抑制）settle 瞬间同步唤醒主流程，broker 失败处置异步晚到——真空期主流程不知备选存在。修=三件套：①名册简报系统提示段（`dsh-my-go:roster`，order=10，函数态 text 现渲、儿童门控空串、键排序字节稳定）；②提示词协议（failed 先到是常态，有链静默等 broker、禁止自行报死/手动重派，重派通知新 childId 接管一切）；③end 处理器同步 inject 零延迟预告（有链「备选评估中（n 条）」/ 无链「无备选链，取证中」/ 有链非 error 终局「不进入备选评估，取证中」），终局分支显式通知（分类器否决 / 链尽 / 无法重派均「按失败终局落账」）；成功 end 零预告，同步段零 await |
| 状态回收 | `broker.mjs` `agent/disposed` / `session/disposed` 钩子 | 子代理被销毁但错过 end 事件：`childRegistry.tombstoneType()` 立墓碑（工种移入、备选覆盖同点摘、超容 FIFO 驱逐）+ 宽限期兜底清槽防队列冻结；**兜底掐断走 `retireChild`**（tisitan.7 N14）而非手删 `childOwner`——类型侧三表同点翻篇，真迟到的那条 end 不再经残留墓碑报「conclusion dropped」这种无中生有的误报；Sisyphus 会话被删：丢弃其排队任务 |
| 子代理侧状态登记（健康度批） | `preset/shared/child-registry.mjs`（`createChildRegistry()`） | 八张桥接表（工种活登记/墓碑/属主路由/备选覆盖/spawn 前临时备选/abort 护航/备选 once-guard/模型清单缓存）与它们的**跨表不变量**同处一模块：`tombstoneType`/`retireChild`/`retireTypeRecords`/`promoteFallback`/`rearmChild`/`fallbackOverrideFor`。broker 解构出表名做单表读写，多表动作一律经显式方法——历史上漏清一张表不报错，只在下次 end 归因时静默串号。`rearmChild`（复活）除回填三张表外**同点清两张一次性表**（tisitan.7 N5）：`fallbackDecided` 的条目在 end 入口登记（早于重派的三个早退分支）且全仓无 `.delete`，带着它复活，复活轮正常完工的 end 会被「评估在飞」分支吞掉 → 记录永挂 running → `advanceQueue` 被 `isBusy` 堵死 → 该流水线永久冻结（唯一救援 disposed 宽限期兜底又已被 end 入口的 `cancelDisposeFallback` 自撤） |
| continue/forward 投递链共用件（0.3.0-tisitan.12 B4） | `broker.mjs` 五件 helper | 两工具原本各抄一遍「定位 → steer → abort → queued 投递 → 投递后复籍」，差异全靠行号相邻的注释维持。合一后：**同步段 await 次数与原分支逐一对应**（1/1/0/1/0），abort 护航登记（`abortExpected.add` + `notifyParent`）留在 interrupt 成功与 queued 投递之间的同步段；两工具 `followupPrompt` 的时序差异（continue 在复籍后、forward 在复籍前）用 `ledgerFirst` 参数显式保留，不静默改台账顺序。continue 注册块 151 → 89 行（execute 体 123 → 62）、forward 注册块 90 → 72，最大嵌套 6 → 3 |
| end 归因决策（0.3.0-tisitan.12 B5） | `preset/shared/end-attribution.mjs` `attributeEnd()` | 八条出口的纯决策（表状态进、`{decision, ops, notices, facts}` 出）；broker 的 dispatcher 只落 ops、发 notices、起执行链。队列推进时机从「finalizeEnd 的注释协议」升为 `facts.advance`（now/no/if-owned，漏登记即不推进）；abort 护航的无条件消费以 op 显式返回；`readFailure` 惰性注入（早退分支一次都不读盘） |
| 上游邻接消息契约（tisitan.22；健康度批独立；0.3.0-tisitan.12 N15 路由合一） | `preset/shared/adjacent.mjs` | fork 与上游「邻接消息面」的唯一耦合点：`sessionEvents`（events getter → snapshotEvents）、**`planAdjacentDelivery`（路由单一出处：route ∈ queue / steer / legacy / unavailable + invoke）**、`canQueueAdjacent`（plan 薄壳，queue/legacy 即真排队可达）、`deliverToAdjacent`（取 plan → 无通路抛错 → 委托 invoke；queued/steer 两档，alpha.4 真 FIFO 靠 `Symbol.for('dsh.subagent.queuePrompt')` 直取）、`reportToParent`（reportFrom 已删，sendMessage + inject 兜底）。按方法存在性特性探测分界，升级顺序无关；宿主版本不符时 compat 套件的契约哨兵自动 skip |
| 共享源（tisitan.15；tisitan.21 起编排面 broker 独有） | `preset/shared/*`（constants / failure / archive / roles / orchestration / misc / child-registry / adjacent / **end-attribution**） | 两半 import 同一 ESM 实例（净消 1,251 行镜像双写）；铁律零 `@deepseek-ai/*`、零 ctx，依赖显式注入。tisitan.21 起 orchestration/failure/archive 仅 broker 消费（健康度批加 child-registry/adjacent，0.3.0-tisitan.12 加 end-attribution），lib 只引 constants/roles/misc 的存储/面板面符号且不再 re-export 编排面符号（消费方直引 preset/shared/）；promptCache 双根成为历史（仅 broker 消费 loadPrompt） |

### 模型与提示词

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 按工种绑模型 | `broker.mjs` `dispatchWork()`（创建时 `agentOptions`）+ `agent/request` waterfall（请求时兜底） | 创建前 `modelExists()` 用 `llm.listModels` 验证模型真实存在才应用。缓存三态（tisitan.7 N9）：**列举成功即结论**（含空清单/模型不在，缓存之，坏 provider 不再每请求被重拉）；抛错或服务缺席是「不知道」（不缓存，留待重试）；回写前比对 `modelCacheEpoch`——热更（`settings/updated` 清缓存并自增）之后**在飞的陈旧响应不许回写**，否则刚失效的缓存被一次迟到拉取无声复活 |
| 备选重派防回跳（tisitan.16/17） | `shared/child-registry.mjs` `activeFallback`/`pendingFallbackByLabel` + `shared/misc.mjs` `resolveEffectiveBinding()`（tisitan.21 前为双半镜像，现 broker 单边） | spawn 注入的备选 agentOptions 只管首帧；重派成功经 `promoteFallback()` 把 label 临时登记**同点转正**为 childId 永久覆盖 + 工种登记（拆开写会留下回跳空档），waterfall 每请求经 `fallbackOverrideFor()` 合并出有效绑定——只换 provider/model，工种 reasoningEffort/fallbacks 等其余字段保留，返回新对象不污染共享绑定表；tombstone/finalizeEnd/重派换键/end 无属主兜底等五类清理点镜像清除。tisitan.17 起备选条目本体 `record.fallbackEntry` 与 fallbackAttempt 同点入账、随台账 v2 落盘，continue/forward 复活（含 cold-resume 后的台账 revive）在重建 sessionTypes 的同点回填覆盖表，复活后不再回跳主模型；链上下一跳重派时新占位记录携带新条目，天然覆盖上一跳 |
| reasoningEffort | `broker.mjs` `supportedEfforts()` | 查 DSH 模型目录 `llm.resolveModelInfo`，**仅当模型实际支持该档位才设置**，否则留空走适配器默认（拒绝硬映射）。能力表缓存同 N9 纪律（tisitan.7 N10）：非空档位才算结论，`null`（未知）不入表；并随 `settings/updated` 整体作废——此前它无任何清理点，一次拉取的结果在本进程内永挂，改好能力表后 effort 绑定仍静默不生效 |
| 工种识别 typeOfAgent（tisitan.15） | `shared/misc.mjs` 单一源（tisitan.21 起仅 broker 消费） | sessionTypes 活登记优先 + 会话 label（`dsh-my-go:<type>` 前缀）正则兜底；`agent/request` 绑定覆盖与 DSV4P0813 assemble 识别同走此函数——修复 cold-resumed 子代理（活登记已失）模型绑定静默失效；双侧契约：角色键名 `^[a-z][a-z-]*$` 与 label 正则同构，任意名册角色都可从 label 还原 |
| Sisyphus persona/规则 | `broker.mjs` 三个 `systemPrompt.section` | 读 `prompts/sisyphus.md`，按 `## 编排规则` 切两半：前段进 `deployment:persona`、后段进 `dsh-my-go:orchestration`；子代理会话返回空串（靠 parentSession 判定）。tisitan.18 起第三个段 `dsh-my-go:roster`（order=10）向根会话现渲名册简报 |
| 子代理 persona / toolFilter | `broker.mjs` `dispatchWork()` | 经 `SubagentStartRequest.persona/toolFilter` 官方 spawn 通道注入（descriptor v2 持久化、冷恢复原样重放；tisitan.14 起 `<system-reminder>` 包装退役，prompt 保持纯任务）；toolFilter 缺名派发前按活目录过滤降级（warn），allow 全缺名时回落全量目录。**人设档案缓存随挂载建立、失败不记账**（tisitan.7 N11）：此前缓存壳住模块作用域且失败写 null，首读撞上 `ensurePresetInstalled` 的后台拷贝竞态就把本进程所有挂载的人设一起钉死（儿童永久带「无 persona」上岗、无从自愈） |
| DSV4P0813 两阶段 | `broker.mjs` `system-prompt/assemble` 监听 + `session/event` 监听 | 开启该开关的工种：phase-1 只放行 persona section + 白名单工具（`bash/pwsh/read/write/edit/glob/grep`，fork 已修正为 DSH 真实工具名）；**按事件自身类型**判晋升——收到 `tool/call` 或 `turn/end` 即放开全部（tisitan.7 N7：宿主 `append` 先 push 再 notify，旧「从数组末位倒扫到上一个 step/end」在真机上恒 break，toolCalled 永假，phase-1 的重压形态会压满整个第一轮；直判同时省掉每 step 一次全量事件快照重建） |
| skill 隐藏 | `broker.mjs` `agent/created` | 主会话 `tools.restrict({ deny: ['skill'] })`，使 skill catalog 注入守门失效，节省主会话上下文；子代理保留 |

### 安全与边界

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 编排权限 | `broker.mjs` `canOrchestrate()` | go_work/continue/forward 仅「无 parentSession 的会话」可调（工具层强制，不靠 prompt 自觉）；need_help 仅被跟踪的子代理可调 |
| 星型拓扑闸（fork 新增） | `broker.mjs` `agent/created`（tisitan.3 起 lib 不再挂钩——global 层会误伤非 MyGO 会话） | 子代理在工具目录层被摘除 `subagent/subagent_fork/workflow/ralph/go_work/continue/forward`——无法私自派生孙代，也无法直接调度（与运行时守卫双保险） |
| 沙箱外执行通道 | need_help `intent=execute` | 子代理把被拒命令发给 Sisyphus 代执行。注意：这是设计的权限提升通道，缓解靠 Sisyphus 的质检 prompt |

### UI 与配置

| 功能 | 实现位置 | 原理 |
|---|---|---|
| 树状图面板 | `src/panel-tree.js` `TreePanel` | `shell.overlay` 浮层 + 侧栏 🧭 开关；轮询 RPC `snapshot` 端点，seq 变化才重渲染（fork 修复：开关脱钩 + force bailout）。0.3.0-tisitan.8 起：in-flight 门（一发未回不重入）+ 失败退避 600→1500→3000ms（成功复位）+ 桥状态翻转点各一行 console.warn；'legacy' 幽灵父区被过滤；求助行 React key 用求助单 id；30s 相对时间 tick 只在面板可见时做功 |
| 客户端服务降级 | `src/client.js` `apply()` | `sessions` / `timer` 有意不进 `inject`（拿不到就降级，不炸挂载）。0.3.0-tisitan.8 起降级不再静默：timer 缺席回落 `globalThis.setInterval` 自管 disposer（一次性 warn，unapply 清零，不留孤儿轮询）；sessions 缺席一次性 warn，快照照常刷新、只关跳转与自动跟随。旧写法 `timer && timer.interval` 短路 = 面板永不刷新且从不说明原因 |
| 快照桥（fork 新增；两半间唯一运行时通道） | `broker.mjs` 发布 → `lib/index.js` RPC 消费（单向） | broker 把 `() => latestSnapshot` 挂到 `globalThis[Symbol.for('dsh-my-go.snapshot')]`；lib 的 RPC handler 实时读取（零副本）。tisitan.21 起 lib 已无自身状态机：桥不在 = preset 未装配（lib-only 降级形态）→ 空态 `{ seq: 0, parents: {} }` + roster / rosterLines 常驻（0.3.0-tisitan.9 A-05 起 roster 是结构化主字段）。tisitan.10 起形状为 `{ seq, parents: { [会话id]: { current, queue, helpRequests, history } } }`（多会话聚合）。0.3.0-tisitan.8 起端点自带 try（桥抛错回 `ok:false + internal`，不再抛穿 RPC），并在出口裁剪：每桶 history 末 8 条 + current/queue/history 剔 `prompt`（面板零消费的最贵字段），helpRequests.content 保留；broker 侧实况对象零改写 |
| 自动跳转 | `src/panel-tree.js` 定时器 | 子代理 running → `sessions.openSubagent()` 跟跳子会话；结束后 `sessions.open(parentSessionId)` 跳回。tisitan.10 起加**会话门禁**：只跟随当前打开的会话（`sessions.list.getSnapshot().current`），多会话并行时绝不把用户拽去别的会话（定时器本体经 `createOrchestrationPanel` 由 `client.js` 装配注入，见 `src/client.js:65`）|
| 设置页 | `src/settings-core.js` + `roles-editor.js` / `tool-mask-editor.js` ↔ `lib/index.js` RPC | 内置 8 工种 × 5 字段（provider/model/reasoningEffort/dsv4p0813/fallbacks）+ 工具屏蔽双列表编辑器（tisitan.13，`listTools` RPC 拉花名册、`toolMask.deny` 读写）+ 自定义角色 CRUD 卡片区（tisitan.14，roles dict 读写，纯函数在 `src/roster-rows.js`）+ 内置角色 persona 覆盖与角色卡 JSON 导入导出（tisitan.15，`withPersonaOverride`/`buildRoleCardJson`/`parseRoleCardJson`，导入 8 类拒绝分支白名单剥离）+ 全卡片手风琴折叠（tisitan.15，纯视图态）+ 主选/备选合并为单一模型优先级列表（tisitan.19，纯 UI 投影：`src/chain-rows.js` compose 投影/decompose 写回，#1 主选带徽章、跨边界 ↑↓ 一键扶正、删除守卫链长 ≥1，存储 schema 零变更）；loadSettings 失败时 `draft=null` 禁止保存（fork 修复：不再一键清空配置），0.3.0-tisitan.8 起 host 侧读盘异常改回 `ok:false + unavailable`（旧写法回 ok:true+{} = 把「没读到」渲染成干净空表单，用户点保存就洗掉未读到的真配置；现在前端既有 loadError 横幅零改动即亮）；saveSettings 全字段显式携带才写（tisitan.15 修复部分行误清）、空值 unset、显式 false 可表达，0.3.0-tisitan.8 起 `draft.roles` 键先过 `ROLE_KEY_PATTERN` 再生成 ops（脏键 fail-closed 丢弃——mutate 整批原子，一枚脏键曾毒杀整次保存）；lib 半所有 `ok:false` 分支带 `details:{}`（宿主 ConnectionRpcFailure 三字段契约）；`settings.register` 与「读盘 + 热更监听」分两个 try 且各自 `console.error`（注册抛错曾连带吞掉 settings/updated，此后 WebUI 改绑定全部无声失效）；`rpc.handle` 按 `Function.length >= 3` 探测是否附 `{authority:'loopback'}`（宿主版本漂移） |
| 设置页并发写围栏（0.3.0-tisitan.9 E6/A-03） | `src/settings-core.js` + `src/settings-guard.js` ↔ `lib/index.js` loadSettings/saveSettings | loadSettings 额外回带 `revision`（真源 = 宿主 `settings.describe()` 的 descriptor.revision，宿主不暴露时回落本半进程内计数、由 `settings/updated` 驱动）；设置页把它当**不透明凭据**存着并在保存时带回。版本号不符 → `ok:false + conflict`（details 带 `{expected, actual}`）**且一次写都不发**；宿主 `mutate` 支持第三参时把围栏交给它在命名空间写队列内执行（检查与写入之间无 TOCTOU 窗），`SETTINGS_CONFLICT` 稳定错误码映射回同一形态。保存成功回带**新版本号**（不 adopt 会让用户下一次保存自撞假冲突）；缺凭据（旧前端/脚本直调）= 无条件写，绝不发明 0 当版本。前端冲突后锁死两枚保存按钮 + 亮「他处已修改，请重新加载」，唯一出路是显式重载（本地凭据作废） |
| 设置页未保存防线（0.3.0-tisitan.9 E6/A-03） | `src/settings-core.js` `mutateDraft` / `attachBeforeUnloadGuard` | 所有草稿变更（含 roles-editor 经 `deps.setDraft` 的写，dep 名不变换实现）汇聚到 `mutateDraft` 一处置 dirty；dirty 期间挂 beforeunload（宿主 `settings.section` 只给 `close`，无 onClose/卸载时机——已核实 `SettingsSectionOwnerProps`），保存行挂「● 未保存」角标与「保存并关闭」（保存失败/冲突绝不关页，close 从此不再是收下就扔的死参数）。守卫结果归一在 `settings-guard.js`（无 React 无 DOM，Node 侧直测） |
| 模型选择可手填（0.3.0-tisitan.9 A-06） | `src/settings-core.js` `makeCombobox` + `lib/index.js` listModels | 渠道/模型两栏从裸 `<select>` 改 input + datalist（与 roles-editor 工具名输入同模式）：清单在场点选照旧，拉不到或没上报时直接键入——此前页面文案一直许诺「也可以直接输入自定义值」而控件根本不给输。`listModels` 逐渠道 `Promise.allSettled` **并行**（旧串行 await = N 渠道 N 倍首屏），失败渠道不再删键而是 `models[pid] = []` + `errors[pid] = 原因`，设置页据此在链行下挂行内提示，「清单读取失败」与「该渠道真的没模型」从此可分 |
| settings 合并 | `broker.mjs` / `lib/index.js` | 永远从 `baseBindings`（默认值+插件 config）起算合并 stored（fork 修复：WebUI 取消配置可回落）；`||` 语义统一（空串=未设置） |
| preset 同步 | `lib/index.js` `ensurePresetInstalled({packageRoot, dshHome})` | marker 文件 `.dsh-my-go-version` 记 **`<版本>+<preset/prompts 内容摘要>`**（0.3.0-tisitan.8）：版本与内容同时一致才跳过——装机侧手改在同版本同内容下继续存活（旧语义保留），而包内任何一次内容改动（含同版本热修）都换摘要并重拷，不再需要 bump 版本解锁。同步语义：`preset/` 逐文件字节比对只重写变化者（写窗口从整树缩到实际改动文件），`prompts/` 先删净再拷（资源镜像，上游退役人设不留孤儿）；拷贝失败只 `console.error` 吞掉不阻断挂载，且**不写 marker**（下次必重试）。参数化 + `config.installPreset === false` 让测试真短路，不再与后台拷贝抢文件；tisitan.15 起校验 `preset/shared/` 存在性——broker 相对 import shared 八模块（健康度批 +child-registry/+adjacent），同步必须整树覆盖 |
| 面板花名册常驻区（tisitan.15；0.3.0-tisitan.9 结构化） | `src/panel-tree.js` + snapshot `roster` | snapshot RPC 恒附 `roster`：`{seq, parents, roster:[{role, builtin, provider, model, modelText, chain[], toolFilterText, personaSource}], rosterLines}`，行语义由 `shared/roles.mjs` 的 `rosterEntries` 单一源产出（与 `orchestration_status` 尾部、Sisyphus 系统提示简报三处共用同一份条目），表头文案/计数/徽章由面板自持。`rosterLines` 是同数据的 **deprecated 文本镜像**（兼容期保留，供旧 dist 与取证脚本），面板不再按「首行必为表头」的位置约定取数；桥未就绪（无编排会话）也产出 |

### 测试

**源码 pin 的裁决口径（0.3.0-tisitan.11 C-10；全文在 `test/host-parity.test.mjs` 头注释）**——
源码断言有两种命：锁不变量，或者锁实现。只留前者，判据四条：① **唯一归属 /
某写法不得出现** → 保留（重构不会让它变红，除非语义真变了）；② **出现次数**
（X=2/3/N 的调用点枚举）→ 删除或降为 `>=1`（加一处合法调用、把两行合一都会让
语义正确的改动红掉）；③ **整行字面量复刻**（含变量名/参数序/缩进）→ 删除（那
是在编译期重抄一遍源码）；④ **用户可见措辞与日志文案** → 删除（负向 grep=0 除
外），文案契约归行为档。本批据此把 host-parity 中「期望值 ≥2 的精确出现次数断言」**22 条清零**：现存 52 条
精确计数断言全部落在 `0`（负向不变量 26 条）或 `1`（唯一归属 26 条）这两种合法形态，
另 22 条降为存在性 `>= N`；文件 870 → 814 行、pin 类命中 133 → 107。此外 anti-bypass
整例删 1、tool-mask 措辞 pin 删 1、roster `order: 10` 计数删 1、child-registry 内部
6 条计数删（改由 `broker 零直引 activeFallback.` 一条负向兜）。删/降逐条去向见
CHANGELOG。

**替身保真（同批 C-09）**：`test/helpers/mock-ctx.mjs` 此前比真宿主宽容四处，等于
给真 bug 打掩护——listeners 单槽（重复注册静默后写覆盖前写）、`effect` 吞异常、
`systemPrompt.section` 与 `tools.register` 重名不报错、`settings.get` 返回宿主对象
本体（写变异不可见）。现在：listeners 是 `Map<event, fn[]>` + `dispatch(event, payload,
next)` 按注册序串 waterfall（最外层返回值即结果，单 handler 行为与旧替身逐字一致，
故 114 处点火点零语义变化）+ `registeredHandlers()` 断言每事件注册数；三项重名/
异常一律抛；`settings.get` 返回 structuredClone + 深度冻结副本。全仓 298 例零改动
通过 = 本仓代码本来就是干净的（探针另证五项严格化各自生效）。

| 层 | 文件 | 覆盖 |
|---|---|---|
| 冒烟 | `test/apply.mjs` | 模块加载/导出面/client 语法/dist 存在 + **dist 新鲜度**（src 任一模块比 dist 新即红：本批起 src 三面同改，「忘重建 bundle」从流程约束变成断言，0.3.0-tisitan.8） |
| 单测 | `test/orchestration.test.mjs` | 状态机 18 例：占锁原子性、bindChild（含缺位告警）、finish 清求助、suspend/resume、revive、requeueHead、dropQueuedFailed、history 200 上限、record/followupPrompt、enforceCurrentCap（currentMap 500 闸）、beginSpawning 路径闸、pruneLedgerParents（台账 200 桶修剪，tisitan.15；dropQueuedFor 废弃面收口，tisitan.20） |
| 单测 | `test/chain-rows.test.mjs` | 模型优先级列表编辑器纯函数 11 例：normalize、compose/decompose 投影拆解与 round-trip 恒等、addEntry、删除扶正 + 最小长度守卫、跨边界双向移动、updateEntry（provider 重置 model）、stripEmptyFallbackRows 保存边界过滤（tisitan.20 D1）、不突变输入、draft 往返写回形状（tisitan.19；前身 fallback-rows 7 例行为面并入，tisitan.12） |
| 单测 | `test/panel-format.test.mjs` | 面板格式化纯函数 9 例：shortId/oneLine、formatRelativeTime 阶梯与边界、extractFallbackNote 标注提取（tisitan.20 D6 起匹配收窄为行首/前缀位置，假徽章治理）、组合形状（tisitan.12） |
| 单测 | `test/tool-mask.test.mjs` | 工具屏蔽解析 9 例：resolveDeny 三源并集（config ∪ settings ∪ 空默认，去重保序 + 非数组视为缺省）、DEFAULT_DENY 泛化清空源码断言、agent.cordis.yml `config.deny` 含邻接三件套的 pin（**0.3.0-tisitan.11 C-10 P9：改 js-yaml 真解析 + `!!js` 标签 passthrough 类型**，旧写法是「从 '- id: tool-mask' 起截文本再正则扫行」= 用眼睛读 yml，缩进一变就静默假绿；同条里的注释措辞 pin 已退役）、apply 容错（缺席跳过/服务缺席回落）、双源合并汇总日志（tisitan.13，并集与 pin 自防旁路加固批）、汇总口径=实际 restrict 成功数 + unknown 名只进汇总不逐名 warn + 真异常仍逐名 warn（0.3.0-tisitan.6 日志卫生批） |
| 单测 | `test/tool-mask-rows.test.mjs` | 屏蔽双列表编辑器纯函数 7 例：normalize 去重保序、block/unblock、availableTools 过滤、denyEntries 未连接徽章、不突变输入（tisitan.13） |
| 单测 | `test/roster-roles.test.mjs` | roles 名册 17 例：dict schema 形状、键名 `^[a-z][a-z-]*$` schema 层拒绝、旧顶级键无损迁移/幂等/并存覆盖、merge 携带 persona·toolFilter、apply 迁移容错（失败保留原配置仅 warn）、load/saveSettings 形状、部分行只带 persona 不产生 5 字段 ops（tisitan.14/15）、snapshot 恒附 rosterLines（tisitan.15）、roles.sisyphus 死数据不消费（merge 读面 + saveSettings 写面两例，棒2-L1，tisitan.20） |
| 集成 | `test/roster-route.test.mjs` | 名册路由 21 例：go_work 自定义角色 persona/toolFilter 经 spawn 通道注入、未注册名结构化报错附可用清单、toolFilter 缺名过滤降级与全缺名回落、内置工种 spawn 通道兜底、fallback 重派与首派同源、orchestration_status 尾部花名册区、describeAgent default 分支、forward 自定义 target（tisitan.14）、typeOfAgent 三例（cold-resumed 恢复绑定/登记优先于畸形 label/DSV4P0813 assemble 识别，tisitan.15）、waterfall 运行期防回跳两例（备选不回跳 + effort 保留 + 常规派发不受影响 / 清理后覆盖消失，tisitan.16）、备选覆盖复活重建两例（continue 复活后 waterfall 保持备选不回跳 / 链上第二跳覆盖第一跳且历史保留各自条目，tisitan.17）、spawn 前回跳两例（请求先于 resolve 到达 waterfall 保持备选 / spawn 失败 pending 登记同步清理，棒2-Z2，tisitan.20）、DSV4P0813 promotion 行为面一例（**按真实派发时序造夹具**：tool/call 事件直判 + turn-end 翻转 + 单向切换 + 坏档快照仍晋升，棒2-L7，tisitan.20 / N7 时序修正，tisitan.7）、复活清 once-guard 一例（复活曾进备选评估的链首儿童 → 完工 end 不被吞、台账照常落账、队列解冻，N5，tisitan.7）、prompt 档案首读失败不入缓存一例（档案补齐后下一派即现读生效，N11，tisitan.7） |
| 单测 | `test/roster-rows.test.mjs` | 角色纯函数 16 例：isValidRoleKey 与服务端同则、normalizeRoleRows 脏数据归一、增删改行、tool 条目增删、roleSummaryText/builtinSummaryText 卡摘要、不突变输入（tisitan.14）、withPersonaOverride/personaOverrideSource/buildRoleCardJson/parseRoleCardJson（tisitan.15）、resolveBuiltinPersonaResult RPC 结果归一（tisitan.16）、mergeRoleRowsIntoRoles 内置透传 + 脏行原样保留 + 投影行重建 + 删除语义（tisitan.20 Z2'） |
| 集成 | `test/bridge.test.mjs` + `test/multi-session.test.mjs` | 共用 `test/helpers/mock-ctx.mjs`（统一 ctx 替身 + 契约夹具）跑 `broker.apply()`：bridge 49 例（含 **C-09 替身保真例：broker 七个事件恰好各注册一个 handler**，旧单槽替身把重复注册藏成静默覆盖；Symbol.for 快照桥两例、队列回补重试/超上限放弃、disposed 竞态两例、dispatchWork 模型绑定解析两例、settings 重基线、队列上岗映射通知、失败附因 live 推送、截断 config、台账 v2 分桶 round-trip、tisitan.9 持久化档案附因两例、tisitan.11 need_help 上报失败 warn+通知与 forward 信封化转义、tisitan.12 备选链重派等十二例（含 step-3 a–h）、tisitan.17 fallbackEntry 入账 + 台账 round-trip、现场-Z3 台账文件兜底查找、tisitan.20 棒2-Z1 once-guard 双发盲窗；**tisitan.7 六例**：abort 活体门槛（缺席儿童不登记护航）+ 护航只吞非 completed 终局、卸载 flush 台账防抖窗、兜底走 retireChild（迟到 end 不再「conclusion dropped」误报）、continue 打 spawning 占位结构化拒绝、need_help 工种 label 兜底不落 undefined）；multi-session 5 例（A 忙 B 不排队、childOwner 路由、session 销毁隔离、revive 重登记属主）（tisitan.10）+ 跨会话抢属主守卫（棒2-L2，tisitan.20）。**0.3.0-tisitan.12 等待口径**：本档、roster-route、failure-notice、multi-session 共 **34 处正向等待**改为 `waitFor(终态谓词)`（25 处 `await drain(N)` + 9 处 codemod 扫不到的裸 `await new Promise(r => setTimeout(r, N))`）——谓词一律取**紧随其后那批断言真正读到的可观测量**（尤其「占位换键完成」这种末步，只等 `specs.length` 会在并行压力下拿到 `child-*` 占位 id 而假红）；谓词写窄了还会**自己制造竞态**（`agentType==='hermes'` 占位入槽即成立、`status==='spawning'` 早于门面调用，两处反例已就地留注释）。6 处**负向窗口**（等的是「什么都没发生」：宽限期不误伤 / aborted 不重派 / 评估窗内忽略 / 迟到 disposed 不拖垮他会话 / 迁移幂等 / `installPreset:false` 真短路）保留固定 sleep，且先 `waitFor` 到正向终态再开窗 |
| 半对齐 | `test/host-parity.test.mjs` | 反向 parity 28 例（tisitan.21 全量重写；**0.3.0-tisitan.11 C-10 按裁决口径瘦身：精确计数 pin ~80 → 2，改写为「十枚编排身份标记 + 十一条共享通路 >=1 在册 + 五类负向 grep=0」，并新增「安装目录模拟」——按 package.json files 白名单算出发布物集合，逐条核对两半 import 目标都在其中，白名单漏目录 = 用户侧 MODULE_NOT_FOUND 当场红**，原 33 例双半镜像对称断言整体退役——编排行为等价覆盖在 bridge.test.mjs / roster-route.test.mjs）：① lib 零编排面哨兵（六工具注册/派发队列闭包/编排状态（orchestrations + child-registry 状态族八表定义）/台账/备选链/生命周期钩子/快照桥外全部编排标记 grep=0，broker 半原计数保留——编排代码加回 lib 立即红；状态族另锁「定义唯一归属 shared/child-registry.mjs、登记表本体不得回流 broker、跨表守卫不得手抄」；**tisitan.7 另加语义在册 pin 十二条**（N5 两张一次性表清理点、N6 护航收紧式与登记点、N9 三处缓存纪律式与 epoch 自增、N10 清理点与非 null 入表式、N7 事件直判且倒扫死支必须 grep=0、N14 兜底 retireChild），并把「end 收尾」计数 needle 从 `retireChild(childId)` 放宽为 `retireChild(` ×3——参数名不该决定防线是否被数到））+ RPC/settings 分界契约（RPC 端点全家与 settings.register 为 lib 独有，broker 只读零 RPC）+ 接线分界（typeOfAgent/养护闸/备选链/台账/persona 链 broker 独有）+ 名册简报段 broker 独有注册 + shared 单一源 import 存在性（**0.3.0-tisitan.12 编排身份标记 +2 枚：`shared/end-attribution.mjs` 与 `attributeEnd(`——end 归因决策同属编排身份，lib 半出现即为回归；「安装目录模拟」那条按 files 白名单自动把新 shared 模块纳入发布物核对，无需追加 pin**）；①b snapshot 降级形态锁（无桥 → `{seq:0,parents:{}}` + rosterLines 常驻；桥在席直读 broker 实况）；② lib 存储/面板面行为批原样保留（settings schema/saveSettings fallbacks 与 toolMask/mergeRoleBindings 单一源/listTools 两例/getBuiltinPersona/persona·toolFilter 显式字段/roles 删除语义/loadSettings 形状）；④ shared 行为面直测（失败分类器/归档取证含 cwd 兜底三例/角色合并/迁移 ops/工种识别/台账修剪/resolveEffectiveBinding，直引 preset/shared/ 不经 lib re-export） |
| 集成 | `test/host-lib-fixes.test.mjs` | lib 半存储/安装面回归 14 例（0.3.0-tisitan.8）：settings 注册抛错 → error 留痕 + 热更监听与 RPC 面照常活（改存储后 snapshot 花名册即时反映新绑定）/ 读盘抛错独立留痕不牵连 RPC / loadSettings 谎报改判 `unavailable`（带原因与 details）/ saveSettings 脏键 fail-closed（大写名 + 路径串丢弃而正常行照写）/ 桥函数抛错回 `internal` 且 host 侧留痕 / 出口裁剪（每桶末 8、current·queue·history 无 prompt、求助正文保留、broker 实况数组零改写）/ 桥缺席仍是降级空态 / `rpc.handle` 两参与三参双形态（三参才带 `authority:'loopback'`）/ `installPreset:false` 真短路零文件动作 / marker 三态（首装落版本+摘要、同版本同内容跳过且装机手改存活、包内漂移重拷）/ 旧格式 marker 无条件同步 / shared 缺席 warn + 源树缺席吞异常留痕且不写 marker / prompts 镜像清孤儿 + 未变更文件 mtime 不变 / getBuiltinPersona 回落包内原文 + `presetInstallRoot` 两口径 |
| 冒烟 | `test/client-smoke.test.mjs` | 客户端半 6 例（0.3.0-tisitan.8，Node 侧跑、假时钟推进、不起浏览器）：`client.apply` timer 在席走 `timer.interval`（600+800 双链，unapply 后 disposer 全调用）/ timer 缺席回落自管 `setInterval`（一次性留痕，unapply 清零不留孤儿）/ sessions 缺席一次性留痕且跳转链不点火 / in-flight 门（在飞期间 tick 全丢，落地后恢复放行）/ 失败退避逐档（600 被吃 → 1500 放行 → 3000 封顶 → 成功复位回 600，故障与恢复各只 warn 一行）/ `internal` 与 `absent` 两型留痕分流 |
| 集成 | `test/settings-fence.test.mjs` | 设置页加固 lib 面 13 例（0.3.0-tisitan.9）：loadSettings 回带 revision（宿主 describe 真源）/ describe 缺席时回落进程内计数器且只数本命名空间的 `settings/updated` / 过期凭据就地拒绝且**一次写都不发** + details 带 `{expected, actual}` / 凭据新鲜时把 expectedRevision 交给宿主执行且成功后回带新版本号 / 宿主自抛 `SETTINGS_CONFLICT` 映射为 conflict（describe 与真实版本分叉复现预检-提交之间的 TOCTOU 窗）/ draft 不带 revision = 无条件写也不塞假第三参 / 旧宿主两参 mutate 时 `arguments.length === 2`（越界实参会崩注册）/ listModels 三渠道同 tick 全部发起（并行证据）/ 单渠道失败只脏自己（键不缺席 + 原因进 errors + 他渠道照常）/ llm 缺席仍给 `{providers:[],models:{},errors:{}}` 形状 / snapshot.roster 结构化字段齐备且 `rosterLines.length === roster.length + 1`（同源，多的正是表头）/ lib 文本镜像、shared 简报、结构化条目三处语义一致 / bindings 形状漂移（非数组 fallbacks、脏 toolFilter、null 行）不炸 |
| 单测 | `test/settings-guard.test.mjs` | 设置页守卫纯函数 11 例（0.3.0-tisitan.9，无 React 无 DOM）：interpretLoadResult 把 revision 从 draft 里剥干净（防止凭据被当配置字段回写）/ 旧 host 半不回版本 → `revision:null` 而非伪 0 / `ok:false`、value 缺席、数组、空响应一律 failed（null-draft 禁存门禁不变）；interpretSaveResult 成功 adopt 新凭据、`value:null` 仍算成功但不发明版本、conflict 独立成态并**作废本地凭据**（message 含「他处已修改」与实际版本号）、宿主原生 `SETTINGS_CONFLICT` 同样归一为 conflict 不降级成 settings-rejected、真写失败保留 host 原因；attachBeforeUnloadGuard 挂一个监听 + disposer 精确摘除 + 重复解除幂等 / 事件必须 preventDefault + `returnValue`（否则浏览器不弹自家确认框）/ 非浏览器环境返回可调用的空 disposer |
| 集成 | `test/failure-notice.test.mjs` | 失败通知真空期三件套 11 例（tisitan.18）：名册简报段注册形态/儿童门控两路/内容全要素/字节稳定（含键插入序无关）/settings 更新免刷新管道 5 + 同步预告 e2e 5（有链失败评估中先于重派通知 / 无链失败取证中先于附因通知 / aborted 有链不谎报评估中 / 链尽终局通知 / 成功 end 零预告）+ 分类器否决终局通知 1 |
| 集成 | `test/compat-alpha4.test.mjs` | alpha.2/3 ↔ alpha.4 兼容适配 32 例（tisitan.22 + 防旁路加固批 + 终审批 + 0.3.0-tisitan.12 N15；适配函数自健康度批起住 `shared/adjacent.mjs`）：`sessionEvents` 双形态与坏档回落 3、`deliverToAdjacent` 新/旧路径与优先级 3、**N15 路由表 2**（五形态 × 两档位的 route 枚举全在册 + **探测/投递同构不变量**：同一 runtime 对象上 `canQueueAdjacent` 的答复必须等于 plan 的路由口径，且投递实际命中的原语就是那条 route——旧写法靠注释维持，塌档只会静默表现为「queued 走了 steer」）、**queued 档位三路径 6**（`canQueueAdjacent` 三态两例 + alpha.4 internal 队列符号直取 / steer 直走 sendMessage / alpha.2-3 followup 天然 FIFO / 缺省即 queued）、`reportToParent` 四例、broker 接线 7（alpha.4 形态 continue/need_help、inject 兜底、**broker 级 queued 真 FIFO / 无队列符号退化 steer+warn / steer 档经门面不直调 Agent.steer / steer 被拒回落 queued**）、modelCache 热更失效 1、**缓存纪律五例（tisitan.7 N9/N10）**：在飞清单不回写热更后的缓存（epoch 竞态）/ 列举成功的空清单也缓存（坏 provider 不再逐请求重拉）/ 抛错不缓存留待重试 / effortCache 随热更作废 / 能力表 null 不入缓存、**宿主契约哨兵 1**（解析到 dsh-subagent ≥ alpha.3 才验门面形状与队列符号；0.3.0-tisitan.11 N1 起 devDeps 升到 alpha 线，本机解析 0.1.2-alpha.5 → **已合闸真跑**，全仓 `# skipped 0`） |
| 集成 | `test/anti-bypass.test.mjs` | 防旁路加固 7 例（R1/R2/R3 + 终审 U1）：`ADJACENT_BYPASS_TOOLS` 值集合 pin、**门面收口 pin（无 `childAgent.steer(` 直调、无自造 `mygo-steer-*`；C-10 P6 退役「broker 源码两侧 deny 接线计数」例——两侧 deny 实际落下什么是下面 `agent/created` 两例逐名断言的，比数出现次数强）**、`agent/created` 子代理侧 deny 含派生工具 + 邻接三件套且保留 need_help/观测工具、Sisyphus 侧 deny 含 skill + 邻接三件套且不误伤六件套、restrict 批级抛错时逐名兜底不连坐、载荷缺 agent / ctx 未 ready 全崩不炸挂载、**闸体自身抛错必须 console.warn 留痕（N12，tisitan.7：静默失守等于防线整体不存在）** |
| 单测 | `test/dump-session.test.mjs` | 取证 CLI（`scripts/dump-session.mjs`）9 例：summarizeEvent 摘要规则 4（request/header 打 provider/model、llm/retry 序号、turn/end reason、assistant/chunk 与 tool 名）、dumpArchive 合成多帧档案行为面 4（逐帧事件流/末帧截断容错/帧内损坏行跳过/档案不可读与解压全灭非零语义）、locateArchive childId 全项目目录搜索 1；zstdCompressSync 合成档案全 hermetic（tisitan.16） |
| 单测 | `test/child-registry.test.mjs` | 子代理登记表 8 例（健康度批，直测 `shared/child-registry.mjs`）：墓碑迁移（活登记让位 + 备选覆盖同点摘 + 无登记返回 false）、墓碑有界 FIFO 驱逐（超容只留最新两枚且被驱逐者覆盖不残留）、缺省容量取 `DISPOSED_TYPES_CAP`、`retireChild` 与 `retireTypeRecords` 分工（后者故意保留 childOwner）、备选两段式登记（pending 按 label 命中 → promote 转正撤临时）、永久覆盖优先于同 label 临时登记、`rearmChild` 三态守卫（无 fallbackEntry / 缺 model / provider 非字符串均不回填，ownerPid undefined 不写键）、**复活即新世代（`fallbackDecided` 与 `abortExpected` 两张一次性表同点清零且只清复活者自己，N5，tisitan.7）** |
| 单测 | `test/end-attribution.test.mjs` | end 归因决策 23 例（0.3.0-tisitan.12 B5，直测 `shared/end-attribution.mjs`，**不起 ctx 替身**）：E0 无载荷 / E1 迟到重复（推进照常，槽位已空）/ E2 不在册（**ops 必须为空**——类型侧三表本无此键是空转，childOwner 更不能清，它可能指向仍活着的属主实例）/ E2b 多占位歧义零 op / E3 属主已毁只 retire / E4 占位换键（ops 顺序 bind→set-owner 钉死）/ E4b 归因后即在册（否则 error 终局漏重派）/ E5 abort 护航吞非 completed 终局、E5b completed 只消费不吞 / E6 在飞不重复评估 / **换序三例 E5→E6、E6→E7、E3→E4**（分支先后本身就是语义）/ E7 评估载荷四件套（guard + 预告 + baseConclusion + failureLine）/ E7b 非 error 终局三型绝不进评估 / E7c·E7d 预告措辞可分辨 / E8 结论取 text 块串接 / E8b 空载荷兜底与终局两行顺序 / E8c 迟到第二发不重复预告 / readFailure 惰性（早退六连零次、收尾恰一次）/ DECISIONS 八条全表 + `shouldAdvanceQueue` 真值表（未登记 = 不推进）。首批用例即抓出 E0 出口 `ops` 写成 `{}` 的形状病（应为 `[]`） |
| 基建 | `test/helpers/mock-ctx.mjs` | 非用例文件（六文件共用的 broker.apply ctx 替身工厂 + 夹具）；**0.3.0-tisitan.11 C-09 五项保真严格化**：listeners 多播 + `dispatch` waterfall 链（含「next() 重复调用即抛」）+ `dispatchEach` 广播 + `registeredHandlers()` 注册数、`systemPrompt.section`/`tools.register` 重名抛错、`effect` 不再吞异常、`settings.get` 返回深冻结副本（写变异当场 TypeError）；另加 `waitFor(谓词,{what,attempts,delayMs})` 条件等待（固定 sleep 在 20 文件并行时假红，C-12 实测约 1/5；超时抛错带谓词源码 + what 标签）与 `removeHomeWithRetry`（临时目录树里 50ms 防抖台账写与 teardown 抢窗，全量并行报 ENOTEMPTY/EBUSY，有界退避只吞这三类可重试错误）；`createMockCtx` 参数化服务注入（agents/llm/settings/sessions/toolsRegistry/subagentsExtra）、`captureSections`/`captureRestrict`/`captureEffects`（捕获 effect 返回的 Dispose，供卸载路径断言，tisitan.7 N8）捕获口、`keepHome`/`homePrefix` 台账隔离策略；`withRealSignalContract` 固化上游 startContinuable 无条件解引用 signal 的真实契约（旧式宽松 mock 会让队列重试路径假绿） |

### 工程链路（依赖 / CI / 发布；0.3.0-tisitan.11 D-14/D-15）

| 机制 | 出处 | 说明 |
|---|---|---|
| 依赖线对齐部署线（N1 根治） | `package.json` devDependencies | `@deepseek-ai/{dsh-agent,dsh-llm,dsh-subagent}` 从 `>=0.1.2-alpha.2 <0.2.0`（实装解析 `0.1.0-rc.8`）改 `^0.1.2-alpha.4`；npm 因家族内交叉 peer（alpha.5 的 dsh-agent 要 dsh-llm `^alpha.5`）最终解析到 **0.1.2-alpha.5** 全套。收益：`npm ls --depth=0` 从 8 项 ELSPROBLEMS（7 invalid + 1 extraneous）到 exit 0，且**宿主契约哨兵从恒 skip 变真跑**（本仓唯一拿真宿主 `SubagentRuntime.prototype` 对账的闸门）。peerDependencies 保持 `>=0.1.2-alpha.2 <0.2.0`——那是给宿主的兼容声明，不是自缚 |
| lockfile 入库 | `.gitignore` + `package-lock.json` | 旧 `.gitignore` 屏蔽 lockfile，两份 workflow 注释还写着「No lockfile is committed」而本地一直存在该文件——早已失真。现在入库 + CI `npm ci`：可复现树，漂移当场报错而非静默重解析 |
| 构建产物入库（方案 A） | `.gitignore` + `dist/client.js` | 分发只走 git，装方无构建权限 → `exports["./client"]` 指向的 `dist/client.js` **必须在仓库里**。忽略规则从 `dist/` 改 `dist/*` + `!dist/client.js`：写成 `dist/` 时父目录被整体忽略，目录内的 `!` 例外**永不生效**（git 不递归进被忽略目录，只有 `git add -f` 救得回来）。实证见 `git check-ignore -q dist/client.js` 退出码 1、`git ls-files --others --exclude-standard dist` 列出该文件。政策细节与发版动作见下「发布流程」 |
| Node 版本单一来源 | `.nvmrc`（22.15） | 两条 workflow 都用 `actions/setup-node@v4` + `node-version-file: .nvmrc`，`engines.node` 同源。旧的 `node-version: lts/*` 会随时间漂移（今天 22，明年 24） |
| CI 去 bun 化 + Windows 腿 | `.github/workflows/ci.yml` | 旧整条腿跑 `bun install` / `bunx tsc` / `bun run test`，而仓库从未声明或提交 bun 锁文件 → CI 解析的树既不代表本地、也不代表 `npm publish` 消费者拿到的那棵，alpha 线 peer 约束从未被验证过。现在 `npm ci` + `npm run typecheck:archive` + `npm test` + `npm pack --dry-run`；矩阵加 `windows-latest`（本仓在 Windows 上开发部署，路径分隔符 / fs 语义 / npm 脚本引号只在那台机器才为真）。补 `timeout-minutes: 20` / `concurrency`（cancel-in-progress）/ `permissions: contents: read` / `workflow_dispatch` |
| 发布闸门与 dist-tag（**休眠**） | `.github/workflows/publish.yml` | **休眠：未启用 npm 发布渠道（包名归属问题），仅 git 分发**——本 fork 的 `0.3.0-tisitan.N` 从未发布到公共 npm，该文件保留只为将来决定改名发布或拿到包名权限时免重写（见 §六「已知陷阱」包名那条）。文件内的机制本身仍然正确可用：**tag↔version 一致性断言**（`v$TAG` 必须等于 `package.json` 版本，挡住「忘 bump 版本就打 tag」把错版本永久留在线上）；**预发布按版本串含 `-` 派生 `--tag next`**（本仓全是 `x.y.z-tisitan.N` 形态，按 semver 都是预发布，不该抢占 `latest`）；publish 的 concurrency 故意 `cancel-in-progress: false`（半途取消会留下「npm 上有版本但没有对应构建记录」的空档）；认证仍走 OIDC Trusted Publishing（不设 `registry-url`/`NODE_AUTH_TOKEN`）；两档同样补 timeout / `permissions: contents: read` / `workflow_dispatch` |
| 发布物白名单瘦身 | `package.json` files | 剔 `src/`（纯构建输入，运行期零引用——已 grep 核实 lib/preset/prompts 都不读它）+ 新增 `!docs/archive`（两份审查报告，文档价值已由 ARCHITECTURE/FORK-GUIDE 承担）；`docs/ARCHITECTURE.md` 与 `FORK-GUIDE.md` 保留。连带 `client.core.js` 不再落盘（`build-client.mjs` 改 `write:false` 直取内存产物 + 清历史遗留文件）：**tarball 45 files / 278.6 kB / 未压缩 758.4 kB → 32 files / 230.4 kB / 619.9 kB**（-13 文件 / -48.2 kB / -138.5 kB，约 -18%）。白名单正确性不再靠肉眼：host-parity 新增「安装目录模拟」，按 files 白名单算出发布集合并逐条核对两半 import 目标都在其中，漏一个目录 = 用户侧 `MODULE_NOT_FOUND` 当场红 |
| 测试发现方式 | `package.json` scripts.test | `node test/apply.mjs && node --test test/a.test.mjs test/b…`（手写 20 档清单）→ `node scripts/build-client.mjs && node test/apply.mjs && node --test "test/*.test.mjs"`。旧写法下 `roster-roles` 曾在清单里静默失踪多个批次（加档必须记得改 script，忘了就是永久不跑）；改 node 自带通配后加档零动作。**构建前置**使 apply.mjs 的「dist 比 src 新」断言恒真——它守的从「你忘了跑构建」变成「构建确实产出了」；`build` 脚本去 bun 壳直调 `node scripts/build-client.mjs` |

### 发布流程（发版固定动作；0.3.0-tisitan.12 起 dist 随 release commit 入库）

**唯一分发渠道 = git**。本 fork 不发公共 npm（`publish.yml` 休眠，原因见 §六
「已知陷阱」的包名归属条），朋友侧的安装路径就是 README「安装（从 git clone）」那一条：
`git clone` → `dsh plugin --profile web add <本地路径>`。**这条链要求 clone 出来就能
直接用**——所以构建产物 `dist/client.js` 必须在仓库里（`package.json`
`exports["./client"]` 指向它，缺它 Web UI 起不来）。

为什么不走 npm 那套 `prepare` 钩子现场构建（方案 B，已否）：`dsh plugin add` 是
pnpm 转发器，而 pnpm 默认**拦下依赖自带的构建脚本**，要装方在 profile 的
`pnpm-workspace.yaml` 里手写 `allowBuilds` 才放行（`lib/plugin-*.js` 失败时提示的正是
这件事）。给插件加 `prepare` = 每个朋友都得先解开一道 pnpm 白名单，还要在本机装
esbuild 与全套 devDependencies——他们没有、也不该有构建权限。**方案 A（本仓现状）：
release commit 提交构建产物，朋友零构建。**

固定动作（顺序即口径，别跳步）：

```bash
# 1) bump 版本：package.json 的 version（唯一权威源）。README 顶部那个
#    deepseek-harness-meta 块的 version 只是展示用元信息，不参与 preset 同步判定
#    （摘要只吃 preset/ + prompts/ 两棵树），但发版时一并对齐，免得日后对不上号
# 2) 全量测试（scripts.test 已含构建：build-client → apply 冒烟含 dist 新鲜度 → node --test 通配）
npm test
# 3) 显式重建一次产物，确保入库的那份就是刚测过的那份（npm test 已跑过，这里是幂等确认）
node scripts/build-client.mjs
# 4) 暂存：lib/ + dist/client.js + 本轮真实改动的源与文档
git add lib/index.js dist/client.js <其余改动>
git commit -m "0.3.0-tisitan.N: <摘要>"
# 5) 打 tag 并推（tag 名 = v + package.json version，publish.yml 的一致性断言吃的就是这个）
git tag v0.3.0-tisitan.N
git push origin main --follow-tags
```

**dist 入库口径（写明，免得日后扯皮）**：

- **release commit 必带 `dist/client.js`**——漏了就是给朋友发了个装不上的版本。
- 日常开发提交**不必带**：产物 diff 会淹没代码 diff，且 `test/apply.mjs` 的 dist
  新鲜度冒烟只在跑 `npm test` 时才有意义。`.gitignore` 写的是 `dist/*` +
  `!dist/client.js`，所以「顺带拷一份产物进去」不会被 `git add` 拒绝，属**允许但不推荐**；
  决定权在发版那一刻。
- 除 `client.js` 以外的任何 `dist/` 内容一律不入库（`build-client.mjs` 走
  `write:false`，本就不落中间产物，且构建时会主动删历史遗留的 `client.core.js`）。

**发版后的自检**（30 秒，专治「忘带 dist 就推了」）：

```bash
git ls-tree -r --name-only HEAD | grep '^dist/'   # 期望恰好一行 dist/client.js
```

**副作用提醒**：推 tag 会触发休眠中的 `publish.yml` 跑一次，并在最后一步 `npm publish`
失败（包名不归本 fork，OIDC 拿不到权限）。这是**预期噪音**，不影响 git 分发链，
不必修——真要清静，改的是那个文件的触发条件，不是本流程。

## 四、fork 与上游的关系

- `upstream` = [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go)（本 fork 基于 v0.2.3 @ cf2d802）
- 版本号规则：`上游版本-tisitan.N`；完整差异台账见 [CHANGELOG.md](../CHANGELOG.md)
- 同步策略：定期 `git fetch upstream`，交集分析上游新提交与本 fork 补丁面，定点合并

## 五、评估过但**未实施**的升级（含结论）

| 候选 | 结论 | 原因 |
|---|---|---|
| need_help 改真 interrupt 硬挂起 | **暂缓** | `ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parentAgent })` API 存在（dsh-subagent/lib/types/continuation.d.ts:232），但中断时机（reportFrom 送达前杀回合会丢求助单）、恢复后模型如何感知被取消的 tool call，均需运行时实测验证。当前软挂起下：乱跑的子代理无法破坏队列（单线由状态机强制），仅浪费自身 token，残余风险可接受 |
| isolate 服务 + `agentPresets.serviceFor` 官方桥 | **暂缓** | 需把 broker 拆成 isolate realm 服务行 + root 消费行（mount 审计强制 preset 服务入 isolate，而 broker 的 systemPrompt.section 必须留在 agent scope），重构面大且挂载行为无法离线验证。当前 Symbol.for 桥在拉取路径上功能等价（同进程、零副本、实时读） |
| projection 推流替代 600ms 轮询 | **未来方向** | `session.append('mygo/state', 全量快照)` + `sessionProjections.register` + client `useProjection`（dsh-goal 官方范式），可解锁推流与冷会话回放。需 session 级事件写入，等运行时环境验证后实施 |

## 六、已知陷阱 / 限制

- **合并语义无法表达「完全不指定模型」**：settings 合并把空串/缺省视为
  「未设置」并回落基线（`baseBindings` = 默认值 + 插件 config）。若
  `config.bindings` 给某工种配了模型，在 WebUI 清空该字段只会回落到
  config 值，无法回到「不指定」；要彻底不指定，需同时摘掉 config 里的绑定。
- **`bindSisyphus: true` 的全局副作用已成历史（tisitan.21）**：双半同构
  时代 lib 半在 global 层注册 waterfall，开启后连非 MyGO 会话的主模型
  也会被覆盖；现 waterfall 唯一归属 broker 半（preset scope），副作用
  天然限定在 MyGO 会话内。开关默认关闭不变，作用于「未登记工种的
  MyGO 会话」套用 sisyphus 绑定，勿轻开。
- **默认绑定已清空（0.2.3-tisitan.7 起）**：`defaultBindings()` 八键（含 sisyphus）
  均为 `{}`，不内置任何模型/渠道名，子代理完全继承环境默认路由。需要按工种分流
  必须自行配置（WebUI 设置页「MyGO 编排」或 `~/.dsh/settings.yaml`，
  示例见 README「工种模型绑定」），否则所有子代理与 Sisyphus 同路由。
- **tool-mask：三源并集，`DEFAULT_DENY` 空（tisitan.13 起 / 并集自防旁路加固批）**：
   `preset/tool-mask.mjs` 的 `DEFAULT_DENY` 已清空（原 7 个私有示例名移除），
   清单 = `config.deny`（agent.cordis.yml 行级，现含上游邻接消息三件套
   `send_message` / `list_agents` / `interrupt_agent`）∪ settings
   `toolMask.deny`（设置页「工具屏蔽」双列表）∪ 空默认，**去重保序、互不
   覆盖**。并集是这批敢往 `config.deny` 写安全条目的前提：旧语义下 `config.deny`
   一旦非空就把用户设置页清单整体吃掉。清单在 preset 挂载时解析一次，**只对
   新会话生效**。restrict 失败分两类（0.3.0-tisitan.6 日志卫生批）：本作用域查无此具（宿主
   报 `names unknown global tool`）静默跳过，名字进汇总行的「not registered at
   this scope」清单，不再逐名 warn——web 部署下 host 不全局注册邻接三件套，
   preset standing 作用域的 restrict 必然查无此具，逐名 warn 纯属噪音；其他
   restrict 报错是真异常，仍逐名 warn。两类都不炸挂载；汇总行的数字只统计
   **实际 restrict 成功**的个数。注意 restrict 只过滤**继承名**
   （`packages/core/tools/src/index.ts:1143-1165` own-layer 豁免），所以本行能
   屏蔽宿主 bundle 在 global 层注册的工具（上述三件在非 web profile 下即属
   此类，见 `dsh-base/cordis.patch.yml:349-353`；web profile 下它们不在 global
   层，本行只是空跑），屏蔽不掉 broker 自产的编排工具——
   那类「同层名」由 broker 的 `agent/created` 闸在 agent 子作用域上 deny。
   tisitan.12 及之前依赖内置清单的部署升级后需在设置页重配。
- **CI 的 Windows 腿本机预验不了，两处平台差异已知**（0.3.0-tisitan.11 D-14）：
  ① `test/anti-bypass` / 发布链路都在 Linux 上跑，符号链接（POSIX）用例已按
  `process.platform` 门控，win32 下 `fs.symlinkSync` 无特权会 EPERM——新加 POSIX-only
  用例时必须同样门控，否则 Windows 腿必红；
  ② 本机 npm 11.16 带 allow-scripts 策略，`npm install` 会跳过 esbuild 的 postinstall
  （实测 `built dist/client.js` 仍成功——0.28 走 `@esbuild/win32-x64` optional binary，
  postinstall 只服务旧版二进制下载路径）。若在 CI 里发现 bundle 构建静默不产出，
  先查这个而不是先查脚本。
- **`dsh-my-go` 这个包名在公共 npm 上不属于本 fork → 本 fork 只走 git 分发**（0.3.0-tisitan.11
  实测：`npm view dsh-my-go` → maintainer `kuohu`、`latest: 0.4.3`、versions 里**零**个
  `tisitan` 版本）。所以 `publish.yml` 的 OIDC Trusted Publishing 需要该包名 owner
  在 npmjs 上把 GitHub provider 配到 fork 仓库才可能成功，否则一律 403——**该文件现已
  标注为休眠**（见上表「发布闸门与 dist-tag」行与「发布流程」小节），本 fork 的
  唯一分发渠道是 git。历史上 README 曾给过 `dsh plugin --profile web add dsh-my-go@latest`
  这条指令，而它装到的是**那个第三方包**、不是本 fork——属供应链级误导，已就地换成
  「安装（从 git clone）」流程 + 显式禁令。用户侧要装本 fork，只有本地路径这一条路
  （`dsh plugin --profile web add <clone 路径>`）。这条归属事实与本批的 CI 改动无关，
  但既然撞见就必须记账：真要自动发版，先决定是改名发布还是继续借用。
- **完工通知在 alpha.4 只剩一条（旧「双通知」已塌陷）**：alpha.2/3 时代子代理
  完工时父会话确实收到两条——子代自己的 `reportFrom`（reported）与 dsh-subagent
  的 `notifySettlement`（settled），均为 harness 硬编码模板、插件层无法抑制。
  **alpha.4 起 `reportFrom` 整个删除**，结论通路只剩 `notifySettlement`，而它
  自带 closing message（`settlementSummary` 开场 + 「Its closing message:
  <末段 assistant 输出>」，无输出时改说「It left no closing message.」）——
  broker 的 `subagent/end` 落账与面板结论都吃这条。另一条潜在通知源是上游给
  continuable 子代初始 prompt 追加的「完工前用 `send_message` 回报父代」指引
  （continuation.ts:296-309 `continuableInitialPrompt`，由 :497 的
  `isAdjacentAgentSendMessageTool(tools.get('send_message', 子代))` 门控）：
  防旁路加固批把邻接消息三件套 deny 掉后该判定转假，指引不再注入，子代也就
  无法绕开台账直插父代回合。tisitan.8 的补充通知（队列上岗映射 / 失败附因）
  照旧走自己的 `plugin/notice` inject 通道，不碰 harness 模板。
- **harness 通知层丢失 error.message，且 live store 读档有时序性失效**：
  `subagent/end` 载荷的 `stopReason` 只有 kind（completed/error/...），
  不带 error 字段；完整的 `error.message` / `code` 只存在于子会话档案的
  `turn/end` 事件 `reason.error` 里。更隐蔽的是：continuable Activation
  的销毁顺序（dsh-subagent/lib/types/continuation.js ~L1016-1050）是先
  `handle.dispose()`（连带把子 session 从 sessions live store 摘除）、删
  activation，最后 `observer.settle()` 才发射 `subagent/end`——所以经
  `sessions` 服务 API（`sessions.get(childId).events`）的 live 读法在 end
  处理器里**必然落空**（tisitan.8 实锤：failed 记录只有 '(error)'）。
  tisitan.9 起 live 读法降级为快路径，主路径改读**持久化档案**：
  `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(childId)>/
  session.jsonl.zstd`（目录规则与 dsh-session-persistence-jsonl 同算法，
  broker 内 `projectKey`/`encodeSegment` 逐行对齐其 lib/index.js:106-124/
  84-96）；该文件是多 zstd 帧追加容器，Node 的 zlib 单帧接口只吃首帧，
  必须扫描帧界逐帧解压（broker 内 `scanZstdFrameRanges` 对齐其
  scanZstdFrames :503-566），倒序取最后一条 `turn/end` error。找不到
  档案/解压失败/无 error 事件均静默退回无附因 + `console.warn` 留痕。
