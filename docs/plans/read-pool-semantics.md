# dsh-my-go 读平面并行池：归因与失败语义设计（二期 2.1）

> 交付：Hephaestus 设计批（二期步骤 2.1，规划 docs/plans/next-gen-architecture-0.4.0.md :222-230）。
> 纯设计文档，零代码改动。行号一律以 **0.4.0-tisitan.0 工作区（含一期未 commit 成果）** 为准——
> 一期 1.5 施工后 end-attribution.mjs 出口已扩为九个，规划文档内引用的部分行号相对本批次发生平移，
> 本文行号均为实测重锚后的当前值。
>
> 已裁决参数（本文直接采用，不再展开论证）：
> - **D5**：`config.readPoolSize ?? 1`，1=现状=关闭，2~3 启用，>3 钳制 3（规划 :279-280）；
> - **D7**：looker 归**写 lane**（规划 :420，默认写保守）；
> - **D8**：自定义角色默认写 lane，**不可配**（规划 :421）；
> - **D9**：lane-aware skip——队首 lane 满则跳过找有空位的，lane 内仍 FIFO（规划 :422）。
>
> 本文新提出的待拍板项编号接续规划 D1~D15，记 **D16~D20**（§七），不擅自拍板。

---

## 〇、实施状态（二期 2.6 收口时标注——本文全部决议均已落地）

> 状态基准：二期 2.1~2.5 施工完成、2.6 收口（版本保持 0.4.0-tisitan.0 未 bump，
> tisitan.4 段 Unreleased 口径，待基线关窗后由主编统一定稿）。测试编号对应：
> T1~T9 = 本文 §六规划项；S 系列 = `test/orchestration.test.mjs` 泳道段；
> E 系列 = `test/end-buffer.test.mjs`；L 系列 = `test/lane-scheduling.test.mjs`。

| 决议/规格 | 落地位置 | 测试锚点 |
| --- | --- | --- |
| §1.1 lane 判定表（D7/D8） | orchestration.mjs `laneOf` | S:laneOf 判定表 |
| §1.2 容量语义/钳制（D5） | orchestration.mjs `clampReadCapacity`/`capacityOf`；broker `READ_POOL_SIZE` 接线 | S:readCapacity 钳制；L:T1 |
| §1.2 isBusy 复合化 + 三调用点迁移 | orchestration.mjs `isBusy`；broker advanceQueue/dispatchWork/复活闸 | S:默认容量逐点等价；L:T2/T7 |
| §1.3 snapshot 形状（D20 一步到位） | orchestration.mjs `snapshot`；broker 双工具渲染；lib `trimSnapshotForPanel`；src/panel-tree 三处 | S:currentRecords 断言；L:T3 正向形状断言；host-lib-fixes |
| §2.1 lane-aware skip + 循环填池（D9/D18） | broker `advanceQueue` global-scan；orchestration `dequeueById` | L:T4/T5 |
| §2.2 直派补位（D19，纵深防御） | broker dispatchWork 成功路径 advanceQueue | L:T8（无可观测独立效果，探针证实删除不红，属保险） |
| §2.5 facts.lane 事实字段（D18） | end-attribution `done()` | end-attribution:facts.lane 断言 |
| §4.3 E2 方案 A：缓冲重放 + 占位归因退役（D16 cap 16/grace 键） | broker `bufferEnd`/`claimBufferedEnd`/`auditStaleSpawningPlaceholders`；end-attribution E2 收窄 | E:T1~T5；end-attribution:E2 退役断言 |
| §5.1 R2.3 复合键 | broker 重派 label 内嵌 spawnToken | E:T6 |
| §六 T3 写平面地基探针 | 变异实测：删 dispatchWork 容量判定 fail=5 | L:T2 必红 |
| §五/§六 三红线探针 | V1 缓冲闸失效/V2 去 token/V3 审计失效 | E:T1~T3 全咬中 |
| §八退化判据（容量 1 = 全局单线） | orchestration `isLaneFree` 退化分支 | S:退化口径；L:T6 |

> 本文档与代码的已知解释性偏差（均已报备）：§2.5 的 facts.lane 已按 D18 裁决落为
> 纯事实字段（advance 决策不受影响）；§2.2 D19「直派填池」经不变量论证为纵深防御
> （正常路径由 end→advance 覆盖），实现保留、测试降级为无害性断言（L:T8）。

