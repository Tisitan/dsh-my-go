/**
 * 配置卡真实保存载荷 × 宿主侧校验（ 补测）。
 *
 * 立此文件的理由（真事故）： 的「主编缓存心跳」段在真宿主上保存失败，
 * 页面回「没落盘 · r0」。该现象对应**配置面版本偏斜**——插件半经 `import()` 装配，
 * Node 的 ESM 缓存按 URL 命中，改过的 lib/config.js 换不掉已启动进程里的
 * `fiber.runtime.Config`；宿主侧 volatile 闸拿那份旧 schema 判新段，抛
 * `Config field "keepAlive.enabled" is not volatile`，整次原子写入被拒。
 * 而当时的回归面只有「页面编译出的 ops 长什么样」（test/settings-ops.test.mjs）与
 * 「替身槽渲染出什么」（test/helpers/card-shot.mjs + 自制 React 替身）——**没有一条
 * 用例把真页面载荷送进真宿主校验器**，于是「页面写了一条宿主认不出的 op」这件事
 * 谁都没机会发现。本文件补的就是这一格：不是替身槽，是真 `SettingsForms.write()`。
 *
 * 被测两端都是真件：
 *   - 载荷端：src/settings-ops.js 的 draftFromSection + buildSettingsOps（浏览器
 *     dist/client.js 里跑的就是这两个函数，构建同源）；
 *   - 宿主端：@deepseek-ai/dsh-settings 的 SettingsForms（宿主半真正装配的那个类）
 *     + lib/config.js 的 Config（插件真 schema）。
 * 中间只替掉两个没有判据的 IO 面：configEditor（落盘/重解析）与 profileContext
 * （profile 路径），并按真 configEditor.edit 的可观察语义把 next 写回 entry。
 *
 * 三条钉：
 *   1. 五个顶层段各自的真载荷都能过宿主校验（含 fence 栅栏与读回形状）；
 *   2. 负控——宿主 schema 摘掉一段，同一份载荷必被拒且段版本不动：证明这枚校验器
 *      真的在判，而不是替身在放行（缺了负控，用例对「闸门失灵」是瞎的）；
 *   3. 读面判别位——声明的段在宿主现值里恒有值（schema 默认也解析进去），缺席即
 *      「宿主半没声明这一段」。页面据此把该块转只读（src/settings-guard.js
 *      hostServesSection + src/settings-core.js keepAliveServed），故这条判据本身
 *      也要钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context, resolveConfig } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'

import { Config } from '../lib/config.js'
import { KEEP_ALIVE_DEFAULTS } from '../preset/shared/constants.mjs'
import { buildSettingsOps, compareKey, draftFromSection, writeLanded } from '../src/settings-ops.js'
import { describeSaveOutcome, hostServesSection, unservedSections } from '../src/settings-guard.js'

const NS = 'dsh-my-go'

/** 宿主半装好的那枚 entry（`fiber.runtime.Config` 就是宿主 volatile 闸的判据源）。 */
function makeEntry(schema, config = {}) {
  const entry = {
    options: { id: NS, name: NS, config: structuredClone(config) },
    fiber: { uid: 'uid-contract', state: 2, runtime: { Config: schema }, ctx: { waterfall: (_fiber, _event, value) => value } },
  }
  entry.fiber.config = resolveConfig(entry.fiber.runtime, entry.options.config)
  return entry
}

/**
 * 一个最小但保真的宿主：真 SettingsForms + 真 configEditor 可观察语义
 * （edit 收到 change(raw, inherited)，把 next 落成 entry 的 config 并重解析）。
 * 临时 home 目录保证 importLegacyDocument 找不到 settings.yaml。
 */
