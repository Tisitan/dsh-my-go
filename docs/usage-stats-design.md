# dsh-my-go 用量统计「按父会话 × 按模型」契约设计（v1 定稿）

> 状态：设计定稿（0.4.0-tisitan.x 线）。本文是**契约**，不是实现说明：
> 后续施工（Hermes/Hephaestus）以本文为唯一规格源，不再二次设计。
> 前置：可行性调研已结案（2026-09-06 会话，tisitan.9 相位坑与读取双路径已采信）。

## 1. 背景与目标

两个需求：

1. **模型单价表**：可视化设置中由用户自填每模型单价；未定价的模型只记 token、不计成本。
2. **用量面板**：以当前打开的主会话为口径，面向 30+ 子代规模，提供三视图
   （按模型 / 按子代 / 合计），running 子代数据实时可见（随 600ms 面板轮询刷新）。

架构铁律（继承既有裁决）：**落账只存 token 事实，渲染层乘单价**。
token 聚合与价格解耦：单价热更零失效成本，聚合缓存永不因价格变动失效。

## 2. 术语与已采信数据源

本文引用行号均已核对（2026-09-06 工作区快照）。施工时若行号漂移，以描述语义为准。

| # | 事实 | 来源 |
|---|------|------|
| F1 | usage 随 `assistant/message` 事件落盘，`usage?: TokenUsage` | node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:295 |
| F2 | `TokenUsage` 六字段：`inputTokens`/`outputTokens` 必填；`totalTokens?`/`cacheReadTokens?`/`cacheWriteTokens?`/`reasoningTokens?` 可选。**Disjoint 承诺仅覆盖 input 侧三桶**（`inputTokens` 为未缓存输入，cacheRead/cacheWrite 单列，billed input = 三者之和）；`totalTokens` 是派生冗余（"preserve a provider total **or derive it**"，口径允许缺席或不一致）；`reasoningTokens` 无任何 disjoint/归属承诺 | node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:115-137 |
| F3 | 模型归因最权威：`request/header` 事件 `data.config.{provider,model}`（`EpochHeader.config: LlmCallConfig`，含 provider/model/reasoningEffort/sampling） | dsh-session types.d.ts:196-210 |
| F4 | live 快路径：`ctx.get('sessions')?.get?.(childId)` + `sessionEvents()`（`snapshotEvents` 特性探测适配；坏档/已关闭回落空数组） | preset/tools/broker.mjs:548-565 |
| F5 | continuable 子代 end 时 live store **先摘除**（capture→dispose→settle，subagent/end 晚于摘除发射）→ 持久化档案是主路径：`readFileSync` + `scanZstdFrameRanges` + `zstdDecompressSync` 逐帧解压 + 逐行 `JSON.parse`（截断末行跳过） | broker.mjs:543-547 注释；preset/shared/archive.mjs:147-207 |
| F6 | 子代枚举持久权威：台账 `DSH_HOME/dsh-my-go/orchestration-ledger.json`，无上限；`childOwner`/`sessionTypes` 内存表是 broker 侧互补（lib 半不可达，本契约不依赖） | broker.mjs:354；preset/shared/child-registry.mjs:38-46 |
| F7 | **复活即新世代**：continue/forward 命中已结束记录时 `rearmChild` 回填登记，childId 不变、产生新事件代际 | child-registry.mjs:113-140 |
| F8 | 面板 600ms 轮询 `connection.rpc.call('/dsh-my-go','snapshot',{})`；`currentSessionId()` 读 `sessions.list.getSnapshot().current` | src/panel-tree.js:78-99, 429-438 |
| F9 | RPC 单通道：`rpc.handle('/dsh-my-go', async (endpoint, payload) => ...)`，端点 camelCase（snapshot/listModels/listTools/getBuiltinPersona/loadSettings），信封 `{ok:true,value}` / `{ok:false,error:{code,message,details}}`，端点自带 try 回结构化 internal | lib/index.js:394-426 |
| F10 | settings 注册样板：`settings.register('dsh-my-go', z.object({...}))`，字典用 `z.dict(schema, z.string().pattern(KEY_PATTERN))`；`settings/updated` 热更两侧各挂 | lib/index.js:319-329, 346-353；broker.mjs:241-252 |
| F11 | metrics end 埋点 `METRICS.record({kind:'end', childId, agentType, ...})`（v1 不搭车，裁决见 D2） | broker.mjs:2666-2679 |
| F12 | lib 半可直接 import preset/shared（先例：`sharedRosterKeys`） | lib/index.js:367 |

