// MyGO preset tool mask: hide Rei-persona memory tools and the OpenCode
// bridge from this preset's catalog (Sisyphus AND sub-agents alike — the
// mask applies at preset scope). Synced from the `nova` preset recipe.
// Per-name try/catch: a tool absent from this deployment throws on restrict
// and is skipped (with a visible warning); the rest still apply and the
// preset mount never fails because of the mask.
export const inject = ['tools'];

const DENY = [
  'mcp__vcp__daily_note_create_for_rei',
  'mcp__vcp__daily_note_update_for_rei',
  'mcp__vcp__light_memo_search_for_rei',
  'mcp__vcp__rei_memo_write',
  'mcp__vcp__opencode_task',
  'mcp__vcp__opencode_list_sessions',
  'mcp__vcp__opencode_delete_session',
];

export function apply(ctx) {
  for (const name of DENY) {
    try {
      ctx.tools.restrict({ deny: [name] });
    } catch (error) {
      console.warn(`[dsh-my-go] tool-mask: could not deny "${name}" (absent or reserved): ${String(error)}`);
    }
  }
}
