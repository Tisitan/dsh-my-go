// 0.5.0 线·联网搜索纪律公共段（dsh-my-go:search-discipline）三件套：
//   ① 段注册形态（name/order/函数态 text/无 complete，与三段共存）
//   ② 儿童门控（与 roster 段反向）：子代理拿 prompts/search-discipline.md 全文、
//      根编排会话拿空串、畸形 context 不炸
//   ③ preset 面 pin：preset/agent.patch.yml 的 tool-web 行 fetch: false（子代理
//      不开放 web_fetch）——纪律段第 3 条「搜-读-再搜」改走 bash 的 curl 抓正文
// 段体读盘纪律（挂载期预热进 promptCache、段体不现读）与「纪律档不是工种」两条
// 以源码 pin 站岗（host-parity.test.mjs 同款静态断言口径）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import * as broker from '../preset/tools/broker.mjs'
import { createBootstrapOps } from '../preset/tools/broker-bootstrap.mjs'
import { AGENT_TYPES } from '../preset/shared/constants.mjs'
import { createMockCtx, waitFor } from './helpers/mock-ctx.mjs'

// 测试隔离：台账持久化在 apply 时从 DSH_HOME 读回——指向独立临时目录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-my-go-searchdisc-home-'))

const SECTION_NAME = 'dsh-my-go:search-discipline'
const PROMPT_PATH = new URL('../prompts/search-discipline.md', import.meta.url)
const BOOTSTRAP_PATH = new URL('../preset/tools/broker-bootstrap.mjs', import.meta.url)
const PATCH_PATH = new URL('../preset/agent.patch.yml', import.meta.url)

function mockCtxFull(options = {}) {
  return createMockCtx({ homePrefix: 'dsh-my-go-searchdisc-home-', captureSections: true, ...options })
}

const sectionOf = (sections) => sections.find((s) => s?.name === SECTION_NAME)
// 子代理上下文（parentSession 直达，与 persona/orchestration 段同一门控口径）
const childCtx = (id = 'c-1') => ({ agent: { id, session: { header: { parentSession: 'root-1' } } } })
const rootCtx = (id = 'root-1') => ({ agent: { id, session: { header: {} } } })

// 挂载 + 取段定义。人设档预热是 fire-and-forget（挂载期读盘一次），故凡断言正文
// 的用例一律 waitFor 等缓存落地——固定 sleep 是墙钟赌注，并行跑会假红。
async function mounted() {
  const mock = mockCtxFull()
  await broker.apply(mock.ctx, { reportExternalization: false })
  const def = sectionOf(mock.sections)
  assert.ok(def, `${SECTION_NAME} 段已注册`)
  return { ...mock, def }
}

// ── ① 段注册形态 ──────────────────────────────────────────────────────────

test('搜索纪律段注册形态：name/order=30/函数态 text/无 complete（与 persona·编排·名册三段共存）', async () => {
  const { sections, def } = await mounted()
  assert.equal(def.order, 30, 'order=30（排在 roster(10) / orchestration(20) 之后）')
  assert.equal(typeof def.text, 'function', '函数态 text（每次 assemble 现调）')
  assert.notEqual(def.complete, true, '不得携带 complete:true')
  assert.equal(sections.filter((s) => s?.name === SECTION_NAME).length, 1, '同名段只注册一次（真宿主重名即抛）')
  for (const name of ['dsh-my-go:roster', 'dsh-my-go:orchestration']) {
    assert.ok(sections.some((s) => s?.name === name), `${name} 段共存`)
  }
})

// ── ② 儿童门控（与 roster 段反向）──────────────────────────────────────────