## 3. 契约总览

```text
┌─ settings: dsh-my-go.usagePrices ─┐     ┌─ 事件流（双路径读）────────────┐
│  "{provider}/{model}" → 四桶单价   │     │ live: sessions.get + snapshot │
│  (USD / 1M tokens，渲染层消费)     │     │ archive: zstd 逐帧（F5）       │
└──────────────┬────────────────────┘     └──────────────┬────────────────┘
               │ settings.get 实时 join                    │ 游标增量 reducer
               ▼                                          ▼
        ┌──────────────── getUsage 端点（lib 半 RPC branch，F9）────────────┐
        │  per-child 游标缓存（内存，LRU by parent）→ {children, byModel,   │
        │  totals}，token 事实；价格只在组装响应时 join，不进缓存            │
        └──────────────────────────┬─────────────────────────────────────┘
                                   ▼ 600ms 轮询
                     面板三视图（按模型/按子代/合计）——同一响应派生
```

## 4. 决策记录

### D1 — 单价表键格式：`"{provider}/{model}"` 扁平字典键

**裁决**：settings 新增顶级键 `usagePrices`，形态为**扁平字符串键字典**：

```jsonc
// settings.get('dsh-my-go').usagePrices
{
  "newapi/k3-256k":    { "input": 2,  "output": 8,  "cacheRead": 0.4 },
  "anthropic/claude-sonnet-4": { "input": 3, "output": 15 }   // cache 两桶缺省=未定价
}
```

- **key 串形态**：`"{provider}/{model}"`。**只在第一个 `/` 处切分**：左侧为
  provider（DSH provider 注册 id，不含 `/`），右侧整体为 model（**允许含 `/`**，
  如 OpenRouter 风格 `openrouter/deepseek/deepseek-chat`）。切分规则写进
  `PRICE_KEY_PATTERN` 校验（要求非空 provider 前缀 + 非空 model 余部）。
- **value 结构**：`{ input: number, output: number, cacheRead?: number, cacheWrite?: number }`。
  `input`/`output` 必填；cache 两桶可选，缺省 = 该桶未定价。
- **单位固定 USD per 1M tokens**。设置页编辑卡 label 明示「USD / 1M tokens」。
- **schema**：`z.dict(priceSchema, z.string().pattern(PRICE_KEY_PATTERN))`，
  完全对齐 `roles` 字典样板（F10）。数值校验：必填桶与可选桶均须为有限、非负；
  负数/NaN/Infinity 在写入时拒绝（settings-core revision 围栏内校验）。

**理由**：
1. 归因数据源是 `request/header.config.{provider,model}` 精确对（F3），键与数据源
   同构，聚合时零转换、零归一化歧义。
2. 对齐仓库先例：上游白名单 `agentSchema.fallbacks` 就是 `{provider, model}` 精确对
   （lib/index.js:308），`roles` 就是扁平 `z.dict`（lib/index.js:323）。
3. 同一 childId 备选重绑换 provider 后，纯 model 名键会大面积 unmatched；
   精确对只影响旧 provider 段（该段本来就换了渠道），新段精确命中。

**否决的备选**：
- ❌ 纯 model 名键：跨 provider 同名模型价不同（中转渠道重标价常态），串价。
- ❌ 嵌套对象 `{provider: {model: price}}`：两层导航 UI 复杂；与 `z.dict` 编辑器
  样板（F10 roles/tool-mask 卡）不匹配；`"a/b"` 归属歧义（provider=a,model=/b？）。
- ❌ 通配符/前缀匹配（`newapi/*`、`*` 兜底价）：引入匹配优先级冲突消解（YAGNI）；
  且兜底价把「没配」静默变成「配错价」，违反反静默原则——unmatched 显示「—」
  是诚实的，错价不是。
