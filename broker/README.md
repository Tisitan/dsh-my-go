# broker/ — 归档的 TS 参考实现（不参与构建与运行）

> ⚠️ **Archived**：本目录是早期手写的 TypeScript 参考实现，已停止维护，
> 与运行时代码存在已知偏差（仍使用 `globalThis.harness.handle` 桥、
> 缺少 settings/RPC/list_subagents/followupPrompt/canOrchestrate、
> go_work/continue/forward 无鉴权、resume-before-followup 时序病等）。
> 另注：`src/host/model-binding.ts` 的 `DEFAULT_BINDINGS` 仍保留上游作者的
> 环境私货值（仅作历史快照）；tisitan.7 起运行时默认值已泛化为空绑定，
> 以 `preset/tools/broker.mjs` / `lib/index.js` 的 `defaultBindings()` 为准。

**实际运行代码请以外面两份为准**：

- `../preset/tools/broker.mjs` — agent 平面运行时（编排真源，preset 自包含）
- `../lib/index.js` — host 半（settings 命名空间 + RPC 桥 + preset 同步 + global 层 fallback）

本目录仅保留作历史参考。`broker/package.json` 直接以 `src/index.ts` 为入口
（Bun 风格），但没有任何构建产物依赖它；根 `tsconfig.json` 为 `noEmit`。
如非考古需要，请勿修改或引用本目录代码。