function makeHost({ config = {}, schema = Config } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-contract-'))
  const entry = makeEntry(schema, config)
  const ctx = new Context()
  ctx.root.loader = { await: async () => {} }
  const profileContext = { home, dir: home, name: 'contract', patchPath: join(home, 'cordis.patch.yml'), installAnchor: home }
  ctx.provide('profileContext', profileContext)
  ctx.provide('configEditor', {
    documentPath: profileContext.patchPath,
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: structuredClone(entry.options.config ?? {}) }],
    async edit(target, change) {
      const next = change(structuredClone(target.options.config ?? {}), {})
      target.options.config = structuredClone(next)
      target.fiber.config = resolveConfig(target.fiber.runtime, target.options.config)
      return next
    },
  })
  const forms = new SettingsForms(ctx)
  return {
    forms,
    entry,
    home,
    view: () => forms.describe().find((row) => row.ns === NS),
    dispose: () => rmSync(home, { recursive: true, force: true }),
  }
}

/** 页面保存那三步（src/settings-core.js save() 的判据），原样复用真页面函数。 */
async function saveFromPage(host, draft) {
  const before = host.view()
  const layers = { value: before.value, base: before.base, user: before.user }
  const ops = buildSettingsOps(draft, layers)
  let thrown
  try {
    await host.forms.mutate(NS, ops, before.revision)
  } catch (error) {
    thrown = error
  }
  const after = host.view()
  const landed = thrown === undefined
    && writeLanded(draft, { value: before.value, base: before.base }, ops)
    && compareKey(draftFromSection(after.value)) === compareKey(draft)
  return { ops, thrown, before, after, landed }
}

const keepAliveOps = (ops) => ops.filter((op) => op.path[0] === 'keepAlive')

// ── 1. 五个顶层段的真载荷都过宿主校验 ──────────────────────────────────────

test('宿主契约：配置卡五个段的真保存载荷逐个过真 SettingsForms 校验（含版本推进与读回）', async () => {
  const host = makeHost()
  try {
    // 首读：宿主交出的现值形状（页面草稿就是从它投影出来的）
    const first = host.view()
    assert.equal(first.revision, 0, '首读段版本为 0（页面红字里的 r0 即此）')
    for (const key of ['sisyphus', 'roles', 'usagePrices', 'usageCurrency', 'keepAlive']) {
      assert.ok(key in first.value, `声明的段在宿主现值里恒有值：${key}`)
    }

    // (1) 心跳段：勾选开关 —— 事故现场那份载荷
    const draft = draftFromSection(host.view().value)
    draft.keepAlive.enabled = true
    const beat = await saveFromPage(host, draft)
    assert.equal(beat.thrown, undefined, `心跳载荷不得被宿主拒（真事件里这里抛 "not volatile"）：${beat.thrown && beat.thrown.message}`)
    assert.deepEqual(keepAliveOps(beat.ops), [{ op: 'set', path: ['keepAlive', 'enabled'], value: true }], '载荷形状：一条字段级 set')
    assert.equal(beat.landed, true, '读回判定已落盘（页面据此出「已保存」）')
    assert.equal(beat.after.revision, 1, '段版本推进 0 → 1')
    assert.equal(beat.after.value.keepAlive.enabled, true)

    // (2) 心跳三个时长：全字段（数字与数字串两种输入框原值）
    const timed = draftFromSection(host.view().value)
    timed.keepAlive.orchestratorIntervalMs = 600000
    timed.keepAlive.childPingAfterMs = '900000'
    timed.keepAlive.escalateAfterPings = '5'
    const beat2 = await saveFromPage(host, timed)
    assert.equal(beat2.thrown, undefined)
    assert.deepEqual(keepAliveOps(beat2.ops).map((op) => op.path[1]), ['orchestratorIntervalMs', 'childPingAfterMs', 'escalateAfterPings'])
    assert.equal(beat2.landed, true)
    assert.deepEqual(beat2.after.value.keepAlive, { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 600000, childPingAfterMs: 900000, escalateAfterPings: 5 })

    // (3) 单角色绑定（roles.<key>.<field>，与心跳同为「父段 volatile + 子路径」形状）
    const role = draftFromSection(host.view().value)
    role.oracle = { ...role.oracle, model: 'contract-model' }
    const bound = await saveFromPage(host, role)
    assert.equal(bound.thrown, undefined)
    assert.equal(bound.landed, true)
    assert.equal(bound.after.value.roles.oracle.model, 'contract-model')

    // (4) 币种 + (5) 单价表
    const prices = draftFromSection(host.view().value)
    prices.usageCurrency = 'CNY'
    prices.usagePrices = { 'contract/model': { input: 0.5, output: 2 } }
    const priced = await saveFromPage(host, prices)
    assert.equal(priced.thrown, undefined)
    assert.equal(priced.landed, true)
    assert.equal(priced.after.value.usageCurrency, 'CNY')
    assert.deepEqual(priced.after.value.usagePrices, { 'contract/model': { input: 0.5, output: 2 } })

    // 每一条 op 的根键都在 schema 的 volatile 面内（等价于「过了宿主 volatile 闸」）
    const roots = [...new Set([...beat.ops, ...beat2.ops, ...bound.ops, ...priced.ops].map((op) => op.path[0]))]
    assert.deepEqual([...roots].sort(), ['keepAlive', 'roles', 'usageCurrency', 'usagePrices', 'sisyphus'].filter((key) => roots.includes(key)).sort())
    for (const root of roots) assert.ok(Config.dict[root] !== undefined, `${root} 在插件顶层 schema 里`)
  } finally {
    host.dispose()
  }
})

