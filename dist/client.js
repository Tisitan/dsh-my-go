window.__ModuleLoader__.load({
	id: "dsh-my-go",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var React5 = __toESM(require("react"), 1);

// src/panel-tree.js
var React = __toESM(require("react"), 1);

// src/panel-format.js
function shortId(id, len = 8) {
  return String(id ?? "").slice(0, Math.max(1, len));
}
function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function formatRelativeTime(ts, now = Date.now()) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  const n = Number(now);
  if (!Number.isFinite(n)) return null;
  let diff = Math.floor((n - t) / 1e3);
  if (diff < 0) diff = 0;
  if (diff < 10) return "\u521A\u521A";
  if (diff < 60) return `${diff} \u79D2\u524D`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} \u5929\u524D`;
  const d = new Date(t);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function extractFallbackNote(conclusion) {
  const raw = String(conclusion ?? "");
  const m = raw.match(/^[ \t]*\[备选\s*(\d+)\s*\/\s*(\d+)\]/m);
  if (!m) return { note: null, text: oneLine(raw) };
  return {
    note: `\u5907\u9009 ${m[1]}/${m[2]}`,
    text: oneLine(raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length))
  };
}

// src/client-constants.js
var AGENT_TYPES = ["sisyphus", "hermes", "explore", "librarian", "looker", "hephaestus", "prometheus", "oracle"];
var AGENT_LABELS = {
  sisyphus: "\u603B\u8C03\u5EA6\xB7\u8D28\u68C0 Sisyphus",
  hermes: "\u5FEB\u901F\u6267\u884C Hermes",
  explore: "\u5FEB\u901F\u68C0\u7D22 Explore",
  librarian: "\u6587\u6863\u67E5\u8BE2 Librarian",
  looker: "\u591A\u6A21\u6001\u770B\u56FE Looker",
  hephaestus: "\u4EE3\u7801\u7F16\u5199 Hephaestus",
  prometheus: "\u9700\u6C42\u89C4\u5212 Prometheus",
  oracle: "\u7591\u96BE/\u6781\u7AEF\u590D\u6742\u515C\u5E95 Oracle"
};
var typeLabel = (t) => AGENT_LABELS[t] ?? String(t ?? "?");
var AGENT_COLORS = {
  sisyphus: "#64b5f6",
  hermes: "#4db6ac",
  explore: "#4dd0e1",
  librarian: "#81c784",
  looker: "#ba68c8",
  hephaestus: "#ffb74d",
  prometheus: "#7986cb",
  oracle: "#e57373"
};
var AGENT_BLURBS = {
  sisyphus: "\u63A5\u9700\u6C42\u3001\u6D3E\u6D3B\u3001\u9A8C\u6536\u628A\u5173",
  hermes: "\u6307\u4EE4\u660E\u786E\u3001\u6B65\u9AA4\u5177\u4F53\u7684\u4F53\u529B\u6D3B",
  explore: "grep\u3001\u8BFB\u6587\u4EF6\u3001\u5B9A\u4F4D\u7B26\u53F7",
  librarian: "\u8BFB\u6587\u6863\u3001API \u53C2\u8003\u3001\u5386\u53F2\u8D44\u6599",
  looker: "\u8BC6\u522B\u622A\u56FE\u3001\u8BBE\u8BA1\u7A3F\u3001\u56FE\u8868",
  hephaestus: "\u5355\u6587\u4EF6\u91CD\u6784\u3001\u6A21\u5757\u5B9E\u73B0\u3001\u5199\u6D4B\u8BD5",
  prometheus: "\u7406\u89E3\u6A21\u7CCA\u9700\u6C42\uFF0C\u62C6\u89E3\u6210\u6B65\u9AA4",
  oracle: "\u5176\u4ED6\u5DE5\u79CD\u90FD\u641E\u4E0D\u5B9A\u65F6\u518D\u4E0A"
};
var typeName = (t) => {
  const s = String(t ?? "?");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
var ACCENT_RUNNING = "#26a69a";
var ACCENT_QUEUE = "#e6a23c";
var ACCENT_HELP = "#ef5350";
var ACCENT_FALLBACK = "#ce93d8";
var MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
var INTENT_LABELS = { explore: "\u68C0\u7D22", read_doc: "\u67E5\u6587\u6863", look_image: "\u770B\u56FE", replan: "\u8BF7\u6C42\u6362\u5DE5\u79CD", execute: "\u8BF7\u6C42\u4EE3\u6267\u884C", ask_user: "\u8BF7\u6C42\u95EE\u7528\u6237" };
var intentLabel = (i) => INTENT_LABELS[i] ?? String(i ?? "?");

// src/panel-tree.js
function createOrchestrationPanel({ slots, connection, sessions, timer }) {
  let panelOpen = false;
  let snapshot = { seq: 0, parents: {} };
  let snapshotLoaded = false;
  let bridgeProblem = null;
  let bridgeDetail = "";
  const POLL_BASE_MS = 600;
  const POLL_BACKOFF_MS = [600, 1500, 3e3];
  let pollInFlight = false;
  let pollBackoffStep = 0;
  let nextPollAt = 0;
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
      }
    }
  };
  function setBridgeProblem(problem, detail) {
    if (bridgeProblem === problem && bridgeDetail === (detail ?? "")) return false;
    bridgeProblem = problem;
    bridgeDetail = detail ?? "";
    if (problem === null) {
      console.warn("[dsh-my-go] panel: orchestration snapshot bridge recovered");
    } else {
      console.warn(`[dsh-my-go] panel: orchestration snapshot bridge ${problem === "internal" ? "threw inside the host" : "unavailable"}${bridgeDetail ? ` (${bridgeDetail})` : ""}`);
    }
    return true;
  }
  function notePollFailure(problem, detail) {
    pollBackoffStep = Math.min(pollBackoffStep + 1, POLL_BACKOFF_MS.length - 1);
    nextPollAt = Date.now() + POLL_BACKOFF_MS[pollBackoffStep];
    if (setBridgeProblem(problem, detail)) emit();
  }
  function notePollSuccess() {
    pollBackoffStep = 0;
    nextPollAt = 0;
    if (setBridgeProblem(null, "")) emit();
  }
  async function refresh() {
    if (pollInFlight) return;
    if (Date.now() < nextPollAt) return;
    if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") {
      notePollFailure("absent", "no rpc channel");
      return;
    }
    pollInFlight = true;
    try {
      const res = await connection.rpc.call("/dsh-my-go", "snapshot", {});
      if (res && res.ok) {
        const next = res.value;
        const firstFrame = !snapshotLoaded;
        const changed = next && next.seq !== snapshot.seq;
        if (next) {
          snapshot = next;
          snapshotLoaded = true;
        }
        notePollSuccess();
        if (changed || firstFrame) emit();
      } else if (res && res.error && res.error.code === "internal") {
        notePollFailure("internal", String(res.error.message ?? ""));
      } else {
        notePollFailure("absent", res ? "unexpected response envelope" : "no response");
      }
    } catch (error) {
      notePollFailure("absent", String(error));
    } finally {
      pollInFlight = false;
    }
  }
  const stopPolling = timer && typeof timer.interval === "function" ? timer.interval(() => {
    void refresh();
  }, POLL_BASE_MS) : void 0;
  function statusGlyph(status) {
    switch (status) {
      case "running":
        return "\u25CF";
      case "waiting":
        return "\u2753";
      case "spawning":
        return "\u25D0";
      case "queued":
        return "\u23F3";
      case "done":
        return "\u2713";
      case "failed":
        return "\u2717";
      default:
        return "\u25CB";
    }
  }
  function TreePanel(_props) {
    const [, force] = React.useState(0);
    const [rosterOpen, setRosterOpen] = React.useState(false);
    React.useEffect(() => {
      const rerender = () => force((c) => c + 1);
      listeners.add(rerender);
      const tick = setInterval(() => {
        if (panelOpen) force((c) => c + 1);
      }, 3e4);
      return () => {
        listeners.delete(rerender);
        clearInterval(tick);
      };
    }, []);
    if (!panelOpen) return null;
    const s = snapshot;
    const parents = s.parents && typeof s.parents === "object" ? s.parents : {};
    const parentList = Object.values(parents).filter((p) => p && p.parentSessionId !== "legacy");
    const multi = parentList.length > 1;
    const chip = (text, full, color) => React.createElement("span", {
      title: full ?? text,
      style: {
        flexShrink: 0,
        maxWidth: 110,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: MONO_FONT,
        fontSize: 10,
        lineHeight: "15px",
        padding: "0 5px",
        borderRadius: 4,
        color: color ?? "#9e9e9e",
        background: color ? `${color}22` : "rgba(255,255,255,0.07)"
      }
    }, text);
    const typeChip = (t) => React.createElement("span", {
      title: typeLabel(t),
      style: {
        flexShrink: 0,
        fontFamily: MONO_FONT,
        fontSize: 10,
        lineHeight: "15px",
        padding: "0 5px",
        borderRadius: 4,
        fontWeight: 600,
        color: AGENT_COLORS[t] ?? "#9e9e9e",
        background: `${AGENT_COLORS[t] ?? "#9e9e9e"}22`
      }
    }, typeName(t));
    const suffixChip = (pid) => multi ? chip(`\xB7${String(pid ?? "").slice(-6)}`, String(pid ?? "")) : null;
    const row = (opts, ...cells) => React.createElement(
      "div",
      {
        key: opts.key,
        onClick: opts.onClick,
        title: opts.title,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          padding: "3px 6px 3px 8px",
          marginBottom: 2,
          borderRadius: 4,
          borderLeft: `2px solid ${opts.accent ?? "transparent"}`,
          cursor: opts.onClick ? "pointer" : "default"
        }
      },
      React.createElement("span", { style: { flexShrink: 0, width: 14, textAlign: "center", color: opts.glyphColor } }, opts.glyph),
      ...cells
    );
    const tail = (text, title) => React.createElement("span", {
      title,
      style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#a0a0a0", fontSize: 12 }
    }, text);
    const jump = (childId, parentSessionId) => {
      if (sessions && typeof sessions.openSubagent === "function") {
        sessions.openSubagent({ parentSessionId: parentSessionId ?? "", childSessionId: childId, mode: "continuable" });
      }
    };
    const currents = parentList.filter((p) => p && p.current);
    const queues = parentList.flatMap((p) => Array.isArray(p?.queue) ? p.queue.map((w) => ({ ...w, parentSessionId: p.parentSessionId })) : []);
    const helps = parentList.flatMap((p) => Array.isArray(p?.helpRequests) ? p.helpRequests.map((h) => ({ ...h, parentSessionId: p.parentSessionId })) : []);
    const histories = parentList.flatMap((p) => Array.isArray(p?.history) ? p.history.map((r) => ({ ...r, parentSessionId: p.parentSessionId })) : []).sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
    const sectionHeader = (title, count, hint) => React.createElement(
      "div",
      { title: hint, style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } },
      React.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, title),
      React.createElement("span", { style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" } }, String(count))
    );
    return React.createElement(
      "div",
      {
        style: {
          position: "fixed",
          top: 64,
          right: 16,
          width: 320,
          maxHeight: "70vh",
          overflowY: "auto",
          background: "var(--surface, #1e1e1e)",
          border: "1px solid var(--separator, #333)",
          borderRadius: 8,
          padding: 12,
          zIndex: 9999,
          fontFamily: "var(--font, sans-serif)",
          fontSize: 13
        }
      },
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React.createElement("strong", null, "Sisyphus \u7F16\u6392"),
        React.createElement("button", { onClick: () => {
          panelOpen = false;
          emit();
        } }, "\xD7")
      ),
      bridgeProblem === "internal" ? React.createElement("div", {
        style: { marginBottom: 10, padding: "6px 8px", borderRadius: 6, background: "rgba(255,152,0,0.12)", border: "1px solid rgba(255,152,0,0.35)", fontSize: 12 }
      }, `\u26A0 host \u7AEF\u7F16\u6392\u5FEB\u7167\u8BFB\u53D6\u5F02\u5E38\uFF08\u88C5\u914D\u5DF2\u5B8C\u6210\uFF0C\u6865\u51FD\u6570\u629B\u9519\uFF09\uFF1A${bridgeDetail || "\u672A\u63D0\u4F9B\u539F\u56E0"}\uFF1B\u9762\u677F\u505C\u5728\u6700\u540E\u4E00\u6B21\u5B9E\u51B5\uFF0C\u6309\u9000\u907F\u8282\u594F\u81EA\u52A8\u91CD\u8BD5\u3002`) : bridgeProblem === "absent" ? React.createElement("div", {
        style: { marginBottom: 10, padding: "6px 8px", borderRadius: 6, background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", fontSize: 12 }
      }, "\u26A0 \u7F16\u6392\u6865\u672A\u5C31\u7EEA\uFF1Ahost \u7AEF /dsh-my-go RPC \u65E0\u54CD\u5E94\uFF08\u63D2\u4EF6\u672A\u6FC0\u6D3B\u6216\u4ECD\u5728\u542F\u52A8\uFF09\uFF0C\u9762\u677F\u5C06\u6301\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002") : null,
      // 运行中：保留区块（空时显示「空闲」，用户习惯看它），等待求助的条目用红色
      React.createElement(
        "div",
        { style: { marginBottom: 10 } },
        sectionHeader("\u8FD0\u884C\u4E2D", currents.length),
        currents.length > 0 ? currents.map((p) => {
          const c = p.current;
          const waiting = c.status === "waiting";
          return row(
            {
              key: `cur-${p.parentSessionId}-${c.childId ?? ""}`,
              glyph: statusGlyph(c.status),
              glyphColor: waiting ? ACCENT_HELP : ACCENT_RUNNING,
              accent: waiting ? ACCENT_HELP : ACCENT_RUNNING,
              onClick: c.childId ? () => jump(c.childId, p.parentSessionId) : void 0,
              title: c.childId ? `${typeLabel(c.agentType)}
${c.childId}` : typeLabel(c.agentType)
            },
            typeChip(c.agentType),
            suffixChip(p.parentSessionId),
            c.childId ? chip(shortId(c.childId), c.childId) : null
          );
        }) : React.createElement("div", { style: { color: "#888", fontSize: 12, padding: "2px 8px" } }, "\u25CB \u7A7A\u95F2")
      ),
      // 队列 / 求助：空时整区折叠隐藏（比显示「无」更干净）
      queues.length > 0 ? React.createElement(
        "div",
        { style: { marginBottom: 10 } },
        sectionHeader("\u961F\u5217", queues.length),
        queues.map((w, i) => row(
          {
            key: `q-${w.parentSessionId}-${w.id ?? i}`,
            glyph: "\u23F3",
            accent: ACCENT_QUEUE,
            title: String(w.id ?? "")
          },
          typeChip(w.agentType),
          suffixChip(w.parentSessionId),
          chip(shortId(w.id), w.id)
        ))
      ) : null,
      helps.length > 0 ? React.createElement(
        "div",
        { style: { marginBottom: 10 } },
        sectionHeader("\u6C42\u52A9", helps.length),
        helps.map((h, i) => row(
          {
            // 求助单 id 才是这一行的身份（tisitan.8 A-08）：同一儿童可以
            // 先后挂着两张不同 intent 的求助单，按 childId 做 key 会让 React
            // 把第二张就地复用成第一张（intent 文案串台）
            key: `hlp-${h.parentSessionId}-${h.id ?? i}`,
            glyph: "\u2753",
            accent: ACCENT_HELP,
            onClick: h.childId ? () => jump(h.childId, h.parentSessionId) : void 0,
            title: h.childId ? `${intentLabel(h.intent)}
${h.childId}` : intentLabel(h.intent)
          },
          React.createElement("span", { style: { flexShrink: 0 } }, intentLabel(h.intent)),
          suffixChip(h.parentSessionId),
          h.childId ? chip(shortId(h.childId), h.childId) : null
        ))
      ) : null,
      // 历史：工种彩色徽章 + [备选 n/m] 紫色徽章 + 结论单行省略 + 相对时间
      histories.length > 0 ? React.createElement(
        "div",
        null,
        sectionHeader("\u5386\u53F2", Math.min(8, histories.length), "\u4EC5\u663E\u793A\u6700\u8FD1 8 \u6761\u7ED3\u8BBA"),
        histories.slice(-8).map((r, i) => {
          const { note, text } = extractFallbackNote(r.conclusion);
          const rel = formatRelativeTime(r.updatedAt);
          const ts = Number(r.updatedAt);
          const abs = Number.isFinite(ts) && ts > 0 ? new Date(ts).toLocaleString() : null;
          const title = [typeLabel(r.agentType), abs, oneLine(r.conclusion)].filter(Boolean).join("\n");
          return row(
            {
              key: `his-${r.parentSessionId}-${r.childId ?? i}`,
              glyph: statusGlyph(r.status),
              onClick: r.childId ? () => jump(r.childId, r.parentSessionId) : void 0,
              title
            },
            typeChip(r.agentType),
            suffixChip(r.parentSessionId),
            note ? chip(note, `${note}\uFF08\u5907\u9009\u94FE\u81EA\u52A8\u91CD\u6D3E\uFF09`, ACCENT_FALLBACK) : null,
            tail(text, title),
            rel ? React.createElement("span", { style: { flexShrink: 0, color: "#777", fontSize: 11 } }, rel) : null
          );
        })
      ) : null,
      // 花名册常驻区（tisitan.15；tisitan.9 A-05 起吃结构化 roster）：渲染依据
      // 是 snapshot.roster 数组——表头文案、计数、行排版全部客户端自持。旧写法
      // 靠「rosterLines[0] 必为表头」的位置约定 slice(1) 取数、用 length-1 当
      // 计数，等于把 host 的字符串格式当 API：host 一改措辞（或哪天想加个脚注）
      // 这里就静默少一行或多渲染一行标题。rosterLines 只作旧 host 的兼容回落。
      (() => {
        const rows = Array.isArray(s.roster) ? s.roster : null;
        const legacyLines = !rows && Array.isArray(s.rosterLines) && s.rosterLines.length > 1 ? s.rosterLines.slice(1) : null;
        const count = rows ? rows.length : legacyLines ? legacyLines.length : 0;
        if (!rosterOpen) {
          return React.createElement(
            "div",
            {
              style: { cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 },
              onClick: () => setRosterOpen(true),
              title: "\u5C55\u5F00\u53EF\u6D3E\u89D2\u8272\u4E0E\u7ED1\u5B9A\u6458\u8981"
            },
            React.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, "\u25B8 \u82B1\u540D\u518C"),
            count > 0 ? React.createElement("span", { style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" } }, String(count)) : null
          );
        }
        return React.createElement(
          "div",
          { style: { marginBottom: 10 } },
          sectionHeader("\u82B1\u540D\u518C", count, "\u53EF\u6D3E\u89D2\u8272\u4E0E\u7ED1\u5B9A\u6458\u8981\uFF08\u70B9\u51FB\u6807\u9898\u6298\u53E0\uFF09"),
          rows ? rows.map((entry) => React.createElement(
            "div",
            {
              key: `ros-${entry?.role ?? ""}`,
              title: `${entry?.role ?? ""}\uFF1A${entry?.modelText ?? "\u8DDF\u968F\u73AF\u5883"}\uFF1B\u5907\u9009 ${Array.isArray(entry?.chain) ? entry.chain.length : 0} \u6761\uFF1B\u5DE5\u5177 ${entry?.toolFilterText ?? ""}\uFF1B\u4EBA\u8BBE ${entry?.personaSource ?? ""}`,
              style: { fontFamily: MONO_FONT, fontSize: 11, color: "#a0a0a0", padding: "2px 8px", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }
            },
            React.createElement("span", null, `${entry?.role ?? "?"}`),
            React.createElement("span", { style: { color: "#c8c8c8" } }, `\xB7 ${entry?.modelText ?? "\u8DDF\u968F\u73AF\u5883"}`),
            Array.isArray(entry?.chain) && entry.chain.length > 0 ? chip(`+${entry.chain.length}`, `\u5907\u9009\u94FE ${entry.chain.length} \u6761`, ACCENT_QUEUE) : null,
            entry?.builtin === false ? chip("\u81EA\u5B9A\u4E49", "\u81EA\u5B9A\u4E49\u89D2\u8272\uFF08\u4E0D\u5728\u5185\u7F6E\u516B\u5DE5\u79CD\u5185\uFF09") : null
          )) : legacyLines ? legacyLines.map((line, i) => React.createElement("div", {
            key: `ros-${i}`,
            title: line,
            style: { fontFamily: MONO_FONT, fontSize: 11, color: "#a0a0a0", padding: "2px 8px", overflowWrap: "anywhere" }
          }, line)) : React.createElement("div", { style: { color: "#888", fontSize: 12, padding: "2px 8px" } }, "\u82B1\u540D\u518C\u4E0D\u53EF\u7528\uFF08host \u672A\u5C31\u7EEA\uFF09")
        );
      })()
    );
  }
  slots.inject("shell.overlay", () => slots.register(
    { name: "shell.overlay", id: "dsh-my-go-panel" },
    (props) => React.createElement(TreePanel, props)
  ));
  slots.inject("sidebar.footer.action", () => slots.register(
    { name: "sidebar.footer.action", id: "dsh-my-go-toggle" },
    (props) => React.createElement("button", {
      onClick: () => {
        panelOpen = !panelOpen;
        emit();
      },
      title: "Sisyphus \u7F16\u6392\u9762\u677F",
      style: { width: props && props.wide ? "100%" : 32, height: 32, border: "none", background: "transparent", cursor: "pointer" }
    }, "\u{1F9ED}")
  ));
  let lastJumped = null;
  const currentSessionId = () => {
    try {
      const list = sessions?.list;
      if (list && typeof list.getSnapshot === "function") {
        const current = list.getSnapshot()?.current;
        if (typeof current === "string" && current) return current;
      }
    } catch {
    }
    return void 0;
  };
  const unsub = () => {
    listeners.delete(refresh);
  };
  listeners.add(refresh);
  const stopAutoJump = timer && typeof timer.interval === "function" ? timer.interval(() => {
    if (!sessions) return;
    const parents = snapshot.parents && typeof snapshot.parents === "object" ? snapshot.parents : {};
    const running = Object.values(parents).filter((p) => p?.current?.childId && p.current.status === "running");
    const myId = currentSessionId();
    if (lastJumped) {
      const owner = parents[lastJumped.parentSessionId];
      const stillRunning = owner?.current?.childId === lastJumped.childId && owner.current.status === "running";
      if (stillRunning) return;
      const { childId, parentSessionId: pid } = lastJumped;
      lastJumped = null;
      const gated = myId !== void 0 ? myId === pid || myId === childId : Object.keys(parents).length <= 1;
      if (gated && pid && typeof sessions.open === "function") {
        try {
          sessions.open(pid);
        } catch {
        }
      }
      return;
    }
    if (running.length === 0) return;
    let target;
    if (myId !== void 0) {
      target = running.find((p) => p.parentSessionId === myId);
    } else if (running.length === 1) {
      target = running[0];
    }
    if (!target) return;
    lastJumped = { childId: target.current.childId, parentSessionId: target.parentSessionId };
    try {
      sessions.openSubagent({
        parentSessionId: target.parentSessionId,
        childSessionId: target.current.childId,
        mode: "continuable"
      });
    } catch {
    }
  }, 800) : void 0;
  return () => {
    if (stopPolling) stopPolling();
    if (stopAutoJump) stopAutoJump();
    unsub();
  };
}

// src/settings-core.js
var React4 = __toESM(require("react"), 1);

// src/chain-rows.js
function normalizeChainRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === "object").map((r) => ({
    provider: typeof r.provider === "string" ? r.provider : "",
    model: typeof r.model === "string" ? r.model : ""
  }));
}
function composeChain(row) {
  const r = row && typeof row === "object" ? row : {};
  return [
    {
      provider: typeof r.provider === "string" ? r.provider : "",
      model: typeof r.model === "string" ? r.model : ""
    },
    ...normalizeChainRows(r.fallbacks)
  ];
}
function decomposeChain(chain) {
  const rows = normalizeChainRows(chain);
  const [primary, ...rest] = rows;
  return {
    provider: primary?.provider ?? "",
    model: primary?.model ?? "",
    fallbacks: rest
  };
}
function stripEmptyFallbackRows(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) return shape;
  if (!Array.isArray(shape.fallbacks)) return shape;
  const kept = shape.fallbacks.filter((e) => {
    if (!e || typeof e !== "object") return false;
    const provider = typeof e.provider === "string" ? e.provider : "";
    const model = typeof e.model === "string" ? e.model : "";
    return provider !== "" || model !== "";
  });
  if (kept.length === shape.fallbacks.length) return shape;
  return { ...shape, fallbacks: kept };
}
function addChainEntry(chain, entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  return [
    ...normalizeChainRows(chain),
    {
      provider: typeof e.provider === "string" ? e.provider : "",
      model: typeof e.model === "string" ? e.model : ""
    }
  ];
}
function removeChainEntry(chain, index) {
  const next = normalizeChainRows(chain);
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  if (next.length <= 1) return next;
  return next.filter((_, i) => i !== index);
}
function moveChainEntry(chain, index, dir) {
  const next = normalizeChainRows(chain);
  if (!Number.isInteger(index) || !Number.isInteger(dir)) return next;
  const target = index + dir;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const out = [...next];
  const [row] = out.splice(index, 1);
  out.splice(target, 0, row);
  return out;
}
function updateChainEntry(chain, index, field, value) {
  const next = normalizeChainRows(chain);
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  if (field !== "provider" && field !== "model") return next;
  const v = typeof value === "string" ? value : "";
  return next.map((row, i) => {
    if (i !== index) return row;
    if (field === "provider") return { provider: v, model: "" };
    return { ...row, model: v };
  });
}

// src/roster-rows.js
var ROLE_KEY_PATTERN = /^[a-z][a-z-]*$/;
function isValidRoleKey(key) {
  return typeof key === "string" && ROLE_KEY_PATTERN.test(key);
}
function normalizeNameList(value) {
  if (!Array.isArray(value)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}
function normalizeRoleRows(value, builtinKeys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const builtin = new Set(Array.isArray(builtinKeys) ? builtinKeys : []);
  return Object.entries(value).filter(([key, row]) => isValidRoleKey(key) && !builtin.has(key) && row !== null && typeof row === "object").map(([key, row]) => ({
    key,
    provider: typeof row.provider === "string" ? row.provider : "",
    model: typeof row.model === "string" ? row.model : "",
    reasoningEffort: typeof row.reasoningEffort === "string" ? row.reasoningEffort : "",
    dsv4p0813: row.dsv4p0813 === true,
    fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks : [],
    persona: typeof row.persona === "string" ? row.persona : "",
    allow: normalizeNameList(row.toolFilter?.allow),
    deny: normalizeNameList(row.toolFilter?.deny)
  }));
}
function mergeRoleRowsIntoRoles(oldRoles, nextRows, builtinKeys = []) {
  const source = oldRoles && typeof oldRoles === "object" ? oldRoles : {};
  const builtin = new Set(Array.isArray(builtinKeys) ? builtinKeys : []);
  const builtinPart = {};
  for (const key of Object.keys(source)) {
    if (builtin.has(key) && source[key] && typeof source[key] === "object") builtinPart[key] = source[key];
  }
  const touchedKeys = new Set(nextRows.map((row) => row.key));
  const dirtyPart = {};
  for (const key of Object.keys(source)) {
    if (builtin.has(key) || touchedKeys.has(key)) continue;
    if (isValidRoleKey(key) && source[key] !== null && typeof source[key] === "object") continue;
    dirtyPart[key] = source[key];
  }
  const customPart = {};
  for (const row of nextRows) {
    customPart[row.key] = {
      provider: row.provider,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      dsv4p0813: row.dsv4p0813,
      fallbacks: row.fallbacks,
      persona: row.persona,
      toolFilter: { allow: row.allow, deny: row.deny }
    };
  }
  return { ...builtinPart, ...dirtyPart, ...customPart };
}
function addRoleRow(rows, key) {
  if (!isValidRoleKey(key)) return rows;
  if (rows.some((row) => row.key === key)) return rows;
  return [...rows, { key, provider: "", model: "", reasoningEffort: "", dsv4p0813: false, fallbacks: [], persona: "", allow: [], deny: [] }];
}
function removeRoleRow(rows, key) {
  return rows.filter((row) => row.key !== key);
}
var ROLE_FIELDS = /* @__PURE__ */ new Set(["provider", "model", "reasoningEffort", "dsv4p0813", "persona", "fallbacks", "allow", "deny"]);
function updateRoleRow(rows, key, field, value) {
  if (!ROLE_FIELDS.has(field)) return rows;
  return rows.map((row) => {
    if (row.key !== key) return row;
    if (field === "provider") {
      return { ...row, provider: typeof value === "string" ? value : "", model: "" };
    }
    if (field === "dsv4p0813") {
      return { ...row, dsv4p0813: value === true };
    }
    if (field === "fallbacks" || field === "allow" || field === "deny") {
      return { ...row, [field]: Array.isArray(value) ? value : [] };
    }
    return { ...row, [field]: typeof value === "string" ? value : "" };
  });
}
function addRoleToolEntry(rows, key, side, name2) {
  if (side !== "allow" && side !== "deny") return rows;
  if (typeof name2 !== "string" || name2.trim() === "") return rows;
  const clean = name2.trim();
  return rows.map((row) => {
    if (row.key !== key || row[side].includes(clean)) return row;
    return { ...row, [side]: [...row[side], clean] };
  });
}
function removeRoleToolEntry(rows, key, side, index) {
  if (side !== "allow" && side !== "deny") return rows;
  return rows.map((row) => {
    if (row.key !== key || !Number.isInteger(index) || index < 0 || index >= row[side].length) return row;
    return { ...row, [side]: row[side].filter((_, i) => i !== index) };
  });
}
function roleSummaryText(row) {
  const model = row.provider && row.model ? `${row.provider}\xB7${row.model}` : row.model ? `?\xB7${row.model}` : row.provider ? `${row.provider}\xB7\u8DDF\u968F\u73AF\u5883` : "\u8DDF\u968F\u73AF\u5883";
  const chain = Array.isArray(row.fallbacks) ? row.fallbacks.length : 0;
  let tf = "\u5168\u91CF\uFF08\u9664\u5168\u5C40\u63A9\u7801\uFF09";
  if (row.allow.length > 0 || row.deny.length > 0) {
    const parts = [];
    if (row.allow.length > 0) parts.push(`\u4EC5 ${row.allow.join(", ")}`);
    if (row.deny.length > 0) parts.push(`\u9664 ${row.deny.join(", ")}`);
    tf = parts.join("\uFF1B");
  }
  const personaFirstLine = row.persona.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  return `${model} | \u5907\u9009${chain} | ${tf}${personaFirstLine ? ` | ${personaFirstLine.slice(0, 60)}` : ""}`;
}
function builtinSummaryText(cfg) {
  const row = cfg && typeof cfg === "object" ? cfg : {};
  const provider = typeof row.provider === "string" ? row.provider : "";
  const model = typeof row.model === "string" ? row.model : "";
  const binding = provider && model ? `${provider}\xB7${model}` : provider ? `${provider}\xB7\u8DDF\u968F Sisyphus` : model ? `\u8DDF\u968F Sisyphus\xB7${model}` : "\u8DDF\u968F Sisyphus";
  const effort = typeof row.reasoningEffort === "string" && row.reasoningEffort !== "" ? row.reasoningEffort : "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4";
  const chain = Array.isArray(row.fallbacks) ? row.fallbacks.length : 0;
  return `${binding} | ${effort} | \u5907\u9009 ${chain} \u6761`;
}
function withPersonaOverride(existingRow, text) {
  const base = existingRow && typeof existingRow === "object" && !Array.isArray(existingRow) ? existingRow : {};
  return { ...base, persona: typeof text === "string" ? text : "" };
}
function personaOverrideSource(existingRow) {
  const hasOverride = existingRow !== null && typeof existingRow === "object" && typeof existingRow.persona === "string" && existingRow.persona.length > 0;
  return hasOverride ? "\u5DF2\u8986\u76D6\uFF08\u4FDD\u5B58\u540E\u66FF\u6362\u6587\u4EF6\u9ED8\u8BA4\uFF09" : "\u6587\u4EF6\u9ED8\u8BA4";
}
function resolveBuiltinPersonaResult(res) {
  const persona = res?.value?.persona;
  if (res && res.ok === true && typeof persona === "string") return { ok: true, persona };
  const message = typeof res?.error?.message === "string" && res.error.message !== "" ? res.error.message : "\u4EBA\u8BBE\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25";
  return { ok: false, message };
}
function buildRoleCardJson(row) {
  if (!row || typeof row !== "object") return "{}";
  return JSON.stringify({
    key: typeof row.key === "string" ? row.key : "",
    provider: row.provider ?? "",
    model: row.model ?? "",
    reasoningEffort: row.reasoningEffort ?? "",
    dsv4p0813: row.dsv4p0813 === true,
    fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks : [],
    persona: row.persona ?? "",
    toolFilter: { allow: Array.isArray(row.allow) ? row.allow : [], deny: Array.isArray(row.deny) ? row.deny : [] }
  }, null, 2);
}
function parseRoleCardJson(text, existingKeys = []) {
  const fail = (error) => ({ ok: false, error });
  let raw;
  try {
    raw = JSON.parse(typeof text === "string" ? text : "");
  } catch {
    return fail("\u4E0D\u662F\u5408\u6CD5 JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("\u9876\u5C42\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!isValidRoleKey(key)) return fail(`key \u4E0D\u5408\u6CD5\uFF1A\u987B\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u3001\u53EA\u542B\u5C0F\u5199\u4E0E\u8FDE\u5B57\u7B26\uFF08\u6536\u5230 ${JSON.stringify(raw.key ?? null)}\uFF09`);
  if (existingKeys.includes(key)) return fail(`key\u300C${key}\u300D\u5DF2\u5B58\u5728\uFF08\u5185\u7F6E\u5DE5\u79CD\u6216\u5DF2\u6709\u81EA\u5B9A\u4E49\u89D2\u8272\u4E0D\u53EF\u8986\u76D6\uFF0C\u5148\u5220\u9664\u518D\u5BFC\u5165\uFF09`);
  const fallbacks = Array.isArray(raw.fallbacks) ? raw.fallbacks.filter((e) => e !== null && typeof e === "object" && typeof e.provider === "string" && typeof e.model === "string") : [];
  const filter = raw.toolFilter !== null && typeof raw.toolFilter === "object" ? raw.toolFilter : {};
  const names = (v) => Array.isArray(v) ? [...new Set(v.filter((n) => typeof n === "string" && n !== ""))] : [];
  return {
    ok: true,
    row: {
      key,
      provider: typeof raw.provider === "string" ? raw.provider : "",
      model: typeof raw.model === "string" ? raw.model : "",
      reasoningEffort: typeof raw.reasoningEffort === "string" ? raw.reasoningEffort : "",
      dsv4p0813: raw.dsv4p0813 === true,
      fallbacks,
      persona: typeof raw.persona === "string" ? raw.persona : "",
      allow: names(filter.allow),
      deny: names(filter.deny)
    }
  };
}

// src/settings-guard.js
function isConflictError(error) {
  return !!error && (error.code === "conflict" || error.code === "SETTINGS_CONFLICT");
}
function interpretLoadResult(res) {
  if (!res || res.ok !== true || !res.value || typeof res.value !== "object" || Array.isArray(res.value)) {
    return { status: "failed", draft: null, revision: null };
  }
  const { revision, ...draft } = res.value;
  return {
    status: "ok",
    draft,
    revision: typeof revision === "number" && Number.isFinite(revision) ? revision : null
  };
}
function interpretSaveResult(res) {
  const revision = res && res.ok && res.value && typeof res.value === "object" && typeof res.value.revision === "number" ? res.value.revision : null;
  if (res && res.ok) return { status: "saved", message: "\u5DF2\u4FDD\u5B58", revision };
  const error = res && res.error ? res.error : null;
  if (isConflictError(error)) {
    const details = error.details && typeof error.details === "object" ? error.details : {};
    const moved = typeof details.actual === "number" ? `\uFF08\u4ED6\u5904\u5DF2\u6539\u5230 r${details.actual}\uFF09` : "";
    return { status: "conflict", message: `\u4ED6\u5904\u5DF2\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D${moved}`, revision: null };
  }
  return { status: "failed", message: "\u4FDD\u5B58\u5931\u8D25: " + (error && error.message || "\u672A\u77E5\u9519\u8BEF"), revision: null };
}
function attachBeforeUnloadGuard(win) {
  if (!win || typeof win.addEventListener !== "function") return () => {
  };
  const handler = (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event) event.returnValue = "";
    return "";
  };
  win.addEventListener("beforeunload", handler);
  return () => {
    if (typeof win.removeEventListener === "function") win.removeEventListener("beforeunload", handler);
  };
}

// src/roles-editor.js
var React2 = __toESM(require("react"), 1);
function renderRolesEditor(deps) {
  const {
    draft,
    setDraft,
    newRoleKey,
    setNewRoleKey,
    roleToolDrafts,
    setRoleToolDrafts,
    importError,
    setImportError,
    openCards,
    setOpenCards,
    EFFORTS,
    effortLabel,
    makeSelect,
    renderChainEditor,
    styles
  } = deps;
  const { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle, rowStyle } = styles;
  const roleRows = normalizeRoleRows(draft?.roles, AGENT_TYPES);
  const applyRoleRows = (nextRows) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, roles: mergeRoleRowsIntoRoles(prev.roles, nextRows, AGENT_TYPES) };
    });
  };
  const editRole = (key, mutate) => {
    if (!draft) return;
    applyRoleRows(mutate(roleRows));
  };
  const createRole = () => {
    if (!draft) return;
    const key = newRoleKey.trim();
    if (!isValidRoleKey(key)) return;
    if (AGENT_TYPES.includes(key)) return;
    if (roleRows.some((row) => row.key === key)) return;
    if (draft?.roles && typeof draft.roles === "object" && draft.roles[key]) return;
    applyRoleRows(addRoleRow(roleRows, key));
    setNewRoleKey("");
    setOpenCards((prev) => ({ ...prev, [key]: true }));
  };
  const roleToolDraft = (key, side) => roleToolDrafts?.[key]?.[side] ?? "";
  const setRoleToolDraft = (key, side, value) => {
    setRoleToolDrafts((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: value } }));
  };
  const exportRole = async (row) => {
    const json = buildRoleCardJson(row);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      window.prompt("\u526A\u8D34\u677F\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u8BE5\u89D2\u8272 JSON\uFF1A", json);
    }
  };
  const importRole = () => {
    if (!draft) return;
    const text = window.prompt("\u7C98\u8D34\u89D2\u8272 JSON\uFF08\u53EF\u5148\u5728\u522B\u5904\u5BFC\u51FA\uFF0C\u6539 key \u540E\u5BFC\u5165\uFF09\uFF1A");
    if (text === null || text.trim() === "") return;
    const existingKeys = [...AGENT_TYPES, ...roleRows.map((row) => row.key)];
    const parsed = parseRoleCardJson(text, existingKeys);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setImportError("");
    applyRoleRows([...roleRows, parsed.row]);
  };
  const renderRoleToolList = (row, side) => {
    const names = row[side];
    const draftValue = roleToolDraft(row.key, side);
    const listId = `role-tf-${row.key}-${side}`;
    return React2.createElement(
      "div",
      null,
      React2.createElement("div", { style: labelStyle }, side === "allow" ? "\u5DE5\u5177\u767D\u540D\u5355\uFF08allow\uFF09" : "\u5DE5\u5177\u9ED1\u540D\u5355\uFF08deny\uFF09"),
      names.length === 0 ? React2.createElement("div", { style: hintStyle }, side === "allow" ? "\uFF08\u7A7A = \u5168\u91CF\uFF0C\u9664\u5168\u5C40\u63A9\u7801\uFF09" : "\uFF08\u7A7A = \u4E0D\u989D\u5916\u5C4F\u853D\uFF09") : React2.createElement(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 } },
        names.map((name2, i) => React2.createElement(
          "span",
          {
            key: `${row.key}-${side}-${name2}`,
            title: name2,
            style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: MONO_FONT, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.07)", color: "#bbb" }
          },
          React2.createElement("span", { style: { overflowWrap: "anywhere" } }, name2),
          React2.createElement("span", {
            role: "button",
            title: "\u79FB\u9664",
            style: { cursor: draft ? "pointer" : "not-allowed", color: "#e57373" },
            onClick: () => {
              if (draft) editRole(row.key, (rows) => removeRoleToolEntry(rows, row.key, side, i));
            }
          }, "\xD7")
        ))
      ),
      React2.createElement(
        "div",
        { style: { display: "flex", gap: 6 } },
        React2.createElement("input", {
          value: draftValue,
          list: listId,
          placeholder: "\u5DE5\u5177\u540D\uFF08\u82B1\u540D\u518C\u53EF\u70B9\u9009\uFF0C\u4E5F\u53EF\u624B\u586B\u672A\u8FDE\u63A5\u5DE5\u5177\uFF09\u2026",
          disabled: !draft,
          onChange: (e) => setRoleToolDraft(row.key, side, e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && draftValue.trim() !== "") {
              editRole(row.key, (rows) => addRoleToolEntry(rows, row.key, side, draftValue.trim()));
              setRoleToolDraft(row.key, side, "");
            }
          },
          style: { ...selectStyle, fontFamily: MONO_FONT }
        }),
        React2.createElement(
          "datalist",
          { id: listId },
          deps.roster.map((name2) => React2.createElement("option", { key: name2, value: name2 }))
        ),
        React2.createElement("button", {
          style: miniBtnStyle,
          disabled: !draft || draftValue.trim() === "",
          title: "\u52A0\u5165\u540D\u5355",
          onClick: () => {
            editRole(row.key, (rows) => addRoleToolEntry(rows, row.key, side, draftValue.trim()));
            setRoleToolDraft(row.key, side, "");
          }
        }, "+ \u6DFB\u52A0")
      )
    );
  };
  const toggleCard = (id) => setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }));
  const cardOpen = (id) => openCards[id] === true;
  return React2.createElement(
    "div",
    { style: cardStyle },
    React2.createElement(
      "div",
      { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 } },
      React2.createElement("span", { style: { fontWeight: 600 } }, "\u81EA\u5B9A\u4E49\u89D2\u8272\uFF08Custom Roles\uFF09"),
      React2.createElement("span", { style: { fontSize: 12, color: "var(--text-secondary, #888)" } }, "\u53EF\u88AB go_work \u6D3E\u53D1\u7684\u81EA\u5EFA\u89D2\u8272\uFF1A\u72EC\u7ACB\u4EBA\u8BBE\u4E0E\u5DE5\u5177\u9762\uFF0C\u7ECF spawn \u6B63\u7EDF\u901A\u9053\u6CE8\u5165")
    ),
    React2.createElement(
      "div",
      { style: { ...hintStyle, marginBottom: 8 } },
      "\u4EBA\u8BBE\u7559\u7A7A = \u5B50\u4EE3\u7406\u4EC5\u5E26\u90E8\u7F72\u57FA\u7840\u4EBA\u8BBE\uFF1B\u5DE5\u5177\u9762\u7559\u7A7A = \u5168\u91CF\uFF08\u9664\u5168\u5C40\u63A9\u7801\uFF09\u3002\u540D\u5B57\u521B\u5EFA\u540E\u4E0D\u53EF\u6539\uFF08\u5220\u9664\u91CD\u5EFA\u5373\u53EF\uFF09\uFF1B\u5185\u7F6E\u516B\u5DE5\u79CD\uFF08\u542B sisyphus\uFF09\u4E0D\u5728\u6B64\u5217\uFF0C\u7528\u4E0A\u65B9\u5361\u7247\u914D\u7F6E\u3002"
    ),
    roleRows.length === 0 ? React2.createElement("div", { style: { fontSize: 12, color: "var(--text-secondary, #888)", marginBottom: 8 } }, "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u89D2\u8272") : roleRows.map((row) => {
      const open = cardOpen(`role-${row.key}`);
      return React2.createElement(
        "div",
        { key: `role-${row.key}`, style: { border: "1px solid var(--separator, #333)", borderRadius: 6, padding: 10, marginBottom: 8 } },
        React2.createElement(
          "div",
          {
            style: { cursor: "pointer", marginBottom: open ? 8 : 0 },
            onClick: () => toggleCard(`role-${row.key}`)
          },
          React2.createElement(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } },
            React2.createElement("span", { style: glyphStyle }, open ? "\u25BE" : "\u25B8"),
            React2.createElement("span", { style: { fontWeight: 600, fontFamily: MONO_FONT } }, row.key),
            React2.createElement("button", {
              style: { ...miniBtnStyle, marginLeft: "auto" },
              title: `\u5BFC\u51FA\u89D2\u8272 ${row.key} \u4E3A JSON \u5E76\u590D\u5236\u5230\u526A\u8D34\u677F`,
              onClick: (e) => {
                e.stopPropagation();
                void exportRole(row);
              }
            }, "\u5BFC\u51FA"),
            React2.createElement("button", {
              style: miniBtnStyle,
              title: `\u5220\u9664\u89D2\u8272 ${row.key}\uFF08\u4FDD\u5B58\u540E\u751F\u6548\uFF09`,
              disabled: !draft,
              onClick: (e) => {
                e.stopPropagation();
                editRole(row.key, (rows) => removeRoleRow(rows, row.key));
              }
            }, "\u5220\u9664")
          ),
          React2.createElement("div", { style: summaryStyle }, roleSummaryText(row))
        ),
        open ? React2.createElement(
          React2.Fragment,
          null,
          // 模型优先级列表（tisitan.19）：主选（#1）与备选链合并编辑，
          // 与内置工种卡共用 renderChainEditor；写回经 roster-rows 纯函数
          // （fallbacks 整组替换 → provider（重置 model）→ model 定序写入）
          renderChainEditor(`role-${row.key}`, row, ({ provider, model, fallbacks }) => editRole(row.key, (rs) => updateRoleRow(updateRoleRow(updateRoleRow(rs, row.key, "fallbacks", fallbacks), row.key, "provider", provider), row.key, "model", model)), !draft),
          React2.createElement(
            "div",
            { style: rowStyle },
            React2.createElement(
              "div",
              null,
              React2.createElement("div", { style: labelStyle }, "\u601D\u8003\u6863\u4F4D\uFF08Reasoning Effort\uFF09"),
              makeSelect(row.reasoningEffort, EFFORTS, effortLabel, (v) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, "reasoningEffort", v)), !draft)
            ),
            React2.createElement(
              "div",
              null,
              React2.createElement("div", { style: labelStyle }, "DSV4P0813 \u8865\u4E01"),
              React2.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: 6, cursor: draft ? "pointer" : "not-allowed", fontSize: 13, paddingTop: 2 } },
                React2.createElement("input", { type: "checkbox", checked: row.dsv4p0813 === true, disabled: !draft, onChange: (e) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, "dsv4p0813", e.target.checked)) }),
                "\u542F\u7528"
              ),
              React2.createElement("div", { style: hintStyle }, "\u4E24\u9636\u6BB5\u951A\u5B9A\u4E0A\u4E0B\u6587\u6CE8\u5165\uFF0C\u4E13\u4E3A DeepSeek V4 Pro 0813 \u8C03\u6821\uFF0C\u5176\u4ED6\u6A21\u578B\u52FF\u5F00")
            )
          ),
          React2.createElement(
            "div",
            { style: { marginBottom: 8 } },
            React2.createElement("div", { style: labelStyle }, "\u4EBA\u8BBE\uFF08Persona\uFF09"),
            React2.createElement("div", { style: hintStyle, marginBottom: 4 }, "\u7ECF spawn \u901A\u9053\u6CE8\u5165\u5B50\u4EE3\u7406\u7CFB\u7EDF\u63D0\u793A\uFF0C\u9996\u884C\u4F5C\u4E3A\u89D2\u8272\u6458\u8981\u5C55\u793A"),
            React2.createElement("textarea", {
              value: row.persona,
              disabled: !draft,
              rows: 3,
              placeholder: "\u7559\u7A7A = \u8DDF\u968F\u90E8\u7F72\u57FA\u7840\u4EBA\u8BBE",
              onChange: (e) => editRole(row.key, (rows) => updateRoleRow(rows, row.key, "persona", e.target.value)),
              style: { ...selectStyle, resize: "vertical", fontFamily: "inherit" }
            })
          ),
          React2.createElement(
            "div",
            { style: rowStyle },
            renderRoleToolList(row, "allow"),
            renderRoleToolList(row, "deny")
          )
        ) : null
      );
    }),
    React2.createElement(
      "div",
      { style: { display: "flex", gap: 8, alignItems: "center" } },
      React2.createElement("input", {
        value: newRoleKey,
        placeholder: "\u65B0\u89D2\u8272\u540D\uFF08\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u4EC5\u5C0F\u5199\u4E0E\u8FDE\u5B57\u7B26\uFF0C\u5982 coder-x\uFF09\u2026",
        disabled: !draft,
        onChange: (e) => setNewRoleKey(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") createRole();
        },
        style: { ...selectStyle, fontFamily: MONO_FONT }
      }),
      React2.createElement("button", {
        style: miniBtnStyle,
        disabled: !draft || !isValidRoleKey(newRoleKey.trim()) || AGENT_TYPES.includes(newRoleKey.trim()) || newRoleKey.trim() !== "" && (roleRows.some((row) => row.key === newRoleKey.trim()) || draft?.roles && typeof draft.roles === "object" && Boolean(draft.roles[newRoleKey.trim()])),
        title: "\u521B\u5EFA\u81EA\u5B9A\u4E49\u89D2\u8272",
        onClick: createRole
      }, "+ \u65B0\u5EFA\u89D2\u8272"),
      React2.createElement("button", {
        style: miniBtnStyle,
        disabled: !draft,
        title: "\u4ECE\u7C98\u8D34\u7684\u89D2\u8272 JSON \u5BFC\u5165\uFF08key \u4E0D\u53EF\u4E0E\u5185\u7F6E\u5DE5\u79CD\u6216\u5DF2\u6709\u89D2\u8272\u91CD\u540D\uFF09",
        onClick: importRole
      }, "\u5BFC\u5165 JSON")
    ),
    importError !== "" ? React2.createElement("div", { style: { fontSize: 12, color: "#f44336", marginTop: 4 } }, `\u5BFC\u5165\u5931\u8D25\uFF1A${importError}`) : null,
    newRoleKey.trim() !== "" && !isValidRoleKey(newRoleKey.trim()) ? React2.createElement("div", { style: { fontSize: 12, color: "#f44336", marginTop: 4 } }, "\u540D\u5B57\u4E0D\u5408\u6CD5\uFF1A\u987B\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EA\u542B\u5C0F\u5199\u5B57\u6BCD\u4E0E\u8FDE\u5B57\u7B26\uFF08\u5927\u5199 / \u6570\u5B57 / \u4E0B\u5212\u7EBF\u90FD\u4F1A\u88AB\u4FDD\u5B58\u7AEF schema \u62D2\u7EDD\uFF09") : null,
    newRoleKey.trim() !== "" && isValidRoleKey(newRoleKey.trim()) && AGENT_TYPES.includes(newRoleKey.trim()) ? React2.createElement("div", { style: { fontSize: 12, color: "#f44336", marginTop: 4 } }, `\u300C${newRoleKey.trim()}\u300D\u662F\u5185\u7F6E\u5DE5\u79CD\u540D\uFF0C\u4E0D\u53EF\u7528\u4F5C\u81EA\u5B9A\u4E49\u89D2\u8272\u2014\u2014\u8BF7\u7528\u4E0A\u65B9\u5BF9\u5E94\u5361\u7247\u914D\u7F6E`) : null,
    newRoleKey.trim() !== "" && isValidRoleKey(newRoleKey.trim()) && !AGENT_TYPES.includes(newRoleKey.trim()) && (roleRows.some((row) => row.key === newRoleKey.trim()) || draft?.roles && typeof draft.roles === "object" && Boolean(draft.roles[newRoleKey.trim()])) ? React2.createElement("div", { style: { fontSize: 12, color: "#f44336", marginTop: 4 } }, "\u8BE5\u540D\u5B57\u5DF2\u5B58\u5728") : null
  );
}

// src/tool-mask-editor.js
var React3 = __toESM(require("react"), 1);

// src/tool-mask-rows.js
function normalizeDenyList(value) {
  if (!Array.isArray(value)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "") continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}
function blockTool(deny, name2) {
  const next = normalizeDenyList(deny);
  if (typeof name2 !== "string" || name2 === "" || next.includes(name2)) return next;
  return [...next, name2];
}
function unblockTool(deny, name2) {
  return normalizeDenyList(deny).filter((entry) => entry !== name2);
}
function availableTools(roster, deny, filter) {
  const blocked = new Set(normalizeDenyList(deny));
  const needle = typeof filter === "string" ? filter.trim().toLowerCase() : "";
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const name2 of Array.isArray(roster) ? roster : []) {
    if (typeof name2 !== "string" || name2 === "" || blocked.has(name2) || seen.has(name2)) continue;
    if (needle !== "" && !name2.toLowerCase().includes(needle)) continue;
    seen.add(name2);
    out.push(name2);
  }
  return out;
}
function denyEntries(deny, roster) {
  const known = new Set((Array.isArray(roster) ? roster : []).filter((n) => typeof n === "string"));
  return normalizeDenyList(deny).map((name2) => ({ name: name2, connected: known.has(name2) }));
}

// src/tool-mask-editor.js
function renderToolMaskEditor(deps) {
  const {
    draft,
    roster,
    maskFilter,
    setMaskFilter,
    maskSelL,
    setMaskSelL,
    maskSelR,
    setMaskSelR,
    maskManual,
    setMaskManual,
    setDeny,
    cardOpen,
    toggleCard,
    styles
  } = deps;
  const { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle } = styles;
  const denyList = normalizeDenyList(draft?.toolMask?.deny);
  const availTools = availableTools(roster, denyList, maskFilter);
  const maskedEntries = denyEntries(denyList, roster);
  const maskListBoxStyle = { border: "1px solid var(--separator, #333)", borderRadius: 4, height: 150, overflowY: "auto", background: "var(--surface, #1e1e1e)", marginBottom: 4 };
  const maskItemStyle = (selected) => ({
    padding: "3px 8px",
    fontSize: 12,
    fontFamily: MONO_FONT,
    cursor: "pointer",
    wordBreak: "break-all",
    background: selected ? "rgba(100,181,246,0.18)" : "transparent"
  });
  const maskBadge = (title) => React3.createElement("span", {
    title,
    style: { flexShrink: 0, fontSize: 10, lineHeight: "15px", padding: "0 5px", borderRadius: 4, color: "#9e9e9e", background: "rgba(255,255,255,0.07)" }
  }, "\u672A\u8FDE\u63A5");
  const blockSelected = () => {
    if (!draft || !maskSelL) return;
    setDeny(blockTool(denyList, maskSelL));
    setMaskSelL(null);
  };
  const unblockSelected = () => {
    if (!draft || !maskSelR) return;
    setDeny(unblockTool(denyList, maskSelR));
    setMaskSelR(null);
  };
  return React3.createElement(
    "div",
    { style: cardStyle },
    React3.createElement(
      "div",
      {
        style: { cursor: "pointer", marginBottom: cardOpen("tool-mask") ? 8 : 0 },
        onClick: () => toggleCard("tool-mask")
      },
      React3.createElement(
        "div",
        { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } },
        React3.createElement("span", { style: glyphStyle }, cardOpen("tool-mask") ? "\u25BE" : "\u25B8"),
        React3.createElement("span", { style: { fontWeight: 600 } }, "\u5DE5\u5177\u5C4F\u853D\uFF08Tool Mask\uFF09"),
        React3.createElement("span", { style: { fontSize: 12, color: "var(--text-secondary, #888)" } }, "\u4ECE MyGO \u4F1A\u8BDD\u76EE\u5F55\u85CF\u8D77\u6307\u5B9A\u5DE5\u5177\uFF08Sisyphus \u4E0E\u5168\u90E8\u5B50\u4EE3\u7406\uFF09")
      ),
      React3.createElement("div", { style: summaryStyle }, `\u5DF2\u5C4F\u853D ${denyList.length} \u9879`)
    ),
    cardOpen("tool-mask") ? React3.createElement(
      React3.Fragment,
      null,
      React3.createElement(
        "div",
        { style: { ...hintStyle, marginBottom: 8 } },
        "\u5C4F\u853D\u4EC5\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548\uFF0C\u5F53\u524D\u4F1A\u8BDD\u4E0D\u53D7\u5F71\u54CD\uFF1B\u4FDD\u7559\u5DE5\u5177\uFF08run_code \u7B49\uFF09\u4E0D\u53EF\u5C4F\u853D\uFF0C\u4E0D\u5728\u5DE6\u5217\u51FA\u73B0\u3002\u82B1\u540D\u518C\u662F\u5FEB\u7167\uFF1AMCP \u91CD\u8FDE\u540E\u91CD\u5F00\u8BBE\u7F6E\u9875\u5373\u53EF\u5237\u65B0\u3002"
      ),
      React3.createElement(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "start" } },
        React3.createElement(
          "div",
          null,
          React3.createElement("div", { style: labelStyle }, `\u5F53\u524D\u53EF\u7528\u5DE5\u5177\uFF08${availTools.length}\uFF09`),
          React3.createElement("input", {
            value: maskFilter,
            placeholder: "\u6309\u540D\u79F0\u8FC7\u6EE4\u2026",
            onChange: (e) => {
              setMaskFilter(e.target.value);
              setMaskSelL(null);
            },
            style: { ...selectStyle, marginBottom: 4 }
          }),
          React3.createElement(
            "div",
            { style: maskListBoxStyle },
            availTools.length === 0 ? React3.createElement("div", { style: { padding: "6px 8px", fontSize: 12, color: "var(--text-secondary, #888)" } }, roster.length === 0 ? "\u82B1\u540D\u518C\u4E0D\u53EF\u7528\uFF08host \u672A\u5C31\u7EEA\uFF09\uFF1B\u53EF\u7528\u4E0B\u65B9\u624B\u586B\u6DFB\u52A0" : "\uFF08\u65E0\u5339\u914D\u9879\uFF09") : availTools.map((name2) => React3.createElement("div", {
              key: name2,
              title: name2,
              style: maskItemStyle(maskSelL === name2),
              onClick: () => setMaskSelL(maskSelL === name2 ? null : name2)
            }, name2))
          )
        ),
        React3.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 20 } },
          React3.createElement("button", { style: miniBtnStyle, disabled: !maskSelL, title: "\u5C4F\u853D\u9009\u4E2D\u7684\u5DE5\u5177", onClick: blockSelected }, "\u5C4F\u853D \u2192"),
          React3.createElement("button", { style: miniBtnStyle, disabled: !maskSelR, title: "\u53D6\u6D88\u5C4F\u853D\u9009\u4E2D\u7684\u6761\u76EE", onClick: unblockSelected }, "\u2190 \u89E3\u9664")
        ),
        React3.createElement(
          "div",
          null,
          React3.createElement("div", { style: labelStyle }, `\u5DF2\u5C4F\u853D\uFF08${maskedEntries.length}\uFF09`),
          React3.createElement(
            "div",
            { style: maskListBoxStyle },
            maskedEntries.length === 0 ? React3.createElement("div", { style: { padding: "6px 8px", fontSize: 12, color: "var(--text-secondary, #888)" } }, "\u672A\u5C4F\u853D\u4EFB\u4F55\u5DE5\u5177") : maskedEntries.map((entry) => React3.createElement(
              "div",
              {
                key: entry.name,
                title: entry.name,
                style: { ...maskItemStyle(maskSelR === entry.name), display: "flex", alignItems: "center", gap: 6 },
                onClick: () => setMaskSelR(maskSelR === entry.name ? null : entry.name)
              },
              React3.createElement("span", { style: { flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" } }, entry.name),
              entry.connected ? null : maskBadge("\u4E0D\u5728\u5F53\u524D\u82B1\u540D\u518C\uFF08\u672A\u8FDE\u63A5\u6216\u5DF2\u4E0B\u7EBF\uFF09\uFF1B\u6761\u76EE\u4FDD\u7559\uFF0C\u91CD\u8FDE\u540E\u5373\u88AB\u5C4F\u853D")
            ))
          )
        )
      ),
      React3.createElement(
        "div",
        { style: { display: "flex", gap: 6, alignItems: "center" } },
        React3.createElement("input", {
          value: maskManual,
          placeholder: "\u624B\u586B\u5DE5\u5177\u540D\uFF08\u82B1\u540D\u518C\u5916\u7684\u672A\u8FDE\u63A5\u5DE5\u5177\uFF09\u2026",
          onChange: (e) => setMaskManual(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              setDeny(blockTool(denyList, maskManual.trim()));
              setMaskManual("");
            }
          },
          style: selectStyle
        }),
        React3.createElement("button", {
          style: miniBtnStyle,
          disabled: !draft || maskManual.trim() === "",
          title: "\u52A0\u5165\u5DF2\u5C4F\u853D\u6E05\u5355",
          onClick: () => {
            setDeny(blockTool(denyList, maskManual.trim()));
            setMaskManual("");
          }
        }, "+ \u6DFB\u52A0")
      )
    ) : null
  );
}

// src/settings-core.js
function SettingsPage({ scope: sp, connection, close }) {
  const [draft, setDraft] = React4.useState(null);
  const [saving, setSaving] = React4.useState(false);
  const [msg, setMsg] = React4.useState(null);
  const [available, setAvailable] = React4.useState({ providers: [], models: {}, errors: {} });
  const [loadError, setLoadError] = React4.useState(false);
  const [modelsReady, setModelsReady] = React4.useState(false);
  const [dirty, setDirty] = React4.useState(false);
  const [revision, setRevision] = React4.useState(null);
  const [conflict, setConflict] = React4.useState(null);
  const [reloadNonce, setReloadNonce] = React4.useState(0);
  const [roster, setRoster] = React4.useState([]);
  const [maskFilter, setMaskFilter] = React4.useState("");
  const [maskSelL, setMaskSelL] = React4.useState(null);
  const [maskSelR, setMaskSelR] = React4.useState(null);
  const [maskManual, setMaskManual] = React4.useState("");
  const [newRoleKey, setNewRoleKey] = React4.useState("");
  const [roleToolDrafts, setRoleToolDrafts] = React4.useState({});
  const [importError, setImportError] = React4.useState("");
  const [openCards, setOpenCards] = React4.useState({});
  const [personaFileErr, setPersonaFileErr] = React4.useState({});
  React4.useEffect(() => {
    if (!sp) return;
    if (connection && connection.rpc && typeof connection.rpc.call === "function") {
      connection.rpc.call("/dsh-my-go", "loadSettings", {}).then((res) => {
        const loaded = interpretLoadResult(res);
        if (loaded.status === "ok") {
          setDraft(loaded.draft);
          setRevision(loaded.revision);
          setDirty(false);
          setConflict(null);
          setLoadError(false);
        } else {
          setDraft(null);
          setLoadError(true);
        }
      }).catch(() => {
        setDraft(null);
        setLoadError(true);
      });
      connection.rpc.call("/dsh-my-go", "listModels", {}).then((res) => {
        if (res && res.ok && res.value && Array.isArray(res.value.providers) && res.value.models !== null && typeof res.value.models === "object") setAvailable(res.value);
      }).catch(() => {
      }).finally(() => setModelsReady(true));
      connection.rpc.call("/dsh-my-go", "listTools", {}).then((res) => {
        if (res && res.ok && Array.isArray(res.value)) setRoster(res.value);
      }).catch(() => {
      });
    } else {
      setLoadError(true);
    }
  }, [sp, reloadNonce]);
  const mutateDraft = (updater) => {
    setDirty(true);
    setDraft(updater);
  };
  React4.useEffect(() => {
    if (!dirty) return void 0;
    const win = typeof window === "undefined" ? void 0 : window;
    return attachBeforeUnloadGuard(win);
  }, [dirty]);
  if (!sp) return React4.createElement("div", { style: { padding: 16, color: "#888" } }, "\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528");
  const set = (type, field, value) => {
    if (!draft) return;
    mutateDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [type]: { ...prev?.[type], [field]: value } };
    });
  };
  const setChain = (type, chainRow) => {
    if (!draft) return;
    mutateDraft((prev) => prev ? { ...prev, [type]: { ...prev?.[type], provider: chainRow.provider, model: chainRow.model, fallbacks: chainRow.fallbacks } } : prev);
  };
  const setDeny = (rows) => {
    if (!draft) return;
    mutateDraft((prev) => prev ? { ...prev, toolMask: { deny: rows } } : prev);
  };
  const setPersonaOverride = (type, text) => {
    if (!draft) return;
    mutateDraft((prev) => prev ? { ...prev, roles: { ...prev.roles ?? {}, [type]: withPersonaOverride(prev.roles?.[type], text) } } : prev);
  };
  const loadBuiltinPersona = async (type) => {
    if (!draft) return;
    if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") {
      setPersonaFileErr((prev) => ({ ...prev, [type]: "\u8FDE\u63A5\u4E0D\u53EF\u7528" }));
      return;
    }
    try {
      const res = await connection.rpc.call("/dsh-my-go", "getBuiltinPersona", { type });
      const parsed = resolveBuiltinPersonaResult(res);
      if (parsed.ok) {
        setPersonaOverride(type, parsed.persona);
        setPersonaFileErr((prev) => ({ ...prev, [type]: "" }));
      } else {
        setPersonaFileErr((prev) => ({ ...prev, [type]: parsed.message }));
      }
    } catch (e) {
      setPersonaFileErr((prev) => ({ ...prev, [type]: String(e) }));
    }
  };
  const toggleCard = (id) => setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }));
  const cardOpen = (id) => openCards[id] === true;
  const buildPersistDraft = (source) => {
    const out = { ...source };
    for (const type of AGENT_TYPES) {
      const cfg = source[type];
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) out[type] = stripEmptyFallbackRows(cfg);
    }
    if (source.roles && typeof source.roles === "object" && !Array.isArray(source.roles)) {
      const roles = { ...source.roles };
      for (const [key, row] of Object.entries(roles)) {
        if (row && typeof row === "object" && !Array.isArray(row)) roles[key] = stripEmptyFallbackRows(row);
      }
      out.roles = roles;
    }
    return out;
  };
  const save = async () => {
    if (!draft) {
      setMsg("\u914D\u7F6E\u5C1A\u672A\u52A0\u8F7D\u6210\u529F\uFF0C\u5DF2\u7981\u6B62\u4FDD\u5B58\u4EE5\u907F\u514D\u8986\u76D6");
      return false;
    }
    if (conflict) {
      setMsg(conflict);
      return false;
    }
    setSaving(true);
    setMsg(null);
    try {
      if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") {
        setMsg("\u8FDE\u63A5\u4E0D\u53EF\u7528");
        return false;
      }
      const body = buildPersistDraft(draft);
      if (typeof revision === "number") body.revision = revision;
      const outcome = interpretSaveResult(await connection.rpc.call("/dsh-my-go", "saveSettings", body));
      if (outcome.status === "saved") {
        setDirty(false);
        setConflict(null);
        if (typeof outcome.revision === "number") setRevision(outcome.revision);
        setMsg(outcome.message);
        return true;
      }
      if (outcome.status === "conflict") {
        setConflict(outcome.message);
        setMsg(outcome.message);
        return false;
      }
      setMsg(outcome.message);
      return false;
    } catch (e) {
      setMsg("\u4FDD\u5B58\u5931\u8D25: " + String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveAndClose = async () => {
    if (await save() && typeof close === "function") close();
  };
  const reloadDraft = () => {
    setConflict(null);
    setMsg(null);
    setDirty(false);
    setLoadError(false);
    setDraft(null);
    setReloadNonce((n) => n + 1);
  };
  const selectStyle = { background: "var(--surface, #1e1e1e)", color: "var(--text, #e0e0e0)", border: "1px solid var(--separator, #333)", borderRadius: 4, padding: "4px 8px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const labelStyle = { fontSize: 12, color: "var(--text-secondary, #888)", marginBottom: 2 };
  const hintStyle = { fontSize: 11, color: "var(--text-secondary, #888)", marginTop: 2 };
  const cardStyle = { border: "1px solid var(--separator, #333)", borderRadius: 8, padding: 12, marginBottom: 12 };
  const rowStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 };
  const miniBtnStyle = { padding: "2px 8px", borderRadius: 4, border: "1px solid var(--separator, #333)", background: "transparent", color: "var(--text, #e0e0e0)", cursor: "pointer", fontSize: 12 };
  const chainRowStyle = { display: "grid", gridTemplateColumns: "minmax(56px, auto) 1fr 1fr auto", gap: 6, alignItems: "center", marginBottom: 6 };
  const primaryBadgeStyle = { fontSize: 10, padding: "0 5px", borderRadius: 4, background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.4)", flexShrink: 0 };
  const glyphStyle = { fontSize: 10, color: "var(--text-secondary, #888)", flexShrink: 0 };
  const summaryStyle = { fontSize: 11, color: "var(--text-secondary, #888)", marginTop: 3, overflowWrap: "anywhere" };
  const EFFORTS = ["", "low", "high", "max"];
  const providers = available.providers;
  const effortLabel = (v) => v === "" ? "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4\uFF08\u4E0D\u5355\u72EC\u6307\u5B9A\uFF09" : { low: "\u4F4E\uFF08low\uFF09", high: "\u9AD8\uFF08high\uFF09", max: "\u6700\u9AD8\uFF08max\uFF09" }[v] ?? v;
  const makeSelect = (value, options, labelFn, onChange, disabled = false) => React4.createElement(
    "select",
    { style: selectStyle, value: value ?? "", disabled, onChange: (e) => onChange(e.target.value) },
    ...options.map(
      (opt) => React4.createElement("option", { key: opt, value: opt }, labelFn(opt))
    )
  );
  const makeCombobox = (value, options, listId, placeholder, onChange, disabled = false) => React4.createElement(
    "div",
    { style: { minWidth: 0 } },
    React4.createElement("input", {
      style: { ...selectStyle, fontFamily: MONO_FONT },
      value: value ?? "",
      list: listId,
      placeholder,
      disabled,
      spellCheck: false,
      onChange: (e) => onChange(e.target.value)
    }),
    React4.createElement(
      "datalist",
      { id: listId },
      ...options.filter((opt) => opt !== "").map((opt) => React4.createElement("option", { key: opt, value: opt }))
    )
  );
  const modelsForProvider = (providerId) => {
    const modelsMap = available.models && typeof available.models === "object" ? available.models : {};
    if (!providerId) return [...new Set(Object.values(modelsMap).flat())];
    const specific = modelsMap[providerId];
    return Array.isArray(specific) ? specific : [];
  };
  const modelListErrorFor = (providerId) => {
    if (!providerId) return "";
    const errors = available.errors && typeof available.errors === "object" ? available.errors : {};
    const detail = errors[providerId];
    return typeof detail === "string" && detail !== "" ? detail : "";
  };
  const renderChainEditor = (keyPrefix, cfg, onChange, disabled = false) => {
    const chain = composeChain(cfg);
    const apply2 = (next) => onChange(decomposeChain(next));
    return React4.createElement(
      "div",
      { style: { marginBottom: 8 } },
      React4.createElement("div", { style: labelStyle }, "\u6A21\u578B\u4F18\u5148\u7EA7\uFF08\u4E3B\u9009 + \u5907\u9009\u94FE\uFF09"),
      React4.createElement(
        "div",
        { style: { fontSize: 11, color: "var(--text-secondary, #888)", marginBottom: 6 } },
        "#1 \u4E3A\u4E3B\u9009\uFF1B\u4E3B\u6A21\u578B\u5931\u8D25\uFF08\u9650\u6D41\u91CD\u8BD5\u8017\u5C3D\u540E\uFF09\u6309\u5E8F\u81EA\u52A8\u5207\u6362\u540E\u7EED\u6761\u76EE\u3002\u5907\u9009 \u2191 \u5230\u9876 = \u4E00\u952E\u6276\u6B63\u4E3A\u4E3B\u9009\uFF1B\u5220\u9664 #1 \u5219 #2 \u81EA\u52A8\u6276\u6B63\u3002"
      ),
      chain.map((row, i) => {
        const listError = modelListErrorFor(row.provider);
        return React4.createElement(
          React4.Fragment,
          { key: `${keyPrefix}-chain-${i}` },
          React4.createElement(
            "div",
            { style: chainRowStyle },
            React4.createElement(
              "span",
              { style: { fontSize: 11, color: "var(--text-secondary, #888)", display: "flex", alignItems: "center", gap: 4 } },
              `#${i + 1}`,
              i === 0 ? React4.createElement("span", { style: primaryBadgeStyle }, "\u4E3B\u9009") : null
            ),
            makeCombobox(
              row.provider,
              providers,
              `${keyPrefix}-${i}-providers`,
              i === 0 ? "\u8DDF\u968F Sisyphus\uFF08\u53EF\u70B9\u9009\u6216\u624B\u586B\u6E20\u9053\uFF09" : "\uFF08\u6E20\u9053\uFF1A\u53EF\u70B9\u9009\u6216\u624B\u586B\uFF09",
              (v) => apply2(updateChainEntry(chain, i, "provider", v)),
              disabled
            ),
            makeCombobox(
              row.model,
              modelsForProvider(row.provider),
              `${keyPrefix}-${i}-models`,
              i === 0 ? "\u8DDF\u968F Sisyphus\uFF08\u53EF\u70B9\u9009\u6216\u624B\u586B\u6A21\u578B\uFF09" : "\uFF08\u6A21\u578B\uFF1A\u53EF\u70B9\u9009\u6216\u624B\u586B\uFF09",
              (v) => apply2(updateChainEntry(chain, i, "model", v)),
              disabled
            ),
            React4.createElement(
              "div",
              { style: { display: "flex", gap: 4 } },
              React4.createElement("button", { style: miniBtnStyle, disabled: disabled || i === 0, title: "\u4E0A\u79FB\uFF08#2 \u5230\u9876\u5373\u6276\u6B63\u4E3A\u4E3B\u9009\uFF09", onClick: () => apply2(moveChainEntry(chain, i, -1)) }, "\u2191"),
              React4.createElement("button", { style: miniBtnStyle, disabled: disabled || i === chain.length - 1, title: "\u4E0B\u79FB\uFF08\u66F4\u540E\u5C1D\u8BD5\uFF09", onClick: () => apply2(moveChainEntry(chain, i, 1)) }, "\u2193"),
              React4.createElement("button", { style: miniBtnStyle, disabled: disabled || chain.length <= 1, title: "\u5220\u9664\u8BE5\u884C\uFF08\u81F3\u5C11\u4FDD\u7559\u4E3B\u9009\u4F4D\uFF1B\u5220 #1 \u5219 #2 \u6276\u6B63\uFF09", onClick: () => apply2(removeChainEntry(chain, i)) }, "\xD7")
            )
          ),
          // 行内渠道失败提示（tisitan.9 A-06）：与「该渠道真的没有模型」区分——
          // 清单没拉上来，不是清单为空
          listError ? React4.createElement(
            "div",
            { style: { ...hintStyle, marginTop: -2, marginBottom: 6, color: ACCENT_QUEUE } },
            `\u26A0 \u6E20\u9053 ${row.provider} \u7684\u6A21\u578B\u6E05\u5355\u8BFB\u53D6\u5931\u8D25\uFF1A${listError}\uFF08\u53EF\u76F4\u63A5\u624B\u586B\u6A21\u578B\u540D\uFF0C\u4E0D\u5F71\u54CD\u4FDD\u5B58\uFF09`
          ) : null
        );
      }),
      React4.createElement("button", { style: miniBtnStyle, disabled, onClick: () => apply2(addChainEntry(chain)) }, "+ \u6DFB\u52A0\u6761\u76EE")
    );
  };
  const fetchFailed = modelsReady && available.providers.length === 0;
  return React4.createElement(
    "div",
    { style: { padding: 16, maxWidth: 600 } },
    React4.createElement("h2", { style: { margin: "0 0 4px" } }, "MyGO \u7F16\u6392\u914D\u7F6E"),
    React4.createElement("p", { style: { margin: "0 0 6px", fontSize: 13, color: "var(--text-secondary, #888)" } }, "\u7ED9\u6BCF\u4E2A\u5DE5\u79CD\u5355\u72EC\u6307\u5B9A\u6A21\u578B\uFF1B\u7559\u7A7A = \u8DDF\u968F Sisyphus\uFF08\u5373\u60A8\u5728\u5BF9\u8BDD\u6846\u91CC\u9009\u7684\u6A21\u578B\uFF09\u3002\u6539\u5B8C\u70B9\u300C\u7ACB\u5373\u4FDD\u5B58\u300D\uFF0C\u4E0B\u6B21\u6D3E\u53D1\u751F\u6548\u3002"),
    fetchFailed ? React4.createElement("div", {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", fontSize: 13 }
    }, "\u26A0 \u6682\u65F6\u8BFB\u4E0D\u5230 DSH \u7684 Provider/Model \u5217\u8868\u2014\u2014\u786E\u8BA4 dsh web \u5DF2\u91CD\u542F\u3001LLM \u63D2\u4EF6\u5DF2\u914D\u7F6E\u5E76\u6FC0\u6D3B\u540E\uFF0C\u56DE\u6765\u5237\u65B0\u5373\u53EF\u3002\u4E0D\u5F71\u54CD\u624B\u586B\uFF1A\u6E20\u9053\u4E0E\u6A21\u578B\u4E24\u680F\u90FD\u662F\u53EF\u624B\u586B\u8F93\u5165\u6846\uFF0C\u6E05\u5355\u5728\u573A\u65F6\u70B9\u9009\u5373\u53EF\u3002") : null,
    // 加载失败红字横幅（tisitan.20 Z1'）：与「加载中」可区分，保存已被禁用
    loadError ? React4.createElement("div", {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", fontSize: 13 }
    }, "\u26A0 \u914D\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF08loadSettings \u4E0D\u53EF\u7528\u6216\u8FD4\u56DE\u9519\u8BEF\uFF09\u2014\u2014\u4E3A\u9632\u6E05\u7A7A\u914D\u7F6E\u5DF2\u7981\u7528\u5168\u90E8\u7F16\u8F91\u4E0E\u4FDD\u5B58\uFF0C\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u6FC0\u6D3B\u540E\u5237\u65B0\u91CD\u8BD5\u3002") : null,
    // 并发写冲突横幅（tisitan.9 E6/A-03）：他处已经改过这份配置，保存被锁，
    // 唯一出路是显式重新加载（草稿会被丢弃——所以顺带把 beforeunload 的语义
    // 也说清楚，用户知道自己手里有未保存的东西）
    conflict ? React4.createElement(
      "div",
      {
        style: { display: "flex", alignItems: "center", gap: 10, padding: 12, marginBottom: 16, borderRadius: 6, background: "rgba(230,162,60,0.12)", border: "1px solid rgba(230,162,60,0.45)", fontSize: 13 }
      },
      React4.createElement("span", { style: { color: ACCENT_QUEUE, fontWeight: 600 } }, "\u26A0 " + conflict),
      React4.createElement("button", {
        style: miniBtnStyle,
        title: "\u4E22\u5F03\u5F53\u524D\u8349\u7A3F\uFF0C\u91CD\u65B0\u8BFB\u53D6\u6700\u65B0\u914D\u7F6E\uFF08\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u4F1A\u4E22\u5931\uFF09",
        onClick: reloadDraft
      }, "\u91CD\u65B0\u52A0\u8F7D")
    ) : null,
    !draft && !loadError ? React4.createElement("div", {
      style: { padding: 12, marginBottom: 16, borderRadius: 6, border: "1px solid var(--separator, #333)", fontSize: 13, color: "var(--text-secondary, #888)" }
    }, "\u914D\u7F6E\u52A0\u8F7D\u4E2D\u2026") : null,
    ...AGENT_TYPES.map((type) => {
      const cfg = draft?.[type] || {};
      const open = cardOpen(type);
      return React4.createElement(
        "div",
        { key: type, style: cardStyle },
        // 卡片标题行：工种中文名 + 英文名（AGENT_LABELS 已合并）+ 一句话角色说明
        React4.createElement(
          "div",
          {
            style: { cursor: "pointer", marginBottom: open ? 8 : 0 },
            onClick: () => toggleCard(type)
          },
          React4.createElement(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } },
            React4.createElement("span", { style: glyphStyle }, open ? "\u25BE" : "\u25B8"),
            React4.createElement("span", { style: { fontWeight: 600 } }, AGENT_LABELS[type] || type),
            React4.createElement("span", { style: { fontSize: 12, color: "var(--text-secondary, #888)" } }, AGENT_BLURBS[type] ?? "")
          ),
          React4.createElement("div", { style: summaryStyle }, builtinSummaryText(cfg))
        ),
        open ? React4.createElement(
          React4.Fragment,
          null,
          // Sisyphus 卡片语义（broker.mjs:599,1580）：绑定仅当插件配置
          // bindSisyphus===true 才参与 agent/request 覆盖，默认完全跟随对话框模型
          type === "sisyphus" ? React4.createElement("div", { style: { ...hintStyle, marginBottom: 8 } }, "\u603B\u8C03\u5EA6\u53EA\u8BA4\u5BF9\u8BDD\u6846\u6240\u9009\u6A21\u578B\uFF0C\u6B64\u5904\u914D\u7F6E\u4E3A\u515C\u5E95/\u8865\u4E01\u4F4D\uFF08\u4EC5\u5F53\u63D2\u4EF6\u914D\u7F6E bindSisyphus \u5F00\u542F\u65F6\u751F\u6548\uFF09\u3002") : null,
          // 模型优先级列表（tisitan.19）：主选（#1）与备选链（#2..N）合并编辑
          renderChainEditor(type, cfg, (chainRow) => setChain(type, chainRow), !draft),
          React4.createElement(
            "div",
            { style: rowStyle },
            React4.createElement(
              "div",
              null,
              React4.createElement("div", { style: labelStyle }, "\u601D\u8003\u6863\u4F4D\uFF08Reasoning Effort\uFF09"),
              React4.createElement("div", { style: hintStyle }, "\u63A8\u7406\u5F3A\u5EA6\uFF1A\u8D8A\u9AD8\u8D8A\u806A\u660E\uFF0C\u4E5F\u8D8A\u8D35"),
              makeSelect(cfg.reasoningEffort ?? "", EFFORTS, effortLabel, (v) => set(type, "reasoningEffort", v), !draft)
            ),
            React4.createElement(
              "div",
              null,
              React4.createElement("div", { style: labelStyle }, "DSV4P0813 \u8865\u4E01"),
              // 棒4-Z3（tisitan.20）：Sisyphus 卡置灰锁定——注入识别面
              // typeOfAgent（broker.mjs:527-534）恒不命中 sisyphus 会话，勾选
              // 永不生效，留可勾选只会误导
              React4.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: 6, cursor: draft && type !== "sisyphus" ? "pointer" : "not-allowed", fontSize: 13, paddingTop: 2 } },
                React4.createElement("input", { type: "checkbox", checked: cfg.dsv4p0813 === true, disabled: !draft || type === "sisyphus", onChange: (e) => set(type, "dsv4p0813", e.target.checked) }),
                "\u542F\u7528"
              ),
              React4.createElement(
                "div",
                { style: hintStyle },
                type === "sisyphus" ? "Sisyphus \u4F1A\u8BDD\u4E0D\u7ECF\u8FC7 DSV4P0813 \u6CE8\u5165\u8BC6\u522B\u9762\uFF0C\u52FE\u9009\u5BF9\u5176\u4E0D\u751F\u6548\uFF0C\u5DF2\u7F6E\u7070\u9501\u5B9A" : "\u4E24\u9636\u6BB5\u951A\u5B9A\u4E0A\u4E0B\u6587\u6CE8\u5165\uFF0C\u4E13\u4E3A DeepSeek V4 Pro 0813 \u8C03\u6821\uFF0C\u5176\u4ED6\u6A21\u578B\u52FF\u5F00\uFF1B\u4EC5\u5BF9 MyGO preset \u6D3E\u53D1\u7684\u5B50\u4EE3\u7406\u4F1A\u8BDD\u751F\u6548\uFF0Clib-only \u90E8\u7F72\u5F62\u6001\u4E0B\u4E0D\u751F\u6548"
              )
            )
          ),
          // 人设覆盖（tisitan.15）：内置工种走「roles 行 persona > prompts 文件」
          // 解析链；Sisyphus 的编排纪律人设是行为本体，不开放覆盖
          type === "sisyphus" ? React4.createElement("div", { style: { ...hintStyle, marginTop: 4 } }, "Sisyphus \u7684\u7F16\u6392\u7EAA\u5F8B\u4EBA\u8BBE\u4E0D\u63D0\u4F9B\u9762\u677F\u8986\u76D6\u3002") : React4.createElement(
            "div",
            { style: { marginBottom: 8 } },
            React4.createElement("div", { style: labelStyle }, "\u4EBA\u8BBE\u8986\u76D6\uFF08Persona\uFF09"),
            React4.createElement("div", { style: hintStyle, marginBottom: 4 }, `\u5F53\u524D\u6765\u6E90\uFF1A${personaOverrideSource(draft?.roles?.[type])}\uFF1B\u7559\u7A7A\u4FDD\u5B58 = \u6062\u590D prompts/${type}.md \u6587\u4EF6\u9ED8\u8BA4`),
            React4.createElement("textarea", {
              value: draft?.roles?.[type]?.persona ?? "",
              disabled: !draft,
              rows: 3,
              placeholder: `\u7559\u7A7A = \u4F7F\u7528 prompts/${type}.md \u6587\u4EF6\u9ED8\u8BA4\u4EBA\u8BBE`,
              onChange: (e) => setPersonaOverride(type, e.target.value),
              style: { ...selectStyle, resize: "vertical", fontFamily: "inherit" }
            }),
            React4.createElement(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 } },
              React4.createElement("button", {
                style: miniBtnStyle,
                disabled: !draft,
                title: `\u8BFB\u53D6 prompts/${type}.md \u539F\u6587\u586B\u5165\u4E0A\u65B9\u7F16\u8F91\u6846\uFF08\u8349\u7A3F\u6001\uFF0C\u70B9\u4FDD\u5B58\u624D\u751F\u6548\uFF09`,
                onClick: () => loadBuiltinPersona(type)
              }, "\u8F7D\u5165\u6587\u4EF6\u9ED8\u8BA4"),
              personaFileErr[type] ? React4.createElement("span", { style: { fontSize: 12, color: "#f44336" } }, personaFileErr[type]) : null
            )
          )
        ) : null
      );
    }),
    // ── 自定义角色（tisitan.14/tisitan.15）：roles dict 里的非内置条目；渲染与行操作在 roles-editor.js
    renderRolesEditor({
      draft,
      // 角色区一切写操作都经 mutateDraft（E6/A-03）：dep 名不变（roles-editor
      // 仍按 deps.setDraft 消费），换的是实现——漏了这一处就会出现「改自定义
      // 角色不置 dirty」的偏心 dirty，比没有 dirty 更坏
      setDraft: mutateDraft,
      newRoleKey,
      setNewRoleKey,
      roleToolDrafts,
      setRoleToolDrafts,
      importError,
      setImportError,
      openCards,
      setOpenCards,
      EFFORTS,
      effortLabel,
      makeSelect,
      renderChainEditor,
      roster,
      styles: { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle, rowStyle }
    }),
    // ── 工具屏蔽（tisitan.13）：置于 8 工种卡片之后；渲染逻辑在 tool-mask-editor.js
    // React 由该模块自身 import（tisitan.8 A-12，与 roles-editor 对齐）
    renderToolMaskEditor({
      draft,
      roster,
      maskFilter,
      setMaskFilter,
      maskSelL,
      setMaskSelL,
      maskSelR,
      setMaskSelR,
      maskManual,
      setMaskManual,
      setDeny,
      cardOpen,
      toggleCard,
      styles: { cardStyle, glyphStyle, summaryStyle, hintStyle, labelStyle, miniBtnStyle, selectStyle }
    }),
    React4.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" } },
      React4.createElement("button", {
        onClick: save,
        // 冲突后锁保存（E6/A-03）：draft 的基线已作废，放行就等于让用户拿旧
        // 快照盖掉新配置——正是围栏要拦的那件事。必须显式「重新加载」解锁。
        disabled: saving || !draft || conflict !== null,
        style: { padding: "6px 20px", borderRadius: 6, border: "1px solid var(--separator, #333)", background: "transparent", color: "var(--text, #e0e0e0)", cursor: saving ? "wait" : "pointer", fontSize: 13 }
      }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u7ACB\u5373\u4FDD\u5B58"),
      typeof close === "function" ? React4.createElement("button", {
        // close 的唯一使用点（E6/A-03）：保存成功才关设置页，失败/冲突绝不关
        onClick: saveAndClose,
        disabled: saving || !draft || conflict !== null,
        title: "\u4FDD\u5B58\u6210\u529F\u540E\u5173\u95ED\u8BBE\u7F6E\u9875\uFF08\u4FDD\u5B58\u5931\u8D25\u6216\u4ED6\u5904\u5DF2\u6539\u65F6\u4E0D\u4F1A\u5173\u95ED\uFF09",
        style: { padding: "6px 14px", borderRadius: 6, border: "1px solid var(--separator, #333)", background: "transparent", color: "var(--text, #e0e0e0)", cursor: "pointer", fontSize: 13 }
      }, "\u4FDD\u5B58\u5E76\u5173\u95ED") : null,
      dirty && conflict === null ? React4.createElement("span", { style: { fontSize: 12, color: ACCENT_QUEUE }, title: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF1A\u5173\u9875\u7B7E/\u5237\u65B0\u524D\u6D4F\u89C8\u5668\u4F1A\u62E6\u4E00\u9053" }, "\u25CF \u672A\u4FDD\u5B58") : null,
      msg ? React4.createElement("span", { style: { fontSize: 13, color: msg.startsWith("\u5DF2") ? "#4caf50" : "#f44336" } }, msg) : null
    )
  );
}

