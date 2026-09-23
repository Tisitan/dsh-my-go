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
import { createPanelRpcTransport, resolvedHostConfig, createSettingsStub } from './helpers/mock-ctx.mjs'
import { buildSettingsOps, draftFromSection } from '../src/settings-ops.js'
import { AGENT_TYPES as SHARED_AGENT_TYPES, PRICE_KEY_PATTERN as SHARED_PRICE_PATTERN, ROLE_KEY_PATTERN as SHARED_ROLE_PATTERN } from '../preset/shared/constants.mjs'
import { AGENT_TYPES as CLIENT_AGENT_TYPES } from '../src/client-constants.js'
import { ROLE_KEY_PATTERN as ROSTER_ROLE_PATTERN } from '../src/roster-rows.js'
import { PRICE_KEY_PATTERN as ROWS_PRICE_PATTERN } from '../src/usage-price-rows.js'

// 写面判据的层形状：value/user 同源、base 空（与被测编译器单测同口径）。
const layersOf = (value) => ({ value: value ?? {}, user: value ?? {}, base: {} })

// 测试隔离：DSH_HOME 指向独立临时目录（getBuiltinPersona 读盘用），并且全部
// lib.apply 都带 ROW_CONFIG —— 0.1.7 起安装同步机制整体退役，行 config 经真 resolveConfig 解析（0.3.0-tisitan.8
// E3/B-01）：旧写法全靠「版本标记碰巧已写」躲开那次后台拷贝，而 marker 语义本
// 批换成 version+内容摘要，那种侥幸会当场失效并让测试与安装器抢同一批文件。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-host-home-'))

// 0.1.7：行 config 经真 cordis resolveConfig 解析（Config 的 volatile 顶层字段换活访问器）
const ROW_CONFIG = resolvedHostConfig({})

function mockHostCtx({ llm, settings, toolsRegistry } = {}) {
  const listeners = new Map()
  const panel = createPanelRpcTransport()
  const service = settings ?? createSettingsStub()
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'settings') return service
      if (name === 'tools') return toolsRegistry
      if (name === 'connection') return panel.connection
      if (name === 'webServer') return panel.webServer
      return undefined
    },
    on: (event, fn) => { listeners.set(event, fn) },
    // 面板通道替身（F1）：lib 半在 inject(['connection','webServer']) 里直注册
    // webServer prefix route，测试经 panel.rpc 打完整 HTTP 壳（鉴权 + 信封真跑）。
    inject: panel.inject,
  }
  return { ctx, listeners, panel, rpc: panel.rpc }
}

const readBothHalves = () => Promise.all([
  readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
  readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
])
// 健康度批：子代理侧八张登记表的定义已抽入 shared/child-registry.mjs，
// 反向 parity 的「状态族」断言因此有了第三个源文件。
const readChildRegistry = () => readFile(new URL('../preset/shared/child-registry.mjs', import.meta.url), 'utf-8')
// 5.3 拆分波：dispatcher/persona-bootstrap/工具注册块的本体随簇迁入同级
// broker-*.mjs，源码归属断言随之多三枚源锚。
const readRelayCluster = () => readFile(new URL('../preset/tools/broker-relay.mjs', import.meta.url), 'utf-8')
const readBootstrapCluster = () => readFile(new URL('../preset/tools/broker-bootstrap.mjs', import.meta.url), 'utf-8')
const readToolsCluster = () => readFile(new URL('../preset/tools/broker-tools.mjs', import.meta.url), 'utf-8')
// 5.4 拆分波：调度核 / end 管线两簇同款源锚（互递归环与双向回调注入的归属断言
// 见下方 5.4 专条；随波换钉的既有锚点只迁家、不降级）。
const readSchedulerCluster = () => readFile(new URL('../preset/tools/broker-scheduler.mjs', import.meta.url), 'utf-8')
const readEndingCluster = () => readFile(new URL('../preset/tools/broker-ending.mjs', import.meta.url), 'utf-8')
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
// 5.3 拆分波：注册块本体迁入 ./broker-tools.mjs（agent 半的组成部分，身份不变），
// 四枚工具名标记换钉 home='tools'。5.4 拆分波：调度核（dispatchWork /
// advanceQueue / startContinuable 所在的 spawn 出口）与 end 管线（end-attribution
// 消费面）随簇换钉 'scheduler' / 'ending'。负向闸从「tools 专属」扩为
// **home ≠ broker 即本体零回潮**：本体只在接线处引用工厂产物，定义与消费体
// 回流本体即红。
const ORCHESTRATION_IDENTITY = [
  ["name: 'go_work'", 'tools'],
  ["name: 'orchestration_status'", 'tools'],
  'new Orchestration(',
  ['async function dispatchWork(', 'scheduler'],
  ['function advanceQueue(', 'scheduler'],
  ['startContinuable', 'scheduler'],
  "ctx.on('subagent/end'",
  'orchestration-ledger.json',
  'shared/orchestration.mjs',
  'createChildRegistry',
  // end 归因决策（0.3.0-tisitan.12 B5）同属编排身份：lib 半既不该有这个决策，
  // 也不该出现对它 import 的可能性——真主只在天上的 broker 一处（5.4 起
  // dispatcher 本体随 end 簇，import 与消费同迁 './broker-ending.mjs'）。
  ['shared/end-attribution.mjs', 'ending'],
  ['attributeEnd(', 'ending'],
  // report_submit（0.4.0 线 1.3）同属编排面工具：子代面向的上报通道，注册块
  // 与 deny 闸名单都是 broker 独有，lib 半出现即为回归。
  ["name: 'report_submit'", 'tools'],
  // report_fetch（0.4.0 线 1.6）同上：主编面向的读板通道 + 子代 deny 闸名单。
  ["name: 'report_fetch'", 'tools'],
]

// ── ① 反向 parity 主断言：lib 零编排面 + broker 独有面保留 ────────────────

test('lib 半零编排面（反向 parity）：编排身份标记 grep=0，broker 半全量在册', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  const toolsSrc = await readToolsCluster()
  const schedulerSrc = await readSchedulerCluster()
  const endingSrc = await readEndingCluster()
  const halfSrcs = { broker: brokerSrc, tools: toolsSrc, scheduler: schedulerSrc, ending: endingSrc }
  const registrySrc = await readChildRegistry()
  // 「本体零回潮」按去注释后的代码体核（5.2/5.3 成环闸同口径）：头注释与接线
  // 注释里讲迁移史、引用协议出处（如 shared/end-attribution.mjs 的决策归属
  // 说明），拿注释当回潮面会一改措辞就假红。
  const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n')
  const brokerCode = codeOnly(brokerSrc)
  for (const entry of ORCHESTRATION_IDENTITY) {
    const [marker, home] = Array.isArray(entry) ? entry : [entry, 'broker']
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(halfSrcs[home], marker) >= 1, `broker 半在册（home=${home}）: ${marker}`)
    if (home !== 'broker') assert.equal(countOf(brokerCode, marker), 0, `本体已随簇迁出，broker 本体零回潮: ${marker}`)
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
  // lib 半：0.1.7 声明式配置面（顶层 Config）+ RPC 单通道全端点
  assert.ok(countOf(hostSrc, "export { Config } from './config.js'") >= 1, 'lib 半顶层转出 Config（0.1.7 声明式配置面唯一入口）')
  assert.equal(countOf(hostSrc, 'settings.installSection('), 0, 'installSection 随 0.1.7 契约退役，不得复活')
  assert.equal(countOf(hostSrc, 'settings.register('), 0, '老宿主回落姿态一并退役（单模式 0.1.7，不留双姿态）')
  assert.ok(countOf(hostSrc, 'settings.configure(') >= 1, '关自动页经子 fiber 的 inject 调 configure')
  assert.equal(countOf(hostSrc, "ctx.on('loader/volatile-update'"), 1, '热更监听单点（0.1.7 事件）')
  assert.equal(countOf(hostSrc, 'path: PANEL_CHANNEL'), 1, 'lib 半面板通道经 webServer 直注册（唯一注册点）')
  assert.equal(countOf(hostSrc, "rpc.handle('/dsh-my-go'"), 0, '宿主缺陷面 connection.rpc.handle 不得复活（0.1.5-alpha.1 下通道静默失踪）')
  // 批次 4+6 端点收口后，lib 半分发比较改为 PANEL_ENDPOINTS.*（shared/constants
  // 单源）；正向 needle 同步换口径，负向仍盯字面量分发形态不许复活。
  for (const endpoint of ['snapshot', 'listTools', 'getBuiltinPersona', 'getUsage']) {
    assert.equal(countOf(hostSrc, `endpoint === PANEL_ENDPOINTS.${endpoint}`), 1, `lib 半保留端点: ${endpoint}`)
  }
  // 设置面三端点随配置页迁官方 configForms 退役：留负向，混合通道不许复活
  for (const endpoint of ['loadSettings', 'saveSettings', 'listModels']) {
    assert.equal(countOf(hostSrc, `endpoint === '${endpoint}'`), 0, `端点已退役，不得复活: ${endpoint}`)
  }
  assert.ok(countOf(hostSrc, "Symbol.for('dsh-my-go.snapshot')") >= 1, 'lib 半消费快照桥')
  // broker 半：经全局桥只读配置段、零 RPC，快照桥唯一发布者
  assert.equal(countOf(brokerSrc, 'settings.register('), 0, 'broker 半不注册 settings（只读）')
  assert.equal(brokerHalf.inject.includes('settings'), false, 'broker 半 inject 不含 settings（服务门禁声明面）')
  assert.equal(countOf(brokerSrc, 'ctx.get(\'settings\')'), 0, 'broker 半不再 ctx.get settings（配置段只经全局桥）')
  assert.ok(countOf(brokerSrc, "Symbol.for('dsh-my-go.bindings')") >= 1, 'broker 半经配置桥读段')
  assert.ok(countOf(brokerSrc, "Symbol.for('dsh-my-go.bindings-revision')") >= 1, 'broker 半经段版本号驱动缓存失效（N9/N10）')
  assert.equal(countOf(brokerSrc, 'rpc.handle('), 0, 'broker 半零 RPC 端点')
  assert.equal(countOf(brokerSrc, 'webServer.register('), 0, 'broker 半零 webServer 路由注册（通道唯一归属 lib 半）')
  assert.ok(countOf(brokerSrc, "globalThis[Symbol.for('dsh-my-go.snapshot')]") >= 1, 'broker 半发布快照桥')
})