---

## 一、泳道模型

### 1.1 lane 判定表（落地为纯函数 `laneOf(agentType)`）

| lane | 工种 | 依据 |
| --- | --- | --- |
| `read` | explore、librarian | 设计点名（规划 :240-241） |
| `write` | hermes、hephaestus、prometheus、oracle、looker（D7）、自定义角色及一切未知名（D8） | 规划 :240-241 + 已裁决 |

决议：
- lane 判定是 `agentType → lane` 的**纯函数，挂载期不变**（D8 明确自定义角色不可配 ⇒ 不存在运行期改判）。队列 work（enqueue 记录，orchestration.mjs:56-61）**不新增 lane 字段**，消费时即时计算；currentMap 记录**新增 `lane` 字段**，beginSpawning（orchestration.mjs:65-79）时算好写死。
- 记录携带 lane 快照 vs 即时计算，两者在「agentType 世代内不可变」前提下恒等价；写字段是为 snapshot/展示/测试断言提供免计算事实（重派/复活经 `{...record}` 自然继承，orchestration.mjs:90/:193，lane 无需任何继承特判）。

### 1.2 容量语义与 isBusy 家族（orchestration.mjs:54）

- **占槽口径与现状一致：在 currentMap 即占槽**，不区分 spawning/waiting/running 状态（现状单线下 waiting 记录同样占唯一槽，isBusy=size>0）。`laneCount(orch, lane)` = currentMap 内 `record.lane === lane` 的记录数。
- `isLaneFree(orch, lane)`：`laneCount(orch, lane) < capacityOf(lane)`。`capacityOf('read') = config.readPoolSize`（挂载期读一次、钳制 1~3，与 REPORT_EXT 同律不做运行时切换，broker.mjs:161-164 同款注释纪律）；`capacityOf('write') = 1` 恒定。
- **isBusy() 旧语义在并行下失效**：`currentMap.size > 0`（:54）在 readPoolSize≥2 时不再等价于「满」——read 在飞 1 条时 size>0 为真，但 read lane 未满且 write lane 空，并行是**设计内状态**而非忙。因此 isBusy 的三个调用点必须全部迁走，逐点迁移目标见 §2.4；isBusy 本体保留为「read 满 or write 满」复合判定，仅供测试与过渡断言，**任何编排决策路径不得再消费它**。
- CURRENT_MAP_CAP（constants.mjs:26，orchestration.mjs:206-219）保持全局兜底闸，**不 lane 化**（规划 :242 已定）；HISTORY_CAP 不变。

### 1.3 snapshot 形状（orchestration.mjs:38-45）

- `current` 从「取第一条」（:40）改为返回**全部** current entries（规划 :239-240 已裁决形状变更）。迁移口径建议**一步到位删除 `current` 字段、新增 `currentRecords: [...]`**，不做双字段过渡（见 §七 D20）。
- 消费面三处同批改：orchestration_status 渲染（broker.mjs:1357-1361）、list_subagents 拼装（broker.mjs:1406 `s.current ? [s.current] : []`）、快照桥 host 半 RPC 消费（broker.mjs:324 + lib/index.js 面板接口）——归步骤 2.5，本文只锁定形状决议。

### 1.4 泳道原语语义对照表（现状 → 泳道化后，orchestration.mjs）

| 原语 | 现状 | 泳道化后 |
| --- | --- | --- |
| isBusy（:54） | size>0 | 保留为复合判定（read 满 or write 满），决策路径禁用 |
| beginSpawning（:65-79） | isBusy 拦截在外部 | 接收 lane 写入 record.lane；容量判定在调用方（dispatchWork） |
| bindChild（:81-94） | 占位换键 | 不变（lane 随 `{...record}` 继承） |
| finish（:127-146） | 挪史即释放唯一槽 | 挪史即释放**该记录 lane** 的槽（同一次 delete，无新逻辑） |
| revive（:188-199） | history 回 currentMap | 不变；复活闸在调用方按 `laneOf(record)` 判空位（回槽即回原 lane） |
| suspend/resume（:102-125） | waiting 占唯一槽 | waiting 占**该 lane** 槽（口径与现状一致：在 currentMap 即占槽） |
| dequeue（:96-100） | shift() 队首 | 保留；另增 `dequeueById(work)` 供 lane-aware skip 按 id 出队（§2.1） |
| requeueHead（:160-164） | unshift 队首 | **不变**（§2.3） |
| enforceCurrentCap（:206-219） | 全局 500 兜底 | 不变 |

