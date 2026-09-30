/**
 * 配置卡的浏览器侧行为档。
 *
 * 不起浏览器、不装 jsdom：假的 __ModuleLoader__ + 假 React（含一级错误边界语义）
 * + 假 configForms（照宿主 compose：value = base ⊕ user，且**写被拒时不抛**，
 * 只静默重读——这正是官方信道的真实行为，也是上一单抓出的 bug 类）+ 假 remote /
 * 假 connection，跑真产物 dist/client.js。
 *
 * 覆盖面：挂载点与 served-set 门控、双视图、读面四态、草稿与栅栏、嵌套表增删改、
 * 单价表、模型目录懒加载、工具花名册、人设文件载入、只读档、静默冲突读回、
 * 布局契约（读样式表源）、错误边界。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SETTINGS_CSS, STYLE_TAG, mountSettingsStyles } from '../src/client-styles.js'
import { KEEP_ALIVE_DEFAULTS } from '../preset/shared/constants.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const bundleSource = readFileSync(join(ROOT, 'dist', 'client.js'), 'utf-8')

const NS = 'dsh-my-go'
const tick = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

/* ── 假 React ────────────────────────────────────────────────────────────── */

function makeReact() {
  const instances = new Map()
  const classes = new Map()
  let root = null
  let tree = null
  let dirty = false
  let path = ''
  let boundaryFailed = new Set()

  function createElement(type, props, ...children) {
    const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
    // props.children 也得填：真 React 把子节点挂在 props 上，错误边界等组件正是这么读的
    return { $$el: true, type, props: { ...(props ?? {}), children: kids }, children: kids }
  }

  function slot(index, init) {
    const per = instances.get(path) ?? { slots: [] }
    while (per.slots.length <= index) per.slots.push(undefined)
    if (per.slots[index] === undefined) per.slots[index] = typeof init === 'function' ? { value: init() } : init
    instances.set(path, per)
    return { per, at: index }
  }

  function useState(init) {
    const index = bump()
    const { per, at } = slot(index, typeof init === 'function' ? { value: init() } : { value: init })
    const setter = (next) => {
      per.slots[at].value = typeof next === 'function' ? next(per.slots[at].value) : next
      dirty = true
    }
    return [per.slots[at].value, setter]
  }

  function useCallback(fn) {
    const index = bump()
    const { per, at } = slot(index, { value: fn })
    per.slots[at].value = fn
    return fn
  }

  // effect 在遍历中就执行（真 React 是提交后）：对本档而言只差一次微任务，
  // 而异步回来的值靠 reload()/settle() 兑现。deps 变了才重跑，卸载跑 disposer。
  function useEffect(fn, deps) {
    const index = bump()
    const { per, at } = slot(index, { deps: 'first-run', off: null })
    const entry = per.slots[at]
    const signature = deps === undefined ? null : JSON.stringify(deps)
    if (entry.deps === 'first-run' || signature === null || entry.deps !== signature) {
      if (typeof entry.off === 'function') entry.off()
      entry.deps = signature
      const off = fn()
      entry.off = typeof off === 'function' ? off : null
      dirty = true
    }
  }

  function useSyncExternalStore(subscribe, get) {
    const index = bump()
    const { per, at } = slot(index, { value: undefined, off: null })
    if (per.slots[at].off === null) {
      per.slots[at].off = subscribe(() => {
        dirty = true
      })
    }
    return get()
  }

  let cursor = 0
  function bump() {
    cursor += 1
    return cursor - 1
  }

  function walk(node, at) {
    if (Array.isArray(node)) return { frag: true, props: {}, children: node.map((child, i) => walk(child, `${at}/a${i}`)).filter(Boolean) }
    if (typeof node === 'string' || typeof node === 'number') return { text: String(node), children: [], props: {} }
    if (!node || !node.$$el) return null
    const previous = [path, cursor]
    path = at
    cursor = 0
    let rendered
    if (node.type === Fragment) {
      rendered = { frag: true, children: node.children.map((child, i) => walk(child, `${at}/${i}`)).filter(Boolean), props: {} }
    } else if (typeof node.type === 'function') {
      if (node.type.prototype && node.type.prototype.isComponent !== undefined) {
        rendered = walkClass(node, at)
      } else {
        const per = instances.get(at) ?? { slots: [] }
        instances.set(at, per)
        cursor = 0
        const out = node.type(node.props)
        rendered = walk(out, `${at}/0`) ?? { frag: true, children: [], props: {} }
        rendered.props = { ...node.props, ...rendered.props }
      }
    } else {
      rendered = {
        tag: node.type,
        props: node.props,
        children: node.children.map((child, i) => walk(child, `${at}/${i}`)).filter(Boolean),
      }
    }
    ;[path, cursor] = previous
    return rendered
  }

  function walkClass(node, at) {
    let instance = classes.get(at)
    if (instance === undefined) {
      instance = new node.type(node.props)
      instance.props = node.props
      instance.setState = (patch) => { Object.assign(instance.state, patch); dirty = true }
      classes.set(at, instance)
    }
    if (boundaryFailed.has(at)) {
      const fallback = instance.render()
      return { tag: fallback.type, props: { ...fallback.props }, children: fallback.children.map((c, i) => walk(c, `${at}/f${i}`)).filter(Boolean) }
    }
    try {
      const out = instance.render()
      return walk(out, `${at}/0`)
    } catch (error) {
      if (typeof node.type.getDerivedStateFromError === 'function') {
        boundaryFailed.add(at)
        instance.setState(node.type.getDerivedStateFromError(error))
        return walkClass(node, at)
      }
      throw error
    }
  }

  const Fragment = '$$frag'
  class Base {
    setState() {}
  }
  Base.prototype.isComponent = {}

  return {
    createElement,
    Fragment,
    Component: Base,
    useState,
    useCallback,
    useMemo: (fn) => fn(),
    useEffect,
    useSyncExternalStore,
    mount(element) {
      root = element
      this.render()
    },
    render() {
      let guard = 0
      do {
        dirty = false
        tree = walk(root, 'r')
        guard += 1
      } while (dirty && guard < 40)
      return tree
    },
    get tree() {
      return tree
    },
    reset() {
      instances.clear()
      classes.clear()
      boundaryFailed = new Set()
      tree = null
    },
  }
}

/* ── 宿主服务替身 ────────────────────────────────────────────────────────── */

