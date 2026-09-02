// 反向 parity（0.3.0-tisitan.0 Wave 1）：lib 半编排面整体切除后的分界断言。
//   ① lib 源码零编排面标记（编排工具注册/状态机/台账/备选链/生命周期钩子
//      grep=0），broker 半（preset scope）全量保留——编排实现唯一归属 broker。
//   ② RPC/settings 契约：RPC 端点全家与 settings.register 为 lib 独有，
//      broker 只读不注册（Symbol.for 快照桥 broker 发布、lib 消费）。
//   ③ lib 存储/面板面行为批（settings schema/saveSettings/listTools/
//      getBuiltinPersona/loadSettings）原样保留。
//   ④ shared 面行为直测（分类器/归档取证/合并/迁移）不经 lib re-export，
//      直引 preset/shared/（shared 源文件未动）。
// 原「双半对称」断言全部改造为「lib=0 + broker=原计数」；lib 半编排行为用例
// 已删除——broker 侧等价覆盖见 bridge.test.mjs / roster-route.test.mjs。
// 本文件只 apply lib/index.js：每个测试进程独立运行，避免 Symbol.for 快照桥
// 被 broker 半覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as host from '../lib/index.js'
import * as brokerHalf from '../preset/tools/broker.mjs'
import * as sharedFailure from '../preset/shared/failure.mjs'
import * as sharedArchive from '../preset/shared/archive.mjs'
import * as sharedRoles from '../preset/shared/roles.mjs'
import * as sharedMisc from '../preset/shared/misc.mjs'

// 测试隔离：DSH_HOME 指向独立临时目录（getBuiltinPersona 读盘用），并且全部
// lib.apply 都带 NO_INSTALL —— 一次性安装同步由 config 闸**真**短路（0.3.0-tisitan.8
// E3/B-01）：旧写法全靠「版本标记碰巧已写」躲开那次后台拷贝，而 marker 语义本
// 批换成 version+内容摘要，那种侥幸会当场失效并让测试与安装器抢同一批文件。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-host-home-'))

const NO_INSTALL = { installPreset: false }

function mockHostCtx({ llm, settings, toolsRegistry } = {}) {
  const listeners = new Map()
  const rpcHandlers = new Map()
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      if (name === 'tools') return toolsRegistry
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    // connection.rpc 通道捕获：saveSettings/loadSettings 端点经此注册，
    // 测试用返回的 rpc() 直呼端点（真实 DSH 由 WebUI 走同一入口）。
    inject: (_deps, cb) => {
      try {
        cb({ connection: { rpc: { handle: (channel, fn) => { rpcHandlers.set(channel, fn) } } } })
      } catch { /* no connection in this deployment shape */ }
    },
  }
  return { ctx, listeners, rpc: (channel, endpoint, payload) => rpcHandlers.get(channel)(endpoint, payload) }
}

const readBothHalves = () => Promise.all([
  readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
  readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
])
// 健康度批：子代理侧八张登记表的定义已抽入 shared/child-registry.mjs，
// 反向 parity 的「状态族」断言因此有了第三个源文件。
const readChildRegistry = () => readFile(new URL('../preset/shared/child-registry.mjs', import.meta.url), 'utf-8')
const countOf = (src, marker) => src.split(marker).length - 1

// ── 源码 pin 的裁决口径（0.3.0-tisitan.11 C-10，逐条映射表见 CHANGELOG）──────
// 本文件是「源码断言」的集中地，而源码断言有两种命：一种锁不变量，一种锁实现。
// 只保留前者，判据四条形：
//   ① **唯一归属 / 某写法不得出现**（X=1 的 single-source 声明、grep=0 的负向
//      不变量）→ 保留。它锁的是「这件事只能有一个出处」「这种写法一出现就是
//      回归」，重构不会让它变红，除非语义真的变了。
//   ② **出现次数**（X=2/3/N 的调用点枚举）→ 删除或降为 >=1。计数不是不变量：
//      加一处合法的调用点、把两行合成一行，都会让一个语义正确的改动红掉。
//   ③ **整行字面量复刻**（含变量名、参数顺序、缩进）→ 删除。那是在编译期重抄
//      一遍源码，改个标识符就得来改测试。
//   ④ **用户可见措辞 / 日志文案**→ 删除（除非是 grep=0 的负向）。文案归文案，
//      防线归防线：文案断言由行为档持有（failure-notice 逐条测的是「父会话收到
//      哪条通知、什么顺序」，那才是契约）。
// 兜不住的（无行为档覆盖的唯一点位）一律降级为 >=1「在册」并逐条注明为什么没有
// 行为档——宁可留一枚弱标记，也不要让那条路径彻底无人看守。

// 编排身份的十枚标记：足以判定「有人把编排面搬回 lib 半」这一件事本身。
// 函数名级、字面量级、调用次数级的复刻断言已按上方口径退役。
const ORCHESTRATION_IDENTITY = [
  "name: 'go_work'",
  "name: 'orchestration_status'",
  'new Orchestration(',
  'async function dispatchWork(',
  'function advanceQueue(',
  'startContinuable',
  "ctx.on('subagent/end'",
  'orchestration-ledger.json',
  'shared/orchestration.mjs',
  'createChildRegistry',
  // end 归因决策（0.3.0-tisitan.12 B5）同属编排身份：lib 半既不该有这个决策，
  // 也不该出现对它 import 的可能性——真主只在天上的 broker 一处。
  'shared/end-attribution.mjs',
  'attributeEnd(',
]

// ── ① 反向 parity 主断言：lib 零编排面 + broker 独有面保留 ────────────────

test('lib 半零编排面（反向 parity）：编排身份标记 grep=0，broker 半全量在册', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  const registrySrc = await readChildRegistry()
  for (const marker of ORCHESTRATION_IDENTITY) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(brokerSrc, marker) >= 1, `broker 半在册: ${marker}`)
  }
  // 子代理侧八张登记表的本体唯一归属 shared/child-registry.mjs：两枚代表标记
  // 足够（同一次重构会同时挪走它们），完整形状由 child-registry.test.mjs 行为档守
  for (const marker of ['const childOwner = new Map()', 'const activeFallback = new Map()']) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `登记表本体不得回流 broker: ${marker}`)
    assert.equal(countOf(registrySrc, marker), 1, `child-registry 唯一登记处: ${marker}`)
  }
  assert.equal(countOf(hostSrc, 'createChildRegistry'), 0, 'lib 半不接登记表（编排面整体切除）')
  // 负向不变量（绝不动）：备选覆盖表与墓碑逻辑 broker 一律零直引——手抄一份
  // 就是「未来新增清理点漏表」的根因复活（activeFallback 归 child-registry 独享）
  assert.equal(countOf(brokerSrc, 'activeFallback.'), 0, 'broker 半零直引备选覆盖表')
  assert.equal(countOf(brokerSrc, 'function tombstoneType('), 0, '墓碑逻辑不在 broker 手抄')
  assert.equal(countOf(brokerSrc, 'DISPOSED_TYPES_CAP'), 0, '墓碑容量常量归 child-registry')
  assert.equal(countOf(brokerSrc, "events[i].type === 'step/end'"), 0, 'N7 倒扫死支不得复活')
})

