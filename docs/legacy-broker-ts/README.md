# docs/legacy-broker-ts/ — 归档的 TS 参考实现（不参与构建与运行）

> ⚠️ **停维护归档快照，仅供考古，勿改勿引。** 本目录是早期手写的 TypeScript
> 参考实现，tisitan.11 后未再同步，与运行时代码的偏差持续扩大：角色名册
> （roles dict / persona / toolFilter）、typeOfAgent 工种识别统一、台账与
> currentMap 养护闸（tisitan.15）等均不存在于此快照中。早期已知偏差
> （`globalThis.harness.handle` 桥、缺 settings/RPC/list_subagents/
> followupPrompt/canOrchestrate、go_work/continue/forward 无鉴权、
> resume-before-followup 时序病）同样未修。
> 另注：`src/host/model-binding.ts` 的 `DEFAULT_BINDINGS` 仍保留上游作者的
> 环境私货值（仅作历史快照）；tisitan.7 起运行时默认值已泛化为空绑定，
> 以 `preset/tools/broker.mjs` / `lib/index.js` 的 `defaultBindings()` 为准。

**实际运行代码请以以下两份为准**：

- `../../preset/tools/broker.mjs` — agent 平面运行时（编排真源，preset 自包含）
- `../../lib/index.js` — host 半（settings 命名空间 + RPC 桥 + preset 同步 + global 层 fallback）

本目录仅保留作历史参考。`package.json` 直接以 `src/index.ts` 为入口
（Bun 风格），但没有任何构建产物依赖它；根 `tsconfig.json` 的 include
指向本目录 `src`，仅做 `noEmit` 类型检查。如非考古需要，请勿修改或引用
本目录代码。