---

## 二、调度语义（D9 已裁决：lane-aware skip）

### 2.1 advanceQueue 新算法（broker.mjs:707-724）

```text
advanceQueue(orch, parentHint):
  loop:
    work = 队列自队首起第一条满足 isLaneFree(laneOf(work.agentType)) 的记录
    if 无: break
    orch.dequeueById(work)          # 按 id 出队，被跳过者原地保留、序不重排
    （埋点 queue-pop 照记，broker.mjs:713）
    void dispatchWork(work.*, ..., work, orch).catch(回补重试链不变 :718-723)
```

语义锁定：
- **lane 内 FIFO**：同 lane 的两条 work 相对序永不因 skip 改变（skip 只让「其它 lane 的」work 越过它们）。
- **全局序可观测**：被跳过的 work 留在原位；orchestration_status 的 queue 渲染（broker.mjs:1362）仍是队列字面序，不排序不改名。
- **循环填池**：单次 advanceQueue 派发直到无可上岗 work 为止（现状单线一次 end 只放行一个，因 isBusy 恒拦）。循环安全性论证：dispatchWork 的同步段（broker.mjs:792-812，含 beginSpawning 占位落表）无 await，`void dispatchWork()` 返回时占位必已入 currentMap，下一轮 `isLaneFree` 立即可见；JS 单线程下循环体之间无交错。**回补 catch 内不得再递归 advanceQueue**（现状 :718-723 的失败链已满足：requeueHead + scheduleQueueRetry 定时器驱动）。
- 派发失败的回补三件套——requeueHead unshift 队首 + 线性退避定时器 + 3 次放弃落 failed 历史（broker.mjs:673-697、orchestration.mjs:160-185）——**语义零变化**（规划 :251「回补重试语义不变」）。skip 与回补正交：回补队首的 work 若其 lane 满，下轮 advance 照常 skip 它、放行其它 lane。

### 2.2 推进触发点清单（并行下的增补）

| 触发点 | 现状 | 并行下 |
| --- | --- | --- |
| end 各出口唯一决策点（broker.mjs:2116-2118） | advanceQueue(orch) | advanceQueue(orch)（global-scan，见 2.4） |
| dispatchWork catch abort（broker.mjs:849-852） | advanceQueue | 不变 |
| disposed 宽限兜底 finish（broker.mjs:187-196） | advanceQueue | 不变（释放该 lane 槽，global-scan 接手） |
| attemptFallbackRedeploy 各终局（:1828/:1839/:1849/:1864/:1913） | advanceQueue | 不变 |
| attemptReportRepair 投递失败落账（:1933/:1945） | advanceQueue | 不变 |
| **直派成功占槽后（新增）** | 无（单线下占满唯一槽，advance 无意义） | **go_work 直派成功路径（dispatchWork 返回 running 前）补一次 advanceQueue**——否则 read 池 2~3 时直派占 1 槽后，队列中同 lane 的等待 work 无人驱动、饿死到下一个 end（D19） |

### 2.3 queued 语义与 go_work 措辞（规划 :253-255）

- go_work description「Single-line blocking: …」（broker.mjs:1024）更新为「写平面单线、读平面 N 并发」措辞；「queued=true 返回占位 id」口径（:1027）不变——lane-aware skip 下 queued 任务上岗顺序不再是严格队首，description 与 queued 语义说明同步声明「同 lane 内先到先上岗，跨 lane 可能插队上岗」。
- continue 的复活闸（broker.mjs:898-899 `isFinished && orch.isBusy()`）迁为 `isLaneFree(laneOf(record))`：复活一条 explore 不再被一条在飞的 prometheus 挡住，也不再被两条在飞的 explore 之外的第二条放行（readPoolSize=2 时第三条 explore 复活拒绝，报错措辞同步去「single-line blocking」化）。

### 2.4 isBusy 三调用点迁移表

