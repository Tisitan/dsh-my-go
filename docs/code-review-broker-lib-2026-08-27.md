# dsh-my-go v0.2.3-tisitan.10 核心运行时代码审查报告

> 审查对象：`preset/tools/broker.mjs`（1627 行，agent 平面）＋ `lib/index.js`（1541 行，host 平面）
> 方式：只审不改。逐函数通读＋外围交叉验证（cordis.patch.yml / preset.yml / package.json / prompts/*.md / test/*.{mjs}）
> 结论速览：**0 Critical / 3 Major / 7 Minor / 7 Nit**；八处历史雷区均确认修复在位，多会话隔离主体成立。

---

## 一、发现清单

### 【Major】M1 — need_help 上报失败被完全静默，求助单可能永悬

- **位置**：`preset/tools/broker.mjs:1208-1215`；`lib/index.js:1139-1146`
- **问题**：`suspend()` 先落账、随后 `await ctx.subagents.reportFrom(...)` 上报到父会话；catch 分支为纯空吞：
  ```js
  } catch {
    // Report failure must not break the suspension bookkeeping.
  }
  ```
- **触发场景**：harness 通知链路瞬时故障、父会话注入通道拒收。此后求救单已入 `helpRequests`、记录已 `waiting`，父会话却**收不到任何信号**——子代理无限期悬挂，直到属主会话完工/销毁才被 `clearHelpFor` 顺带清理。Sisyphus 若不主动查 `orchestration_status` 无法察觉。
- **对比**：本项目对失败附因推送（tisitan.8）、队列停摆等都做了「绝不静默」原则（dropQueuedFailed 有 console.error、dispose 兜底有 console.warn），唯独这条最关键的「 SOS 丢失」路径零留痕，是原则贯彻的漏网点。
- **建议**：catch 内至少 `console.warn('[dsh-my-go] need_help report delivery failed for ${id}')`；更优做法再走一次 `notifyParent(parent, '求助单 … 未能送达，请查看 orchestration_status')` 二次触达。

### 【Major】M2 — forward 将 help.content 原文裸传为新 prompt：跨信任边界的注入放大器

- **位置**：`preset/tools/broker.mjs:1255 + 1271-1273`（childId 分支）、`:1259`（类型分支）；`lib/index.js:1186 + 1202-1204`
- **问题**：`const prompt = help.content` 之后直接作为 followup/go_work 的指令文本。help.content 来自任意子代理（Explore 读过的网页/文档/恶意代码、Hermes 处理的用户文件都可能携带注入载荷）。转发时无任何来源标注——目标代理看到的是一条「看似 Sisyphus 直接下达」的裸指令。
- **攻击链示意**：外部内容诱导 Explore 发起 `intent=execute` 的 need_help（附精心构造的命令原文）→ Sisyphus 例行走 forward 审批习惯 → 内容原样成为 Hermes/hephaestus 的首条指令 → 越过 Explore 自身的能力边界完成提权动作。
- **缓解现状**：仅有 `prompts/sisyphus.md:139-148` 的提示词层约束（人工审批代执行是例外）；协议层零防护。
- **建议**：转发时包裹结构化信封，例如 `<forwarded-help from="${help.id}" source-child="${help.childId}" intent="${help.intent}">…</forwarded-help>`，让目标代理明确区分「转发材料」与「Sisyphus 直接指令」；同时剥离 content 内伪 `</need_help>` / `<system-reminder>` 片段（见 M3）。

### 【Major】M3 — need_help 上报体的 XML 包裹可逃逸

- **位置**：`preset/tools/broker.mjs:1211`；`lib/index.js:1142`
- **问题**：`<need_help id="…" intent="…" child="…">\n${args.content}\n</need_help>` 中 `args.content` 未做任何转义。content 含 `</need_help>` 即闭合外框并在其后伪造自由文本块；也可伪造下一个 `<need_help …>` 或 harness 风格标记。
- **后果**：父会话观察面的结构完整性被破坏。单点危害有限（这些文本本来就是发给 Sisyphus 看的材料），但与 M2 组合构成完整注入链的上游工装。
- **建议**：`escapeXml(content)` 或 JSON 编码整包后再嵌入。

---

### 【Minor】m1 — 双半不一致：lib.dispatchWork 不校验 binding.model 即写入 agentOptions

- **位置**：`lib/index.js:947-949` vs `preset/tools/broker.mjs:991-999`
- **问题**：broker 半直发前先 `modelExists(resolvedProvider, binding.model)` 校验，不存在则不设；lib 半只要 `binding.provider/model !== undefined` 就无条件全塞进 `agentOptions`。
- **后果**：fallback 部署形态（仅 lib 激活）下，配置了一个 provider 上不存在的模型 → spawn 时 agentOptions 带脏 model。目前下游有 lib 自己的 `agent/request` waterfall 二次校验兜住（`lib/index.js:1377-1384`），最终请求不至于失败，但中间态与 broker 半行为不对称，且 waterfall 兜底是隐式耦合。
- **建议**：抽公共函数或在 lib 补齐同款校验（见 n5 的去重建议一并解决）。

### 【Minor】m2 — 双半不一致：go_work 首条消息的 persona 包装只在 broker 半

- **位置**：`preset/tools/broker.mjs:1008-1010`（`<system-reminder>roleInfo</system-reminder>` 包装）；`lib/index.js:943-945`（裸 prompt）
- **后果**：同一 prompt 经两半派发产生结构不同的子代理首条消息；fallback 形态下子代理完全没有角色注入，调度质量与主形态不对齐。
- **建议**：低优先（fallback 本就降级），但应双向注明 or 共享构建函数。

### 【Minor】m3 — continue/forward 可跨编排实例控制他人流水线的子代理

- **位置**：`preset/tools/broker.mjs:636-659`（findRecordEverywhere/findHelpEverywhere 全局扫描）、`:1119`、`:1252`
- **问题**：多会话隔离把**队列与槽位**隔开了，但 record/help 的解析域是全局的——A 会话的 Sisyphus 可以 continue、resume、resolveHelp B 会话的孩子。需要他人实例 busy 时还会弹 single-line-blocking 错误，进一步暗示操作了不属于自己管的对象。
- **评估**：全局扫描是有意保留的兼容特性（重启后 v1-'legacy' 台账复活、childOwner 边缘态兜底都依赖它），单机单用户下风险低。但在多窗口/未来多用户场景是一个真实的误伤与权限面。
- **建议**：保留全局扫描作兜底，但命中**非本实例**记录时 `console.info` 留痕；或将『legacy/全局命中』分支限定为只读+显式参数开启的可控复活。

### 【Minor】m4 — spawning 歧义归因丢弃整条 end，结论进黑洞

- **位置**：`preset/tools/broker.mjs:1568-1591`；`lib/index.js:1467-1490`
- **问题**：`hit === 'ambiguous'`（≥2 个实例各有一个 spawning 记录）时该 end 被 ignore 返回，结论无处落账、无 failed 历史。「拒绝乱绑」方向正确，但被绑定的 spawning 记录之后只能依赖 startContinuable 正常 resolve→bindChild，以及 dispose 兜底 abort（同样**不写**任何 history，见 m7）收场。
- **后果**：该孩子的真实失败原因/结论永久丢失（仅 console.warn 两行），observability 黑洞。
- **建议**：ignore 前 if 该 spawning 记录有对应 queuedWork/dispatch 进行中，可预写一条 `status:'failed'` 占位史（conclusion 注明 attributed later）；至少在 ambiguous 分支把两个候选记录 id 一并打进 warning，方便事后人工归因。

### 【Minor】m5 — orchForStatus 对未知 id 过度懒建，Map 播种幽灵桶

- **位置**：`preset/tools/broker.mjs:1293-1304`；`lib/index.js:1224-1235`
- **问题**：`exec.agent.id` 存在但既不是编排者也不是任何 tracked child 时（已摘除登记的子代理、陌生会话），走到 `return orchFor(id)` —— **新建**空流水线塞进 `orchestrations`，parents 快照从此多出一个全空的幽灵分桶，直到（可能永不到达的）`session/disposed` 才清理。
- **建议**：懒建前先经 `ctx.get('agents')?.get(id)` 验证这是一个现存非子代理会话；验证不过返回 undefined 报 idle。

### 【Minor】m6 — v2 台账分桶无 TTL/GC

- **位置**：`preset/tools/broker.mjs:677-694, 700-719`；`lib/index.js:707-749`
- **问题**：loadLedger 把历史所有 parentId 恢复为常驻 Orchestration 实例（含 `'legacy'`）；scheduleLedgerSave 每次全量 stringify 所有分桶。废弃编排会话的桶（几百字节/桶）随时间线性累积，bump() 全树重建与落盘体积同步增长。量级小（200 条 cap/桶），但长期运行且台账翻新频率高的部署会缓慢劣化。
- **建议**：恢复时按 `updatedAt` 修剪 N 天前的桶；或提供 `reset` RPC 与 WebUI 按钮。

### 【Minor】m7 — disposed 兜底 abort 不写 failed 史

- **位置**：`preset/tools/broker.mjs:521-530`；`lib/index.js:534-548`
- **问题**：宽限期后 end 仍未到的孩子被 `clearHelpFor+abort` 清槽推进，台账中不留任何痕迹。对比同类兜底（queue abandon 有 dropQueuedFailed 落 failed 史），此处闭环弱一档：Sisyphus 事后只能查 console.log 无法从台账复盘「谁没了」。
- **建议**：abort 前调 `orch.finish(id, '(disposed without subagent/end within grace)', true)` 的等价物（finish 需要 currentMap 记录，正好满足）。

---

### 【Nit】

| # | 位置 | 说明 |
|---|------|------|
| n1 | `broker.mjs:394-399`；`lib/index.js:416-421` | `dropQueuedFor()` 生产代码零调用（仅测试用）。删除或注明预留意图。 |
| n2 | `broker.mjs:179`；`lib/index.js:237` | `readArchivedTurnFailure` 用 `readFileSync` 同步读整个 zstd 容器——subagent/end 是事件回调，大档案（长对话子代理）会造成毫秒~几十毫秒级事件循环卡顿。低频失败路径可接受；超阈值时建议异步化或 size-cap。 |
| n3 | `broker.mjs:251-255`；`lib/index.js:273-277` | `nextId` 的 seq 进程级且不持久化，重启归零。同 ms 内同前缀理论撞 ID；概率趋零，留意即可。 |
| n4 | `broker.mjs:41-54` | promptCache 把读取失败缓存为 null 且永不重试——升级换版本瞬间并发加载的老进程会以 fallback 人格跑完整个生命周期。失败也应下次重试。 |
| n5 | 全局 | 两半约 900 行结构性复制（Orchestration 类全文、zstd 扫描、五个 tool 定义、bump/orchFor 族全部两份）。注释都用「与 broker.mjs 同构」承认了这点；m1/m2 就是漂移的实锤。建议抽 `shared/orchestration-core`（node_modules 内相对 import 可行的形态）。 |
| n6 | `broker.mjs:661-667`；`lib/index.js:808-872` | snapshot/listModels/saveSettings 均 trusted-host。快照 JSON 含未截断的 helpRequests.content 与 history.prompt/conclusion（渲染层截断不影响 RPC 载荷）——对本机 WebUI 属合法消费，但对同机任意本地 web 页面＝可通过 localhost RPC 打捞编排全量 prompt/结论。局域网绑定部署时值得收紧 authority。 |
| n7 | `broker.mjs:555-589`；`lib/index.js:592-626` | settings 合并循环在同文件内重复两份（load + settings/updated），加上 lib 一份共三份逐字段复制的合并体。抽 `mergeBindings(stored, base)` 单点维护，顺带消除漂移温床。 |

---

## 二、历史雷区复查清单（是否真修好 / 有无回归）

| # | 雷区 | 结论 | 关键证据 |
|---|------|------|----------|
| 1 | 先投递后落账 | ✅ 修好，无回归 | continue/forward 均先 `await followup()` 成功后才 revive/resume/followupPrompt/resolveHelp（`broker.mjs:1134-1153, 1264-1285`）；投递失败抛错，不留假 running、不弄丢求助单。forward 类型分支同理先 dispatchWork 后 resolveHelp（`:1259-1261`）。 |
| 2 | disposed 抢跑吃完工记录（墓碑+500ms 宽限） | ✅ 修好，带回归测试 | agent/disposed 仅 `tombstoneType + scheduleDisposeFallback`（`broker.mjs:1414-1421`）；subagent/end 先 `cancelDisposeFallback` 再正常落账（`:1542-1543`）；反向序（end 先于 disposed）无害（tombstoneType 幂等返回 false）。bridge.test.mjs:161+ 锁定该顺序。孤儿定时器经 plugin-unload effect（`:943-948`）与 end/session-disposed 三路取消，无泄漏。 |
| 3 | signal undefined 归一化 | ✅ 修好 | `dispatchWork` 统一 `sig = signal ?? new AbortController().signal`（`broker.mjs:973-977`）；测试 mock 复刻 startContinuable 真实契约（throwIfAborted 无条件解引用），bridge.test.mjs:102+ 断言队列路径重试全胜。 |
| 4 | 队列上岗映射 work-*→childId | ✅ 修好 | queuedWork 上岗后 `notifyParent(parent, '[dsh-my-go] 队列任务上岗: …→ …')`（`broker.mjs:1024-1029`）；失败留在队列 → Sisyphus 视角自洽（还在排队）。 |
| 5 | 失败附因读持久化档案（zstd 多帧） | ✅ 修好，健壮 | live 快路径→持久化主路径双轨（`broker.mjs:758-773`）；scanZstdFrameRanges 对撕裂尾帧截断、坏 magic/保留位 fail-fast；倒序帧×倒序行取最新 error，仅收 `message:string`。所有失败分支 console.warn 留痕。唯一瑕疵=n2 的同步 IO。 |
| 6 | 台账持久化防抖 | ✅ 修好 | 250ms debounce + Promise chain 串行化 + unref + unload effect 清 timer（`broker.mjs:698-725`）；v1/v2 双格式装载兼容。进程退出窗口≤250ms 变更可失——设计取舍，注释已声明。 |
| 7 | settings 从 baseBindings 起算 | ✅ 修好，双半一致 | 两半都以 `{ ...defaultBindings(), ...(config.bindings) }` 为基线（`broker.mjs:536`；`lib/index.js:551`），merge 每轮重建对象从基线起算 → WebUI unset 字段正确回落默认。注册面只在 lib 半，broker 半只读并注释警告勿二次注册。唯一残留=n7 的三份复制。 |
| 8 | 星型拓扑闸 | ✅ 修好 | 目录层 deny `[subagent, subagent_fork, workflow, ralph, go_work, continue, forward]`，need_help/status/list_subagents 保留（`broker.mjs:1386-1405`）＋ canOrchestrate 运行时守卫双层；Sisyphus 主会话反手 deny skill 省上下文。异常吞掉不阻断创建。 |
| 9 | 多会话隔离（本次重点增量） | ✅ 主体成立，残留 m3 | per-session Orchestration（key=parentId）隔离队列/槽位/求助单/历史；childOwner 直达路由＋全局扫描兜底；subagent/end 只推属主队列；session/disposed 整线销毁不影响他桶；spawning 归因限定「恰一可归因」避免跨桶串号。multi-session.test.mjs 四用例覆盖核心断言。 |
| 10 | 快照桥 Symbol.for('dsh-my-go.snapshot') | ✅ 成立 | broker 发布 latestSnapshot getter；host RPC snapshot 优先读桥、缺桥回落自带状态机（`lib/index.js:813-815`），形状 `{seq, parents}` 由双侧 bump() 统一保证。 |

---

## 三、优秀设计确认

1. **「任务不蒸发」三段式收口**：队列派发失败 → requeueHead 保持队序 → 线性退避重试（timer.unref 不挡退出）→ 超 cap 后 dropQueuedFailed 落 failed 史 + console.error + 继续消化后续。任何一段都有落账与日志，无静默滞留路径。
2. **spawning 归因的克制**：唯一可归因才 bindChild，歧义即弃（配合 m4 可更好），彻底杜绝 tisitan.6 的历史串号根因。
3. **负缓存规避**：effortCache/modelCache 均只缓存查询成功结果，llm 服务瞬时缺席不会把 effort/模型绑定在本进程生命期内永久打哑——这类「宁可重试不可错记」的取舍贯穿全局。
4. **父会话兜底上移**：advanceQueue 按 `work.parentId` 从 agents 注册表现取现用，父会话死亡自动走 retry→abandon 排空成 failed 史；注释里还明确否决了 `agents.roots()[0]` 这种会跨会话漏任务的写法（`lib/index.js:926-928`）。
5. **错误消息可直接行动**：unknown sub-agent id 的报错自带「是否重启过/是否被 200 条上限挤出 + 请 go_work 重派」诊断指引，运维摩擦小。
6. **墓碑 FIFO 有界（cap=50）＋ 500ms 宽限**：竞态表全部有界化，杜绝 Map 无限增长型内存漏。

---

## 四、待决事项汇总（按优先级）

1. M1：need_help 上报失败的静默兜底 —— 一个 catch 块的事，性价比最高。
2. M2+M3：forward 信封化 + need_help 转义 —— 安全面，建议打包做。
3. m1+m2+m5：lib 半对齐 broker 半的三处（model 校验/persona 包装/status 懒建收敛）——可与 n5/n7 的双半去重构一起规划。
4. m4/m7：两处 observability 收口（ambiguous 预落账、disposed 兜底落 failed 史）。
5. m3/m6：跨实例 continue 留痕、台账分桶 TTL —— 择机。