// ── ①c 无行为档覆盖的共享通路：按 C-10 口径降级为「在册 >=1」──────────────
// 这十一条都是「走共享实现还是走本地副本」这类跨模块事实，任何 mock 行为测试都
// 观察不到差别（副本与原件行为一样，直到某天只改一边）。所以保留最弱的存在性
// 标记 + lib 半零残留；原先 ~50 条精确计数与整行字面量复刻已退役，逐条去向见
// CHANGELOG 0.3.0-tisitan.11 的映射表。
const BROKER_ONLY_PATHWAYS = [
  ['sharedRolePersona(', '内置人设现读走 shared（两侧各抄一份 = prompts/ 档案与派发人设分叉）', 'scheduler'],
  ['sharedResolveRoleToolFilter(', '角色工具过滤现算走 shared（漏一处 = 派发时不再按活目录降级）', 'scheduler'],
  ['resolveEffectiveBinding(', '备选覆盖合并走 shared（手抄合并规则是备选泄漏给常规派发的温床）', 'broker'],
  ['spawnChild(', '派发组合子唯一出口（另起 spawn 路径 = 绕开 restrict 与台账登记）', 'scheduler'],
  ['attemptFallbackRedeploy(', '备选重派入口（终局落账与重派共用同一决策点）', 'ending'],
  ['abortExpected.delete(', 'N6 护航消费（只加不删 = 从此吞掉该 child 的一切真失败）', 'ending'],
  ['fallbackDecided.add(', '备选 once-guard 登记（不登记则同一 child 双发 end 各重派一次）', 'ending'],
  ['pendingFallbackByLabel.set(', '棒2-Z2 spawn 解析前的 pending 备选登记', 'ending'],
  // 5.2 拆分波：投递链三件的本体随簇迁入 ./broker-delivery.mjs，通路在册断言
  // 随波改钉到簇模块（语义不降级——「这条通路存在且只有一份」原样成立，只是
  // 唯一出处换了文件；lib 半零残留一律照旧逐条核）。
  ['findRecordWithLedgerFallback(', '台账兜底查找通路（属主不在内存表时就无路可寻）', 'delivery'],
  ['abortExpected.add(', 'N6 预期掐断护航登记（不登记则主动中断被误判真失败）', 'delivery'],
  ['belongs to another live orchestration session', '跨会话抢属主闸（continue / forward 任一侧失守都是串台）', 'delivery'],
]

test('host/broker 接线分界：共享通路降级为存在性在册，两半无本地重定义（源码断言）', async () => {
  const [brokerSrc, hostSrc, deliverySrc, schedulerSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-delivery.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-scheduler.mjs', import.meta.url), 'utf-8'),
  ])
  const endingSrc = await readEndingCluster()
  const homes = { broker: brokerSrc, delivery: deliverySrc, scheduler: schedulerSrc, ending: endingSrc }
  for (const [marker, why, home] of BROKER_ONLY_PATHWAYS) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(homes[home], marker) >= 1, `${home} 半在册（${why}）: ${marker}`)
  }
  // 合并语义两半都不得有本地定义（负向不变量，唯一出处 shared/misc.mjs）
  assert.equal(countOf(hostSrc, 'function resolveEffectiveBinding'), 0, 'lib 半无本地定义')
  assert.equal(countOf(brokerSrc, 'function resolveEffectiveBinding'), 0, 'broker 半无本地定义')
  // 名册键集薄壳：两半各自的共享接线（RPC 花名册 / 派发入口都吃它），存在即可
  // （5.4 拆分波：broker 侧薄壳本体随调度簇迁入 ./broker-scheduler.mjs，bindings
  // 改 getBindings 现读后接线形态从 `sharedRosterKeys(bindings)` 变为
  // `sharedRosterKeys(getBindings())`——换钉调用本体，「走 shared 单源」的语义不降级）
  assert.ok(countOf(hostSrc, 'sharedRosterKeys(bindings)') >= 1, 'lib 半名册键集接线在册')
  assert.ok(countOf(schedulerSrc, 'sharedRosterKeys(') >= 1, '调度簇名册键集接线在册')
})

// ── 0.3.0-tisitan.8 lib/client 修复批的在册 pin ─────────────────────────────────
// 同 0.3.0-tisitan.7 的纪律：只锁「修复在册」这一事实。本批六条都属静默失效型
// （少一行日志、少一枚闸，运行期什么都不报错），回潮时没有任何东西会来提醒。

