/**
 * dsh-my-go — Sisyphus agent orchestration (CLIENT half).
 *
 * Assembly entry only (tisitan.15 split): `apply` wires the host services
 * into the split modules and registers the DSH slots.
 *
 *  - panel-tree.js: overlay tree panel + 600ms snapshot poll + auto-jump
 *    (current / queue / help / history / roster sections, click-to-jump via
 *    `sessions.openSubagent`). Unchanged: the panel is not a configuration
 *    surface.
 *  - settings-core.js: the configuration card, injected into the official
 *    plugin page through `plugins.bundle.config` (0.5.0-tisitan.3) — the
 *    `settings.section` entry is retired. It reads/writes the 'dsh-my-go'
 *    namespace over `settingsScope`, and its model dropdowns ride the host's
 *    own `remote.session.modelCatalog()` face.
 *
 * Built by scripts/build-client.mjs into dist/client.js (a
 * `__ModuleLoader__.load` wrapper around the esbuild CJS bundle). React is
 * external in the bundle and resolved through the loader's require, so we
 * import it here — NOT the dynamic-plugin Builtin (that path has no
 * import and relies on an ambient global, which breaks under esbuild).
 */

import * as React from 'react'

import { SETTINGS_NAMESPACE as NAMESPACE } from '../preset/shared/constants.mjs'
import { createOrchestrationPanel } from './panel-tree.js'
import { SettingsCard } from './settings-core.js'

export const name = 'dsh-my-go'

export const inject = ['slots', 'settingsScope', 'connection', 'remote', 'remote.session']

// 宿主 timer 服务缺席时的回落（E2/A-01）：浏览器形态下 globalThis 即 window，
// 故这就是 window.setInterval/clearInterval；每次建链返回自管 disposer，
// unapply 一并清干净，绝不留孤儿轮询。留痕只打一次。
function createSelfManagedTimer() {
  let warned = false
  return {
    interval(fn, ms) {
      if (!warned) {
        warned = true
        console.warn('[dsh-my-go] client: timer service unavailable; panel polling falls back to window.setInterval (self-managed disposer)')
      }
      const id = globalThis.setInterval(fn, ms)
      return () => globalThis.clearInterval(id)
    },
  }
}

// sessions 服务惰性解析：Proxy 每次属性访问都重新 client.get('sessions')，
// 消除「apply 装配时 sessions 未就绪 → 一次性 get 永远落空」的时序脆弱点。
// 缺席时该次访问视为不可用并留痕一次（不随 auto-jump 每 800ms 刷屏）；
// 服务一旦在席立即恢复，无需重建面板。
function createLazySessions(client) {
  let warned = false
  return new Proxy({}, {
    get(_target, prop) {
      const svc = client.get('sessions')
      if (!svc) {
        if (!warned) {
          warned = true
          console.warn('[dsh-my-go] client: sessions service unavailable; panel click-to-jump and auto-jump degrade until the service appears (snapshot polling unaffected)')
        }
        return undefined
      }
      const value = svc[prop]
      return typeof value === 'function' ? value.bind(svc) : value
    },
  })
}

export function apply(ctx) {
  const client = ctx

  const slots = client.get('slots')
  if (!slots) return

  const connection = client.connection
  // sessions / timer 有意**不**进 inject（客户端半的既有形态）：拿不到就得
  // 降级，而不是挂载失败。但降级不能是静默的（tisitan.8 E2/A-01）——此前
  // timer 缺席时 `timer && timer.interval` 直接短路，面板永不刷新、也永不
  // 说明原因；现在补一次性留痕 + 真自管的回落定时器。sessions 则走惰性
  // 解析（createLazySessions）：装配时序不再决定面板能否拿到服务。
  const sessions = createLazySessions(client)
  const timer = client.get('timer')
  const panelTimer = timer && typeof timer.interval === 'function'
    ? timer
    : createSelfManagedTimer()

  // ── orchestration panel + polling + auto-jump（ tisitan.15 拆分至 panel-tree.js）
  const stopPanel = createOrchestrationPanel({ slots, connection, sessions, timer: panelTimer })

  // ── configuration card（官方插件页内的唯一配置入口）───────────────────────
  const binder = client.get('settingsScope')
  const remote = client.get('remote')
  if (binder && slots && typeof slots.inject === 'function') {
    const scope = binder.bind({ namespace: NAMESPACE })
    const face = binder.describe ? binder.describe() : null
    const catalog = createCatalogStore(remote)
    // 只有宿主真的在服务这个命名空间时才挂卡：插件被停用 / 宿主半注册失败时，
    // 页面上不会出现一张读不到东西的空表单（官方内置插件卡同款门控）。
    client.effect(() => {
      let off = null
      const sync = () => {
        const served = new Set((face?.getSnapshot?.()?.view?.namespaces ?? []).map((entry) => entry.ns))
        const available = face === null || served.has(NAMESPACE)
        if (available && off === null) off = registerCard(slots, scope, face, catalog, connection)
        else if (!available && off !== null) {
          off()
          off = null
        }
      }
      const unsubscribe = face?.subscribe ? face.subscribe(sync) : () => {}
      void (face?.ensure ? face.ensure() : face?.load ? face.load() : undefined)
      sync()
      return () => {
        unsubscribe()
        if (off !== null) off()
      }
    }, 'dsh-my-go: configuration card')
    // 模型目录跟着宿主的信号走：适配器变了、文档变了、连接重代了，都作废重拉。
    client.effect(() => {
      const offs = [
        remote?.$on?.('llm/adapters-updated', () => catalog.invalidate()),
        remote?.$on?.('settings/document-updated', () => catalog.invalidate()),
      ]
      const reset = () => catalog.reset()
      const offReset = typeof client.on === 'function' ? client.on('connection/reset', reset) : null
      return () => {
        for (const off of offs) if (typeof off === 'function') off()
        if (typeof offReset === 'function') offReset()
      }
    }, 'dsh-my-go: model catalog invalidations')
  }

  // ── cleanup ─────────────────────────────────────────────────────────────
  return () => {
    stopPanel()
  }
}