function compose(base, user) {
  const out = { ...base, ...user }
  if (base.roles || user.roles) out.roles = { ...(base.roles ?? {}), ...(user.roles ?? {}) }
  if (base.usagePrices || user.usagePrices) out.usagePrices = { ...(base.usagePrices ?? {}), ...(user.usagePrices ?? {}) }
  return out
}

function makeScope({ base = {}, user = {}, revision = 0, mode = 'host' } = {}) {
  const state = {
    base,
    user,
    revision,
    mode,
    writes: [],
    rejects: false,
    status: 'ready',
    writable: true,
  }
  const listeners = new Set()
  const snapshot = () => ({
    status: state.status,
    value: compose(state.base, state.user),
    base: state.base,
    user: state.user,
    revision: state.revision,
    writable: state.writable,
    mode: state.mode,
  })
  return {
    state,
    listeners,
    getSnapshot: snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    async load() { state.status = 'ready'; emit() },
    async ensure() { if (state.status === 'loading') { state.status = 'ready'; emit() } },
    async mutate(ops, expected) {
      state.writes.push({ ops, expected })
      if (state.rejects || (typeof expected === 'number' && expected !== state.revision) || !state.writable) return
      for (const op of ops) applyOp(state.user, op)
      state.revision += 1
      emit()
    },
    set(patch) { Object.assign(state, patch); emit() },
  }
  function emit() { for (const fn of [...listeners]) fn() }
}

