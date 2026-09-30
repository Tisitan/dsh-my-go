/**
 * dsh-my-go — configuration card guards.
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
const MEMORY_HINT = '当前以只读方式打开（页面未经回环地址访问），设置不可修改：请改用 http://127.0.0.1 打开，或直接编辑 settings.yaml。'

/**
 * 宿主现值里没有这一段：只有「宿主进程早于本版本插件」这一种成因——
 * 声明的段恒有值（schema 默认也解析进 value，心跳段空用户层也是完整四字段对象）。
 * 文案点明出路，别让用户在两义红字上耗时间。
 */
export const UNSERVED_SECTION_HINT = '宿主未声明这一段（宿主进程早于本版本插件，改过的配置面 schema 未随进程更新）：本块只读，重启宿主后可保存。'

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
 * Whether the host half's resolved section carries one top-level key at all. A
 * section the host's schema declares always answers with its defaults resolved
 * (`keepAlive` is a complete four-field object even with no user layer), so a
 * *missing* key means the running host half does not declare it: the plugin was
 * assembled from an older module and the Loader never re-imports it in place
 * (Node's ESM cache is keyed by URL). Writes to such a section are refused by the
 * host's volatile-path gate, and that refusal takes the whole atomic write down.
 * @param section - the resolved namespace value from the snapshot.
 * @param key - one top-level field name of the plugin's Config schema.
 * @returns whether the host serves that section.
 */
export function hostServesSection(section, key) {
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return false
  return section[key] !== undefined
}

/**
 * Top-level sections an op list addresses that none of the given host values
 * serve — the refusal worth naming in the receipt. Reads the ops rather than the
 * draft: what matters is what actually rode the wire.
 * @param ops - the ops handed to `scope.mutate`.
 * @param values - host values to test (the pre-write and post-write snapshots).
 * @returns the unserved section names, deduplicated, in first-seen order.
 */
export function unservedSections(ops, values) {
  const pools = (Array.isArray(values) ? values : [values]).filter((value) => value !== undefined)
  const roots = [...new Set((Array.isArray(ops) ? ops : []).map((op) => (Array.isArray(op?.path) ? op.path[0] : undefined)))]
  return roots.filter((key) => typeof key === 'string' && !pools.some((value) => hostServesSection(value, key)))
}

/**
 * Turn a read-back verdict into the receipt the save bar shows. The official
 * channel never throws on a rejected commit, so "the promise settled" proves
 * nothing: only re-reading the namespace does.
 * @param landed - whether the namespace now answers with what the ops intended.
 * @param revision - the namespace revision after the write, for the status line.
 * @param unserved - top-level sections the ops addressed that the host does not
 *   serve (see {@link hostServesSection}); naming them beats the two-guess copy.
 * @returns {{ok: boolean, text: string}}
 */
export function describeSaveOutcome(landed, revision, unserved = []) {
  const at = typeof revision === 'number' ? ` · r${revision}` : ''
  if (landed) return { ok: true, text: `已保存，配置即时生效${at}` }
  const named = Array.isArray(unserved) ? unserved.filter((key) => typeof key === 'string' && key !== '') : []
  if (named.length > 0) {
    return {
      ok: false,
      text: `没落盘：宿主未声明 ${named.join('、')} 段（宿主进程早于本版本插件，配置面 schema 未随进程更新）——请重启宿主后重试${at}`,
    }
  }
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
