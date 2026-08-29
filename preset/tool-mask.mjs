// MyGO preset tool mask: hide tools from this preset's catalog (Sisyphus AND
// sub-agents alike — the mask applies at preset scope).
// The deny list is fully configurable (tisitan.13), resolved by resolveDeny():
//   1. `config.deny` on the tool-mask row in agent.cordis.yml — explicit
//      override, highest priority (an empty array explicitly masks nothing);
//   2. settings namespace 'dsh-my-go', key `toolMask.deny` — written by the
//      WebUI settings page ("工具屏蔽" block) via host RPC saveSettings;
//   3. DEFAULT_DENY below — empty since tisitan.13 (the previous hardcoded
//      example list of environment-specific MCP names is gone; deployments
//      that relied on it must re-configure their list in the settings page).
// Resolution happens once at preset mount (= session assembly), so mask
// changes take effect on NEW sessions only; running sessions are untouched.
// Per-name try/catch: a tool absent from this deployment (or a scope-local /
// reserved name) throws on restrict and is skipped (with a visible warning);
// the rest still apply and the preset mount never fails because of the mask.
export const inject = ['tools'];

// 形状示例（仅示意格式，不指向任何真实部署）：['mcp__your-origin__tool_a', ...]
// 默认为空 = 不屏蔽任何工具；清单请走设置页或 agent.cordis.yml 的 config.deny。
const DEFAULT_DENY = [];

/**
 * Pure deny-list resolution (exported for the node --test suite):
 * `config.deny` (explicit, any array) ?? settings `toolMask.deny` (array) ?? [].
 * Entries are coerced to strings; non-array sources are treated as absent.
 */
export function resolveDeny(config = {}, stored = undefined) {
  const fromConfig = Array.isArray(config?.deny) ? config.deny.map(String) : undefined;
  if (fromConfig) return fromConfig;
  const rows = stored && typeof stored === 'object' ? stored.toolMask : undefined;
  const fromSettings = Array.isArray(rows?.deny) ? rows.deny.map(String) : undefined;
  if (fromSettings) return fromSettings;
  return [...DEFAULT_DENY];
}

export function apply(ctx, config = {}) {
  let stored;
  try {
    // 只读不注册：settings 命名空间 'dsh-my-go' 由 host 半 lib/index.js 注册
    //（与 broker.mjs 的读取先例一致）；服务缺席时静默跳过该来源。
    stored = ctx.get?.('settings')?.get?.('dsh-my-go');
  } catch { /* settings 服务缺席/读档失败：回落 config/默认 */ }
  const deny = resolveDeny(config, stored);
  const source = Array.isArray(config?.deny) ? 'config.deny' : (Array.isArray(stored?.toolMask?.deny) ? 'settings' : 'default');
  for (const name of deny) {
    try {
      ctx.tools.restrict({ deny: [name] });
    } catch (error) {
      console.warn(`[dsh-my-go] tool-mask: could not deny "${name}" (absent or reserved): ${String(error)}`);
    }
  }
  if (deny.length > 0) {
    console.log(`[dsh-my-go] tool-mask: masked ${deny.length} tool(s) this session (source: ${source})`);
  }
}