test('RPC/settings 契约：RPC 端点全家与 settings.register 为 lib 独有，broker 半只读', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  // lib 半：settings 注册面 + RPC 单通道全端点
  assert.equal(countOf(hostSrc, 'settings.register('), 1, 'lib 半注册 settings 命名空间')
  assert.equal(countOf(hostSrc, "rpc.handle('/dsh-my-go'"), 1, 'lib 半 RPC 单通道')
  for (const endpoint of ['snapshot', 'listModels', 'listTools', 'getBuiltinPersona', 'loadSettings', 'saveSettings']) {
    assert.equal(countOf(hostSrc, `endpoint === '${endpoint}'`), 1, `lib 半保留端点: ${endpoint}`)
  }
  assert.ok(countOf(hostSrc, "Symbol.for('dsh-my-go.snapshot')") >= 1, 'lib 半消费快照桥')
  // broker 半：只读 settings、零 RPC，快照桥唯一发布者
  assert.equal(countOf(brokerSrc, 'settings.register('), 0, 'broker 半不重复注册 settings（只读）')
  assert.equal(countOf(brokerSrc, 'rpc.handle('), 0, 'broker 半零 RPC 端点')
  assert.ok(countOf(brokerSrc, "globalThis[Symbol.for('dsh-my-go.snapshot')]") >= 1, 'broker 半发布快照桥')
})

// ── ①c 无行为档覆盖的共享通路：按 C-10 口径降级为「在册 >=1」──────────────
// 这十一条都是「走共享实现还是走本地副本」这类跨模块事实，任何 mock 行为测试都
// 观察不到差别（副本与原件行为一样，直到某天只改一边）。所以保留最弱的存在性
// 标记 + lib 半零残留；原先 ~50 条精确计数与整行字面量复刻已退役，逐条去向见
// CHANGELOG 0.3.0-tisitan.11 的映射表。
const BROKER_ONLY_PATHWAYS = [
  ['sharedRolePersona(', '内置人设现读走 shared（两侧各抄一份 = prompts/ 档案与派发人设分叉）'],
  ['sharedResolveRoleToolFilter(', '角色工具过滤现算走 shared（漏一处 = 派发时不再按活目录降级）'],
  ['resolveEffectiveBinding(', '备选覆盖合并走 shared（手抄合并规则是备选泄漏给常规派发的温床）'],
  ['findRecordWithLedgerFallback(', '台账兜底查找通路（属主不在内存表时就无路可寻）'],
  ['spawnChild(', '派发组合子唯一出口（另起 spawn 路径 = 绕开 restrict 与台账登记）'],
  ['attemptFallbackRedeploy(', '备选重派入口（终局落账与重派共用同一决策点）'],
  ['abortExpected.add(', 'N6 预期掐断护航登记（不登记则主动中断被误判真失败）'],
  ['abortExpected.delete(', 'N6 护航消费（只加不删 = 从此吞掉该 child 的一切真失败）'],
  ['fallbackDecided.add(', '备选 once-guard 登记（不登记则同一 child 双发 end 各重派一次）'],
  ['pendingFallbackByLabel.set(', '棒2-Z2 spawn 解析前的 pending 备选登记'],
  ['belongs to another live orchestration session', '跨会话抢属主闸（continue / forward 任一侧失守都是串台）'],
]

test('host/broker 接线分界：共享通路降级为存在性在册，两半无本地重定义（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const [marker, why] of BROKER_ONLY_PATHWAYS) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(brokerSrc, marker) >= 1, `broker 半在册（${why}）: ${marker}`)
  }
  // 合并语义两半都不得有本地定义（负向不变量，唯一出处 shared/misc.mjs）
  assert.equal(countOf(hostSrc, 'function resolveEffectiveBinding'), 0, 'lib 半无本地定义')
  assert.equal(countOf(brokerSrc, 'function resolveEffectiveBinding'), 0, 'broker 半无本地定义')
  // 名册键集薄壳：两半各自的共享接线（RPC 花名册 / 派发入口都吃它），存在即可
  assert.ok(countOf(hostSrc, 'sharedRosterKeys(bindings)') >= 1, 'lib 半名册键集接线在册')
  assert.ok(countOf(brokerSrc, 'sharedRosterKeys(bindings)') >= 1, 'broker 半名册键集接线在册')
})

// ── 0.3.0-tisitan.8 lib/client 修复批的在册 pin ─────────────────────────────────
// 同 0.3.0-tisitan.7 的纪律：只锁「修复在册」这一事实。本批六条都属静默失效型
// （少一行日志、少一枚闸，运行期什么都不报错），回潮时没有任何东西会来提醒。

