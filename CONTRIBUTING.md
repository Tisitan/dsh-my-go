# 贡献指南

## 环境

- Node.js 24 LTS、npm 11
- 仓库提交 `package-lock.json`，CI 走 `npm ci`（不要用裸 `npm install` 改锁文件）

## 起步

```bash
git clone https://github.com/Tisitan/dsh-my-go.git
cd dsh-my-go
npm ci
npm test
```

`npm test` = 构建 client bundle（`scripts/build-client.mjs`）→ preset 应用冒烟（`test/apply.mjs`）
→ 全量单测（`node --test "test/**/*.test.mjs"`）。另有 `build:client`（只重建 `dist/client.js`）、
`typecheck:archive`（`tsc --noEmit`，只覆盖 `docs/legacy-broker-ts/` 的 TS 档案）、
`dump:session`（会话档案取证 CLI）。

## 提交前

- `npm test` 必须全绿
- `dist/client.js` 由 `npm run build:client` 生成，改动 `src/` 后请一并重建，勿手工编辑
- 行为变化请附测试用例；修 bug 请附能复现的用例

## PR 约定

- commit message 用英文
- 不引入私有环境信息（主机名、内网地址、个人路径、凭据）
- 注释写**当前行为与约束**，不写沿革与过程叙事
- 一个 PR 一件事，范围之外的重构请另开 PR

## Issue

使用仓库的 Issue 模板（Bug 报告 / 功能请求）；安全问题走 [SECURITY.md](SECURITY.md)。