test('lib 半本批修复在册（源码断言）：留痕/失败隔离/参数化安装/裁剪/信封合规', async () => {
  const hostSrc = await readFile(new URL('../lib/index.js', import.meta.url), 'utf-8')
  // E1/B-02（0.1.7 改判）：读面失败留痕单点仍在；注册失败那条随注册面整体退役
  assert.equal(countOf(hostSrc, 'console.error(`[dsh-my-go] settings readout failed'), 1, 'E1 读面失败独立留痕单点')
  assert.equal(countOf(hostSrc, 'settings namespace registration failed'), 0, '注册面退役后该留痕点一并退役')
  assert.ok(countOf(hostSrc, 'sectionOf(') >= 1, '行 config 的 volatile 访问器即读面（宿主挂 base，本半不再自算）')
  // 0.1.7 退役面（安装同步安装器整条）：$DSH_HOME/.agent-presets 已无代码读取
  for (const retired of ['installPreset', 'ensurePresetInstalled', 'presetInstallRoot', 'BROKER_CLUSTER_ROSTER', 'syncTreeFilewise', 'presetTreeDigest', 'const marker = ']) {
    assert.equal(countOf(hostSrc, retired), 0, `安装面退役后不得复活：${retired}`)
  }
  assert.equal(countOf(hostSrc, 'await cp('), 0, 'B-09 无差别整拷不得复活（机制整体退役）')
  // E5/A-02：快照出口裁剪在册（定义 + 出口消费，只钉「在不在」）
  assert.equal(countOf(hostSrc, 'const PANEL_HISTORY_TAIL = 8'), 1, 'E5 面板 history 末 8 裁剪')
  assert.ok(countOf(hostSrc, 'trimSnapshotForPanel(') >= 1, 'E5 裁剪通路在册')
  // B-10（0.1.7 改判）：getBuiltinPersona 单一来源 = 包内 prompts/（安装副本候选退役）
  assert.equal(countOf(hostSrc, "join(PACKAGE_ROOT, 'prompts'"), 1, 'B-10 人设读盘单点：包内 prompts/')
  assert.equal(countOf(hostSrc, 'installedPresetRoot('), 0, '安装副本候选路径退役')
  // E9/B-07 → F1 换壳：rpc.handle 的 arity 探测随宿主缺陷面一起退役（现在连
  // rpc.handle 都不再调），注册点的唯一性由上方 P2 钉，此处只钉新壳在册。
  assert.ok(countOf(hostSrc, 'createPanelRpcHandler(') >= 1, 'F1 通道壳（鉴权直出 + 信封封装）在册')
  assert.equal(countOf(hostSrc, 'rpcHandleExtras'), 0, 'rpc.handle arity 探测随缺陷面退役')
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
  const [clientSrc, panelSrc] = await Promise.all([
    readFile(new URL('../src/client.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/panel-tree.js', import.meta.url), 'utf-8'),
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
  // （批次 4+6 'legacy' 串收口后，needle 换成常量引用形态，语义不变）
  assert.equal(countOf(panelSrc, 'p.parentSessionId !== LEGACY_PARENT_ID'), 1, 'A-04 legacy 幽灵父区被过滤')
  assert.equal(countOf(panelSrc, 'hlp-${h.parentSessionId}-${h.id ?? i}'), 1, 'A-08 求助行 key 用求助单 id')
  assert.equal(countOf(panelSrc, 'if (panelOpen) force((c) => c + 1)'), 1, 'A-09 30s 相对时间刷新受面板开关约束')
})

test('0.3.0-tisitan.9 设置页加固在册（源码断言）：dirty 汇聚 / revision 围栏 / 可手填 / 结构化名册', async () => {
  const [coreSrc, guardSrc, panelSrc, hostSrc, brokerSrc, paneSrc] = await Promise.all([
    readFile(new URL('../src/settings-core.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/settings-guard.js', import.meta.url), 'utf-8'),
    readFile(new URL('../src/panel-tree.js', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../src/roles-editor.js', import.meta.url), 'utf-8'),
  ])
  // ── dirty 汇聚：一处置位，两个编辑区也不例外（E6/A-03 语义原样搬进草稿层）
  assert.equal(countOf(coreSrc, 'const stage ='), 1, 'dirty 只有唯一汇聚口（定义唯一归属）')
  assert.equal(countOf(coreSrc, 'setDraft:'), 0, 'pane 不得再吃裸 setDraft（漏一处就是偏心 dirty，比没有更坏）')
  assert.ok(countOf(coreSrc, 'setDraft(null)') >= 1, '复位通路在册（保存成功 / 丢弃草稿各一处）')
  // hook 必须排在渲染之前：早退若换到 hook 之前，hook 数量会随快照态变化（React 硬约束）
  assert.ok(
    coreSrc.indexOf('React.useEffect(() => {\n    if (!dirty)') < coreSrc.indexOf("el('section', { className: 'mygo-config'"),
    'beforeunload hook 不得掉到渲染之后',
  )
  assert.ok(countOf(coreSrc, 'attachBeforeUnloadGuard') >= 1, '守卫挂载在册')
  // ── 并发写围栏：栅栏 = 草稿建立那一刻的 revision，且写面必证伪
  assert.ok(countOf(coreSrc, "scope.mutate(ops, typeof fence === 'number' ? fence : undefined)") === 1, '保存带栅栏（无栅栏凭据时不塞假版本）')
  assert.ok(countOf(coreSrc, 'writeLanded(') >= 1, '写完读回判落盘（官方信道被拒不抛，try/catch 判冲突等于骗人）')
  assert.ok(countOf(coreSrc, 'describeSaveOutcome(') >= 1, '回执文案出自读回判定，不是 promise 兑现')
  // ── 退役面负向：旧 RPC 设置通道与「保存并关闭」不得复活
  assert.equal(countOf(coreSrc, "'loadSettings'"), 0, '读面不再走私有 RPC（字符串字面量口径，文档注释不算）')
  assert.equal(countOf(coreSrc, "'saveSettings'"), 0, '写面不再走私有 RPC')
  assert.equal(countOf(coreSrc, 'interpretSaveResult('), 0, '信封归一函数随端点一起退役')
  assert.equal(countOf(coreSrc, 'saveAndClose'), 0, 'settings.section 的 close affordance 随入口一起退役')
  // ── 目录与名单：非设置数据仍走插件自有端点
  assert.ok(countOf(coreSrc, 'getBuiltinPersona') >= 1, '人设文件读取仍是插件自有端点')
  assert.ok(countOf(coreSrc, 'listTools') >= 1, '工具花名册仍是插件自有端点')
  // ── A-06 可手填 + 渠道失败区分（编辑器已迁到 roles-editor.js 的详情面板）
  assert.equal(countOf(paneSrc, 'function combobox('), 1, 'input+datalist 组合框定义唯一')
  assert.ok(countOf(paneSrc, "el('datalist'") >= 1, '清单在场时仍可点选')
  assert.equal(countOf(paneSrc, "'select', { value: row.provider"), 0, 'provider 裸 select 不得复活（否则手填承诺再次落空）')
  assert.equal(countOf(paneSrc, "'select', { value: row.model"), 0, 'model 裸 select 不得复活')
  assert.ok(countOf(paneSrc, 'listErrorFor') >= 1, '渠道级失败提示通路在册（目录缺席与空清单可分）')
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
  const [brokerSrc, hostSrc, rolesSrc, bootstrapSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../lib/index.js', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/shared/roles.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-bootstrap.mjs', import.meta.url), 'utf-8'),
  ])
  // 渲染器单一源：shared 定义 1 处（唯一归属，留）；消费侧只钉「import 别名在册 +
  // 真的在调用它」——旧版钉 `sharedRenderRosterBriefing` 出现 2 次（import + 消费），
  // 那是把「调用点数量」当不变量，多一处合法复用就假红（C-10 P3）。调用点用带括号的
  // 形态区分（import 行是 `sharedRenderRosterBriefing,`，调用是 `sharedRenderRosterBriefing(`），
  // 于是「只 import 不用」这种真回归仍然红。5.3 拆分波：roster 段注册随 persona 三段
  // 迁入 ./broker-bootstrap.mjs（agent 半组成部分，「broker 独有」语义不变），
  // 消费断言随波换钉簇源；lib 半零残留照旧。
  assert.equal(rolesSrc.split('export function renderRosterBriefing').length - 1, 1, 'shared roles.mjs 单点定义')
  assert.ok(bootstrapSrc.includes('sharedRenderRosterBriefing'), 'bootstrap 簇 import 共享渲染器')
  assert.ok(/sharedRenderRosterBriefing\s*\(/.test(bootstrapSrc), 'bootstrap 簇真的调用它（不是 import 完就搁置）')
  assert.equal(hostSrc.split('renderRosterBriefing').length - 1, 0, 'lib 半不注册系统提示段（与 persona/orchestration 同为 broker 独有）')
  // 注册形态：同名重注册会抛错，故 name 出现次数即注册数（唯一归属，保留）；
  // order 的具体数值是排版选择不是不变量（C-10 P4：计数退役，行为档 failure-notice
  // 已断言 def.order 存在且 persona/orchestration 三段共存）
  assert.equal(bootstrapSrc.split("name: 'dsh-my-go:roster'").length - 1, 1, 'bootstrap 簇注册 1 处')
  assert.equal(brokerSrc.split("name: 'dsh-my-go:roster'").length - 1, 0, '段注册本体已迁簇，broker 本体零回潮')
  assert.equal(hostSrc.split('dsh-my-go:roster').length - 1, 0, 'lib 半零注册')
  assert.ok(!/"dsh-my-go:roster"[^}]*complete:\s*true/s.test(bootstrapSrc), 'roster 段不得携带 complete:true（bootstrap 簇）')
  assert.ok(!/"dsh-my-go:roster"[^}]*complete:\s*true/s.test(brokerSrc), 'roster 段不得携带 complete:true（broker 本体回潮形态）')
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
    // 5.1 拆分后的 broker 本地簇模块同受「import 目标存在 + 落在安装目录内」
    // 断言保护。台账簇自带 3 行 shared import（constants/misc/relay-chain），
    // 下限 ≥2；通知/能力两簇零 shared 依赖（依赖全注入），不进本清单。
    ['broker-ledger', 'preset/tools/', 'broker-ledger.mjs', '../shared/', 2],
    // 5.2 波：投递链簇自带三行 shared import（constants/orchestration/adjacent——
    // 纯函数层直引，注入的是活状态与服务句柄），下限 ≥2；宽限期两簇（dispose /
    // endbuffer）零 shared 依赖（全部注入），同 notify/capability 不进本清单。
    ['broker-delivery', 'preset/tools/', 'broker-delivery.mjs', '../shared/', 2],
    // 5.3 波：dispatcher 簇自带三行 shared import（report-format/board/
    // relay-chain——纯函数层直引），bootstrap 簇两行（misc/roles），工具注册块
    // 八行（constants/misc/roles/adjacent/board/report-format/orchestration/
    // relay-chain）——下限统一 ≥2，三件同时受「安装目录在册」保护（白名单漏拷
    // 任一新簇 = 用户侧挂载当场 MODULE_NOT_FOUND，本表是发布面最后闸）。
    ['broker-relay', 'preset/tools/', 'broker-relay.mjs', '../shared/', 2],
    ['broker-bootstrap', 'preset/tools/', 'broker-bootstrap.mjs', '../shared/', 2],
    ['broker-tools', 'preset/tools/', 'broker-tools.mjs', '../shared/', 2],
    // 5.4 波：调度核五行 shared import（constants/roles/misc/orchestration/
    // report-format——纯函数层直引，注入的是活状态与服务句柄），end 管线七行
    // （failure/archive/adjacent/misc/board/report-format/end-attribution）——
    // 下限统一 ≥2，两件同受「安装目录在册」保护。
    ['broker-scheduler', 'preset/tools/', 'broker-scheduler.mjs', '../shared/', 2],
    ['broker-ending', 'preset/tools/', 'broker-ending.mjs', '../shared/', 2],
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
  // 消费通路（subagent/end 处理器内的附因归一）只在 broker 侧（5.4 波起
  // readTurnFailure 随 end 管线簇迁入 ./broker-ending.mjs，换钉簇源）；lib 已无编排面
  const [brokerSrc, hostSrc] = await readBothHalves()
  const endingSrc = await readEndingCluster()
  assert.equal(countOf(hostSrc, 'const failure = normalizeTurnFailure(ev.data.reason.error)'), 0, 'lib 半无附因提取通路（随编排面切除）')
  assert.ok(countOf(endingSrc, 'normalizeTurnFailure(') >= 1, 'end 簇有附因归一通路（readTurnFailure 随簇）')
  const sharedArchiveSrc = await readFile(new URL('../preset/shared/archive.mjs', import.meta.url), 'utf-8')
  assert.ok(sharedArchiveSrc.split('const failure = normalizeTurnFailure(ev.data.reason.error)').length - 1 >= 1, 'shared archive.mjs 内提取通路在册')
})

test('跨半工种名单 parity：client AGENT_TYPES 恒等于 sisyphus + shared AGENT_TYPES（顺序敏感）', () => {
  assert.equal(CLIENT_AGENT_TYPES.length, 9, '客户端名单 9 项（编排者单例 + 8 可派工种）')
  assert.deepEqual(CLIENT_AGENT_TYPES, ['sisyphus', ...SHARED_AGENT_TYPES], '客户端半不得自会长工种或换序')
})

