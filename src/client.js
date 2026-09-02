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

export function apply(ctx) {
  const client = ctx

  const slots = client.get('slots')
  if (!slots) return

  const connection = client.connection
  // sessions / timer 有意**不**进 inject（客户端半的既有形态）：拿不到就得
  // 降级，而不是挂载失败。但降级不能是静默的（tisitan.8 E2/A-01）——此前
  // timer 缺席时 `timer && timer.interval` 直接短路，面板永不刷新、也永不
  // 说明原因；现在补一次性留痕 + 真自管的回落定时器。
  const sessions = client.get('sessions')
  const timer = client.get('timer')
  if (!sessions) console.warn('[dsh-my-go] client: sessions service unavailable; panel click-to-jump and auto-jump disabled (snapshot polling unaffected)')
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