// src/client.js
var name = "dsh-my-go";
var inject = ["slots", "settingsScope", "connection"];
function createSelfManagedTimer() {
  let warned = false;
  return {
    interval(fn, ms) {
      if (!warned) {
        warned = true;
        console.warn("[dsh-my-go] client: timer service unavailable; panel polling falls back to window.setInterval (self-managed disposer)");
      }
      const id = globalThis.setInterval(fn, ms);
      return () => globalThis.clearInterval(id);
    }
  };
}
function apply(ctx) {
  const client = ctx;
  const slots = client.get("slots");
  if (!slots) return;
  const connection = client.connection;
  const sessions = client.get("sessions");
  const timer = client.get("timer");
  if (!sessions) console.warn("[dsh-my-go] client: sessions service unavailable; panel click-to-jump and auto-jump disabled (snapshot polling unaffected)");
  const panelTimer = timer && typeof timer.interval === "function" ? timer : createSelfManagedTimer();
  const stopPanel = createOrchestrationPanel({ slots, connection, sessions, timer: panelTimer });
  const scope = client.get("settingsScope") ? client.get("settingsScope").bind({ namespace: "dsh-my-go" }) : null;
  slots.inject("settings.section", () => slots.register(
    { name: "settings.section", id: "dsh-my-go", order: 30, label: "MyGO \u7F16\u6392" },
    (props) => React5.createElement(SettingsPage, { ...props, scope, connection })
  ));
  return () => {
    stopPanel();
  };
}

		return module.exports;
	}
});