- ❌ 价格编码进 key 的单串（`"newapi/k3:2/8"`）：解析地狱，且含 `/` 的 model 彻底歧义。
- ❌ 每 token 单价 / 人民币计价：数字过小易错、跨行不可比；业界报价
  （LiteLLM/OpenRouter/官方 pricing）默认 $/MTok，复制粘贴零换算。

**TokenUsage 六字段处置（F2 的契约级裁决）**：
| 字段 | 处置 | 依据 |
|------|------|------|
| `inputTokens` | 计费桶 × `price.input` | F2 disjoint 承诺 |
| `outputTokens` | 计费桶 × `price.output` | F2 |
| `cacheReadTokens` | 计费桶 × `price.cacheRead`（缺价→不计，见降级矩阵） | F2 |
| `cacheWriteTokens` | 计费桶 × `price.cacheWrite`（同上） | F2 |
| `totalTokens` | **v1 完全不消费**（不存储、不展示、不计费）。展示层「总计」由已知桶自行求和 | F2：派生冗余且口径允许与分桶不一致，采纳即重复计数 |
| `reasoningTokens` | **v1 完全不消费**。按子集语义处理（业界惯例 `reasoning_tokens ⊆ completion_tokens`，即已含在 outputTokens 内），上游无 disjoint 承诺（F2），若另设计费桶必然双计。单价表不设此桶；上游注释日后明确 disjoint 关系再议 v2 | F2：注释缺失 + 双计风险 |

### D1a — 单价表币种：全局单选 `usageCurrency`（'USD' | 'CNY'，默认 'USD'）

> 0.5.0-tisitan.0 施工后追加（维护者真机反馈：四桶裸数字 + 只有美元，难填）。

**裁决**：settings 顶级键 `usageCurrency: z.union(['USD', 'CNY']).default('USD')`，
整张单价表共用一个币种；`getUsage` 响应组装时随价格 join 一并回显 `currency`
字段（R6 同点实时读，不进缓存），面板成本列按响应币种渲染符号（USD→$、CNY→¥）
并在成本列头注明。D1 的「单位固定 USD」条款自本条起被「单位随 D1a 币种」取代，
per-1M-token 口径不变。

**否决的备选**：
- ❌ 按行币种：同一成本列混币种求和无意义（汇率波动使合计随时刻漂移），合计视图
  必须单一计价单位；全局单选使「币种」成为表级元数据而非行级字段，编辑与展示都
  零换算。

### D2 — 聚合策略：on-demand 游标增量扫描 + per-child 冻结缓存

**裁决**：聚合只在 `getUsage` RPC 请求到达时执行（面板 600ms 轮询驱动），配合
**每子代游标缓存**；子代终态后一次全量扫并冻结。否决每 600ms 全量重扫。

**缓存结构**（进程内存，不持久化；实现于 lib 半 getUsage 端点闭包内）：

```js
// Map<parentSessionId, ParentCache>
ParentCache = {
  touchedAt: number,                    // LRU 依据，每次 getUsage 触达刷新
  children: Map<childId, ChildCache>
}
ChildCache = {
  lastSeq: number,                      // 已消费的最后一个事件 seq（含）；0=未开始
  frozen: boolean,                      // 终态全量扫完成；true 后零 IO
  currentKey: { provider: string|null, model: string|null },  // request/header 游标
  segments: SegmentAgg[],               // 按 currentKey 归并的 token 累计段
  messageCount: number,                 // assistant/message 事件计数（含无 usage 帧）
  partial: boolean                      // 扫描不完整（坏帧/档案不可读/EOF 截断）
}
```

**扫描双路径**（每轮 getUsage，对每个未 frozen 的 child）：

1. live 快路径：`ctx.get('sessions')?.get?.(childId)` + `sessionEvents()`（F4），
   从 `lastSeq` 起增量消费；store 摘除/服务缺席 → 落第 2 步。
2. 档案主路径：新增 `readArchivedUsage(childId, fromSeq)`（archive.mjs 同族：
   `scanZstdFrameRanges` + 逐帧 `zstdDecompressSync` + 逐行 parse，F5）。
   同步实现，对齐既有模式；frozen 后不再触发，30+ 子代规模一次性成本可接受。