test('搜索纪律段儿童门控：子代理逐字节拿 prompts/search-discipline.md 全文，根编排会话拿空串', async () => {
  const { def } = await mounted()
  const body = await readFile(PROMPT_PATH, 'utf-8')
  await waitFor(() => def.text(childCtx()) === body, { what: 'search-discipline 人设档挂载期预热落地（缓存正文，非 fallback）' })
  assert.equal(def.text(childCtx()), body, '子代理上下文返回纪律档全文（与磁盘档逐字节相等）')
  assert.ok(def.text(childCtx()).startsWith('## 联网搜索纪律'), '正文首行是段标题')
  assert.equal(def.text(rootCtx()), '', '根编排会话返回空串（Sisyphus 的搜索口径在 sisyphus.md，此处不重复注入）')
  // 同一段体两态：子代理非空、根会话空——不是「恒空」也不是「恒全文」
  assert.notEqual(def.text(childCtx()), def.text(rootCtx()), '两态可分辨（门控真的在起作用）')
})

test('搜索纪律段畸形 context 不炸：无 agent / 无 session / 无 header 一律空串', async () => {
  const { def } = await mounted()
  for (const ctx of [{}, { agent: {} }, { agent: { session: {} } }, { agent: { session: { header: {} } } }]) {
    assert.equal(def.text(ctx), '', `畸形 context ${JSON.stringify(ctx)} 返回空串`)
  }
  assert.equal(def.text(undefined), '', 'undefined context 返回空串')
})

// ── ③ 零副作用：不扰动 sisyphus.md 的 `## 编排规则` 切分 ─────────────────────

test('零副作用：新增纪律档不扰动 sisyphus.md 的「## 编排规则」切分（编排段两态照旧）', async () => {
  const { sections } = await mounted()
  const orch = sections.find((s) => s?.name === 'dsh-my-go:orchestration')
  assert.ok(orch, '编排段在册')
  await waitFor(() => orch.text(rootCtx()).startsWith('## 编排规则'), { what: 'sisyphus 人设档挂载期预热' })
  assert.ok(orch.text(rootCtx()).startsWith('## 编排规则'), '根会话切分点仍是 ## 编排规则（切分逻辑未被扰动）')
  assert.equal(orch.text(childCtx()), '', '子代理照旧不拿编排规则')
  const body = await readFile(PROMPT_PATH, 'utf-8')
  assert.ok(!body.includes('## 编排规则'), '纪律档内无切分标记——即便被误当人设档读也切不出半截编排规则')
})

// ── ④ 正文完整性 pin（删条目即红）─────────────────────────────────────────

test('pin：prompts/search-discipline.md 六条纪律齐备', async () => {
  const body = await readFile(PROMPT_PATH, 'utf-8')
  assert.ok(body.startsWith('## 联网搜索纪律'), '首行段标题')
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.ok(new RegExp(`^${n}\\. \\*\\*`, 'm').test(body), `第 ${n} 条纪律在册`)
  }
  for (const kw of ['web_search', 'curl', '最多 3 轮', '待核', '未验项']) {
    assert.ok(body.includes(kw), `正文含 ${kw}`)
  }
  assert.ok(!body.includes('web_fetch'),
    '正文不再提 web_fetch——抓正文走 bash 的 curl（撤回 fetch 开放后 web_fetch 子代手里没有）')
})

// ── ⑤ preset 面 pin：tool-web 行 fetch 关闭 ─────────────────────────────────

test('pin：agent.patch.yml 的 tool-web 行 fetch: false（子代理不开放 web_fetch，searchTimeoutMs 不动）', async () => {
  const cordisSchema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
  ])
  const text = await readFile(PATCH_PATH, 'utf-8')
  const doc = yaml.load(text, { schema: cordisSchema })
  // 0.1.7 声明行范式：预设是一枚 insert 行，插件列表在 config.plugins 里
  const webRow = doc.find((patch) => patch?.insert)?.insert?.[0]?.config?.plugins?.find((row) => row?.id === 'tool-web')
  assert.ok(webRow, 'tool-web 行在册（预设声明的 config.plugins 内）')
  assert.equal(webRow?.config?.fetch, false,
    'tool-web 行必须显式 fetch: false——纪律段第 3 条「搜-读-再搜」改走 bash 的 curl 抓正文，不再依赖 web_fetch；被同步 preset 覆盖回 true 本 pin 红')
  assert.equal(webRow?.config?.searchTimeoutMs, 60000, 'searchTimeoutMs 本次不动（只开 fetch）')
})