// 键名 pattern parity（0.5.0-tisitan.3 批次 2）：ROLE/PRICE 两枚键名正则唯一
// 归属 preset/shared/constants.mjs。回潮形态是客户端半再抄一份字面量——历史上
// settings-core 的本地 PRICE_KEY_PATTERN（model 段禁 /）就与 shared（放行
// OpenRouter 式 model 段）实际漂移：lib schema 与 settings-ops 读面按 shared
// 语义放行的键被配置页新建行守卫拒绝。同源断言收 roster-rows/usage-price-rows
// 的 re-export 面（同一 RegExp 对象，严格相等即证同源）；settings-core 是直引
// 不 re-export，行为面测不到，按 :394 metrics 先例降级为源码断言。
test('跨半键名 pattern parity：ROLE/PRICE_KEY_PATTERN 唯一归属 shared，settings-core 零第二份字面量', async () => {
  assert.equal(ROSTER_ROLE_PATTERN, SHARED_ROLE_PATTERN, 'roster-rows 的 ROLE_KEY_PATTERN 必须与 shared 同一对象（不得自抄字面量）')
  assert.equal(ROWS_PRICE_PATTERN, SHARED_PRICE_PATTERN, 'usage-price-rows 的 PRICE_KEY_PATTERN 必须与 shared 同一对象（不得自抄字面量）')
  const coreSrc = await readFile(new URL('../src/settings-core.js', import.meta.url), 'utf-8')
  for (const marker of ['const PRICE_KEY_PATTERN', 'const ROLE_KEY_PATTERN']) {
    assert.equal(countOf(coreSrc, marker), 0, `settings-core 零本地第二份: ${marker}`)
  }
  assert.ok(countOf(coreSrc, "from '../preset/shared/constants.mjs'") >= 1, 'settings-core 直引 shared 常量在册')
})

// ── 观测面分界（0.4.0-tisitan.0 步骤 0.1）：metrics 模块为 broker 独有 ───────
// preset/tools/metrics.mjs 刻意不进 shared（只有 broker 半消费，避免无谓扩大
// 单源守卫面），但「broker 本地」不等于「无守卫」：回潮形态是观测面被抄进 lib
// 半，或 broker 侧接线被整体搬走。按 C-10 口径降级为在册弱标记（>=1，计数不是
// 不变量——埋点随观测面扩张合法增长）；接线的行为档由 test/metrics.test.mjs 兜。
test('metrics 观测面为 broker 独有（源码断言）：模块与接线不入 lib 半', async () => {
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const marker of ["from './metrics.mjs'", 'createMetrics(', 'METRICS.record(']) {
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.ok(countOf(brokerSrc, marker) >= 1, `broker 半在册: ${marker}`)
  }
})

// ── broker 拆分 5.1（三簇落位）：本体唯一归属 broker-*.mjs，broker.mjs 只留接线 ──
// 对齐 child-registry / board / relay-chain 的「唯一登记处 + 两半零残留」口径：
// 台账/通知/能力三个内聚簇的本体随 5.1 波迁入 preset/tools/broker-*.mjs
// （工厂函数 + 依赖显式注入），broker.mjs 的导出面与全部调用点保持逐名不变。
// 三簇的行为档由 bridge / compat-alpha4 / failure-notice 等既有用例持有，
// 此处只锁归属与接线在册。
test('broker 拆分 5.1：台账/通知/能力三簇本体落位 broker-ledger/notify/capability.mjs（源码断言）', async () => {
  const [ledgerSrc, notifySrc, capSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker-ledger.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-notify.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-capability.mjs', import.meta.url), 'utf-8'),
  ])
  const [brokerSrc, hostSrc] = await readBothHalves()
  // 本体唯一归属：每个定义恰好一处（随簇所在模块），lib 与 broker.mjs 零残留
  for (const [src, home, marker] of [
    [ledgerSrc, 'broker-ledger.mjs', 'async function loadLedger('],
    [ledgerSrc, 'broker-ledger.mjs', 'function ledgerPayload('],
    [ledgerSrc, 'broker-ledger.mjs', 'function writeLedgerSync('],
    [ledgerSrc, 'broker-ledger.mjs', 'function scheduleLedgerSave('],
    [ledgerSrc, 'broker-ledger.mjs', 'async function findRecordWithLedgerFallback('],
    [ledgerSrc, 'broker-ledger.mjs', 'const isLedgerRow ='],
    [notifySrc, 'broker-notify.mjs', 'function notifyParent('],
    [notifySrc, 'broker-notify.mjs', 'function resolveParentAgent('],
    [notifySrc, 'broker-notify.mjs', 'function notifyOwner('],
    [notifySrc, 'broker-notify.mjs', 'function notifyClearedHelp('],
    [capSrc, 'broker-capability.mjs', 'async function supportedEfforts('],
    [capSrc, 'broker-capability.mjs', 'async function modelExists('],
  ]) {
    assert.equal(countOf(src, marker), 1, `${home} 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker.mjs 无本地定义（唯一归属 ${home}）: ${marker}`)
  }
  // 接线在册：broker.mjs 以工厂实例化三簇（依赖显式注入），lib 半零残留
  for (const factory of ['createLedgerOps(', 'createNotifyOps(', 'createCapabilityOps(']) {
    assert.ok(countOf(brokerSrc, factory) >= 1, `broker 半接线在册: ${factory}`)
    assert.equal(countOf(hostSrc, factory), 0, `lib 半零残留: ${factory}`)
  }
})

// ── broker 拆分 5.2（宽限期两簇 + 投递链簇落位）：同 5.1 口径 ────────────────────
// E2 缓冲簇 / disposed 宽限期兜底簇 / M1-M5 投递链簇的本体随 5.2 波迁入同级
// broker-*.mjs（工厂函数 + deps 显式注入），broker.mjs 的导出面与全部调用点逐名
// 不变。除「唯一登记处 + 两半零残留 + 接线在册」三条同款断言外，本波另加两条：
//   ① 簇模块零回引 broker.mjs（拆分总原则的成环防线：单向 broker → 簇）；
//   ② 两枚宽限期簇的卸载收尾确实经簇导出的 clear* 走（旧版手删 Map 的形态不得复活）。
test('broker 拆分 5.2：E2 缓冲/dispose 兜底/投递链三簇本体落位 broker-endbuffer/dispose/delivery.mjs（源码断言）', async () => {
  const [endbufferSrc, disposeSrc, deliverySrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker-endbuffer.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-dispose.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-delivery.mjs', import.meta.url), 'utf-8'),
  ])
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const [src, home, marker] of [
    [endbufferSrc, 'broker-endbuffer.mjs', 'function bufferEnd('],
    [endbufferSrc, 'broker-endbuffer.mjs', 'function claimBufferedEnd('],
    [endbufferSrc, 'broker-endbuffer.mjs', 'function auditStaleSpawningPlaceholders('],
    [endbufferSrc, 'broker-endbuffer.mjs', 'const endBuffer = new Map()'],
    [endbufferSrc, 'broker-endbuffer.mjs', 'const endBufferTimers = new Map()'],
    [disposeSrc, 'broker-dispose.mjs', 'function cancelDisposeFallback('],
    [disposeSrc, 'broker-dispose.mjs', 'function scheduleDisposeFallback('],
    [disposeSrc, 'broker-dispose.mjs', 'const disposeFallbackTimers = new Map()'],
    [deliverySrc, 'broker-delivery.mjs', 'async function resolveContinueTarget('],
    [deliverySrc, 'broker-delivery.mjs', 'async function tryFacadeSteer('],
    [deliverySrc, 'broker-delivery.mjs', 'function interruptForAbort('],
    [deliverySrc, 'broker-delivery.mjs', 'async function deliverWithQueueFallback('],
    [deliverySrc, 'broker-delivery.mjs', 'function rearmAfterDelivery('],
    [deliverySrc, 'broker-delivery.mjs', 'const coordinatorSource ='],
  ]) {
    assert.equal(countOf(src, marker), 1, `${home} 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker.mjs 无本地定义（唯一归属 ${home}）: ${marker}`)
  }
  for (const factory of ['createEndBufferOps(', 'createDisposeFallbackOps(', 'createDeliveryOps(']) {
    assert.ok(countOf(brokerSrc, factory) >= 1, `broker 半接线在册: ${factory}`)
    assert.equal(countOf(hostSrc, factory), 0, `lib 半零残留: ${factory}`)
  }
  // ① 成环防线：三个新簇模块一律零回引 broker.mjs（依赖单向 broker → 簇）；
  // 铁律「零 ctx / 零服务解析」按去注释后的代码体核（注释里讲的是原实现读法，
  // 拿注释当消费面会一改措辞就假红）。
  const stripComments = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n')
  for (const [raw, home] of [[endbufferSrc, 'broker-endbuffer.mjs'], [disposeSrc, 'broker-dispose.mjs'], [deliverySrc, 'broker-delivery.mjs']]) {
    const src = stripComments(raw)
    assert.equal(countOf(src, "from './broker.mjs'"), 0, `${home} 不回引 broker.mjs（成环即断）`)
    assert.equal(countOf(src, 'ctx.'), 0, `${home} 零 ctx（服务面经回调注入）`)
  }
  // ② 投递链的兄弟簇件经注入而非 import：delivery 模块只 import shared 纯函数层
  assert.equal(countOf(deliverySrc, "from './broker-ledger.mjs'"), 0, 'findRecordWithLedgerFallback 是工厂产物，注入不可 import（回潮形态=抄第二份工厂）')
  assert.equal(countOf(deliverySrc, "from './broker-notify.mjs'"), 0, 'notifyParent/resolveParentAgent 同上')
  // E2 头尾穿越的落点：原「broker.mjs 两个登记同步段 + processEnd」三处，5.4 波
  // 起随调度核 / end 簇换钉新归属（直派认领点 → broker-scheduler 的 dispatchWork，
  // 重派认领点与缓冲闸 / end 入口自撤 → broker-ending）——「三处都在，缺一条即
  // E2 重放面失守」的原语义不降级；行为档仍由 test/end-buffer.test.mjs 的
  // T1/T2/T6 三条实测兜住。
  const schedulerSrc52 = await readSchedulerCluster()
  const endingSrc52 = await readEndingCluster()
  assert.ok(countOf(schedulerSrc52, 'const buffered = claimBufferedEnd(childId)') >= 1, '直派登记段认领点在册（dispatchWork）')
  assert.ok(countOf(endingSrc52, 'claimBufferedEnd(newChildId)') >= 1, '重派登记段认领点在册（attemptFallbackRedeploy）')
  assert.ok(countOf(endingSrc52, 'bufferEnd(childId, info)') >= 1, '缓冲闸落点在册（processEnd）')
  assert.ok(countOf(endingSrc52, 'cancelDisposeFallback(childId)') >= 1, 'end 入口自撤兜底在册（processEnd）')
  assert.ok(countOf(brokerSrc, 'scheduleDisposeFallback(') >= 1, 'disposed 挂兜底在册（agent/disposed）')
  // 卸载收尾走簇导出的 clear*（手删 Map 的旧形态不得复活）
  assert.ok(countOf(brokerSrc, 'clearDisposeFallbackTimers()') >= 1 && countOf(brokerSrc, 'clearEndBuffer()') >= 1, '宽限期两簇的卸载收尾接线在册')
  for (const marker of ['disposeFallbackTimers', 'endBufferTimers', 'endBuffer']) {
    assert.equal(countOf(brokerSrc, `${marker}.clear()`), 0, `broker.mjs 不再手清簇内表: ${marker}`)
  }
})