**事件 reducer 状态机**（live 与档案共用，逐帧顺序消费）：

| 帧类型 | 动作 |
|--------|------|
| `request/header` | `currentKey = { provider: data.config.provider ?? null, model: data.config.model ?? null }`；字段缺席保持 null（→ unknown 段）。每请求都重发 header 也幂等 |
| `assistant/message` | `messageCount += 1`；若带 `usage`（F1）：按 `currentKey` 定位/创建段，四桶累加；该帧缺席的桶记段级 `partial`；无 `usage` 则仅计 messageCount |
| 其他事件 | 跳过 |

**缓存失效/冻结规则表**（契约核心，施工照此实现）：

| # | 触发 | 动作 | 理由 |
|---|------|------|------|
| R1 | 会话切换 | 缓存按 `parentSessionId` 分桶互不干扰；切回时续用（touchedAt 刷新），不重扫 | 视图口径仅随 currentSessionId 换桶（F8） |
| R2 | LRU 淘汰 | 同一进程内保留最近 **4** 个 parent 的 ParentCache，超出淘汰 touchedAt 最旧整桶 | 30+ 子代 × 数百帧的内存占用有界 |
| R3 | 子代终态（台账 end） | 全量扫一次（live 已摘除→走档案，F5）→ `frozen=true`；此后轮询零 IO | 终态事件不可变，档案追加写不回改 |
| R4 | frozen 后复活（continue/forward，F7） | getUsage 时比对台账记录状态：终态→活跃 转变则 `frozen=false`，从 `lastSeq` 续扫（新代际帧由 `request/header` 自然切开新段） | 「复活即新世代」要求冻结可逆，否则复活后的用量静默丢失 |
| R5 | host 重启 | 内存缓存全空；首个 getUsage 全量重建（活跃 child 走 live 全量+续增量，终态 child 走档案一次扫） | 不持久化聚合结果（写放大 + 失效复杂化，YAGNI） |
| R6 | 单价变更 | **缓存不失效**。价格不入缓存，响应组装时 `settings.get('dsh-my-go').usagePrices` 实时 join | token 事实与价格解耦（本文铁律）；settings/updated 热更链路（F10）无需挂钩 |
| R7 | 台账写入竞态（end 落盘中查询） | 不特判。响应是瞬时一致快照，下一轮 600ms 自愈；`lastSeq` 单调保证不重不漏 | 快照语义诚实，避免加锁 |

**否决的备选**：
- ❌ 每 600ms 全量重扫：30+ 子代 × 每轮数百帧 zstd 反复解压 + 重复 IO，CPU 空转；
  running 子代的增量本来只有几帧。
- ❌ 服务端推送（metrics end 搭车，F11）：600ms 轮询已满足「running 实时可见」；
  推送是性能优化不是契约，引入双通道一致性负担。留作 v2 可选优化，v1 契约
  仅拉模式。
- ❌ 台账持久化聚合结果：每次 end 都要读改写台账 JSON，与既有台账写入路径
  争锁；聚合可随时由事件流重建，持久化无必要。

### D3 — RPC 契约：`getUsage` 端点

**裁决**：在现有 `rpc.handle('/dsh-my-go', ...)` branch（F9，lib/index.js:397）内
新增 `if (endpoint === 'getUsage')` 分支，命名对齐 `getBuiltinPersona` 的
camelCase 动词式。实现于 **lib 半**，纯台账驱动（F6），不依赖 Symbol.for 桥——
lib-only 降级形态同样可用。端点整体 try 包裹，失败回
`{ ok:false, error:{ code:'internal', message, details:{} } }`（对齐 snapshot 先例
lib/index.js:403-426）。

**请求**：`{ parentSessionId: string }`。空串/非字符串**不抛错**，走 `found:false`
空结构（见降级矩阵 Z8）。无分页、无过滤参数（30+ 子代全量返回，数十 KB 级）。

**响应**（信封 `{ok:true, value}`，value 形状）：

