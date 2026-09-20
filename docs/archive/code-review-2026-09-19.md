# dsh-my-go 全面体检报告（2026-09-19）

> 审查范围：解耦性 / 可读性 / 可维护性 / 可扩展性 / 测试规划与实施 / 文档一致性。
> 基线：工作区 0.5.0-tisitan.3（49 文件未提交批次进行中），HEAD = 0.5.0-tisitan.2。
> 方法：阶段 1 三棒并行勘察（结构 / 测试基建 / 文档漂移）+ 阶段 2 两棒代码级深审（运行时核心 / 前端与面板半），全部只读；唯一写面为 `npm test` 自产的 dist/ 构建产物。
> 测试实测：**600 / 600 全绿**（node --test 阶段 3.8s，全程约 5.2s，exit 0）。
> 体量：84 源文件 28248 行（手写生产源码约 10959 行，测试 13904 行占 51%，dist 2987 行为构建产物）。

---

## 〇、总评

**这是一份骨架健康、局部淤积的代码库。** 分层架构（shared 纯函数层 → 工具/宿主层 → 前端层 → docs/prompts 层）清晰且被严格遵守：零循环依赖、无上帝 import 枢纽、shared 铁律（不 import @deepseek-ai/*、不碰 ctx）逐文件核验零违反。注释是全仓最强资产——why 密度高、事故可追溯（版本号+编号），远超常见水准。测试基线厚实：600 用例全绿、双 OS CI、mock 替身刻意比宿主严（防假绿有明文设计）。

**主矛盾集中在三处**：
1. **broker.mjs 上帝闭包**——2862 行、96% 挤在单个 apply() 内、52 个内嵌函数、27 个闭包级可变状态。它是体量意义上的上帝文件（非依赖枢纽意义上的），一切编排能力共存一个作用域，新增能力只能继续堆入。
2. **常量收口未完成**——全仓 13 处手工同步点（双源 AGENT_TYPES、三份 ROLE_KEY_PATTERN、漂移的 PRICE_KEY_PATTERN、8 处 DSH_HOME 路径推导等），一致性的最后防线是 parity 测试对拍与人工纪律，不是单一事实源；而 PRICE_KEY_PATTERN 一处已经实际漂移出行为分歧。
3. **0.5.0 设置页重写的残余**——14 个孤儿导出（生产零引用、测试仍在测）与 settings-core 内联平行实现形成双轨且已分叉，测试绿 ≠ 测对了东西。

**P0 级（正确性/数据面阻塞）发现：0 条。** 全部发现为结构风险与扩展摩擦：P1 共 8 条（运行时 6 + 前端 2），P2 共 28 条（运行时 14 + 前端 14），文档漂移 12 条。

---

## 一、解耦性

### 健康面
- 模块分层五层清晰，全仓 DFS 检测**零循环依赖**；最高 fan-in 仅 6（shared/constants.mjs），无依赖枢纽型上帝文件。
- shared/ 12 模块中 11 个单一职责、边界干净；relay-chain.mjs 的 advanceChain（215 行，全仓最大单函数）已被正确隔离在纯函数层，不阻碍 broker 拆分。
- 前端纯函数层（chain-rows / roster-rows / usage-price-rows / settings-ops / settings-guard）与 DOM 层分离干净；RPC 交互面信封纪律强（四端点统一 {ok,value} 信封，无绕过直取）。

### P1 发现（运行时 4 条）
| # | 锚点 | 问题 |
|---|---|---|
| D-1 | broker.mjs:874 ↔ :1034/:1040 | **advanceQueue↔dispatchWork 互递归成环**：全文件唯一环状调用图，两函数无法先于对方独立成模块，拆 broker 必须先在此环上做决定 |
| D-2 | broker.mjs:277-284 | **bump() 是全文件扇入最高的状态枢纽**：实测 30 个调用点 + orch.onChange 双挂载；漏一处调用 = 面板/台账静默不同步；任何簇抽取都必须把它当回调携带 |
| D-3 | broker.mjs:2684 ← :1020 ← :2524 | **processEnd 头尾穿越**：dispatchWork/attemptFallbackRedeploy 与 processEnd 双向纠缠（函数提升撑着头尾互调），与 D-1 共同构成「真纠缠」的第二核 |
| D-4 | broker.mjs:814,1008 vs :1922 等 | **声明顺序与使用顺序系统性倒挂**：chainHopsByWork/endBuffer/processEnd 等首引与声明相距千行，靠「apply 同步段跑完前无人触发回调」的未成文前提撑着——仓内注释两次记载修过的 TDZ bug（:142-145 N9/N10）正是此类；拆 broker 重组声明顺序时第一批爆的雷 |

### P1 发现（前端 1 条）
| # | 锚点 | 问题 |
|---|---|---|
| D-5 | src/settings-core.js:45 vs preset/shared/constants.mjs:26 | **PRICE_KEY_PATTERN 双定义且已实际漂移**：本地版禁 model 段含 `/`，shared 版放行（OpenRouter 式 `openrouter/deepseek/...` 是设计意图）。结果：手编 YAML 合法的键，配置页无法新建同款；校验规则两半各说各话，且 host-parity 无此 parity 闸。**这是现行行为不一致，P1 中最接近 bug 的一条** |

### P2 精选
- **内聚 vs 纠缠盘点**：18 个职责区块中 9 类（台账簇 :345-499 / 通知簇 :507-543 / 能力缓存簇 :2251-2313 / E2 缓冲簇 :2607-2677 / dispose 兜底簇 :187-219 / M1-M5 投递链 :1045-1209 / 链 dispatcher :1795-1922 / persona+DSV bootstrap :607-785 / 工具注册块 :1211-2193）是「本来就内聚、只是同住」，闭包依赖可枚举、抽取难度低-中；真纠缠只有 D-1/D-2/D-3 三处 + D-4 布局雷。
- shared/misc.mjs 是「杂物抽屉」（8 个互不相关导出），新 helper 落点不可预期；board.mjs/archive.mjs 带真实副作用与「shared=纯」的直觉宣称有出入（属豁免非违约，但无标记）。
- panel-tree.js 573 行三台状态机同居，listeners 集合既当渲染通知又当轮询驱动（点关闭按钮也会触发轮询尝试），无注释点明；settings-core.js 628 行五职责同居（容器/状态机/RPC 客户端/校验器/文案投影）。
- 'legacy' 魔法串三处分布无共享常量（panel-tree.js:222 / usage-views.js:186 / 生产者在 broker 半）。

---

## 二、可读性

### 健康面
- **注释是全仓最强资产**：why 密度高、事故可追溯（broker.mjs:148-153、:959-962、:1147-1160 等带版本号+编号）；settings-ops.js:236-243 四段论证、panel-tree.js:385-387 陷阱说明均为上乘。
- 命名动词纪律一致（finalize*/schedule*/resolve*/rearm*/claim*）；roles-editor/usage-prices-editor 的「纯渲染函数+回调上行」范式干净（头注释明示契约）。

