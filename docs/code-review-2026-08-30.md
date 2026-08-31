# dsh-my-go 总审查报告（2026-08-30）

## 头部元信息

| 项 | 值 |
|---|---|
| 日期 | 2026-08-30 |
| 版本 | 0.2.3-tisitan.19 |
| 基线 | npm test 179/179 绿 |
| 方法 | 五棒流水线（explore 全量勘察 → hephaestus 运行时深审 → hephaestus 前端深审 → explore 一致性核查 → librarian 文档对账）+ 真机事故淬炼 |

## 总评

结构健康度高于预期——测试 179 对账精确闭合、shared 铁律 6/6 满分、零孤儿文件、零隐私泄漏、双半 30+ 机制逐对齐、CHANGELOG 六节 18+ 条声明抽验全部落实（含 dist 字节级吻合）、React 生命周期与注入面干净、tisitan.16/17/18/19 新机件独立复审通过。**零 Critical。**

## Critical

零 Critical。

## Major（×2）

### 棒2-M1 双半台账双写竞态

`lib/index.js:1269` session/disposed→scheduleLedgerSave 以启动时陈旧快照整体覆写台账文件，可静默回退 broker 半的新鲜历史（双半同挂默认部署 + 重启 + 任一会话删除即触发）。

修复 = 快照桥（`Symbol.for('dsh-my-go.snapshot')`）存在时 lib 台账只读化。

### 棒3-M1' 设置页 null-gate 不完整

`settings-core.js:60-73` set() 与 `:79-81` setChain() 无 null-gate，draft=null（loadSettings 失败）时可造半截 draft 并解锁「立即保存」（`:327`），与 `:84-85` 注释自述防线直接矛盾；对照组 setDeny `:86-89` / setPersonaOverride `:93-96` / editRole `roles-editor.js:77-79` 均有完整 gate。

修复 = 补同款 null-gate + makeSelect 支持 disabled。

## 中等（×10）

### 棒2-Z1 once-guard 盲窗

双发 end 落在 pickFallbackEntry await 窗口（`broker:1289` 含真实 listModels 网络 I/O）→ 重派静默放弃（`broker:1306-1311` 仅 console.warn），主流程收过「评估中」预告却永等不到终局口径；`bridge.test.mjs:862` specs===1 以错误理由把降级钉死。

修复 = once-guard 已登记的后续 end 按迟到忽略不 finalize，或 await 返回后发现记录非 current 时补发终局口径。

### 棒2-Z2 spawn 解析前回跳残留

activeFallback.set 在 await startContinuable 之后（`broker:1345-1354`），窗口内重派儿童请求经 typeOfAgent label 兜底回跳主模型——tisitan.16 同款机制的最后存活窗口。

修复 = spawn 前登记 pending 备选表供 waterfall 匹配。

### 棒3-Z1' loadSettings 失败 UI 完全静默

`settings-core.js:43-47` 仅 setDraft(null)，加载中与失败同态不可分。

### 棒3-Z2' roles 投影重建静默删除未触碰脏行

`roles-editor.js:53-76` 仅投影行重建 + `roster-rows.js:44` 过滤，违背 explicit-carry-only 精神。

修复 = 仿 builtinPart 透传拒绝行。

### 棒4-Z1 sisyphus.md 失败协议缺第三预告分支

`broker:1464-1465` 实发三分支，`prompts/sisyphus.md:70-78` 只写两支；CHANGELOG .18 明写三分支，prompt 层漏同步。

### 棒4-Z2 dsv4p0813 UI 文案作用域误导

`settings-core.js:254` 未说明执行面仅 broker 半，lib-only 形态零效果零提示。

### 棒4-Z3 sisyphus 卡 dsv4p0813 死开关

assemble 识别面 `broker:495-498` 恒不命中 sisyphus 会话，任何配置不生效。

### 棒4-Z4 createRole 漏拦内置键名

`roles-editor.js:81-90` 未查 builtinKeys → 手建 sisyphus/hermes 同名行入库后 UI 不可见不可删（`roster-rows.js:44` 滤出 rows），且空白行可静默 unset 已配字段；导入路径有拦（`roles-editor:107`）手建无拦，防护不对称。

### 棒4-Z5 engines 声明 >=20 与 zstd 实需 >=22.15 不符

`archive.mjs:11` zstdDecompressSync 于 Node 22.15/23.8 引入——旧 Node 下附因取证静默失效、dump-session CLI 崩。

修复 = 一行 engines 改 >=22.15。

### 现场-Z3（审查途中 Nova 真机擒获）

continue b79b127f 报 unknown-id「不在编排台账」，但台账文件与 broker status 视图均有该记录（三方矛盾）；continue 同桶同年代的 550a6669 成功 → 记录特异非系统性。另台账文件存在空 parentSessionId 的 56 条记录桶。移交修复棒诊断。

## 低（×19）汇总

锚点从略，全文各棒报告在案。

