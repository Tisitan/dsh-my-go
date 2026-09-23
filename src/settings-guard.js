/**
 * dsh-my-go — configuration card guards (0.5.0-tisitan.3).
 *
 * The small pure layer behind the page's read/write defenses, kept out of
 * settings-core.js so `node --test` covers it without a DOM:
 *
 *  - resolveCardView: a configForms snapshot → which face the page shows, with
 *    the copy that tells the user *why* an editor is missing;
 *  - describeSaveOutcome: the post-write read-back verdict → receipt copy;
 *  - attachBeforeUnloadGuard: the browser's own "unsaved edits" interception.
 *
 * It used to interpret the private `loadSettings` / `saveSettings` RPC
 * envelopes. Those endpoints are retired — the official channel reports through
 * a snapshot and settles a rejected write silently — so the interpretation
 * moved from envelopes to layers.
 */

const LOADING_HINT = '正在读取宿主里的 dsh-my-go 配置…'
const UNAVAILABLE_HINT = 'dsh-my-go 设置命名空间不可用（插件未启用、宿主未提供设置服务，或读取失败）。'
const MEMORY_HINT = '当前页面按进程内内存档打开（非本机回环访问），设置只读：请改用 http://127.0.0.1 打开宿主，或直接编辑 settings.yaml。'

/**
 * Decide the read face from a scope snapshot.
 * @param snapshot - `{ status, writable, mode }` as the configForms form
 *   answers it (undefined until the first subscription tick).
 * @returns {{kind: 'loading'|'ready'|'unavailable', hint: string, retryable: boolean}}
 */
export function resolveCardView(snapshot) {
  if (snapshot === null || snapshot === undefined || snapshot.status === 'loading') {
    return { kind: 'loading', hint: LOADING_HINT, retryable: false }
  }
  if (snapshot.mode === 'memory') return { kind: 'unavailable', hint: MEMORY_HINT, retryable: false }
  if (snapshot.status !== 'ready') return { kind: 'unavailable', hint: UNAVAILABLE_HINT, retryable: true }
  return { kind: 'ready', hint: '', retryable: false }
}

/**
 * Turn a read-back verdict into the receipt the save bar shows. The official
 * channel never throws on a rejected commit, so "the promise settled" proves
 * nothing: only re-reading the namespace does.
 * @param landed - whether the namespace now answers with what the ops intended.
 * @param revision - the namespace revision after the write, for the status line.
 * @returns {{ok: boolean, text: string}}
 */
export function describeSaveOutcome(landed, revision) {
  const at = typeof revision === 'number' ? ` · r${revision}` : ''
  if (landed) return { ok: true, text: `已保存，配置即时生效${at}` }
  return {
    ok: false,
    text: `没落盘：宿主拒绝了这次写入（校验不过，或他处刚改过这一命名空间），请丢弃草稿并重读${at}`,
  }
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
