# dsh-my-go 下一代架构改造实施规划（0.4.0-tisitan.* 线）

> 产出：Prometheus 规划批。依据「已定稿设计」三期方案 + 五条硬性工程约束。
> 号段核对结论：tisitan.13~20 全部是 0.2.3 旧线已发布批（底座化=0.2.3-tisitan.14、
> 可视化=0.2.3-tisitan.13/15），0.3.0 线止于 .12，**0.4.0-tisitan.0 起号段空闲，无撞号**。
> 版本分配建议：第 0 期=.0，第一期=.1~.3，第二期=.4~.6，第三期=.7~.9（每期一发，批次内自增）。
>
> 全局不变量（每期每步都适用）：
> - 不动 DSH harness 内核本体（8-25 边界），一切改造在插件层闭环。
> - 三机制各自独立开关，挂 agent.cordis.yml broker 行 config 轨（:148-149，当前无 config 块）；
>   broker 读 config 的既有模式见 broker.mjs:87 `apply(ctx, config = {})` 与 :132-139 五枚既有键。
> - 失败处置全家桶语义是最高红线：任何新异步路径不得制造幽灵 / 双份 / 终局真空。
> - 测试纪律 9-2：每条新防线配变异探针——先证明防线能被攻破（删防线测试必红），再补屋顶。
> - 每期结束 `npm test`（21 文件 324 例 + 新增）全绿才发版、才进下一期。
> - 防回潮双守卫 test/apply.mjs:24 + test/host-parity.test.mjs:85-100 对新增 shared 模块
>   的标记入册，遵循 host-parity.test.mjs:67-81 的四判据（锁不变量，不锁实现）。

---

## 第 0 期：观测埋点（0.4.0-tisitan.0）—— 不改行为，先拿基线

### 步骤 0.1 指标事件日志模块
- **工种**：hephaestus（新模块设计）｜**副作用**：写
- **目标**：在不改任何编排行为的前提下，持续记录三类基线：①turn 间隔（子代运行时长、
  队列等待时长）；②报告大小分布（每次 finalize 的结论字节数）；③主编上下文增长代理指标
  （每次注入主会话的通知/结论字节累计）。
- **改动文件**：
  - 新增 `preset/tools/metrics.mjs`（broker 本地模块，不进 shared——只有 broker 消费，
    避免无谓扩大单源守卫面）。导出 `createMetrics({ dir, enabled })` → `{ record(event), close() }`。
    追加写 JSONL（一行一事件）；**任何 fs 异常只 console.warn 吞掉，绝不抛进编排热路径**。
  - `preset/tools/broker.mjs` 埋点钩子（全部只读快照、零分支改动）：
    - `dispatchWork` 成功处（:751 起）：`{kind:'dispatch', agentType, promptBytes, ts}`
    - end dispatcher finalize 分支（:1813-1816）：`{kind:'end', childId, agentType, stopReason,
      conclusionBytes: facts.conclusion.length, runMs: now - record.createdAt}`
    - `advanceQueue` dequeue 后（:675-689）：`{kind:'queue-pop', waitMs: now - work.createdAt}`
      （work.createdAt 已存在，shared/orchestration.mjs:58）
    - continue/forward 投递处：`{kind:'continue', promptBytes, urgency}`
    - `notifyOwner`/`notifyParent`（:425/:448）：`{kind:'inject', bytes: text.length}` ——
      主编上下文增长的代理指标（内核 notifySettlement 全文注入不可拦，事实 A，
      插件侧能量的就是「插件自己注入了多少」+「结论原文多大」）。
  - 落盘路径：沿用台账惯例 `join(DSH_HOME||~/.dsh, 'dsh-my-go', 'metrics', 'events.jsonl')`
    （broker.mjs:304 同款 path 惯例）。
- **配置开关**：`config.metrics ?? true`（第 0 期目的即采基线，建议默认开；见决策空白 D6）。
- **指令颗粒度**：metrics.mjs 三函数（构造/record/close），无轮转（v1 先 cap 10 万行，
  超限截断头部并 warn 一次——防无界增长的兜底闸，仿 CURRENT_MAP_CAP 思路 constants.mjs:26）。
- **验收**：
  - 单测：record 追加/close 幂等/fs 失败只 warn 不抛/enabled=false 零写盘。
  - 变异探针：删掉 record 的 try/catch → 「只读目录」探针测试必须红。
  - `npm test` 全绿（既有 324 例零变化=行为未动的证据）。
- **依赖**：无。第一步动工。

### 步骤 0.2 基线采集与复盘（运营步，非派工）
- **工种**：维护者日常使用 + Sisyphus 复盘｜**副作用**：读
- **目标**：0.4.0-tisitan.0 装上后正常跑 3~5 天真实编排，产出基线简报：
  结论字节分布 P50/P90/max、队列等待分布、主编注入字节/会话。
- **验收**：简报落到本文件附录或日记；第一期的 schema 阈值（D2）用 P90 数据定，不拍脑袋。
- **依赖**：0.1 发版。