test('lib 半本批修复在册（源码断言）：留痕/失败隔离/参数化安装/裁剪/信封合规', async () => {
  const hostSrc = await readFile(new URL('../lib/index.js', import.meta.url), 'utf-8')
  // E1/B-02：注册失败必须留痕，且与读盘接线分两个 try（同 try 罩住 = 注册一抛
  // 热更监听就失联）
  assert.equal(countOf(hostSrc, 'console.error(`[dsh-my-go] settings namespace registration failed'), 1, 'E1 注册失败留痕单点')
  assert.equal(countOf(hostSrc, 'console.error(`[dsh-my-go] settings readout failed'), 1, 'E1 读盘/接线失败独立留痕单点')
  // E3/B-01：安装同步可关（测试真短路），且安装器接受注入的 packageRoot/dshHome
  assert.equal(countOf(hostSrc, 'config.installPreset !== false'), 1, 'E3 config 闸单点')
  assert.equal(countOf(hostSrc, 'export async function ensurePresetInstalled('), 1, 'E3 安装器参数化导出（定义唯一）')
  // E8/B-08：marker 是「版本+内容摘要」，不是裸版本号
  assert.equal(countOf(hostSrc, 'const marker = `${version}+${digest}`'), 1, 'E8 marker 含内容摘要')
  assert.equal(countOf(hostSrc, 'await writeFile(markerPath, version'), 0, 'E8 裸版本号 marker 写法不得复活')
  // B-09：整拷退役为逐文件比对（写窗口只剩真改过的），prompts 走镜像删净
  // （C-10：原先还钉 `await syncTreeFilewise(` = 2「preset + prompts 两处」——
  // 调用点计数不是不变量，且 host-lib-fixes 已有「未变更文件不重写」「prompts
  // 孤儿清净」两例行为档直接兜住整拷回潮，故退役计数、只留写法负向 + 清场单点）
  assert.equal(countOf(hostSrc, 'await cp('), 0, 'B-09 无差别整拷不得复活')
  assert.equal(countOf(hostSrc, 'await rm(promptsTarget'), 1, 'B-09 prompts 镜像先删净')
  // E5/A-02：快照出口裁剪在册（定义 + 出口消费，只钉「在不在」）
  assert.equal(countOf(hostSrc, 'const PANEL_HISTORY_TAIL = 8'), 1, 'E5 面板 history 末 8 裁剪')
  assert.ok(countOf(hostSrc, 'trimSnapshotForPanel(') >= 1, 'E5 裁剪通路在册')
  // B-10：安装根单一来源，DSH_HOME/.agent-presets 不得再被手抄
  assert.equal(countOf(hostSrc, "'.agent-presets'"), 1, 'B-10 预设根唯一出处（presetInstallRoot）')
  assert.equal(countOf(hostSrc, 'function presetInstallRoot('), 1, 'B-10 安装根函数单点')
  // E9/B-07：rpc.handle arity 探测在册（通道注册只有一处由上方 P2 钉，此处不重复计数）
  assert.ok(countOf(hostSrc, 'rpc.handle.length >= 3') >= 1, 'E9 arity 探测在册')
  // B-06 半面：错误信封合规——每个 error 分支都带 details。
  // needle 自 0.3.0-tisitan.9 起从 `details: {}` 放宽为 `details:`：E6 的 conflict 分支
  // details 要携带 {expected, actual}，只认空对象会把「写了有效 details」误判成
  // 缺项——契约要求的是字段在场，不是内容为空。空 details 的下限只作弱兜底，
  // 分支数随功能增减本属正常（C-10：精确相等会因合理新增而假红）。
  assert.ok(countOf(hostSrc, "code: '") >= 6, 'lib 半错误分支计数（信封合规的分母）')
  assert.equal(countOf(hostSrc, "code: '"), countOf(hostSrc, 'details:'), 'B-06 每个 error 分支都带 details（ConnectionRpcFailure 契约，1:1 配对而非计数）')
  assert.ok(countOf(hostSrc, 'details: {}') >= 6, 'B-06 无附加信息的分支仍统一写空 details（弱下限）')
})

test('客户端半本批修复在册（源码断言）：降级定时器 / 轮询退避 / legacy 过滤 / key 身份', async () => {
  const [clientSrc, panelSrc, maskSrc, coreSrc] = await Promise.all([
    readFile(new URL('../src/client.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/panel-tree.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/tool-mask-editor.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/settings-core.js', import.meta.url), 'utf-8'),
  ])
  // E2/A-01：timer 缺席有真回落（且不留孤儿），sessions 缺席有留痕
  assert.equal(countOf(clientSrc, 'function createSelfManagedTimer('), 1, 'E2 自管回落定时器单点')
  assert.equal(countOf(clientSrc, 'globalThis.setInterval('), 1, 'E2 回落到 window.setInterval')
  assert.ok(countOf(clientSrc, 'falls back to window.setInterval') >= 1, 'E2 回落一次性留痕在册')
  assert.ok(countOf(clientSrc, 'sessions service unavailable') >= 1, 'E2 sessions 缺席留痕在册')
  // E5/A-02：轮询 in-flight 门 + 退避档 + 状态迁移留痕
  assert.equal(countOf(panelSrc, 'if (pollInFlight) return'), 1, 'E5 in-flight 不重入')
  assert.equal(countOf(panelSrc, 'const POLL_BACKOFF_MS = [600, 1500, 3000]'), 1, 'E5 退避档位表')
  assert.equal(countOf(panelSrc, 'function setBridgeProblem('), 1, 'E5 迁移留痕只在翻转点')
  // E10/B-03 前端面：桥抛错与桥未注册两型文案分流
  assert.ok(countOf(panelSrc, "bridgeProblem === 'internal'") >= 1, 'E10 internal 型独立提示分支')
  // A-04/A-08/A-09：幽灵父区过滤、求助行身份、关面板不空转
  assert.equal(countOf(panelSrc, "p.parentSessionId !== 'legacy'"), 1, 'A-04 legacy 幽灵父区被过滤')
  assert.equal(countOf(panelSrc, 'hlp-${h.parentSessionId}-${h.id ?? i}'), 1, 'A-08 求助行 key 用求助单 id')
  assert.equal(countOf(panelSrc, 'if (panelOpen) force((c) => c + 1)'), 1, 'A-09 30s 相对时间刷新受面板开关约束')
  // A-12：React 由模块自身 import，不再经 deps 传递
  assert.equal(countOf(maskSrc, "import * as React from 'react'"), 1, 'A-12 tool-mask-editor 直接 import React')
  assert.equal(countOf(maskSrc, '    React,'), 0, 'A-12 deps.React 退役')
  assert.ok(countOf(coreSrc, 'renderToolMaskEditor(') >= 1, 'A-12 调用点不再传 React（在位即可，签名细节归 tool-mask-rows/行为档）')
})