```ts
interface UsageReport {
  parentSessionId: string          // 入参回显；空入参回 ''
  found: boolean                   // 台账查无该 parent → false
  children: ChildUsage[]           // found=false 或无子代 → []（恒数组）
  byModel: ModelUsage[]            // 跨子代归并；恒数组（可为 []）
  totals: Bucket                   // 全局四桶合计；恒对象
  generatedAt: number              // Date.now()，调试用
}

interface ChildUsage {
  childId: string                  // 恒在（台账键；self 行 = parentSessionId 本身）
  agentType: string | null         // 台账记录补源；记录缺该字段 → null（self 行恒 null）
  status: string | null            // 台账记录状态；缺 → null（self 行恒 null）
  messageCount: number             // assistant/message 计数（含无 usage 帧）
  segments: Segment[]              // 恒数组；空=已确认无 assistant 消息
  totals: Bucket                   // 段间合计
  partial: boolean                 // 含未知分桶或扫描不完整
  frozen: boolean                  // 终态冻结标记（D2 R3）
  isSelf?: boolean                 // D6：父会话自身合成行标记；子代行无此字段
}

interface Segment {
  provider: string | null          // null → unknown 段
  model: string | null             // null → unknown 段（与 provider 独立判空）
  messageCount: number
  buckets: Bucket
  partial: boolean
}

interface Bucket {
  inputTokens: number | null       // null = 数据源未上报（≠ 0）
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

interface ModelUsage {             // byModel 元素 = Segment 语义 + 跨子代归并
  provider: string | null
  model: string | null
  messageCount: number
  buckets: Bucket
  partial: boolean
  childCount: number               // 贡献该段的子代数（self 行不计入，D6）
  price: PriceInfo | null          // null = 未定价（unmatched / usagePrices 缺席）
}

interface PriceInfo {              // USD / 1M tokens；settings 实时 join（D2 R6）
  input: number
  output: number
  cacheRead?: number               // 缺省 = 该桶未定价（渲染层成本部分计算）
  cacheWrite?: number
}
```

**null 传染规则（partial 传播）**：桶聚合时 `null` 按 0 计入数值、同时置
`partial=true`，partial 沿「段 → child.totals → byModel → 全局 totals」逐级 OR。
语义：**数字恒可用（已知值之和），部分性恒可见**。UI 对 `partial=true` 的数值加
`≥` 前缀（如 `≥12,345`），hover 说明「含未上报分桶」。

**排序契约**：`children` 按台账 spawn 序，self 合成行（D6）恒排最前；`byModel`
按 `{provider,model}` 首次出现序，unknown 段（provider 与 model 均 null）
**恒排末尾**。客户端可重排，服务端顺序仅作稳定默认。

**字段缺席语义总表**（验收硬门槛：每个字段可回答「缺席时 UI 显示什么」）：

| 字段 | 缺席形态 | 何时发生 | UI 显示 |
|------|---------|---------|---------|
| `children` / `byModel` / `totals` / `generatedAt` | 恒在场（数组可为空） | — | 空数组→「本会话暂无用量」 |
| `found` | 恒在场 | — | false→「当前会话无编排记录」 |
| `agentType` | `null` | 台账记录坏档/字段缺失 | 「未知工种」，行仍展示 |
| `status` | `null` | 同上 | 「未知」徽标 |
| `segments` | 恒在场（可 `[]`） | 子代无任何 assistant 消息（刚 spawn/启动即败） | 子代行展开区「无消息」 |
| `provider` / `model` | `null` | usage 帧前无 request/header，或 header.config 字段缺 | unknown 段行「未知模型」，恒排末尾 |
| 四桶任一 | `null` | adapter 未上报该桶（F1/F2 可选字段） | 「—」，**不补 0**；该桶不计成本；触发 partial |
| `price` | `null` | 模型未定价（unmatched / usagePrices 缺席/空） | 成本列「—」，纯 token 展示 |
| `price.cacheRead` / `cacheWrite` | 值缺省（PriceInfo 内 key 省略） | 用户只填了 input/output | 该桶不计成本；若该桶实际 token>0，成本显示 `≥$x` |
| `partial` / `frozen` | 恒在场（boolean） | — | partial=true→数值加 `≥` 前缀；frozen=true→行尾锁标（🔒） |
| `childCount` / `messageCount` | 恒在场（number，可为 0） | — | 0 如实显示 0（计数与 token 不同，0 是事实不是缺席） |