// ── broker 拆分 5.3（dispatcher / persona-bootstrap / 工具注册块落位）：同 5.1/5.2 口径 ──
// 接力链 dispatcher（broker-relay）/ prompt 加载与三段注册与 DSV4P0813
// （broker-bootstrap）/ 十具工具注册体与 agent/created 双侧闸（broker-tools）随
// 5.3 波迁入同级 broker-*.mjs（工厂 + deps 显式注入），broker.mjs 的导出面与全部
// 调用点逐名不变。除「唯一登记处 + 两半零残留 + 接线在册」三条同款外，本波把
// 5.2 钉成的两闸扩到三件新簇并补第三闸口径：
//   ① 零回引 broker.mjs + 零 ctx（碰 ctx 的动作经 broker 侧回调包壳注入，簇内
//      只做纯组装——派工单指定的自洽解法，bootstrap 簇是全案的试金石）；
//   ② 簇间零互引（跨簇协作一律经 broker.mjs 接线注入，import './broker-*' 出现
//      即为成环回潮）；
//   ③ 卸载走 clear*：relay 簇持有的反查表经 clearChainHops 簇口回收（bootstrap/
//      tools 两簇实读无可清状态——promptCache 与挂载实例同寿、晋升表 WeakMap、
//      注册面随 ctx 作用域回收，口径自证写在两模块头注释）。
test('broker 拆分 5.3：dispatcher/persona-bootstrap/工具注册块三簇本体落位 broker-relay/bootstrap/tools.mjs（源码断言）', async () => {
  const [relaySrc, bootstrapSrc, toolsSrc] = await Promise.all([
    readFile(new URL('../preset/tools/broker-relay.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-bootstrap.mjs', import.meta.url), 'utf-8'),
    readFile(new URL('../preset/tools/broker-tools.mjs', import.meta.url), 'utf-8'),
  ])
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const [src, home, marker] of [
    [relaySrc, 'broker-relay.mjs', 'async function composeRelayPrompt('],
    [relaySrc, 'broker-relay.mjs', 'async function landHopOps('],
    [relaySrc, 'broker-relay.mjs', 'function relayAdvanceHops('],
    [relaySrc, 'broker-relay.mjs', 'function relayChainOnEnd('],
    [relaySrc, 'broker-relay.mjs', 'async function runChainTransition('],
    [relaySrc, 'broker-relay.mjs', 'function chainDeclarationError('],
    [relaySrc, 'broker-relay.mjs', 'function resolveChainFallback('],
    [relaySrc, 'broker-relay.mjs', 'const chainHopsByWork = new Map()'],
    [relaySrc, 'broker-relay.mjs', 'function backfillHopOnArrival('],
    [relaySrc, 'broker-relay.mjs', 'function handleQueueWorkDropped('],
    [relaySrc, 'broker-relay.mjs', 'function releaseHopHolds('],
    [relaySrc, 'broker-relay.mjs', 'function clearChainHops('],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'async function readPromptFile('],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'async function loadPrompt('],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'const promptCache = new Map()'],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'const personaSectionText ='],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'const PROMOTED_BY_SESSION = new WeakMap()'],
    [bootstrapSrc, 'broker-bootstrap.mjs', 'function promotionStateFor('],
    [toolsSrc, 'broker-tools.mjs', 'function denyTools('],
    [toolsSrc, 'broker-tools.mjs', 'function orchForStatus('],
    [toolsSrc, 'broker-tools.mjs', 'function renderChainLines('],
    // 名册行投影用「函数名 + 体首行 sharedRosterEntries(getBindings()) 消费形态」
    // 的复合 marker 钉 tools 簇归属——裸函数名在 lib 半有合法的 deprecated 文本镜像
    // （兼容期保留，吃同一份 shared 单源），整行形态不会误伤它。
    [toolsSrc, 'broker-tools.mjs', 'function renderRosterLines() {\n    return [\'── 角色名册（roster） ──\', ...sharedRosterEntries(getBindings())'],
  ]) {
    assert.equal(countOf(src, marker), 1, `${home} 唯一登记处: ${marker.slice(0, 40)}…`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker.slice(0, 40)}…`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker.mjs 无本地定义（唯一归属 ${home}）: ${marker.slice(0, 40)}…`)
  }
  for (const factory of ['createRelayOps(', 'createBootstrapOps(', 'registerAllTools({']) {
    assert.ok(countOf(brokerSrc, factory) >= 1, `broker 半接线在册: ${factory}`)
    assert.equal(countOf(hostSrc, factory), 0, `lib 半零残留: ${factory}`)
  }
  // ① 成环防线 + 零 ctx：三件新簇一律不回引 broker.mjs、代码体不碰 ctx（去注释
  // 核——注释讲的是原实现读法与 ctx 包壳背景，拿注释当消费面会一改措辞就假红）
  const stripComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n')
  for (const [raw, home] of [[relaySrc, 'broker-relay.mjs'], [bootstrapSrc, 'broker-bootstrap.mjs'], [toolsSrc, 'broker-tools.mjs']]) {
    const src = stripComments(raw)
    assert.equal(countOf(src, "from './broker.mjs'"), 0, `${home} 不回引 broker.mjs（成环即断）`)
    assert.equal(countOf(src, 'ctx.'), 0, `${home} 零 ctx（服务面经回调注入）`)
    // ② 簇间零互引：工厂产物不可 import，跨簇协作必须经 broker 接线（回潮形态 =
    // 抄第二份工厂或簇簇互锁成网）
    assert.equal(countOf(src, "from './broker-"), 0, `${home} 零互引兄弟簇（跨簇协作走接线注入）`)
  }
  // ③ 卸载走 clear*：relay 反查表经簇口回收，broker 本体零裸操作
  assert.ok(countOf(brokerSrc, 'clearChainHops()') >= 1, 'relay 簇卸载收尾接线在册（ctx.effect → clear*）')
  for (const marker of ['chainHopsByWork.set(', 'chainHopsByWork.delete(', 'chainHopsByWork.get(']) {
    assert.equal(countOf(brokerSrc, marker), 0, `broker.mjs 不再裸操作反查表: ${marker}`)
  }
  // 三个调用点在册（5.4 波换钉归属不降级）：回填与队列放弃随 dispatchWork /
  // scheduleQueueRetry 迁入调度簇（物理顺序契约见上方 relay-chain 条），
  // 反查表释放在 session/disposed（本体留守件）
  const schedulerSrc53 = await readSchedulerCluster()
  assert.ok(countOf(schedulerSrc53, 'backfillHopOnArrival(queuedWork, childId)') >= 1, 'hop 回填调用点在册（dispatchWork 登记同步段）')
  assert.ok(countOf(schedulerSrc53, 'handleQueueWorkDropped(orch, work, error)') >= 1, '队列放弃链感知调用点在册（scheduleQueueRetry）')
  assert.ok(countOf(brokerSrc, 'releaseHopHolds(orch)') >= 1, '反查表同点清调用点在册（session/disposed）')
  // persona/bootstrap 的 ctx 包壳件接线形态自检：section/effect/on 以箭头回调注入
  assert.ok(countOf(brokerSrc, "registerSection: (def) => ctx.systemPrompt.section(def)") >= 1, 'bootstrap 段注册包壳在册')
  assert.ok(countOf(brokerSrc, "getSectionOrder: (key) => ctx.systemPrompt?.getSectionOrder?.(key)") >= 1, '宿主代探针包壳在册（可选链语义原样）')
  // 注册块四件服务面回调 + agent/created 闸随簇迁移后仍由 apply 接线
  assert.ok(countOf(brokerSrc, "registerTool: (tool) => ctx.tools.register(tool)") >= 1, '工具注册包壳在册')
  assert.ok(countOf(brokerSrc, 'getAgentTools: (agent) => agent.ctx.tools') >= 1, 'deny 闸 agent 工具面取值点留本体（N12 抛错路径进簇内同一个 try）')
  // 条件注册联动：十具名逐具在册（注册体只此一份实现，计数语义 = 存在性弱标记）
  for (const tool of ['go_work', 'continue', 'need_help', 'forward', 'orchestration_status', 'list_subagents', 'report_submit', 'report_fetch', 'chain_start', 'chain_resolve']) {
    assert.ok(countOf(toolsSrc, `name: '${tool}'`) >= 1, `tools 簇十具注册体逐具在册: ${tool}`)
  }
})