### P1 发现
- D-4（见上，声明倒挂布局雷同时是可读性问题：迫使读者把 2800 行整体保持在头脑里）。

### P2 精选
- broker.mjs:2684-2860 processEnd（~176 行）七件事单函数承担；协议知识以注释形态散在 4 个文件（end-attribution.mjs:18-53 三条协议 + relay-chain.mjs + child-registry.mjs 文件头），无结构化载体。
- broker.mjs:2423-2539 attemptFallbackRedeploy 四个早退分支各自重复「finalizeEnd + resolveChainFallback + notifyOwner + advanceQueue」四连，顺序不可错且无结构防漏（:2536 注释自证历史上漏 advanceQueue 曾致队列冻结）。
- broker.mjs:949-1043 dispatchWork（95 行）三态一函数，直派段线性堆叠五个关注点，零空行分节。
- lib/index.js:406-687 apply（282 行）为全仓最长函数、五段一函数；同文件 ensurePresetInstalled(:350-404) 与 createPanelRpcHandler(:196-254) 是拆分质量正面标杆。
- 前端两代范式层积：store→React 桥接两种（panel-tree 手动 listeners vs settings-core useSyncExternalStore）；window.prompt 阻塞式交互与 inline-error 同居一页；reload 与 reloadScope 两份近同函数（settings-core.js:120-124 vs :509-512）；render 期间写闭包副作用（panel-tree.js:213，React 反模式）。
- chip/typeChip 样式工厂两文件逐字复制（panel-tree.js:226-258 vs usage-panel.js:79-101，注释自认同款）；statusGlyph/childGlyph 同一状态→字形映射两份。

---

## 三、可维护性

