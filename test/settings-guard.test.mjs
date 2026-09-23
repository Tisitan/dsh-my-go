// 配置卡守卫纯函数（0.5.0-tisitan.3 起对着宿主配置表单快照工作，0.1.7 起该快照由
// configForms.get(entryId) 交出）：
// src/settings-guard.js 的三件出口——读面四态归一（resolveCardView）、写面读回
// 回执（describeSaveOutcome）、beforeunload 守卫的注册与解除。
// 旧两件吃的是私有 RPC 信封（interpretLoadResult / interpretSaveResult），端点
// 退役后信封没了：判据随官方信道改写成快照态，一条不删。
// 本文件不碰 React、不起浏览器：这些语义都发生在渲染之外，能在 Node 侧钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachBeforeUnloadGuard, describeSaveOutcome, resolveCardView } from '../src/settings-guard.js'

// ── resolveCardView ────────────────────────────────────────────────────────

test('resolveCardView：快照缺席与 loading 都是「读取中」，不许亮失败横幅', () => {
  assert.deepEqual(resolveCardView(undefined), { kind: 'loading', hint: expect_loading(), retryable: false })
  assert.equal(resolveCardView({ status: 'loading' }).kind, 'loading')
})

function expect_loading() {
  return resolveCardView(undefined).hint
}

test('resolveCardView：ready 才给编辑器', () => {
  const view = resolveCardView({ status: 'ready', value: {}, base: {}, writable: true, mode: 'host' })
  assert.equal(view.kind, 'ready')
  assert.equal(view.hint, '', '就绪态不占提示条')
})

test('resolveCardView：unavailable 可重试，内存档（非本机回环）不可重试', () => {
  const down = resolveCardView({ status: 'unavailable' })
  assert.equal(down.kind, 'unavailable')
  assert.equal(down.retryable, true, '命名空间暂时读不到（插件刚停用/宿主重启中）给重试按钮')
  assert.match(down.hint, /dsh-my-go 设置命名空间不可用/)
  const memory = resolveCardView({ status: 'unavailable', mode: 'memory' })
  assert.equal(memory.retryable, false, '内存档重试也不会落盘，重试是假希望')
  assert.match(memory.hint, /127\.0\.0\.1/)
})

test('resolveCardView：ready 但宿主只读，不算不可用（页面自己出只读告示）', () => {
  assert.equal(resolveCardView({ status: 'ready', writable: false }).kind, 'ready')
})

// ── describeSaveOutcome ────────────────────────────────────────────────────

test('describeSaveOutcome：落盘与没落盘两条文案，都带当前版本号', () => {
  const ok = describeSaveOutcome(true, 8)
  assert.equal(ok.ok, true)
  assert.equal(ok.text, '已保存，配置即时生效 · r8')
  const bad = describeSaveOutcome(false, 8)
  assert.equal(bad.ok, false)
  assert.match(bad.text, /没落盘/, '官方信道被拒不抛，只有读回能证伪「已保存」')
  assert.match(bad.text, /丢弃草稿并重读/, '给出唯一出路')
  assert.match(bad.text, /r8/)
})

test('describeSaveOutcome：宿主没给版本号就不编一个', () => {
  assert.equal(describeSaveOutcome(true, undefined).text, '已保存，配置即时生效')
})

// ── attachBeforeUnloadGuard ────────────────────────────────────────────────

test('attachBeforeUnloadGuard：脏草稿期间拦一道，disposer 真的解绑', () => {
  const listeners = []
  const win = {
    addEventListener: (name, fn) => listeners.push([name, fn]),
    removeEventListener: (name, fn) => {
      const at = listeners.findIndex(([n, f]) => n === name && f === fn)
      if (at >= 0) listeners.splice(at, 1)
    },
  }
  const off = attachBeforeUnloadGuard(win)
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0][0], 'beforeunload')
  const event = { prevented: 0, returnValue: 'untouched', preventDefault() { this.prevented += 1 } }
  listeners[0][1](event)
  assert.equal(event.preventDefault === undefined ? 0 : event.prevented, 1, '取消事件才有浏览器确认框')
  assert.equal(event.returnValue, '')
  off()
  assert.equal(listeners.length, 0)
})

test('attachBeforeUnloadGuard：非浏览器环境（Node/SSR）是 no-op，不炸', () => {
  assert.equal(typeof attachBeforeUnloadGuard(undefined), 'function')
  assert.equal(typeof attachBeforeUnloadGuard({}), 'function', '没有 addEventListener 也不炸')
  attachBeforeUnloadGuard(undefined)()
})
