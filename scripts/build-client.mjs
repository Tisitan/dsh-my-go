// Build the browser client bundle for dsh-my-go.
// Output: dist/client.js — a __ModuleLoader__.load({ id, factory }) wrapper
// around the esbuild CJS bundle; shared deps (react, @deepseek-ai/*) resolve
// through the loader's require, exactly like dsh-bash-terminal's client.

import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  outfile: join(root, "dist", "client.core.js"),
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  logLevel: "warning",
  // metafile（tisitan.20）：断言 bundle 的 inputs 覆盖全部 src 模块——
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

const core = readFileSync(join(root, "dist", "client.core.js"), "utf8");
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
console.log("built dist/client.js (" + Buffer.byteLength(wrapper, "utf8") + " bytes, " + srcModules.length + " src modules verified)");