### P1 发现
| # | 锚点 | 问题 |
|---|---|---|
| M-1 | broker.mjs:120-2618 | **27 个闭包级可变状态**（17 个顶级持有者 + childRegistry 内部 10 张表，其中 7 张被 broker 裸读写）：加第 11 个工具 = 在 2800 行单作用域内为 execute() 找齐并正确引用其中数个；拆 broker = 为 27 个状态逐一裁决归属。两项工作的第一大障碍 |
| M-2 | constants.mjs:50 + broker.mjs:2164-2171 | **加工具的三点手动耦合**：SELF_REGISTERED_TOOLS 名单 ↔ 注册点 ↔ agent/created deny 名单，三处不在同一屏、无一致性测试；漏名单 = toolFilter 误杀自产工具，漏 deny = 星型拓扑静默开口；条件注册+条件 deny 联动纯注释约定 |
| M-3 | constants.mjs:13 vs client-constants.js:9 | **AGENT_TYPES 双源同名不同义**：shared 8 工种（无 sisyphus）vs client 9 项（含）——有 parity 闸（host-parity.test.mjs:384-386）风险已缓释，但同名异义符号是 grep 陷阱（settings-ops.js:206-207 注释警告的原事故）；加第 9 工种需同步至少 6 处 |
| M-4 | 前端 | **14 个孤儿导出 + 平行实现双轨**（见 D-5 下条 M-4'） |

| # | 锚点 | 问题 |
|---|---|---|
| M-4' | roster-rows.js:71-256 + usage-price-rows.js:40-148 vs settings-core.js:214-283,590-614 | **14 个孤儿导出：生产零引用、测试仍在测**——0.5.0 重写后 settings-core 内联了平行实现且已分叉（parseRoleCardJson 严格 vs parseRoleText 宽松，key 空也放行）；约 180 行死代码 + 两个测试文件的大部分断言在保护生产路径不再经过的函数，真正在跑的 parseRoleText 无直接单测 |

### P2 精选
- **DSH_HOME 路径推导 8 处手写重复**（broker.mjs:166,351；lib/index.js:259,352；usage-aggregator.mjs:64；archive.mjs:157,223；board.mjs:58），漏改一处即读写分家。
- 占位审计看门狗覆盖不对称（broker.mjs:2636-2677）：慢 spawn 无抢跑 end 时永不回收；已自认 leak-guard 取舍，瑕疵级。
- 三套 id 生成方案并存（broker.mjs:511 / :1391 / orchestration.mjs:52），缺统一原语。
- 设置页新增字段要语义对齐地穿过 settings-ops 四处手写投影镜像（读/比对/脏标/写），漏一处即「保存丢字段」类 bug；无字段注册表约束。
- **手工同步点全仓 13 处清单**（前端棒交付，含 AGENT_TYPES×5、ROLE_KEY_PATTERN×3、PRICE_KEY_PATTERN×2 已漂移、价格桶序×3+桶标签×2、'USD'/'CNY' ≥6 处、RPC 通道裸字符串 ≥11 处、样式×5、字形映射×2、describeAgent vs AGENT_BLURBS 中英双份无闸）。
- 「加第 10 个工种」动面：至少 4 文件 8 点；「加新设置页」动面：4 文件起步。parity 闸会把漏改 shared 变成显式测试红，是现有最佳防线。

---

## 四、可扩展性

- **新工具最小路径 3 文件**（constants 名单 + broker 注册 + sisyphus.md 纪律），带面板/断言则 5-6 个——成本可接受，但全靠人工纪律（M-2）。
- **新角色约 4-6 文件 8 点**（M-3 + 前端 13 处同步点清单）。roles-editor 的 sisyphus 特判是单工种硬编码，出现第二种特殊工种时需重构。
- **prompt 与代码强耦合**：sisyphus.md 420 行硬编码全部工具名与流程纪律，改工具语义需代码+prompt 双处同步，prompt 侧无机械校验。
- **隐式跨平面契约两条无校验**：globalThis[Symbol.for('dsh-my-go.snapshot')]（broker.mjs:343 ↔ lib/index.js:599）、对上游 dsh-subagent-control 内部 Symbol 的依赖（adjacent.mjs:47-48）——上游改名即静默断裂。
- 好消息：snapshot 条目形状契约虽只在注释级（lib/index.js:542-544），但消费侧防御性取值（panel-tree.js:463-472），漂移时静默降级为空串而非炸掉——韧性设计，代价是漂移无测试会红。

---

## 五、测试规划与实施