test('0.3.0-tisitan.9 设置页加固在册（源码断言）：dirty 汇聚 / revision 围栏 / 可手填 / 结构化名册', async () => {
  const [coreSrc, guardSrc, panelSrc, hostSrc, brokerSrc] = await Promise.all([
    readFile(new URL('../src/settings-core.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/settings-guard.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/panel-tree.js', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
  ])
  // ── E6/A-03 dirty 汇聚：一处置位，角色区也不例外
  assert.equal(countOf(coreSrc, 'const mutateDraft ='), 1, 'dirty 只有唯一汇聚口（定义唯一归属）')
  assert.equal(countOf(coreSrc, '      setDraft,'), 0, 'roles-editor 不得再吃裸 setDraft（漏一处就是偏心 dirty，比没有更坏）')
  assert.equal(countOf(coreSrc, 'setDraft: mutateDraft,'), 1, '角色区写口并入 dirty（dep 名不变，换实现）')
  assert.ok(countOf(coreSrc, 'setDirty(false)') >= 1, '复位通路在册（加载/保存成功/主动重载各几处不是不变量）')
  // hook 必须排在 !sp 早退之前，否则 sp 有无会改变 hook 数量（React 硬约束）
  assert.ok(
    coreSrc.indexOf('React.useEffect(() => {\n    if (!dirty)') < coreSrc.indexOf("if (!sp) return React.createElement"),
    'beforeunload hook 不得掉到早退分支之后',
  )
  assert.ok(countOf(coreSrc, 'attachBeforeUnloadGuard') >= 1, '守卫挂载在册')
  assert.ok(countOf(coreSrc, "typeof close === 'function'") >= 1, 'close 真的被消费（宿主 settings.section 唯一 affordance）')
  assert.ok(countOf(coreSrc, 'close()') >= 1, '保存成功才关页，失败/冲突绝不关')
  // ── E6/A-03 revision 围栏：凭据只当不透明 token，绝不被当成配置字段
  assert.ok(countOf(coreSrc, 'body.revision = revision') >= 1, '保存带凭据（缺凭据时不塞假版本的语义归 settings-guard 行为档）')
  assert.ok(countOf(coreSrc, 'interpretLoadResult(') >= 1 && countOf(coreSrc, 'interpretSaveResult(') >= 1, '读写两面都经归一函数（语义不散落在组件里）')
  assert.ok(countOf(coreSrc, 'disabled: saving || !draft || conflict !== null') >= 1, '冲突后保存按钮锁死在册')
  assert.ok(countOf(guardSrc, 'revision: null') >= 1, '冲突与失败都必须作废本地凭据')
  // ── A-06 可手填 + 渠道失败区分
  assert.equal(countOf(coreSrc, 'const makeCombobox = ('), 1, 'input+datalist 组合框定义唯一')
  assert.ok(countOf(coreSrc, "React.createElement('datalist'") >= 1, '清单在场时仍可点选')
  assert.equal(countOf(coreSrc, 'makeSelect(row.provider'), 0, 'provider 裸 select 不得复活（否则手填承诺再次落空）')
  assert.equal(countOf(coreSrc, 'makeSelect(row.model'), 0, 'model 裸 select 不得复活')
  assert.ok(countOf(coreSrc, 'modelListErrorFor') >= 1, '渠道级失败提示通路在册（errors 字典语义由 settings-fence 行为档兜）')
  // ── A-05 结构化名册：host 的字符串格式不再是面板的 API
  assert.ok(countOf(panelSrc, 'Array.isArray(s.roster)') >= 1, '面板直读结构化 roster')
  assert.equal(countOf(panelSrc, 's.rosterLines.length - 1'), 0, '「行数减一当计数」的位置约定退役')
  assert.ok(countOf(panelSrc, 'entry?.toolFilterText') >= 1 || countOf(panelSrc, 'entry?.personaSource') >= 1, '行渲染吃结构化字段而非切字符串')
  // ── A-05 单一源：两半都不再自抄名册格式（lib 与 broker 各删一份 18 行副本）
  assert.equal(countOf(hostSrc, '备选${chain}'), 0, 'lib 半自抄的行格式已退役')
  assert.equal(countOf(brokerSrc, '备选${chain}'), 0, 'broker 半自抄的行格式已退役')
  assert.ok(countOf(hostSrc, 'roster: renderRosterEntries()') >= 1, 'snapshot 结构化 roster 在册')
})

test('名册简报段为 broker 独有注册 + 渲染单一源在 shared（源码断言）', async () => {
  const [brokerSrc, hostSrc, rolesSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/shared/roles.mjs', import.meta.url), 'utf-8'),
  ])
  // 渲染器单一源：shared 定义 1 处（唯一归属，留）；broker 侧只钉「import 别名在册 +
  // 真的在调用它」——旧版钉 `sharedRenderRosterBriefing` 出现 2 次（import + 消费），
  // 那是把「调用点数量」当不变量，多一处合法复用就假红（C-10 P3）。调用点用带括号的
  // 形态区分（import 行是 `sharedRenderRosterBriefing,`，调用是 `sharedRenderRosterBriefing(`），
  // 于是「只 import 不用」这种真回归仍然红。
  assert.equal(rolesSrc.split('export function renderRosterBriefing').length - 1, 1, 'shared roles.mjs 单点定义')
  assert.ok(brokerSrc.includes('sharedRenderRosterBriefing'), 'broker 半 import 共享渲染器')
  assert.ok(/sharedRenderRosterBriefing\s*\(/.test(brokerSrc), 'broker 半真的调用它（不是 import 完就搁置）')
  assert.equal(hostSrc.split('renderRosterBriefing').length - 1, 0, 'lib 半不注册系统提示段（与 persona/orchestration 同为 broker 独有）')
  // 注册形态：同名重注册会抛错，故 name 出现次数即注册数（唯一归属，保留）；
  // order 的具体数值是排版选择不是不变量（C-10 P4：计数退役，行为档 failure-notice
  // 已断言 def.order 存在且 persona/orchestration 三段共存）
  assert.equal(brokerSrc.split("name: 'dsh-my-go:roster'").length - 1, 1, 'broker 半注册 1 处')
  assert.equal(hostSrc.split('dsh-my-go:roster').length - 1, 0, 'lib 半零注册')
  assert.ok(!/"dsh-my-go:roster"[^}]*complete:\s*true/s.test(brokerSrc), 'roster 段不得携带 complete:true')
})

// 安装目录模拟（C-10 P5 加强）：按 package.json files 白名单算出「装完之后包里
// 会有什么」，再逐条核对两半的 import 目标是否在其中。只在本仓 existsSync 是不够的
// ——白名单漏一个目录，本地 299 例全绿，用户侧 `dsh plugin add` 直接 MODULE_NOT_FOUND。
async function publishedFileSet() {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  const includes = pkg.files.filter((entry) => !entry.startsWith('!'))
  const excludes = pkg.files.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1))
  const out = new Set()
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      if (excludes.some((x) => childRel === x || childRel.startsWith(`${x}/`))) continue
      if (ent.isDirectory()) { walk(join(abs, ent.name), childRel); continue }
      out.add(childRel)
    }
  }
  for (const entry of includes) {
    const abs = join(repoRoot, entry)
    if (!existsSync(abs)) continue // 顶层条目可缺席（如未构建的 dist/），由下面的断言负责
    if (statSync(abs).isDirectory()) walk(abs, entry)
    else out.add(entry)
  }
  return { published: out, repoRoot }
}