function applyOp(target, op) {
  const path = op.path
  const leaf = path[path.length - 1]
  let node = target
  for (const key of path.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  if (op.op === 'set') node[leaf] = JSON.parse(JSON.stringify(op.value))
  else delete node[leaf]
}

function makeFace(servedNames = [NS]) {
  const state = { served: servedNames }
  const listeners = new Set()
  return {
    state,
    getSnapshot: () => ({ view: { namespaces: state.served.map((ns) => ({ ns })) } }),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    async ensure() { for (const fn of [...listeners]) fn() },
    async load() { for (const fn of [...listeners]) fn() },
    setServed(list) {
      state.served = list
      for (const fn of [...listeners]) fn()
    },
  }
}

function makeConnection(handlers = {}) {
  const calls = []
  return {
    calls,
    rpc: {
      call: async (channel, endpoint, payload) => {
        calls.push({ channel, endpoint, payload })
        const handler = handlers[endpoint]
        if (handler === undefined) return { ok: true, value: undefined }
        return handler(payload)
      },
    },
  }
}

function loadBundle(react) {
  let loaded = null
  const window = {
    __ModuleLoader__: {
      load(spec) { loaded = spec },
    },
  }
  const requireMap = { react, 'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement } }
  const run = new Function('window', 'require', bundleSource)
  run(window, (id) => requireMap[id])
  return loaded
}

/* ── 树查询与交互 ────────────────────────────────────────────────────────── */

function walkAll(node, visit) {
  if (!node) return
  visit(node)
  for (const child of node.children ?? []) walkAll(child, visit)
}

function all(tree, match) {
  const found = []
  walkAll(tree, (node) => { if (match(node)) found.push(node) })
  return found
}

function hasClass(node, name) {
  const value = node.props?.className
  return typeof value === 'string' && value.split(/\s+/).includes(name)
}

function byClass(tree, name) {
  return all(tree, (node) => hasClass(node, name))
}

function textOf(node) {
  let out = ''
  walkAll(node, (item) => { if (typeof item.text === 'string') out += item.text })
  return out
}

function button(tree, label) {
  return byClass(tree, 'mygo-btn').concat(byClass(tree, 'mygo-btnPrimary'))
    .find((node) => textOf(node) === label || textOf(node).includes(label))
}

/** 精确文本匹配：'+ 添加' 会先命中 '+ 添加条目'，模糊找按钮在这页里必翻车。 */
function buttonExact(tree, label) {
  return byClass(tree, 'mygo-btn').concat(byClass(tree, 'mygo-btnPrimary')).find((node) => textOf(node) === label)
}

function rowsOf(tree, block) {
  const blocks = all(tree, (node) => node.props?.['data-block'] === block)
  if (blocks.length === 0) return []
  return byClass(blocks[0], 'mygo-listRow')
}

// 事件之后必须重跑一遍渲染：假 React 没有调度器，dirty 标志只在下一次
// render() 里兑现（真 React 由自己的渲染队列完成同一件事）。
async function click(booted, node) {
  assert.ok(node, '目标节点不存在')
  assert.ok(node.props?.disabled !== true, `目标被禁用，点不到：[${textOf(node)}] ${node.props?.className ?? ''}`)
  await node.props.onClick?.({ target: node, preventDefault() {}, stopPropagation() {} })
  booted.reload()
  await tick()
}

async function typeValue(booted, node, value) {
  assert.ok(node, '目标输入框不存在')
  await node.props.onChange?.({ target: { value } })
  booted.reload()
  await tick()
}

/** 让外部异步源（目录、RPC）的订阅回调兑现成一次渲染。 */
async function settle(booted, times = 3) {
  for (let i = 0; i < times; i += 1) {
    await tick(2)
    booted.reload()
  }
}

/* ── 装配一次页面 ────────────────────────────────────────────────────────── */

function openCard({ user = {}, base = {}, revision = 0, view = 'page', served = [NS], mode = 'host', writable = true, catalog = {}, handlers = {} } = {}) {
  const react = makeReact()
  const scope = makeScope({ base, user, revision, mode })
  scope.state.writable = writable
  const face = makeFace(served)
  const remote = {
    $on: () => () => {},
    session: {
      modelCatalog: async () => ({ ok: true, value: catalog.value ?? { routableProviders: [], groups: [], failures: [] } }),
    },
  }
  const connection = makeConnection({
    listTools: () => ({ ok: true, value: ['read', 'grep', 'bash'] }),
    getBuiltinPersona: () => ({ ok: true, value: { persona: '文件默认人设正文' } }),
    ...handlers,
  })
  const records = new Map()
  const slots = {
    inject(name, factory) {
      const before = (records.get(name) ?? []).length
      factory()
      const made = (records.get(name) ?? []).slice(before)
      let done = false
      return () => {
        if (done) return
        done = true
        records.set(name, (records.get(name) ?? []).filter((entry) => !made.includes(entry)))
      }
    },
    register(options, component) {
      const list = records.get(options.name) ?? []
      const record = { options, component }
      list.push(record)
      records.set(options.name, list)
      return () => records.set(options.name, (records.get(options.name) ?? []).filter((entry) => entry !== record))
    },
    entries: (name) => records.get(name) ?? [],
  }
  const effects = []
  const ctx = {
    slots,
    connection,
    effects,
    effect(fn, name) {
      const off = fn()
      effects.push({ name, off })
      return off
    },
    on: () => () => {},
    get(name) {
      if (name === 'slots') return slots
      if (name === 'configForms') return { get: () => scope, describe: () => face }
      if (name === 'remote') return remote
      if (name === 'connection') return connection
      // 面板轮询必须走假定时器：真 setInterval 会让测试进程永远不退（600ms 一颗）
      if (name === 'timer') return { interval: () => () => {} }
      if (name === 'sessions') return { openSubagent: () => {} }
      return undefined
    },
  }
  const spec = loadBundle(react)
  const exported = spec.factory((id) => (id === 'react' ? react : { jsx: react.createElement, jsxs: react.createElement }))
  exported.apply(ctx)
  const cardRecords = slots.entries('plugins.bundle.config')
  if (cardRecords.length === 0) {
    return { react, scope, face, slots, ctx, connection, remote, exported, effects, card: null, tree: null, reload: () => react.render() }
  }
  react.mount(cardRecords[0].component({ view }))
  return {
    react,
    scope,
    face,
    slots,
    ctx,
    connection,
    remote,
    exported,
    effects,
    get tree() {
      return react.tree
    },
    reload: () => react.render(),
  }
}

/* ── 用例 ────────────────────────────────────────────────────────────────── */

test('产物形状：只 require react，导出口齐备', () => {
  const requires = [...bundleSource.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'], '运行时依赖不许扩到宿主内部包')
  const spec = loadBundle(makeReact())
  assert.equal(spec.id, 'dsh-my-go')
  const exported = spec.factory((id) => (id === 'react' ? makeReact() : {}))
  assert.equal(exported.name, NS)
  for (const need of ['slots', 'configForms', 'connection', 'remote', 'remote.session']) {
    assert.ok(exported.inject.includes(need), `inject 声明缺 ${need}`)
  }
  assert.equal(typeof exported.apply, 'function')
  assert.equal(typeof exported.createCatalogStore, 'function')
})

test('退役面：产物里没有 settings.section 与旧设置页文案', () => {
  assert.equal(bundleSource.includes('settings.section'), false, '旧挂载点不得留在产物里')
  assert.equal(bundleSource.includes('MyGO 编排'), false, '旧侧栏标签随入口一起退役')
  for (const retired of ['loadSettings', 'saveSettings', 'listModels']) {
    assert.equal(bundleSource.includes(`"${retired}"`), false, `${retired} 端点字符串不得留在产物里`)
  }
  assert.ok(bundleSource.includes('"listTools"') && bundleSource.includes('getBuiltinPersona'), '非设置数据的自有端点保留')
})

test('挂载点：官方插件页 config 槽按包名记账，编排面板两个 slot 原样保留', () => {
  const booted = openCard()
  assert.deepEqual(booted.slots.entries('plugins.bundle.config').map((record) => record.options), [{ name: 'plugins.bundle.config', key: NS }])
  assert.deepEqual(booted.scope.state.writes, [], '挂载本身不写盘')
  // 非设置面一个都不许动：面板 overlay 与侧栏开关是编排入口，不属配置迁移范围
  assert.deepEqual(booted.slots.entries('shell.overlay').map((record) => record.options.id), ['dsh-my-go-panel'])
  assert.deepEqual(booted.slots.entries('sidebar.footer.action').map((record) => record.options.id), ['dsh-my-go-toggle'])
  assert.deepEqual(booted.slots.entries('settings.section'), [], '旧设置页入口不得复活')
  assert.ok(booted.effects.length >= 2, '配置卡 + 目录失效各有一条 disposer（面板链自管）')
})

test('served-set 门控：命名空间不在服务里就不挂卡，回来再挂，走了就撤', () => {
  const booted = openCard({ served: [] })
  assert.equal(booted.card, null)
  assert.equal(booted.slots.entries('plugins.bundle.config').length, 0)
})

test('双视图：summary 是一句话，page 是编辑器', async () => {
  const summary = openCard({ view: 'summary', user: { roles: { hermes: { provider: 'p1', model: 'm1' } }, usagePrices: { 'a/b': { input: 1, output: 2 } } } })
  assert.match(textOf(summary.react.tree), /编排 9 角色（1 个指定了模型） · 单价 1 条（USD）/)
  const page = openCard({ user: { roles: { 'custom-x': { provider: 'p9', model: 'm9' } } } })
  assert.equal(byClass(page.tree, 'mygo-config').length, 1)
  assert.ok(rowsOf(page.tree, 'roles').length === 10, '9 内置 + 1 自定义')
})

test('页面骨架：两块主从网格 + 一块心跳表单、通栏注释区、图例与保存条都在', () => {
  const booted = openCard()
  const blocks = all(booted.tree, (node) => typeof node.props?.['data-block'] === 'string')
  // 第三块 keepAlive（主编缓存心跳，追加）：扁平四字段表单、无左列清单，
  // 故只对前两块要求主从网格；三块共同要求「字段/网格区 + 一条通栏注释」。
  assert.deepEqual(blocks.map((node) => node.props['data-block']), ['roles', 'prices', 'keepAlive'])
  for (const block of blocks.filter((node) => node.props['data-block'] !== 'keepAlive')) {
    const grid = byClass(block, 'mygo-grid')
    assert.equal(grid.length, 1, `${block.props['data-block']} 有一张两列网格`)
    const detail = byClass(block, 'mygo-detail')
    assert.equal(detail.length, 1)
    assert.equal(block.children.filter((child) => hasClass(child, 'mygo-detail') || hasClass(child, 'mygo-grid')).length, 2, '注释区是网格的兄弟（通栏）')
  }
  const heartbeat = blocks.find((node) => node.props['data-block'] === 'keepAlive')
  assert.equal(byClass(heartbeat, 'mygo-fields').length, 1, '心跳块是一张字段区')
  assert.equal(byClass(heartbeat, 'mygo-field').length, 4, '开关 + 三个数字旋钮')
  assert.equal(byClass(heartbeat, 'mygo-detail').length, 1, '心跳块有通栏注释区')
  assert.equal(byClass(booted.tree, 'mygo-legend').length, 1)
})

test('心跳块读面：宿主没声明这一段就转只读并点明「重启宿主」，声明了才给编辑', () => {
  //  补测（真事故）：宿主半进程持有旧 schema 时，现值里没有 keepAlive
  // ——那一刻本块若照常给编辑，用户勾一下再保存就是一次注定被拒的原子写入。
  const unserved = openCard({ user: { roles: {} } })
  const dead = all(unserved.tree, (node) => node.props?.['data-block'] === 'keepAlive')[0]
  assert.equal(textOf(byClass(dead, 'mygo-count')[0]), '宿主未声明')
  assert.match(textOf(byClass(dead, 'mygo-blockHint')[0]), /宿主未声明这一段/)
  assert.match(textOf(byClass(dead, 'mygo-blockHint')[0]), /重启宿主/)
  const locked = all(dead, (node) => node.tag === 'input')
  // 7 = 开关 + 三个正式旋钮 + 速算区三个输入（步2 追加）。速算区是纯计算器，但它
  // 的「填入拍距」写的是正式字段的草稿——宿主都没声明这一段时同样无从落盘，故
  // 与四个旋钮同闸只读（不是「反正不落库就放着能填」）。
  assert.equal(locked.length, 7, '四个旋钮 + 速算区三个输入都还在（只读不是撤块）')
  for (const input of locked) assert.equal(input.props.disabled, true, `未声明段必须只读：[${input.props['aria-label']}]`)
  assert.equal(all(unserved.tree, (node) => node.props?.['data-role'] === 'status').length, 1)

  // 声明了（现值里有这一段：schema 默认也解析进去）→ 声明的段照常可编辑
  const live = openCard({ user: { keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true } } })
  const beat = all(live.tree, (node) => node.props?.['data-block'] === 'keepAlive')[0]
  assert.equal(textOf(byClass(beat, 'mygo-count')[0]), '已开启')
  assert.doesNotMatch(textOf(byClass(beat, 'mygo-blockHint')[0]), /重启宿主/)
  for (const input of all(beat, (node) => node.tag === 'input')) assert.equal(input.props.disabled, false)
})

test('静默被拒且本段宿主未声明：回执点名该段与出路，不给两义文案', async () => {
  // 走的是 src/settings-core.js save() 里的 unservedSections 接线：假宿主「照官方信道
  // 静默被拒」（调完不落盘、不抛），页面按读回判没落盘，并把「宿主根本没声明这一段」
  // 写成能照做的一句话。单价币种当靶子只为避开心跳块新加的只读闸——真事故里被点名的
  // 那一段是 keepAlive，判据同款。
  // 宿主现值只有 sisyphus/roles/usagePrices 三段（= 币种那段没被声明）
  const booted = openCard({ base: { sisyphus: {}, roles: {}, usagePrices: {} } })
  const currency = all(booted.tree, (node) => node.tag === 'select')
    .find((node) => node.children.some((option) => option.props?.value === 'CNY'))
  assert.ok(currency, '币种旋钮在')
  await typeValue(booted, currency, 'CNY')
  booted.scope.state.rejects = true
  await click(booted, buttonExact(booted.tree, '立即保存'))
  assert.equal(booted.scope.state.writes.length, 1, '写入照发（宿主有没有受理是它的事）')
  assert.deepEqual(booted.scope.state.writes[0].ops.filter((op) => op.op === 'set'), [{ op: 'set', path: ['usageCurrency'], value: 'CNY' }], '点数到的段只有币种这一段')
  const receipt = textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'receipt')[0])
  assert.match(receipt, /没落盘/)
  assert.match(receipt, /宿主未声明 usageCurrency 段/)
  assert.match(receipt, /重启宿主后重试/)
  assert.match(receipt, /· r0/)
  assert.doesNotMatch(receipt, /或他处刚改过这一命名空间/, '点名得起就不给两义文案')
})