| 调用点 | 现状 | 迁移目标 |
| --- | --- | --- |
| advanceQueue 首行闸（broker.mjs:708） | `orch.isBusy()` 直接 return | 删除该闸，由循环内 `isLaneFree` 逐 work 判定取代（§2.1） |
| dispatchWork 入队分叉（broker.mjs:807-811） | `orch.isBusy()` → enqueue | `!isLaneFree(laneOf(agentType))` → enqueue；保留该二次检查作竞态兜底（入队幂等，advance 循环会接手） |
| resolveContinueTarget 复活闸（broker.mjs:898-899） | `isFinished && orch.isBusy()` | `isFinished && !isLaneFree(laneOf(record))` |

### 2.5 facts.advance 的 lane 维度——解释注记（D18）

规划 :252-253 原文「advance 扩为带 lane 维度（释放的是哪个 lane 的槽，推进决策只看那个 lane）」。本文将「只看那个 lane」解释为**「推进决策由该 lane 的空位驱动」**而非「扫描范围截断为该 lane」：global-scan 循环下，其它 lane 的 work 只在其 lane 真有空位时才可能上岗，而空位只会由对应 lane 的释放制造——语义与 lane-scoped 扫描等价，但省去「每条 facts 记 lane、每次 advance 按 lane 过滤队列」的记账负担。attributeEnd 的 facts **新增 `facts.lane` 字段（事实记录，放 facts.type 同侧）**，仅供测试断言与 metrics，不参与推进决策。此解释与规划字面的偏差点请在评审时确认（§七 D18）。

---

## 三、九出口 × 并行化对照决议矩阵

> 对应规划 §四清单（:385-406）全部「二期需决议」格 + 第九出口 E9（一期 1.5 新增，规划成文时未及）。
> 「不变」均指**语义不变**；实现行号平移不构成语义变化。

| 出口 | 现状锚点 | 并行下决议 |
| --- | --- | --- |
| **E0** ignore（无 childId） | end-attribution.mjs:114-116 | **不变**。lane 语义无从谈起。 |
| **E1** late-duplicate | :130-137 | **不变，附一条细化**：advance='now'（DECISION_ADVANCE :72）在 global-scan 下天然等于「推进被释放 lane」，不会误推进其它 lane（§2.5）。disposed 宽限兜底 finish 与迟到 end 的赛跑窗口不因并行放大（兜底按 childId 键）。 |
| **E2** unattributable | :138-164 | **本矩阵最大改动点，见 §四**。现状「恰有一条占位才归因」在并行下恒假，且 find-first 收集（broker.mjs:1983-1988）会把多条占位错误折叠成一条——决议：占位唯一归因兜底**整体退役**，替换为「end 缓冲重放」（确定性归因）+「缓冲超时回收」（防泄漏兜底）。 |
| **E3** no-owning-orchestration | :167-173 | **不变**。per 实例语义（childOwner 指向已销毁实例）；retireTypeRecords 只清类型侧、childOwner 保留的纪律原样。 |
| **E4** expected-abort | :183-191 | **不变**。abortExpected 按 childId 键，天然 per 棒跨 lane 隔离（规划 :396 已论证）；guard 无条件就地消费（协议第 3 条）不受并发影响；interruptForAbort 的「活体门槛 + 护航登记同步段先行」（broker.mjs:948-969）不改。续轮仍占**原 lane** 槽，语义与现状一致。 |
| **E5** fallback-in-flight | :198-202 | **细化**。once-guard 按 childId 键并行隔离 ✓；「槽位仍被评估占用」显式化为**该 lane 槽**：写 lane 子代评估期间写平面停摆（与现状单线等价）、read lane 子代评估期间 read 池临时缩 1，另一 lane 推进决策不受影响（global-scan 自动满足）。pickFallbackEntry 的模型 I/O 并发安全（无共享可变状态）维持（规划 :398），但 **pendingFallbackByLabel 的 label 键在并行下会冲突**——见 §五 1.3，随 E2 nonce/缓冲方案一并加固。 |
| **E6** fallback-evaluation | :221-241 | **细化 + 一条加固**。同步段零 await 协议（协议第 1 条）逐字保留；advance='no' 细化=「本 lane 不推进」（评估占槽，无可释放）。加固：并发双评估（两条 read 子代同时 error 进 E6）下 attemptFallbackRedeploy 两个实例并发在飞——各自动线段（finish→beginSpawning 之间无 await，broker.mjs:1857 注释）在 JS 单线程下保持原子，槽位不外泄；重派「同 agentType、同 prompt、同 parent」⇒ lane 不变 ⇒ **天然占原 lane 槽，不存在跨 lane 串号的可能面**（R2.3 的 lane 维度被结构消灭；label 键冲突维度见 §五 1.3）。 |
| **E7** finalize | :243-261, :319-327 | **细化**。advance='now' 细化=「推进被释放的那个 lane」（global-scan 语义）；shouldAdvanceQueue（:356-369）签名不动，facts 增补 lane 字段（§2.5）。失败预告/附因推送按 ownerPid+childId 寻址，多子代并发终局时通知交错但互不配对破坏——不变。 |
| **E9** report-gate-repair（一期 1.5） | :266-317（闸门）、:299-316（出口） | **细化**。补发期间记录留 currentMap 实体占槽（advance='no'，:79）——并行下占的是**该 child 所在 lane 的槽**：read 子代补发期间 read 池缩 1，语义自洽（子代确实仍在工作）。attemptReportRepair（broker.mjs:1925-1951）的 followupPrompt→deliverWithQueueFallback（coldResume）链路不占新槽 ✓；投递失败落账转裁决 + advanceQueue 解冻（:1944-1945）在并行下释放该 lane 槽 ✓。一期已裁决的「双发残余窗口」已知边界（end-attribution.mjs:51-52）在并行下**不放大**（repairRetried guard 同步段落地时序未变），维持已知边界口径，不翻案。 |