test('shared 单一源：两半 import 行指向存在的文件，且逐条落在安装目录内（源码断言）', async () => {
  const repoRoot = new URL('../', import.meta.url)
  const { published } = await publishedFileSet()
  const halves = [
    ['broker', 'preset/tools/', 'broker.mjs', '../shared/', 6],
    // 0.3.0-tisitan.0 后 lib 只保留存储/面板面 shared 依赖（constants/roles/misc
    // 三行 import + 两行存储面 re-export = 5 行），下限放宽到 ≥3
    ['lib', 'lib/', 'index.js', '../preset/shared/', 3],
  ]
  for (const [name, dir, entry, sharedPrefix, minLines] of halves) {
    const src = await readFile(new URL(dir + entry, repoRoot), 'utf-8')
    const importLines = src.split('\n').filter((l) => l.includes(`from '${sharedPrefix}`))
    assert.ok(importLines.length >= minLines, `${name} 半应有 ≥${minLines} 行 shared import，实际 ${importLines.length}`)
    for (const line of importLines) {
      const m = /from '([^']+)'/.exec(line)
      assert.ok(m, `import 行含 from 子句: ${line.trim()}`)
      const target = fileURLToPath(new URL(m[1], new URL(dir, repoRoot)))
      assert.ok(existsSync(target), `${name} 半 import 目标存在: ${m[1]}`)
      const rootDir = fileURLToPath(repoRoot)
      const rel = target.slice(rootDir.length).replace(/\\/g, '/').replace(/^\/+/, '')
      assert.ok(published.has(rel), `安装目录里没有它 = 用户侧 MODULE_NOT_FOUND：${name} → ${rel}`)
    }
  }
  // 消费通路（subagent/end 处理器内的附因归一）只在 broker apply 内；lib 已无编排面
  const [brokerSrc, hostSrc] = await readBothHalves()
  assert.equal(countOf(hostSrc, 'const failure = normalizeTurnFailure(ev.data.reason.error)'), 0, 'lib 半无附因提取通路（随编排面切除）')
  assert.ok(countOf(brokerSrc, 'normalizeTurnFailure(') >= 1, 'broker 半有附因归一通路')
  const sharedArchiveSrc = await readFile(new URL('../preset/shared/archive.mjs', import.meta.url), 'utf-8')
  assert.ok(sharedArchiveSrc.split('const failure = normalizeTurnFailure(ev.data.reason.error)').length - 1 >= 1, 'shared archive.mjs 内提取通路在册')
})

// ── ①b 降级形态语义：snapshot 桥缺席 = preset 未装配 → 空态 + 花名册常驻 ──

test('snapshot RPC：preset 未装配（无桥）回落降级空态，桥在席读 broker 实况', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const hadBridge = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prevBridge = globalThis[bridgeKey]
  try {
    delete globalThis[bridgeKey]
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, NO_INSTALL)
    // 无桥 = preset 未装配（lib-only 降级形态）：空态形状 + rosterLines 常驻
    const degraded = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(degraded.ok, true)
    assert.deepEqual({ seq: degraded.value.seq, parents: degraded.value.parents }, { seq: 0, parents: {} }, 'preset 未装配 → 降级空态 { seq: 0, parents: {} }')
    assert.ok(Array.isArray(degraded.value.rosterLines) && degraded.value.rosterLines.length > 1, '降级形态下 rosterLines 仍常驻')
    // 桥在席：RPC 直读 broker 发布的实时快照（零副本）
    const live = { seq: 7, parents: { 'p-1': { parentSessionId: 'p-1', current: null, queue: [], helpRequests: [], history: [] } } }
    globalThis[bridgeKey] = () => live
    const bridged = await rpc('/dsh-my-go', 'snapshot', {})
    assert.equal(bridged.ok, true)
    assert.equal(bridged.value.seq, 7, '桥在席读 broker 实况而非空态')
    assert.ok(bridged.value.parents['p-1'], 'broker 分桶原样透出')
    assert.ok(Array.isArray(bridged.value.rosterLines), '桥在席时 rosterLines 同样附带')
  } finally {
    if (hadBridge) globalThis[bridgeKey] = prevBridge
    else delete globalThis[bridgeKey]
  }
})

// ── ② 存储/面板面行为批（0.3.0-tisitan.0 后 lib 半的全部行为面，原样保留）──────

test('lib 半 settings schema：fallbacks 数组被接受并原样带出', async () => {
  let registered
  const settings = {
    register: (ns, schema) => { registered = schema; return {} },
    get: () => undefined,
  }
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  assert.ok(registered, 'settings.register 应被调用且捕获 schema')
  const parsed = registered({ roles: { hermes: { provider: 'a', model: 'b', fallbacks: [{ provider: 'x', model: 'y' }] } } })
  assert.deepEqual(parsed.roles.hermes.fallbacks, [{ provider: 'x', model: 'y' }], 'schema 接受 fallbacks 且保持数组形状')
})

test('lib 半 saveSettings：fallbacks 空数组转 unset，非空数组原样 set', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    hermes: { fallbacks: [] },
    oracle: { fallbacks: [{ provider: 'p1', model: 'm1' }] },
  })
  assert.equal(res.ok, true)
  assert.equal(mutates.length, 1)
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'hermes' && o.path[2] === 'fallbacks'),
    [{ op: 'unset', path: ['roles', 'hermes', 'fallbacks'] }],
    '空数组与空字符串同语义：unset',
  )
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'roles' && o.path[1] === 'oracle' && o.path[2] === 'fallbacks'),
    [{ op: 'set', path: ['roles', 'oracle', 'fallbacks'], value: [{ provider: 'p1', model: 'm1' }] }],
    '非空数组原样保留',
  )
})

test('settings 合并单一源：mergeRoleBindings 定义于 shared，两半接线通路在册（源码断言）', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  // 定义不再双写：两半源码里都没有函数体，只有 import + re-export（不得出现类，留）
  assert.equal(countOf(hostSrc, 'function mergeRoleBindings'), 0, 'lib 半无本地定义（已迁 shared）')
  assert.equal(countOf(brokerSrc, 'function mergeRoleBindings'), 0, 'broker 半无本地定义（原内联块退役）')
  // C-10 P3：旧版钉「两半各 2 处调用 + 整行 `bindings = mergeRoleBindings(baseBindings, `
  // 字面量复刻」= 出现次数 + 变量名 pin，初载/settings-updated 任一改成别的写法都假红。
  // 通路在册即可，具体几处调用不是不变量（merge 语义本身由下面的 shared 单点与行为档兜）。
  assert.ok(countOf(hostSrc, 'mergeRoleBindings(') >= 1, 'lib 半经共享 merge 通路')
  assert.ok(countOf(brokerSrc, 'mergeRoleBindings(') >= 1, 'broker 半经共享 merge 通路')
  // ?? 链语义在 shared 单点定义（唯一归属，留；needle 不含赋值左侧，容忍改名与换行）
  const sharedRolesSrc = await readFile(new URL('../preset/shared/roles.mjs', import.meta.url), 'utf-8')
  assert.equal(sharedRolesSrc.split('row.fallbacks ?? merged[key]?.fallbacks').length - 1, 1, 'shared roles.mjs 单点携带 fallbacks ?? 链')
})