// ── broker 拆分 5.4（调度核 / end 管线落位 + 留守裁决自证）：同 5.1–5.3 口径 ──────
// dispatchWork / advanceQueue / scheduleQueueRetry / queueRetryTimers / 名册路由
// 薄壳 / spawnChild / 停摆可观测随调度核迁入 ./broker-scheduler.mjs；processEnd /
// finalizeEnd / attemptFallbackRedeploy / attemptReportRepair / readTurnFailure /
// pickFallbackEntry 随 end 管线迁入 ./broker-ending.mjs（工厂 + deps 显式注入，
// broker.mjs 导出面与全部调用点逐名不变）。本波另立三条专属闸：
//   ① 互递归环闭合：advanceQueue↔dispatchWork 两成员唯一归属同在一模块——
//      「跨模块环」这一形态定义上不存在；
//   ② 双向注入 seam 在册：调度簇对 end/relay/endbuffer 的包壳闭包与 end 簇
//      对调度簇的直传件都在 broker 接线段可数——相互回调注入（5.2 波 E2 同手法）
//      的接线形状本体自证；
//   ③ 留守裁决自证：persistReportBoard 定义唯一留本体（5.3 B2），两簇只以注入
//      件消费；bump 定义与快照桥发布留本体（5.4 裁决，纪律文本在 broker 文件头）。
test('broker 拆分 5.4：调度核/end 管线两簇本体落位 broker-scheduler/ending.mjs（源码断言）', async () => {
  const [schedulerSrc, endingSrc] = await Promise.all([readSchedulerCluster(), readEndingCluster()])
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const [src, home, marker] of [
    [schedulerSrc, 'broker-scheduler.mjs', 'const QUEUE_RETRY_MAX = 3'],
    [schedulerSrc, 'broker-scheduler.mjs', 'const queueRetryTimers = new Map()'],
    [schedulerSrc, 'broker-scheduler.mjs', 'function scheduleQueueRetry('],
    [schedulerSrc, 'broker-scheduler.mjs', 'function advanceQueue('],
    [schedulerSrc, 'broker-scheduler.mjs', 'async function dispatchWork('],
    [schedulerSrc, 'broker-scheduler.mjs', 'async function spawnChild('],
    [schedulerSrc, 'broker-scheduler.mjs', 'function buildStallNotice('],
    [schedulerSrc, 'broker-scheduler.mjs', 'function clearQueueRetryTimers('],
    [schedulerSrc, 'broker-scheduler.mjs', 'function cancelQueueRetryTimer('],
    [endingSrc, 'broker-ending.mjs', 'function readTurnFailure('],
    [endingSrc, 'broker-ending.mjs', 'async function pickFallbackEntry('],
    [endingSrc, 'broker-ending.mjs', 'function finalizeEnd('],
    [endingSrc, 'broker-ending.mjs', 'async function attemptFallbackRedeploy('],
    [endingSrc, 'broker-ending.mjs', 'async function attemptReportRepair('],
    [endingSrc, 'broker-ending.mjs', 'function processEnd('],
  ]) {
    assert.equal(countOf(src, marker), 1, `${home} 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker.mjs 无本地定义（唯一归属 ${home}）: ${marker}`)
  }
  // ① 互递归环闭合：两成员同模块同定义（上方唯一归属已各钉 1 处），环内调用
  //    点也必须落在同一模块体内——advanceQueue 派发、dispatchWork 双出口补位、
  //    scheduleQueueRetry 消化，三处互指全在 broker-scheduler.mjs。
  assert.ok(countOf(schedulerSrc, 'void dispatchWork(work.agentType') >= 1, '环边 advanceQueue→dispatchWork 在册（同模块）')
  assert.ok(countOf(schedulerSrc, 'advanceQueue(orch, parent)') >= 1, '环边 dispatchWork→advanceQueue 在册（同模块）')
  assert.ok(countOf(schedulerSrc, 'advanceQueue(orch, parentHint)') >= 1, '环边 scheduleQueueRetry→advanceQueue 在册（同模块）')
  // 接线在册：两簇以工厂实例化（依赖显式注入），lib 半零残留
  for (const factory of ['createSchedulerOps(', 'createEndingOps(']) {
    assert.ok(countOf(brokerSrc, factory) >= 1, `broker 半接线在册: ${factory}`)
    assert.equal(countOf(hostSrc, factory), 0, `lib 半零残留: ${factory}`)
  }
  // ② 双向注入 seam 在册（相互回调的包壳半边在 broker 接线段可数）：调度簇正
  //    向消费 end 簇 processEnd 与 endbuffer/relay 三件的闭包、end 簇反向消费
  //    调度簇 advanceQueue 直传 + relay 两件的闭包。缺一即「环拆开跨模块」回潮。
  for (const seam of [
    'processEnd: (info) => processEnd(info)',
    'claimBufferedEnd: (childId) => claimBufferedEnd(childId)',
    'backfillHopOnArrival: (queuedWork, childId) => relay.backfillHopOnArrival(queuedWork, childId)',
    'handleQueueWorkDropped: (orch, work, error) => relay.handleQueueWorkDropped(orch, work, error)',
    'relayChainOnEnd: (orch, ownerPid, childId, payload) => relay.relayChainOnEnd(orch, ownerPid, childId, payload)',
    'resolveChainFallback: (orch, childId, verdict) => relay.resolveChainFallback(orch, childId, verdict)',
  ]) {
    assert.ok(countOf(brokerSrc, seam) >= 1, `双向注入 seam 在册: ${seam}`)
  }
  assert.ok(countOf(brokerSrc, 'advanceQueue,') >= 2, 'end/relay 簇对调度簇 advanceQueue 的直传接线在册')
  // ③ 留守裁决自证：落板底座与快照枢纽定义仍在本体，两簇只以注入件消费。
  assert.equal(countOf(brokerSrc, 'async function persistReportBoard('), 1, 'persistReportBoard 定义留守本体（5.3 B2 裁定维持）')
  assert.equal(countOf(schedulerSrc, 'async function persistReportBoard('), 0, '调度簇零副本')
  assert.equal(countOf(endingSrc, 'async function persistReportBoard('), 0, 'end 簇零副本')
  assert.ok(countOf(endingSrc, 'persistReportBoard(') >= 3, '补发链三处兜底消费在册（注入件调用）')
  assert.equal(countOf(brokerSrc, 'const bump = () =>'), 1, 'bump 快照枢纽定义留守本体（5.4 裁决）')
  assert.ok(countOf(brokerSrc, "globalThis[Symbol.for('dsh-my-go.snapshot')]") >= 1, '快照桥发布留守本体')
  // 成环防线三闸（5.3 扩编同款）：两新簇零回引 broker.mjs、代码体零 ctx、零互引
  // 兄弟簇——调度↔end 的双向边只活在本体接线的闭包里，模块图无环。
  const stripComments54 = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n')
  for (const [raw, home] of [[schedulerSrc, 'broker-scheduler.mjs'], [endingSrc, 'broker-ending.mjs']]) {
    const src = stripComments54(raw)
    assert.equal(countOf(src, "from './broker.mjs'"), 0, `${home} 不回引 broker.mjs（成环即断）`)
    assert.equal(countOf(src, 'ctx.'), 0, `${home} 零 ctx（服务面经回调注入）`)
    assert.equal(countOf(src, "from './broker-"), 0, `${home} 零互引兄弟簇（跨簇协作走接线注入）`)
  }
  // 卸载走 clear*：队列重试表经簇口回收，broker 本体零裸操作（手清 Map 形态不得复活）
  assert.ok(countOf(brokerSrc, 'clearQueueRetryTimers()') >= 1, '调度簇卸载收尾接线在册（ctx.effect → clear*）')
  assert.ok(countOf(brokerSrc, 'cancelQueueRetryTimer(orch)') >= 1, '属主会话销毁同点摘除在册（session/disposed 走簇口）')
  for (const marker of ['queueRetryTimers']) {
    assert.equal(countOf(brokerSrc, `${marker}.clear()`), 0, `broker.mjs 不再手清簇内表: ${marker}`)
    assert.equal(countOf(brokerSrc, `${marker}.delete(`), 0, `broker.mjs 不再裸删簇内表: ${marker}`)
    assert.equal(countOf(brokerSrc, `${marker}.get(`), 0, `broker.mjs 不再裸读簇内表: ${marker}`)
  }
})

