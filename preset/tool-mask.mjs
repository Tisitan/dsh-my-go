// MyGO preset tool mask: hide environment-specific tools from this preset's
// catalog (Sisyphus AND sub-agents alike — the mask applies at preset scope).
// The deny list is configurable: add `config.deny` to the tool-mask row in
// agent.cordis.yml to override it entirely; when absent, DEFAULT_DENY below
// applies.
// Per-name try/catch: a tool absent from this deployment throws on restrict
// and is skipped (with a visible warning); the rest still apply and the
// preset mount never fails because of the mask.
export const inject = ['tools'];

// 默认清单仅是示例（来自某个部署的 MCP 工具名）——按你的环境裁剪，
// 或在 agent.cordis.yml 的 tool-mask 行用 config.deny 整体覆盖。
// 名单中工具在你的环境里大概率不存在，缺席时按名跳过（warn），不影响挂载。
const DEFAULT_DENY = [
  'mcp__vcp__daily_note_create_for_rei',
  'mcp__vcp__daily_note_update_for_rei',
  'mcp__vcp__light_memo_search_for_rei',
  'mcp__vcp__rei_memo_write',
  'mcp__vcp__opencode_task',
  'mcp__vcp__opencode_list_sessions',
  'mcp__vcp__opencode_delete_session',
];

export function apply(ctx, config = {}) {
  const deny = Array.isArray(config?.deny) && config.deny.length > 0
    ? config.deny.map(String)
    : DEFAULT_DENY;
  for (const name of deny) {
    try {
      ctx.tools.restrict({ deny: [name] });
    } catch (error) {
      console.warn(`[dsh-my-go] tool-mask: could not deny "${name}" (absent or reserved): ${String(error)}`);
    }
  }
}