// ── tool-mask 配置化（0.2.3-tisitan.13）：schema + saveSettings + listTools ────

test('lib 半 settings schema：toolMask.deny 数组被接受，缺省键不受影响', async () => {
  let registered
  const settings = {
    register: (ns, schema) => { registered = schema; return {} },
    get: () => undefined,
  }
  const { ctx } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const parsed = registered({ toolMask: { deny: ['mcp__a__x', 'tool_y'] } })
  assert.deepEqual(parsed.toolMask.deny, ['mcp__a__x', 'tool_y'], 'schema 接受 toolMask 且保持形状')
  const parsedMinimal = registered({})
  assert.ok(parsedMinimal && typeof parsedMinimal === 'object', '不含 toolMask 的存量配置仍可解析（向后兼容）')
})

test('lib 半 saveSettings：toolMask.deny 空数组转 unset，非空原样 set', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    toolMask: { deny: ['mcp__a__x'] },
    hermes: { fallbacks: [] },
  })
  assert.equal(res.ok, true)
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.path[0] === 'toolMask'),
    [{ op: 'set', path: ['toolMask', 'deny'], value: ['mcp__a__x'] }],
    '非空 deny 原样 set',
  )
  const res2 = await rpc('/dsh-my-go', 'saveSettings', { toolMask: { deny: [] } })
  assert.equal(res2.ok, true)
  assert.deepEqual(
    mutates[1].ops.filter((o) => o.path[0] === 'toolMask'),
    [{ op: 'unset', path: ['toolMask', 'deny'] }],
    '空数组与不屏蔽同语义：unset',
  )
})

test('lib 半 listTools：花名册返回全局工具名且滤保留名（mock 注册表）', async () => {
  const { ctx, rpc } = mockHostCtx({
    toolsRegistry: {
      schemas: () => [
        { name: 'read', description: '', parameters: {} },
        { name: 'run_code', description: '', parameters: {} },
        { name: 'mcp__vcp__alpha', description: '', parameters: {} },
        { name: 'mcp__vcp__beta', description: '', parameters: {} },
      ],
    },
  })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, ['mcp__vcp__alpha', 'mcp__vcp__beta', 'read'], '保留名 run_code 不返回，名单排序去重')
})

test('lib 半 listTools：tools 服务缺席回落空名单（ok:true）', async () => {
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, [], '设置页降级为纯编辑器而非报错')
})

// ── 内置卡「载入文件默认」（0.2.3-tisitan.16b）：getBuiltinPersona RPC 端点 ────

test('lib 半 getBuiltinPersona：正常读取 / 非法 type / 目录穿越 / 文件缺失全结构化', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  // 用哨兵内容占住安装副本路径：安装同步已被 config.installPreset 闸真关掉
  // （NO_INSTALL，见文件头），后台拷贝不会再覆写它，故断言读到的是磁盘原文
  // 而非任何缓存——这里读的是安装位，不是包内兜底路径（B-10 的回落次序）。
  const promptsDir = join(process.env.DSH_HOME, '.agent-presets', 'dsh-my-go', 'prompts')
  mkdirSync(promptsDir, { recursive: true })
  writeFileSync(join(promptsDir, 'hermes.md'), 'SENTINEL hermes 人设原文')
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, NO_INSTALL)
  const ok = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'hermes' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { type: 'hermes', persona: 'SENTINEL hermes 人设原文' }, '直读磁盘原文返回')
  const illegal = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'Hermes' })
  assert.equal(illegal.ok, false, '大写非法 type 拒绝')
  assert.equal(illegal.error.code, 'bad-request')
  const traversal = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: '../../package' })
  assert.equal(traversal.ok, false, '目录穿越被 ROLE_KEY_PATTERN 拒绝')
  const noPayload = await rpc('/dsh-my-go', 'getBuiltinPersona')
  assert.equal(noPayload.ok, false, '缺 payload 拒绝而非抛穿')
  const missing = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'ghost-role' })
  assert.equal(missing.ok, false, '合法但无文件的 type 结构化空')
  assert.equal(missing.error.code, 'not-found')
})

// ── 界面层（0.2.3-tisitan.14）：saveSettings 的 persona/toolFilter 显式字段 + 角色删除 ──

function settingsMockWithStored(stored) {  return {
    register: () => ({}),
    get: () => stored,
    mutate: async () => {},
  }
}

test('saveSettings：draft.roles 行显式携带 persona/toolFilter 时 set/unset，空=unset', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'saveSettings', {
    roles: {
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X 人设', toolFilter: { allow: ['read', ''], deny: [] } },
      'custom-y': { persona: '' },
    },
  })
  assert.equal(res.ok, true)
  const ops = mutates[0].ops
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'persona' && o.path[1] === 'custom-x'),
    [{ op: 'set', path: ['roles', 'custom-x', 'persona'], value: 'X 人设' }],
    '非空 persona 原样 set',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'persona' && o.path[1] === 'custom-y'),
    [{ op: 'unset', path: ['roles', 'custom-y', 'persona'] }],
    '空字符串 persona = unset',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'toolFilter' && o.path[3] === 'allow'),
    [{ op: 'set', path: ['roles', 'custom-x', 'toolFilter', 'allow'], value: ['read'] }],
    'allow 非空 set（剔空条目）',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[2] === 'toolFilter' && o.path[3] === 'deny'),
    [{ op: 'unset', path: ['roles', 'custom-x', 'toolFilter', 'deny'] }],
    'deny 空数组 unset',
  )
})

test('saveSettings：旧形状/内置提升行不带 persona/toolFilter 字段 → 完全不触碰', async () => {
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => undefined,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  await rpc('/dsh-my-go', 'saveSettings', {
    sisyphus: { provider: 'ps', persona: '不该被写进任何地方' },
    hermes: { provider: 'p1', persona: '顶级工种键 persona' },
    roles: { hermes: { provider: 'p1' } },
  })
  const ops = mutates[0].ops
  assert.equal(ops.filter((o) => o.path.includes('persona')).length, 0, '无显式 persona 字段 = 零 persona ops')
  assert.equal(ops.filter((o) => o.path.includes('toolFilter')).length, 0, '无显式 toolFilter 字段 = 零 toolFilter ops')
  assert.equal(ops.filter((o) => o.path[0] === 'sisyphus' && o.path[1] === 'persona').length, 0, 'sisyphus 恒不触碰 persona')
})