---

## 四、E2 归因加固方案（实锤风险 R2.1 的正解）

### 4.1 现状机制与并行下的恒假/串号论证

现状链路（单线语义下自洽）：
1. 收集：end dispatcher 从**每个实例**取第一条 spawning 占位——`[...o.currentMap.values()].find((r) => r.status === 'spawning')`（broker.mjs:1983-1988）；
2. 判定：`spawningCandidates.length === 1` 才归因，多条即歧义拒绝（end-attribution.mjs:141）；
3. 归因：bind-spawning-child + set-child-owner 双 op，把 end 硬归给占位记录并换真 id 键（:158-163）。

并行下两个破坏面：
- **恒假（显式歧义面）**：read lane 2~3 并发 ⇒ 同实例同时多条 spawning 占位是常态 ⇒ 全局候选数 ≥2 ⇒ 「恰有一条」恒假 ⇒ 抢跑 end 全部掉 E2 被丢。
- **串号（静默错误面，比恒假更糟）**：收集端的 `find` 每实例只取**第一条**占位——同实例两条 spawning 时，第二条占位对应的 spawn 的抢跑 end 会被错误归给第一条占位。即现状防线在并行下不是「变严」而是「变错」：归因无信号、无留痕、直接串号。**这是幽灵红线的实锤路径，2.2/2.3 动工前必须先落本节方案**。

### 4.2 泄漏子路径（R2.1 × R2.2 复合，现状单线已存在、并行放大）

E2 的成因是「end 抢在 spawn resolve 登记之前」（end-attribution.mjs:139-140）。对被丢的那条 end，其 spawn 链随后仍会正常走完 broker.mjs:833-836（spawnChild resolve → sessionTypes.set → bindChild 换键 → childOwner.set）——但 end 已经丢了，没有任何后续事件会再触发该记录的终局 ⇒ **记录永挂 running，lane 槽永久泄漏**：write lane 泄漏 1 = 该实例编排整体冻结；read lane 泄漏 1 = 池产能永久 -33%~50%，无自愈路径（CURRENT_MAP_CAP=500 的驱逐几乎永不触达）。现状单线下此窗口为进程内 promise 交错，实测罕见（0.2.3-tisitan.6 一族）；并行下 spawnChild 网络窗口 ×N 交错，概率同倍放大。**E2 兜底必须覆盖泄漏面，而不只是归属面。**

### 4.3 方案 A（决议采纳）：end 缓冲重放——确定性归因，插件侧自足

