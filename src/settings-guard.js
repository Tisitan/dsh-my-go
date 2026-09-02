/**
 * dsh-my-go — settings page guard primitives (tisitan.9 E6/A-03).
 *
 * Pure(ish) helpers behind the settings page's unsaved-work and
 * concurrent-write defense, kept out of settings-core.js so they are
 * testable in plain node --test (no DOM, no React):
 *
 *  - interpretLoadResult: loadSettings envelope → { status, draft, revision }
 *  - interpretSaveResult: saveSettings envelope → status + the fence to adopt
 *  - attachBeforeUnloadGuard: register/teardown the browser unload guard
 *
 * The revision is an opaque token minted by the host half (see
 * lib/index.js currentRevision): the page holds the one it loaded, hands it
 * back on save, and adopts the one the save response returns.
 */

/** True when an RPC envelope carries the settings-conflict taxonomy code. */
function isConflictError(error) {
  return !!error && (error.code === 'conflict' || error.code === 'SETTINGS_CONFLICT')
}

/**
 * Normalize a `loadSettings` reply.
 * @returns {{status: 'ok'|'failed', draft: object|null, revision: number|null}}
 *   `failed` keeps the caller in the null-draft (edit- and save-disabled) state.
 */
export function interpretLoadResult(res) {
  if (!res || res.ok !== true || !res.value || typeof res.value !== 'object' || Array.isArray(res.value)) {
    return { status: 'failed', draft: null, revision: null }
  }
  const { revision, ...draft } = res.value
  return {
    status: 'ok',
    draft,
    revision: typeof revision === 'number' && Number.isFinite(revision) ? revision : null,
  }
}

/**
 * Normalize a `saveSettings` reply.
 * @returns {{status: 'saved'|'conflict'|'failed', message: string, revision: number|null}}
 */
export function interpretSaveResult(res) {
  const revision = res && res.ok && res.value && typeof res.value === 'object' && typeof res.value.revision === 'number'
    ? res.value.revision
    : null
  if (res && res.ok) return { status: 'saved', message: '已保存', revision }
  const error = res && res.error ? res.error : null
  if (isConflictError(error)) {
    const details = error.details && typeof error.details === 'object' ? error.details : {}
    const moved = typeof details.actual === 'number' ? `（他处已改到 r${details.actual}）` : ''
    // 冲突后旧凭据彻底作废：不给前端留可复用的 revision，必须重新加载
    return { status: 'conflict', message: `他处已修改，请重新加载${moved}`, revision: null }
  }
  return { status: 'failed', message: '保存失败: ' + ((error && error.message) || '未知错误'), revision: null }
}

/**
 * Arm the browser "you have unsaved edits" guard.
 * @param win - the window-like object to guard (injected so tests can fake it;
 *   a non-window env (Node, SSR) returns a no-op disposer).
 * @returns the disposer removing the listener.
 */
export function attachBeforeUnloadGuard(win) {
  if (!win || typeof win.addEventListener !== 'function') return () => {}
  const handler = (event) => {
    // The browser only shows its own confirm UI when the event is cancelled
    // and returnValue is set; we cannot show custom text (spec-mandated).
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event) event.returnValue = ''
    return ''
  }
  win.addEventListener('beforeunload', handler)
  return () => {
    if (typeof win.removeEventListener === 'function') win.removeEventListener('beforeunload', handler)
  }
}