test('saveSettings：draft 提供 roles dict 时缺失的非内置键整键 unset；旧前端无 roles 键不清册', async () => {
  const stored = { sisyphus: {}, toolMask: {}, roles: { 'custom-x': { provider: 'p9' }, 'custom-y': {}, hermes: { provider: 'p1' } } }
  const mutates = []
  const settings = {
    register: () => ({}),
    get: () => stored,
    mutate: async (ns, ops) => { mutates.push({ ns, ops }) },
  }
  const { ctx, rpc } = mockHostCtx({ settings })
  await host.apply(ctx, NO_INSTALL)
  await rpc('/dsh-my-go', 'saveSettings', { roles: { 'custom-x': { provider: 'p9' } } })
  assert.deepEqual(
    mutates[0].ops.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2),
    [{ op: 'unset', path: ['roles', 'custom-y'] }],
    'draft.roles 缺失的 custom-y 整键 unset；custom-x 存续；内置 hermes 不在删除面',
  )
  await rpc('/dsh-my-go', 'saveSettings', { hermes: { provider: 'p1' } })
  assert.equal(
    mutates[1].ops.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2).length,
    0,
    '旧前端 draft 无 roles 键 → 删除语义不启用，存量名册不被误清',
  )
})

test('loadSettings 回传形状：roles 原样附带 + 内置提升 + sisyphus/toolMask 顶级（角色编辑器数据源）', async () => {
  const stored = {
    sisyphus: { provider: 'ps' },
    toolMask: { deny: [] },
    roles: {
      hermes: { provider: 'p1', model: 'm1' },
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X' },
    },
  }
  const { ctx, rpc } = mockHostCtx({ settings: settingsMockWithStored(stored) })
  await host.apply(ctx, NO_INSTALL)
  const res = await rpc('/dsh-my-go', 'loadSettings', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.roles['custom-x'].persona, 'X', 'roles 原样附带（编辑器数据源）')
  assert.deepEqual(res.value.hermes, { provider: 'p1', model: 'm1' }, '内置提升回顶级')
  assert.deepEqual(res.value.sisyphus, { provider: 'ps' })
})

// ── ④ shared 行为面直测（不经 lib re-export，直引 preset/shared/）──────────

test('isFallbackable / normalizeTurnFailure 分类器语义（shared 直测，与 broker 半同源）', () => {
  const { isFallbackable, normalizeTurnFailure } = sharedFailure
  // 分类表核心行（broker 半全表见 bridge.test.mjs）
  assert.equal(isFallbackable(undefined), true, '全缺失保守可切')
  assert.equal(isFallbackable({ message: 'x', code: 'ABORTED' }), false)
  assert.equal(isFallbackable({ message: 'This operation was aborted', code: 'UNKNOWN' }), false)
  assert.equal(isFallbackable({ message: 'rate limited', code: 'RATE_LIMIT', status: 429 }), true)
  assert.equal(isFallbackable({ message: 'no such model', code: 'HTTP_404', status: 404 }), true)
  // 结构化归一
  assert.deepEqual(normalizeTurnFailure({ message: 'm', code: 'C', status: 500 }), { message: 'm', code: 'C', status: 500 })
  assert.deepEqual(normalizeTurnFailure({ message: 'm', code: 'C' }), { message: 'm', code: 'C', status: undefined })
  assert.equal(normalizeTurnFailure({ code: 'X' }), undefined)
})