// ── S-1 导出面机器闸（5.4 裁决）：broker.mjs 导出 16 键逐名快照 ────────────────
// 「批次 5 拆分总原则：导出面逐名不变」长期是文本承诺——本闸把它钉成机器闸：
// 任何一波迁移误删/改名/新增本体导出（含 re-export 面）当场红。清单为 5.4 收口
// 时实读：name / inject / apply 三枚本体件 + 13 枚 shared re-export。
test('S-1 broker 导出面快照闸：16 键逐名 + inject 值锁定（import(broker) 对拍）', async () => {
  const mod = await import('../preset/tools/broker.mjs')
  const expected = [
    'Orchestration', 'apply', 'canQueueAdjacent', 'deliverToAdjacent', 'describeAgent',
    'encodeSegment', 'inject', 'isFallbackable', 'name', 'normalizeTurnFailure',
    'projectKey', 'pruneLedgerParents', 'readArchivedTurnFailure', 'reportToParent',
    'resolveEffectiveBinding', 'sessionEvents',
  ].sort()
  assert.deepEqual(Object.keys(mod).sort(), expected, 'broker.mjs 导出面逐名不变（S-1 机器闸）')
  // inject 值对拍（追记波补）：它是 cordis 的服务门禁声明面——漏声明一枚，簇内
  // 对应回调在挂载期 ctx.get 静默拿到 undefined，比改名更难发现。合法变更（增删
  // 依赖服务）时的更新方式：改 broker.mjs 的 `export const inject`，然后把新值逐名
  // 抄进下面的清单。两侧各自 sort 后比对：清单里手写顺序错了也不会假红。
  // 0.1.7：settings 摘除（preset 面无可配置条目，配置段改经宿主半的全局桥读）
  const expectedInject = [
    'tools', 'subagents', 'systemPrompt', 'llm', 'agents', 'sessions',
  ]
  assert.ok(Array.isArray(mod.inject), 'inject 是数组（cordis 声明面形状不变）')
  assert.deepEqual([...mod.inject].sort(), [...expectedInject].sort(), 'broker.mjs inject 值逐名不变（S-1 机器闸）')
})

// ── board 存储层（0.4.0 线步骤 1.1）：定义唯一归属 shared/board.mjs ──────────
// 「唯一登记处」断言不要求消费方在场（child-registry 先例）。1.3 report_submit
// 接线后 broker 消费在册已兑现（import + writeBoard 调用）；1.6 report_fetch
// 接线后 read 侧 readBoardSlice 调用在册同步兑现（下方第三枚 >=1 标记）。
test('board 存储层定义唯一归属（源码断言）：本体单点、两半零残留', async () => {
  const boardSrc = await readFile(new URL('../preset/shared/board.mjs', import.meta.url), 'utf-8')
  const [brokerSrc, hostSrc] = await readBothHalves()
  const relaySrc = await readRelayCluster()
  const toolsSrc = await readToolsCluster()
  for (const marker of ['function writeBoard', 'function readBoardSlice', 'function boardRoot']) {
    assert.equal(countOf(boardSrc, marker), 1, `board.mjs 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker 半无本地定义（唯一归属 shared）: ${marker}`)
  }
  // 1.3 兑现：broker 侧消费在册（import 行 + 调用点各 >=1，计数不是不变量）。
  // 5.3 拆分波：report_submit / report_fetch 的 execute 体随注册块迁入
  // ./broker-tools.mjs，composeRelayPrompt 的直投读板迁入 ./broker-relay.mjs——
  // 消费在册按「broker 本体 + 两簇」合并源核（通路仍只有一份 shared 实现，
  // 「两处读 = report_fetch 切片 + 落板兜底探测」的原语义不因换文件而稀释）。
  assert.ok(countOf(brokerSrc, "from '../shared/board.mjs'") >= 1, 'broker 消费在册: board import')
  assert.ok(countOf(brokerSrc, 'writeBoard(') >= 1, 'broker 消费在册: writeBoard 调用（落板兜底 persistReportBoard）')
  assert.ok(countOf(brokerSrc, 'writeBoard(') + countOf(toolsSrc, 'writeBoard(') >= 2, '落板两路（兜底 + report_submit）各自在册')
  const readSliceSites = countOf(brokerSrc, 'readBoardSlice(') + countOf(relaySrc, 'readBoardSlice(') + countOf(toolsSrc, 'readBoardSlice(')
  assert.ok(readSliceSites >= 2, `读板 >=2 路在册（report_fetch 切片 + 直投/hop/落板探测，实际 ${readSliceSites}）`)
  // 存储层必须走 shared/archive.mjs 的既有段编码（复用而非手抄第二份转义算法）
  assert.ok(countOf(boardSrc, "from './archive.mjs'") >= 1, '段编码复用 archive.mjs 既有实现（唯一出处）')
})

// ── 报告提交制单源（0.5.0 线）：定义唯一归属 shared/report-format.mjs ────────
// 同 board 条形态：定义唯一归属 + 两半无本地定义；提交制接线后 broker 消费在册
// （REPORT_CLAUSE 注入 spawnChild + validateReportArgs 校验 report_submit 六字段）。
test('报告提交制单源定义唯一归属（源码断言）：本体单点、两半零残留', async () => {
  const formatSrc = await readFile(new URL('../preset/shared/report-format.mjs', import.meta.url), 'utf-8')
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const marker of ['function validateReportArgs', 'function buildOwnerSummary', 'const REPORT_CLAUSE']) {
    assert.equal(countOf(formatSrc, marker), 1, `report-format.mjs 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker 半无本地定义（唯一归属 shared）: ${marker}`)
  }
  // 条款注入与六字段校验消费在册（>=1 非计数）。5.4 拆分波：REPORT_CLAUSE 的
  // spawnChild 注入点随调度簇迁入 ./broker-scheduler.mjs（直派/重派共用唯一组装
  // 点，「一处追加两路同覆盖」的事实 C 不变），六字段校验仍在 tools 簇——
  // 「条款与校验器同形、只此一份实现」的原语义不因换文件而稀释（lib 半零残留照旧）。
  const schedulerSrcFmt = await readSchedulerCluster()
  assert.ok(countOf(schedulerSrcFmt, "from '../shared/report-format.mjs'") >= 1, '调度簇消费在册: report-format import')
  assert.ok(countOf(schedulerSrcFmt, 'REPORT_CLAUSE') >= 1, '调度簇消费在册: REPORT_CLAUSE 注入（spawnChild）')
  // 5.3 拆分波：字段校验随注册块迁入 ./broker-tools.mjs、RELAY_CLAUSE 的 hop
  // 注入随 composeRelayPrompt 迁入 ./broker-relay.mjs——消费在册随波换钉簇源，
  // 「条款与校验器同形、只此一份实现」的原语义不变（lib 半零残留照旧）。
  const relaySrcForFormat = await readRelayCluster()
  const toolsSrcForFormat = await readToolsCluster()
  assert.ok(countOf(toolsSrcForFormat, 'validateReportArgs(') >= 1, 'tools 簇消费在册: report_submit 六字段校验')
  assert.ok(countOf(toolsSrcForFormat, 'buildReportBoard(') >= 1, 'tools 簇消费在册: 落板拼装 buildReportBoard')
  // 3.6 兑现：RELAY_CLAUSE 消费在册（链 hop prompt 的下游验收条款注入）
  assert.ok(countOf(relaySrcForFormat, 'RELAY_CLAUSE') >= 1, 'relay 簇消费在册: RELAY_CLAUSE 注入（composeRelayPrompt）')
  // 补发口径同源（0.5.0-tisitan.4 字段化批）：end-attribution 只许引用
  // REPORT_REPAIR_CLAUSE_HINT，不得自带第二份字段清单——旧「一次交齐四字段」那行
  // 就是活体第二源（条款六字段化后它让施工层补交轮被闸门二次拒收），负向钉死不许回潮。
  const endAttrSrcForFormat = await readFile(new URL('../preset/shared/end-attribution.mjs', import.meta.url), 'utf-8')
  assert.ok(countOf(endAttrSrcForFormat, 'REPORT_REPAIR_CLAUSE_HINT') >= 1, 'end 归因消费在册: 补发字段口径引同源常量')
  assert.equal(countOf(endAttrSrcForFormat, '一次交齐'), 0, 'end-attribution 零自带字段清单（第二源即回归）')
})