### 健康面
- 41 档 / 600 用例 / 13904 行（占源码 51%），node:test 内置框架零额外依赖，三段式 npm test（构建 → 冒烟 → 全档），CI 双 OS（ubuntu+windows）矩阵。
- **mock 替身刻意比宿主严**（mock-ctx.mjs:16-27 关掉五类「替身比宿主宽容」的假绿），头注释明文设计——这是罕见的测试成熟度信号。
- bridge.test.mjs 真行为集成（断言状态机终态而非调用痕迹，waitFor 谓词替代固定 sleep）；settings-ops.test.mjs 零 mock 纯函数直测是全仓最干净样板；usage-integration.test.mjs 高价值跨半契约测试。
- README 有明文等待口径硬约定（waitFor 谓词 / drain 负向窗口 / removeHomeWithRetry）。

### 风险清单
| # | 锚点 | 问题 |
|---|---|---|
| T-1 | host-parity.test.mjs 等 | **约 118 处源码文本断言**（countOf/includes/正则）：钉不变量有效，但改 import 写法/重命名即红，且文本绿≠行为对——重构脆性与假安全感双重来源 |
| T-2 | test/ 平铺 + package.json:58 | **无分层 + 单层 glob 不递归**：单测/集成/冒烟/哨兵四种性质混排无约定；未来任何人建 test/unit/ 子目录都会被静默漏跑 |
| T-3 | compat-alpha4.test.mjs:797-798 | **契约哨兵可静默失效**：宿主依赖不可解析时整段条件 skip，而 mock-ctx 对真宿主的保真靠它兜底——哨兵失效时全仓照绿（README:518-521 自述它曾长期恒 skip） |
| T-4 | usage-panel.js（359 行） | **唯一真零覆盖渲染面**（修正后口径：settings-core 主体实际被 client-card.test.mjs 假 React 行为档覆盖，原「1371 行零覆盖」收窄至此）；client-card 保真度受限于自制 React 替身 |
| T-5 | bridge 等时序敏感面 | waitFor 轮询 + 负向 drain 窗口的 flake 余留（bridge 自曝并行下曾 1/5 假红）；windows 矩阵负载差异下仍是潜在源 |
| T-6 | 1371 行测试定性三类清单 | A 类可低成本补测：settings-core 13 个私有纯投影（需 export）+ effortLabel + createCatalogStore；B 类需新设施：usage-panel 交互态、hooks 语义、真实受控输入；C 类不测合理：CSS 字面量、DOM 注入胶水、两行文案组件 |
| T-7 | README.md:519 | 声称 589 例 vs 实测 600（+11 漂移，0.5.0-tisitan.3 的 usage-prices 套件所致）——文档侧 D 类问题一并修 |

---

## 六、文档一致性

12 条漂移实锤（文档说 vs 现实，均有双锚点）：

| # | 内容 | 漂移 |
|---|---|---|
| D1 | 版本号三方不符 | README meta `0.5.0-tisitan.0` vs package.json `.3` vs FORK-GUIDE `.0`；HEAD 上就已错位，违反 FORK-GUIDE 自定的发版对齐纪律 |
| D2 | peer 上界 | README 两处 `<0.1.6` vs package.json 实际 `<0.1.7`；CHANGELOG 全文无 0.1.7 记录 |
| D3 | lib/index.js 行数 | README/FORK-GUIDE 说 632 vs 实际 687 |
| D4 | src/client.js 行数 | README 104 / FORK-GUIDE 82 / 实际 267——三处三个数 |
| D5 | shared 模块数 | 三份文档说「九模块」vs 实际 12（0.4.0 新增 board/relay-chain/report-format） |
| D6 | tools/ 清单 | README 只列 broker.mjs vs 实际还有 metrics.mjs |
| D7 | 工具面 | FORK-GUIDE「6 工具」/ ARCHITECTURE「5 通信+2 观测」vs 实际 broker 注册 10 工具 |
| D8 | FORK-GUIDE 目录现状段成批陈旧 | tool-mask.mjs / tool-mask-editor.js / tool-mask-rows.js / 两个测试文件均已删仍在列；「通配 20 档」vs 实际 41；机制映射仍描述已退役的三私有端点 |
| D9 | ARCHITECTURE 覆盖代差 | 全文 0 次提及 apelles/chain_start/report_submit；0.4.0 三机制、getUsage、0.5.0 新面均未进架构文档（局部有新、整体缺两代） |
| D10 | AGENTS.md 落后两批 | need_help intent 枚举 6 个 vs 实际 7 个（少 consult）；收尾协议仍写「等 Sisyphus 分析」vs 报告外部化落板制（已被 report-format.mjs:27 条款压制） |
| D11 | README docs/ 树不全 | 缺 docs/plans/（3 篇）与 usage-stats-design.md（轻微） |
| D12 | 测试例数 589 | 实测 600（见 T-7） |

