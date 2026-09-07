/**
 * dsh-my-go — Sisyphus agent orchestration (CLIENT half).
 *
 * Assembly entry only (tisitan.15 split): `apply` wires the host services
 * into the split modules and registers the DSH slots.
 *
 *  - panel-tree.js: overlay tree panel + 600ms snapshot poll + auto-jump
 *    (current / queue / help / history / roster sections, click-to-jump via
 *    `sessions.openSubagent`).
 *  - settings-core.js: `settings.section` "dsh-my-go" — per-agent
 *    model/effort/DSV4P0813 config, persona overrides, custom roles
 *    (roles-editor.js) and the tool-mask dual-list editor (tool-mask-editor.js).
 *
 * Built by scripts/build-client.mjs into dist/client.js (a
 * `__ModuleLoader__.load` wrapper around the esbuild CJS bundle). React is
 * external in the bundle and resolved through the loader's require, so we
 * import it here — NOT the dynamic-plugin Builtin (that path has no
 * import and relies on an ambient global, which breaks under esbuild).
 */

import * as React from 'react'

import { createOrchestrationPanel } from './panel-tree.js'
import { SettingsPage } from './settings-core.js'

export const name = 'dsh-my-go'

export const inject = ['slots', 'settingsScope', 'connection']

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

  // ── settings page ───────────────────────────────────────────────────────
  const scope = client.get('settingsScope')
    ? client.get('settingsScope').bind({ namespace: 'dsh-my-go' })
    : null

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'dsh-my-go', order: 30, label: 'MyGO 编排' },
    (props) => React.createElement(SettingsPage, { ...props, scope, connection }),
  ))

  // ── cleanup ─────────────────────────────────────────────────────────────
  return () => {
    stopPanel()
  }
}
