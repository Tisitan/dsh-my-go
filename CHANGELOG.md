# Changelog

本文件记录 Tisitan fork 相对上游 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go) 的变更。
版本号规则：`上游版本-tisitan.N`。

## [0.3.0-tisitan.2] - 2026-08-31

「continue 三档 urgency」批：continue 工具新增 `urgency` 参数
（queued / steer / abort），跑中纠偏从此不必等当前轮自然结束。
方案 0（interrupt_agent + continue 手动连招）自此退役。测试 181 → 190。

### Added

- **continue 三档 urgency**（broker 半，唯一编排宿主）：
  - `queued`（默认）：现状零变化，prompt 经 followup 排队等当前轮
    结束后消费。
  - `steer`：子代理 running 时经 agents 注册表直取 `Agent.steer()`
    （harness 公开 API，消息形状照抄 notifyParent 注入段），指令进
    next-step 队列、**下一 step 边界即见**，不打断进行中的工具调用、
    不丢消息。注册表取不到活 agent（非驻留/冷态）兜底回落 followup +
    console.warn，**绝不静默失败**；非 running（waiting/finished）给
    steer 按 queued 投递 + warn——followup 路径自带 resume/revive 正确
    状态迁移，语义防呆优先于结构化报错（报错只会让主流程多花一轮重试
    queued，投递语义不变）。
  - `abort`：先 `ctx.subagents.interrupt()` 掐断当前 turn 再原
    followup（**顺序铁律：先掐后投**，命中 wakeRequested 闩锁，当前轮
    drain 收敛后续轮自动开跑；已启动工具调用 drain 但副作用不可回滚）。
    waiting/finished 无 turn 可掐：跳过 interrupt 直接投递。interrupt
    抛 UNAUTHORIZED（如收养的跨会话记录不在 ancestry）时降级 queued +
    warn，投递语义不丢。掐断成功同步 inject 一行预告，声明随后的
    harness 原生中断通知属预期噪音，防主流程误入失败处置（tisitan.18
    预告协议同款动机）。
- **abort 掐断护航（abortExpected）**：interrupt 掐断的那一轮必以
  `stopReason='aborted'` 上报 subagent/end——该 end 是编排方自造的
  预期事件，guard 一次性消费：不落史、不发「失败已知悉」系列通知、
  不推进队列（续轮仍占槽），续轮自己的 end 到达时走正常收尾。dispose
  宽限兜底（end 真缺席）同步清 guard，防泄漏后误吞同 childId 复活轮
  的正常 end。
- **abort 投递失败补偿**：interrupt 成功但随后的 followup 投递抛错时，
  catch 内撤销护航再抛出——被掐轮的 aborted end 走正常 finalizeEnd
  落史并释放槽位，绝不留下「记录 running 但子代理 idle、再无 end
  到达」的死槽（end 先于 catch 到达的极小窗口内 guard 已被消费，
  主流程重试 continue 即可自然恢复）。
- **continue 输出新增 `mode` 字段**（queued/steer/abort）：如实报告
  实际投递方式——降级场景（steer 回落、abort 降级、非 running）主流程
  可感知，render 文案同步展示。
- **编排记录 urgency 字段**：`followupPrompt(childId, prompt, urgency)`
  可选第三参，非空字符串入账、否则删字段（字段语义恒为「最新一条
  prompt 的投递档」，不留上一条残留）；随 `{...record}` 扩散走
  finish→history→台账落盘全链路，旧记录天然无此字段零变化。

### Changed

- **prompts/sisyphus.md 新增「continue 三档 urgency」小节**：跑中纠偏
  默认 steer、不紧急补充说明用 queued、只有「方向错了必须立刻停」才
  abort；明示 steer 可见时机=下一 step 边界（子代理卡在超长工具调用时
  仍有延迟）、abort 副作用不可回滚、非 running 自动按 queued 投递且
  `mode` 字段标明实际方式；方案 0 手动连招退役统一走 urgency。职责条
  与通信工具速查表同步指引。

### 测试

单测 181 → 190（+9）：bridge +8（steer 直取且 followup 零调用、steer
注册表缺位兜底回落 + warn、abort 的 interrupt 先于 followup + ancestor
authority + 预告通知、abort 护航的 aborted end 不落史不推进且续轮 end
正常收尾、abort 投递失败补偿撤销护航正常落史、queued 缺省零变化回归含
台账无 urgency 字段、非 running 给 steer 按 queued 投递并 resume、非
running 给 abort 跳过 interrupt 直接复活）；orchestration +1（urgency
入账/扩散/清除三态）。interrupt mock 复刻 dsh-subagent 真实契约
（ancestor authority 的活注册表校验抛错面，tisitan.6 教训）。逐文件
实测（`node --test` 逐文件跑数）：

| 文件 | 计数 |
| --- | --- |
| orchestration | 17 |
| bridge | 39 |
| multi-session | 5 |
| host-parity | 25 |
| roster-roles | 17 |
| roster-route | 19 |
| roster-rows | 16 |
| chain-rows | 11 |
| panel-format | 9 |
| tool-mask | 5 |
| tool-mask-rows | 7 |
| dump-session | 9 |
| failure-notice | 11 |
| **合计** | **190** |

## [0.3.0-tisitan.1] - 2026-08-31

「上游兼容修复」批：适配 harness 上游 0.1.2-alpha.2。（本批发布时漏登
CHANGELOG，tisitan.2 追记。）

### Fixed

- **peer/dev 依赖范围放宽** 至 `>=0.1.2-alpha.2 <0.2.0`；移除上游已
  删除的 `dsh-client-runtime` / `dsh-client-ui-slots` 依赖；`rpc.handle`
  调用移除已失效的 authority 实参。测试 181 不变。

## [0.3.0-tisitan.0] - 2026-08-31

「单宿主编排」批：lib 半（npm 主库）编排面整体切除，编排实现唯一归属
preset 半（broker.mjs）——双半同构时代（tisitan.9→20）落幕。
**BREAKING CHANGE**。测试 189 → 181。

### Breaking

- **lib 半编排面整体移除**：六个编排工具（`go_work` / `continue` /
  `need_help` / `forward` / `orchestration_status` / `list_subagents`）与
  派发 / 队列 / 台账 / 备选链 / 瀑布绑定 / 失败通知的全部实现唯一归属
  preset 半（`preset/tools/broker.mjs`，preset scope 注册）。lib-only
  降级形态不再提供编排能力——preset 由 `ensurePresetInstalled` 首启
  自动安装，常态无感；preset 未装配时编排工具不存在，面板降级为空态
  `{ seq: 0, parents: {} }`（rosterLines 花名册常驻）。
- **npm 导出面编排 re-export 移除**：`Orchestration` 类、失败分类
  （`normalizeTurnFailure` / `isFallbackable`）、档案取证
  （`readArchivedTurnFailure` 等）、养护函数不再从 lib 入口导出——
  消费方请直引 `preset/shared/` 对应模块（broker 半 re-export 不变；
  lib 保留存储面 re-export：`ROLE_KEY_PATTERN` / `migrateLegacyRolesOps` /
  `mergeRoleBindings`）。