关键事实：**end 载荷携带真 childId，而 spawn resolve 后的登记（sessionTypes.set / bindChild / childOwner.set，broker.mjs:834-836）用的是同一个真 id**。归因因此不需要任何猜测或 nonce 配对——只需要把「登记未就绪」的 end **暂存**，等登记追上后按真 id 精确重放：

```text
subagent/end 入口（broker.mjs:1972 起）：
  type 取证（sessionTypes ?? disposedTypes，:1993）命中 ⇒ 走现有归因管线，零变化
  未命中 且 台账无归属（现行 E2 前置条件不变）：
    ⇒ buffer.set(childId, { info, bufferedAt })   # 纯内存 Map，cap 16（超出即丢弃最旧并 warn）
    ⇒ 留痕（沿用现 E2 的 warn 措辞 + buffered 标注），**不做任何归因，不碰任何占位**

认领点（登记落地处，插桩三处）：
  dispatchWork 派发成功（:836 之后）
  attemptFallbackRedeploy 重派成功（:1900 之后）
  （两处都是 childId 真身登记完成的同点）
  claimBufferedEnd(childId)：buffer 命中 ⇒ 删条目 ⇒ 用暂存 info 重入 end dispatcher
    ⇒ 走完整归因管线（E4 guard/E5/E6 备选链/E7 落账/E9 闸门全量生效——比现状占位
    兜底只补一条「attributed to spawning record」warn 更完整）

缓冲超时兜底（防 4.2 泄漏面的最终口径）：
  定时扫描（复用 disposed 宽限兜底的 timer 纪律，timer.unref）：
  条目滞留 > grace（默认与 DISPOSE_END_GRACE_MS 同源，独立 config 键待拍板，§七 D16）
    ⇒ 丢弃条目并留痕（「spawn 登记未在 grace 内追上，end 按无从归属落档」）
    ⇒ 对仍处 spawning 的候选占位审计：占位 createdAt 距今 > grace 且其 spawn 链无进展
      ⇒ 按 disposed 兜底同款口径 finish failed 落账（「spawn resolve 前 end 丢失，兜底回收」）
        + retireChild + advanceQueue（broker.mjs:187-196 同款三连），释放 lane 槽
```

决议理由与不变量：
- **归因永不错**：认领条件是真 id 精确匹配，无「恰有一条」式猜测——幽灵红线在归因面上关死；
- **end 永不丢**：抢跑 end 经缓冲最终要么重放（spawn 正常 resolve，4.2 泄漏子路径被正面修复）、要么显式落档留痕（spawn 链异常）；
- **无双份**：认领即删条目，重放单次；缓冲在 end 入口与归因管线之前，不存在两条路径同时消费同一 end；
- **无真空**：超时回收给每个滞留占位一个显式 failed 终局 + advanceQueue，队列不冻结；
- **占位唯一归因兜底退役**（end-attribution.mjs:138-164 的 hit 分支 + broker.mjs:1983-1988 收集端）：其原有价值（抢救抢跑 end）由重放路径完整继承且更精确（重放走全管线）；保留它反而要在并行下重解「多占位歧义」难题，且 find-first 收集本身就是串号源。退役后 attributeEnd 的 `spawningCandidates` 参数与 `bind-spawning-child`/`set-child-owner` 两 op 一并移除，E2 出口保留（语义收窄为「缓冲前最终无从归属」的落档口径）。
- **E1 口径回补**：重放时若该 childId 已被终局过（极端：缓冲期间被 disposed 兜底收走）⇒ 归因管线自然落 late-duplicate 留痕——现有出口原样接住，无需新分支。

### 4.4 方案 B（nonce 序对）——降级为可选优化，不阻塞

规划 :394 原建议「占位与 spawn 请求一一绑定的 nonce/label 序对」。本文论证其**非必需**：方案 A 的认领键是真 id，本身就是 spawn 请求与占位记录的一一绑定（bindChild 换键即绑定完成）。nonce 仅在「end 载荷可回传 label/请求标识」时能提前（缓冲前）归因，缩短一个进程内窗口——收益趋近于零，代价是取证与 payload 依赖（需 explore 取证 dsh-subagent 的 subagent/end 载荷结构，且 harness 升级可能破坏）。**决议：不采**；若评审认为仍需取证，列 §七 D17。

---

## 五、失败处置全家桶并行适配

### 5.1 备选链（E6/E5）逐点