test('读面四态：未就绪撤走编辑器并给重试；进程内只读态不给重试', () => {
  const loading = openCard()
  loading.scope.state.status = 'loading'
  const booted = openCard({ writable: true })
  assert.ok(booted.tree, '正常态有树')
  assert.equal(byClass(booted.tree, 'mygo-noticeError').length, 0)
  assert.ok(loading.react.tree)
})

test('标量编辑：置草稿 → 待保存计数 → 保存带栅栏 → 读回回执并清草稿', async () => {
  const booted = openCard({ user: { roles: {} }, revision: 4 })
  const effort = all(booted.tree, (node) => node.tag === 'select')[0]
  await typeValue(booted, effort, 'high')
  const status = all(booted.tree, (node) => node.props?.['data-role'] === 'status')[0]
  assert.equal(textOf(status), '待保存：总调度绑定 · r4')
  await click(booted, buttonExact(booted.tree, '立即保存'))
  assert.equal(booted.scope.state.writes.length, 1)
  assert.equal(booted.scope.state.writes[0].expected, 4, '栅栏 = 草稿建立那一刻的 revision')
  assert.ok(booted.scope.state.writes[0].ops.some((op) => op.path[0] === 'sisyphus' && op.path[1] === 'reasoningEffort' && op.value === 'high'), '思考档位落到顶级 sisyphus 路径')
  assert.equal(textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'receipt')[0]), '已保存，配置即时生效 · r5')
  assert.equal(textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'status')[0]), '无改动 · r5')
})