- **编排台账归属迁移**：lib 半从此不读不写
  `orchestration-ledger.json`，台账持久化唯一归属 broker 半。

### Changed

- **lib/index.js 1636 → 391 行（-1245）**：职责收敛为 preset 安装器
  （`ensurePresetInstalled`）+ settings schema/存储（命名空间注册、
  roles dict 迁移与合并）+ 面板 RPC 端点全家（snapshot / listModels /
  listTools / getBuiltinPersona / loadSettings / saveSettings）+ 快照桥
  消费（桥缺位 = 「preset 未装配」降级空态）；`inject` 收敛为
  tools/llm/settings（subagents 等编排面依赖不再声明）。
- **host-parity 测试重写为反向 parity**（33 → 25）：原「双半对称」断言
  全部改造为「lib 编排标记 grep=0 + broker 原计数保留」哨兵——编排代码
  加回 lib 立即红；新增 RPC/settings 分界契约（RPC 端点全家与
  `settings.register` 为 lib 独有，broker 只读零 RPC）与 snapshot 降级
  形态锁（无桥 → 空态 + 花名册常驻；桥在席 → 直读 broker 实况）；
  lib 存储/面板面行为批原样保留，shared 面行为直测直引
  `preset/shared/`（不经 lib re-export）。
- **快照桥单向语义固化**：broker 发布 → lib 消费，是两半间唯一运行时
  通道；原「桥不在则回落 lib 自身状态机」语义随 lib 编排面切除删除。

### Notes

- **双写税归零**：编排逻辑不再存在第二份实现，修复只需改 broker 半一处。
- **双半竞态类结构性绝种**：tisitan.20 棒2-M1 台账双写竞态、「哪半
  应答」灵异类（现场-Z3 unknown-id 三方矛盾）随单宿主化不再可发生。
- **双半同构时代落幕**（tisitan.9→20）：演进脉络保留于
  docs/ARCHITECTURE.md §2 与 docs/FORK-GUIDE.md。

### 测试

单测 189 → 181（净 -8）：host-parity 33 → 25 全量重写（-33 双半镜像
对称断言退役，+25 反向 parity 重建，内含 RPC/settings 分界契约与
snapshot 降级空态锁等新增断言）；冒烟 `test/apply.mjs` 同步新增编排面
哨兵（inject 收敛断言 + lib 源码零编排标记断言，不计入单测数）。
逐文件实测（`node --test` 逐文件跑数）：

| 文件 | 计数 |
| --- | --- |
| orchestration | 16 |
| bridge | 31 |
| multi-session | 5 |
| host-parity | 25 |
| roster-roles | 17 |
| roster-route | 19 |
| roster-rows | 16 |
| chain-rows | 11 |
| panel-format | 9 |
| tool-mask | 5 |
| tool-mask-rows | 7 |
| dump-session | 9 |
| failure-notice | 11 |
| **合计** | **181** |

## [0.2.3-tisitan.20] - 2026-08-30

「总审查修复战」批：以 docs/code-review-2026-08-30.md（五棒流水线，零
Critical / 2 Major / 10 中 / 19 低）为工单分三波收口——Wave A 运行时
深审八项、Wave B 前端与低值六项、Wave C 文档/UI 文案包 + 版本收口。
测试 179 → 189。

### Fixed

- **Wave A · 运行时八项**：
  - **双半台账双写竞态**（棒2-M1，Major）：lib 半 session/disposed →
    scheduleLedgerSave 以启动时陈旧快照整体覆写台账文件，可静默回退
    broker 半的新鲜历史。修=快照桥（`Symbol.for('dsh-my-go.snapshot')`）
    存在时 lib 台账只读化，任何突变不再覆写台账文件。
  - **once-guard 盲窗**（棒2-Z1）：双发 end 落在 pickFallbackEntry
    await 窗口（含真实 listModels I/O）时重派被静默放弃，主流程收过
    「评估中」预告却永等不到终局。修=once-guard 已登记的后续 end 按
    迟到忽略、不提前落史、不弃重派（bridge step-3 f 钉死）。
  - **spawn 解析前回跳残留**（棒2-Z2）：activeFallback.set 在 await
    startContinuable 之后的窗口内，重派儿童请求经 label 兜底回跳主
    模型。修=spawn 前登记 pending 备选表供 waterfall 匹配，spawn
    失败同步清理不留悬空覆盖。
  - **roles.sisyphus 死数据排除**（棒2-L1）：merge 读面不消费
    roles.sisyphus（sisyphus 恒为顶级键），saveSettings 写面对
    draft.roles.sisyphus 不产生任何 ops，读写两面锁死。
  - **跨会话 continue 抢属主守卫**（棒2-L2）：属主仍活时 continue
    拒绝跨会话操作，属主消亡才允许收养。
  - **双半 model 校验对齐**（棒2-L3）：lib 半 waterfall 与 broker 半
    同语义——校验不过告警并保持 seed，provider 为空判丢弃。
  - **附因全灭终局口径**（棒2-L4）：live 与档案均读不到失败原因且
    不进重派评估时，「取证中」预告之后必补「未读到附因，已按失败
    落账」终局一行，协议不留真空期。
  - **废弃面清理 + promotion 测试 + engines**（低值打包）：
    dropQueuedFor/nextId 未用 import/promotionStateFor steps 计数器
    等废弃面收口；DSV4P0813 promotion 行为面测试补零（棒2-L7）；
    `engines.node` >=20 → **>=22.15**（棒4-Z5：`node:zlib` 的
    zstdDecompressSync 于 22.15/23.8 引入，旧 Node 下附因取证静默
    失效、dump-session CLI 崩）。
- **Wave B · 前端与低值六项**：
  - **设置页 null-gate 补全**（棒3-M1'，Major）：set()/setChain() 补
    与 setDeny/setPersonaOverride 同款 null-gate（外层拦截 + 函数式
    prev 守卫双保险），draft=null 不再能造半截 draft 解锁保存；
    makeSelect 支持 disabled，draft=null 全控件锁定。
  - **loadSettings 失败可见反馈**（棒3-Z1'）：加载态三分（加载中 /
    失败 / 就绪），失败亮红字横幅并禁用全部编辑与保存，不再完全静默。
  - **roles 投影重建脏行透传**（棒3-Z2'）：mergeRoleRowsIntoRoles
    内置透传 + 脏行原样保留 + 投影行重建 + 删除语义成立，不再静默
    删除未触碰脏行。
  - **createRole 拦内置键名**（棒4-Z4）：手建 sisyphus/hermes 等同名
    行与导入路径同则拦截，防护对称。
  - **低值打包**：D1 空备选行保存边界过滤（stripEmptyFallbackRows，
    编辑期保留、保存期剔除）+ D4 build 日志 UTF-16 码元冒充字节改
    Buffer.byteLength 口径 + D5 listModels 畸形响应防御（models 非
    对象整体丢弃不炸整页）+ D6 假备选徽章治理（extractFallbackNote
    匹配收窄为行首/前缀）+ build metafile 断言（10 src 模块逐一
    验证进 bundle）。

