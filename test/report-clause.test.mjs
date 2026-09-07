// dsh-my-go — 格式条款注入行为档（第一期步骤 1.4，替身 ctx 端到端）。
//
// 规划 1.4 验收三条：闸开 spawn prompt 尾块含条款 / 闸关无尾块（现状零变化）/
// 备选重派路径（attemptFallbackRedeploy → spawnChild，事实 C 唯一组装点）同样
// 含条款。continue 不经 spawnChild（adjacent 通路），首派覆盖即 D3 裁决，无接缝
// 可测——条款存续性归子代上下文语义，不属本步断言面。
// 1.7 起追加装机 yml 防回潮 pin：2026-09-07 基线关窗、外部化点亮，pin 站岗
// 实战期口径（broker 行显式 reportExternalization: true，误关即红）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import * as broker from '../preset/tools/broker.mjs'
import { REPORT_CLAUSE } from '../preset/shared/report-format.mjs'
import { createMockCtx, withRealSignalContract, execOf, snapOf, currentOf, waitFor, removeHomeWithRetry } from './helpers/mock-ctx.mjs'

const parentOf = (id) => ({ id, session: { header: {} } })
const captureSpawn = (specs) => withRealSignalContract(async (spec) => {
  specs.push(spec)
  return { childId: `sess-${specs.length}` }
})

async function cleanup() {
  await removeHomeWithRetry(process.env.DSH_HOME)
}

test('闸开：go_work 直派 prompt 尾部追加 REPORT_CLAUSE 块（任务原文保持首项）', async () => {
  const specs = []
  const parent = parentOf('parent-cl')
  const { ctx, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-cl' ? parent : undefined) },
    startContinuable: captureSpawn(specs),
  })
  try {
    await broker.apply(ctx, {})
    await tools.get('go_work').execute({ agent: 'explore', prompt: '任务原文' }, execOf(parent))
    assert.equal(specs.length, 1)
    const prompt = specs[0].request.prompt
    assert.equal(prompt.length, 2, '任务原文 + 条款尾块')
    assert.equal(prompt[0].type, 'text')
    assert.equal(prompt[0].text, '任务原文', '任务原文保持首项原样')
    assert.equal(prompt[1].type, 'text')
    assert.equal(prompt[1].text, REPORT_CLAUSE, '尾块 = 单源条款原文（import 复用，不另抄）')
    // 3.6 防串面：RELAY_CLAUSE 是链场景专属（composeRelayPrompt 注入），
    // 非链派发（go_work 直派）绝不携带
    assert.ok(!prompt.some((p) => p.text.includes('mygo_relay_input') || p.text.includes('验收条款')), '非链派发不注入 RELAY_CLAUSE')
  } finally {
    await cleanup()
  }
})

test('闸关（reportExternalization=false）：prompt 单项，现状零变化', async () => {
  const specs = []
  const parent = parentOf('parent-cl-off')
  const { ctx, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-cl-off' ? parent : undefined) },
    startContinuable: captureSpawn(specs),
  })
  try {
    await broker.apply(ctx, { reportExternalization: false })
    await tools.get('go_work').execute({ agent: 'explore', prompt: '任务原文' }, execOf(parent))
    assert.equal(specs.length, 1)
    const prompt = specs[0].request.prompt
    assert.equal(prompt.length, 1, '开关关 = 无尾块')
    assert.equal(prompt[0].text, '任务原文')
    assert.ok(!JSON.stringify(prompt).includes('mygo_report'), '条款字样零泄漏')
  } finally {
    await cleanup()
  }
})

test('备选重派路径同样注入条款（attemptFallbackRedeploy → spawnChild 唯一组装点）', async () => {
  const specs = []
  const injected = []
  const parent = { id: 'parent-cl2', session: { header: {} }, inject: (msg) => injected.push(msg) }
  const { ctx, dispatch, tools } = createMockCtx({
    agents: { get: (id) => (id === 'parent-cl2' ? parent : undefined) },
    llm: { listModels: async (pid) => (pid === 'p0' ? [{ id: 'm0' }] : pid === 'p1' ? [{ id: 'm1' }] : []) },
    sessions: {
      get: (id) => (id === 'sess-1'
        ? { events: [{ type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'error', error: { message: 'no such model: m0', code: 'HTTP_404', status: 404 } } } }] }
        : undefined),
    },
    startContinuable: captureSpawn(specs),
  })
  try {
    await broker.apply(ctx, {
      queueRetryBaseMs: 5,
      disposeEndGraceMs: 30,
      bindings: { hermes: { provider: 'p0', model: 'm0', fallbacks: [{ provider: 'p1', model: 'm1' }] } },
    })
    await tools.get('go_work').execute({ agent: 'hermes', prompt: 'build it' }, execOf(parent))
    // 生产时序（step-3 a 同款）：disposed 恒先于 end，end 取消宽限 timer 后决策重派
    dispatch('agent/disposed', { agent: { id: 'sess-1' } })
    dispatch('subagent/end', { id: 'sess-1', stopReason: 'error', lastAssistantMessage: [] })
    await waitFor(() => currentOf('parent-cl2')?.childId === 'sess-2', { what: '备选重派新 child 已换键占槽' })
    assert.equal(specs.length, 2, '链首失败 → 自动切 fallbacks[0] 重派')
    const prompt = specs[1].request.prompt
    assert.equal(prompt.length, 2, '重派同走 spawnChild：任务原文 + 条款尾块')
    assert.ok(prompt[0].text.includes('build it'), '同 prompt 重派')
    assert.equal(prompt[1].text, REPORT_CLAUSE, '备选重派同样携带条款（一处改动两路同覆盖）')
  } finally {
    await cleanup()
  }
})