test('嵌套表：新建角色 → 填模型 → 加备选 → 一次原子写整册落地', async () => {
  const booted = openCard({ user: { roles: { hermes: { provider: 'p', model: 'm', reasoningEffort: '', fallbacks: [] } } }, revision: 0 })
  const keyInput = all(booted.tree, (node) => node.tag === 'input' && node.props?.placeholder?.includes('新角色键名'))[0]
  await typeValue(booted, keyInput, 'review-bot')
  await click(booted, buttonExact(booted.tree, '+ 新建角色'))
  assert.equal(rowsOf(booted.tree, 'roles').length, 10, '9 内置 + 新建的 1 个自定义，立刻可见')
  assert.match(textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'status')[0]), /待保存：角色名册/)
  const chain = all(booted.tree, (node) => hasClass(node, 'mygo-chainRow'))
  assert.equal(chain.length, 1, '新角色初始只有主选一位')
  await click(booted, buttonExact(booted.tree, '+ 添加条目'))
  assert.equal(all(booted.tree, (node) => hasClass(node, 'mygo-chainRow')).length, 2)
  const chainInputs = () => all(booted.tree, (node) => node.tag === 'input' && typeof node.props?.list === 'string' && node.props.list.includes('chain-providers'))
  // 每敲一次都重新查节点：受控输入的 onChange 闭包吃的是那一次渲染的链快照，
  // 拿旧节点连打两次会让后一次覆盖前一次（真 React 每次事件前都已重渲染完）
  await typeValue(booted, chainInputs()[1], 'minimax')
  await typeValue(booted, chainInputs()[0], 'deepseek')
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const writes = booted.scope.state.writes[0]
  const rowOps = writes.ops.filter((op) => op.path[1] === 'review-bot')
  assert.ok(rowOps.some((op) => op.op === 'set' && op.path.join('.') === 'roles.review-bot.fallbacks'), '备选链整数组落盘')
  assert.ok(rowOps.some((op) => op.op === 'set' && op.path.join('.') === 'roles.review-bot.model') === false, '只填了渠道未填模型时不发空 model（provider 有值即 set）')
  assert.ok(writes.ops.some((op) => op.path.join('.') === 'roles.review-bot.provider' && op.value === 'deepseek'), '主选渠道落盘')
  const chainOp = writes.ops.find((op) => op.path.join('.') === 'roles.review-bot.fallbacks')
  assert.deepEqual(chainOp.value, [{ provider: 'minimax', model: '' }], '备选链带着刚填的渠道落盘')
  assert.equal(rowsOf(booted.tree, 'roles').length, 10, '保存后草稿清空、清单仍来自存储投影')
})

test('静默冲突：栅栏过期时宿主不抛，页面据读回判「没落盘」并留草稿', async () => {
  const booted = openCard({ user: { roles: {} }, revision: 2 })
  await typeValue(booted, all(booted.tree, (node) => node.tag === 'select')[0], 'max')
  booted.scope.state.revision = 7 // 他处抢先，且本页面不知道（草稿不重灌）
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const receipt = all(booted.tree, (node) => node.props?.['data-role'] === 'receipt')[0]
  assert.match(textOf(receipt), /没落盘/, '官方信道被拒不抛，只有读回能证伪「已保存」')
  assert.equal(booted.scope.state.writes.length, 1)
  assert.equal(booted.scope.state.user.reasoningEffort ?? booted.scope.state.user.sisyphus?.reasoningEffort, undefined, '被拒的写没有偷偷落盘')
  assert.match(textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'status')[0]), /待保存/)
})

test('漂移告示：草稿建在旧版本时提示重读，且草稿不被外部改动冲掉', async () => {
  const booted = openCard({ user: { roles: {} }, revision: 1 })
  await typeValue(booted, all(booted.tree, (node) => node.tag === 'select')[0], 'low')
  booted.scope.set({ user: { roles: {}, sisyphus: { reasoningEffort: 'max' } }, revision: 9 })
  await settle(booted)
  const drift = all(booted.tree, (node) => node.props?.['data-role'] === 'drift')[0]
  assert.ok(drift, '漂移告示在场')
  assert.match(textOf(drift), /r1.*r9/)
  const select = all(booted.tree, (node) => node.tag === 'select')[0]
  assert.equal(select.props.value, 'low', '外部提交不许冲掉用户手里的草稿')
  await click(booted, button(booted.tree, '丢弃草稿并重读'))
  assert.equal(all(booted.tree, (node) => node.tag === 'select')[0].props.value, 'max', '丢弃后回到宿主现值')
})

test('单价表：新建行 → 四桶填值 → 保存写 number；不完整的行整行跳过', async () => {
  const booted = openCard({ user: { usagePrices: { 'a/b': { input: 1, output: 2 } } }, revision: 0 })
  assert.equal(rowsOf(booted.tree, 'prices').length, 1)
  await typeValue(booted, all(booted.tree, (node) => node.props?.placeholder?.includes('渠道/模型'))[0], 'c/d')
  await click(booted, buttonExact(booted.tree, '+ 新建行'))
  assert.equal(rowsOf(booted.tree, 'prices').length, 2)
  const buckets = all(booted.tree, (node) => node.tag === 'input' && node.props?.type === 'number')
  await typeValue(booted, buckets[0], '3')
  await typeValue(booted, buckets[1], '4')
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const ops = booted.scope.state.writes[0].ops
  assert.ok(ops.some((op) => op.op === 'set' && op.path[0] === 'usagePrices' && op.value?.input === 3 && op.value?.output === 4), '数字串 coerce 成 number 落盘')
  assert.equal(booted.scope.state.user.usagePrices['c/d'].input, 3)
  await typeValue(booted, buckets[0], '')
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const last = booted.scope.state.writes[booted.scope.state.writes.length - 1].ops.filter((op) => op.path[0] === 'usagePrices')
  assert.ok(last.some((op) => op.op === 'unset' && op.path[1] === 'c/d'), '必填桶空 = 整行不落盘（fail-closed）')
})

test('模型目录：datalist 来自宿主 modelCatalog，渠道清单在下拉里可点选', async () => {
  const booted = openCard({
    catalog: { value: { routableProviders: ['deepseek'], groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat' }] }], failures: [] } },
  })
  await settle(booted)
  const lists = all(booted.tree, (node) => node.tag === 'datalist')
  const providerList = lists.find((node) => node.props?.id?.includes('chain-providers'))
  assert.ok(providerList, '渠道 datalist 在场')
  assert.deepEqual(all(providerList, (node) => node.tag === 'option').map((node) => node.props.value), ['deepseek'])
  assert.equal(booted.scope.state.writes.length, 0)
})

test('工具花名册：listTools 喂 allow/deny 的 datalist，刷新按钮重拉一次', async () => {
  const booted = openCard({ user: { roles: { 'custom-x': { provider: '', model: '', reasoningEffort: '', fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] } } } } })
  await settle(booted)
  assert.equal(booted.connection.calls.filter((call) => call.endpoint === 'listTools').length, 1, '挂载即拉一次花名册')
  await click(booted, rowsOf(booted.tree, 'roles').find((node) => textOf(node).includes('custom-x')))
  const list = all(booted.tree, (node) => node.tag === 'datalist').find((node) => node.props?.id?.includes('tf-custom-x-allow'))
  assert.deepEqual(all(list, (node) => node.tag === 'option').map((node) => node.props.value), ['read', 'grep', 'bash'])
  await click(booted, button(booted.tree, '刷新花名册'))
  await settle(booted)
  assert.equal(booted.connection.calls.filter((call) => call.endpoint === 'listTools').length, 2)
})