### Changed

- **Wave C · 文档/UI 文案包**：
  - **失败协议补第三预告分支**（棒4-Z1）：prompts/sisyphus.md「失败
    与备选通知协议」补「有备选链但非 error 终局（aborted）→ 不进入
    备选评估，取证中」分支与处置指引（等「子代理失败:」附因推送即
    终局，不空等重派），与 broker 实发三分支对齐（tisitan.18 prompt
    层漏同步补齐）。
  - **dsv4p0813 勾选文案补作用域**（棒4-Z2）：设置页注明「仅对 MyGO
    preset 派发的子代理会话生效，lib-only 部署形态下不生效」。
  - **Sisyphus 卡 dsv4p0813 死开关处置**（棒4-Z3）：注入识别面
    typeOfAgent 恒不命中 sisyphus 会话，勾选永不生效——设置页对
    Sisyphus 卡置灰锁定并附说明（选灰禁+说明，成本低于隐藏且保留
    布局一致性）。
  - **文档漂移 18 处全清**（棒5 Part 1）：ARCHITECTURE.md A1-A8
    （OrchestrationState 实况形状/设置页字段与同文档矛盾消除/DSV4
    仅 broker 半注记/观测工具补账/档案路径 encodeSegment+cwd 兜底/
    面板花名册常驻区/交付物表补 lib·src·test·scripts/roles 名册扩展
    入口）；FORK-GUIDE.md F1-F5（版本与测试计数追平实测/测试树例数
    与缺文件行补齐/client.js 46→57/全景图左框对齐与行宽统一/scripts
    树补 dump-session）；README.md R1-R5（meta version 追平/计数矛盾
    消除/46→57/scripts 树补 dump-session/Node 门槛标 zstd 实需
    >=22.15 与 engines 联动）。
- **裸词泛化**（棒4-Z10）：tisitan.16 事故定案措辞去具体厂商名，
  改「主模型」中性表述，句意保全。

### Notes

- **现场-Z3 诊断结论**：unknown-id「不在编排台账」为记录特异非系统性
  ——continue 同桶同年代记录成功；台账文件 56 条空 parentSessionId
  记录桶为代际差遗留（v1 旧档载入 'legacy' 兜底桶机制的已知形态），
  修=continue 内存全实例未命中时回读台账文件兜底查找（bridge 测试
  钉死），三方矛盾口径统一。
- **基建观察（流中断伪装成功）**：主模型额度耗尽前后，长输出回合的
  流被上游掐断，错误文本注入消息正文而回合按成功收尾——备选链
  （失败终局才触发）对此类流级伪装失明；tisitan.13 已治 turn/end
  级失明（崩溃伪装 200），流级伪装是上一层同族问题，留档待上游
  或后续批次处置。

### 测试

- Wave A：`test/bridge.test.mjs` 30 → 31（once-guard 双发盲窗）+
  台账文件兜底查找（现场-Z3）；`test/multi-session.test.mjs` 4 → 5
  （跨会话抢属主守卫）；`test/roster-route.test.mjs` 16 → 19（spawn
  前回跳两例 + DSV4 promotion 行为面）；`test/roster-roles.test.mjs`
  15 → 17（roles.sisyphus 读写两面）；`test/host-parity.test.mjs`
  31 → 33（台账只读化 + waterfall 校验对齐）；
  `test/orchestration.test.mjs` 17 → 16（dropQueuedFor 废弃面收口）。
- Wave B：`test/chain-rows.test.mjs` 10 → 11（stripEmptyFallbackRows）；
  `test/roster-rows.test.mjs` 15 → 16（mergeRoleRowsIntoRoles 脏行
  透传）；`test/panel-format.test.mjs` 9 例内一枚改测 D6 行首锚定。
- 全量 189/189 绿；tsc 干净。重建 dist：client.js 磁盘 77,123B
  （基线 76,432B，+691B；构建日志已是 Buffer.byteLength 口径，与
  磁盘字节一致）。

## [0.2.3-tisitan.19] - 2026-08-30

「模型配置 UI 合并」批：设置页角色卡的「主选（provider/model 两个下
拉）」与「备选链列表」两块割裂编辑区合并为单一「模型优先级列表」——
备选扶正成主选从「改两处下拉 + 删备选行」三步操作降为一次 ↑。纯 UI
层投影，存储零变更。测试 176 → 179（收口 fallback-rows 7 例，行为面
并入 chain-rows 10 例）。

### Changed

- **主选/备选合并为单一模型优先级列表**（`src/settings-core.js` 内置
  工种卡 + `src/roles-editor.js` 自定义角色卡共用 `renderChainEditor`）：
  #1 即主选（带「主选」徽章，空值=跟随 Sisyphus），#2..N 即备选链顺
  序；每行 = 序号 + provider 下拉 + model 下拉 + ↑↓× 按钮。跨 #1/#2
  边界移动：#2 点 ↑ 与 #1 换位（一键扶正，原主选降 #2），#1 点 ↓ 同
  理；删除 #1 则 #2 自动扶正；「+ 添加条目」追加尾部；删除守卫——链
  至少保留主选位 1 条（× 按钮同步 disabled）。思考档位/DSV4P0813 补
  丁/人设覆盖/toolFilter 各区域原样保留在列表下方。
- **新纯函数模块 `src/chain-rows.js`**（与 roster-rows/tool-mask-rows
  同风格，零依赖，bundle 内联 + node --test 双用）：
  `composeChain`（存储形状 → 链投影）/ `decomposeChain`（链 → 存储形
  状）/ `addChainEntry` / `removeChainEntry`（最小长度守卫）/
  `moveChainEntry`（跨边界换位）/ `updateChainEntry`（provider 变更重
  置该行 model）/ `normalizeChainRows`；全部纯净（输入深度不变异）。
  视图为编辑期唯一真源：渲染经 compose 投影、编辑经 decompose 写回
  （对齐 roster-rows 的 rows 视图先例）。

### Removed

- **`src/fallback-rows.js` 及其测试收口**：合并后其行迁移语义由
  chain-rows 全覆盖（normalize/add/remove/move/update 同名同语义，
  remove 增加最小长度守卫），UI 引用面（`renderFallbackChain` 内置卡
  + 角色卡共用处）一并收口，不留死代码；原 7 例行为面并入
  chain-rows 10 例。

### Notes

- **存储 schema 零变更**：保存时拆解 #1→`provider`/`model`、#2..N→
  `fallbacks`，加载时合成；broker/lib 零改动，YAML 手写形状与既有
  配置完全兼容。