test('readArchivedTurnFailure 结构化返回 {message, code, status}（shared 直测）', async () => {
  const { mkdtempSync: mkTmp, mkdirSync, writeFileSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const { zstdCompressSync } = await import('node:zlib')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-host-norm-'))
  try {
    const line = (rec) => JSON.stringify(rec) + '\n'
    const dir = join(home, 'sessions', sharedArchive.projectKey(process.cwd()), 'hsess-norm')
    mkdirSync(dir, { recursive: true })
    const frame1 = zstdCompressSync(Buffer.from(line({ type: 'session/header', seq: 0, time: 0, data: { version: 1 } })))
    const frame2 = zstdCompressSync(Buffer.from(line({
      type: 'turn/end', seq: 1, time: 1,
      data: { turn: 1, reason: { kind: 'error', error: { message: 'provider 500: boom', code: 'SERVER', status: 500 } } },
    })))
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([frame1, frame2]))
    assert.deepEqual(
      sharedArchive.readArchivedTurnFailure('hsess-norm', { root: join(home, 'sessions'), cwd: process.cwd() }),
      { message: 'provider 500: boom', code: 'SERVER', status: 500 },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

// ── 附因取证 cwd 无关化（0.2.3-tisitan.16b）：默认路径未命中时按 childId 兜底搜索 ──
// shared/archive.mjs 纯机制用例（shared 未动，broker 侧无等价覆盖，必须保留）

// 造一份多帧 zstd 档案（turn/end error 文本可配），与 dsh-session-persistence-jsonl 落盘形状一致
async function writeArchive(dir, message) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { zstdCompressSync } = await import('node:zlib')
  const line = (rec) => JSON.stringify(rec) + '\n'
  mkdirSync(dir, { recursive: true })
  const frame1 = zstdCompressSync(Buffer.from(line({ type: 'session/header', seq: 0, time: 0, data: { version: 1 } })))
  const frame2 = zstdCompressSync(Buffer.from(line({
    type: 'turn/end', seq: 1, time: 1,
    data: { turn: 1, reason: { kind: 'error', error: { message, code: 'RATE_LIMIT', status: 429 } } },
  })))
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([frame1, frame2]))
}

test('readArchivedTurnFailure：cwd 错配时按 childId 兜底搜索命中（含 warn 留痕）', async () => {
  const { mkdtempSync: mkTmp } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-cwdmiss-'))
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const root = join(home, 'sessions')
    const projectA = sharedArchive.projectKey('D:\\real-workspace')
    await writeArchive(join(root, projectA, 'hsess-dead'), 'rate limited: 5h cap')
    // options.cwd 指向不存在的项目目录——模拟 dsh web 宿主 cwd 与工作区错配
    const result = sharedArchive.readArchivedTurnFailure('hsess-dead', { root, cwd: join(home, 'no-such-dir') })
    assert.deepEqual(result, { message: 'rate limited: 5h cap', code: 'RATE_LIMIT', status: 429 }, '兜底搜索读到附因')
    assert.ok(warnings.some((l) => l.includes('兜底搜索命中') && l.includes(projectA)), '兜底命中 warn 含项目目录名')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('readArchivedTurnFailure：多项目目录同名 childId 取 mtime 最新', async () => {
  const { mkdtempSync: mkTmp, utimesSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-mtime-'))
  const origWarn = console.warn
  console.warn = () => {}
  try {
    const root = join(home, 'sessions')
    const oldFile = join(root, sharedArchive.projectKey('D:\\proj-old'), 'hsess-dup', 'session.jsonl.zstd')
    const newFile = join(root, sharedArchive.projectKey('D:\\proj-new'), 'hsess-dup', 'session.jsonl.zstd')
    await writeArchive(join(oldFile, '..'), 'old error from project A')
    await writeArchive(join(newFile, '..'), 'new error from project B')
    const now = new Date()
    utimesSync(oldFile, now, new Date(now.getTime() - 60000))
    utimesSync(newFile, now, now)
    const result = sharedArchive.readArchivedTurnFailure('hsess-dup', { root, cwd: join(home, 'no-such-dir') })
    assert.equal(result?.message, 'new error from project B', '多命中取 mtime 最新的档案')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('readArchivedTurnFailure：兜底零命中 warn + undefined（原语义不变）', async () => {
  const { mkdtempSync: mkTmp, mkdirSync } = await import('node:fs')
  const { rm } = await import('node:fs/promises')
  const home = mkTmp(join(tmpdir(), 'dsh-my-go-nohit-'))
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  try {
    const root = join(home, 'sessions')
    mkdirSync(join(root, sharedArchive.projectKey('D:\\some-project')), { recursive: true })
    const result = sharedArchive.readArchivedTurnFailure('hsess-ghost', { root, cwd: join(home, 'no-such-dir') })
    assert.equal(result, undefined, '零命中静默退回无附因')
    assert.ok(warnings.some((l) => l.includes('持久化档案不可读')), '走原 warn 留痕路径')
  } finally {
    console.warn = origWarn
    await rm(home, { recursive: true, force: true })
  }
})

test('shared 行为面直测：失败分类 / 角色合并 / 迁移 ops / 工种识别 / 台账修剪（broker re-export 同一实例）', async () => {
  // broker 半 re-export 与 shared 模块是同一 ESM 绑定（单一实例，非复制）；
  // lib 半不再 re-export 编排面符号（0.3.0-tisitan.0），行为一律直测 shared
  assert.equal(brokerHalf.normalizeTurnFailure, sharedFailure.normalizeTurnFailure, 'broker re-export === shared')
  assert.equal(brokerHalf.isFallbackable, sharedFailure.isFallbackable)
  assert.equal(brokerHalf.describeAgent, sharedMisc.describeAgent, 'broker re-export === shared')
  assert.equal(brokerHalf.Orchestration, (await import('../preset/shared/orchestration.mjs')).Orchestration, 'Orchestration 类单一定义')
  // normalizeTurnFailure：非字符串 message 拒绝，code/status 类型收紧
  assert.equal(sharedFailure.normalizeTurnFailure(null), undefined)
  assert.deepEqual(sharedFailure.normalizeTurnFailure({ message: 'x', code: 5, status: 502.5 }), { message: 'x', code: undefined, status: undefined })
  // isFallbackable：全缺失保守可切，abort 类绝不切
  assert.equal(sharedFailure.isFallbackable(undefined), true)
  assert.equal(sharedFailure.isFallbackable({ code: 'ABORTED' }), false)
  assert.equal(sharedFailure.isFallbackable({ code: 'SERVER' }), true)
  // mergeRoleBindings：roles 自定义键进合并结果，缺字段回落基线
  const merged = sharedRoles.mergeRoleBindings({ hermes: { model: 'base' } }, { roles: { 'custom-x': { model: 'm9', persona: 'X' } } })
  assert.equal(merged['custom-x'].model, 'm9')
  assert.equal(merged.hermes.model, 'base')
  // migrateLegacyRolesOps：整行搬入 roles + 旧键 unset
  const ops = sharedRoles.migrateLegacyRolesOps({ hermes: { model: 'm1' } })
  assert.deepEqual(ops.map((o) => [o.op, o.path.join('.')]), [['set', 'roles.hermes'], ['unset', 'hermes']])
  // typeOfAgent：活登记优先于畸形 label；无登记时 label 兜底
  assert.equal(sharedMisc.typeOfAgent(new Map([['c1', 'hermes']]), { id: 'c1', session: { header: { label: 'garbage' } } }), 'hermes')
  assert.equal(sharedMisc.typeOfAgent(new Map(), { id: 'c2', session: { header: { label: 'dsh-my-go:explore: 快速检索' } } }), 'explore')
  assert.equal(sharedMisc.typeOfAgent(new Map(), { id: 'c3', session: { header: { label: 'unrelated' } } }), undefined)
  // pruneLedgerParents：超 cap 保留最近桶
  const kept = sharedMisc.pruneLedgerParents({ a: [{ updatedAt: 100 }], b: [{ updatedAt: 300 }] }, 1)
  assert.deepEqual(Object.keys(kept), ['b'])
})

test('shared 行为面：resolveEffectiveBinding 覆盖合并（broker re-export 同一实例）', () => {
  assert.equal(brokerHalf.resolveEffectiveBinding, sharedMisc.resolveEffectiveBinding, 'broker re-export === shared')
  const base = { provider: 'p0', model: 'm0', reasoningEffort: 'high', fallbacks: [{ provider: 'p1', model: 'm1' }] }
  const merged = sharedMisc.resolveEffectiveBinding(base, { provider: 'p1', model: 'm1' })
  assert.deepEqual(merged, { ...base, provider: 'p1', model: 'm1' }, '覆盖只换 provider/model，工种其余字段保留')
  assert.notEqual(merged, base, '返回新对象')
  assert.equal(base.provider, 'p0', '绝不原地改 bindings[type]（防备选泄漏给常规派发）')
  assert.equal(sharedMisc.resolveEffectiveBinding(base, undefined), base, '无覆盖 → 原样返回（同一对象）')
  assert.equal(sharedMisc.resolveEffectiveBinding(base, null), base)
  assert.equal(sharedMisc.resolveEffectiveBinding(base, { provider: 'p1' }), base, '畸形覆盖（缺 model）不生效')
  assert.equal(sharedMisc.resolveEffectiveBinding(undefined, undefined), undefined, '双缺省直通')
})