### D4 — 三视图数据结构：单份响应派生，byModel 服务端预归并

**裁决**：三视图共用**同一次 `getUsage` 响应**，不发三次 RPC：

| 视图 | 数据源 | 前端职责 |
|------|--------|---------|
| 按模型 | `byModel[]`（服务端已跨子代归并） | 排序、格式化、乘 price 算成本 |
| 按子代 | `children[]`（`segments` 可展开为模型分段明细） | 排序、分组、格式化、乘 price |
| 合计 | `totals` + `children.length` + `byModel.length` | 汇总卡渲染 |

对 Prometheus 原案（「渲染层透视 byModel」）的一处**收窄**：跨子代按
`{provider,model}` 归并逻辑放**服务端**（reducer 逐段归并顺手产出，D2 状态机
已有段结构），前端不做 reduce 透视。理由：归并口径（partial OR、unknown 沉底、
null→0+标志）只实现一处，避免前后端各写一份聚合规则漂移；前端零重复计算，
tab 切换只是同一渲染缓存的排序变化。

**否决的备选**：
- ❌ 三份预聚合一并下发：冗余字节（30+ 子代场景 children 与 byModel 高度重复），
  服务端三套组装代码。
- ❌ 纯前端从 `children[].segments` 透视出 byModel：归并逻辑前后端割裂两处（理由同上）；
  且「按子代 × 按模型」展开行与「按模型」行口径漂移风险高。

**成本计算（渲染层，唯一计费点）**：`cost = Σ(桶token × price.桶)`，仅累加
「token 已知 且 价格已配」的桶；`costPartial = usagePartial || 价格桶不齐且缺价桶 token>0`。
显示格式 `$0.1234`；`costPartial=true` 时加 `≥` 前缀。

### D5 — 降级矩阵（补全版）

原则：**token 事实如实、部分性显式、任何单点损坏不炸整表、任何入参不抛错**。

| # | 场景 | 契约表现 | UI 表现 |
|---|------|---------|---------|
| Z1 | usage 缺某桶（adapter 未报，F2 可选字段） | 桶=`null`，partial 传染 | 「—」不补 0；成本不计该桶 |
| Z2 | assistant/message 无 usage（老会话/未实现 adapter） | 归 unknown 段，仅 `messageCount+1`，桶无贡献 | 「未知模型」行有消息数、token 全「—」 |
| Z3 | 无单价（usagePrices 缺席/空/行 unmatched） | `price=null` | 成本列「—」，纯 token |
| Z4 | 单价缺 cache 桶但该桶 token>0 | `price.cacheRead/Write` 缺省 | 成本=已定价桶之和，`≥$x` |
| Z5 | 归因失败（usage 帧前无任何 request/header） | `{provider:null, model:null}` unknown 段 | 「未知模型」行，恒排末尾 |
| Z6 | 坏帧（JSON 截断/zstd 单帧解压失败） | 跳过该帧继续扫；child `partial=true`；`console.warn` 留痕（对齐 archive.mjs:190 先例，不静默吞） | 整表正常渲染，该行数值 `≥` 前缀 |
| Z7 | 档案不可读/不存在（childId 无档、路径异常） | 该 child 已扫部分照常返回，`partial=true`，console.warn | 同 Z6 |
| Z8 | `parentSessionId` 空/非串/台账查无 | `ok:true, found:false, children:[], byModel:[], totals` 全 null | 「当前会话无编排记录」，不报错 |
| Z9 | 台账记录缺 agentType/status | `null` | 「未知工种」/「未知」 |
| Z10 | live 摘除与档案读取的竞态窗口（end 瞬间查询） | 双路径兜底（F4→F5），`lastSeq` 单调不重不漏 | 无感；快照语义，600ms 后自愈 |
| Z11 | 价格字段非法（负/NaN/Infinity，绕过校验手改配置） | 运行时视同该行未定价（`price=null`），console.warn | 同 Z3 |
| Z12 | 终态子代复活（F7 复活即新世代） | 解冻续扫（D2 R4），历史分段保留，新代际由 request/header 切新段 | 同一子代行，token 持续累计 |
| Z13 | settings 服务整体缺席 | 等价 Z3（纯 token 模式） | 成本列「—」 |
| Z14 | 同一 `{provider,model}` 跨多子代/多段 | byModel 归并为一行，`childCount` 计数 | 单行展示，childCount 可见 |
| Z15 | 同 childId 内 model 键自身含 `/` | key 切分规则（D1）保证不歧义 | 正常显示 |
| Z16 | 重绑备选链（同 childId 多模型分段） | request/header 切段，各段独立累计 | 子代展开区多行，各自成本 |
| Z17 | RPC 内部异常（台账读崩等） | `{ok:false, error:{code:'internal',...}}` | 「用量数据读取失败」横幅，轮询继续退避（panel-tree 既有 backoff） |
| Z18 | 子代 30+ 规模 / 数据量超预期 | 不分页不截断，全量返回 | 面板自滚动；性能风险由 D2 缓存兜住 |
| Z19 | 父会话自身流读不到（无 assistant 消息 / 冷父无档） | 不注入 self 合成行（空行不翻 `found` 语义，Z8 保持）；档案尝试走 Z6/Z7 降级 | 面板与 v1 形状完全同形，无零值噪音行 |

