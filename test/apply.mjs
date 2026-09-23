// dsh-my-go smoke test: the host plugin module must load and export the
// expected Cordis plugin surface (name / inject / apply), and the client
// source must be syntactically valid.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = false;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
};

// 1. Host plugin module loads and exports the Cordis surface.
const mod = await import(pathToFileURL(join(root, "lib", "index.js")).href);
check("host exports name", mod.name === "dsh-my-go");
// 0.3.0-tisitan.0：编排面整体迁往 broker 半后 inject 收敛为存储/面板面依赖
// 0.1.7：settings 随配置面改声明式（顶层 Config）一并摘除——宿主经 apply(ctx, config)
// 交进已解析的段，配置面不再需要 settings 服务在席；llm 随 listModels 退役。
check("host exports inject (tools only; settings/llm retired)", Array.isArray(mod.inject) && mod.inject.includes("tools") && !mod.inject.includes("settings") && !mod.inject.includes("llm") && !mod.inject.includes("subagents"));
check("host exports apply function", typeof mod.apply === "function");
// 0.1.7 契约：配置面 schema 由顶层 Config 声明（lib/config.js），且必须是
// 客户端 import 图之外的独立文件——进了 src/ 的图，external 的 schemastery 会被
// esbuild 打进 dist/client.js，整张配置卡启动即死。
check("host exports Config (0.1.7 declaration surface)", typeof mod.Config === "function" && Array.isArray(mod.Config.dict) === false && Object.keys(mod.Config.dict).length === 4);

// 0.3.0-tisitan.0：lib 半编排面已切除——源码不得残留编排工具注册与编排事件钩子
// 0.4.0-tisitan.0：观测埋点（metrics）同属 broker 独有面，一并纳入负向断言
// 0.4.0 线 1.1：board 存储层（shared）不得回流 lib 半
// 0.4.0 线 1.2：摘要解析器（shared）不得回流 lib 半
const hostSrc = readFileSync(join(root, "lib", "index.js"), "utf-8");
check("host source has no orchestration surface", !hostSrc.includes("name: 'go_work'") && !hostSrc.includes("name: 'continue'") && !hostSrc.includes("ctx.on('subagent/end'") && !hostSrc.includes("orchestration-ledger.json") && !hostSrc.includes("createMetrics(") && !hostSrc.includes("writeBoard(") && !hostSrc.includes("parseSummaryBlock("));

// 2. Client source exists and is syntactically valid ESM.
const clientSrc = join(root, "src", "client.js");
check("client source exists", existsSync(clientSrc));
if (existsSync(clientSrc)) {
  try {
    await import(pathToFileURL(clientSrc).href + "?t=" + Date.now());
    check("client source parses", true);
  } catch (error) {
    check(`client source parses (${String(error)})`, false);
  }
}

// 3. Build artifact exists after `npm run build` (skip when absent).
const dist = join(root, "dist", "client.js");
check("dist/client.js exists (run npm run build first)", existsSync(dist));

// 3b. 新鲜度：src/ 任一文件比 dist 新 = 忘重建，浏览器跑的还是旧包（0.3.0-tisitan.8
// 起本批动过 src 三面，这条从流程约束变成断言）。
if (existsSync(dist)) {
  const { statSync } = await import("node:fs");
  const distMtime = statSync(dist).mtimeMs;
  const stale = readdirSync(join(root, "src"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => statSync(join(root, "src", f)).mtimeMs > distMtime);
  check(`dist/client.js is newer than every src module (stale: ${stale.join(", ") || "none"})`, stale.length === 0);
}

process.exit(failed ? 1 : 0);