- **删除守卫的取舍**：旧备选链允许删空（空链=不启用备选，是有意义
  的持久态）；合并链 #1 是主选位（空值=跟随 Sisyphus 同样是合法持
  久态），链长恒 ≥1，故删最后一条为 no-op——与 removeFallbackRow
  允许删空的语义差异在此，UI 以 × 按钮 disabled 表达同一守卫。
- **空行过滤语义沿用现状**：链内空 provider/model 行不做保存期过
  滤（与旧 fallback 编辑器一致），下游 `pickFallbackEntry` 对缺字段
  条目 warn 跳过的容错路径不变。

### 测试

- 新文件 `test/chain-rows.test.mjs` 10 例：normalize 脏数据归一、
  compose/decompose 投影与拆解（含脏数据防御与空形状规范化）、
  round-trip 双向恒等、addEntry（默认空行/指定条目/非法条目防御）、
  删除扶正 + 最小长度守卫、跨边界双向移动 + clamp no-op、
  updateEntry provider 重置 model、全部函数不突变输入、draft 往返
  语义（扶正/删 #1/追加空行的写回形状）。
- 全量 179/179 绿；tsc 干净。重建 dist：client.js 磁盘 72,767B
  （基线 73,067B，-300B）。

## [0.2.3-tisitan.18] - 2026-08-30

「失败通知真空期消灭战·三件套」批：harness 原生「failed before it
finished」通知（dsh-subagent 硬编码模板，插件不可抑制）在 settle 瞬间
同步唤醒主流程，而 broker 的失败处置（取证/备选重派）是异步的、通知
晚到数秒——真空期内主流程不知道备选链存在，可能自行报死/手动重派与
broker 撞车。修复 = 提示词层知识 + 零延迟同步预告。测试 163 → 176。

### Added

- **名册简报系统提示段**（`dsh-my-go:roster`，order=10，persona(0) 与
  编排规则(20) 之间空档）：函数态 text 每次 assemble 从当前 bindings
  现渲活名册（工种 → provider·model → 备选链序列 → toolFilter 概要 →
  人设来源）+ 头部一行失败通知协议指路；儿童门控——子代理
  （parentSession 直达 + `typeOfAgent` 冷恢复 label 兜底）返回空串，
  根编排会话独享全文；字节稳定——渲染器（`shared/roles.mjs`
  `renderRosterBriefing`，单一源）键排序、无时间戳/无随机，同
  settings 两次渲染逐字节全等；bindings 沿用 `settings/updated` 整表
  重建机制，函数态直读最新值，天然免刷新管道。
- **prompts/sisyphus.md「失败与备选通知协议」段**（静态文案，落在
  orchestration section 内）：harness failed 先到是常态不代表终局；
  收到 failed 先查名册——有链一律静默等待 broker 备选处置通知（禁止
  自行报死/手动重派），无链才立即进入失败处置；「备选重派」通知的
  新 childId 接管一切后续引用。
- **失败同步预告 + 终局显式通知**（双半，end 处理器同步段零 await）：
  有链失败进评估前同步 inject「失败已知悉，备选评估中（n 条），暂缓
  失败处置」；无链失败同步 inject「无备选链，取证中」；有链但非
  error 终局（aborted）同步 inject「不进入备选评估，取证中」——绝不
  谎报评估中让主流程空等。`attemptFallbackRedeploy` 三个终局分支补
  显式通知：分类器否决「附因属中断类，不重派，按失败终局落账」；
  无法重派（缺 prompt/父会话不在）同终局口径；链尽/预检全败「备选
  链尽，按失败终局落账」。非失败 end 零预告；once-guard 已登记的双
  发防御路径跳过预告（不发矛盾口径）。

### Notes

- **harness failed 先行不可抑制留档**：dsh-subagent 的 settle 通知为
  硬编码模板，插件层无法抑制/改写；本批以「预告先于处置到达 + 协议
  告知先到是常态」消灭真空期，不动 harness 通知本身。
- **bindings 刷新机制核查结论**：broker/lib 两半均为 `let bindings =
  {...baseBindings}` 初载合并 + `ctx.on('settings/updated')` 内
  `bindings = mergeRoleBindings(baseBindings, next)` 整表重建（WebUI
  unset 正确回落）；名册简报段闭包直读该 `let` 绑定，函数态每次
  assemble 现调，settings 更新后零额外管道即生效。

### 测试

- 新文件 `test/failure-notice.test.mjs` 11 例：注册形态（函数态
  text/name/order=10/无 complete）、儿童门控两路（parentSession 直达
  + label 兜底）、简报内容全要素与键排序、字节稳定（含渲染器键插入
  序无关直测）、settings 更新免刷新管道；预告 e2e 五例（有链失败
  评估中预告同步到达且先于重派通知 / 无链失败取证中先于附因通知 /
  aborted 有链不谎报评估中 / 链尽终局通知 / 成功 end 零预告）+
  分类器否决终局通知。
- `test/host-parity.test.mjs` 29 → 31：失败同步预告/终局通知双半
  对称源码断言（含「预告先于 attemptFallbackRedeploy 点火」源码序
  断言）；名册简报段 broker 独有注册 + 渲染单一源在 shared 断言。
- 全量 176/176 绿；tsc 干净。未触碰 src/，dist 无需重建。

## [0.2.3-tisitan.17] - 2026-08-30

「备选覆盖复活持久化」批：tisitan.16 Notes 载明的两条已知限制（复活不
重建覆盖 / 重启丢覆盖）闭环——备选条目本体随编排记录落盘，复活同点
重建。测试 159 → 163。

### Fixed

- **continue/forward 复活已完工备选儿童回跳主模型**（生产级，当日真机
  已咬人一次）：`activeFallback` 内存表随完工清理，复活后 waterfall 按
  `bindings[type]` 重绑回主模型（备选儿童被驳回重做 → 回跳主绑定 → 撞
  限额暴毙）。修=重派成功处把备选条目本体写进编排记录
  `record.fallbackEntry`（与 `fallbackAttempt` 同点经 `beginSpawning`
  extra 入账，随 finish→history→台账落盘全链路自然携带），continue/
  forward 复活路径在重建 `sessionTypes` 的同点按记录回填
  `activeFallback`（畸形条目 typeof 守卫，缺字段不重建）。双半同步。
- **进程重启 cold-resume 丢备选覆盖**：同一锚点闭环——台账 round-trip
  后 `record.fallbackEntry` 仍在，cold-resume 走 continue revive 路径
  即重建，不再靠「再死一次触发链上下一条」自愈。

### Notes

- **清理语义不变**：完工/销毁五类清理点照旧清 `activeFallback`；
  `fallbackEntry` 在历史记录里保留无碍（重建只发生在复活时）；链上
  下一跳重派时新占位记录携带新条目，天然覆盖上一跳。