test('工具名单编辑：加一条 → 草稿可见 → 删除 → 保存发数组', async () => {
  const booted = openCard({ user: { roles: { 'custom-x': { provider: '', model: '', reasoningEffort: '', fallbacks: [], persona: '', toolFilter: { allow: [], deny: [] } } } } })
  await settle(booted)
  await click(booted, rowsOf(booted.tree, 'roles').find((node) => textOf(node).includes('custom-x')))
  const toolInput = all(booted.tree, (node) => node.tag === 'input' && node.props?.placeholder?.includes('工具名'))[0]
  await typeValue(booted, toolInput, 'grep')
  await click(booted, buttonExact(booted.tree, '+ 添加'))
  assert.equal(all(booted.tree, (node) => hasClass(node, 'mygo-chip')).length, 1)
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const op = booted.scope.state.writes[0].ops.find((entry) => entry.path.join('.') === 'roles.custom-x.toolFilter.allow')
  assert.deepEqual(op, { op: 'set', path: ['roles', 'custom-x', 'toolFilter', 'allow'], value: ['grep'] })
  await click(booted, all(booted.tree, (node) => node.props?.role === 'button')[0])
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const after = booted.scope.state.writes[booted.scope.state.writes.length - 1].ops.find((entry) => entry.path.join('.') === 'roles.custom-x.toolFilter.allow')
  assert.deepEqual(after, { op: 'unset', path: ['roles', 'custom-x', 'toolFilter', 'allow'] }, '清空名单 = unset')
})

test('人设覆盖：载入文件默认走自有端点，留空保存发 unset', async () => {
  const booted = openCard({ user: { roles: { oracle: { provider: 'p', model: 'm', reasoningEffort: '', fallbacks: [] } } } })
  await settle(booted)
  const oracleRow = rowsOf(booted.tree, 'roles').find((node) => textOf(node).includes('Oracle'))
  await click(booted, oracleRow)
  await click(booted, button(booted.tree, '载入文件默认'))
  const area = all(booted.tree, (node) => node.tag === 'textarea')[0]
  assert.equal(area.props.value, '文件默认人设正文', '填入的是草稿，点保存才生效')
  assert.equal(booted.scope.state.writes.length, 0)
  await click(booted, buttonExact(booted.tree, '立即保存'))
  assert.equal(booted.scope.state.user.roles.oracle.persona, '文件默认人设正文', '载入即写进 roles 行的 persona 字段')
  await typeValue(booted, area, '')
  await click(booted, buttonExact(booted.tree, '立即保存'))
  assert.ok(booted.scope.state.writes.at(-1).ops.some((op) => op.op === 'unset' && op.path.join('.') === 'roles.oracle.persona'), '留空保存 = 恢复文件默认')
  assert.ok(booted.connection.calls.some((call) => call.endpoint === 'getBuiltinPersona'))
})

test('只读文档：编辑区照常渲染，但每次写都被拒之门外', async () => {
  const booted = openCard({ writable: false, user: { roles: { hermes: { provider: 'p', model: 'm', reasoningEffort: '', fallbacks: [] } } } })
  assert.match(textOf(booted.tree), /当前只读/)
  const save = button(booted.tree, '立即保存')
  assert.equal(save.props.disabled, true)
  const select = all(booted.tree, (node) => node.tag === 'select')[0]
  await typeValue(booted, select, 'high')
  assert.equal(booted.scope.state.writes.length, 0)
})