test('宿主契约：栅栏（expectedRevision）过期必被宿主拒 —— 页面两义红字里的另一半原因', async () => {
  const host = makeHost()
  try {
    const draft = draftFromSection(host.view().value)
    draft.keepAlive.enabled = true
    assert.equal((await saveFromPage(host, draft)).landed, true, '先落一次，段版本 0 → 1')

    // 草稿建在 r0、他处（另一页签 / 手改 yaml）已把它推到 r1：写入带旧栅栏
    const stale = draftFromSection(host.view().value)
    stale.keepAlive.enabled = false
    const before = host.view()
    const ops = buildSettingsOps(stale, { value: before.value, base: before.base, user: before.user })
    let thrown
    try {
      await host.forms.mutate(NS, ops, 0)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown, '过期栅栏必抛（SettingsConflictError），不是静默接受')
    assert.equal(thrown.name, 'SettingsConflictError')
    assert.equal(thrown.expected, 0)
    assert.equal(thrown.actual, 1)
    assert.equal(host.view().revision, 1, '被拒的写入不推进段版本')
  } finally {
    host.dispose()
  }
})

// ── 2. 负控：摘掉一段，同一份载荷必被拒且段版本不动 ────────────────────────

test('宿主契约负控：宿主 schema 未声明 keepAlive 时，宿主必拒该路径、段版本停在 r0；页面不再发这条 op', async () => {
  // 复刻「已启动进程里的旧 schema」：配置面快照里没有 keepAlive 这一段
  // （正是插件模块改了、宿主进程没换掉 fiber.runtime.Config 时的真实状态）
  const staleSchema = new Schema(Config.toJSON())
  delete staleSchema.dict.keepAlive

  const host = makeHost({ schema: staleSchema })
  try {
    const first = host.view()
    assert.equal(first.revision, 0)
    assert.equal(hostServesSection(first.value, 'keepAlive'), false, '读面判别位：缺席 = 宿主半没声明这一段')
    assert.equal(hostServesSection(first.value, 'roles'), true, '对照组：同一次读数里 roles 在席')

    // 负控 A（宿主闸）：把事故现场那条 op 原样送进宿主 —— 必须抛、且段版本不动
    let thrown
    try {
      await host.forms.mutate(NS, [{ op: 'set', path: ['keepAlive', 'enabled'], value: true }], 0)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown, '宿主必须拒（负控：证明这枚校验器真在判，不是替身在放行）')
    assert.match(String(thrown.message), /keepAlive\.enabled.*is not volatile/, `真事件里宿主抛的就是这句：${thrown.message}`)
    assert.equal(host.view().revision, 0, '被拒 ⇒ 段版本停在 0，页面红字里的 r0')

    // 负控 B（页面闸，本次修正）：页面不再把未声明段的 op 送出去 —— 事故现场那次
    // 整批原子写入被这一条 op 连累，同一次点击里的其它改动一并陪葬
    const draft = draftFromSection(first.value)
    draft.keepAlive.enabled = true
    const attempt = await saveFromPage(host, draft)
    assert.deepEqual(keepAliveOps(attempt.ops), [], '宿主没声明这一段 ⇒ 一条 op 都不发')
    assert.equal(attempt.thrown, undefined, '留下的 ops 是合法的（这里为空集），宿主照常受理')
    assert.equal(attempt.landed, false, '草稿与现值仍不同形 ⇒ 页面判没落盘，并把真因写进回执')
    assert.equal(unservedSections(attempt.ops, [attempt.before.value, attempt.after.value]).length, 0, '空 ops 无需点名（没有哪一段被写）')
  } finally {
    host.dispose()
  }
})