- **序列化面**：台账仍是 v2 `{ version, parents }` 形状；`fallbackEntry`
  落在 parents 分桶的记录字段层（与 `fallbackAttempt` 同层），
  `isLedgerRow` 形状校验不要求该字段，旧台账无字段记录照常载入。

### 测试

- `test/bridge.test.mjs` 29 → 30（重派记录携带 fallbackEntry + 台账
  v2 round-trip 后仍在）；`test/roster-route.test.mjs` 14 → 16
  （continue 复活后 waterfall 保持备选不回跳 / 链上第二跳覆盖第一跳
  且历史保留各自条目）；`test/host-parity.test.mjs` 28 → 29
  （fallbackEntry 入账/复活重建点双半对称源码断言）。
- 全量 163/163 绿；tsc 干净。

## [0.2.3-tisitan.16] - 2026-08-30

「生产事故定案 hotfix」批：主模型 5h 限额 + 备选回跳叠加八连败的真机事故
双根因修复——备选重派运行期防回跳、失败附因取证 cwd 无关化；设置页内置
卡补「载入文件默认」按钮。测试 141 → 150。

### Fixed

- **备选重派模型回跳**（生产级）：`attemptFallbackRedeploy` spawn 时把备选
  `{provider, model}` 写进 agentOptions 只管首帧配置，而 `agent/request`
  waterfall 每个请求无条件按 `bindings[type]` 重绑 provider/model——备选
  儿童运行期被回跳成主模型再死一次，备选链自 tisitan.12 起真机从未真正
  换脑。修=双半新增 `activeFallback` 覆盖表（childId → 备选条目，重派
  成功登记、生命周期五类清理点镜像清除），waterfall 经共享纯函数
  `resolveEffectiveBinding`（preset/shared/misc.mjs）求有效绑定：只换
  provider/model，工种 reasoningEffort/fallbacks 等其余字段原样保留，
  返回新对象绝不原地改共享绑定表。
- **失败附因取证 cwd 无关化**（生产级）：`readArchivedTurnFailure` 默认按
  `projectKey(process.cwd())` 定位项目目录，dsh web 宿主进程 cwd 与用户
  工作区不一致时档案永远找不到——生产上「未读到附因」从未成功过。修=
  默认路径不可读时 `findArchivedLogByChildId` 兜底搜索（preset/shared/
  archive.mjs，双半自动共享）：枚举 sessions 根下全部项目目录按 childId
  检测档案存在性，多命中取 mtime 最新，命中 warn 留痕。

### Added

- **getBuiltinPersona RPC + 内置卡「载入文件默认」按钮**：设置页内置工种
  卡（Sisyphus 除外）persona 覆盖区可一键读取 `prompts/<type>.md` 原文
  填入编辑框（未保存草稿态，点保存才落盘）——覆盖前不再盲写。端点
  `ROLE_KEY_PATTERN` 防目录穿越、磁盘直读绕 promptCache（启动期缺档的
  null 缓存不挡后续同步）、失败结构化返回绝不抛穿 RPC；前端归一纯函数
  `resolveBuiltinPersonaResult`（src/roster-rows.js）。
- **scripts/dump-session.mjs 会话档案取证工具**（`npm run dump:session`）：
  事件流摘要（request/header 打 provider/model、llm/retry 打 retry 序号与
  failure 摘要、turn/end 打 reason/error、tool 类打工具名）+ childId 全
  项目目录搜索定位档案 + 末帧截断容错；帧界扫描与兜底搜索复用共享层
  （preset/shared/archive.mjs 补 export scanZstdFrameRanges /
  findArchivedLogByChildId）。

### Notes

- **activeFallback 是内存表**，进程重启即丢：cold-resume 的备选儿童会回跳
  主模型，若主模型仍故障会再死一次并触发链上下一条备选（自愈收敛）。
  不修——DSH 子代理 descriptor 不携带插件私有状态，无落盘锚点。
- **continue/forward 复活已完工备选儿童不重建覆盖**（编排台账只存
  fallbackAttempt 索引，不存备选条目），复活后回 `bindings[type]` 主模型
  ——已知限制。
- **事故定案**：主模型 5h 限额 + 回跳叠加，八连败全部实为主模型请求
  （挂着备选名头的重派儿童运行期 config 被 waterfall 重绑回主模型）。

### 测试

- `test/host-parity.test.mjs` 22 → 28（activeFallback 写入/清理/消费点
  双半对称源码断言 + resolveEffectiveBinding 行为面直测 + cwd 错配兜底
  搜索三例 + getBuiltinPersona 端点一例）；
  `test/roster-route.test.mjs` 12 → 14（waterfall 运行期防回跳两例：
  备选不回跳 + effort 保留 + 常规派发不受影响 / 清理后覆盖消失）；
  `test/roster-rows.test.mjs` 14 → 15（resolveBuiltinPersonaResult 归一）。
- 分文件实测计数：bridge 29 / orchestration 17 / roster-roles 15 /
  roster-rows 15 / roster-route 14 / panel-format 9 / fallback-rows 7 /
  tool-mask-rows 7 / tool-mask 5 / multi-session 4 / host-parity 28；
  全量 150/150 绿；tsc 干净。
- 取证工具批追加 `test/dump-session.test.mjs` 9 例（摘要规则四例 +
  合成多帧档案行为面两例 + 截断/损坏容错一例 + 解压全灭一例 + childId
  搜索一例，zstdCompressSync 合成档案全 hermetic）；全量 150 → 159。

## [0.2.3-tisitan.15] - 2026-08-30

「共享源 + 薄壳」架构批： tisitan.14 从未推送，本版合并发布。四波落地——
typeOfAgent 工种识别统一（修复 cold-resumed 子代理模型绑定静默失效真
bug）、preset/shared/ 六模块单一源消双写 1,251 行、设置页 persona 覆盖
与角色卡导入导出、src/client.js 巨石拆薄壳。测试 127 → 141。

### Added

- **内置角色 persona 覆盖编辑**（Sisyphus 除外）：设置页每张内置工种卡
  可覆盖编辑 persona（留空 = 用 prompts/ 档案），经 spawn 官方通道注入；
  `withPersonaOverride` 纯函数按部分行显式携带，空文本 = 清除覆盖。
- **角色卡导出/导入 JSON**：每张角色卡一键导出全字段卡片（嵌套
  toolFilter 形状）到剪贴板（失败降级 prompt 复制）；导入经客户端校验
  （脏 JSON/非法键名/重名/非对象等 8 类拒绝分支），白名单剥离未知字段。
- **TreePanel 花名册常驻区**：编排面板底部常驻显示活角色名册（内置 +
  自定义，与 orchestration_status 同源同格式），snapshot RPC 挂
  `rosterLines`，桥未就绪（无编排会话）也恒产出。