/**
 * One registration under the bundle identity the plugin page looks a bundle up
 * by. The page keys a bundle by the name the *profile* installed it under, so a
 * `link:` install whose key differs from the package name would silently lose the
 * card — dsh-tts tripped on exactly that. Here the dependency key, the bundle
 * entry and the package name are all `dsh-my-go`, so one key covers every
 * install shape; the sandbox acceptance re-confirms it.
 */
function registerCard(slots, scope, face, catalog, connection) {
  return slots.inject('plugins.bundle.config', () => slots.register(
    { name: 'plugins.bundle.config', key: NAMESPACE },
    (props) => React.createElement(
      SettingsCardBoundary,
      null,
      React.createElement(SettingsCard, { ...props, scope, face, catalog, connection }),
    ),
  ))
}

/** A throwing render must cost the card, not the whole plugin page. */
class SettingsCardBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[dsh-my-go] configuration card render failed:', error)
  }

  render() {
    if (this.state.failed) {
      return React.createElement('div', { className: 'mygo-notice mygo-noticeError' }, 'dsh-my-go 配置卡渲染异常（已拦截，不影响页面其它部分）。')
    }
    return this.props.children
  }
}

/**
 * Lazy model-catalog store over the host's own session face — the same source
 * the official Subagent card reads, so provider/model lists here can never
 * disagree with what the chat model picker offers. `load()` fetches at most once
 * per generation; `invalidate()` refetches only after something has been read.
 */
export function createCatalogStore(remote) {
  const empty = { status: 'idle', providers: [], models: {}, errors: {} }
  let state = empty
  let generation = 0
  let started = false
  const listeners = new Set()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }

  async function fetchCatalog() {
    const at = ++generation
    state = { ...state, status: 'loading' }
    publish()
    if (!remote?.session || typeof remote.session.modelCatalog !== 'function') {
      state = { status: 'error', providers: [], models: {}, errors: {} }
      publish()
      return
    }
    try {
      const response = await remote.session.modelCatalog()
      if (at !== generation) return
      if (!response || response.ok !== true || !response.value) {
        state = { status: 'error', providers: [], models: {}, errors: {} }
        publish()
        return
      }
      const value = response.value
      const groups = Array.isArray(value.groups) ? value.groups : []
      const failures = Array.isArray(value.failures) ? value.failures : []
      const providers = (Array.isArray(value.routableProviders) && value.routableProviders.length > 0
        ? value.routableProviders
        : groups.map((group) => group?.id)).filter((id) => typeof id === 'string' && id !== '')
      const models = {}
      for (const group of groups) {
        if (!group || typeof group.id !== 'string') continue
        models[group.id] = (Array.isArray(group.models) ? group.models : [])
          .map((model) => model?.id)
          .filter((id) => typeof id === 'string' && id !== '')
      }
      for (const provider of providers) if (!(provider in models)) models[provider] = []
      const errors = {}
      for (const failure of failures) {
        if (failure && typeof failure.id === 'string') errors[failure.id] = String(failure.message ?? '模型清单读取失败')
      }
      state = { status: 'ready', providers, models, errors }
    } catch (error) {
      if (at !== generation) return
      state = { status: 'error', providers: [], models: {}, errors: { '': String(error) } }
    }
    publish()
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load() {
      if (started) return Promise.resolve(state)
      started = true
      return fetchCatalog()
    },
    invalidate() {
      if (!started) return Promise.resolve(state)
      return fetchCatalog()
    },
    reset() {
      started = false
      state = empty
      publish()
    },
  }
}