test('宿主契约：未声明段的 op 若混进批量写入，页面的回执点名该段（而不是两义红字）', async () => {
  const staleSchema = new Schema(Config.toJSON())
  delete staleSchema.dict.keepAlive
  const host = makeHost({ schema: staleSchema })
  try {
    const before = host.view()
    // 老草稿（页面转只读之前建立的）仍带着心跳改动 —— 手编一条 op 复刻那一刻的载荷
    const ops = [{ op: 'set', path: ['keepAlive', 'enabled'], value: true }, { op: 'set', path: ['usageCurrency'], value: 'CNY' }]
    let thrown
    try {
      await host.forms.mutate(NS, ops, 0)
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown, '一条坏路径把整批写入拖死（原子性）')
    const after = host.view()
    assert.deepEqual(unservedSections(ops, [before.value, after.value]), ['keepAlive'], '只点名宿主真的没声明的那一段')
    const receipt = describeSaveOutcome(false, after.revision, unservedSections(ops, [before.value, after.value]))
    assert.match(receipt.text, /宿主未声明 keepAlive 段/)
    assert.match(receipt.text, /重启宿主/)
    assert.doesNotMatch(receipt.text, /或他处刚改过这一命名空间/, '点名得起的场合不再给两义文案')
    assert.equal(unservedSections([{ op: 'set', path: ['roles', 'oracle', 'model'], value: 'm' }], [{ roles: {} }]).length, 0, '在席的段不点名')
    assert.equal(unservedSections(null, [{ roles: {} }]).length, 0, '空 ops 不炸')
  } finally {
    host.dispose()
  }
})

// ── 3. 读面判别位的第二个方向 ─────────────────────────────────────────────

test('宿主契约：声明的段连空用户层也算在席（schema 默认已解析进现值）', () => {
  const host = makeHost()
  try {
    const view = host.view()
    assert.deepEqual(view.user, {}, '空用户层')
    assert.deepEqual(view.value.keepAlive, { ...KEEP_ALIVE_DEFAULTS }, 'keepAlive 在席且是完整四字段对象')
    for (const key of ['sisyphus', 'roles', 'usagePrices', 'usageCurrency', 'keepAlive']) {
      assert.equal(hostServesSection(view.value, key), true, `${key} 在席`)
    }
    assert.equal(hostServesSection({}, 'keepAlive'), false)
    assert.equal(hostServesSection(undefined, 'keepAlive'), false, '快照缺席（未就绪）不假装在席')
    assert.equal(hostServesSection([], 'keepAlive'), false, '非对象不当段用')
  } finally {
    host.dispose()
  }
})