- **preset/shared/ 共享源层**：constants / failure / archive / roles /
  orchestration / misc 六模块 635 行单一源，双半（`broker.mjs` /
  `lib/index.js`）import 同一实现；铁律：零 `@deepseek-ai/*` 依赖、
  零 ctx 触碰（node: builtins 可），依赖一律显式注入。

### Changed

- **双半共享源化消双写**：broker 1977 → 1344 行、lib 2035 → 1417 行
  （净消 1,251 行镜像双写）；settings 合并（mergeRoleBindings）、失败
  分类、档案读取、名册路由、工种识别、台账修剪、prompt 预载全部走
  shared 单一源。
- **src/client.js 巨石拆分**：1063 行 → 46 行装配层 + 五模块
  （client-constants / panel-tree / settings-core / roles-editor /
  tool-mask-editor），纯重构零行为变化；手风琴折叠等既有 UI 语义保留。
- **typeOfAgent 工种识别统一**：sessionTypes 活登记优先 + 会话 label
  正则兜底，双半同一实现（shared/misc）；`agent/request` 绑定覆盖与
  DSV4P0813 assemble 识别同走此函数。
- **host-parity 断言范式升级**：字符串对称断言（逐字比源码）退役 →
  shared import 存在性断言 + ESM 同一性（两半同一实例）+ 行为直测；
  `ensurePresetInstalled` 增加 shared/ 存在性校验（见 Migration）。

### Fixed

- **cold-resumed 子代理模型绑定静默失效**（真 bug）：进程重启后 continuable
  子代理冷恢复，sessionTypes 活登记已失、旧识别路径无法从会话 label 还原
  工种，`agent/request` 的绑定/effort 覆盖被静默跳过——typeOfAgent 双根
  识别（登记优先、label 兜底）修复，恢复后按名册正确套用绑定。
- **saveSettings 部分行误清已配绑定**：draft 行只带 persona 等部分字段时，
  旧逻辑把「字段缺失」当「未配」产生整行 5 字段 unset ops，已配的
  provider/model 被一并清空——改为全字段显式携带才写，部分行只写携带
  的字段（roles 行与内置提升行同规）。

### Migration

- **broker/ 归档移位**：根目录 `broker/` TS 参考实现移至
  `docs/legacy-broker-ts/`（停维护声明见其 README，勿改勿引）；外部
  如有路径引用请同步改写。
- **preset 同步完整性**：broker 运行时相对 import `preset/shared/*`，
  `ensurePresetInstalled` 同步 preset 时必须整树复制（含 shared/），
  现按版本标记同步时校验 shared/ 存在性，缺失即报错重同步。

### Notes

- **台账与槽位养护上限**：编排台账 `parents` 分桶超 200 桶时按桶内最新
  updatedAt 修剪（load/save 双点接入）；`currentMap` 超 500 条滞留记录
  时 `beginSpawning` 路径闸拒绝新占位——防长生命周期进程失控泄漏。

### 测试

- `test/orchestration.test.mjs` 14 → 17（enforceCurrentCap /
  beginSpawning 路径闸 / pruneLedgerParents）；`test/host-parity.test.mjs`
  20 → 22（shared 单一源断言组替换字符串对称断言）；
  `test/roster-roles.test.mjs` 13 → 15（部分行 saveSettings 语义 /
  rosterLines 恒产出）；`test/roster-route.test.mjs` 9 → 12（typeOfAgent
  三例：cold-resumed 恢复绑定 / 登记优先于畸形 label / DSV4P0813
  assemble 识别）；`test/roster-rows.test.mjs` 10 → 14
  （withPersonaOverride / personaOverrideSource / buildRoleCardJson /
  parseRoleCardJson）；全量 141/141 绿；tsc 干净。

## [0.2.3-tisitan.14] - 2026-08-30

「自定义角色名册（B 档底座化）」批：工种名单从硬编码七枚举走向 settings
`roles` dict——内置七工种之外可自由定义角色（独立绑定 / persona / 工具
过滤），go_work/forward 按活名册校验路由；子代理人设与工具面改走
spawn 官方通道，`<system-reminder>` 包装退役。测试 89 → 127。

### Added

- **schema**：settings 命名空间 `dsh-my-go` 新增顶级键
  `roles: dict(roleSchema)`（roleSchema = provider/model/reasoningEffort/
  dsv4p0813/fallbacks + persona + toolFilter{allow, deny}）；角色键名在
  schema 层强制 `^[a-z][a-z-]*$`，非法名直接拒绝（`lib/index.js`）。
- **设置页「自定义角色」CRUD 卡片区**（`src/client.js`）：逐行新建/删除/
  编辑角色（绑定字段 + persona + toolFilter allow/deny），键名客户端
  即时校验与服务端 schema 同则；操作纯函数抽 `src/roster-rows.js`
  （零依赖，与 client bundle 内联同源）。
- **orchestration_status 活花名册区**：输出尾部新增当前可派名册
  （内置七工种 + roles 自定义，sisyphus 不入可派名册），Sisyphus
  派工以活名册为准。
- **设置页全卡片手风琴折叠**（本版收口追加）：Sisyphus / 内置七工种 /
  自定义角色 / 工具屏蔽卡默认收起，卡头常显标题 + muted 摘要行 +
  折叠指示符，点击切换（纯视图态，不持久化、不进 settings）；内置卡
  摘要纯函数 `builtinSummaryText`（`src/roster-rows.js`），自定义角色卡
  复用 `roleSummaryText`，新建角色成功后该卡保持展开。

### Changed

- **go_work/forward 名册路由**：`agent`/`target` 参数从固定 enum 改为自由
  string，按活名册校验——未注册名结构化报错并附当前可用角色清单。
- **persona/toolFilter 正统 spawn 通道**：子代理人设与工具过滤改走
  `SubagentStartRequest.persona/toolFilter` 官方字段（descriptor v2
  持久化、冷恢复原样重放）；首条 prompt 的 `<system-reminder>` 人设
  包装退役，prompt 保持纯任务文本。内置工种 persona 同走该通道
  （prompts 缺档时兜底文案）。
- **toolFilter 缺名降级**：派发前按活工具目录过滤缺名（warn 留痕），
  绝不把假名塞进 spawn；allow 全部为缺名时丢弃 toolFilter，子代理
  回落全量目录。
- **bindings 合并白名单泛化**：settings 合并/热更不再按内置工种名
  硬编码白名单，roles 名册内任意角色键同等参与合并。

### Migration

- **旧顶级工种键自动迁移**：装载与 settings 热更时检测旧顶级七工种键
  → 整行无损搬入 `roles` dict（含 fallbacks 全字段）→ 旧键废弃；幂等
  （迁移后形状再检测返回 null，不重复搬）；roles 已有同名行时旧顶级行
  覆盖（旧顶级是权威来源）；迁移失败保留原配置仅 warn，apply 不中断。

### Notes

