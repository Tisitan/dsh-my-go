// Build the browser client bundle for dsh-my-go.
// Output: dist/client.js — a __ModuleLoader__.load({ id, factory }) wrapper
// around the esbuild CJS bundle; shared deps (react, @deepseek-ai/*) resolve
// through the loader's require, exactly like dsh-bash-terminal's client.
//
// esbuild 只出内存产物（write:false，D-13.1）：中间产物 client.core.js 从不落盘，
// dist/ 里永远只有发布要用的那一份 client.js。旧写法先写 client.core.js 再读回来
// 包一层，于是 dist/ 里长期挂着一份没人引用的裸 bundle——它会被 npm pack 收进
// 发布物（files 白名单是整目录 dist），而任何加载它的路径都不存在。

import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "dist"), { recursive: true });

const result = await build({
  entryPoints: [join(root, "src", "client.js")],
  absWorkingDir: root,
  bundle: true,
  format: "cjs",
  platform: "browser",
  outfile: join(root, "dist", "client.js"), // write:false 下仅作 metafile 记录用
  write: false,
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  logLevel: "warning",
  // metafile（0.2.3-tisitan.20）：断言 bundle 的 inputs 覆盖全部 src 模块——
  // 结构性堵「部分模块静默 tree-shake / 漏打包」空窗，断言失败非零退出
  metafile: true,
});

const toPosix = (p) => p.split("\\").join("/");
const bundled = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const input of Object.keys(output.inputs)) bundled.add(toPosix(input));
}
const srcModules = readdirSync(join(root, "src"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => toPosix(relative(root, join(root, "src", f))));
const missing = srcModules.filter((f) => !bundled.has(f));
if (missing.length > 0) {
  console.error("build assertion failed: src modules missing from bundle inputs: " + missing.join(", "));
  process.exit(1);
}

const [output] = result.outputFiles;
if (!output) {
  console.error("build assertion failed: esbuild returned no outputFiles (write:false)");
  process.exit(1);
}
const core = output.text;
const wrapper = `window.__ModuleLoader__.load({
	id: "dsh-my-go",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${core}
		return module.exports;
	}
});
`;
writeFileSync(join(root, "dist", "client.js"), wrapper);
// 清掉历史遗留的中间产物（旧版脚本会落盘 client.core.js）：dist/ 只该有一份
// 发布用的 client.js，多出来的裸 bundle 会跟着 files:["dist"] 进发布包。
const staleCore = join(root, "dist", "client.core.js");
if (existsSync(staleCore)) rmSync(staleCore);
console.log("built dist/client.js (" + Buffer.byteLength(wrapper, "utf8") + " bytes, " + srcModules.length + " src modules verified)");