---

## 第一期：报告外部化（0.4.0-tisitan.1~.3）

> 核心机制一句话：内核 notifySettlement 全文注入不可抑制（事实 A，
> dsh-subagent/lib/index.js:1771-1777），所以「主编上下文税封顶」靠的是
> **让子代最后一条消息本身短**（三段式 mygo_report 摘要块），全文经 report_submit
> 与收尾自动落板双通道进 board/，主编按需 report_fetch 切片取回。

### 步骤 1.1 board 存储层（shared 纯模块）
- **工种**：hephaestus｜**副作用**：写
- **目标**：board 读写的唯一出处，原子写 + 行切片读 + 路径焊死。
- **改动文件**：
  - 新增 `preset/shared/board.mjs`（守 shared 铁律：不 import @deepseek-ai/*、不碰 ctx）：
    - `boardRoot()` = `join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-my-go', 'board')`
      （复制 broker.mjs:304 台账路径惯例）
    - `writeBoard(sessionId, childId, content)` → `{ path, bytes }`；tmp+rename 原子写
      （照抄 broker.mjs:340-373 writeLedgerSync/scheduleLedgerSave 的 tmp 模式与残骸清理）
    - `readBoardSlice(sessionId, childId, offset, limit)` → `{ totalLines, offset, limit, text }`；
      **按行切片**（D1）；offset/limit 越界钳制；文件缺席返回明确错误对象而非抛出
    - 段名安全：sessionId/childId 一律经 `encodeSegment`（复用 shared/archive.mjs 既有实现，
      broker.mjs:65 已有导出先例）——根目录焊死 + 段编码双保险，`..`、路径分隔符、
      绝对路径必须被编码或拒绝。
- **验收**：
  - 单测：原子写（tmp 残骸清理）/切片边界（offset=0、超尾、limit 超总长）/段名注入探针
    （`'../x'`、`'a/b'`、Windows 盘符）。
  - 变异探针：去掉 encodeSegment → 注入探针必须红（自证会咬人）。
- **依赖**：无（可与 1.2 并行）。

### 步骤 1.2 摘要 schema + 解析器 + 格式条款文本
- **工种**：hephaestus（schema 质量是命门，需要对着真样本设计）｜**副作用**：写
- **改动文件**：
  - 新增 `preset/shared/report-format.mjs`：
    - `SUMMARY_CLAUSE`：追加到子代 prompt 尾部的格式条款文本（中英混排，与仓库工具描述
      英文 + 人设中文的惯例对齐；必须写明「**最后一条消息只输出 mygo_report 三段块，全文走
      report_submit**」——这是上下文税封顶的真正机关，见事实 A）
    - `parseSummaryBlock(text)` → `{ ok, conclusion, evidence[], open, errors[] }`：
      提取 `<mygo_report><conclusion/>…<evidence/>…<open/>…</mygo_report>`；
      evidence 逐行校验 `路径:行号` 形态（正则须含 `:\d+`）；「无」为合法特认值
    - 多块歧义规则（M2 注入放大器教训）：正文出现多个 mygo_report 块 → **取最后一个
      完整闭合块并在 errors 里记 ambiguous**；不闭合块视为无块
    - `validateSummary(parsed)`：缺段 / evidence 非「无」且无一条合法 file:line → errors
  - schema 阈值（conclusion 字符上限、evidence 最少条数是否允许「无」）→ **决策空白 D2，
    用 0.2 基线 P90 数据拍**。
- **验收**：单测语料库 ≥12 例：合法 / 缺 open 段 / 缺 conclusion / evidence 全坏 /
  evidence 混好坏 / 「无」/ 多块 / 不闭合 / 块外正文干扰 / 伪造嵌套块。
- **依赖**：无（与 1.1 并行）；阈值定稿依赖 0.2 基线（可先以保守默认动工，D2 拍板后微调）。

### 步骤 1.3 report_submit 子代理工具
- **工种**：hephaestus（新工具 + 访问控制设计）｜**副作用**：写
- **改动文件**：
  - `preset/tools/broker.mjs`：在 list_subagents 注册块（:1331-1368）之后新增注册：
    - 参数 `{ report: string }`；**childId/sessionId 只从 exec.agent 推导**
      （子会话 id 与 parentSession id），绝不由参数传入——防越权写他人板。
    - 守卫：调用方非子代理（无 parentSession）→ 抛错；开关关 → **工具不注册**
      （config 在会话组装期固定，挂载时读一次即可，不做运行时切换）。
    - execute：`writeBoard(parentSessionId, childId, report)`；返回 `{ ok, bytes }`。
    - `isConcurrencySafe: () => true`（与六件套同例）。
  - `preset/shared/constants.mjs:39` SELF_REGISTERED_TOOLS 追加 `'report_submit'`、
    `'report_fetch'`（roles 过滤 shared/roles.mjs:153 与 liveToolNames broker.mjs:699-708
    依赖这份名单，漏加会被 toolFilter 误杀）。
- **验收**：替身 ctx 行为测试：正常写板 / 主会话调用抛错 / 开关关时工具不在册。
- **依赖**：1.1。

### 步骤 1.4 spawnChild 格式条款注入
- **工种**：hermes（锚点与语义零歧义）｜**副作用**：写
- **改动文件**：
  - `preset/tools/broker.mjs:731-741` request.prompt 组装：开关开时 prompt 数组尾部追加
    `{ type: 'text', text: SUMMARY_CLAUSE }`。此处是直派与备选重派唯一共用组装点
    （事实 C），一处改动两路同覆盖。
  - **continue 路径不动**：continue 保留子代上下文，首派注入的条款自然存续（事实 C：
    continue 走 shared/adjacent.mjs 不经 spawnChild）；「首派即覆盖」记为决策空白 D3
    待维护者确认接受。
- **验收**：spawn 替身断言 prompt 尾块含条款；开关关 → 无尾块；备选重派路径
  （attemptFallbackRedeploy → spawnChild，broker.mjs:1702-1710）同样含条款。
- **依赖**：1.2（SUMMARY_CLAUSE）。

### 步骤 1.5 收尾落板 + 机械闸门（本期最难，红线集中地）
- **工种**：hephaestus｜**副作用**：写
- **改动文件**：
  - `preset/shared/end-attribution.mjs`：DECISIONS（:38-47）新增第九出口
    `'report-gate-repair'`，DECISION_ADVANCE（:50-59）登记为 `'no'`（补发期间槽位仍占，
    协议第 2 条 :23-27 的 throw 机制 :249 自动兜底未登记情形）。
  - `preset/tools/broker.mjs` end dispatcher（:1737-1820）与 finalizeEnd（:1614-1628）：
    1. finalize 且 `!failed` 且开关开：把 E8 提取的全文（:178-182 同款 text）writeBoard 落板
       ——优雅降级底座：子代不调 report_submit，全文也落板，内核注入全文=现状，不更糟。
    2. `parseSummaryBlock` 合格 → 台账 conclusion 存**摘要块文本**（history 与
       orchestration_status 展示即短块；:1314 STATUS_CONCLUSION_MAX 截断逻辑不动）。
    3. 不合格 → 新出口 `report-gate-repair`：同步段登记 once-guard + 同步预告
       （仿 E6 的 0.3.0-tisitan.18 纪律，end-attribution.mjs:19-22 协议第 1 条：
       **同步段零 await**，guard add 与预告之间不得插 await），随后 `void` 起异步
       补发链：**不 finish 不 revive**——记录留在 currentMap 实体占槽（「补发期间
       槽位仍占」的实体化），followupPrompt 台账照记补发 prompt（携带
       validateSummary 的具体 errors 清单，让子代知道改什么）+ queued 档投递
       （coldResume 唤醒已 settle 的子会话，deliverWithQueueFallback 同源通路）；
       投递失败兜底按「格式不合格（补发投递失败）：」落账转裁决 + advanceQueue
       解冻（仿 attemptFallbackRedeploy catch 失败终局回退，绝不留真空）。
    4. 补发后 end 再至仍不合格 → finalize 落账（结论标注「格式不合格」前缀）+
       notifyOwner 转主编裁决；**不再二次补发**。
    5. **failed 结论永不过闸**：`failed === true` 一律走现路径，一字不动。
  - `preset/shared/child-registry.mjs`：once-guard 表 `repairRetried`，语义 =
    「补发授权已用掉」；清理双点且不冲突——**retireChild**（终局翻篇：合格
    finalize / 转裁决 / 失败终局都经此，是防无限循环的关键清理点：补发链不走
    rearmChild，guard 存续到补发轮 end 的转裁决）+ **rearmChild**（复活即新生代，
    防主编复活做新任务被旧 guard 误吞补发资格）。
- **验收**（end-attribution.test.mjs + 新 report-gate 行为测试，替身 ctx）：
  合格直通 / 不合格补发一次 / 补发后合格 / 补发后仍不合格转裁决 / failed 直通过
  五条路径全覆盖；**变异探针：删掉 once-guard → 双补发必须被测试咬出**；
  新出口未登记 DECISION_ADVANCE → 既有 throw（:249）自动咬人，无需另测。
- **Sisyphus 裁决**：采纳方案甲（need_help help-mtn753lh），:149/:151 字面互斥
  （once-guard 同律清理 × continue revive 字面路径 = 补发轮清 guard 后无限补发）
  以此为准；ambiguous 由闸门读 errors.includes('ambiguous') 视为不合格；双发
  残余窗口按「已知边界」处理（代码注释 + 测试注明）。
- **依赖**：1.1、1.2、1.3。

### 步骤 1.6 report_fetch 主编工具
- **工种**：hermes（1.1 之后语义零歧义）｜**副作用**：写
- **改动文件**：
  - `preset/tools/broker.mjs` 新增注册：参数 `{ childId, offset?, limit? }`；
    根焊死 `board/<exec.agent 当前会话 id>/`；`canOrchestrate` 同款守卫（:1017 模式）；
    默认 limit 200 行、上限钳制 2000 行；返回 `{ totalLines, offset, limit, text }`。
  - 子代理 deny：broker.mjs:1411-1414 子代理闸列表追加 `'report_fetch'`
    （denyTools :1374-1388 的逐名兜底机制自动覆盖）。
- **验收**：替身测试：正常切片 / 越界钳制 / 跨 sessionId 不可达 / 子代理侧工具不在册
  （anti-bypass.test.mjs 同款断言模式）。
- **依赖**：1.1。

### 步骤 1.7 开关接线 + 文档
- **工种**：hermes｜**副作用**：写
- **改动文件**：
  - `preset/agent.cordis.yml` broker 行新增 config 块：`reportExternalization: false`
    （方案 A，help-mtn8uwgr-ds1fes 裁决：**显式部署面关**覆盖代码默认——见下方裁决行）。
  - `preset/tools/broker.mjs`（config 轨区）：`const REPORT_EXT = config.reportExternalization ?? true`
    （D5 默认开不动，显式配置优先）。
  - README「插件 config 键」段 + CHANGELOG [0.4.0-tisitan.1] 条目（Unreleased/未发布口径）。
- **验收**：config 关 → 两工具不在册 + 条款不注入 + `npm test` 全绿（退回现状的证据）。
- **依赖**：1.3、1.4、1.5、1.6。
- **Sisyphus 裁决**：采纳方案 A（help-mtn8uwgr-ds1fes）：装机 yml broker 行显式
  `reportExternalization: false`，代码默认 `?? true`（D5）一字不动，README 写明
  「显式配置优先于代码默认，基线采集期外部化保持关；基线关窗后改 true（或删除该行
  回落默认）即点亮」。依据：digest 门认「版本 + preset/prompts 内容摘要」不认版本号
  单独——1.3~1.6 施工已在工作区 preset 树内，维护者下次重启 dsh web 即整树重拷上线，
  挂起 1.8 发版挡不住；yml 写规格字面 true 会使外部化与 metrics 同一次重启同时点亮，
  「改造前」基线永久丢失。1.8 发版维持挂起（ tisitan.1 条目按 Unreleased 口径起草）。

### 步骤 1.8 测试收口 + 发版 0.4.0-tisitan.1
- **工种**：hermes｜**副作用**：写
- 全部新测试入网；host-parity 对 board.mjs / report-format.mjs 的「唯一归属」标记按
  四判据入册；bump version → npm test → build-client → CHANGELOG（遵循 FORK-GUIDE
  发版六步；**不 git commit 由派工链决定，本步只备齐**）。
- **主批裁决（help-mtn8uwgr-ds1fes）：本步 bump 与发版整体挂起**——基线采集尚未开始
  （维护者未重启），现在发 tisitan.1 会让外部化与 metrics 同时点亮，「改造前」基线
  永久丢失。tisitan.1 条目已在 CHANGELOG Unreleased 段按未发布口径备齐，等基线关窗
  后再走 bump。
- **依赖**：1.1~1.7 全绿。

---

## 第二期：读平面并行池（0.4.0-tisitan.4~.6）

> 改动面是 Orchestration 实例化模型（currentMap/isBusy），不是全局锁；
> 与失败全家桶的集成是最难点，2.1 语义文档先行，未拍板不动码。

### 步骤 2.1 并行语义设计文档（设计交付，不写实现码）
- **工种**：hephaestus｜**副作用**：读（产出设计文档）
- **交付**：`docs/plans/read-pool-semantics.md`，逐条填决本规划 §四「八出口影响清单」
  中标记「二期需决议」的格子，特别是：
  - E2 归因加固方案（并行 spawn 下 spawningCandidates 多条是常态而非异常）
  - E6/E7 的 per-lane 槽位与推进口径
  - 队列调度策略（决策空白 D9）
- **验收**：文档经维护者评审拍板（含 D7~D10 四枚决策空白）。
- **依赖**：第一期发版（独立机制，不依赖其代码，依赖的是「测试全绿的新基线」）。

### 步骤 2.2 Orchestration 泳道化
- **工种**：hephaestus｜**副作用**：写
- **改动文件**：`preset/shared/orchestration.mjs`
  - record 增加 `lane: 'read' | 'write'` 字段；beginSpawning(:65-79) 接收 lane。
  - `isBusy()`（:54）→ 容量语义：`isLaneFree(lane)`（read 容量 = config.readPoolSize，
    write 恒 1）；isBusy 保留为「任何 lane 满」的复合判定供旧调用点过渡。
  - `snapshot()`（:38-45）：current 从「取第一条」改为返回**全部** current entries
    （形状变更 → 面板桥消费面连锁，见 2.5）。
  - lane 判定表：内建 explore / librarian → read；hermes / hephaestus / prometheus /
    oracle → write；looker 归属待定（D7）；自定义角色默认 write（D8）。
  - CURRENT_MAP_CAP（constants.mjs:26）语义不变。
- **验收**：orchestration.test.mjs 扩展：并行容量 / 泳道隔离 / revive(:187-199) 带 lane 回槽。
- **依赖**：2.1 拍板。

### 步骤 2.3 调度面泳道化
- **工种**：hephaestus｜**副作用**：写
- **改动文件**：
  - `preset/tools/broker.mjs:675-689` advanceQueue：从「队首一个」改为「找队首起第一个
    lane 有空位的 work」（lane-aware skip，D9 拍板后落地）；回补重试（requeueHead/
    scheduleQueueRetry）语义不变。
  - `preset/shared/end-attribution.mjs:256-269` shouldAdvanceQueue：advance 扩为
    带 lane 维度（释放的是哪个 lane 的槽，推进决策只看那个 lane）。
  - go_work description（:976-983）「Single-line blocking」措辞更新为
    「写平面单线、读平面 N 并发」，queued 语义说明同步更新。
- **验收**：仿 multi-session.test.mjs 模式新增并行调度行为测试；**变异探针：删掉容量
  判定 → 两个写平面子代理并行必须被咬出**（单线锁是地基，探针必须咬在写平面上）。
- **依赖**：2.2。

### 步骤 2.4 失败全家桶并行适配（本期最难，最高红线）
- **工种**：hephaestus｜**副作用**：写
- 按 2.1 文档落地 §四清单中全部「二期」格子；attemptFallbackRedeploy
  （broker.mjs:1636-1731）「不占新槽位」语义显式化为「占原 lane 槽」。
- **验收**：八出口 × 并行场景行为测试矩阵全覆盖 + 三枚探针（§三风险表 R2.1/R2.2/R2.3）。
- **依赖**：2.3。

### 步骤 2.5 展示面并行适配
- **工种**：hermes｜**副作用**：写
- **改动文件**：
  - orchestration_status（broker.mjs:1299-1319）：current 多条渲染。
  - list_subagents（:1351-1353）：`s.current ? [s.current] : []` → 全量数组。
  - 快照桥（:296）形状 → host 半 RPC 消费面（lib/index.js 面板接口）+ src/ 面板树；
    **动 src/ 必须重建 dist/client.js**（test/apply.mjs:44-51 新鲜度断言会咬）。
- **验收**：panel-format.test.mjs / client-smoke.test.mjs 扩展并全绿。
- **依赖**：2.2（snapshot 形状）。

### 步骤 2.6 开关 + 收口 + 发版 0.4.0-tisitan.4
- **工种**：hermes｜**副作用**：写
- config 键 `readPoolSize ?? 1`（1=现状=关闭，2~3 启用；>3 钳制 3）；文档 + CHANGELOG +
  发版六步。
- **依赖**：2.1~2.5 全绿。

---

## 第三期：声明式接力链（0.4.0-tisitan.7~.9）

> 状态机最难、防线最严。语义未拍板（3.1）绝不动码。

### 步骤 3.1 链状态机语义设计（设计交付）
- **工种**：hephaestus｜**副作用**：读
- **交付**：`docs/plans/relay-chain-semantics.md`：链声明 schema / 跳类型与闸门配置 /
  **棒亡备选重派后的链续接语义（D10，先设计清再写码）** / 链 × 八出口终局归属矩阵
  （填 §四清单全部「三期」格子）。
- **验收**：维护者评审拍板（D10~D14）。
- **依赖**：第二期发版。

### 步骤 3.2 链状态机纯模块
- **工种**：hephaestus｜**副作用**：写
- 新增 `preset/shared/relay-chain.mjs`：纯状态机，仿 end-attribution 风格——决策纯函数
  出 `{ decision, ops, notices, facts }`，dispatcher 在 broker；链记录持久化入台账 v3
  （D12 拍板；迁移与坏档回退同 loadLedger broker.mjs:306-324 的 v1→v2 兼容模式）。
- **验收**：状态机全迁移单测。
- **依赖**：3.1。

### 步骤 3.3 链声明入口（主编工具）
- **工种**：hephaestus｜**副作用**：写
- 新主编工具（载体形态 = 决策空白 D11）：声明逐跳 `{ agent, prompt?, gate }`；
  **指令来源校验**：每跳指令只能来自声明内预写文本或闸门现场文本——子代产出永远以
  不可信数据块注入下一棒（M2 注入放大器教训）。
- **验收**：注入探针：上一棒产出里伪造「下一跳指令」→ 必须以数据块包裹注入、
  不得被当作指令，测试咬出。
- **依赖**：3.2。

### 步骤 3.4 读→读免审自动接力
- **工种**：hephaestus｜**副作用**：写
- hop 终局（finalize 且 !failed 且 gate=auto）：broker 从 board 直取上一棒全文 →
  包 `<mygo_relay_input trusted="false" source="board/<sid>/<childId>.md">` 数据块 →
  与预写静态指令拼成下一棒 prompt → **走 dispatchWork 同一入口**（不经过主编上下文，
  也绝不绕过泳道锁）。
- **验收**：端到端替身测试；锁绕行探针（自动接力不得放行第三个写平面子代理）。
- **依赖**：3.3；读泳道并行（第二期）不是硬依赖——readPoolSize=1 时链退化为串行，仍正确。

### 步骤 3.5 读→写挂起三档审阅 + 不可逆跳同步门
- **工种**：hephaestus｜**副作用**：写
- gate=review：挂起 + notifyOwner 三档选项（摘要 / 摘要+report_fetch 切片 / 全文取回），
  链状态 suspended；主编裁决后放行/驳回（裁决通道形态与 D11 联动）。
- gate=sync（不可逆跳）：恒挂起等主编，无 auto 档。
- **验收**：三档路径行为测试；**终局真空探针**：挂起后主编会话销毁 → 链必须随
  orchestration 销毁清理并留痕，不得无声悬挂（仿 0.2.3-tisitan.18「预告之后必有终局
  口径」纪律）。
- **依赖**：3.3；1.6（report_fetch 切片档）。

### 步骤 3.6 下游验收条款
- **工种**：hermes｜**副作用**：写
- 链 prompt 统一追加验收条款：输入不可用 → need_help 打回，禁止带病施工。
- **验收**：链 prompt 断言含条款。
- **依赖**：3.3。

### 步骤 3.7 开关 + 收口 + 发版 0.4.0-tisitan.7
- **工种**：hermes｜**副作用**：写
- config 键 `relayChains ?? false`（第三期建议默认关，D5 联动）；文档 + CHANGELOG + 发版。
- **依赖**：3.1~3.6 全绿。

---

## 三、风险表（每期回归风险点 + 测试策略）

### 第 0 期
| 风险 | 后果 | 测试策略 |
| --- | --- | --- |
| R0.1 埋点 I/O 异常打进编排热路径 | 编排被观测代码杀死 | 只读目录/占满盘探针：record 只 warn 不抛；变异：删 try/catch 必红 |
| R0.2 events.jsonl 无界增长 | 磁盘静默耗尽 | 行数 cap + 截断留痕单测（仿 CURRENT_MAP_CAP 兜底思路） |

### 第一期
| 风险 | 后果 | 测试策略 |
| --- | --- | --- |
| R1.1 摘要 schema 太松 | 上下文税没省下，机制空转 | 语料库回放（真子代输出样本）；schema 严格度列为验收项 + D2 用基线 P90 定阈值 |
| R1.1' schema 太紧 | 补发风暴，子代被反复复活 | 同上语料库双向校准；补发次数计入 metrics 观测 |
| R1.2 自动补发死循环 | 单槽位永久占用 = 队列冻结 | once-guard（repairRetried）+ 变异探针（删 guard → 双补发必红）；guard 生命周期随 rearmChild 同点清理 |
| R1.3 补发复活与既有 revive/rearmChild 语义冲突 | 跨代际 guard 残留误吞正常 end | child-registry 生命周期测试（对照 :1584-1588 既有纪律） |
| R1.4 子代不遵守格式条款 | 退回现状（不更糟，设计内优雅降级） | 降级路径测试：无块/坏块全文照落 board、内核注入全文 |
| R1.5 board 目录无界增长 | 磁盘静默耗尽 | 本期 metrics 观测容量；GC 策略 = D14（可随第三期台账 v3 一并做） |
| R1.6 防回潮双守卫对新模块误报/漏报 | 单源红线失守或测试误红 | host-parity 四判据入册新标记；npm test 全绿为最终裁决 |

### 第二期
| 风险 | 后果 | 测试策略 |
| --- | --- | --- |
| R2.1 E2 spawningCandidates 歧义常态化 | **幽灵**：end 归错属主 | 并行双 spawn + 竞态 end 行为测试；归因键强化方案（2.1 文档）落地后回归 |
| R2.2 泳道容量计数泄漏 | 槽位永久占用 = 队列冻结变体 | 每个 end 出口的 lane 释放断言；变异探针：漏释放必红 |
| R2.3 备选重派跨 lane 串号 | **双份**：同任务两代理并行 | per-lane 槽位语义测试（重派占原 lane 槽）；E5/E6 并行双评估并发测试 |
| R2.4 快照桥形状变更打破面板/台账 | UI 崩 / RPC 解析错 | panel-format + host-lib-fixes 扩展；src 改动后 dist 新鲜度断言（apply.mjs:44-51） |
| R2.5 lane-aware skip 改变 FIFO 语义 | 既有用户预期被破坏 | D9 拍板 + go_work 文档措辞同步；乱序行为测试固定新语义 |

### 第三期
| 风险 | 后果 | 测试策略 |
| --- | --- | --- |
| R3.1 注入放大（M2 复发） | 子代产出被当指令执行 | 不可信数据块包裹 + 注入探针（伪造指令必须被包裹） |
| R3.2 链悬挂（gate 无人裁决/主编销毁） | **终局真空** | 挂起必有通知、销毁必清理留痕；真空探针测试 |
| R3.3 棒亡重派后续接语义错误 | 跳双执行（**双份**）或断链 | D10 先拍板；双执行探针：dead-baton 迟到 end + 新世代 end 各来一发，链只推进一次 |
| R3.4 自动接力绕过泳道锁 | 写平面单线地基被架空 | 一切 hop 派发走 dispatchWork/advanceQueue 同一入口 + 锁绕行探针 |
| R3.5 台账 v2→v3 迁移 | 重启后链状态丢失/坏档炸加载 | 迁移测试 + 坏档回退测试（loadLedger :306-324 模式） |

---

## 四、并行池与接力链 × end-attribution 八出口语义影响清单

> 逐条对照 shared/end-attribution.mjs:38-59。「现状」列是今天的行为（单线）；
> 并行/接力列是该出口在两机制下的语义变化与必须守住的线。

| 出口 | 现状（单线） | 读平面并行池 | 声明式接力链 |
| --- | --- | --- | --- |
| E0 ignore（无 childId） | 忽略 | **不变**。无 id 载荷仍忽略；lane 语义无从谈起 | **不变**。链状态机不得因 E0 推进任何跳 |
| E1 late-duplicate（台账有归属、活槽位没有） | 忽略 + advance='now' | 大体不变（finish 同步、JS 单线程无写竞态）；注意 advance='now' 在并行下=「推进**该 child 所属 lane**」，不得误推进另一 lane | **红线**：死棒迟到 end 绝不可推进链（链推进只认当前世代 childId）——幽灵跳防线 |
| E2 unattributable（在册无记录、spawning 占位不唯一） | 留痕 + if-owned 推进；占位「恰有一条才归因」 | **最大破坏点**：并行 spawn 下多条 spawning 占位是常态，「恰有一条」恒假 → 归因全掉 E2。必须改：优先 childOwner 直达路由（end 晚于 resolve 的正常路径不受影响），占位归因仅作兜底并需强化判别键（占位与 spawn 请求一一绑定的 nonce/label 序对）——二期 2.1 必须给方案 | 链中一棒的 end 掉 E2 = 链 stall。需链级兜底：链状态机对「应到未到的 hop 终局」有显式口径（挂起通知主编），不得无声悬 |
| E3 no-owning-orchestration（属主实例已销毁） | 清类型侧三表、留痕、不推进 | 不变（per 实例语义） | 属主销毁时**链状态必须随 orchestration 一并清理**（台账/内存双侧面），防链真空残留 |
| E4 expected-abort（urgency=abort 预期掐断） | 吞掉、槽位仍占、guard 无条件消费 | 不变（guard 按 childId 键，天然 per 棒）；并行下甲 lane 的 abort 与乙 lane 的正常 end 互不干扰——guard 键隔离已是现事实 | 棒被 abort：链进 suspended，**不得**把被掐轮的 end 当 hop 终局推进；续轮自己的 end 到达才恢复 hop 判定（续轮仍占槽语义与现状一致） |
| E5 fallback-in-flight（备选评估窗口内双发第二发） | 不矛盾口径、不推进 | once-guard per childId 不变；两个 lane 各自在飞评估互不影响。「槽位仍被评估占用」要明确为**该 lane 槽**——另一 lane 的推进决策不得被它冻住 | 棒亡进备选评估：链状态 = pending-fallback（D10 决议挂起点）；评估期间链不推进、不发矛盾口径 |
| E6 fallback-evaluation（error + 有链 + 本代际未决策） | guard add + 同步预告 + 异步重派；advance='no' | 协议第 1 条（同步段零 await）逐字保留；advance='no' 细化=「本 lane 不推进」；两 lane 并发评估时 pickFallbackEntry 的模型 I/O 并发安全（无共享可变状态，现实现已满足） | **D10 核心**：重派成功后链是否续接新世代。选项 A 自动续接（链绑「槽位/角色」而非 childId）vs 选项 B 挂起等主编裁决。规划建议 B（更安全，与不可逆跳同纪律），须维护者拍板 |
| E7 finalize（正常收尾落账） | 落账 + advance='now' | advance='now' 细化=「推进被释放的那个 lane」；shouldAdvanceQueue(:256-269) 扩 lane 维度；advanceQueue(:675-689) lane-aware | finalize 且链在 auto 跳 → 触发 hop 推进：board 取文 → 组下一棒 prompt → **走 dispatchWork 同一入口**（锁不可绕）；hop 推进与队列推进的先后顺序必须在 3.1 文档固定（建议：先链内决策出下一棒入队，再统一 advanceQueue） |

**幽灵 / 双份 / 终局真空 三红线映射**：
- 幽灵（归属错误）：并行 E2 占位歧义（R2.1）；链 E1 迟到 end 推进跳（R3.3 探针）。
- 双份（同任务两执行）：并行 E6 跨 lane 重派串号（R2.3）；链棒亡后 dead-baton 迟到 end
  与新世代 end 各推进一次（R3.3 探针：两发 end 链只进一跳）。
- 终局真空（无人报终局）：链挂起无通知 / 主编销毁链残留（R3.2）；并行 lane 槽泄漏
  导致队列永久冻结（R2.2）。

---

## 五、决策空白（须维护者拍板，本规划不擅自定）

| # | 问题 | 选项 | 规划建议（仅供参考） | 阻塞步骤 |
| --- | --- | --- | --- | --- |
| D1 | report_fetch 的 offset/limit 单位 | 行 / 字节 | **行**（模型友好、totalLines 可预告） | 1.1 |
| D2 | 摘要 schema 严格度阈值（conclusion 上限、evidence 是否允许「无」占位） | 宽 / 中 / 严 | 用第 0 期基线 P90 定，先中档 | 1.2（可带默认动工） |
| D3 | continue 路径不另找接缝、接受首派即覆盖 | 接受 / 另找接缝 | **接受**（continue 保留上下文，条款自然存续；接缝成本大于残余风险） | 1.4 |
| D4 | 补发的投递档位 | queued（复活新轮）/ steer / abort | **queued**（对象已 end，走 revive 新轮，urgency 语义不适用） | 1.5 |
| D5 | 各期开关默认值 | 每期默认开 / 默认关观察一期再开 | **已裁决：一期默认开，二、三期默认关**（与 2.6 的 `readPoolSize ?? 1`、3.7 的 `relayChains ?? false` 口径自洽；一期 reportExternalization 默认开） | 1.7 / 2.6 / 3.7 |
| D6 | metrics 默认值与保留策略 | 默认开+cap / 默认关 | 第 0 期默认开（采基线是第一目的），行数 cap 兜底 | 0.1 |
| D7 | looker 是否入读平面 | 读 / 写 | 设计只点名 explore/librarian；looker 读性质强但多模态成本异质——**默认写 lane 保守** | 2.2 |
| D8 | 自定义角色 lane 归属 | 默认写 / 可配置 | 默认写（安全）；roles schema 加可选 lane 键可放二期后话 | 2.2 |
| D9 | 并行下队列语义 | lane-aware skip（乱序派发）/ 严格 FIFO 头阻塞 | lane-aware skip + 每 lane 内 FIFO（否则读池被队首写任务堵死=机制空转） | 2.1→2.3 |
| D10 | 棒亡备选重派后链是否续接 | A 自动续接新世代 / B 挂起等主编 | **B**（与不可逆跳同纪律；链绑槽位的语义复杂度后置） | 3.1（先设计清再写码，设计原话） |
| D11 | 链声明载体与裁决通道形态 | 新工具 chain_start+chain_resolve / go_work 扩展参数+continue 约定格式 | 新工具对（schema 干净、deny 面清晰），但工具面膨胀需维护者认可 | 3.3 / 3.5 |
| D12 | 链状态是否跨重启持久化（台账 v3） | 持久化 / 仅内存 | 持久化（与台账纪律一致；v2→v3 迁移按 loadLedger 兼容模式） | 3.2 |
| D13 | 读→写挂起的超时策略 | 永久挂起等主编 / 超时升级提醒 | 永久挂起 + 每次主编回合快照里带 suspended 链行（可观测兜底） | 3.5 |
| D14 | board 目录 GC 策略 | 按 sessionId 惰性清 / 保留期扫描 / 不清 | 第一期先观测（metrics），第三期随台账 v3 一并做保留期扫描 | 1.5 之后任意 |
| D15 | Sisyphus 编排指引段是否补 report_fetch/链用法一句 | 补 / 只靠工具 description | 只靠 description（工具描述自教，防 system prompt 膨胀）；如实战发现主编不会用再补 | 1.7 / 3.7 |

---

## 附：关键事实锚点（核读自证）

- 内核全文注入不可抑制：node_modules/@deepseek-ai/dsh-subagent/lib/index.js:1771-1777（explore 取证）
- 台账路径与原子写模式：broker.mjs:304 / :340-373 / :381-387
- spawnChild 唯一共用组装点：broker.mjs:722-749（prompt 数组 :731-741）
- continue 不经 spawnChild：走 shared/adjacent.mjs（事实 C）
- 六件套名单：constants.mjs:39；子代理 deny 闸：broker.mjs:1411-1414；主编 deny：:1426
- 单线锁：shared/orchestration.mjs:54；队列推进唯一决策点：broker.mjs:1819
- 备选重派：broker.mjs:1636-1731；八出口纯函数：end-attribution.mjs:38-269
- E8 段全文提取：end-attribution.mjs:178-182
- config 挂载轨：agent.cordis.yml:148-149 + broker.mjs:87/:132-139
- settings schema 三块：lib/index.js:308-316（本规划不动 settings，全走 broker config）
- 防回潮守卫：test/apply.mjs:24、test/host-parity.test.mjs:85-100
- 版本号段：CHANGELOG.md:6-19 命名空间声明；tisitan.13~20 全在 0.2.3 线已发布批