- **toolFilter 只宜写核心稳定工具名**：DSH spawn 契约对 toolFilter 缺名
  直接失败（broker 已在派发前按活目录过滤降级兜底），且 toolFilter 随
  descriptor v2 持久化、冷恢复按原样重放——重启后工具集变化
  （如 MCP 未连接）会使冷恢复 NOT_RESUMABLE。

### 测试

- 新增 `test/roster-roles.test.mjs`（roles schema/键名校验/迁移幂等/
  合并/apply 容错/load·saveSettings 13 例）、`test/roster-route.test.mjs`
  （go_work/forward 名册路由 + spawn 通道 + toolFilter 降级 + 花名册区
  9 例）、`test/roster-rows.test.mjs`（角色编辑器纯函数 10 例，含手风琴
  摘要 `builtinSummaryText`）；`test/host-parity.test.mjs` 增 spawn 通道/
  名册路由/save·loadSettings roles 6 例（14 → 20）；全量 127/127 绿；
  tsc 干净；`npm run build:client` 重跑产物字节稳定。

## [0.2.3-tisitan.13] - 2026-08-29

「tool-mask 配置化 + 可视化配置 UI」批：工具屏蔽清单从硬编码走向 settings，
设置页新增双列表编辑器；preset 端硬编码的私有工具名清单连锅端清空。
当独立公开项目对待——源码零私有部署痕迹。

### 新增：工具屏蔽（Tool Mask）配置化

- **schema**：settings 命名空间 `dsh-my-go` 新增第 9 个顶级键
  `toolMask: { deny: string[] }`（`lib/index.js`，与 8 工种键平级）；
  saveSettings 对 `deny` 空数组/缺失转 unset（=不屏蔽），非空原样 set。
- **preset 半**：`preset/tool-mask.mjs` 的 `DEFAULT_DENY` 清空为 `[]`
  （原 7 个 `mcp__vcp__*` 私有示例名全部移除，注释仅保留格式示例）。
  屏蔽清单按三级优先级解析（`resolveDeny()` 纯函数，可测）：
  1. `config.deny`（agent.cordis.yml tool-mask 行显式覆盖，最高；空数组=
     显式屏蔽空，不回落）；
  2. settings `toolMask.deny`（设置页写入；apply 时经 `ctx.get('settings')`
     读一次即可）;
  3. `[]` 空默认。
- **生效时机 = 新会话**：preset 挂载即会话组装时解析一次，不监听
  settings/updated；屏蔽变更只对之后新建的会话生效，当前会话不受影响。
- **保留逐名 try/catch**：缺席/保留名 restrict 抛错按名跳过（warn），
  不炸 preset 挂载；新增一行汇总日志（屏蔽数量 + 来源）。

### 新增：设置页「工具屏蔽」双列表编辑器

- **listTools RPC 走通**（无降级）：`ctx.get('tools')` 拿到 ToolRuntime 服务
  （cordis 服务名 `tools`），`schemas()` 无参即全局层视图——恰是 tool-mask
  restrict 能 deny 的面（MCP 已连工具、DSH 内建工具、lib 半编排工具）。
  保留名 `run_code`（唯一保留传输，不在过滤层注册）服务端过滤不返回；
  服务缺席/异常回落空名单（`ok:true`），前端降级为纯编辑器不阻塞保存。
  注意花名册是**快照**：MCP 动态连接后需重开设置页刷新。
- **UI**（`src/client.js`，置于 8 工种卡片之后）：左「当前可用工具」（RPC
  拉取，减去已屏蔽，附名称过滤框）/ 右「已屏蔽」，屏蔽→/解除←移动按钮；
  右列不在当前花名册的条目带「未连接」灰徽章（保留不删，MCP 重连后即被
  屏蔽）；花名册外工具可手填添加；提示文案「屏蔽仅对新会话生效，当前会话
  不受影响」「保留工具不可屏蔽」。
- **数据流**：纳入既有 draft + saveSettings 通路，空列表提交 `[]`
  （host 半转 unset）；操作纯函数抽 `src/tool-mask-rows.js`
  （normalizeDenyList/blockTool/unblockTool/availableTools/denyEntries，
  零依赖，与 client bundle 内联同源）。

### 迁移指引

- **原依赖 `DEFAULT_DENY` 私有清单的部署**（tisitan.12 及之前）：升级后
  默认不再屏蔽任何工具——请在设置页「MyGO 编排 → 工具屏蔽」重新配置屏蔽
  清单（或 agent.cordis.yml 的 `config.deny`）。

### 附记

- 泛化清洗批 b5ba753（敏感措辞/文档对账）已先行单独 commit，本批为其
  代码侧收尾：最后一处硬编码私有工具名清单清零。

### 测试

- 新增 `test/tool-mask.test.mjs`（解析优先级三态/DEFAULT_DENY 泛化断言/
  apply 容错与日志 5 例）、`test/tool-mask-rows.test.mjs`（编辑器纯函数
  7 例）；`test/host-parity.test.mjs` 增 toolMask schema/空数组 unset/
  listTools mock 注册表 4 例；全量 89/89 绿；`npm run build:client`
  重跑产物字节稳定；tsc 干净。

## [0.2.3-tisitan.12] - 2026-08-29

「备选链（fallbacks）+ UI 优化」批：子代理模型终局失败按链序自动重派备选，
编排面板与设置页配套升级。`preset/tools/broker.mjs` 与 `lib/index.js` 同构实施。

### 新增：备选链（fallbacks）

- **schema**：每工种 settings 可配 `fallbacks: [{provider, model}]` 数组；
  链首为该工种 `provider`/`model` 主绑定（attempt 0），其后每条备选依次为
  attempt 1、2、…。
- **触发**：子代理模型**终局失败**时按链序自动重派——404/模型不存在类立即败，
  429/5xx/超时类等 DSH 内建重试耗尽后，经错误分类器放行才切。abort/用户中断/
  dispose 绝不切换；失败附因档案读不到时保守切换（warn 注明「未读到附因，
  保守切换」）。
- **重派语义**：同 prompt、同父会话、同工种自动重派，`agentOptions` 覆盖为
  备选条目；不占新槽位（原槽位语义内换键）、不入队、不与单线阻塞/队列交互；
  attemptIndex 严格递增、链尽即止（绝无无限循环），全部失败落既有失败历史
  并保留失败附因。
- **预检**：无效备选条目（缺 model 等）预检跳过 + `console.warn`，尝试下一条。

### 新增：设置页备选链可视化编辑器

- 每工种卡片内置备选链编辑器：逐行编辑 provider/model、↑↓ 调整链序、
  模型下拉按所选渠道过滤，与 YAML 手工编辑等价。

### 优化：编排面板 UI

- 标识符截断 + 悬浮显示全量；区块计数徽章；空态折叠；状态色条；工种彩色
  徽章；相对时间；`[备选 n/m]` 高亮徽章；30s 自刷新。

### 优化：设置页卡片化

- 工种角色说明、字段 inline hint、文案统一「跟随…」句式、Sisyphus 兜底
  语义说明。

