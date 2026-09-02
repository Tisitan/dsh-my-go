// 设置页守卫纯函数（0.3.0-tisitan.9 E6/A-03 客户端半）：src/settings-guard.js 的
// 三件出口——loadSettings 结果归一（revision 从 draft 里剥出来）、saveSettings
// 结果三态归一（saved / conflict / failed）、beforeunload 守卫的注册与解除。
// 本文件不碰 React、不起浏览器：这些语义都发生在渲染之外，能在 Node 侧钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretLoadResult, interpretSaveResult, attachBeforeUnloadGuard } from '../src/settings-guard.js'

// ── interpretLoadResult ────────────────────────────────────────────────────

test('interpretLoadResult：revision 从 draft 里剥出，绝不混进可保存的草稿', () => {
  const parsed = interpretLoadResult({
    ok: true,
    value: { revision: 7, hermes: { model: 'm1' }, roles: { 'custom-x': { model: 'mx' } } },
  })
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.revision, 7)
  assert.ok(!('revision' in parsed.draft), 'draft 里没有 revision 键（保存时由前端另附，不作为配置字段回写）')
  assert.deepEqual(parsed.draft, { hermes: { model: 'm1' }, roles: { 'custom-x': { model: 'mx' } } })
})

test('interpretLoadResult：旧 host 半不回 revision → null，不发明 0 当凭据', () => {
  const parsed = interpretLoadResult({ ok: true, value: { hermes: {} } })
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.revision, null, '0 是合法版本号，不能被当成「没读到」的兜底值')
})

test('interpretLoadResult：ok:false 与畸形 value 一律 failed（null-draft 禁存门禁不变）', () => {
  assert.deepEqual(interpretLoadResult({ ok: false, error: { code: 'unavailable', message: 'x', details: {} } }), { status: 'failed', draft: null, revision: null })
  assert.equal(interpretLoadResult({ ok: true, value: null }).status, 'failed', 'value 缺席 = 没读到，不能渲染成一张干净空表单')
  assert.equal(interpretLoadResult({ ok: true, value: [] }).status, 'failed', '数组不是合法 draft 形状')
  assert.equal(interpretLoadResult(undefined).status, 'failed', '传输层空响应同样按失败处理')
})

// ── interpretSaveResult ────────────────────────────────────────────────────

test('interpretSaveResult：保存成功 adopt 新凭据（不 adopt 会让下一次保存自撞假冲突）', () => {
  const outcome = interpretSaveResult({ ok: true, value: { revision: 8 } })
  assert.equal(outcome.status, 'saved')
  assert.equal(outcome.revision, 8)
})

test('interpretSaveResult：旧 host 半回 value:null 时 revision 为 null，保存仍算成功', () => {
  const outcome = interpretSaveResult({ ok: true, value: null })
  assert.equal(outcome.status, 'saved')
  assert.equal(outcome.revision, null)
})

test('interpretSaveResult：conflict 独立成态并作废本地凭据', () => {
  const outcome = interpretSaveResult({
    ok: false,
    error: { code: 'conflict', message: 'settings changed since load (expected r3, now r5)', details: { expected: 3, actual: 5 } },
  })
  assert.equal(outcome.status, 'conflict')
  assert.equal(outcome.revision, null, '冲突后旧凭据必须作废：留着它下次还会撞')
  assert.match(outcome.message, /他处已修改，请重新加载/)
  assert.match(outcome.message, /r5/, '把「他处改到了哪一版」如实报给用户，而不是只说「保存失败」')
})

test('interpretSaveResult：宿主原生 SETTINGS_CONFLICT 码也认（不把并发写降级成 settings-rejected）', () => {
  const outcome = interpretSaveResult({
    ok: false,
    error: { code: 'SETTINGS_CONFLICT', message: 'namespace moved', details: {} },
  })
  assert.equal(outcome.status, 'conflict')
})

test('interpretSaveResult：真正的写失败仍走 failed 并保留 host 原因', () => {
  const outcome = interpretSaveResult({
    ok: false,
    error: { code: 'settings-rejected', message: 'schema validation failed', details: {} },
  })
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.message, /schema validation failed/)
  assert.equal(interpretSaveResult(undefined).status, 'failed', '空响应按失败处理，绝不静默当已保存')
})

// ── attachBeforeUnloadGuard ────────────────────────────────────────────────

function fakeWindow() {
  const byKind = new Map()
  const of = (kind) => byKind.get(kind) ?? []
  return {
    of,
    addEventListener(kind, fn) { byKind.set(kind, [...of(kind), fn]) },
    removeEventListener(kind, fn) { byKind.set(kind, of(kind).filter((f) => f !== fn)) },
  }
}

test('attachBeforeUnloadGuard：dirty 期间挂一个监听，disposer 精确摘掉它', () => {
  const win = fakeWindow()
  const detach = attachBeforeUnloadGuard(win)
  assert.equal(win.of('beforeunload').length, 1)
  detach()
  assert.equal(win.of('beforeunload').length, 0, '解除后不得留下守卫（dirty 反复翻转时会堆叠）')
  detach() // 幂等：重复解除不该抛（dirty 反复翻转时第二次解除是常态）
})

test('attachBeforeUnloadGuard：事件必须 preventDefault + returnValue，浏览器才弹自家确认框', () => {
  const win = fakeWindow()
  const detach = attachBeforeUnloadGuard(win)
  const event = { prevented: false, preventDefault() { this.prevented = true } }
  win.of('beforeunload')[0](event)
  assert.equal(event.prevented, true)
  assert.equal(event.returnValue, '')
  detach()
})

test('attachBeforeUnloadGuard：非浏览器环境（Node / SSR / 无 addEventListener）返回可调用的空 disposer', () => {
  for (const env of [undefined, null, {}]) {
    const detach = attachBeforeUnloadGuard(env)
    assert.equal(typeof detach, 'function')
    assert.doesNotThrow(() => detach())
  }
})