// ── ⑥ 源码 pin：段体只读缓存不现读 + 纪律档不是工种 ────────────────────────

test('pin：段体只读 promptCache 不现读盘（挂载期预热单独一发），纪律档键不进 AGENT_TYPES', async () => {
  const src = await readFile(BOOTSTRAP_PATH, 'utf-8')
  const start = src.indexOf(`name: '${SECTION_NAME}'`)
  assert.ok(start > 0, '段注册在册')
  const end = src.indexOf("}), 'dsh-my-go-broker.searchDiscipline()'", start)
  assert.ok(end > start, '段注册 effect 名在册')
  const textFn = src.slice(start, end)
  assert.ok(textFn.includes('promptCache.get('), '段体从 promptCache 取（挂载期预热的缓存）')
  assert.ok(!textFn.includes('readPromptFile') && !textFn.includes('readFile'),
    '段体不现读盘（assemble 路径上零 IO——text 必须同步返回字符串）')
  assert.ok(src.includes('void loadPrompt(SEARCH_DISCIPLINE_PROMPT_KEY)'), '挂载期预热单独一发')
  assert.ok(!AGENT_TYPES.includes('search-discipline'),
    '纪律档不是工种：绝不进 AGENT_TYPES（否则 typeOfAgent / 名册 / 面板工种解析凭空多一个工种）')
})

// ── ⑦ 正文 pin：不含宿主插值标记 ───────────────────────────────────────────

test('pin：prompts/search-discipline.md 正文不含 `{{`（防宿主插值把段体炸成未闭合表达式）', async () => {
  const body = await readFile(PROMPT_PATH, 'utf-8')
  assert.ok(!body.includes('{{'),
    '纪律档正文不得出现 `{{`——段体进 assemble 前宿主会做变量插值，出现即成未闭合表达式')
})

// ── ⑧ 缓存未命中兜底 pin：空缓存下 text 给 fallback 串而非空串 ──────────────

// 兜底串逐字节镜像（改 preset 侧常量而不同步这里，本 pin 即红）
const SEARCH_DISCIPLINE_FALLBACK = '## 联网搜索纪律\n搜索前先把关键词想具体；采信搜索结果前用 curl 抓正文核实（curl -sL --max-time 20 <url> | head -c 30000）；报告中源自搜索的事实必须附 URL。\n'

test('pin：缓存未命中时纪律段返回 fallback 串而非空串（清缓存后直接调 text 断言）', async () => {
  const sections = []
  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => { warns.push(args.join(' ')) }
  let def
  try {
    // 清缓存 = 全新挂载实例：promptCache 随挂载建立，预热是 fire-and-forget 的
    // await 链，故本同步块内缓存必然为空——正是「档案读不到」那条路径。
    createBootstrapOps({
      effect: (fn) => fn(),
      registerSection: (d) => sections.push(d),
      getSectionOrder: () => undefined,
      on: () => {},
      sessionTypes: new Map(),
      getBindings: () => ({}),
    })
    def = sections.find((s) => s?.name === SECTION_NAME)
    assert.ok(def, `${SECTION_NAME} 段已注册（空缓存实例）`)
    assert.equal(def.text(childCtx()), SEARCH_DISCIPLINE_FALLBACK, '缓存未命中返回兜底串（逐字节相等）')
    assert.notEqual(def.text(childCtx()), '', '不再给空串——空串等于子代理零纪律上岗')
    assert.ok(def.text(childCtx()).startsWith('## 联网搜索纪律'), '兜底串仍是完整段（首行段标题）')
    def.text(childCtx())
    assert.equal(def.text(rootCtx()), '', '根编排会话照旧空串（兜底不越儿童门控）')
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warns.filter((w) => w.includes('search-discipline prompt missing')).length, 1,
    'console.warn 只发一次（once 标志位防刷屏——段体每次 assemble 现调）')
})
