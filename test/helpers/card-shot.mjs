/**
 * dsh-my-go — 配置卡的无头取证渲染器。
 *
 * 为什么需要它：配置卡是**手写 React 组件**（src/settings-core.js），不是
 * schema 自动表单——加了一节 UI 就必须有视觉取证。本机没有 react-dom（也不该
 * 为了截图为插件拉一个渲染器依赖），故这里用一枚**一次通过的迷你 React 调度器**
 * 跑真实产物（dist/client.js 经它的 __ModuleLoader__ 契约加载），把元素树序列化
 * 成静态 HTML，再交给 Firefox headless 截图（脚本只落 HTML，截图命令见下方用法）。
 *
 * 与 test/client-card.test.mjs 的关系：那边是**断言**用的假 React（要能重渲染、
 * 能点能填）；这边只求**一张静态快照**，故调度器精简到「一跑到底 + 序列化」，
 * 互不替代：行为面归测试，视觉面归本脚本。
 *
 * 用法（本文件只写 HTML，不启动任何进程）：
 *   node test/helpers/card-shot.mjs /tmp/keepalive-card.html
 * 截图（Firefox 无头 + 独立临时 profile，绝不碰用户的活动会话/默认 profile）：
 *   firefox --headless -no-remote -profile /tmp/ff-shot-profile \
 *     --window-size=1440,2400 --screenshot /tmp/keepalive-card.png \
 *     file:///tmp/keepalive-card.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SETTINGS_CSS } from '../../src/client-styles.js'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const NS = 'dsh-my-go'

// ── 迷你调度器：一次渲染 + 收集一次 effect，够静态快照用 ──────────────────────

function createMiniReact() {
  let cursor = 0
  const slots = []
  const effects = []
  // 类组件基座：真 react 用 Component.prototype.isReactComponent 标类组件，
  // 替身必须同形（否则产物里那层错误边界会被当成函数组件调用 → "cannot be
  // invoked without 'new'"）。
  class ComponentBase { setState() {} }
  ComponentBase.prototype.isReactComponent = {}
  const bump = () => { cursor += 1; return cursor - 1 }
  const at = (index, init) => {
    if (slots[index] === undefined) slots[index] = init
    return slots[index]
  }
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      // props.children 也得填：真 React 把子节点挂在 props 上，类组件（配置卡外
      // 那层错误边界）正是这么读的——漏了它会渲染出一棵空树，而快照只是「页面
      // 一片空白」，不报任何错。
      return { $$el: true, type, props: { ...(props ?? {}), children: kids }, children: kids }
    },
    Fragment: '$$frag',
    Component: ComponentBase,
    useState: (init) => {
      const slot = at(bump(), { value: typeof init === 'function' ? init() : init })
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
    },
    useCallback: (fn) => { at(bump(), { fn }); return fn },
    useMemo: (fn) => { at(bump(), {}); return fn() },
    useEffect: (fn) => {
      const index = bump()
      const slot = at(index, { ran: false })
      if (!slot.ran) {
        slot.ran = true
        effects.push(fn())
      }
    },
    useSyncExternalStore: (subscribe, get) => {
      const slot = at(bump(), { subscribed: false })
      if (!slot.subscribed) {
        slot.subscribed = true
        subscribe(() => {})
      }
      return get()
    },
  }
  react.render = (element) => {
    cursor = 0
    const walk = (node) => {
      if (Array.isArray(node)) return { frag: true, children: node.map(walk).filter(Boolean), props: {} }
      if (typeof node === 'string' || typeof node === 'number') return { text: String(node), children: [], props: {} }
      if (!node || !node.$$el) return null
      if (node.type === react.Fragment) return { frag: true, children: node.children.map(walk).filter(Boolean), props: {} }
      if (typeof node.type === 'function') {
        let out
        if (node.type.prototype && node.type.prototype.isReactComponent !== undefined) {
          // 类组件（配置卡外那层错误边界）：一次性实例化（真 React 会复用实例，
          // 静态快照里没有第二次渲染，复用与否不可观测）
          const instance = new node.type(node.props)
          instance.props = node.props
          instance.state = instance.state ?? {}
          out = instance.render()
        } else {
          out = node.type(node.props)
        }
        const rendered = walk(out) ?? { frag: true, children: [], props: {} }
        rendered.props = { ...node.props, ...rendered.props }
        return rendered
      }
      return { tag: node.type, props: node.props, children: node.children.map(walk).filter(Boolean) }
    }
    return walk(element)
  }
  react.effects = effects
  return react
}

// ── 树 → 静态 HTML（事件处理器丢弃；表单控件的初值落到属性上）──────────────────

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ESCAPE[c])

const ATTR_MAP = {
  className: 'class',
  htmlFor: 'for',
  spellCheck: 'spellcheck',
  readOnly: 'readonly',
  tabIndex: 'tabindex',
}

function serialize(node) {
  if (!node) return ''
  if (node.text !== undefined) return esc(node.text)
  if (node.frag) return node.children.map(serialize).join('')
  const attrs = []
  let selectValue
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === 'children' || typeof value === 'function' || value === undefined || value === null) continue
    if (key === 'value' && node.tag === 'select') { selectValue = String(value); continue }
    if (value === false) continue
    const name = ATTR_MAP[key] ?? key
    if (value === true) { attrs.push(name); continue }
    if (key === 'value') { attrs.push(`value="${esc(value)}"`); continue }
    attrs.push(`${name}="${esc(value)}"`)
  }
  // 到这里的只有容器与控件；void 元素（input）单独早退，不自闭合成对标签。
  if (node.tag === 'input') return `<input ${attrs.join(' ')}>`
  const inner = node.children.map((child) => {
    if (selectValue !== undefined && child?.tag === 'option') {
      const selected = String(child.props?.value) === selectValue
      return serialize({ ...child, props: { ...child.props, selected: selected || undefined } })
    }
    return serialize(child)
  }).join('')
  const head = attrs.length > 0 ? `${node.tag} ${attrs.join(' ')}` : node.tag
  return `<${head}>${inner}</${node.tag}>`
}

// ── 宿主替身（形状照 test/client-card.test.mjs 的 openCard，精简到渲染够用）────

const compose = (base, user) => {
  const out = { ...base, ...user }
  if (base.roles || user.roles) out.roles = { ...(base.roles ?? {}), ...(user.roles ?? {}) }
  return out
}

function makeHost({ user = {}, base = {}, view = 'page' } = {}) {
  const state = { base, user, revision: 3, mode: 'host', status: 'ready', writable: true, writes: [] }
  const snapshot = () => ({
    status: state.status,
    value: compose(state.base, state.user),
    base: state.base,
    user: state.user,
    revision: state.revision,
    writable: true,
    mode: state.mode,
  })
  const scope = {
    state,
    getSnapshot: snapshot,
    subscribe: () => () => {},
    load: async () => {},
    ensure: async () => {},
    mutate: async (ops) => { state.writes.push(ops) },
  }
  const face = { getSnapshot: () => ({ view: { namespaces: [{ ns: NS }] } }), subscribe: () => () => {}, load: async () => {}, ensure: async () => {} }
  const connection = { rpc: { call: async () => ({ ok: true, value: ['read', 'grep', 'bash'] }) } }
  const remote = { $on: () => () => {}, session: { modelCatalog: async () => ({ ok: true, value: { routableProviders: [], groups: [], failures: [] } }) } }
  const records = new Map()
  const slots = {
    inject(name, factory) { factory(); return () => {} },
    register(options, component) {
      const list = records.get(options.name) ?? []
      list.push({ options, component })
      records.set(options.name, list)
      return () => {}
    },
    entries: (name) => records.get(name) ?? [],
  }
  const ctx = {
    slots,
    connection,
    effect: (fn) => fn(),
    on: () => () => {},
    get(name) {
      if (name === 'slots') return slots
      if (name === 'configForms') return { get: () => scope, describe: () => face }
      if (name === 'remote') return remote
      if (name === 'connection') return connection
      if (name === 'timer') return { interval: () => () => {} }
      if (name === 'sessions') return { openSubagent: () => {} }
      return undefined
    },
  }
  return { ctx, slots, state, view }
}

// ── 装配并落盘 ──────────────────────────────────────────────────────────────

export function renderCardHtml({ user = {}, base = {}, view = 'page', focus = null } = {}) {
  const react = createMiniReact()
  const bundleSource = readFileSync(join(ROOT, 'dist', 'client.js'), 'utf-8')
  let loaded = null
  const window = { __ModuleLoader__: { load(spec) { loaded = spec } } }
  const requireMap = { react, 'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement } }
  new Function('window', 'require', bundleSource)(window, (id) => requireMap[id])
  const exported = loaded.factory((id) => (id === 'react' ? react : requireMap['react/jsx-runtime']))
  const host = makeHost({ user, base, view })
  exported.apply(host.ctx)
  const card = host.slots.entries('plugins.bundle.config')[0]
  if (!card) throw new Error('配置卡未挂载（plugins.bundle.config 槽为空）')
  const tree = react.render(card.component({ view }))
  if (process.env.MYGO_SHOT_DEBUG) console.log('TREE', JSON.stringify(tree)?.slice(0, 1200))
  for (const effect of react.effects) if (typeof effect === 'function') effect()
  const body = serialize(tree)
  // focus（可选）：只留指定块 + 其页脚之外的上下文裁掉，给「本次改动那一节」一张
  // 无歧义的取证图（全卡图另存一张，两者互补）。
  const focusCss = focus === null ? '' : `
.mygo-block[data-block]:not([data-block="${focus}"]) { display: none; }
.mygo-legend { display: none; }
`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-my-go 配置卡（keepAlive 心跳节）</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 24px; background: #17181c; }
.stage { max-width: 1180px; margin: 0 auto; }
.mygo-shotNote { font: 12px/1.6 system-ui, sans-serif; color: #888; margin-bottom: 10px; }
${SETTINGS_CSS}${focusCss}
</style></head>
<body><div class="stage">
<p class="mygo-shotNote">dsh-my-go 配置卡 · 无头取证快照（dist/client.js 真产物 + 官方插件页 config 槽形状）${focus === null ? '' : ` · 仅 ${focus} 节`}</p>
${body}
</div></body></html>`
}

if (process.argv[1] && process.argv[1].endsWith('card-shot.mjs')) {
  const target = process.argv[2] ?? '/tmp/dsh-my-go-card.html'
  // 取证场景带一条在飞的 keepAlive 覆盖：让第三块（缓存心跳）显示开启态 + 用户层说明
  writeFileSync(target, renderCardHtml({ user: { keepAlive: { enabled: true } } }), 'utf-8')
  const focusTarget = target.replace(/\.html$/, '.keepalive.html')
  writeFileSync(focusTarget, renderCardHtml({ user: { keepAlive: { enabled: true } }, focus: 'keepAlive' }), 'utf-8')
  console.log(`wrote ${target}`)
  console.log(`wrote ${focusTarget}`)
}
