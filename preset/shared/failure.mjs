/**
 * dsh-my-go — failure normalization + fallback classification (both halves).
 *
 * Iron rule: shared modules never import @deepseek-ai/* and never touch ctx —
 * pure functions only.
 */

// ── 失败附因结构化 + fallback 分类（备选链 step-2） ──────────────────────
// readTurnFailure 返回值契约：{ message, code?, status? }。message 恒为
// string；code/status 缺失时字段为 undefined。形状依据（npm @deepseek-ai/*
// 0.1.0-rc.8）：
//   - LlmError.failure：frozen {message, code, status?, providerRetryAfterMs?,
//     requestId?}（dsh-llm/lib/index.js:951-957）
//   - 非 LlmError 裸 Error 兜底：{message: errorChain(error), code:
//     'UNKNOWN'}（dsh-agent-loop/lib/index.js:584-587）
export function normalizeTurnFailure(failure) {
  if (!failure || typeof failure.message !== 'string') return undefined
  return {
    message: failure.message,
    code: typeof failure.code === 'string' ? failure.code : undefined,
    status: Number.isInteger(failure.status) ? failure.status : undefined,
  }
}

// isFallbackable：fallback 备选链错误分类器。输入 readTurnFailure 返回值
// （undefined = 档案/live 均未读到附因）。判定表（rc.8 查证）：
//   绝不切 — abort/dispose/用户中断类。DSH 的用户中断走 turn/end
//     reason.kind==='aborted'（dsh-agent-loop/lib/index.js:575-581），不会以
//     kind==='error' 进入本分类器；NO_FALLBACK_CODES 纯属防御（防未来演化；
//     'CANCELLED' 与 SubagentError code 同词汇，dsh-subagent/lib/index.js:1949）。
//   可切 — 其余一切 error 终局：能以 kind==='error' 结束 turn，说明 DSH 层
//     可重试集合（EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT，
//     dsh-llm/lib/index.js:360-366，默认 maxRetries 5）已耗尽，或不可重试集合
//     （HTTP 4xx 如 404/NO_ADAPTER/INVALID_CREDENTIAL/QUOTA/
//     CONTEXT_WINDOW_EXCEEDED 等，dsh-llm/lib/index.js:255-275,1416）立即终局。
//     插件层统一在终局切换，不区分「立即切/延后切」。
//   全缺失 — errorInfo 为 undefined/null 时返回 true（保守：有链则切，已获
//     用户批准）；调用方以 errorInfo===undefined 区分「确认错误」与「未知」，
//     日志措辞可据此分流。
//   内容安全 — rc.8 全量扫描错误码体系（dsh-llm/dsh-agent/dsh-subagent/
//     dsh-tools 等）无 SAFETY/CONTENT_FILTER/MODERATION 类 code，不设内容
//     安全不可切分支；未来若出现请补进 NO_FALLBACK_CODES。
// 未知 code 默认可切：DSH 契约「route on code, never parse message」
// （dsh-llm/lib/index.js:246），message 探测仅在 code 缺失/==='UNKNOWN'
// （裸 Error 的唯一出口）时作为 abort 特征防御启用。
const NO_FALLBACK_CODES = new Set(['ABORTED', 'CANCELLED', 'DISPOSED', 'INTERRUPTED'])
const ABORT_MESSAGE_RE = /\babort(?:ed|ion)?\b/i

export function isFallbackable(errorInfo) {
  if (errorInfo === undefined || errorInfo === null) return true
  const code = typeof errorInfo.code === 'string' ? errorInfo.code.toUpperCase() : undefined
  if (code !== undefined && NO_FALLBACK_CODES.has(code)) return false
  if (code === undefined || code === 'UNKNOWN') {
    if (typeof errorInfo.message === 'string' && ABORT_MESSAGE_RE.test(errorInfo.message)) return false
  }
  return true
}