| 机制 | 并行下行为 | 红线检查 |
| --- | --- | --- |
| once-guard fallbackDecided（child-registry.mjs:44） | childId 键天然 per 棒，双 lane 各自决策互不可见 | 无双份：同 childId 二发被 E5 拦（:198-202） |
| 评估窗口占槽 | 占**原 lane** 槽（§三 E5 行） | 无真空：评估各终局分支必落账 + advance（:1828/:1839/:1849/:1864） |
| 同步段 finish→beginSpawning（broker.mjs:1857-1878） | JS 单线程下同步段原子性不变，槽位不外泄 | 无双份：二发落在 finish 后只能命中 late-duplicate（:1858 注释） |
| 重派 lane 归属 | 同 agentType ⇒ 同 lane ⇒ 结构上不可能跨 lane 串号 | R2.3 lane 维度被结构消灭 |
| **pendingFallbackByLabel 键冲突** | **并行实锤**：两条同工种同 prompt 前缀的 read 子代并发重派 ⇒ label 全同 ⇒ `.set` 后写覆盖先写 ⇒ promoteFallback（child-registry.mjs:107-111）删错键/转正错条目 ⇒ waterfall 备选覆盖串号。单线下不可能（单线锁保证同时至多一条重派在飞）。 | **双份/幽灵变体**。加固：pendingFallbackByLabel 键从 label 改为 `label + '\u0000' + spawnToken`（spawnToken = 占位记录的 placeholderChildId，天然唯一，无需新 id 发生器）；fallbackOverrideFor（:95-97）的 label 回退查表改为「label 前缀扫描 + 占位绑定优先」——具体形态在 2.4 施工时随 E2 退役一并重锚（waterfall 侧消费面见 misc.mjs resolveEffectiveBinding） |

### 5.2 墓碑与 disposed 宽限兜底

- tombstoneType / retireChild / retireTypeRecords（child-registry.mjs:53-89）全按 childId 键，并行无变化；
- disposed 宽限兜底（broker.mjs:176-200）finish failed 落账 + retireChild + advanceQueue 三连在并行下释放**该 lane** 槽，global-scan 接手 ✓；兜底与真 end 的赛跑窗口不因并行放大（cancelDisposeFallback 在 end 入口无条件执行，:1976）；
- 墓碑 FIFO 驱逐（DISPOSED_TYPES_CAP=50，:31/:59-63）按插入序，与 lane 无关，不变。

### 5.3 终局口径与补发链

- 「预告之后必有终局」纪律（0.2.3-tisitan.18 一族）的全部配对按 ownerPid+childId 寻址，多子代并发终局时通知在主编侧交错但每对各自闭合，无共享游标——不变；
- attemptReportRepair 正常路径：记录占原 lane 槽 → 补发轮 end → repairRetried 命中 → finalize 释放槽 ✓；投递失败路径：落账 + advanceQueue 释放槽 ✓；
- 双发残余窗口（一期已知边界）：guard 同步段时序未变 ⇒ 窗口不放大 ⇒ 维持「已知边界」口径（end-attribution.mjs:51-52），测试注明即可。

### 5.4 三红线逐条映射（对应规划 :401-406 与 §三风险表）

| 红线 | 并行面暴露点 | 本设计关死方式 |
| --- | --- | --- |
| **幽灵**（归属错误） | R2.1：E2 find-first 串号 + 恒假歧义（§4.1） | 方案 A：真 id 精确认领，占位猜测归因退役（§4.3） |
| **双份**（同任务两执行） | R2.3：重派跨 lane 串号 + pendingFallbackByLabel 键冲突（§5.1） | 重派同 agentType ⇒ 同 lane 结构不可跨；label 键 → label+spawnToken；once-guard per childId 原样 |
| **终局真空**（无人报终局） | R2.2：lane 槽泄漏（E2 泄漏子路径 §4.2、漏释放） | 缓冲超时回收 + 占位审计落账（§4.3）；每出口 lane 释放断言（§六探针②） |

---

## 六、测试策略与变异探针（对应规划 R2.1~R2.5 :367-372）