// ── 1.7 装机 yml 防回潮 pin（方案 A，help-mtn8uwgr-ds1fes 裁决）──────────────
// 用真 yml 解析（tool-mask.test.mjs 同款 schema 扩展），不走「正则扫行用眼睛读」
// ——缩进一变或改成 flow 风格都要照样红。2026-09-07 基线关窗、外部化点亮，pin 换向
// 站岗：外部化实战期口径 broker 行显式 true，若有人误关回 false 本 pin 红。
test('pin：agent.cordis.yml 的 broker 行必须显式 reportExternalization: true（外部化实战期口径）', async () => {
  const cordisSchema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
  ])
  const text = await readFile(new URL('../preset/agent.cordis.yml', import.meta.url), 'utf-8')
  const doc = yaml.load(text, { schema: cordisSchema })
  const brokerRow = doc.find((row) => row?.id === 'broker')
  assert.ok(brokerRow, 'broker 行在册')
  assert.equal(brokerRow?.config?.reportExternalization, true,
    'broker 行必须显式 reportExternalization: true——显式配置优先于代码默认，2026-09-07 基线关窗、外部化点亮后实战期保持显式开；若有人误关回 false（含同步 preset 覆盖回旧 false 装机）本 pin 红')
})

// 方案 B：REPORT_CLAUSE 明牌压制工种手册旧交付收尾约定，防两源指令打架回潮
test('REPORT_CLAUSE 含覆盖声明：压制工种手册旧收尾/交付约定，冲突以条款为准', () => {
  assert.match(REPORT_CLAUSE, /Precedence:/, '条款必须显式声明优先级')
  assert.match(REPORT_CLAUSE, /压制 prompts\/\*\.md/, '条款必须明牌压制 playbooks 旧约定')
})

// evidence 裸锚点纪律（2026-09-07 补明的原口径，提交制下落到数组项校验）：
// 条款必须明文「禁止任何前后缀描述」——裸「路径:行号」锚点，描述性文字进 report 全文。
test('REPORT_CLAUSE evidence 裸锚点明文：禁止任何前后缀描述', () => {
  assert.match(REPORT_CLAUSE, /禁止任何前后缀描述/, '条款必须显式写明 evidence 项禁前后缀描述——裸「路径:行号」锚点，描述性文字放 report 全文')
})

// 提交制核心机关（0.5.0-tisitan.1）：提交成功即交付 + 自由收尾 + 未交付兜底口径
test('REPORT_CLAUSE 核心机关：提交成功即交付完成、最后一条消息自由收尾、未调用视为未交付', () => {
  assert.match(REPORT_CLAUSE, /提交成功即交付完成——主编会收到系统合成的概要回执/)
  assert.match(REPORT_CLAUSE, /最后一条消息自由收尾/)
  assert.match(REPORT_CLAUSE, /未调用 report_submit 视为未交付/)
  assert.match(REPORT_CLAUSE, /字段校验不过时工具会逐条报错，原地修正重调即可/)
})

// 提示词面归零断言（0.5.0-tisitan.1 纪律）：条款 + 全部 prompts/*.md 一律零出现
test('提示词面旧机制字样归零：REPORT_CLAUSE 与 prompts/ 全目录零出现', async () => {
  assert.ok(!REPORT_CLAUSE.includes('mygo_report'), 'REPORT_CLAUSE 零出现')
  const promptsDir = fileURLToPath(new URL('../prompts/', import.meta.url))
  const files = (await readdir(promptsDir)).filter((f) => f.endsWith('.md'))
  assert.ok(files.length >= 8, 'prompts 目录清点非空（7 工种 + sisyphus）')
  for (const file of files) {
    const text = await readFile(join(promptsDir, file), 'utf-8')
    assert.ok(!text.includes('mygo_report'), `prompts/${file} 零出现`)
  }
})