// ── 接力链状态机（0.4.0 线步骤 3.2/3.3）：定义唯一归属 shared/relay-chain.mjs ──
// 同 board 条形态。3.2 交付纯模块（无消费方）时只锁本体单点；3.3 链声明入口
// 接线后 broker 消费在册（import + advanceChain/createChain 调用）一并兑现——
// 下方三枚 >=1 标记即 3.2 留下的在册承诺。链的「决策在纯函数、dispatcher 在
// broker」分界由该文件头调用方协议注释与行为档（relay-chain.test.mjs +
// relay-chain-tools.test.mjs）持有，此处只锁归属。
test('接力链状态机定义唯一归属（源码断言）：本体单点、两半零残留、broker 消费在册', async () => {
  const chainSrc = await readFile(new URL('../preset/shared/relay-chain.mjs', import.meta.url), 'utf-8')
  const [brokerSrc, hostSrc] = await readBothHalves()
  for (const marker of ['function advanceChain', 'function createChain', 'function matchChainForEnd', 'function normalizeRestoredChain', 'function validateChainDeclaration']) {
    assert.equal(countOf(chainSrc, marker), 1, `relay-chain.mjs 唯一登记处: ${marker}`)
    assert.equal(countOf(hostSrc, marker), 0, `lib 半零残留: ${marker}`)
    assert.equal(countOf(brokerSrc, marker), 0, `broker 半无本地定义（唯一归属 shared）: ${marker}`)
  }
  // 3.3 兑现：消费在册（决策/建链/回填调用点各 >=1，计数不是不变量）。5.3 拆分波：
  // dispatcher 本体随簇迁入 ./broker-relay.mjs（直引 shared 决策件，与 5.1/5.2
  // 各簇「纯函数层直引」同律），chain_start/chain_resolve 的声明校验与建链面随
  // 注册块迁入 ./broker-tools.mjs——import 与调用点断言随波换钉两簇源，
  // 「决策在纯函数、dispatcher 只落地」的分界不降级；broker 本体对整条
  // relay-chain import 归零（回潮形态=dispatcher 逻辑回流本体，由唯一归属专条反钉）。
  const relaySrcForChain = await readRelayCluster()
  const toolsSrcForChain = await readToolsCluster()
  assert.ok(countOf(relaySrcForChain, "from '../shared/relay-chain.mjs'") >= 1, 'relay 簇消费在册: relay-chain import')
  assert.ok(countOf(brokerSrc, "from '../shared/relay-chain.mjs'") === 0, 'relay-chain 决策件 import 已整体迁簇，broker 本体零残留')
  assert.ok(countOf(relaySrcForChain, 'advanceChain(') >= 1, 'relay 簇消费在册: advanceChain 决策调用（runChainTransition/landHopOps/落账感知）')
  // 3.4 兑现：reconcileHopDispatch 升级为调用点断言——回填经簇口
  // backfillHopOnArrival 消费，调用点必须出现在 dispatchWork 登记同步段、且物理
  // 位于 claimBufferedEnd 之前（§4.2-① 时序契约；5.4 波起 dispatchWork 随调度核
  // 迁入 ./broker-scheduler.mjs，同模块内相对顺序不变——R11 探针（relay-chain-relay
  // 的挪位实测）继续在行为面咬住，源码面按新归属核物理顺序）。
  assert.ok(countOf(relaySrcForChain, 'reconcileHopDispatch(') >= 1, 'relay 簇消费在册: reconcileHopDispatch（backfillHopOnArrival 本体）')
  const schedulerSrcForChain = await readSchedulerCluster()
  const backfillAt = schedulerSrcForChain.indexOf('backfillHopOnArrival(queuedWork, childId)')
  const claimAt = schedulerSrcForChain.indexOf('const buffered = claimBufferedEnd(childId)')
  assert.ok(backfillAt > -1 && claimAt > -1 && backfillAt < claimAt, '回填先于 E2 认领（dispatchWork 内物理顺序 = 时序契约本体）')
  // 泳道判定复用（设计文档 §八预埋）：链模块 import orchestration 的 laneOf，
  // 不手抄第二份 read/write 判定表
  assert.ok(countOf(chainSrc, "from './orchestration.mjs'") >= 1, 'laneOf 复用 orchestration.mjs 判定表（唯一出处）')
})

// ── ①b 降级形态语义：snapshot 桥缺席 = preset 未装配 → 空态 + 花名册常驻 ──

test('snapshot RPC：preset 未装配（无桥）回落降级空态，桥在席读 broker 实况', async () => {
  const bridgeKey = Symbol.for('dsh-my-go.snapshot')
  const hadBridge = Object.prototype.hasOwnProperty.call(globalThis, bridgeKey)
  const prevBridge = globalThis[bridgeKey]
  try {
    delete globalThis[bridgeKey]
    const { ctx, rpc } = mockHostCtx({})
    await host.apply(ctx, ROW_CONFIG)
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
  assert.ok(host.Config !== undefined, 'schema 由顶层 Config 声明（0.1.7），宿主直接读它')
  const parsed = resolvedHostConfig({ roles: { hermes: { provider: 'a', model: 'b', fallbacks: [{ provider: 'x', model: 'y' }] } } })
  assert.deepEqual(parsed.roles.get().hermes.fallbacks, [{ provider: 'x', model: 'y' }], 'schema 接受 fallbacks 且保持数组形状')
  assert.deepEqual(parsed.roles.get().hermes.toolFilter, { allow: [], deny: [] }, '未给的字段取 schema 默认（宿主解析语义）')
})

test('写面：fallbacks 空数组转 unset，非空数组原样 set', () => {
  const ops = buildSettingsOps({
    hermes: { fallbacks: [] },
    oracle: { fallbacks: [{ provider: 'p1', model: 'm1' }] },
  }, layersOf({ roles: { hermes: { fallbacks: [{ provider: 'x', model: 'y' }] }, oracle: {} } }))
  assert.deepEqual(
    ops.filter((o) => o.path[1] === 'hermes' && o.path[2] === 'fallbacks'),
    [{ op: 'unset', path: ['roles', 'hermes', 'fallbacks'] }],
    '空数组与空字符串同语义：unset',
  )
  assert.deepEqual(
    ops.filter((o) => o.path[1] === 'oracle' && o.path[2] === 'fallbacks'),
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

test('lib 半 listTools：花名册返回全局工具名且滤保留名（mock 注册表）', async () => {
  const { ctx, rpc } = mockHostCtx({
    toolsRegistry: {
      schemas: () => [
        { name: 'read', description: '', parameters: {} },
        { name: 'run_code', description: '', parameters: {} },
        { name: 'mcp__demo__alpha', description: '', parameters: {} },
        { name: 'mcp__demo__beta', description: '', parameters: {} },
      ],
    },
  })
  await host.apply(ctx, ROW_CONFIG)
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, ['mcp__demo__alpha', 'mcp__demo__beta', 'read'], '保留名 run_code 不返回，名单排序去重')
})

test('lib 半 listTools：tools 服务缺席回落空名单（ok:true）', async () => {
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, ROW_CONFIG)
  const res = await rpc('/dsh-my-go', 'listTools', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, [], '设置页降级为纯编辑器而非报错')
})

// ── 内置卡「载入文件默认」（0.2.3-tisitan.16b）：getBuiltinPersona RPC 端点 ────

test('lib 半 getBuiltinPersona：正常读取 / 非法 type / 目录穿越 / 文件缺失全结构化', async () => {
  // 0.1.7：读盘根 = 包内 prompts/（安装副本这条候选随机制退役），故断言的是包内
  // 真档案原文——直读磁盘、不走缓存。
  const { ctx, rpc } = mockHostCtx({})
  await host.apply(ctx, ROW_CONFIG)
  const ok = await rpc('/dsh-my-go', 'getBuiltinPersona', { type: 'hermes' })
  assert.equal(ok.ok, true)
  const hermesPrompt = await readFile(new URL('../prompts/hermes.md', import.meta.url), 'utf-8')
  assert.deepEqual(ok.value, { type: 'hermes', persona: hermesPrompt }, '直读包内磁盘原文返回')
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

// ── 界面层（0.2.3-tisitan.14）：写面的 persona/toolFilter 显式字段 + 角色删除 ──
// （0.5.0-tisitan.3 起这套 ops 编译从 lib 半闭包搬到 src/settings-ops.js，判据不变）

test('写面：draft.roles 行显式携带 persona/toolFilter 时 set/unset，空=unset', () => {
  const ops = buildSettingsOps({
    roles: {
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X 人设', toolFilter: { allow: ['read', ''], deny: [] } },
      'custom-y': { persona: '' },
    },
  }, layersOf({ roles: { 'custom-x': { provider: 'p9', model: 'm9' } } }))
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

test('写面：旧形状/内置提升行不带 persona/toolFilter 字段 → 完全不触碰', () => {
  const ops = buildSettingsOps({
    sisyphus: { provider: 'ps', persona: '不该被写进任何地方' },
    hermes: { provider: 'p1', persona: '顶级工种键 persona' },
    roles: { hermes: { provider: 'p1' } },
  }, layersOf({ roles: { hermes: { provider: 'p1' } } }))
  assert.equal(ops.filter((o) => o.path.includes('persona')).length, 0, '无显式 persona 字段 = 零 persona ops')
  assert.equal(ops.filter((o) => o.path.includes('toolFilter')).length, 0, '无显式 toolFilter 字段 = 零 toolFilter ops')
  assert.equal(ops.filter((o) => o.path[0] === 'sisyphus' && o.path[1] === 'persona').length, 0, 'sisyphus 恒不触碰 persona')
})

test('写面：draft 提供 roles dict 时缺失的非内置键整键 unset；draft 无 roles 键不清册', () => {
  const stored = { sisyphus: {}, roles: { 'custom-x': { provider: 'p9' }, 'custom-y': {}, hermes: { provider: 'p1' } } }
  const ops = buildSettingsOps({ roles: { 'custom-x': { provider: 'p9' } } }, layersOf(stored))
  assert.deepEqual(
    ops.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2),
    [{ op: 'unset', path: ['roles', 'custom-y'] }],
    'draft.roles 缺失的 custom-y 整键 unset；custom-x 存续；内置 hermes 不在删除面',
  )
  const legacy = buildSettingsOps({ hermes: { provider: 'p1' } }, layersOf(stored))
  assert.equal(
    legacy.filter((o) => o.op === 'unset' && o.path[0] === 'roles' && o.path.length === 2).length,
    0,
    '不带 roles 键 → 删除语义不启用，存量名册不被误清',
  )
})

test('读面回传形状：roles 原样附带 + 内置提升 + sisyphus 顶级（角色编辑器数据源）', () => {
  const draft = draftFromSection({
    sisyphus: { provider: 'ps' },
    roles: {
      hermes: { provider: 'p1', model: 'm1' },
      'custom-x': { provider: 'p9', model: 'm9', persona: 'X' },
    },
  })
  assert.equal(draft.roles['custom-x'].persona, 'X', 'roles 原样附带（编辑器数据源）')
  assert.equal(draft.hermes.model, 'm1', '内置提升回顶级')
  assert.equal(draft.sisyphus.provider, 'ps')
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