### D6 — 父会话自身用量入账（parent-usage，维护者拍板追加）

**裁决**：`getUsage(parentSessionId)` 在子代枚举之外，**恒常扫描父会话自身的
事件流**，把主编排会话（本会话）的模型消耗并入账本——「本次会话的完整开销」。
实现复用 per-child 全套机制，父会话自身只是一个**无台账行、不参与枚举的伪
child**：

- **读取路径**：活父会话走 live store（`sessions.get(parentSessionId)` +
  `snapshotEvents(fromSeq)` 增量），冷父会话走 `readArchivedUsage`——该读取器
  本就按任意 sessionId 解析档案路径（`encodeSegment` + `findArchivedLogByChildId`
  兜底），零改动通用。
- **缓存**：per-parent bucket 上独立 `self` 槽位（不混入 `children` Map 的
  childId 空间），同款游标（lastSeq 单调不重不漏）、同款 idle-freeze / R4
  live 重驻留解冻。父会话无台账终态行，冻结只走 idle-freeze（live miss +
  complete 扫 + 空扫一轮）；父会话通常 live 在场（面板正查它），增量为零解压。
- **身份标注**：合成行带 `isSelf: true`，`childId` = parentSessionId，
  `agentType`/`status` 恒 null；恒排 children 最前（先账本自身，后 spawn 序子代）。
- **三视图归并**：按模型——self 段自然并入对应 `{provider,model}` 行
  （`childCount` 仍只数子代）；按子代——self 行独立展示（客户端「主编排」
  身份徽章，不冒充工种）；合计——totals = self + 子代完整开销。
- **降级铁律**：self 流无任何 assistant 消息（segments 空）→ **不注入**合成行
  ——零值行是噪音，且会让 Z8 的 `found:false`（查无此会话）被幽灵 id 翻面。

**否决的备选**：
- ❌ self 行永远注入（无数据也给零值行）：`children.length > 0` 会把 Z8 的
  found 语义翻成 true，降级矩阵破口；面板多一行恒零噪音。
- ❌ self 与子代共用 children Map 槽位（哨兵 childId）：游标缓存身份混淆，
  枚举去重逻辑需加特判，独立槽位零交叉。
- ❌ 面板侧二次拉父会话用量再合并：归并口径（partial OR、unknown 沉底）会
  前后端各一份，违背 D4 单点归并裁决。

**性能选型说明**：父会话档案通常是最大的（主编排消息最多），但 600ms 轮询的
稳态成本与子代一致——活会话走 live 增量（无解压），冷会话首轮全量扫 +
次轮空扫即冻结，此后零 IO（R2 LRU 4 parent 照常限界）。最坏面（live miss +
档案 incomplete，如 torn tail 或档案缺失）每轮一次解压/重试，与子代的既有
风险面相同，不为 self 单开机制。