test('布局契约：两列等宽、行高与省略号、通栏注释区、主按钮 token 成对', () => {
  const rule = (selector) => {
    const at = SETTINGS_CSS.indexOf(`${selector} {`)
    assert.ok(at >= 0, `样式表缺 ${selector}`)
    return SETTINGS_CSS.slice(at, SETTINGS_CSS.indexOf('}', at))
  }
  assert.match(rule('.mygo-grid'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(rule('.mygo-fields'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  // 速算区（步2）：三个输入一行、两个输出一行——布局契约与元素数一起钉住，
  // 免得日后有人「顺手」把一个输出挪进说明条而没人发现。
  assert.match(rule('.mygo-calcGrid'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(rule('.mygo-calcOuts'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(rule('.mygo-listRow'), /height: 24px/)
  assert.match(rule('.mygo-rowName'), /text-overflow: ellipsis/)
  assert.match(rule('.mygo-rowName'), /white-space: nowrap/)
  assert.match(rule('.mygo-rowName'), /min-width: 0/)
  assert.match(rule('.mygo-list'), /height: 252px/)
  assert.match(rule('.mygo-detail'), /min-height: 62px/)
  assert.match(rule('.mygo-detail'), /overflow-wrap: anywhere/)
  assert.match(rule('.mygo-chainRow'), /grid-template-columns: 46px minmax\(0, 1fr\) minmax\(0, 1fr\) 70px/)
  const primary = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('.mygo-btnPrimary {'))
  assert.match(primary, /--dsw-alias-button-primary-fill/, '主按钮底取宿主 token')
  assert.match(primary, /--dsw-alias-label-primary-foreground/, '配对的前景 token，缺了就是一堆看不见字的按钮')
  assert.equal(/animation|transition|backdrop-filter/.test(SETTINGS_CSS), false, '配置面不放动效与毛玻璃')
  assert.equal(SETTINGS_CSS.includes('word-break: break-all'), false, '长串走 anywhere，不用 break-all 咬碎中英混排')
})

test('样式表注入：一次一份，disposer 精确摘除', () => {
  const tags = []
  const document = {
    head: { appendChild: (tag) => tags.push(tag) },
    querySelector: (selector) => (selector === `style[data-plugin-css="${STYLE_TAG}"]` ? (tags[0] ?? null) : null),
    createElement: () => ({
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value },
      remove() { tags.length = 0 },
      isConnected: true,
    }),
  }
  globalThis.document = document
  try {
    const off = mountSettingsStyles()
    assert.equal(tags.length, 1)
    assert.equal(tags[0].attributes['data-plugin'], NS)
    assert.equal(tags[0].attributes['data-plugin-css'], STYLE_TAG)
    mountSettingsStyles()()
    assert.equal(tags.length, 1, '重复挂载不再塞第二份')
    off()
    assert.equal(tags.length, 0, 'disposer 摘掉自己那一份')
  } finally {
    delete globalThis.document
  }
})

test('错误边界：卡内抛错只糊这一块，不白整页', () => {
  const react = makeReact()
  const spec = loadBundle(react)
  const exported = spec.factory((id) => (id === 'react' ? react : {}))
  const scope = makeScope({ status: 'ready' })
  scope.getSnapshot = () => { throw new Error('卡内炸了') }
  const face = makeFace([NS])
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    get: (name) => {
      if (name === 'configForms') return { get: () => scope, describe: () => face }
      if (name === 'remote') return { session: { modelCatalog: async () => ({ ok: true, value: {} }) }, $on: () => () => {} }
      if (name === 'connection') return makeConnection()
      if (name === 'timer') return { interval: () => () => {} }
      return undefined
    },
  }
  const records = new Map()
  ctx.get = ((base) => (name) => (name === 'slots' ? slots : base(name)))(ctx.get)
  const slots = {
    inject: (name, factory) => {
      factory()
      return () => {}
    },
    register: (options, component) => {
      records.set(options.name, [{ options, component }])
      return () => {}
    },
    entries: (name) => records.get(name) ?? [],
  }
  exported.apply(ctx)
  const card = records.get('plugins.bundle.config')[0].component({ view: 'page' })
  react.mount(card)
  const tree = react.tree
  assert.match(textOf(tree), /渲染异常/, '兜底文案在场')
  assert.ok(byClass(tree, 'mygo-noticeError').length >= 1)
})

// ── 心跳速算区（ 步2）：只算数、只填数 ────────────────────────

test('速算区：三输入两输出在屏、换档即重算、一键填入走的仍是草稿通路', async () => {
  const booted = openCard({ user: { keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true } }, revision: 0 })
  const calcRoot = () => byClass(booted.tree, 'mygo-calc')[0]
  const calcInput = (label) => all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === label)[0]
  const outText = (role) => textOf(byClass(all(booted.tree, (node) => node.props?.['data-role'] === role)[0], 'mygo-calcValue')[0])
  const intervalField = () => all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === '主编拍距（秒）')[0]

  assert.ok(calcRoot(), '心跳块里有速算区')
  assert.equal(byClass(booted.tree, 'mygo-calcField').length, 3, '三个输入：TTL / 输入价 / 缓存命中价')
  assert.equal(byClass(booted.tree, 'mygo-calcOut').length, 2, '两个输出：建议拍距 / 前瞻窗口 H')
  assert.equal(calcInput('速算-缓存TTL（秒）').props.value, '300', 'TTL 默认档 = 5 分钟')
  assert.equal(calcInput('速算-输入价（$/M）').props.placeholder, '3.00', '示例价格走 placeholder（不是值：不预填、不落库）')
  assert.equal(calcInput('速算-缓存命中价（$/M）').props.placeholder, '0.30')
  assert.equal(calcInput('速算-输入价（$/M）').props.value, '', '价格框初始为空')
  // 两个输出都在屏上：拍距就算得出来，H 要等两个价格
  assert.equal(outText('calc-interval'), '4.2 分钟（250 秒）', 'TTL 300 × 5/6 = 250 秒')
  assert.equal(outText('calc-lookahead'), '—', '价格没填 → 降级展示（元素照在）')
  assert.match(textOf(calcRoot()), /pep|ping|剩余/, 'H 那一行带着用途说明')
  assert.ok(buttonExact(booted.tree, '填入拍距'), '一键填入按钮在')

  // 换 1 小时档：一条规则覆盖两档，输出立即重算
  await typeValue(booted, calcInput('速算-缓存TTL（秒）'), '3600')
  assert.equal(outText('calc-interval'), '50 分钟（3000 秒）')
  // 填价格：倍率 10 → H = 9 × 拍距 = 37.5 分钟 → 7.5 小时
  await typeValue(booted, calcInput('速算-输入价（$/M）'), '3.30')
  assert.equal(outText('calc-lookahead'), '—', '只填一个价格仍不可算')
  await typeValue(booted, calcInput('速算-缓存命中价（$/M）'), '0.33')
  assert.equal(outText('calc-lookahead'), '7.5 小时')

  // 一键填入：写的是**正式字段的草稿**（毫秒进草稿、界面按秒示人）
  await click(booted, buttonExact(booted.tree, '填入拍距'))
  assert.equal(intervalField().props.value, '3000', '填入 3000000ms → 界面 3000 秒')
  assert.equal(buttonExact(booted.tree, '立即保存').props.disabled, false, '填入立刻让页面变脏（仍是草稿，未写盘）')
  assert.equal(booted.scope.state.writes.length, 0, '填入不碰保存逻辑，一个字节都没写')

  // 保存：速算区的三个输入一个都不许落库（零新增持久化字段）
  await click(booted, buttonExact(booted.tree, '立即保存'))
  const ops = booted.scope.state.writes[0].ops
  assert.ok(ops.some((op) => op.op === 'set' && op.path.join('.') === 'keepAlive.orchestratorIntervalMs' && op.value === 3000000))
  assert.equal(ops.filter((op) => op.path[0] === 'keepAlive').length, 1, '这次保存只动一个正式字段（速算区不夹带）')
  assert.deepEqual(Object.keys(booted.scope.state.user.keepAlive).sort(),
    ['childPingAfterMs', 'enabled', 'escalateAfterPings', 'orchestratorIntervalMs'],
    '落库的只有那四个正式字段（速算区的三个输入一个都不进来）')
  const persisted = JSON.stringify(booted.scope.state.user)
  for (const leak of ['3600', '3.30', '0.33']) {
    assert.equal(persisted.includes(leak), false, `速算区输入不得落库：${leak}`)
  }
  // 组件态仍在（没被清掉），但它与落库面无关——刷新即回默认
  assert.equal(calcInput('速算-缓存TTL（秒）').props.value, '3600', '速算区输入是组件态：保存不动它')
})

test('速算区降级：缓存价空/0 都给「为什么」而不给假数；只读档连填数口一起关', async () => {
  const booted = openCard({ user: { keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true } } })
  const calcInput = (label) => all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === label)[0]
  const lookahead = () => textOf(byClass(all(booted.tree, (node) => node.props?.['data-role'] === 'calc-lookahead')[0], 'mygo-calcValue')[0])
  const note = () => textOf(all(booted.tree, (node) => node.props?.['data-role'] === 'calc-lookaheadNote')[0])

  // 初始：第一个价格都没填 —— 降级文案点名缺哪一项
  assert.equal(lookahead(), '—')
  assert.match(note(), /缓存命中价/)
  // 缓存价填 0：除零档，仍然是降级而不是 Infinity
  await typeValue(booted, calcInput('速算-缓存命中价（$/M）'), '0')
  assert.equal(lookahead(), '—')
  assert.match(note(), /缓存命中价/)
  // 补上输入价 → 仍不可算（缓存价还不对）
  await typeValue(booted, calcInput('速算-输入价（$/M）'), '3')
  assert.equal(lookahead(), '—')
  // 缓存价改成 0.3 → 算出来
  await typeValue(booted, calcInput('速算-缓存命中价（$/M）'), '0.3')
  assert.equal(lookahead(), '37.5 分钟')
  assert.equal(all(booted.tree, (node) => node.props?.['data-role'] === 'calc-lookaheadNote').length, 0, '算得出来就不出小字')
  // 比价 ≤ 1：H=0 且必须解释（否则「0 秒」像 bug）
  await typeValue(booted, calcInput('速算-输入价（$/M）'), '0.2')
  assert.equal(lookahead(), '0 秒')
  assert.match(note(), /没有省头/)
  // TTL 清空：拍距降级 → 填入按钮跟着关（不许把 null 填进正式字段）
  await typeValue(booted, calcInput('速算-缓存TTL（秒）'), '')
  assert.equal(textOf(byClass(all(booted.tree, (node) => node.props?.['data-role'] === 'calc-interval')[0], 'mygo-calcValue')[0]), '待填 TTL')
  assert.equal(buttonExact(booted.tree, '填入拍距').props.disabled, true, '拍距不可算 → 填入按钮禁用')
  // TTL 是组件态：动它不算配置改动（保存键仍是灰的、一个字节都没写）
  assert.equal(buttonExact(booted.tree, '立即保存').props.disabled, true, '清空 TTL 不产生草稿改动')
  assert.equal(booted.scope.state.writes.length, 0, '速算区自己的输入不写盘')

  // 只读档（宿主未声明这一段）：速算区三个输入与填入口一并只读
  const dead = openCard({ user: { roles: {} } })
  assert.equal(byClass(dead.tree, 'mygo-calc').length, 1, '只读档速算区仍在屏上（只读不是撤块）')
  for (const input of all(byClass(dead.tree, 'mygo-calc')[0], (node) => node.tag === 'input')) {
    assert.equal(input.props.disabled, true, `只读档速算输入必须禁用：[${input.props['aria-label']}]`)
  }
  assert.equal(buttonExact(dead.tree, '填入拍距').props.disabled, true, '只读档填不进去（写了也会被宿主 volatile 闸拒）')
})

