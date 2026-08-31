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

export function apply(ctx) {
  const client = ctx

  const slots = client.get('slots')
  if (!slots) return

  const connection = client.connection
  const sessions = client.get('sessions')
  const timer = client.get('timer')

  // ── orchestration panel + polling + auto-jump（ tisitan.15 拆分至 panel-tree.js）
  const stopPanel = createOrchestrationPanel({ slots, connection, sessions, timer })

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
