// MyGO preset tool mask: hide tools from this preset's catalog (Sisyphus AND
// sub-agents alike — the mask applies at preset scope).
// The deny list is fully configurable (0.2.3-tisitan.13), resolved by resolveDeny():
//   1. `config.deny` on the tool-mask row in agent.cordis.yml — what the fork
//      itself requires masked (防旁路加固批起：上游邻接消息三件套);
//   2. settings namespace 'dsh-my-go', key `toolMask.deny` — written by the
//      WebUI settings page ("工具屏蔽" block) via host RPC saveSettings;
//   3. DEFAULT_DENY below — empty since 0.2.3-tisitan.13 (the previous hardcoded
//      example list of environment-specific MCP names is gone; deployments
//      that relied on it must re-configure their list in the settings page).
// The three sources are UNIONED (deduplicated), never one another's override:
// a fork-shipped security entry must not erase the user's own mask list, and
// the user's list must not be able to un-ship a security entry. (Before
// 0.3.0-tisitan.4 `config.deny` overrode settings — using it for anything at all
// silently dropped every entry configured in the WebUI.)
// Resolution happens once at preset mount (= session assembly), so mask
// changes take effect on NEW sessions only; running sessions are untouched.
// Per-name try/catch: a tool absent from this scope throws on restrict and is
// skipped; the rest still apply and the preset mount never fails because of the
// mask. Absent-name failures ("names unknown global tool") are an expected
// shape — under the web deployment the host does not register the adjacency
// trio at global scope, the agent-scope gate in broker.mjs is the real line of
// defence — so they are only counted and reported once on the summary line
// (which states how many names were actually restricted, plus the skipped
// list). Any other restrict error is a genuine anomaly and warns per name.
export const inject = ['tools'];

// 形状示例（仅示意格式，不指向任何真实部署）：['mcp__your-origin__tool_a', ...]
// 默认为空 = 不屏蔽任何工具；清单请走设置页或 agent.cordis.yml 的 `config.deny`。
const DEFAULT_DENY = [];

/**
 * Pure deny-list resolution (exported for the node --test suite):
 * union of `config.deny` (any array), settings `toolMask.deny` (array) and
 * DEFAULT_DENY — deduplicated, contribution order preserved (config first).
 * Entries are coerced to strings; non-array sources contribute nothing.
 */
export function resolveDeny(config = {}, stored = undefined) {
  const fromConfig = Array.isArray(config?.deny) ? config.deny.map(String) : [];
  const rows = stored && typeof stored === 'object' ? stored.toolMask : undefined;
  const fromSettings = Array.isArray(rows?.deny) ? rows.deny.map(String) : [];
  return [...new Set([...DEFAULT_DENY, ...fromConfig, ...fromSettings])];
}

export function apply(ctx, config = {}) {
  let stored;
  try {
    // 只读不注册：settings 命名空间 'dsh-my-go' 由 host 半 lib/index.js 注册
    //（与 broker.mjs 的读取先例一致）；服务缺席时静默跳过该来源。
    stored = ctx.get?.('settings')?.get?.('dsh-my-go');
  } catch { /* settings 服务缺席/读档失败：回落 config/默认 */ }
  const deny = resolveDeny(config, stored);
  const hasConfig = Array.isArray(config?.deny) && config.deny.length > 0;
  const hasSettings = Array.isArray(stored?.toolMask?.deny) && stored.toolMask.deny.length > 0;
  const source = hasConfig && hasSettings ? 'config.deny+settings' : hasConfig ? 'config.deny' : hasSettings ? 'settings' : 'default';
  let masked = 0;
  const unregistered = [];
  for (const name of deny) {
    try {
      ctx.tools.restrict({ deny: [name] });
      masked += 1;
    } catch (error) {
      const text = String(error);
      // 本作用域未注册该具（web 部署下的邻接三件套必然如此）：不是异常，
      // 防线在 broker agent 作用域闸——记名，随汇总行一次性报告。
      if (text.includes('names unknown global tool')) {
        unregistered.push(name);
        continue;
      }
      console.warn(`[dsh-my-go] tool-mask: could not deny "${name}" (reserved or scope-local): ${text}`);
    }
  }
  if (deny.length > 0) {
    const skippedNote = unregistered.length > 0
      ? ` (${unregistered.length} name(s) not registered at this scope; agent-scope gate covers them: ${unregistered.join(', ')})`
      : '';
    console.log(`[dsh-my-go] tool-mask: masked ${masked} tool(s) this session${skippedNote} (source: ${source})`);
  }
}