- **棒1 ×8**：normalizeRoleToolNames 死码 `roster-rows.js:58` / describeAgent+resolveEffectiveBinding+encodeSegment 再导出无消费者 / ROLE_KEY_PATTERN 双处定义 `roster-rows.js:16`≡`constants.mjs:20` / AGENT_TYPES 同名异义 / 六 peerDeps 零 import / build 用 bun 当跑器 / peer rc.6 vs dev rc.8 偏斜 / INTENT_LABELS 可降非导出
- **棒2 ×7**：roles.sisyphus 只写死数据 / 跨会话 continue 抢属主 `broker:231-242`+`765-767` / 双半 model 校验三处不对称 `lib:1148,1211` vs `broker:1163-1199` / 附因全灭时无链路径静默 `broker:1243-1247` / 废弃面 dropQueuedFor+nextId 未用 import+promotionStateFor steps 计数器 / DSV4 开关时序边界 / promotion 零行为测试
- **棒3 ×6（减 2）**：链内空行持久化语义 / 保存不回写归一化 / slots 三处无反注册 `client.js:48-51`+`panel-tree.js:322-338` / build 日志 UTF-16 码元冒充字节 `build-client.mjs:36` / listModels 畸形响应炸整页 `settings-core.js:48-50,171` / 假备选徽章 `panel-format.js:52-60`
- **棒4 ×5**：「数秒内必到」无看门狗 `broker:1234` listModels 无超时 / 内置 roles.toolFilter 无 UI 编辑口 / `settings-core.js:235` 注释行号越界 broker 实仅 1473 行 / `FORK-GUIDE.md:16` client.js 46→57 / `CHANGELOG.md:209` 裸词 glm

## 信息（×14）汇总

- **棒1 ×4**：tsconfig 只校验归档 TS 生产 JS 零 typecheck 覆盖 / dist gitignored 但 exports 指向它 / .npm-cache 已正确 ignore / fallback-rows 收口干净
- **棒2 ×8 中挑要**：need_help 挂起语义自洽非复发 / readArchivedTurnFailure 同步 I/O 性能注记 / 竞态归随路径不回填 sessionTypes 有界自愈 / go_work output.render 双半不一致 / Map 台账边界无实质发现
- **棒3 ×7 中挑要**：`roster-rows.js:37-39` 注释失真 / `settings-core.js:63-70` 死分支 / dist client.core.js 进 npm 发布包等
- **棒4 ×3**：.15 行数声明不可证伪但链路自洽 / prometheus 荣誉约束 / files 含 docs

## 文档漂移清单（棒5 Part 1，18 处实测锚点）

### ARCHITECTURE.md（8 处）

| # | 级别 | 锚点 | 漂移内容 |
|---|---|---|---|
| A1 | 中 | §2.1:58-65 | OrchestrationState 旧形状（实况 currentMap Map cap500 + helpRequests Map，`shared/orchestration.mjs:22-24,209`） |
| A2 | 中 | §3:214-217 | 设置页四字段与 §2.2:100-102 五字段同文档自相矛盾，且 tisitan.13-19 UI 增量缺席 |
| A3 | 中 | §2.3:120-134 | DSV4P0813 未注明仅 broker 半 |
| A4 | 低 | §2:44-48 | 工具清单缺 orchestration_status / list_subagents |
| A5 | 低 | §2.1:93 | 档案路径应 encodeSegment(childId) |
| A6 | 低 | §3:202-207 | 面板缺花名册常驻区 |
| A7 | 低 | §4:219-227 | 交付物表缺 lib/src/test/scripts |
| A8 | 信息 | §1 | 未提 roles 名册扩展 |

### FORK-GUIDE.md（5 处）

| # | 级别 | 锚点 | 漂移内容 |
|---|---|---|---|
| F1 | 中 | :55 | 「tisitan.18/176」实为 .19/179，与自身测试表矛盾 |
| F2 | 低 | :103-125 | 测试树四处例数过时，且缺 failure-notice / dump-session 行 |
| F3 | 低 | :16 | client.js 46→57 |
| F4 | 低 | 全景图 | 左框四行错位、行宽参差 |
| F5 | 低 | scripts 树 | 缺 dump-session.mjs |

### README.md（5 处）

| # | 级别 | 锚点 | 漂移内容 |
|---|---|---|---|
| R1 | 中 | :4 | meta version tisitan.15 落后 4 版 |
| R2 | 中 | :339 | 「159 例」与 :318「179 例」同文件矛盾 |
| R3 | 低 | | 46→57 |
| R4 | 低 | | scripts 树缺 dump-session |
| R5 | 信息 | | Node 门槛未标 zstd 实需 |

## 健康面声明

- 通知同步段零 await 实证
- 备选链清理对称
- 多跳台账一致性（bindChild 继承链）
- 剪枝完备（LEDGER_PARENTS_CAP 200 + CURRENT_MAP_CAP 500 双点覆盖）
- shared 六模块纯函数逐检通过
- tisitan.16 回跳修复与 tisitan.17 复活重建双测试锁定
- tisitan.19 链编辑器独立复审通过
- schema↔UI 零逃逸字段
- 七工种工具名零漂移
- 隐私扫描 CLEAN

## mock 盲区清单

- 双半同进程共 DSH_HOME 集成测试不存在（棒2-M1 漏网根因）
- 双发 end 窗口真实环境比 mock 宽（listModels 网络往返）
- 请求先于 spawn resolve 时序无模拟（棒2-Z2）
- parent.inject 真实语义未模拟
- subagent/end 载荷字段漂移无防御测试

## 基建观察（今夜新擒获）

上游流中断伪装成功——glm 额度耗尽前后，长输出回合的流被掐断，错误文本「上游响应超时，流已中断」注入消息正文，回合却按成功收尾，备选链（失败终局才触发）对此类失明；两个 librarian 回合同一位置被掐断实证。

另：tisitan.13 已治 turn/end 级失明（崩溃伪装 200），流级伪装是上一层同族问题。

## 修复优先级建议（供主人裁决 tisitan.20）

1. 棒2-M1 台账竞态
2. 棒2-Z1 协议空等
3. 棒3-M1' null-gate
4. 棒4-Z5 engines 一行
5. 棒4-Z4 createRole 守卫
6. 棒2-Z2 spawn 前回跳
7. 棒4-Z1/Z2/Z3 文档与 UI 文案包
8. 棒3-Z1'/Z2' 前端中等
9. 低值打包