### 已知限制

- 备选重派的历史结论措辞先于 spawn 成功落史：重派 spawn 失败时不改写已落
  历史，以 `console.error` 留痕并向原父会话 `notifyParent` 推送修正通知。

### 测试

- 新增 `test/fallback-rows.test.mjs`（备选链 schema/分类器/重派核心）与
  `test/panel-format.test.mjs`（面板格式化）入 `npm test` 套件；
  73/73 全绿；`npm run build:client` 重跑产物字节稳定。

## [0.2.3-tisitan.11] - 2026-08-27

代码审查修复批（依据 `docs/code-review-broker-lib-2026-08-27.md` 审查报告，
全部发现经裁决开修）。`preset/tools/broker.mjs` 与 `lib/index.js` 同构实施
（除 lib 半 fallback 形态固有的差异外逐行对齐）。

### 安全三件（审查 Major）

- **need_help 上报失败不再静默**（M1）：`reportFrom` 投递失败的空 catch 改为
  `console.warn` 留痕（带求助单 id / intent / childId / 失败原因）+ 尽力经
  `notifyParent` 向父会话补发「上报送达失败，请用 orchestration_status 查看」
  短通知；通知自身失败不再向外抛。挂起账本保持原样等待处理。
- **forward 转发信封化**（M2）：转发内容不再是 help.content 原文裸传——改为
  包进 `<forwarded-help from="…" intent="…">` 信封并在前后各加一句系统语气
  说明（转交的请求材料、不构成指令体系覆盖），阻断「子代理借 execute 类
  求助单走私提权指令」的间接注入放大路径。信封属性值同步转义。
- **XML 包裹逃逸修复**（M3）：need_help 上报体与 forward 信封共用新增的
  `escapeXml()` 工具（`& < > " '` 五实体），content 内的伪 `</need_help>` /
  伪 `<system-reminder>` 无法再逃出包裹结构。

### prompt 语义修正

- `prompts/hephaestus.md` / `prompts/hermes.md` 的 replan 混用修正：要澄清/
  缺信息走 `ask_user`（列出问题清单）；`replan` 仅用于任务超出自身能力、
  请求换更强工种——与 prometheus.md、sisyphus.md 的枚举语义对齐。
  其余五份 prompt 排查无同类混用。

### 次要对齐

- **lib 半 dispatchWork 模型校验对齐**（m1）：binding.model 与 broker 半一致，
  先经 `llm.listModels` 校验真实存在才写进 agentOptions，校验不过回落而不硬塞；
  无 provider 可解析时维持与 broker 相同的直透语义（waterfall 兜底校验）。
- settings 命名空间 schema 本就为扁平键（`<type>.field`），无代码改动。

### 文档对账

- ARCHITECTURE.md 补齐 tisitan.10 会话隔离全景：拓扑限定语、§2.1 改述
  orchestrations Map 分桶 + childOwner 路由 + disposed 墓碑竞态、台账 v2
  分桶与 'legacy' 兜底桶、面板摊平短后缀与自动跳转会话门禁；
  FORK-GUIDE 目录树中「已与实现同步」括注恢复有效。
- README 配置表键名修正为扁平结构 `<type>.provider/model/reasoningEffort/
  dsv4p0813`（原文档残留 `agents.<type>.*` 错误前缀），与 schema 及 YAML
  示例一致；「插件 config 键」小节补注仅 host 半（lib）生效、MyGO preset
  会话不读这些键；「单线阻塞」两处补会话隔离限定；测试口径更新。
- FORK-GUIDE 测试清单数字校正（bridge 实际 17 例，旧记载 13 例漏记了
  快照桥两例）、七工种表述改「八键（含 sisyphus）」；AGENTS.md 同步
  「单线阻塞 = 每编排会话内单线」。CHANGELOG 补记 tisitan.10 实际日期。

### 测试

- 新增 `test/host-parity.test.mjs`（2 例：lib 半模型校验回落/直透语义）；
  `test/bridge.test.mjs` 新增 2 例（reportFrom 失败 warn+通知且求助单保留、
  forward 信封形状与 `</need_help>` 逃逸阻断）。node:test 全量
  14 + 17 + 4 + 2 = 37 例全绿；`tsc --noEmit` 干净。

## [0.2.3-tisitan.10] - 2026-08-27

**多会话编排隔离**（用户实测发现：会话1编排时，会话2的 go_work 被全局
单线阻塞排队）。`preset/tools/broker.mjs` 与 `lib/index.js` 同构实施。

### 根因

MyGO preset 的 broker 是 standing-scope 全进程单例（每进程挂载一次、所有
会话共享），`new Orchestration()` 只有一份——「单线阻塞」实际是全进程
单线，而非每个编排会话各一条流水线。

### 改造

- **流水线按会话拆分**：`orchestrations = Map<parentSessionId, Orchestration>`
  惰性创建；每个 Sisyphus 会话独立的 current/queue/helpRequests/history，
  会话销毁（session/disposed）时整条流水线回收。新增 `childOwner`
  （childId→属主会话）路由表，所有工具与生命周期事件按调用方精准路由。
- **台账持久化升级 v2**：按 parentSessionId 分桶落盘；v1 旧档载入
  'legacy' 桶，供 continue/forward 全局扫描兜底命中。
- **快照桥形状升级**：`{ seq, parents: { [pid]: {...} } }`，lib RPC 端点
  两侧形状严格一致。
- **面板多会话并列**：摊平所有会话的运行/队列/求助/历史，多会话时附
  会话短后缀区分。
- **自动跳转会话门禁**：只跟随「当前打开会话」的子代理（读
  `sessions.list.getSnapshot().current`），拿不到可靠 id 时退化为
  单 parent 才跳——多会话下绝不把用户拽去别的会话。
- **spawning 竞态归因加固**：多会话并行派发可能出现多个 in-flight
  spawning，恰有一个可归因时才绑定，多个则留痕忽略（绝不乱绑），
  靠 disposed 宽限期兜底清槽。

### 测试

- 新增 `test/multi-session.test.mjs`（4 例：A 忙 B 不排队、childOwner
  路由、session 销毁隔离、revive 重登记属主）；`test/bridge.test.mjs`
  适配新快照形状。npm test 33/33 绿，tsc 通过。

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
  `agent.cordis.yml` 行 `config.deny` 覆盖；原 7 个 `mcp__<your-origin>__*` 名字
  保留为默认示例并标注「按你的环境裁剪」；逐名 try/catch 静默跳过语义
  不变。个人环境命名注释改写为中性描述（含 `agent.cordis.yml`）。
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

- **tool-mask 同步**：新增 `preset/tool-mask.mjs`（配方取自一个既有本地 preset），
  在 preset 作用域屏蔽角色记忆工具与外部桥接共 7 个
  `mcp__<your-origin>__*` 工具——对 Sisyphus 与全部子代理同时生效（preset scope 覆盖
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