## 5. 施工接缝清单（hermes 照此落点，无需再定位）

| 落点 | 动作 | 参照 |
|------|------|------|
| `lib/index.js` settings register（:319-329） | 加 `usagePrices: z.dict(priceSchema, z.string().pattern(PRICE_KEY_PATTERN))` | F10，roles 字典样板 |
| `lib/index.js` RPC branch（:397 内） | 新增 `getUsage` 端点：读台账（F6 路径）→ 枚举 parent 的 children → 调聚合引擎 → join 价格 → 组装 UsageReport；整体 try（:403-426 先例） | F9 |
| 聚合引擎 | 新模块（建议 `lib/usage-aggregator.mjs` 或 lib/index.js 内闭包）：D2 缓存结构 + reducer 状态机 + R1-R7 | D2 |
| `preset/shared/archive.mjs` | 新增 `readArchivedUsage(childId, fromSeq, options)`：同族同步逐帧解压，支持 fromSeq 过滤；复用 `findArchivedLogByChildId` 兜底 | F5，:147-207 先例 |
| live 读 | `ctx.get('sessions')?.get?.(childId)` + `sessionEvents()` 适配（含 snapshotEvents 特性探测），从缓存 `lastSeq` 增量 | F4，broker.mjs:548-565 先例 |
| 设置页（client） | usagePrices 字典编辑卡：key 输入 + 四数字输入（input/output 必填，cache 可选），label「USD / 1M tokens」；读写走既有 loadSettings/saveSettings | F9/F10 |
| 面板（client） | 新 usage 卡/三视图 tab：轮询挂既有 600ms 周期（可并行一发 `getUsage`），`currentSessionId()` 主动读（overlay 全局挂载场景） | F8，panel-tree.js:78-99, 429-438 |
| broker 半 | **v1 零改动**（枚举走台账、聚合在 lib 半、价格在 settings；metrics 搭车已否决） | D2 |

## 6. 决策摘要

| 决策 | 裁决一句话 |
|------|-----------|
| D1 键格式 | `"{provider}/{model}"` 扁平字典键（第一个 `/` 切分，model 可含 `/`），value 四桶 $/MTok；`totalTokens`/`reasoningTokens` v1 不消费（防派生口径不一致与 output 双计） |
| D2 聚合 | on-demand + per-child 游标增量缓存（lastSeq），终态一次全量扫即冻结，复活解冻，LRU 4 parent，价格永不进缓存 |
| D3 RPC | lib 半 `getUsage` 端点，`{parentSessionId}` 入参，回 `{found, children[], byModel[], totals}`；null=未上报（≠0），partial 沿聚合链逐级 OR |
| D4 三视图 | 单次响应派生：byModel 服务端预归并（归并口径单点实现），children/byModel/totals 三视图全前端渲染，零二次 RPC |
| D5 降级 | 18 场景全覆盖：缺桶「—」不补 0、无价纯 token、归因失败 unknown 段、坏帧跳过留痕、坏入参空结构不抛错 |
| D6 父会话自身入账 | self 流复用 per-child 双路径（独立缓存槽），合成行 `isSelf` 排最前；byModel/totals 并入、childCount 不计；空流不注入行（Z8 不翻面） |

## 7. 验收对照

- ✅ 五个决策点全部显式裁决，无「待定」；每个写明理由与否决备选。
- ✅ 每个响应字段有缺席语义（§4 字段缺席语义总表）。
- ✅ 自洽可施工：类型（F1-F2）、事件（F3）、双路径（F4-F5）、枚举（F6-F7）、
  面板/RPC/settings 接缝（F8-F10）全部给出处与落点（§5）；TokenUsage 六字段
  处置有契约级结论（D1）；复活解冻有规则（D2 R4）。
- ✅ D6（父会话自身入账，追加裁决）同样三视图贯通、降级有 Z19、性能有选型说明。
- ✅ 未动 `src/lib/client` 任何代码；未触碰 git；本文档为唯一产出。

<!-- §7 end -->