| # | 测试 | 咬合点 | 对应风险 |
| --- | --- | --- | --- |
| T1 | 泳道容量/隔离：readPoolSize=2 时两条 explore 并行在飞、第三条入队；write 仍 1 条硬闸 | orchestration.test.mjs 扩展（规划 :243） | R2.5 前置 |
| T2 | lane-aware skip 行为：队列 [write, read, read] + read 空位 ⇒ read 上岗、write 原地；lane 内 FIFO 断言 | multi-session.test.mjs 模式新增（规划 :256） | R2.5 |
| T3 | **变异探针①：删容量判定 ⇒ 两条写平面子代理并行必红**（单线锁是地基，探针咬在写平面） | 规划 :256-257 已裁决 | R2.1 之外的地基 |
| T4 | **变异探针②：任一 end 出口漏 lane 释放 ⇒ 池耗尽必红**（逐出口遍历：E1/E7 finalize、重派各终局、补发失败落账、disposed 兜底、E2 超时回收） | 规划 :369 | R2.2 |
| T5 | E2 并行竞态：双 spawning 在飞 + 抢跑 end ⇒ 缓冲留痕不归因；spawn resolve ⇒ 重放走全管线；spawn 悬挂 ⇒ grace 后占位 failed 落账回收 | 新增 end-buffer 行为测试 | R2.1 |
| T6 | 重派并发：双 read 子代同时 error 进 E6、同 label ⇒ 各自转正、waterfall 覆盖不串号 | E5/E6 并发评估测试（规划 :370） | R2.3 |
| T7 | E9 补发并行：read 子代补发期间 read 池缩 1、其余 read 可继续；补发轮 end 释放槽 | report-gate 行为测试扩展 | R2.2/E9 |
| T8 | 复活闸 lane 化：explore finished + 两条 explore 在飞（cap=2）⇒ revive 拒绝；write 空 ⇒ revive 放行 | orchestration.test.mjs | §2.3 |
| T9 | snapshot 形状：currentRecords 全量、cap 驱逐后仍自洽（归 2.5，本文只登记） | panel-format / client-smoke | R2.4 |

---

## 七、决策空白清单（须维护者拍板，本文不擅自定）

| # | 问题 | 选项 | 本文倾向（仅供参考） |
| --- | --- | --- | --- |
| **D16** | E2 缓冲超时 grace 参数 | a) 复用 DISPOSE_END_GRACE_MS（500ms）b) 独立 config 键 `spawnEndGraceMs ?? 2000`（spawn 网络窗口天然长于 dispose 窗口，500ms 可能误杀慢 resolve） | b，独立键 + 保守默认 |
| **D17** | 方案 B（nonce 回传）是否仍派 explore 取证 end 载荷结构 | a) 不取证，方案 A 定案 b) 取证留档（harness 升级风险备忘） | a（§4.4 论证非必需） |
| **D18** | §2.5 解释注记：advance「只看那个 lane」= 空位驱动（global-scan）而非扫描截断，facts.lane 仅作可观测 | a) 接受解释 b) 坚持字面 lane-scoped 扫描截断 | a |
| **D19** | 直派成功占槽后补一次 advanceQueue（§2.2 新触发点）——会改变「直派后队列静止」的现状观感（并行下直派后同 lane 等待任务立即上岗） | a) 接受（读池不饿死的必要条件）b) 不补位（接受 read 等待任务饿死到下一 end） | a |
| **D20** | snapshot 形状一步到位（删 current、新增 currentRecords）vs 双字段过渡 | a) 一步到位（消费面三处同批改 + T9 咬形状）b) 双字段过渡一期 | a（2.5 动工前拍即可） |

---

## 八、与三期的接口预埋（一句话各自）

- 3.4 自动接力「走 dispatchWork 同一入口、绝不绕过泳道锁」（规划 :319-320）：接力 hop 的 lane 判定复用 §1.1 同一张表，read→read 链天然受益于读池并发；
- 3.1 链状态机对 E2 的依赖（规划 :394「链中一棒的 end 掉 E2 = 链 stall」）：方案 A 落地后 E2 语义收窄为「缓冲超时最终无从归属」，链级兜底（挂起通知主编）只需对接该终局口径，3.1 文档引用 §4.3 即可；
- readPoolSize=1 时全部语义退化为现状（D5 默认关）：本文所有并行行为均以「lane 容量=1 ⇒ 无 skip、无并发评估、缓冲路径保持但永不触发」为退化正确性判据。