文档完整性缺口（新用户视角）5 项：① 无故障排查/FAQ 集中入口；② 无 docs/ 总索引（9 篇文档分工需读正文才知道）；③ 配置表缺 usagePrices/usageCurrency 键（YAML 手配无门）；④ AGENTS.md 读者定位含混（编排规格 vs 维护指令混杂）；⑤ 升级节未交叉引用 dist 随 release commit 入库的前提（轻微）。

---

## 七、修复方向建议（候选批次，供维护者点名；本报告不动工）

> 按「风险/成本」排序，每批可独立收口。批次 1 已获授权（文档修复），待维护者落脚后开工。

1. **批次 1 · 文档修复**（已授权）：D1-D12 全修 + 5 个缺口全补。机械部分（版本号/行数/模块数/工具数）hermes 可干；ARCHITECTURE 补 0.4.0/0.5.0 新面（D9）与 AGENTS.md 追两批（D10）需 hephaestus。
2. **批次 2 · 现行 bug 级收口**（P1，建议优先）：PRICE_KEY_PATTERN 收口为 shared 单源 + host-parity 补 parity 闸（D-5）——前端已有 src→shared 直引先例（usage-price-rows.js:22），无技术障碍；顺手收 ROLE_KEY_PATTERN 三处。
3. **批次 3 · 死代码与双轨清理**（P1）：14 个孤儿导出删除或降级，测试重定向到 parseRoleText 等活实现（M-4'）；顺带补 parseRoleText 直接单测。
4. **批次 4 · 常量收口**（P2 打包）：DSH_HOME rootDir() 单源（8 处）、RPC 通道名共享常量（≥11 处）、价格桶序/桶标签单源、'legacy' 串收口——13 处手工同步点清单即施工单。
5. **批次 5 · broker 拆分**（大工程，先易后难）：先抽 9 类「同住」内聚簇（台账/通知/能力缓存/E2 缓冲/dispose 兜底/M1-M5/链 dispatcher/persona bootstrap/工具注册，闭包依赖已逐簇枚举可参数化），再处理 D-1 互递归环与 D-2 bump 枢纽；动工前先排 D-4 声明倒挂的雷（重排声明顺序 + 补 N9/N10 类回归测试）。27 个闭包状态归属裁决表是第一步交付物。
6. **批次 6 · 测试补强**：T-3 哨兵失效告警化（skip 时打明输出）；T-2 测试分层目录约定 + glob 递归化；T-6 A 类纯函数补测（13+2 个，export 即可）；T-1 文本断言逐步换行为断言（随批次 5 自然消化）；usage-panel 测试设施属 B 类，按需要立项。

---

## 八、未验项与免责

- 各「可独立成模块」簇的抽取难度判断基于静态闭包依赖分析，未做实际抽取验证。
- 600 用例的断言质量未逐一审读（只对账数量与绿红 + 3 文件抽样）。
- DSV4P0813 双代宿主行为仅静态核读；npm test 的 Windows 路径行为未验证（本机 Linux，CI 有 windows 矩阵兜底）。
- roles-editor/usage-prices-editor 在 client-card.test.mjs 中的断言覆盖度仅抽样核对，未逐断言穷举。
- usage-panel 零引用、孤儿导出零引用基于静态 grep（排除 node_modules/dist），未做动态验证。
- 本报告基于工作区 0.5.0-tisitan.3（49 文件未提交批次）现状；该批次收口方式变化时相关条目需复核。

## 九、棒次溯源

| 棒次 | 工种 | 内容 |
|---|---|---|
| 结构勘察 | explore | 84 文件清单 / 依赖分层 / 循环依赖检测 / 耦合与扩展信号 |
| 测试勘察 | explore | 41 档 600 用例盘点 / 覆盖分布 / 质量抽样 / 规划信号 |
| 文档勘察 | librarian | 17 份文档清单 / 12 条漂移 / 完整性缺口 / prompts 运行时定性 |
| 运行时深审 | hephaestus | broker.mjs 2862 行全文精读 + lib/index.js + shared 导出面；P1×6 P2×14；npm test 实测 600 全绿 |
| 前端深审 | hephaestus | src/ 15 文件 + lib 交互面；P1×2 P2×14；13 处手工同步点清单；1371 行测试定性三类 |