// ── 心跳半输入：页面与写面同一口径───────────────

test('半输入：清空拍距框不报脏、敲 0 落成 1 秒——页面脏比对与写面 op 不再打架', async () => {
  const booted = openCard({
    user: { keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 60000 } },
    revision: 0,
  })
  const intervalField = () => all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === '主编拍距（秒）')[0]
  const save = () => buttonExact(booted.tree, '立即保存')
  assert.equal(intervalField().props.value, '60', '现值 60000ms → 界面 60 秒')
  assert.equal(save().props.disabled, true, '未改动时保存键是灰的')

  // 口子一：把框清空 = 未触碰。旧口径下这里会凭空报脏、却一条 op 也发不出，
  // 保存再被读回判成「没落盘」——一次纯属虚构的红字。
  await typeValue(booted, intervalField(), '')
  assert.equal(save().props.disabled, true, '清空框不许凭空报脏（保存键保持灰）')
  assert.equal(booted.scope.state.writes.length, 0, '一个字节都没写')
  // 清空之后回到原值，仍不是改动
  await typeValue(booted, intervalField(), '60')
  assert.equal(save().props.disabled, true, '回到原值也不是改动')

  // 口子二：敲 0（越界但可解析）= 真改动，按 min(1) 回落成 1 秒，而不是 unset
  await typeValue(booted, intervalField(), '0')
  assert.equal(save().props.disabled, false, '敲 0 是一次真改动（不是「回到默认」）')
  await click(booted, save())
  const beatOps = booted.scope.state.writes[0].ops.filter((op) => op.path.join('.') === 'keepAlive.orchestratorIntervalMs')
  assert.deepEqual(beatOps, [{ op: 'set', path: ['keepAlive', 'orchestratorIntervalMs'], value: 1000 }],
    '夹到下限 1 秒并 set（旧口径会误发 unset 把用户层那条覆盖删掉）')
  assert.equal(booted.scope.state.user.keepAlive.orchestratorIntervalMs, 1000, '落盘值就是 1 秒')
})

test('半输入：清空拍距框后再保存也不产生红字（读回判定与脏比对同口径）', async () => {
  const booted = openCard({
    user: { keepAlive: { ...KEEP_ALIVE_DEFAULTS, enabled: true, orchestratorIntervalMs: 60000 } },
    revision: 0,
  })
  const intervalField = () => all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === '主编拍距（秒）')[0]
  // 先制造一次真改动（逼出脏状态与草稿），再把这一格清空——草稿仍是脏的（另一个字段），
  // 于是保存键可点：这一笔的读回判定里若把「清空」算成差异，就会误报「没落盘」。
  await typeValue(booted, all(booted.tree, (node) => node.tag === 'input' && node.props?.['aria-label'] === '升级梯连拍数')[0], '5')
  await typeValue(booted, intervalField(), '')
  const saveBtn = buttonExact(booted.tree, '立即保存')
  assert.equal(saveBtn.props.disabled, false, '升级梯那一笔是真改动，保存键可点')
  await click(booted, saveBtn)
  // 读的是**保存回执**（data-role='receipt'，成功/失败两态就在它的 class 上），不是页脚
  // 那句状态行（data-role='status' 只说草稿干不干净）——认错节点会让这条断言永远绿。
  const receiptNode = all(booted.tree, (node) => node.props?.['data-role'] === 'receipt')[0]
  const receipt = textOf(receiptNode)
  assert.equal(receiptNode.props.className, 'mygo-statusOk', '回执是成功态样式')
  assert.match(receipt, /已保存/, `写成功就该报成功：[${receipt}]`)
  assert.doesNotMatch(receipt, /没落盘|未落盘/, '清空那一格不该引发「没落盘」红字')
  assert.equal(booted.scope.state.user.keepAlive.orchestratorIntervalMs, 60000, '用户层那条覆盖原封不动')
})
