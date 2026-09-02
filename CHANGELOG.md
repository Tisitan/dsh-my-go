# Changelog

本文件记录 Tisitan fork 相对上游 [daizihan233/dsh-my-go](https://github.com/daizihan233/dsh-my-go) 的变更。
版本号规则：`上游版本-tisitan.N`。

> **批号命名空间（重要）**：本仓有**两条独立序号线**——`0.2.3-tisitan.N`（0.2.3 线，
> N=1..20）与 `0.3.0-tisitan.N`（0.3.0 线，N=0..11）。裸写 `tisitan.N` 时，N=1..9 在
> 两线**同号不同批**，须读上下文语义判定归属（对照下方各节标题）；N≥10 唯一落在 0.2.3 线。
> 另有三个旧裸批号是 0.3.0 线发布前的一次性序号，现并入正式版本：
>
> | 裸批号（旧） | 归属 | 本批正式写法 |
> | --- | --- | --- |
> | `tisitan.21`（单宿主编排，lib 编排面切除） | 0.3.0 线 | `[0.3.0-tisitan.0]` |
> | `tisitan.22`（alpha.4 兼容迁移 + 防旁路加固） | 0.3.0 线 | `[0.3.0-tisitan.4]` |
> | `tisitan.23`（tool-mask 三源并集改造） | 0.3.0 线 | `[0.3.0-tisitan.4]`（与 .22 同批发布） |
>
> 0.3.0-tisitan.10 起：全仓代码/测试注释内的裸 `tisitan.21/22/23` 及两线歧义裸号已按此表
> 就地写全（见下方本批条目）；文档正文（README/ARCHITECTURE/FORK-GUIDE）与 `src/` 客户端半
> 保留裸写法，由本表集中消歧。

## [Unreleased]

分发链路批（**纯文档 + 仓库政策，零代码逻辑变更**）：把「怎么装本 fork」从一条会装到
别人包名上的 npm 指令，改写成一条 clone 即用、装方零构建权限的 git 路径；配套把构建
产物的入库政策写进 git 与三份文档，并把 npm 发布渠道正式标注为**休眠**。
本批**不 bump version**（未触碰 `preset/` 任何文件，不触发装机副本重拷）。

### Changed

- **`.gitignore`：`dist/` 整体忽略 → `dist/*` + `!dist/client.js`**。政策变更而非风格
  调整：release commit 要提交构建产物（方案 A），`exports["./client"]` 指向的
  `dist/client.js` 缺位 = 装方 Web UI 直接起不来。两种写法在 git 语义上**不等价**：
  父目录一旦整体忽略（`dist/`），目录内的 `!` 例外永不生效（git 不递归进被忽略的
  目录，那形同只有 `git add -f` 才救得回来），所以必须先解开父目录（`dist/*`）再点名
  放行。例外只点名 `client.js`：`build-client.mjs` 走 esbuild `write:false`，
  `client.core.js` 自 0.3.0-tisitan.11 起从不落盘（构建时还顺手删历史遗留），仓库里
  不存在这个文件。
- **README「快速开始」整段重写**（旧文本两条 npm 警告 blockquote 治不了的病，直接把
  指令换掉）：新增前置表（Node `>=22.15` / dsh 全局已装 / pnpm 在 PATH 及缺装法，并
  点明 `dsh plugin` 是 pnpm 转发器、pnpm 缺席时退出码 127）、五步安装流
  （`git clone --depth 1` 到永久稳定路径 → `dsh plugin --profile web add <路径>` →
  **三项验证**（`link:` 依赖 / `dsh.profile.bundles` 登记 / junction 存在，Windows 与
  POSIX 各一份可粘贴命令）→ 重启 `dsh web` → 首启日志 `[dsh-my-go] preset synced ...`
  + 会话选择器出现「MyGO!!!!! 模式」）、升级流（`git pull` → 重启，preset 按
  version+digest 双门自动重同步）、卸载流、平台差异小注（路径 / junction→symlink）。
  顶部挂**显眼禁令**：⚠ 不要 `dsh plugin add dsh-my-go@latest`。红字单列一条：
  **clone 路径必须永久稳定**——装的是 junction 不是拷贝，移动/改名/删除即启动失败。
- **README 措辞与目录结构两处对齐新政策**：特性段与「插件 config 键」段的
  「npm 安装后」→「装机后」；目录结构 `dist/` 行由「发布时生成」改为
  「`client.js` 随 release commit 入库」。

### Added

- **README 附录「手动兜底安装」**：`dsh plugin` CLI 不可用时的四步手抄流程
  （`mklink /J` junction / POSIX `ln -s` → 手改 profile `package.json` 的
  `dependencies` + `dsh.profile.bundles` → 在 **profile 目录**里
  `pnpm add @deepseek-ai/schemastery` 补运行期唯一非 peer 依赖 → 重启）。标明 bundle 层
  按 bundles 登记名自行解析并应用包内 `cordis.patch.yml`，**无需手写 patch insert**。
- **FORK-GUIDE「发布流程（发版固定动作）」小节**（挂在 §三 工程链路之下，不新起顶级
  节号以免 §三 表里「评估结论见第五节」那类交叉引用漂移）：发版六步
  （bump version → `npm test` → `node scripts/build-client.mjs` → `git add`（含
  `lib/` 与 `dist/client.js`）→ release commit → `git tag` + push）、**dist 入库口径
  写明**（release commit 必带；日常开发提交不必带，允许但不推荐；其余 `dist/` 内容
  一律不入库）、方案 B（`prepare` 现场构建）被否的实证理由（pnpm 默认拦依赖构建脚本，
  装方须在 `pnpm-workspace.yaml` 手写 `allowBuilds` 才放行）、以及 30 秒发版自检命令
  （`git ls-tree -r --name-only HEAD | grep '^dist/'`）。
- **FORK-GUIDE §六 包名陷阱条升级**为结论式（"→ 本 fork 只走 git 分发"），并记档
  README 曾给过的那条指令是供应链级误导、现已就地替换。

### Docs（publish 渠道口径统一）

- `.github/workflows/publish.yml` **保留但标注休眠**：FORK-GUIDE 工程链路表的该行的
  行名与正文、ARCHITECTURE §4 交付物表、CHANGELOG 本批三处同口径写明「未启用 npm 发布
  渠道（包名归属问题），仅 git 分发」，文件本身不改（无 npm 账号，将来拿到包名权限或
  决定改名发布时可直接复用）。
- ARCHITECTURE §5 标题「安装（npm 插件流程）」→「安装（git 分发 → profile bundle）」，
  第 1 步整条替换为 clone 流程，并说明 bundle 层自动应用 patch 的机制。

### 意外项与遗留（如实上报）

1. **施工清单没点名的 ARCHITECTURE.md §5 里藏着同一条 `dsh plugin --profile web add
   dsh-my-go@latest`**。不改就等于把供应链级误导留在第二份文档里（README 清了、
   ARCHITECTURE 还写着），已按同一政策就地替换——属本批政策范围内的必要收口，不是越权。
2. **仓库里没有 `dist/client.core.js`**（清单第 1 条把它列为放行目标之一）。
   它是 D-13.1 就被 `write:false` 取消落盘的中间产物，构建脚本还会主动删历史遗留文件，
   所以例外规则只点名 `client.js` 才是当前事实；将来若有人改回两段落盘，需同步加例外。
 3. **本机 profile 实况与 README 的「验证三项」不自洽**：`~/.dsh/profiles/web` 里
   `node_modules/dsh-my-go` junction 指向本仓库（存在），但 `package.json` 的
   `dependencies` 与 `dsh.profile.bundles` **两处都没有** `dsh-my-go`——真正让插件挂载
   的是 `profiles/web/cordis.patch.yml:18-20` 那条手写 insert
   （`- insert:` / `- id: dsh-my-go` / `name: 'dsh-my-go'`）。也就是说使用者这台机器现在
   用的是**最老的手工装法**（junction + 手抄 insert），而非 `dsh plugin add` 的
   bundle 登记路径。后果：使用者照 README 跑那三条验证会两红一绿，容易误判「文档写错了」。
   文档口径没错（bundle 登记 + patch 自动应用是 dsh 的实际机制，源码可查
   `@deepseek-ai/dsh/lib/plugin-*.js` 的 `reconcilePlugins`），是环境自己漂移在旧装法上。
   **建议使用者择机归轨**：摘掉那条手写 insert → `dsh plugin --profile web add <路径>`
   重装；不归轨则至少知道为什么验证对不上。本批按禁令未动任何运行时状态。
   已把「手抄 insert 与 bundle 登记并存 = 同一个 id 挂两遍」这一条写进 README 附录的
   回轨提示。
4. **`dist/client.js` 目前仍是未跟踪文件**（`git status` 显示 `?? dist/`）。禁令要求不
   commit，故本批只把它变成「可被 add」——使用者下一次 release commit 时需显式
   `git add dist/client.js`（`git add .` 也会带上，因例外规则已放行）。
5. **推 tag 会触发休眠的 publish.yml 并在 `npm publish` 步失败**（包名不归本 fork，
   OIDC 拿不到权限）。这是预期噪音、不影响 git 分发链，已写进 FORK-GUIDE
   「发布流程」的副作用提醒；真要消音改的是那个文件的触发条件，本批未动。
6. **本批新改的文档里另有两处先前批次留下的版本号漂移，按"version 不动"禁令没碰**：
   README 顶部 `deepseek-harness-meta` 块写 `0.3.0-tisitan.10`、FORK-GUIDE §二目录树
   注释里 `package.json` 行写「版本 0.3.0-tisitan.11」，而实际版本已是
   `0.3.0-tisitan.12`。两处都不是本批引入的，且改它们属于版本口径动作（应与 bump
   同批做），已在 FORK-GUIDE「发布流程」第 1 步写明"meta 块一并对齐"的口径，等下一次
   真发版顺手带走。

## [0.3.0-tisitan.12] - 2026-09-03

结构重构批（**0.3.0 线最后一批**；语义修复全绿之后才动刀的结构手术，棒② B4/B5
方案 + N15 + R3/R4）。**产品行为零改动**：八个 end 出口、三档 urgency、两代
runtime 的投递路由、台账顺序全部逐字保留，改的是「同一件事有几处实现」。

读数（`npm test` 机器输出，非手写）：

```
ℹ tests 324   ℹ pass 324   ℹ fail 0   ℹ skipped 0
```

净变化 +25（新档 `end-attribution.test.mjs` 23 例 + compat 的 N15 两例），
**无一处断言降级**：`.11` 已把精确计数 pin 削到 0 枚，本批只新增 pin（两枚编排
身份标记）与新增用例；等待写法的改造（见 Fixed）把「睡一会儿再断言」换成「等到
终态再断言」，是加强不是放松。

### Refactored

- **B5【最高价值】`subagent/end` 归因决策纯函数化**（新
  `preset/shared/end-attribution.mjs` 269 行 + broker dispatcher）：原先 129 行的
  事件回调里混着「八条控制出口的判定 / 六处表写副作用 / 五处通知 / 一条异步重派
  链」，任何一条分支都只能通过整套 mock-ctx 才能验。现在判定全在纯函数：
  `attributeEnd({childId, info, routing, type, ledgerRecord, hasLiveRecord,
  spawningCandidates, abortExpected, fallbackDecided, bindings, readFailure})`
  → `{decision, ops, notices, facts}`，出口枚举
  `ignore / late-duplicate / unattributable / no-owning-orchestration /
  expected-abort / fallback-in-flight / fallback-evaluation / finalize`；
  「归因到 spawning 占位」不再是终端出口而是链中一对 op。broker 侧 handler 收到
  88 行 dispatcher：取表状态快照 → 照单落 ops → 发 notices → 起执行链 → 按
  `facts.advance` 推进队列，**体内零业务 if**。
  - **铁律保持**：`fallbackDecided.add` 仍在同步段——以 op 形式随决策一起返回，
    dispatcher 收到 `fallback-evaluation` 后第一件事是落 ops（含该 guard 与
    同步预告），`void attemptFallbackRedeploy(...)` 是这一步的最后一件事
    （`.18` 的零 await 真空期协议原样成立，`failure-notice.test.mjs` 的同步预告
    两例全绿为证）。
  - E2（不在册且无占位可归因）**故意不 retire** 的理由就地补注释：类型侧三表本
    无此 childId，retire 是空转；`childOwner` 更不清——它可能指向仍活着的属主
    实例，清了会把同时段其它儿童的回程路由一起拆掉。
  - 依赖注入例外记入头注释：本模块不认识文件系统也不认识会话，失败附因经
    `readFailure` 回调**惰性**取用（早退分支一次都不读盘）。
- **B4 continue/forward 投递链手术 M1-M5**（施工顺序按推荐 M4→M5→M1→M2→M3）：
  两工具原本各抄一遍「定位 → steer → abort → queued 投递 → 投递后复籍」，四处
  同构块的差异全靠行号相邻的注释维持。合一为 broker 内五件共用件
  （`resolveContinueTarget` / `tryFacadeSteer` / `interruptForAbort` /
  `deliverWithQueueFallback` / `rearmAfterDelivery`），并显式承诺
  **helper 内 await 数量与原分支一一对应**（1/1/0/1/0）：
  - `deliverWithQueueFallback` 返回 `{messageId, delivery}`，塌档由调用方同步进
    mode（`steer` 覆盖 `queued`）；两臂 warn 文案逐字保留（含 `urgency=queued`
    与 `delivery` 两种前缀措辞）。
  - `rearmAfterDelivery` 用 `ledgerFirst` 参数**保留两工具 `followupPrompt` 的
    时序差**（forward 记账在复籍前、continue 在复籍后），不静默改台账顺序；
    `resolvePendingHelp` 参数保留「continue 清求助单、forward 由外层销账」的分歧。
  - `interruptForAbort` 把 `abortExpected.add` 与 `notifyParent` 预告**同点搬移**
    （仍在 interrupt 成功之后、queued 投递之前的同步段）；活体门槛与降级措辞不变。
  - 体量：continue 注册块 151 → 89 行（execute 体 123 → 62）、forward 注册块
    90 → 72、end handler 129 → 88；continue 支最大嵌套 6 → 3。
- **N15 投递路由合一**（`preset/shared/adjacent.mjs` 109 → 143 行）：新增
  `planAdjacentDelivery(subagents, delivery)` → `{route, invoke}`，
  route ∈ `queue`（alpha.4 internal 队列符号）/ `steer` / `legacy`（alpha.2/3
  followup）/ `unavailable`。`canQueueAdjacent` 退化为 plan 薄壳，
  `deliverToAdjacent` 内部委托同一份表——探测与投递的同构**由构造保证**，不再靠
  「判定顺序必须与投递一致」的注释（漏改一侧不报错，只表现为 queued 静默塌档）。
  既有 12 个直测用例签名与语义零改动，本批另加两例把该不变量钉住。
- **R3/R4 收尾协议显式化**：`finalizeEnd` 那句「我不推进队列——时机由调用方决定」
  的注释协议，改为决策枚举自带 `facts.advance ∈ now / no / if-owned` +
  `shouldAdvanceQueue()` 单一解释点（dispatcher 末尾唯一调用处）。**未知或未登记
  的 advance 一律不推进**——宁可冻结也不放行两个并行；新决策漏登记在
  `end-attribution.test.mjs` 的 DECISIONS 全表例里当场红。

### Fixed

- **全量并行的假红（`.11` C-12 的同类余额清干净）**：`await drain(N)` 这种
  「睡固定毫秒再断言」在 20+ 文件并行、CPU 抢占下会输给真实调度，`.11` 只修了
  4 处，本批把余下 **34 处正向等待**改为 `waitFor(终态谓词)`：25 处是 `await
  drain(N)`（bridge 16 / roster-route 12 / failure-notice 1，含手工补的 3 处缩进
  MISS），另 9 处是 codemod 根本扫不到的裸 `await new Promise(r => setTimeout(r,
  N))`（bridge 7 / multi-session 2，靠通读补齐），并**把谓词升级到紧随其后那批
  断言真正读到的量**——只等 `specs.length >= 2` 会在压力下读到 `child-*` 占位 id
  （step-3 a 的假红正是这么来的）。**谓词写窄了还会自己制造竞态**，两处现场反例
  已就地留成注释当反面教材：墓碑宽限例只等 `agentType === 'hermes'`（占位入槽即
  成立）漏了 `status === 'running'`；N18 例等 `status === 'spawning'` 早于门面
  调用，真正要等的是「spawn 已交给门面并停在那次 await」（判据取闭包捕获的
  `release`）。6 处**负向窗口**（等的是「什么都没发生」：grace 不误伤 / aborted
  不重派 / 评估窗内忽略 / 迟到 disposed 不拖垮他会话 / 迁移幂等 / installPreset
  真短路）没有可等的条件，保留固定 sleep，且一律先 `waitFor` 到正向终态再开窗。
- **临时目录 teardown 与防抖台账写的竞态**：`mock-ctx` 新增
  `removeHomeWithRetry`（有界退避，只吞 ENOTEMPTY/EBUSY/EPERM），bridge 的 8 处
  裸 `rm -rf` 改用它——插件的 50ms 防抖 `scheduleLedgerSave` 会在 teardown 期间
  落盘，直接把 `dsh-my-go/` 目录树写回正在删除的临时目录。这是**测试基建缺陷**
  不是产品缺陷（真实卸载路径有 disposer 同步补写，`.7` 已修）；彻底解法是每档
  都捕获 effects 并 dispose，本批以有界重试止血。
- `attributeEnd` 的 E0 出口把 `ops` 写成 `{}`（应为 `[]`）——新纯函数档第一批
  用例即抓到，dispatcher 侧遍历 ops 时才侥幸不炸（对象无可枚举项）。

### Tests

- 新档 `test/end-attribution.test.mjs` 23 例：八条出口逐条 + ops 内容与顺序
  （bind 必须早于 set-owner）+ notices 文案与送达顺序 + `facts.advance` 口径 +
  **三例换序回归**（E4→E5 双 guard 同册只吞不重评 / E5→E6 在飞优先于新评估，
  否则双发 end 二次重派出两个儿童 / E3→E4 属主已毁时不得消费 abort 护航；出口
  编号一律以模块内 DECISIONS 表为准）+
  readFailure 惰性计数 + DECISIONS/`shouldAdvanceQueue` 全表完整性。**全部脱离
  mock-ctx**，纯表状态驱动——这就是 B5 抽函数的验收面。
- `compat-alpha4.test.mjs` 30 → 32 例（N15 路由枚举全表 + 探测/投递同构不变量）。
- `host-parity.test.mjs` 编排身份标记 +2 枚（`shared/end-attribution.mjs`、
  `attributeEnd(`）：end 归因同属编排身份，lib 半出现即红。发布物核对那条按
  `files` 白名单自动纳入新模块，无需追加 pin。
- 稳定性：全量并行连跑 4 轮 `299→324 全绿 0 skip`；改造前同环境 4 轮分别
  fail 2/3/3/1。
- **变异探针（新防线是否真咬人）**：对 `end-attribution.mjs` 逐条注入 8 枚语义
  变异——E4 护航吞 completed 真结论、E5 在飞判定丢 `live`、advance 表把 E5 写成
  `now`、E2 归因失败顺手 retire、E2+ 占位换键 ops 倒装、E2+ 归因后不改写活槽
  判定、E6 漏登记 once-guard、E6 预告措辞与 finalize 混同——新档 **8/8 全部
  变红**（探针脚本在仓库外运行，逐条还原后按 sha256 核对字节级复原）。

### 行数账（如实）

| 文件 | 批前 | 批后 | 说明 |
| --- | --- | --- | --- |
| `preset/tools/broker.mjs` | 1800 | 1821 | **预期 −150~−200 未达成** |
| `preset/shared/adjacent.mjs` | 109 | 143 | N15 plan 表 + 路由注释 |
| `preset/shared/end-attribution.mjs` | — | 269 | 新增（含八出口逐条文档） |
| `test/end-attribution.test.mjs` | — | 348 | 新增 |

broker 净 +21 的原因不是手术失败，而是**落点约束**：M1-M5 五件共用件需要 `ctx`
（门面投递、活体注册表、通知、属主表），按 shared 铁律（零 ctx）搬不出去。实测
账目：三处内联重复消掉 **−121 行**（continue 注册块 −62、forward −18、end
handler −41），换回**共用件区 161 行**（其中 94 行代码 + 67 行同步段协议与
await 数量承诺注释）+ import/头注释 12 行——**同一块逻辑原来在两个工具里各存
一份**，所以「−121 换 +161」里含了给注释和参数化买的账。真正的收益不在行数：
同构块 3 处 → 各 1 处、end 决策可脱离替身直测（23 例新档 + 8/8 变异探针）、
推进时机从注释变成返回值。若要把 broker 压到 1800 以下，唯一合规出路是再开一个
`preset/tools/` 内的依赖注入模块（把 ctx 面显式当参数传）——那是下一轮的门面
设计题，本批不顺手做。

### 未修（有意保持，如实上报）

- **forward 仍无 `queuedHint`（排队中占位 childId 的结构化拒绝）与
  `spawningGate`（占位未 resolve 的门槛）**：continue 有、forward 没有，属
  `.7`/`.11` 既有语义差异。`resolveContinueTarget` 已把这两道闸做成参数
  （`queuedHint` / `spawningGate`），本批**不给 forward 开闸**——那会在改结构
  的一批里同时改行为。要开只需一行：`spawningGate: true`。
- `rearmAfterDelivery` 的 `ledgerFirst` 只是把既有分歧显式化，未判定孰优：
  两工具台账落账时机不同是历史事实，统一它属于行为变更，留待有语义批做。

## [0.3.0-tisitan.11] - 2026-09-02

测试基建 + CI/依赖批（全面审查棒③ C/D 区发现：N1 依赖线根治 + C-10 源码 pin 降级
+ C-09 mock 保真 + C-12 测试基建 + D-14 CI/CD + D-15 包体积）。**产品代码（lib /
preset / src）零行为改动**——施工面全在 `test/`、`scripts/build-client.mjs`、
`.github/workflows/`、`package.json`、`.nvmrc`、`.gitignore` 与三份文档。

读数（`npm test` 机器输出，非手写）：

```
ℹ tests 299   ℹ pass 299   ℹ fail 0   ℹ skipped 0
```

本批起点是 `# tests 299 / # pass 298 / # fail 0 / # skipped 1`，且**每约 5 次就有
1 次随机红**（详见 C-12）。净变化：+1（C-09 事件注册数保真例）、−1（C-10 P6 退役
一例）、skip 1 → 0（哨兵合闸）。

### Fixed

- **N1【Major】devDeps 升 alpha 线，宿主契约哨兵合闸**（`package.json`）：
  devDependencies 的 `@deepseek-ai/dsh-{agent,llm,subagent}` 此前停在
  `0.1.0-rc.8`（**低于自家 peer floor** `>=0.1.2-alpha.2 <0.2.0`；`npm ls` 报
  7 项 invalid + 1 项 extraneous）。后果不是"版本旧"这么简单：全仓唯一的宿主
  契约闸——`test/compat-alpha4.test.mjs` 末尾那条拿真 `SubagentRuntime.prototype`
  对账的哨兵（`followup` 已并入 `sendMessage`、`reportFrom` 已删、internal 队列
  符号在位）——**因为版本门槛不满足而永久 skip**，而整条 alpha.2/3↔alpha.4 兼容
  分界正建立在这几个事实上。上游改名或删符号时，本仓所有 mock 测试照样绿。
  - 实装实况（含反直觉处）：改成 `^0.1.2-alpha.4` 后 `npm install` 直接 ERESOLVE
    ——盘上残留一批 rc.8 家族包（`dsh-client-connection` / `dsh-api-gateway` /
    `dsh-host-apiproxy` / `dsh-agent-default-model`）交叉 peer 要求
    `dsh-agent@^0.1.0-rc.8`；**删掉 lockfile 也不够**（树还在盘上），最终把
    `node_modules` 整体移开重装才干净（旧树已删，未用 `--force` /
    `--legacy-peer-deps` 绕解析器）。
  - **实际装到的是 `0.1.2-alpha.5` 而不是 alpha.4**：`^0.1.2-alpha.4` 允许浮到
    alpha.5，而 alpha.5 的 dsh-agent 又 peer 要求 `dsh-llm@^0.1.2-alpha.5`，npm
    遂把整个 dsh 家族推到 alpha.5（另 `cordis 4.0.2`、`schemastery 3.18.2`）。
    即"与部署线精确同版本"在当前解析规则下做不到，除非把 devDeps 与 peer 全钉
    精确值——那等于取消对宿主的兼容声明，本批拒绝这么做。
  - 验收达成项：哨兵**从 skip 变真跑且绿**（门槛 `>= alpha.3`，alpha.5 通过）；
    `npm ls --depth=0` 由 ELSPROBLEMS 变 **exit 0 / 零 invalid / 零 extraneous**
    （`dsh-client-ui-slots` 随干净树消失）；`# skipped 0`。
  - devDeps 另加 `js-yaml@^4.1.0`（P9 的 yml 真解析用；此前它只是传递依赖）。
- **C-09【中】ctx 替身保真升级**（`test/helpers/mock-ctx.mjs` + 六文件 114 处点火点）：
  替身此前四处比真宿主**宽容**，每一处都在给真 bug 打掩护：
  - `listeners` 由 `Map<event, fn>` 改 `Map<event, fn[]>`。旧单槽写法下重复注册是
    **静默后写覆盖前写**（第一个 handler 永远不再跑，且无人知道）。点火统一走
    `dispatch(event, payload, next)`：按注册序串成 waterfall（最外层返回值即本次
    结果、链尾接调用方的 next、`next()` 重复调用当场抛错），**单 handler 时与旧
    替身逐字等价**——这是 114 处调用点可机械改写而行为零变化的前提。另备
    `dispatchEach`（真广播事件：逐个调用各拿同一份 data；与 interceptor 链是两种
    语义，不能混为一谈）与 `registeredHandlers()`（每事件注册数）。
  - 新增保真用例：`bridge.test.mjs`「broker 七个事件恰好各注册一个 handler」
    （事件清单本身也钉住：多一个少一个都要在这里说明理由）。
  - `systemPrompt.section` 重名抛错（真宿主同 scope 同名段重复注册即抛）：persona /
    orchestration / roster 三段互不撞名从此有闸，不靠肉眼。
  - `effect(fn)` 不再 `catch {}`：吞一次就把「section 注册写错」这类真 bug 永久藏起来。
  - `settings.get(ns)` 返回 `structuredClone` + **深度冻结**副本：写变异宿主存储
    当场 TypeError；每次读都是新副本（不共享引用，杜绝"改了读到的对象"被误当成
    "写回了存储"）。
  - `tools.register` 重名抛错（同 scope 注册两次是实打实的冲突）。
  - **踩出来的问题清单（如实上报）**：五项严格化**没有踩出任何一处产品代码问题**
    ——全仓一次通过，说明既没有代码在写宿主存储，也没有重复注册。踩到的是改写
    自身的两处语义坑：① 第一版把 `dispatch` 实现成"逐个调用取结果数组"，
    `agent/request` 这类 interceptor 事件当场 6 例红（handler 之间靠 `next` 串联，
    各自都拿到同一个 next 会把语义彻底跑歪），改成分层链后全绿；② 机械改写把
    `waterfallOf(listeners, …)` / `askWaterfall(listeners)` 这类"把 listeners 当
    参数传"的辅助函数体引用了不在作用域的 `dispatch`，3 处签名手工收口。
- **C-10【中】源码 pin 降级**（`test/host-parity.test.mjs` 三例重写 +
  `test/anti-bypass.test.mjs` + `test/tool-mask.test.mjs`）：详见下方映射表。
  量化（全用同一口径机器实测，非估算）：host-parity **870 → 814 行**、pin 类命中
  （`countOf(` / `.split('` / `readFile(new URL`）**133 → 107**、
  **期望值 ≥2 的「精确出现次数」断言 22 → 0 条**；现存 52 条精确计数断言全部落在
  `0`（负向不变量 26 条）或 `1`（唯一归属 26 条）这两种合法形态上，另有存在性
  `>= N` 22 条）。架构边界与负向不变量一条未松。
  收尾自查又抓出两处漏网的旧 pin（`mergeRoleBindings` 两半各 2 处调用 + 整行字面量、
  `sharedRenderRosterBriefing` 出现 2 次），已分别改为「通路在册」与
  「import 在册 + 带括号调用点存在」——后者比数次数更能抓真回归（"import 完就搁置"照样红）。
- **C-12【中】测试基建**（`package.json` scripts + `scripts/build-client.mjs` +
  `test/helpers/mock-ctx.mjs`）：
  - `npm test`：手写 20 档清单 → `node scripts/build-client.mjs && node test/apply.mjs
    && node --test "test/*.test.mjs"`。旧清单是"加档必须记得改 script"的税——
    本仓 `roster-roles` 曾整批失踪（清单里没有它，测试照样"全绿"）。改 node 自带
    通配后加档零动作；**构建前置**使 apply.mjs 的「dist 比 src 新」断言恒真，它守的
    从「你忘了跑构建」变成「构建确实产出了」。
  - `build` 脚本去 bun 壳：`bun run build:client` → `node scripts/build-client.mjs`。
  - `build-client.mjs`：esbuild 改 `write:false` 直取内存产物，**中间产物
    `client.core.js` 不再落盘**并顺手清掉历史遗留（`dist/` 只该有一份 `client.js`；
    旧写法让那份裸 bundle 跟着 `files:["dist"]` 进发布包，而没有任何路径加载它）。
  - **稳定性缺陷（本批发现并修）**：基线 `npm test` 并非全绿——约 1/5 概率随机红
    一例（实测抓到 `failure-notice`「备选链尽终局通知」与 `bridge`「retry cap 弃单
    落账」两种，单文件跑 12 次全绿、只有 20 文件并行时翻脸）。根因是**墙钟赌注**：
    `queueRetryBaseMs` 缩到 5ms 后退避整轮约 150ms，而用例用固定
    `sleep(20/100/200ms)` 等条件成立；并行抢 CPU 时 sleep 先走完 → 假红。修法：
    新增 `waitFor(pred)`（有界轮询，**超时抛错而非静默放行**），把四处"等一会儿再
    断言"改成"等条件成立再断言"；负向窗口类（"越过宽限期看有没有坏事"）保留固定
    sleep 并在注释里写明原因。修后连跑 4 轮 `npm test` 全绿。
  - README / FORK-GUIDE 的手工"N 例"计数改指向 `npm test` 机器读数口径。
- **D-14【中】CI/CD**（`.nvmrc` + 两份 workflow + `.gitignore`）：见下方前后对照。
  要点：两条 workflow 从 bun 装依赖改 `npm ci` + **lockfile 入库**；Node 版本从
  `lts/*` 改 `node-version-file: .nvmrc`（与 `engines.node` 同源）；ci 矩阵加
  `windows-latest`（本仓在 Windows 上开发部署，只跑 Linux 等于没测部署环境）；
  publish 补 tag↔version 断言与预发布 `--tag next` 派生；两档补 `timeout-minutes` /
  `concurrency` / `permissions: contents: read` / `workflow_dispatch`。
  顺带修掉一处**早已失真的注释**：两份 workflow 都写「No lockfile is committed
  (.gitignore)」，而 `.gitignore` 当时只屏蔽 bun 锁、`package-lock.json` 一直在盘上。
- **D-15【中】发布物体积**（`package.json` files）：剔 `src/`（纯构建输入；
  lib/preset/prompts 对 src 运行期零引用，已 grep 核实）+ 新增 `!docs/archive`
  （两份审查报告），`docs/ARCHITECTURE.md` 与 `FORK-GUIDE.md` 保留；
  `client.core.js` 随 C-12 自然消失。`npm pack --dry-run` 实测：
  **45 files / 278.6 kB / 未压缩 758.4 kB → 32 files / 230.4 kB / 619.9 kB**
  （−13 文件、tarball −48.2 kB / −17.3%、解包后 −138.5 kB / −18.3%）。
  白名单正确性不再靠肉眼：见 P5 的「安装目录模拟」。

### pin 删降留逐条映射表（C-10）

裁决口径（写进 `test/host-parity.test.mjs` 头注释，FORK-GUIDE §三同步）：
**① 唯一归属 / 某写法不得出现 → 保留**（重构不会让它红，除非语义真变了）；
**② 出现次数（X=2/3/N 的调用点枚举）→ 删除或降为 `>=1`**（加一处合法调用、把两行
合一，都会让语义正确的改动红掉）；**③ 整行字面量复刻（含变量名、参数顺序、缩进）
→ 删除**（那是在编译期重抄一遍源码，改个标识符就得来改测试）；**④ 用户可见措辞与
日志文案 → 删除**（负向 grep=0 除外），文案契约归行为档。

| 编号 | 位置 | 内容 | 裁决 | 依据（哪档行为兜住 / 为何没兜住） |
|---|---|---|---|---|
| P1 | `lib 半零编排面` | 42 枚编排标记 grep=0 + STATE_MARKERS 9 枚 ×3 | **留（瘦身）** | 归属边界绝不动，只压表示：42 → 10 枚「身份级」标记（`name: 'go_work'` / `name: 'orchestration_status'` / `new Orchestration(` / `dispatchWork(` / `advanceQueue(` / `startContinuable` / `ctx.on('subagent/end'` / `orchestration-ledger.json` / `shared/orchestration.mjs` / `createChildRegistry`）；八表定义 9×3 → 2 枚代表（`childOwner` / `activeFallback` 声明），表的全形状由 `child-registry.test.mjs` 8 例兜 |
| P2 | `RPC/settings 契约` | 单通道 + 端点全家唯一 + broker 零注册零 RPC + 快照桥双向 | **留** | 全是唯一归属/负向。仅删 `settingsScope`=0 一条：钉的是"某个变量名不许存在"（实现细节），真正的边界「注册句柄不被消费」由 load/save 全走 RPC 的行为档证明 |
| P3 | `host/broker 接线分界` | 35 条 `(marker, expected)` 精确计数对 + child-registry 内部 6 条 + `.7` 批 13 条 + 名册/persona/合并 6 条 + 顺序 pin 1 条 | **删 22 / 降 11** | 降为 `>=1` 的十一条是「无行为档覆盖的跨表/跨模块通路」：`sharedRolePersona(`、`sharedResolveRoleToolFilter(`、`resolveEffectiveBinding(`、`findRecordWithLedgerFallback(`、`spawnChild(`、`attemptFallbackRedeploy(`、`abortExpected.add(`、`abortExpected.delete(`、`fallbackDecided.add(`、`pendingFallbackByLabel.set(`、抢属主闸（该文案是错误正文而非"通知措辞"，且行为档只测了 continue 侧 → 留 `>=1` 并写明理由）。删的 22 条逐条去向：`childRegistry.*` 五组调用点计数 → child-registry 行为档 + 新钉负向 `broker 零直引 activeFallback.`；`pruneLedgerParents` 两条 → 该函数行为档 8 处；备选覆盖登记/消费四条 → `fallbackEntry` 行为档 21 处；通知措辞计数八条 → `failure-notice.test.mjs` 逐条测"父会话收到哪条通知、什么顺序"；`finalizeEnd`/`pickFallbackEntry` 签名级 → bridge/roster-route；`typeOfAgent(sessionTypes…)` 表达式级 → roster-route 三例；`indexOf('备选评估中（') < indexOf('void attemptFallbackRedeploy(')` → 与 failure-notice 的 `iPreview < iRedeploy` 完全重复 |
| P4 | `名册简报段为 broker 独有注册` | `order: 10` 计数 | **删（1 条）** | 数值是排版选择不是不变量；`def.order` 存在 + 三段共存 + 无 `complete:true` 由 `failure-notice.test.mjs` 行为档兜（该例真读 `def.order`）。`name: 'dsh-my-go:roster'`=1（同名重注册即抛 → 唯一归属）与 `complete: true` 负向、lib 零注册全留 |
| P5 | `shared 单一源` | import 行数下限 + 逐条 existsSync | **留并加强** | 新增「安装目录模拟」：按 `package.json` files 白名单算出发布物集合，逐条核对两半每个 import 目标都在其中——只验本仓 existsSync 不够，白名单漏一个目录时本地 299 例全绿而用户侧 `MODULE_NOT_FOUND`。附因提取通路的三处整行复刻降为存在性 |
| P6 | anti-bypass `两侧 deny 接线 pin` | `...ADJACENT_BYPASS_TOOLS`=2 + `denyTools(`=3 | **整例删除** | 纯调用点计数：helper 内联或多一处合法调用即假红；"两侧真的落下这三件套"由同文件 `agent/created` 两例**逐名断言 restrict 实际收到的清单**，比数出现次数强得多 |
| P7 | 分界断言的 lib=0 半边 | 与 P1 同机制各写一遍 | **合并** | 同一件事在两处各红一次没有额外信息量；统一由 P1 的 `ORCHESTRATION_IDENTITY` 与新 `BROKER_ONLY_PATHWAYS` 两个循环承担 |
| P8 | tool-mask `DEFAULT_DENY` | 空数组 + 私有工具名 grep=0 | **留** | 负向不变量（一出现就是回归），与计数无关 |
| P9 | tool-mask `agent.cordis.yml` | 从 `- id: tool-mask` 起截文本 + 正则扫三件套 + 注释措辞 doesNotMatch | **前三条留并改真解析；措辞 pin 删** | 旧写法等于"用眼睛读 yml"：缩进一变、条目改 flow 风格 `[a, b]` 就静默假绿 → 改 js-yaml 真解析（并为宿主的 `!!js` 标签补 scalar passthrough 类型）。`explicit override, highest` 钉的是注释文字；并集语义本身由 `resolveDeny` 两组用例逐条钉着 |
| P10 | anti-bypass `门面收口` | 值集合 + 两条 doesNotMatch + `deliverToAdjacent(`=3 | **值集合与两条 doesNotMatch 留；计数降 `>=1`** | 名字改了就红 = 契约本身；负向（不得直调 `childAgent.steer(`、不得自造 `mygo-steer-*`）留；三档投递点数量会随共用体重构变化 → 只钉通路在册 |
| — | `.8` / `.9` / `.10` 三批在册 pin | `await syncTreeFilewise(`=2、`trimSnapshotForPanel(`=2、`attachBeforeUnloadGuard`=2、`setDirty(false)`=3、`disabled: saving…`=2、`guard export function`=3、`revision: null`>=2、`modelListErrorFor`>=2、`errors`>=3、`mutateDraft((prev) =>`>=4、整行 `if (typeof revision === 'number') body.revision = revision`、`.7` 缓存纪律五条（含两条完整语句复刻）、`details: {}` >=8 | **降 `>=1` / 删 / 改写** | 定义唯一与写法不得出现类一律留：`const mutateDraft =`=1、`      setDraft,`=0、`setDraft: mutateDraft,`=1、`makeSelect(row.provider`/`row.model`=0、`备选${chain}`=0（两半）、`s.rosterLines.length - 1`=0、`await cp(`=0、`await writeFile(markerPath, version`=0、`'.agent-presets'`=1、`const marker = ${version}+${digest}`=1、hook 位置比较、`config.installPreset !== false`=1、`PANEL_HISTORY_TAIL`=8 定义。信封合规那条**改写为 1:1 配对**（`code: '` 次数 == `details:` 次数），空 details 下限 8 → 6（分支数随功能增减本属正常） |

### CI 文件前后对照（D-14）

| 维度 | 前 | 后 |
|---|---|---|
| Node 版本 | ci 完全不管（由 bun 带）；publish 用 `node-version: lts/*`（随时间漂移：今天 22，明年 24） | 两档 `actions/setup-node@v4` + `node-version-file: .nvmrc`（新增 `.nvmrc` = 22.15，与 `engines.node` 同源） |
| 安装 | `bun install`，注释称"没有 lockfile"（实际有，只是没入库） | `npm ci` + **lockfile 入库**（`.gitignore` 去掉 `package-lock.json`） |
| 类型检查 | `bunx tsc --noEmit` | `npm run typecheck:archive` |
| 测试 | `bun run test`（经 bun 壳） | `npm test`（构建 bundle → 冒烟 → 通配全档） |
| 运行环境 | 只有 ubuntu-latest | 矩阵 `ubuntu-latest` + `windows-latest`，`fail-fast: false` |
| 发布校验 | 无（tag 与 package.json 版本可以各说各话） | publish 补 tag↔version 一致性断言；ci 补 `npm pack --dry-run` |
| dist-tag | 隐含 `latest`（`x.y.z-tisitan.N` 形态按 semver 全是预发布，却在抢占 latest） | 版本串含 `-` → `--tag next`，否则 `latest` |
| 工作流卫生 | 无 timeout / concurrency / permissions 声明，不可手动触发 | 两档补 `timeout-minutes: 20`、`concurrency`（ci 可取消；publish 故意 **不**取消，防半途留空档）、`permissions: contents: read`、`workflow_dispatch` |
| 认证 | OIDC Trusted Publishing（不变） | 同，并显式注明"故意不设 registry-url / NODE_AUTH_TOKEN" |

### Tests

- 新增 1 例（bridge：事件注册数保真）；删除 1 例（anti-bypass P6）。
- 改写：`tool-mask.test.mjs` cordis.yml pin 换真解析；`compat-alpha4.test.mjs`
  哨兵真跑 + `agent/request` 注册数断言；`host-parity.test.mjs` 三例（反向 parity
  主断言 / 接线分界 / 名册段 + shared 源）按映射表重写；六文件 114 处事件点火点
  机械改 `dispatch()`（含 3 处辅助函数签名手工收口）。
- **变异探针（四次，全部当场按字节还原并复跑全绿）**：
  ① C-09 五项严格化逐个构造触发场景 → **6/6 生效**（两 handler 都在册且串成链、
  重名 section/工具抛错、effect 异常外抛、settings 写变异 TypeError、`next()` 重复
  调用抛错）；② 在 broker 里给读到的 settings 加一行 `stored.__probeWrite = 1`
  → **6 例红**（证明深冻结那条闸真的能抓产品代码的写变异）；③ `files` 白名单故意
  漏 `preset` → host-parity **1 例红**（安装目录模拟生效）；④ 把契约哨兵的断言
  反转（要求 `proto.followup` 等于不可能值）→ compat **1 例红**（证明哨兵不是空转，
  真在拿宿主 prototype 比划）。

### Docs

- README.md：开发环境段重写（依赖线 + 哨兵合闸 + `# skipped 0` 证据 + lockfile /
  `npm ci`）；快速开始加**包名归属警告**（见「意外项」2）；贡献段 bun → npm，
  例数改贴机器读数口径；目录结构 test / dist 两行同步。
- docs/ARCHITECTURE.md：§4 交付物四行重写（`src/` 不再随包发布、`test/` 通配与
  替身保真与机器读数口径、`scripts/` 只出一份 bundle、新增 `.github/workflows/` 行）。
- docs/FORK-GUIDE.md：§三「测试」小节新增两段口径说明（pin 四判据 + 量化结果、
  替身保真五项）与整节**「工程链路（依赖 / CI / 发布）」7 行表**；测试台账五行更新
  （tool-mask / bridge / host-parity / compat / anti-bypass / mock-ctx）；文件目录
  加 `.nvmrc` + `package-lock.json`；§六 已知陷阱加三条（Windows 腿本机预验不了与
  POSIX 门控要求、npm allow-scripts 跳 esbuild postinstall 的实测、包名归属）。
- 顶部批号命名空间注记：0.3.0 线范围 `N=0..10` → `N=0..11`。

### 意外项与遗留（如实上报）

1. **基线不是全绿**：接手时 `npm test` 约 1/5 概率随机红（实测抓到两例，见 C-12）。
   这不是"偶发环境问题"，是测试自身缺陷——固定 sleep 等条件在并行下必然翻脸。已修。
2. **`dsh-my-go` 这个包名在公共 npm 上不属于本 fork**（实测：`npm view dsh-my-go`
   → maintainer `kuohu`、`latest = 0.4.3`、版本列表里**零**个 `-tisitan` 版本）。
   所以 `publish.yml` 的 Trusted Publishing 在未获得该包名权限前必然 403，而 README
   原来的 `dsh plugin add dsh-my-go@latest` 装到的是**那个包**。这是先于本批存在的
   事实：本批只把它写进 README 与 FORK-GUIDE，并把 dist-tag 规则做对（预发布不抢占
   latest）。**要不要改名发布，是使用者的决策，本批不擅专。**
3. **"与部署线精确同版本"这条验收做不到**（原因见 N1）。实质目标（哨兵真跑 +
   `npm ls` 干净 + 零 extraneous）已达成，字面目标（精确 `0.1.2-alpha.4`）未达成，
   且没有用 `--force` / `--legacy-peer-deps` 掩盖。
4. **本机 npm 带 allow-scripts 策略**：`npm install` 报 esbuild postinstall 未被覆盖，
   实测 `npm run build` 仍产出正常 bundle（esbuild 0.28 走 `@esbuild/win32-x64`
   optional binary，postinstall 只服务旧版二进制下载）。CI 的 npm 无此策略，行为
   不同但不影响结论；已记入已知陷阱。
5. **Windows CI 腿本机预验不了**，矩阵那一半只能等首跑反馈。已知两处平台差异写进
   FORK-GUIDE（POSIX 符号链接用例须按 `process.platform` 门控；本仓目前无 symlink
   用例，风险点在 `preset/` 目录同步与 npm 脚本引号）。
6. **替身严格化的残留不对称**：`test/host-lib-fixes.test.mjs` /
   `test/settings-fence.test.mjs` / `host-parity.test.mjs` 用的是 lib 侧本地 ctx
   mock（合计 4 处 `listeners.get('settings/updated')(...)` 直调），其 `on` 仍是
   单槽语义。lib 半确实每事件只注册一次，但**这条没有闸**。下批要么把三处 lib mock
   并进共享替身的多播口，要么在 lib 侧补一枚注册数断言；本批守"零产品代码改动"
   的边界没有扩到那里。
7. **未做**：`scripts/` 仍在发布白名单里（剔掉还能再省一点，但 `dump:session` 对
   装机用户有用，本批不动）；`node --test` 的并发度仍取默认（并行度=CPU 数，正是
   上面那类 flake 的放大器——已由条件等待根治，未靠降并发掩盖）。

## [0.3.0-tisitan.10] - 2026-09-02

文档总账批（**纯文档 / 注释 / 代码注释修订，零行为变更**）：落地全面审查四棒报告的
文档漂移清单（棒④ D1-D12）、批号命名空间治理（棒④实测 44 处不可唯一定位）、注释漂移
修订（棒② B6 清单）与教训注释压缩（棒② B6-B 档 10 处）。不改任何代码逻辑、不动工具
schema / 事件语义 / 通知文案 / 台账形状；version `0.3.0-tisitan.9 → 0.3.0-tisitan.10`。
套件计数基线 **299（298 pass + 1 skip）不变**——注释改动不涉及任何被 host-parity 源码
计数锁定的 needle，实测全绿。

### Docs

- **README meta version** `0.3.0-tisitan.5 → 0.3.0-tisitan.10`；环境要求段的宿主版本口径
  对齐 package.json peer：理论最低 `0.1.0-rc.6+ → 0.1.2-alpha.2+`（与 `>=0.1.2-alpha.2 <0.2.0`
  一致），开发时环境补「实装宿主 `0.1.2-alpha.4` / 本仓 node_modules 钉 `0.1.0-rc.8`」的
  真机与本机之分（D4/D10）。
- **DSV4P0813 晋升机制三处描述**（README / ARCHITECTURE §2.3 / FORK-GUIDE 机制表）：
  统一为 tisitan.7 后的真相——**按事件自身类型直判**（`tool/call` 事件直判或 `turn/end`
  促升），删「首次 tool/call 即扫数组倒判」旧表述（D5）。
- **ARCHITECTURE §2.7 养护闸表述纠正**：`currentMap` 超 500 条时 `enforceCurrentCap`
  （`beginSpawning` 路径触发）**淘汰最旧 + warn**，非「拒绝新占位」——与 §2.1「超闸淘汰最旧」
  口径统一（D6）。
- **契约哨兵语义澄清**（README 目录树 test 行 / FORK-GUIDE compat-alpha4 行）：哨兵读
  **仓库自身 node_modules**，本机钉 `0.1.0-rc.8`（低于 alpha.3 门槛）→ **恒 skip**；实装宿主
  alpha.4 的契约对账依赖**真机验证**，非本机跑绿即可信（D10）。
- **UI 机制表文件指针修正**（FORK-GUIDE）：树状图面板 / 自动跳转两行的实现位置
  `src/client.js → src/panel-tree.js`（tisitan.15 已拆，TreePanel 与自动跳转定时器本体住
  panel-tree.js，client.js 仅装配注入）（D7）。
- **lib 行数四处已是现值 632**（README 目录树 / ARCHITECTURE 交付物 / FORK-GUIDE 逻辑图 +
  目录树）——先前批已同步，本批核对确认无「当前 lib=391」的漂移表述（D2/D9）。
  唯二仍在的 `391`（[0.3.0-tisitan.0] 的「1636 → 391」）与 `1703`（[0.3.0-tisitan.5] 的
  「broker 1754 → 1703」）是**各批次发布当时的行数增减记录**（历史事实，非现状声明），
  改成今日现值反而伪造历史，故**刻意保留不动**（D3/A9 的处置说明）。
- **归档**：`docs/code-review-2026-08-30.md` 移入 `docs/archive/`，文首加「已销账：10 项工单
  8 修 / 1 变质切除 / 1 数据遗留（legacy 桶）」横幅；README / FORK-GUIDE 的 docs 树描述同步
  （D8）。

### 批号命名空间治理

- **CHANGELOG 顶部新增「批号别名表」**（见本文件上方），注明两条序号线 + `tisitan.21/22/23`
  的一次性并入映射，为文档 / `src/` 保留的裸写法提供集中消歧锚点（D13）。
- **代码 / 测试注释裸批号写全（非-src 代码全量，共约 177 处）**：覆盖
  broker.mjs 48 / lib/index.js 34 / bridge.test.mjs 25 / host-parity.test.mjs 18 /
  roster-route.test.mjs 8 / archive.mjs·misc.mjs 各 4 / 及 child-registry·constants·
  roles·tool-mask·agent.cordis.yml·build-client·dump-session·orchestration(.mjs/.test)·
  settings-{fence,guard}·compat-alpha4·anti-bypass·client-smoke·failure-notice·
  host-lib-fixes·panel-format·chain-rows·roster-{roles,rows}·tool-mask.test·apply 等。
  两线同号的裸 `tisitan.1..9` 按其**所在段落描述的批次语义**判定 0.2.3 / 0.3.0，
  `tisitan.21/22/23` 按别名表转 `0.3.0-tisitan.0/.4/.4`。示例判据：
  - 出现 `N5..N18` / 备选 once-guard / abort 护航 / retireChild / 事件直判 / 缓存纪律
    → **0.3.0-tisitan.7**（运行时语义修复批）。
  - 出现 台账持久化 / 队列停摆 / 可观测性四缝 / defaultBindings 清空 / 去私有化
    → **0.2.3-tisitan.6/7/8**（0.2.3 线对应主题批）。
  - 出现 revision 围栏 / A-05 结构化名册 / A-06 组合框 / E1-E10 lib/client → **0.3.0-tisitan.8/9**。
  - `tool-mask.mjs` 的 `config.deny` 覆盖 bug → **0.3.0-tisitan.4**（原 `tisitan.23`，
    全仓孤例且在安全注释里，最优先改；D14）。
  - **有意不改**：`host-lib-fixes.test.mjs` 三处 `version: '9.9.9-tisitan.0'` 是**合成测试夹具字符串**
    （非批号引用）；`src/` 客户端半裸写法保留（改它会使 `dist/client.js` 变陈旧，触发 `apply.mjs`
    的 dist 新鲜度断言，而 `build` 依赖 bun——纯文档批不动构建产物），改由顶部别名表集中消歧；
    文档正文（README / ARCHITECTURE / FORK-GUIDE / 归档审查报告）同理保留裸写法由别名表兜底。

### Comments

- **broker.mjs 文件头**：邻接投递适配层指针 `misc.mjs → adjacent.mjs`（补齐 sessionEvents，
  并声明四符号）（C17）。
- **orchestration.mjs 头注释**：删「broker and lib run the exact same state machine」——
  0.3.0-tisitan.0（原 tisitan.21）起 lib 不建实例，改述「broker 独占建实例 + lib 经快照桥
  单向消费；类留 shared 只为 ctx-free 与可独立单测」（C18）。
- **constants.mjs 兜底闸注释**：「这两个上限」→ 明确三枚 CAP（CURRENT_MAP_CAP /
  LEDGER_PARENTS_CAP / HISTORY_CAP）各自的异常路径（C19）。
- **broker.mjs 八表注释块**：压成「唯一出处在 child-registry.mjs 头注释」指针，并写清
  解构的七张 = 单表直接读写点、第八张 activeFallback 只经方法消费（C20）。
- **broker.mjs `fallbackDecided` 注释重写**：从「Set 不设上限（条目数为进程内子代理总数）」
  改述为「生命周期由 0.3.0-tisitan.7 rearmChild『复活即新世代』清理接管，现存条目 ≈ 在飞
  备选评估数，不随进程历史单调累积」——描述现状而非把泄漏当设计（C21）。
- **README continue queued 档描述**：补「无排队通路则塌档 steer 并 warn、mode 如实回报，
  绝不静默降级」（C22）。

### Internal（教训注释压缩，A 档 18 处「为什么」资产一字不动）

- broker.mjs 三份相同的 alpha.4 门面适配说明（continue 投递 / need_help 上报 / forward 投递
  三处）各压成一行 `shared/adjacent.mjs` 头注释指针；八表块压成 child-registry 指针。保留
  全部 fork 策略性因果，仅剥离与 shared 头注释重复的机制复述（D23-D26）。

## [0.3.0-tisitan.9] - 2026-09-02

设置页加固批（全面审查棒③发现的 3 项：E6/A-03 + A-06 + A-05）。施工面：
`src/settings-core.js`（含新档 `src/settings-guard.js`）、`src/panel-tree.js`、
`lib/index.js`，以及为收口「三处名册格式实裂」而动的
`preset/shared/roles.mjs` + `preset/tools/broker.mjs`（只改名册投影一处，
编排语义与文本输出零变更）。套件 274 → **299**：新增两档测试文件并注册进
`package.json` 显式清单，host-parity 增一例本批源码 pin。src 有改动 ⇒ 重建
`dist/client.js`（11 个 src 模块全进包；`test/apply.mjs` 的 dist 新鲜度断言
自上一批起兜住「忘重建 bundle」，本批正好用上）。

### Fixed

- **E6/A-03【Major】设置页「未保存 / 并发写」防线（拆两步的第一步）**
  （`src/settings-core.js` + 新档 `src/settings-guard.js` + `lib/index.js`）：
  8 张卡 × 多字段 + 角色区 + 工具屏蔽全走一个 `saveSettings`，而
  `settings-core.js:20` 收下的 `close` 参数收下就扔、编辑面全程没有 dirty 概念
  ——改一半误关页签 = 静默全丢，另一页签并发改 = 后写悄悄盖前写。本批：
  - **dirty + beforeunload**：所有草稿变更（含 roles-editor 经 `deps.setDraft`
    的写，dep 名不变、换实现）汇聚到 `mutateDraft` 一处置位，加载成功 / 保存
    成功 / 显式重载三处复位；dirty 期间挂 `beforeunload`（宿主
    `SettingsSectionOwnerProps` 已核实只给 `close`，没有 onClose 也没有可挂的
    卸载时机，故页内角标 + 页外拦截双管）；保存行挂「● 未保存」角标；`close`
    从此有了真实使用点——「保存并关闭」只在保存成功时关页，失败与冲突绝不关。
  - **revision 围栏**：loadSettings 额外回带 `revision`（真源 = 宿主
    `settings.describe()` 的 descriptor.revision，即 raw user section 单调版本
    号，外部手改 settings.yaml 也算；宿主不暴露时回落本半进程内计数、由
    `settings/updated` 驱动）。保存原样带回，版本不符即
    `ok:false + conflict`（details 带 `{expected, actual}`）**且一次写都不发**；
    宿主 `mutate` 吃第三参时把围栏交给它在命名空间写队列内执行（检查与写入之间
    无 TOCTOU 窗；用 describe 与真实版本分叉的替身复现了这段窗并把
    `SETTINGS_CONFLICT` 稳定错误码映射回同一形态）；保存成功回带**新版本号**，
    否则用户接着改第二处会自撞一次假冲突；缺凭据（旧前端 / 脚本直调）= 无条件
    写，绝不发明 `0` 当假版本。前端冲突后锁死两枚保存按钮 + 亮「他处已修改，
    请重新加载」，唯一出路是显式重载（本地凭据同时作废）。
  - **scope 注释伪前提修正**：`settings-core.js:46` 的「DSH SettingsScope
    doesn't support nested reads」是假的——宿主 `scope.get()` 返回整份命名空间
    值，嵌套读从来不是问题。改成事实：读写走 RPC 是因为 path-ops 编译面（set /
    unset 混合、脏键过滤、缺失键整删、旧顶级键迁移）与 bindings 合并同属 lib 半
    唯一权威，浏览器侧再抄一份就是两处真相；`sp` 在这里只是服务可用性门禁。
    **按裁决不做 RPC→settingsScope 迁移**（另立专项）。
- **A-06【中】「下拉框可手填」承诺兑现 + 渠道清单失败不再伪装成空清单**
  （`src/settings-core.js` + `lib/index.js`）：
  - 渠道与模型两栏从裸 `<select>` 改 input + datalist 组合框（与
    `roles-editor.js` 工具名输入同模式；链编辑器内置卡与角色卡共用故一并生效）：
    清单在场点选照旧，拉不到或渠道没上报模型时直接键入——此前页面顶部一直写着
    「不影响手填：下拉框也可以直接输入自定义值」，而控件根本不给输入，用户只能
    刷新碰运气。空值语义不变（留空 = 跟随 Sisyphus，改由 placeholder 表达）。
  - provider 清单拉取失败曾把 `models[pid]` 整键删掉，与「该渠道确实没有模型」
    在客户端完全同形；现在失败渠道 `models[pid] = []` + `errors[pid] = 原因`
    随响应回报，设置页据此在该链行下挂行内提示（「⚠ 渠道 X 的模型清单读取
    失败：<原因>（可直接手填模型名，不影响保存）」），与空清单可分。
  - 顺带把逐渠道的串行 `await` 改 `Promise.allSettled` 并行（B-06 顺带面）：
    旧写法 N 个渠道 = N 倍首屏延迟，一个慢渠道拖齐全栏，失败渠道还悄悄吞因。
- **A-05【中】花名册行格式实裂收口：snapshot 改发结构化 roster**
  （`preset/shared/roles.mjs` + `lib/index.js` + `preset/tools/broker.mjs` +
  `src/panel-tree.js`）：核实结果是**三式并行**而非两式——`lib/index.js` 的
  `renderRosterLines` 与 `broker.mjs` 的同名函数是逐字相同的 18 行副本
  （`- 角色 | 模型 | 备选N | 工具 | 人设`），而 `shared/roles.mjs` 的
  `renderRosterBriefing` 是第三式（`→` 分隔 + 备选链明细），`lib/index.js:325`
  与文档宣称的「同源同格式」名不副实；面板又靠 `rosterLines[0]` 必为表头的位置
  约定 `slice(1)` 取数、`length - 1` 当计数，等于把 host 的字符串措辞当 API，
  host 改一个字这里就静默错位。修法：
  - `shared/roles.mjs` 新增 `rosterEntries(bindings)`（条目语义唯一源：
    `role / builtin / provider / model / modelText / chain[] / toolFilterText /
    personaSource`）+ 两个文本投影 `formatRosterRow` / `formatRosterChainDetail`；
    `renderRosterBriefing` 改吃同一份条目，输出逐字节不变（既有「字节稳定」
    断言继续守住）。
  - 两半各删一份 18 行副本：broker 的 `orchestration_status` 花名册区文本与
    lib 的 `rosterLines` 都由 `formatRosterRow` 投影，**文本一字未改**。
  - snapshot 出口新增结构化 `roster`，`rosterLines` 降级为同数据的
    **deprecated 文本镜像**（保留兼容期：旧 dist 包与取证脚本仍按行读；grep
    核实 panel-tree 是 rosterLines 的唯一运行时消费者，但 lib 与浏览器包在装机
    形态下不同步升级的窗口真实存在，故不硬删）——面板优先吃 `roster`，仅对旧
    host 半回落 `rosterLines`。
  - 面板表头文案、计数徽章、`+N` 备选链徽章、「自定义」徽章全部客户端自持。

### Tests

- 新增 `test/settings-fence.test.mjs`（13 例）：revision 真源走宿主 `describe` /
  回落到进程内计数器且只数本命名空间的 `settings/updated` / 过期凭据就地拒绝
  **且 `mutate` 一次都不发** / 凭据新鲜时透传 expectedRevision 并回带新版本号 /
  describe 与真实版本分叉复现预检-提交窗的 `SETTINGS_CONFLICT` 映射 / 无凭据
  兼容写不塞假第三参 / 旧宿主两参 `mutate` 时以 `arguments.length === 2` 为证
  （多一枚 `undefined` 对严格校验第三参的宿主就是越界实参）/ `listModels` 三
  渠道同一 tick 全部发起（并行证据，串行写法在此必红）+ 单渠道失败只脏自己 +
  `llm` 缺席仍给 `{providers,models,errors}` 形状 / `snapshot.roster` 结构化
  字段齐备且 `rosterLines.length === roster.length + 1`（同源，多的正是表头）/
  lib 文本镜像、shared 简报、结构化条目三处语义一致 / bindings 形状漂移（非
  数组 fallbacks、脏 toolFilter、null 行）不炸。
- 新增 `test/settings-guard.test.mjs`（11 例，无 React 无 DOM）：load 结果归一
  （剥出 revision、旧 host 无版本 → `null` 而非伪 `0`、`ok:false` / value 缺席 /
  数组 / 空响应一律 failed）；save 结果三态归一（成功 adopt 版本、`value:null`
  仍算成功、conflict 独立成态并**作废本地凭据**、宿主原生 `SETTINGS_CONFLICT`
  不降级成 `settings-rejected`、真失败保留 host 原因）；
  `attachBeforeUnloadGuard` 挂一个监听 / disposer 精确摘除 / 重复解除幂等 /
  事件必须 preventDefault + `returnValue`（否则浏览器不弹自家确认框）/ 非浏览器
  环境返回可调用的空 disposer。
- `test/host-parity.test.mjs` 27 → **28** 例：新增一例本批源码 pin（24 条：dirty
  汇聚口唯一且角色区不豁免、hook 必须排在 `!sp` 早退之前（位置比较而非计数）、
  `close()` 真被消费、冲突后两枚按钮锁死、组合框在册且裸下拉 grep=0、渠道失败
  与结构化名册在册、两半自抄的名册格式 grep=0、守卫模块只暴露三个纯出口）。
- 全量：**299 例**（298 pass + 1 skip 宿主契约哨兵）。

### 反向 parity 断言同步（零删除）

- **唯一的 needle 放宽**：信封合规锁从「`code: '` 次数 == `details: {}` 次数」
  改为「== `details:` 次数」，另加一条 `details: {}` >= 8 的下限锁。理由：
  conflict 分支的 details 必须携带 `{expected, actual}`，只认空对象会把「写了
  有效 details」误判成缺项——契约要求的是字段在场，不是内容为空。
- 新钉 grep=0 六条：`makeSelect(row.provider` / `makeSelect(row.model`（裸下拉
  不得复活）、`s.rosterLines.length - 1`（位置约定退役）、`备选${chain}`（两半
  自抄行格式）、`for (const pid of providers) {`（串行 await 循环）、
  `      setDraft,`（roles-editor 吃裸 setDraft）。
- 既有 needle 零改且全绿：`rpc.handle('/dsh-my-go'` 仍 1、`settings.register(`
  仍 1、`trimSnapshotForPanel(` 仍 2、`await syncTreeFilewise(` 仍 2、
  `'.agent-presets'` 仍 1、`renderToolMaskEditor({ draft,` 仍 1；
  `rosterLines` 相关三条既有断言（降级空态 / 热更后反映 / 裁剪不影响附带）
  原样通过——文本镜像字段保留，没有一处需要放宽。

### Docs

- README.md：花名册常驻区条改写（结构化 roster + 三处共用语义源 + 旧位置约定
  作废）；新增「设置页未保存与并发写防线」条；WebUI 配置条补「可手填输入框 +
  渠道失败行内提示」；目录结构 lib 632 行 / settings-core 描述 / 新增
  `settings-guard.js` 行；套件 274 → 299、测试文件 18 → 20。
- docs/ARCHITECTURE.md：§2.5 新增「revision 围栏」与「未保存防线」两条契约
  （含「为什么不自动重放合并」的取舍）；§3 花名册段改写为结构化 roster 三处
  同源，并新增「设置页读写」段（scope 只做门禁、可手填、listModels 并行 +
  errors）；§4 交付物 lib 行同步。
- docs/FORK-GUIDE.md：包声明版本与例数；拓扑图两行（listModels 并行、roster
  常驻）；文件目录 lib 632 行 / settings-core / 新增 `settings-guard.js` /
  两档新测试文件；机制映射新增三行（并发写围栏、未保存防线、模型选择可手填）
  并更新快照桥行与花名册常驻区行为结构化 roster；测试台账 host-parity 28 例并
  追加两档新档；lib 行数 568 → 632。
- **编号歧义（承上一批记账）**：发布 `0.3.0-tisitan.9` 后，旧文档中裸写
  「tisitan.9」的 0.2.3 时代标记（如 ARCHITECTURE 的「历史形态（tisitan.9→20）」
  段）同样落入两套序号共用问题；本批新注一律带条目号（E6/A-03 等）自我消歧，
  全库改写仍留给文档总账批。

### 已知边界（本批不覆盖）

- revision 只在同一 host 进程内有权威：多 host 进程共享同一份 settings.yaml 时
  各进程计数独立（宿主 `describe` 真源可用时不受此限）。
- 首启 legacy 键迁移会自己 bump 版本：迁移前就打开的设置页，第一次保存会撞到
  一次 conflict 并要求重载——语义正确（配置确实变了），但用户会看见一次。
- E6 的第二步（草稿分桶级脏追踪、字段级冲突可视化、RPC→settingsScope 迁移）
  按裁决另批。

## [0.3.0-tisitan.8] - 2026-09-02

lib/client 修复批（全面审查棒③发现、棒④交叉验证校准定级的 11 项，按序施工）：
施工面跨 lib（存储 / 安装 / RPC 半）与 src（client 半面板与设置页）三面，
**broker 半与 preset/shared 零改动**。src 有改动 ⇒ 重建 `dist/client.js`
（esbuild + ModuleLoader 包装，构建确定性已由棒④实证）。套件 252 → **274**：
新增两档测试文件并注册进 `package.json` 显式清单，另在 host-parity 增两例
「本批修复在册」源码 pin。

### Fixed

- **E1【Critical】lib settings 注册静默塌方**（`lib/index.js` settings 块）：
  一个 try 罩到底 + 空 catch 零日志。`settings.register` 抛（schemastery 解析
  不到 / 形状冲突）会连带吞掉 `ctx.on('settings/updated')` 与读盘接线——热更
  监听根本没挂上，此后 WebUI 改绑定全部无声失效，而外面只看得到「什么都没
  发生」。改为**两个 try + 两条 console.error**：注册失败只丧失 schema 校验面，
  读盘 / 迁移 / 热更 / RPC 端点全部继续活；热更监听先挂再初读（初读抛错不该
  让热更一并失联）。
- **E4/B-04【Major】loadSettings 谎报成功**（`lib/index.js` loadSettings）：读盘
  异常曾回 `ok:true + {}`——前端把「没读到」当「没配置」渲染成一张干净空表单，
  用户改完点保存就把未读到的真配置洗掉。改判 `ok:false + unavailable`（带原因
  与 `details`），前端既有 `loadError` 红字横幅零改动即亮、表单不渲染。
- **E2/A-01【Major】client 半 inject 声明缺口 → 优雅降级（裁决：不走 inject
  park）**（`src/client.js`）：`sessions` / `timer` 保持非 inject 消费（拿不到就
  降级，绝不炸挂载），但降级不再静默——timer 缺席回落
  `globalThis.setInterval/clearInterval` 自管 disposer（一次性 warn，unapply
  一并清零不留孤儿轮询），旧写法 `timer && timer.interval` 短路即**面板永不
  刷新且从不说明原因**；sessions 缺席保留既有 `?.` 守卫并补一次性 warn（快照
  照常刷新，只关跳转与自动跟随）。
- **E5/A-02【Major】快照裁剪 + 轮询三道闸**（`lib/index.js` + `src/panel-tree.js`）：
  ① 出口裁剪——每桶 `history` 末 8 条，`current` / `queue` / `history` 条目剔
  `prompt`（面板零消费，而它是记录里最贵的字段：派发全文与驳回全文都挂在上
  面），`helpRequests.content` 保留（面板要显示）；等价性：面板历史区本就只
  渲染全局末 8，而各桶末 8 的并集恒 ⊇ 全局末 8。broker 侧实况对象零改写。
  ② 轮询——in-flight 门（一发未回不重入；慢宿主下 600ms 定频会自我堆叠在飞
  请求）、失败退避 600 → 1500 → 3000ms 封顶（成功复位）、桥状态翻转点各一行
  `console.warn`（绝不被自己的节奏刷屏）。
- **E7/B-05【Major】saveSettings 脏键整批毒杀**（`lib/index.js` saveSettings）：
  `mutate` 整批原子，旧写法只要 `draft.roles` 混进一枚 schema 必拒的脏键
  （手改 settings.yaml 塞进来的大写名 / 路径串），整次保存就被拒——用户在
  WebUI 上改什么都不再能落盘。roleKeys 生成处叠 `ROLE_KEY_PATTERN.test(k)`
  过滤（1 行 fail-closed）：脏键就地丢弃，其余行照常写。
- **E10/B-03【中】snapshot 端点无 try**（`lib/index.js` + `src/panel-tree.js`）：
  桥函数抛错曾直接抛穿 RPC 框架，Web 侧拿到一个没有信封的传输错，与「通道
  根本没注册」在客户端完全同形。端点自带 try → `ok:false + internal`（附
  message）+ host 侧 warn 留痕；前端据此分两型提示：`absent`（host 端 RPC 无
  应答，未激活 / 仍在启动——该等）与 `internal`（host 在、桥函数抛错——该查，
  附原因且面板停在最后一次实况），文案与配色各异。
- **E8/B-08【中，升级实施】marker 只认版本号 → 版本 + 内容摘要**
  （`lib/index.js` `ensurePresetInstalled`）：marker 从裸版本号改为
  `${version}+${digest}`。digest 覆盖 `preset/` + `prompts/` 两棵树每个文件的
  「路径 + 字节数 + sha256 前 12 位」，按路径排序拼接后取总 sha256 前 16 位
  ——只含路径与内容两要素，mtime / inode 一律不参与，故跨机器跨时刻稳定。
  原意保住：同版本且同内容 → 摘要一致 → 跳过，装机侧手改继续存活；而包内
  任何一次真实内容改动（同版本热修、上次半拷）都会换摘要并重拷，不再需要
  bump 版本解锁同步。存量旧格式 marker（裸版本号）与新 marker 天然不等 →
  首启自动重拷一次并就地升级 marker 格式。
- **E3/B-01【Major】安装器参数化 + 测试竞态根治**（`lib/index.js` +
  `test/host-parity.test.mjs`）：`ensurePresetInstalled({ packageRoot, dshHome })`
  导出为可注入的纯参数函数，`apply` 支持 `config.installPreset === false`
  真短路。host-parity 里「版本标记已短路 ensurePresetInstalled」是假注释——
  过去靠标记碰巧匹配躲开后台拷贝，而 marker 语义本批一变就当场失效；12 处
  `host.apply` 全部改带 `installPreset: false`，注释改写为事实。
- **B-09【中】整拷器孤儿文件 + 边用边写缓解**（`lib/index.js`）：`preset/` 从
  `cp` 整拷改为**逐文件字节比对、只重写变化者**（写窗口从整树缩到实际改动
  文件，正在被 mount 使用的 .mjs 不再每次重载都被原地截断重写——Windows 上
  EBUSY / 半写风险面最大）；`prompts/` 先删净再拷（纯资源镜像：上游退役的
  人设文件不留孤儿，否则设置页继续供一张没人认领的卡）。按裁决**不上**原子
  rename（Windows 收益 / 复杂度比差）；`prompts/` 的删除窗口可存活是设计使然
  ——人设读取本就 fail-soft 且不缓存（tisitan.7 N11）。
- **E9/B-07【中】`rpc.handle` arity 漂移**（`lib/index.js`）：本机
  dsh-client-connection 为 `(channel, handler)` 两参，更新版要第三参
  `options.authority`。按 `rpc.handle.length >= 3` 探测决定是否附
  `{ authority: 'loopback' }`；写成 `rpc.handle('/dsh-my-go', handler, ...extras)`
  的单调用点形态，避免反向 parity 的「RPC 单通道」计数 needle 被动漂移。
- **B-10【低】路径手抄与 persona 冷启空窗**（`lib/index.js`）：
  `DSH_HOME/.agent-presets` 三处手抄收敛为 `presetInstallRoot()` +
  `installedPresetRoot()`；`getBuiltinPersona` 读安装副本缺席时**回落包内
  `prompts/` 原文**——安装同步是 apply 里的后台 fire-and-forget，冷启动早期
  副本还没落全，此前设置页必然报「文件不存在」而包里那份人设明明就在。
- **B-06 半面【低】错误信封合规**（`lib/index.js`）：本半所有 `ok:false` 分支
  补 `details: {}`（宿主 `ConnectionRpcFailure` 三字段契约，缺项即不合规）。
  错误码体系本身（unavailable / bad-request / not-found / internal /
  settings-rejected 各自为政）本批不动，另批再议。
- **顺手低值项**（`src/panel-tree.js` / `src/tool-mask-editor.js` /
  `src/settings-core.js`）：**A-04** 面板父区列表过滤 `'legacy'` 幽灵桶（台账
  v1 兼容实例：无属主会话、current 恒空、点开无处可跳，出现在列表里只会被
  误认成一个真实编排会话）；**A-08** 求助行 React key 改用求助单 `h.id`（同一
  儿童可先后挂两张不同 intent 的求助单，按 childId 做 key 会让第二张就地复用
  第一张，intent 文案串台）；**A-09** 30s 相对时间自刷新 tick 纳入 `panelOpen`
  条件（面板关着时不再强制重渲染一个返回 null 的组件）；**A-12**
  `tool-mask-editor.js` 删 `deps.React` 改自身 `import * as React`（与
  roles-editor 对齐，依赖面如实反映模块真实需求）。

### Tests

- 新增 `test/host-lib-fixes.test.mjs`（14 例）：E1 注册抛错留痕 + 热更与 RPC 面
  存活（改存储后 snapshot 花名册即时反映新绑定）/ E1 读盘失败独立留痕 /
  E4 谎报改判 / E7 脏键 fail-closed 而正常行照写 / E10 桥抛错回 `internal` /
  E5 出口裁剪（末 8、无 prompt、求助正文保留、**broker 实况数组零改写**）/
  E5 桥缺席仍是降级空态 / E9 两参与三参双形态各一例 / E3 `installPreset:false`
  真短路零文件动作 / E8 marker 三态（首装组合式、同版本同内容跳过且装机手改
  存活、包内漂移重拷且 marker 换值）/ E8 旧格式 marker 无条件同步 / B-09+安装器
  行为面（shared 缺席 warn、源树缺席吞异常留痕且**不写 marker**、prompts 镜像
  清孤儿、未变更文件 mtime 不变）/ B-10 persona 回落包内原文 +
  `presetInstallRoot` 两口径。
- 新增 `test/client-smoke.test.mjs`（6 例，Node 侧跑、假时钟推进、不起浏览器
  不渲染 React）：timer 在席走 `timer.interval` 双链且 unapply 全停 / timer
  缺席回落自管 `setInterval` 且一次性留痕 / sessions 缺席留痕且跳转链不点火 /
  in-flight 门不重入（落地后恢复放行）/ 失败退避 600→1500→3000 封顶与成功复位
  （故障与恢复各只 warn 一行）/ `internal` 与 `absent` 两型留痕分流。
- `test/host-parity.test.mjs` 25 → **27** 例（两例「本批修复在册」源码 pin：
  lib 侧 17 条 + 客户端侧 14 条，纪律同 tisitan.7——只锁「修复在册」这一事实，
  回潮时没有任何运行期报错会来提醒）。
- `test/apply.mjs` 冒烟 +1 条断言：**dist 新鲜度**（src 任一模块比 dist 新即
  红）。本批起 src 三面同改，「改完必须重建 bundle」从流程约束升级为断言——
  旧写法下忘重建 dist 会让浏览器继续跑上一版，而全套测试依然全绿。
- 两档新档均注册进 `package.json` 的显式 test 清单（无 glob）。全量：**274 例**
  （273 pass + 1 skip 宿主契约哨兵）。
- **既有假红修复**（非本批条目，被本批并行负载放大后现形）：
  `test/bridge.test.mjs` 三处「`sleep(400)` 等台账防抖落盘」改为共享
  `readLedgerWhen()` 轮询（10s 超时）。250ms 防抖只是**无负载下限**，全套
  并行时写盘可晚于 400ms，固定 sleep 会把断言跑到写入之前——单文件跑 3/3 绿、
  全量跑偶发红，是本批新增两档测试入场后暴露的既有负载敏感缺陷。断言强度不变
  （版号 / 记录在场 / 无 `.tmp` 残留三条原样保留）。

### 反向 parity 断言同步（零删除）

- 12 处 `host.apply(ctx, {})` → `host.apply(ctx, NO_INSTALL)`：行为断言一字未动，
  只换挂载前提（E3 的 config 闸）；`mockHostCtx` 的 `rpc.handle` 替身保持两参
  形态（正好走 E9 探测的旧分支）。
- 新 pin 把两条旧写法钉成 grep=0：`await cp(`（B-09 整拷退役）、
  `await writeFile(markerPath, version`（E8 裸版本号 marker）。
- `rpc.handle('/dsh-my-go'` 单通道计数**不变**（E9 用 spread 保形态，无需改
  needle）；`settings.register(` 计数不变（E1 拆分仍只一处调用）。
- 信封合规用相对计数锁：`code: '` 出现次数 == `details: {}` 出现次数（新增
  错误分支漏 `details` 当场红）。

### Docs

- `package.json`：版本 `0.3.0-tisitan.7` → `0.3.0-tisitan.8`；test 清单追加两档
  新档（仍为显式清单，无 glob）。
- README.md：特性清单新增「面板弹性」条（in-flight 门 / 退避 / 出口裁剪 /
  服务降级留痕）；调参入口的 marker 口径改写（「版本 + 内容摘要」，同版本
  热修也会重拷）；目录结构三行同步（lib 568 行、client.js 82 行、panel-tree
  轮询描述）；套件例数 252 → 274、测试文件 16 → 18。
- docs/ARCHITECTURE.md：§2.5 补五条契约（脏键 fail-closed / 读面三态 /
  错误信封合规 / 注册失败面隔离 / 快照出口裁剪 + 端点 try + arity 探测）；
  §2.6 同步语义指向 §5；§3 UI 适配重写面板三条（裁剪与降级留痕、轮询三道闸、
  客户端服务降级不静默）；§5 安装步骤 2 改写为摘要 marker 与逐文件 / 镜像
  两语义。
- docs/FORK-GUIDE.md：包声明行版本与例数；拓扑图三行（轮询带门与退避、
  lib 568 行、ensurePresetInstalled 摘要 marker）；文件目录两行（client.js
  82 行、新增两档测试文件说明）；机制映射表四行更新（树状图面板 / 快照桥 /
  preset 同步 / 设置页）并新增一行「客户端服务降级」；测试台账 host-parity
  25 → 27 例并追加两档新档。
- **编号歧义提示（承 tisitan.7 遗留）**：fork 历史里 `0.2.3-tisitan.N` 与
  `0.3.0-tisitan.N` 两套序号共用裸 `tisitan.N` 写法，本批发布
  `0.3.0-tisitan.8` 后，旧文档中裸写的「自 tisitan.8 起」（实指
  0.2.3-tisitan.8 日志卫生批）等标记同样歧义化。本批新增注释一律带条目号
  （`E1/B-02` 之类）自我消歧，未做全库改写——留给文档总账批统一处理。

## [0.3.0-tisitan.7] - 2026-09-02

运行时语义修复批（全面审查四棒交叉验证实锤的 11 条，按序施工）：本批只修
语义、不动结构——工具 schema、事件语义、通知文案、台账形状一概不改（唯一
例外是 `continue` 的 `urgency` 参数描述补上了 abort 的活体前提，属如实描述）。
改动落在 `preset/tools/broker.mjs`、`preset/shared/child-registry.mjs` 与
测试侧；版本 bump 后随 preset/ 整树重新同步（宿主重启生效）。套件 237 → 252
（新增 15 例 + 1 例假绿夹具重写，`package.json` 的显式清单无新增文件）。

### Fixed

- **N5【Critical】备选 once-guard 跨代际残留 → 队列永久冻结**
  （`child-registry.mjs` `rearmChild`）：`fallbackDecided` 的登记点在
  `subagent/end` 的决策分支（早于 `attemptFallbackRedeploy` 的三个早退分支），
  条目随 childId 永挂且全仓此前**零** `.delete`。链条：儿童进过备选评估 →
  `continue` 复活 → 复活轮那条**正常完工**的 end 撞上「评估在飞」分支被整个
  吞掉（判定只看 once-guard + 活记录，既在 `failed` 计算之前也无 stopReason
  条件）→ 记录永挂 running → `advanceQueue` 被 `isBusy()` 恒真堵死 → 该编排
  会话队列冻结；唯一救援（disposed 宽限期兜底）已被 end 入口的
  `cancelDisposeFallback` 自撤。修法：`rearmChild` 内同点
  `fallbackDecided.delete` + `abortExpected.delete`——**复活即新世代**，一次性
  语义只对本代际成立。回归：`child-registry.test.mjs` 单元一例（两张一次性表
  同点清零且只清复活者自己）+ `roster-route.test.mjs` 端到端一例（复活曾进
  备选评估的**链首**儿童 → 完工 end 不被吞、`finalizeEnd` 落账、新任务直接
  上岗；现有那例复活的是恰好未被污染的 sess-2，新例必须复活被污染的 sess-1）。
- **N6【Major】abort 护航登记在 no-op 上**（`broker.mjs` continue abort 支 +
  end 支 E5）：alpha.4 的 `interrupt` 只对 authority 校验抛 `UNAUTHORIZED`，
  目标缺席是 **accepted no-op**（`dsh-subagent/lib/types/continuation.js:273-298`
  「An absent target is an accepted no-op」）——旧写法在非驻留/冷态儿童上
  「掐断成功」，`abortExpected` 押在一次什么都没掐断的回合上，随后 E5 会把该
  儿童真那一轮以任何终局上报的 end 吞掉。修法两条：①掐断前加与 steer 支同款
  活体门槛（`ctx.get('agents')?.get?.(childId)`），拿不到活体就不登记护航、
  warn 后降级 queued 文案；②E5 收紧为只吞 `stopReason !== 'completed'` 的
  end（interrupt 只是同步受理，被掐轮可能已跑到 completed——那是真结论），
  护航仍就地一次性消费不留残。回归：bridge 两例（缺席儿童不掐不断不登记 +
  completed end 照常落账）；另把三例既有 abort 用例的 mock 补上「儿童在活
  注册表」这一真实契约前提（断言零改动，否则门槛直接把旧用例判红）。
- **N7【Major】DSV4P0813 tool/call 促升半支死 + 测试假绿**（`broker.mjs`
  `session/event` 监听）：宿主 `Session.append` 先 push 再 notify
  （`@deepseek-ai/dsh-session/lib/index.js:1433-1435`），处理器收到 `step/end`
  时数组末位恒为该 `step/end` 自己 → 旧「从末位倒扫到上一个 step/end 找
  tool/call」当场 break，`toolCalled` 永假（`tool/call` 在 agent-loop 里
  先于 `step/end` 落账：`dsh-agent-loop/lib/index.js:295` vs `:563`）。
  `turn/end` 支仍活，故不是整支死代码，但开了开关的工种**整个第一轮**都戴着
  phase-1 镣铐（7 具 bootstrap 白名单、persona-only、`contexts: []`）。修法：
  按事件自身类型直判（`event.type === 'tool/call'` 即促升），删掉整段倒扫，
  顺带消除每 step 一次 `sessionEvents()` 全量快照重建的热路径代价。回归：
  重写 `roster-route.test.mjs` 那条 promotion 用例的夹具为**真实派发时序**
  （旧夹具手工把 tool/call 铺在数组末位、再派发 step/end，等于替倒扫实现撒谎
  = 假绿），并加断言「事件数组不可读（坏档/`snapshotEvents` 抛错）时照样促升」
  以钉死「不再读数组」。
- **N8【中】卸载不 flush 台账防抖窗**（`broker.mjs` 台账 effect 清理）：清理
  函数只 `clearTimeout`，250ms 窗口内的变更必丢——最后一次完工/复活不入档，
  重启后 `continue` 报 unknown-id（文件兜底查找也救不了：文件里压根没那条）。
  修法：payload 构造与写盘抽出复用，清理函数见 pending timer 即撤表 +
  **同步**落一次最新 payload（沿用 tmp+rename 原子序，卸载路径接受同步 I/O），
  并以 `ledgerClosed` 作废在飞的异步串行链（收尾写不被更旧的排队写覆回）。
  回归：bridge 一例（防抖窗内按 scope 卸载语义点火清理 → 磁盘含窗口内结论且
  无 `.tmp` 残骸）；`test/helpers/mock-ctx.mjs` 新增 `captureEffects` 捕获口
  （默认行为逐字段不变，避免替身提前掐掉他例正在等的定时器）。
- **N9【中】modelCache 两个方向失误**（`broker.mjs` `modelExists` +
  settings 热更）：①在飞响应回写覆盖热更后的 clear（陈旧清单把刚作废的缓存
  原样塞回，污染期无界）；②`set.size === 0` 不入缓存 → 列举成功的坏 provider
  每次模型请求都被重拉一遍。修法：`modelCacheEpoch`（clear 同点 +1，回写前
  比对）+ 三态判据（列举成功=结论，含空清单与「模型不在」；抛错/服务缺席=
  未知，不缓存留待重试）。回归：compat-alpha4 三例（epoch 竞态 / 空集入缓存 /
  抛错逐请求重试）。
- **N10【中】effortCache 不随热更失效 + null 当真值缓存**（`broker.mjs`
  `supportedEfforts`）：此前无任何清理点，且 `resolved` 为真时把 `null`
  （=未知）一并入表 → effort 绑定在本进程内永久静默失效，恰是函数内注释
  声称要防的形态。修法：`settings/updated` 补 `effortCache.clear()`；只缓存
  非 null 的成功结果。缓存声明同点前移到 settings 块之前——本 apply 中段有
  `await loadLedger()`，事件若在窗口里到达会撞 TDZ。回归：compat-alpha4 两例
  （能力表热更后重新解析并生效 / 读不到档位不入表逐请求重试）。
- **N11【中】prompt 加载失败永久负缓存**（`broker.mjs` 人设加载链）：
  `promptCache` 住模块作用域且失败写 null，首读撞 `ensurePresetInstalled`
  的后台拷贝竞态即钉死本进程**所有挂载**的人设。修法：读盘（`readPromptFile`）
  与缓存分离，缓存壳随 `apply()` 建立（一次挂载一份），失败不写缓存（下次现读
  重试，与两份能力/清单缓存同一纪律）。回归：roster-route 一例——自定义角色
  首派无 persona → 现场补档案 → 第二派即读到（探针文件名带 pid，只碰
  `preset/prompts/<probe>.md` 并在 finally 清理，不影响并行测试进程的兜底
  文案断言）。
- **N12【中】agent/created 外层 catch 零留痕**（`broker.mjs` 双侧闸）：
  `denyTools` 内部逐名已吞错，外层 catch 实际只兜「`agent.ctx` 尚未 ready /
  宿主内部异常」这类真意外——此前是纯静默黑洞，而本闸正是 web 部署下邻接
  三件套的**唯一**防线（tool-mask 那条 standing 层前提不成立）。修法：一行
  `console.warn` 点名 agent 与后果（每个 agent 只触发一次，不构成刷屏）。
  回归：anti-bypass 一例（`agent.ctx` getter 抛错 → 不炸挂载 + 留痕恰一行）。
- **N13【中】need_help 的 `agentType` 落空**（`broker.mjs` need_help）：裸
  `sessionTypes.get(child.id)`，竞态归随（end 早于 spawn resolve 的路径不写
  活登记）、墓碑期（disposed 已摘）、cold-resume 三种形态下都写进
  undefined → 面板按工种上色直接落空。修法：改走 `typeOfAgent(sessionTypes, child)`
  （label 兜底，工种识别单一源的本意）。回归：bridge 一例（disposed 立墓碑后、
  宽限期内的 need_help 仍认回 `explore`）。
- **N14【中】宽限期兜底不走 retireChild**（`broker.mjs`
  `scheduleDisposeFallback`）：手删 `childOwner` 让墓碑条目滞留，真迟到的
  那条 end 仍能经墓碑认回工种、归到已无活记录的实例上，报出一句
  「has no live record; conclusion dropped」——结论其实早已按兜底口径落账，
  纯属无中生有的误报（且白占墓碑容量）。修法：换 `childRegistry.retireChild(id)`
  （类型侧三表 + 属主路由同点翻篇）。回归：bridge 一例（兜底后迟到 end 走
  「finished child 迟到/重复」如实留痕，不出现 dropped 误报、不重复落账）。
- **N18【低】continue 打 spawning 记录无门槛**（`broker.mjs` continue）：
  `beginSpawning` 占位（真身未 resolve）在册时，旧路径既无 turn 可 steer/abort
  也不 revive，一路 `followupPrompt` 走完并回 `accepted: true`——把主流程的
  指令投进空气。修法：与 queued 占位 id 同款友好闸，结构化拒绝并指路
  `orchestration_status` 取真 childId。回归：bridge 一例（三档一律拒绝、
  interrupt 零调用、台账 prompt 不被改写、放行后本次派发不受影响）。

### Tests（含 host-parity 断言同步清单）

- 套件 237 → 252（+15）：child-registry +1（N5）、roster-route +2（N5 端到端
  / N11；另重写 1 例假绿 promotion 夹具，例数不变）、bridge +6（N6×2 / N8 /
  N13 / N14 / N18）、compat-alpha4 +5（N9×3 / N10×2）、anti-bypass +1（N12）。
  `package.json` 的 `test` 显式清单无新文件需要登记。
- **host-parity needle 同步（未删任何断言，只改指向 + 新增反向 pin）**：
  `childRegistry.retireChild(childId)` 计数 2 → needle 放宽为
  `childRegistry.retireChild(` 计数 3（N14 新增兜底调用点；参数名不再决定
  防线是否被数到）；同例新增 pin 十二条——N5 两张一次性表的 child-registry
  单点各 1、N6 `abortExpected.delete(childId) && info?.stopReason !==
  'completed'` 1 与 `abortExpected.add(record.childId)` 1、N9
  `modelCache.clear()` 1 / `modelCacheEpoch += 1` 1 / 条件回写式 1、N10
  `effortCache.clear()` 1 / `if (resolved && result !== null)` 1、N7 事件直判
  1 且倒扫死支 `events[i].type === 'step/end'` 必须 0、N14
  `childRegistry.retireChild(id)` 1。其余既有计数
  （`fallbackDecided.add(childId)`、`childRegistry.rearmChild(`、
  `duplicate subagent/end while fallback evaluation in flight`、
  `pendingFallbackByLabel.*`、`deliverToAdjacent(`、`denyTools(`、
  `...ADJACENT_BYPASS_TOOLS`、状态族八表定义归属）实测零漂移，未作改动；
  anti-bypass / compat-alpha4 / bridge 的既有断言形态全部保持（bridge 三例
  abort 用例仅补 mock 的活注册表前提，断言一字未动）。

### Docs

- README：工种绑定段补「两份能力/清单缓存的三态纪律 + 热更整体作废 + 在飞
  不回写」；台账段的落盘语义（250ms 防抖、tmp+rename、**卸载同步补写**）；
  两处例数 237 → 252。
- docs/ARCHITECTURE.md：§2.1 continue 档（abort 活体门槛、护航只吞非
  completed、spawning 拒绝、复活清两张一次性表）与 disposed 兜底改走
  retireChild；§2.2 创建时缓存纪律重写；§2.3 DSV4 晋升判据改为事件类型直判
  并注明「不扫数组」的宿主时序根因；§2.7 typeOfAgent 消费面加 need_help；
  shared 模块清单 child-registry 行同步；台账持久化行加卸载 flush。
- docs/FORK-GUIDE.md：版本与例数行、机制映射五行的语义同步（continue /
  need_help / 状态回收 / 子代理侧状态登记 / 绑模型 / reasoningEffort /
  DSV4 两阶段 / persona 与 toolFilter / 派发与复活共用体）、测试台账六行
  （roster-route 21、bridge 48、compat-alpha4 30、anti-bypass 8、
  child-registry 8、mock-ctx `captureEffects`）。
- **顺带消歧（本批版本 bump 直接造成的撞名）**：README「工种模型绑定」、
  ARCHITECTURE 能力档位注记、FORK-GUIDE「默认绑定已清空」三处原文写作裸
  「自 tisitan.7 起」，指的是 **0.2.3-tisitan.7**（去私有化批）；本批发布
  `0.3.0-tisitan.7` 后该写法就地歧义，三处已补全为 `0.2.3-tisitan.7`。
  同型歧义在旧文档里还有裸 `.3`/`.10` 等（两套序号共用同一标记），属文档
  总账批的统一改写范围，本批不扩面。

## [0.3.0-tisitan.6] - 2026-09-02

日志卫生批（**零防线变更**）：tisitan.5 部署后 web profile 的启动日志出现三条
`tool-mask: could not deny "send_message" (absent or reserved): Error:
tools.restrict() names unknown global tool ...` warn，随后一行虚高的
`masked 18 tool(s) this session`。本批只修计数口径与噪音，屏蔽清单、闸的
覆盖面与事件语义一字未动（preset 半改动，宿主重启随整树重新同步后生效）。

### Fixed

- **masked 汇总行计数诚实化**（`preset/tool-mask.mjs`）：汇总数字从「解析出的
  名单大小」改为「`tools.restrict()` **实际成功**的个数」，并把跳过的名字一并
  打进同一行，形如 `masked 15 tool(s) this session (3 name(s) not registered
  at this scope; agent-scope gate covers them: send_message, list_agents,
  interrupt_agent) (source: config.deny+settings)`。此前报 18 让人以为屏蔽了
  18 具，实际其中 3 具在本作用域压根不存在（真数 15）。
- **unknown 名不再逐名 warn**：宿主对未注册名抛 `names unknown global tool`
  （`@deepseek-ai/dsh-tools/lib/index.js:2804`）。web 部署下 host 不全局注册
  邻接消息三件套，preset standing 作用域的 restrict 必然查无此具——这是**预期
  形态**而非异常（实际防线由 broker `agent/created` 的 agent 作用域闸承担，已
  真机验证在岗），逐名 warn 纯属刷屏。此类失败改为静默归类、随汇总行一次性
  点名；**其他类型**的 restrict 报错（保留名、无作用域上下文等真异常）保持逐名
  warn 不变，且既不计入屏蔽数也不冒充跳过清单。`config.deny` 里三件套条目**原样
  保留**：非 web profile 下闸①仍由本行生效。
- **测试与文档**：`test/tool-mask.test.mjs` 7 → 9 例（unknown 名不逐名 warn 且
  汇总行带跳过清单、真异常仍逐名 warn 不进跳过清单、三件套全未注册的 web 实况
  场景；原「缺席跳过」例改判到新口径，其余 6 例断言零改动），套件 235 → 237；
  README「容错」条与 FORK-GUIDE 的 tool-mask 机制段同步 masked 文案与
  web/非 web profile 的实际防线归属。

## [0.3.0-tisitan.5] - 2026-09-02

健康度优化批（独立终审挂账项 P2 重构菜单）：把「漏一张表就静默串号」的跨表
不变量与「跟着上游 API 形状变」的契约适配从 broker.mjs 挤出到 shared。
**零行为变更**——工具 schema、事件语义、通知文案、台账形状一概不动；改动只是
版本 bump 后随 preset/ 整树重新同步（宿主重启生效）。测试 228 → 235（新增
child-registry 单元 7 例；契约哨兵仍按本机宿主版本走 skip 分支）。

### Internal

- **子代理登记表独立**（`preset/shared/child-registry.mjs`，134 行）：原本住
  在 `apply()` 闭包里的八张桥接表（`sessionTypes` / `disposedTypes` /
  `childOwner` / `activeFallback` / `pendingFallbackByLabel` / `abortExpected`
  / `fallbackDecided` / `modelCache`）连同四组跨表不变量整体迁出——墓碑迁移
  （工种移入 + 备选覆盖同点摘除 + 超容 FIFO 驱逐连带）、end 收尾的两个面
  （`retireChild` 携属主 / `retireTypeRecords` **故意不携**，二者不可互换）、
  备选两段式登记（`promoteFallback` 撤临时 + 工种登记 + 覆盖转正三步同点）、
  复活重建（`rearmChild` 类型恒回填、畸形 `fallbackEntry` 守卫、ownerPid
  undefined 不写键）。broker 解构出表名继续做单表读写，多表动作一律经显式
  方法。`modelCache` 随 `settings/updated` 整体清空的联动语义原样保留（缓存
  本体前移到 apply 同步段，热更清缓存仍在同一 handler，反而消除了「handler
  定义先于声明」的 TDZ 注释隐患）。铁律照旧：零 ctx、零 `@deepseek-ai/*`。
- **邻接消息契约独立**（`preset/shared/adjacent.mjs`，109 行）：
  `sessionEvents` / `canQueueAdjacent` / `deliverToAdjacent` / `reportToParent`
  与 `NEVER_ABORTED` / `QUEUE_PROMPT` / `HOST_QUEUE_SOURCE` 三枚私有常量自
  misc.mjs **逐字搬出**（misc 是台账/名册档，与本档的上游耦合无共同点）。
  broker 半对外 re-export 名不变（四个符号仍经 `preset/tools/broker.mjs`
  可取），misc 直引方仅需改 import 路径（compat-alpha4 测试同点更新）。
- **派发 / 复活 / 通知三处去重**（broker）：`spawnChild()`（直派与备选重派
  共用同一 spawn 组合子，差异全部参数化为 agentOptions / label / sig）、
  `childRegistry.rearmChild()`（continue 与 forward 的复活登记合一，此前两处
  逐字符级重复的 fallbackEntry 守卫收敛为一）、`notifyOwner(parentId, text)`
  （`notifyParent(resolveParentAgent(pid), …)` 九处固定搭配一站式化）。
  台账动作（`beginSpawning`/`bindChild`/`revive`）与通知时机仍留在各调用方
  ——两路占槽语义不同，强行合并即改行为。broker 1754 → 1703 行。

### Refactor

- **测试替身收敛**（`test/helpers/mock-ctx.mjs`，97 行）：六文件
  （bridge / multi-session / roster-route / failure-notice / compat-alpha4 /
  anti-bypass）各抄一份的 cordis ctx mock 收敛为参数化工厂（服务注入、
  `captureSections`、`captureRestrict`、`keepHome` + `homePrefix` 台账隔离、
  `subagentsExtra` 决定 alpha 形态），连带 `withRealSignalContract` /
  `execOf` / `snapshotNow` / `snapOf` / `drain` 夹具共用。各文件保留一行专属
  默认值薄包装，**用例断言零改动**（bridge 1445 行断言逐字未动）。
- **反向 parity 断言重指向**（host-parity）：状态族标记从「broker 半保留」改
  为「child-registry 唯一出处 + lib/broker 双双零残留」，并新增「登记表本体
  不得回流 broker」「跨表守卫不得手抄」计数断言八条——抽取后的真实回潮风险是
  有人图省事在 broker 里再 new 一张表，pin 的是这个。
- **文档同步**：README 与 FORK-GUIDE / ARCHITECTURE 的 shared 模块清单
  （六→八）、机制映射新增两行（登记表 / 邻接契约）、文件树与测试台账补齐
  新用例文件；顺带修正 bridge（31→42 例）与 orchestration（16→18 例）两处
  早已漂移的例数。

## [0.3.0-tisitan.4] - 2026-09-02

DSH 0.1.2-alpha.4 兼容迁移（原 tisitan.22 批）+ 防旁路加固（R1-R5）+ 独立终审
漏网修复批（U1-U4 / P1）+ modelCache 根治。兼容改动全部做特性探测，**alpha.2/3
与 alpha.4 双版本同跑，升级顺序无关**。测试 194 → 208 → 225 → 228。

### Added

- **邻接消息适配层**（shared/misc.mjs 三个纯函数，broker 半接线；已核实
  alpha.2/3 的 runtime 只有 followup/reportFrom、alpha.4 只有 sendMessage，
  方法存在性即干净分界）：
  - `deliverToAdjacent`（continue/forward 父→子投递）：alpha.4 走
    `sendMessage(parent, childId, content, { signal })`（sender=精确 live
    父 Agent，source 由 sender 推导为 agent-message/relay），alpha.2/3 走
    旧 `followup(parent, childId, content, { source, signal })`；
    coordinator source 仅旧路径消费（新 API 不接收自造 source）。signal
    缺省给永不中止的 AbortSignal（alpha.4 运行期 throwIfAborted 必填）。
  - `reportToParent`（need_help 子→父上报）：alpha.2/3 走旧
    `reportFrom(child, content, { delivery: 'next-step' })`；alpha.4 优先
    `sendMessage(child, parentId, …)`，投递被拒（非驻留/父不在线）时兜底
    `parent.inject()`（通路 alpha.4 仍在，已验证），Sisyphus 收到求助
    注入的行为等价；兜底缺席/失败原错上抛走既有 warn+notifyParent，
    绝不静默失败。
  - `sessionEvents`：alpha.4 起 `Session.events` getter 删除 →
    `snapshotEvents()`；读取失败回落空数组，维持旧 getter 不抛口径。
    broker 两处消费点（readTurnFailure live 快路径、DSV4P0813 提升检测）
    已切换。
- **queued 档真 FIFO 复活（R4）**：alpha.4 的 `sendMessage` 在 continuation
  manager 里**固定** `delivery:'steer'`（next-step 边界插话），上一批迁移后
  `continue(urgency:'queued')` 与 `steer` 塌成同一档，与工具描述/提示词承诺
  不符。真排队只剩 internal 子路径 `queueHostSubagentPrompt`——它即 runtime 上
  一枚注册符号方法 `Symbol.for('dsh.subagent.queuePrompt')`。preset 加载环境
  **无法 import 该内部子路径**（安装目录 `~/.dsh/.agent-presets/dsh-my-go/`
  上溯整链无 node_modules，实测裸名解析 MODULE_NOT_FOUND），故按同款符号直取
  （与上游适配器逐参数同形：parent/childId/content/source/signal）。
  - `deliverToAdjacent` 新增 `delivery` 意图（'queued' 默认 / 'steer'）；
    alpha.2/3 的 `followup` 本身 FIFO，queued 天然成立。
  - 新增 `canQueueAdjacent(subagents)` 能力探测（判定顺序与投递分支严格同构）。
  - continue 在**两条排队通路都不存在**时才退化 steer，`mode` 如实回报 +
    console.warn 留痕，绝不静默塌档；abort/forward 的排队语义随之同真 FIFO。
  - `prompts/sisyphus.md` 与 broker 工具描述**无需改动**——原文案承诺的
    「排队等当前轮结束」自此才是事实。
- **防旁路加固：上游邻接消息三件套双侧下线（R1/R2/R3）**。`send_message` /
  `list_agents` / `interrupt_agent`（`ADJACENT_BYPASS_TOOLS`，shared/constants
  单一源）从 MyGO 会话目录摘除，**邻接消息通道**收口为 broker 六件套（派生面
  另说，见 Changed 段口径条）：
  - **子代理侧**（`agent/created` 星型闸）：治 R2——上游 alpha.4 会给 continuable
    子代注入「完工前用 send_message 回报父代」指引（continuation.ts:296-309，
    由 :497 的工具可见性判定门控），子代据此可绕过 need_help 挂账体系直插
    Sisyphus 回合。deny 后该判定转假，指引连带不再注入（良性副作用）。
  - **Sisyphus 侧**（同一闸的 orchestrator 分支 + tool-mask `config.deny`
    双保险）：治 R1——顶层直调上游 send_message 绕过台账/单线锁，且对已完工
    child 触发 coldResume 后结论被 broker 的 late/duplicate 分支丢弃而
    advanceQueue 照跑（双流并发）；治 R3——直调 interrupt_agent 无
    abortExpected 护航，预期掐断被误判真失败。
  - `need_help` 的上报走运行时 API（`ctx.subagents.sendMessage` / inject 兜底），
    与模型可见工具名无关，deny 不影响它（compat 测试两例继续绿）。
  - **restrict 逐名兜底**：新增 `denyTools()` helper——批级
    `restrict({deny:[...]})` 对任一未注册名整体抛错，旧写法会让整批屏蔽连坐
    （星型闸随之一起失效且被外层 catch 吞掉）；现在批失败转逐名，单名失败仅
    warn 跳过，其余照常落地。
- **测试**：`test/anti-bypass.test.mjs` 新档 7 例（常量与源码 pin、双侧 deny
  行为面、门面收口 pin、逐名兜底不连坐、畸形载荷不炸挂载）；`test/compat-alpha4.test.mjs`
  14 → 25 例（queued 三路径 + broker 级真 FIFO / 退化回报 / steer 经门面 /
  steer 被拒回落 / 宿主契约哨兵）；`test/tool-mask.test.mjs` 5 → 7 例（并集
  语义 + cordis.yml 安全条目 pin）。
- **宿主契约哨兵（终审批 U4，compat 一档）**：解析 `@deepseek-ai/dsh-subagent`
  的 package.json 版本，≥ 0.1.2-alpha.3 时拿真 `SubagentRuntime.prototype`
  对账——必须有 `sendMessage`、必须无 `followup`/`reportFrom`、必须有
  `Symbol.for('dsh.subagent.queuePrompt')` 队列符号。上游若改名或删符号，
  本仓 mock 测试不会红（它们只演形状），这条会红——queued 真 FIFO 与
  「不静默塌档」的前提自此有闸。版本不足或包不可解析时 skip 并注明原因
  （本仓 devDependency 解析到 0.1.0-rc.8 → 走 skip 分支）。

### Changed

- **tool-mask 三源改为并集（原为覆盖）**：`resolveDeny` 旧语义下
  `config.deny` 一旦非空就把用户在设置页配的 `toolMask.deny` **整体吃掉**——
  本批要往 `config.deny` 写安全条目，该语义不可用。现在三源（config ∪
  settings ∪ DEFAULT_DENY）去重保序、互不覆盖，汇总日志来源标注
  `config.deny+settings`。
- **「收口」口径修正（终审批 P1-2）**：deny 面只覆盖**邻接消息**三件套，
  原生派生工具 `subagent` / `subagent_fork` / `workflow` / `ralph` 在 Sisyphus
  顶层**保留为逃生舱**（仅用户显式要求直派时使用，yml 装配不动、不加 deny），
  只在子代理侧摘除。`constants.mjs` 注释、`prompts/sisyphus.md`（原「编排
  通道唯一」）、README / FORK-GUIDE / 本条此前表述统一改为此口径。
- **forward 投递档位可观测（终审批 U2）**：转发前与 continue 同款做
  `canQueueAdjacent` 探测，塌档时 console.warn + 返回体新增 `mode`
  （queued/steer 如实回报，output schema 与 render 同步），不再「由适配层
  就地退化而无人知晓」。
- **字面量收常量（终审批 P1-1）**：`HISTORY_CAP = 200`（每桶 history 行数
  上限，与 `LEDGER_PARENTS_CAP = 200`「桶数上限」是两个维度，注释里写清）
  收编 orchestration.mjs 2 处 + broker 4 处截断与 2 处报错文案共 8 处字面量；
  `RUN_CODE_TOOL = 'run_code'` 收编 lib 半花名册与 broker 角色工具过滤两处
  按名剔除。
- **入口卫生（终审批 P1-2）**：`typecheck` 更名 `typecheck:archive`（tsconfig
  include 只有 `docs/legacy-broker-ts/src`，旧名会让人误以为生产面有类型闸，
  README 同步）；`files` 白名单加 `!docs/legacy-broker-ts`，归档 TS 不再进包
  （`npm pack --dry-run` 已验：43 文件，legacy 目录不在清单）；
  `lib/index.js` 死变量 `settingsScope` 删除（注册句柄从未被读，host-parity
  pin 同步为按 `settings.register(` 计数并新增「不得复活死变量」pin）；
  `preset/tools/broker.mjs` 文件头注释重写为现状（此前仍是「HOST half /
  npm bundle / 五个工具」的 tisitan.21 前描述）。

### Fixed

- **steer 档收口到 subagents 门面（终审批 U1，本批最重要）**：`continue` 的
  `urgency='steer'` 分支原先绕过 `ctx.subagents` 直调注册表里的
  `Agent.steer()`，携带 alpha.4 已退役的 `source.kind:'coordinator'` 并自造
  `mygo-steer-*` messageId（真实 inbox id 从此对不上账）。现在：注册表探测
  只当「活 agent 才允许 steer」的门槛，投递一律走 `deliverToAdjacent`
  （alpha.4 即 `sendMessage` 的 next-step 语义），messageId 为门面返回的真实
  id；门面拒收时 warn 留痕并回落 queued 通路，绝不静默。alpha.2/3 侧注意：
  该代门面只有排队原语（`followup`），steer 档在其上的可见时机是当前轮
  drain 后（`source` 仍随旧支透传，alpha.2/3 的 `SubagentFollowupOptions.source`
  为必填）。
- **导出面补齐（终审批 U3）**：broker 半 re-export 补 `canQueueAdjacent`
  （与 `sessionEvents`/`deliverToAdjacent`/`reportToParent` 同列），外部消费方
  可经 broker 入口做能力探测，不必直引 shared 路径。
- **modelCache 根治**（broker）：`settings/updated` 热更重载 bindings 时
  同步 `modelCache.clear()`——改 settings 的模型清单（或刚配好 provider
  再回来填绑定）无需重启即被 agent/request 校验感知；此前旧缓存会让新
  绑定模型被误判「不存在」静默保留 seed 模型直到进程重启。

## [0.3.0-tisitan.3] - 2026-08-31

顺手补丁批：三项均为边缘路径加固，主流程语义零变化。测试 190 → 194。

### Fixed

- **台账原子写**（broker）：防抖落盘改为先写 `orchestration-ledger.json.tmp`
  再 rename 覆盖，进程崩溃写到一半时不再产生撕裂 JSON 导致全量丢账；
  rename 失败时清理 tmp 并 warn 留痕，不打断串行写链。
- **disposed 宽限期兜底落史**（broker）：兜底 abort 真正触发时按
  dropQueuedFailed 同款口径落一条 failed 历史（结论注明系宽限期兜底掐断），
  不再静默蒸发记录；宽限期内正常 end 到达的路径不受影响、不重复落史。
- **完工连带清理求助单补通知**（broker + shared/orchestration）：
  `clearHelpFor` 改返回实际清理张数，子代理结束（正常/失败/兜底掐断）时
  若连带清掉 ≥1 张未处置求助单，console.warn 留痕 + notifyParent 二次
  触达父会话（need_help 上报失败同款模式），不再静默清理。

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
