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
  createCatalogStore: () => createCatalogStore,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var React7 = __toESM(require("react"), 1);

// preset/shared/constants.mjs
var ROLE_KEY_PATTERN = /^[a-z][a-z-]*$/;
var PRICE_KEY_PATTERN = /^[^/]+\/.+/;
var SETTINGS_NAMESPACE = "dsh-my-go";
var PANEL_RPC_CHANNEL = `/${SETTINGS_NAMESPACE}`;
var PANEL_ENDPOINTS = Object.freeze({
  snapshot: "snapshot",
  listTools: "listTools",
  getBuiltinPersona: "getBuiltinPersona",
  getUsage: "getUsage"
});
var PRICE_REQUIRED_BUCKETS = ["input", "output"];
var PRICE_OPTIONAL_BUCKETS = ["cacheRead", "cacheWrite"];
var PRICE_BUCKETS = [...PRICE_REQUIRED_BUCKETS, ...PRICE_OPTIONAL_BUCKETS];
var PRICE_BUCKET_LABELS = Object.freeze({ input: "\u8F93\u5165", output: "\u8F93\u51FA", cacheRead: "\u7F13\u5B58\u8BFB\u53D6", cacheWrite: "\u7F13\u5B58\u5199\u5165" });
var LEGACY_PARENT_ID = "legacy";

// src/panel-tree.js
var React3 = __toESM(require("react"), 1);

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

// src/usage-panel.js
var React = __toESM(require("react"), 1);

// src/client-constants.js
var AGENT_TYPES = ["sisyphus", "hermes", "explore", "librarian", "looker", "hephaestus", "prometheus", "oracle", "apelles"];
var AGENT_LABELS = {
  sisyphus: "\u603B\u8C03\u5EA6\xB7\u8D28\u68C0 Sisyphus",
  hermes: "\u5FEB\u901F\u6267\u884C Hermes",
  explore: "\u5FEB\u901F\u68C0\u7D22 Explore",
  librarian: "\u6587\u6863\u67E5\u8BE2 Librarian",
  looker: "\u591A\u6A21\u6001\u770B\u56FE Looker",
  hephaestus: "\u4EE3\u7801\u7F16\u5199 Hephaestus",
  prometheus: "\u7D20\u6750\u5206\u6790 Prometheus",
  oracle: "\u7591\u96BE/\u6781\u7AEF\u590D\u6742\u515C\u5E95 Oracle",
  apelles: "\u53EF\u89C6\u5316\u753B\u5E08 Apelles"
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
  oracle: "#e57373",
  apelles: "#f06292"
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
var INTENT_LABELS = { explore: "\u68C0\u7D22", read_doc: "\u67E5\u6587\u6863", look_image: "\u770B\u56FE", replan: "\u8BF7\u6C42\u6362\u5DE5\u79CD", execute: "\u8BF7\u6C42\u4EE3\u6267\u884C", ask_user: "\u8BF7\u6C42\u95EE\u7528\u6237", consult: "\u65B9\u6848\u51B2\u7A81\u8BF7\u793A" };
var intentLabel = (i) => INTENT_LABELS[i] ?? String(i ?? "?");

// src/usage-views.js
var USAGE_TABS = [
  { key: "models", label: "\u6309\u6A21\u578B" },
  { key: "children", label: "\u6309\u5B50\u4EE3" },
  { key: "totals", label: "\u5408\u8BA1" }
];
var BUCKET_COLUMNS = [
  { bucket: "inputTokens", label: "\u5165" },
  { bucket: "outputTokens", label: "\u51FA" },
  { bucket: "cacheReadTokens", label: "\u8BFB" },
  { bucket: "cacheWriteTokens", label: "\u5199" }
];
var COST_TERMS = [
  ["inputTokens", "input"],
  ["outputTokens", "output"],
  ["cacheReadTokens", "cacheRead"],
  ["cacheWriteTokens", "cacheWrite"]
];
var priceKey = (provider, model) => `${provider}/${model}`;
function priceIndexFrom(byModel) {
  const index = {};
  if (!Array.isArray(byModel)) return index;
  for (const row of byModel) {
    if (!row || typeof row !== "object") continue;
    const { provider, model, price } = row;
    if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") continue;
    if (!price || typeof price !== "object") continue;
    index[priceKey(provider, model)] = price;
  }
  return index;
}
function computeCost(buckets, price) {
  if (!price || typeof price !== "object") return null;
  let value = 0;
  let partial = false;
  for (const [bucket, priceBucket] of COST_TERMS) {
    const tokens = buckets?.[bucket];
    if (typeof tokens !== "number" || !Number.isFinite(tokens)) continue;
    const unit = price[priceBucket];
    if (typeof unit === "number" && Number.isFinite(unit)) value += tokens / 1e6 * unit;
    else if (tokens > 0) partial = true;
  }
  return { value, partial };
}
function combineCosts(costs) {
  let value = 0;
  let partial = false;
  let seen = false;
  if (!Array.isArray(costs)) return null;
  for (const cost of costs) {
    if (!cost) continue;
    seen = true;
    value += cost.value;
    if (cost.partial) partial = true;
  }
  return seen ? { value, partial } : null;
}
function computeChildCost(child, priceIndex) {
  const segments = Array.isArray(child?.segments) ? child.segments : [];
  return combineCosts(segments.map((segment) => computeCost(segment?.buckets, priceIndex[priceKey(segment?.provider, segment?.model)])));
}
function computeTotalCost(report) {
  const byModel = Array.isArray(report?.byModel) ? report.byModel : [];
  return combineCosts(byModel.map((row) => computeCost(row?.buckets, row?.price)));
}
function hasAnyPrice(byModel) {
  return Array.isArray(byModel) && byModel.some((row) => !!row?.price);
}
function modelDisplayKey(provider, model) {
  if ((provider === null || provider === void 0) && (model === null || model === void 0)) return "\u672A\u77E5\u6A21\u578B";
  return `${provider ?? "?"}/${model ?? "?"}`;
}
function formatCompactTokens(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const round1 = (v) => {
    const s = (Math.round(v * 10) / 10).toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (n >= 1e6) return `${round1(n / 1e6)}M`;
  if (n >= 1e4) return `${round1(n / 1e3)}k`;
  return String(n);
}
function formatFullTokens(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}
function formatBucketCell(tokens, partial) {
  const text2 = formatCompactTokens(tokens);
  if (text2 === null) return "\u2014";
  return partial ? `\u2265${text2}` : text2;
}
function currencySymbol(currency) {
  return currency === "CNY" ? "\xA5" : "$";
}
function formatCost(cost, currency = "USD") {
  if (!cost) return null;
  return `${cost.partial ? "\u2265" : ""}${currencySymbol(currency)}${cost.value.toFixed(4)}`;
}
function usageSessionTarget(currentPid, parents) {
  if (typeof currentPid === "string" && currentPid !== "") return currentPid;
  const values = parents && typeof parents === "object" ? Object.values(parents) : [];
  const real = values.filter((p) => p && typeof p.parentSessionId === "string" && p.parentSessionId !== "" && p.parentSessionId !== LEGACY_PARENT_ID);
  return real.length === 1 ? real[0].parentSessionId : null;
}
function sessionsListPhase(sessions) {
  try {
    const list = sessions?.list;
    if (list && typeof list.getSnapshot === "function") {
      const phase = list.getSnapshot()?.phase;
      return phase === "pending" || phase === "ready" ? phase : null;
    }
  } catch {
  }
  return null;
}
function usageEmptyState(usage) {
  const loading = { kind: "plain", message: "\u6B63\u5728\u8BFB\u53D6\u7528\u91CF\u2026" };
  if (!usage || typeof usage !== "object") return loading;
  if (usage.state === "loading" || usage.state === "idle") return loading;
  if (usage.state === "session-pending") return { kind: "plain", message: "\u4F1A\u8BDD\u5217\u8868\u52A0\u8F7D\u4E2D\u2026" };
  if (usage.state === "no-session") return { kind: "plain", message: "\u65E0\u6CD5\u786E\u5B9A\u5F53\u524D\u4F1A\u8BDD\uFF0C\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\u540E\u8FD9\u91CC\u663E\u793A\u5176\u7F16\u6392\u7528\u91CF" };
  if (usage.state === "error") {
    const detail = usage.detail ? `\uFF1A${usage.detail}` : "";
    return { kind: "error", message: `\u7528\u91CF\u6570\u636E\u8BFB\u53D6\u5931\u8D25${detail}`, hint: "\u5C06\u968F\u9762\u677F\u8F6E\u8BE2\u6309\u9000\u907F\u8282\u594F\u81EA\u52A8\u91CD\u8BD5" };
  }
  const report = usage.report;
  if (!report || typeof report !== "object") return loading;
  if (report.found === false) return { kind: "plain", message: "\u5F53\u524D\u4F1A\u8BDD\u65E0\u7F16\u6392\u8BB0\u5F55" };
  if (!Array.isArray(report.children) || report.children.length === 0) return { kind: "plain", message: "\u672C\u4F1A\u8BDD\u6682\u65E0\u7528\u91CF" };
  return null;
}
function globalPartial(report) {
  const children = Array.isArray(report?.children) ? report.children : [];
  if (children.some((c) => c?.partial === true)) return true;
  const byModel = Array.isArray(report?.byModel) ? report.byModel : [];
  return byModel.some((row) => row?.partial === true);
}
function sumMessageCount(report) {
  const children = Array.isArray(report?.children) ? report.children : [];
  return children.reduce((sum, c) => sum + (typeof c?.messageCount === "number" ? c.messageCount : 0), 0);
}
function childRowCount(report) {
  const children = Array.isArray(report?.children) ? report.children : [];
  return children.filter((c) => c && c.isSelf !== true).length;
}

// src/usage-panel.js
var GRID_WITH_COST = "minmax(0,1fr) 40px 40px 40px 40px 54px";
var GRID_NO_COST = "minmax(0,1fr) 40px 40px 40px 40px";
var LIST_MAX_HEIGHT = 260;
function childGlyph(status) {
  switch (status) {
    case "running":
      return "\u25CF";
    case "failed":
      return "\u2717";
    case "done":
      return "\u2713";
    default:
      return "\u25CB";
  }
}
function childGlyphColor(status) {
  switch (status) {
    case "running":
      return ACCENT_RUNNING;
    case "failed":
      return ACCENT_HELP;
    default:
      return "#888";
  }
}
function UsageSection({ usage, open, onToggle }) {
  const [tab, setTab] = React.useState("models");
  const [expanded, setExpanded] = React.useState({});
  const report = usage?.state === "ok" ? usage.report : null;
  const empty = usageEmptyState(usage);
  const costSymbol = currencySymbol(report?.currency);
  const priceIndex = priceIndexFrom(report?.byModel);
  const costColumn = hasAnyPrice(report?.byModel);
  const partial = globalPartial(report);
  const toggleChild = (childId) => setExpanded((prev) => ({ ...prev, [childId]: !prev[childId] }));
  const chip = (text2, title, color) => React.createElement("span", {
    title,
    style: {
      flexShrink: 0,
      minWidth: 0,
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
  }, text2);
  const typeChip = (agentType) => chip(
    typeName(agentType),
    typeLabel(agentType),
    agentType ? AGENT_COLORS[agentType] ?? "#9e9e9e" : void 0
  );
  const tokenCell = (tokens, rowPartial) => {
    const absent = tokens === null || tokens === void 0;
    return React.createElement("span", {
      title: absent ? "\u672A\u4E0A\u62A5\uFF08\u2260 0\uFF09" : `\u7CBE\u786E\u503C ${formatFullTokens(tokens)}${rowPartial ? "\uFF08\u542B\u672A\u4E0A\u62A5\u5206\u6876\uFF0C\u4E3A\u4E0B\u754C\uFF09" : ""}`,
      style: {
        textAlign: "right",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: absent ? "#666" : "#a0a0a0"
      }
    }, formatBucketCell(tokens, rowPartial));
  };
  const costCell = (cost) => {
    const text2 = formatCost(cost, report?.currency);
    return React.createElement("span", {
      title: cost ? `\u7CBE\u786E\u503C ${costSymbol}${cost.value.toFixed(6)}${cost.partial ? "\uFF08\u542B\u672A\u5B9A\u4EF7/\u672A\u4E0A\u62A5\u6876\uFF0C\u4E3A\u4E0B\u754C\uFF09" : ""}` : "\u672A\u5B9A\u4EF7\uFF08\u4E0D\u8BB0\u5F55\u6210\u672C\uFF09",
      style: {
        textAlign: "right",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: text2 === null ? "#666" : "#c8c8c8"
      }
    }, text2 ?? "\u2014");
  };
  const nameCell = (text2, title) => React.createElement("span", {
    title,
    style: {
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: text2 === "\u672A\u77E5\u6A21\u578B" ? "#777" : "#c8c8c8"
    }
  }, text2);
  const gridRow = (columns, key, opts = {}, ...children) => React.createElement("div", {
    key,
    onClick: opts.onClick,
    style: {
      display: "grid",
      gridTemplateColumns: columns,
      columnGap: 6,
      alignItems: "center",
      minWidth: 0,
      fontFamily: MONO_FONT,
      fontSize: 10,
      lineHeight: "16px",
      padding: opts.padding ?? "2px 6px",
      borderTop: opts.borderTop === false ? void 0 : "1px solid rgba(255,255,255,0.04)",
      cursor: opts.onClick ? "pointer" : "default",
      borderLeft: opts.accent ? `2px solid ${opts.accent}` : "2px solid transparent"
    }
  }, ...children);
  const headerRow = (columns) => gridRow(
    columns,
    "usage-head",
    { borderTop: false, padding: "0 6px 2px" },
    React.createElement("span", { style: { color: "#777" } }, "\u6A21\u578B"),
    ...BUCKET_COLUMNS.map(({ label }) => React.createElement("span", { key: label, style: { textAlign: "right", color: "#777" } }, label)),
    costColumn ? React.createElement("span", { style: { textAlign: "right", color: "#777" }, title: `\u6309 ${report?.currency === "CNY" ? "\u4EBA\u6C11\u5E01" : "\u7F8E\u5143"} \u6298\u7B97` }, `\u6210\u672C(${costSymbol})`) : null
  );
  const renderModels = () => {
    const rows = Array.isArray(report.byModel) ? report.byModel : [];
    return React.createElement(
      "div",
      null,
      headerRow(costColumn ? GRID_WITH_COST : GRID_NO_COST),
      rows.map((row, i) => {
        const name2 = modelDisplayKey(row.provider, row.model);
        const rowPartial = row.partial === true;
        const cost = computeCost(row.buckets, row.price);
        const costShown = cost ? { ...cost, partial: cost.partial || rowPartial } : null;
        const extras = [
          rowPartial ? "\u542B\u672A\u4E0A\u62A5\u5206\u6876" : null,
          row.childCount ? `${row.childCount} \u4E2A\u5B50\u4EE3` : null,
          `${row.messageCount ?? 0} \u6761\u6D88\u606F`
        ].filter(Boolean).join(" \xB7 ");
        return gridRow(
          costColumn ? GRID_WITH_COST : GRID_NO_COST,
          `m-${i}-${name2}`,
          { onClick: void 0 },
          nameCell(name2, `${name2}${extras ? `
${extras}` : ""}`),
          ...BUCKET_COLUMNS.map(({ bucket }) => tokenCell(row.buckets?.[bucket], rowPartial)),
          costColumn ? costCell(costShown) : null
        );
      })
    );
  };
  const renderChildren = () => {
    const children = Array.isArray(report.children) ? report.children : [];
    return React.createElement(
      "div",
      null,
      children.map((child) => {
        const running = child.status === "running";
        const rowPartial = child.partial === true;
        const cost = computeChildCost(child, priceIndex);
        const costShown = cost ? { ...cost, partial: cost.partial || rowPartial } : null;
        const segments = Array.isArray(child.segments) ? child.segments : [];
        const isOpen = expanded[child.childId] === true;
        const title = [
          child.isSelf ? "\u4E3B\u7F16\u6392\uFF08\u672C\u4F1A\u8BDD\uFF09\uFF1A\u4F1A\u8BDD\u81EA\u8EAB\u7684\u6A21\u578B\u7528\u91CF\uFF0C\u4E0D\u542B\u5B50\u4EE3" : typeLabel(child.agentType),
          child.childId,
          running ? "\u8FD0\u884C\u4E2D\uFF08\u6570\u5B57\u968F\u8F6E\u8BE2\u5B9E\u65F6\u589E\u957F\uFF09" : null,
          child.frozen ? "\u7EC8\u6001\u5DF2\u51BB\u7ED3\uFF08\u4E0D\u518D\u626B\u63CF\uFF09" : null,
          rowPartial ? "\u542B\u672A\u4E0A\u62A5\u5206\u6876\uFF0C\u6570\u5B57\u4E3A\u4E0B\u754C" : null,
          `${child.messageCount ?? 0} \u6761\u6D88\u606F`
        ].filter(Boolean).join("\n");
        return React.createElement(
          "div",
          { key: child.childId, style: { marginBottom: 2 } },
          // 行1：状态 + 工种 + 短 id + 锁标 + 成本（有点击时展开/收起分段明细）
          gridRow(
            costColumn ? "minmax(0,1fr) 54px" : "minmax(0,1fr)",
            `c1-${child.childId}`,
            {
              onClick: segments.length > 0 ? () => toggleChild(child.childId) : void 0,
              accent: running ? ACCENT_RUNNING : void 0
            },
            React.createElement(
              "span",
              { style: { display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" } },
              React.createElement(
                "span",
                { style: { flexShrink: 0, width: 12, textAlign: "center", color: childGlyphColor(child.status) } },
                childGlyph(child.status)
              ),
              // 父会话自身的合成行（D6）带明确身份标识，不冒充工种徽章
              child.isSelf ? chip("\u4E3B\u7F16\u6392", "\u4E3B\u7F16\u6392\uFF08\u672C\u4F1A\u8BDD\uFF09\uFF1A\u4F1A\u8BDD\u81EA\u8EAB\u7684\u6A21\u578B\u7528\u91CF\uFF0C\u4E0D\u542B\u5B50\u4EE3", ACCENT_QUEUE) : typeChip(child.agentType),
              chip(shortId(child.childId, 6), child.childId),
              child.frozen ? React.createElement("span", { title: "\u7EC8\u6001\u5DF2\u51BB\u7ED3\uFF08\u4E0D\u518D\u626B\u63CF\uFF09", style: { flexShrink: 0, fontSize: 9 } }, "\u{1F512}") : null
            ),
            costColumn ? costCell(costShown) : null
          ),
          // 行2：该子代四桶合计（totals 是段间合计，§4）
          segments.length > 0 ? gridRow(
            GRID_NO_COST,
            `c2-${child.childId}`,
            { accent: running ? ACCENT_RUNNING : void 0 },
            ...BUCKET_COLUMNS.map(({ bucket, label }, index) => React.createElement(
              "span",
              {
                key: bucket,
                style: {
                  textAlign: "right",
                  color: "#888",
                  gridColumn: index === 0 ? "2" : void 0
                }
              },
              `${label} `,
              formatBucketCell(child.totals?.[bucket], rowPartial)
            ))
          ) : React.createElement("div", { style: { color: "#666", fontSize: 10, padding: "0 6px 2px 18px", fontFamily: MONO_FONT } }, "\u65E0\u6D88\u606F"),
          isOpen && segments.length > 0 ? segments.map((segment, i) => {
            const segPartial = segment.partial === true;
            const segCost = computeCost(segment.buckets, priceIndex[priceKey(segment.provider, segment.model)]);
            const segCostShown = segCost ? { ...segCost, partial: segCost.partial || segPartial } : null;
            const segName = modelDisplayKey(segment.provider, segment.model);
            return gridRow(
              costColumn ? GRID_WITH_COST : GRID_NO_COST,
              `s-${child.childId}-${i}`,
              { padding: "1px 6px 1px 18px" },
              nameCell(segName, segName),
              ...BUCKET_COLUMNS.map(({ bucket }) => tokenCell(segment.buckets?.[bucket], segPartial)),
              costColumn ? costCell(segCostShown) : null
            );
          }) : null
        );
      })
    );
  };
  const renderTotals = () => {
    const children = Array.isArray(report.children) ? report.children : [];
    const byModel = Array.isArray(report.byModel) ? report.byModel : [];
    const totalCost = computeTotalCost(report);
    const totalCostShown = totalCost ? { ...totalCost, partial: totalCost.partial || partial } : null;
    const stat = (label, value, title) => React.createElement(
      "div",
      { key: label, title, style: { padding: "2px 0" } },
      React.createElement("div", { style: { color: "#777", fontSize: 10 } }, label),
      React.createElement("div", { style: { color: "#c8c8c8", fontFamily: MONO_FONT, fontSize: 14 } }, value)
    );
    const bucketStat = ({ bucket, label }) => {
      const value = report.totals?.[bucket];
      return stat(label, formatBucketCell(value, partial), value === null || value === void 0 ? "\u672A\u4E0A\u62A5\uFF08\u2260 0\uFF09" : `\u7CBE\u786E\u503C ${formatFullTokens(value)}${partial ? "\uFF08\u542B\u672A\u4E0A\u62A5\u5206\u6876\uFF0C\u4E3A\u4E0B\u754C\uFF09" : ""}`);
    };
    return React.createElement(
      "div",
      { style: { padding: "4px 6px" } },
      React.createElement(
        "div",
        { style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", columnGap: 8 } },
        BUCKET_COLUMNS.map(bucketStat)
      ),
      costColumn ? React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.06)" } },
        React.createElement("span", { style: { color: "#777", fontSize: 11 } }, "\u603B\u6210\u672C"),
        React.createElement("span", { title: totalCostShown ? `\u7CBE\u786E\u503C ${costSymbol}${totalCostShown.value.toFixed(6)}${totalCostShown.partial ? "\uFF08\u542B\u672A\u5B9A\u4EF7/\u672A\u4E0A\u62A5\u6876\uFF0C\u4E3A\u4E0B\u754C\uFF09" : ""}` : void 0, style: { color: "#c8c8c8", fontFamily: MONO_FONT, fontSize: 13 } }, formatCost(totalCostShown, report?.currency) ?? "\u2014")
      ) : null,
      React.createElement(
        "div",
        { style: { color: "#888", fontSize: 11, marginTop: 6 } },
        `\u5B50\u4EE3 ${childRowCount(report)} \xB7 \u6A21\u578B\u6BB5 ${byModel.length} \xB7 \u6D88\u606F ${sumMessageCount(report)} \u6761`
      ),
      partial ? React.createElement("div", { style: { color: "#777", fontSize: 10, marginTop: 2 } }, "\u5E26 \u2265 \u7684\u6570\u5B57\u4E3A\u4E0B\u754C\uFF1A\u90E8\u5206\u5206\u6876\u672A\u4E0A\u62A5\u6216\u626B\u63CF\u4E0D\u5B8C\u6574\uFF0C\u5982\u5B9E\u4E0D\u8BA1\u5165\u3002") : null
    );
  };
  const renderBody = () => {
    if (empty !== null) {
      const bannerStyle = {
        marginBottom: 4,
        padding: "5px 8px",
        borderRadius: 6,
        background: "rgba(244,67,54,0.1)",
        border: "1px solid rgba(244,67,54,0.3)",
        fontSize: 11
      };
      if (empty.kind === "error") {
        return React.createElement(
          "div",
          null,
          React.createElement("div", { style: bannerStyle }, `\u26A0 ${empty.message}`),
          empty.hint ? React.createElement("div", { style: { color: "#888", fontSize: 10, padding: "0 6px" } }, empty.hint) : null
        );
      }
      return React.createElement("div", { style: { color: "#888", fontSize: 12, padding: "2px 8px 4px" } }, empty.message);
    }
    const list = tab === "models" ? renderModels() : tab === "children" ? renderChildren() : renderTotals();
    if (tab === "totals") return list;
    return React.createElement("div", { style: { maxHeight: LIST_MAX_HEIGHT, overflowY: "auto", minWidth: 0 } }, list);
  };
  const generatedAtTitle = () => {
    const ts = Number(report?.generatedAt);
    return Number.isFinite(ts) && ts > 0 ? `\u6570\u636E\u751F\u6210\u4E8E ${new Date(ts).toLocaleTimeString()}` : "\u5F53\u524D\u4F1A\u8BDD\u7684\u7F16\u6392\u7528\u91CF\u7EDF\u8BA1";
  };
  return React.createElement(
    "div",
    { style: { marginBottom: 10 } },
    React.createElement(
      "div",
      {
        style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: open ? 4 : 0 },
        onClick: onToggle,
        title: generatedAtTitle()
      },
      React.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, `${open ? "\u25BE" : "\u25B8"} \u7528\u91CF\u7EDF\u8BA1`),
      report ? React.createElement(
        "span",
        { style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" } },
        String(Array.isArray(report.children) ? report.children.length : 0)
      ) : null
    ),
    open ? React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "div",
        { style: { display: "flex", gap: 4, marginBottom: 4 } },
        USAGE_TABS.map((t) => React.createElement("button", {
          key: t.key,
          onClick: () => setTab(t.key),
          style: {
            border: "none",
            background: tab === t.key ? "rgba(255,255,255,0.12)" : "transparent",
            color: tab === t.key ? "#e0e0e0" : "#999",
            fontSize: 11,
            lineHeight: "18px",
            padding: "1px 8px",
            borderRadius: 10,
            cursor: "pointer",
            fontFamily: "inherit"
          }
        }, t.label))
      ),
      renderBody()
    ) : null
  );
}

// src/panel-graph.js
var React2 = __toESM(require("react"), 1);
var W = 296;
var H = 300;
var CENTER = { x: 148, y: 150, r: 22 };
var ORBIT_R = 105;
var READ_SLOTS = [{ x: 74, y: 76 }, { x: 148, y: 45 }, { x: 222, y: 76 }];
var WRITE_SLOT = { x: 148, y: 255 };
var DOCK = [{ x: 26, y: 268 }, { x: 50, y: 268 }, { x: 74, y: 268 }];
var NODE_R = 16;
var DOCK_W = 18;
var DOCK_H = 15;
var SPAWN_BURST = 10;
var REFLOW_BURST = 12;
var STREAM_GAP = 340;
var HELP_GAP = 700;
var FADE_DELAY = 250;
var FADE_DUR = 650;
var GONE_FADE_DUR = 300;
var EDGE_FLASH_TTL = 2e3;
var UNKNOWN_COLOR = "#9e9e9e";
var HALO_COLOR = "#1e1e1e";
var ORBIT_COLOR = "#3a3a3a";
var LANE_LABEL_COLOR = "#5c5c5c";
var TERMINAL_STATUS = /* @__PURE__ */ new Set(["done", "failed"]);
var READ_LANE_TYPES = /* @__PURE__ */ new Set(["explore", "librarian"]);
var laneOf = (t) => READ_LANE_TYPES.has(t) ? "read" : "write";
var agentColor = (t) => AGENT_COLORS[t] ?? UNKNOWN_COLOR;
var glyphColor = (s) => s === "waiting" || s === "failed" ? ACCENT_HELP : s === "queued" ? ACCENT_QUEUE : s === "done" || s === "running" ? ACCENT_RUNNING : "#ddd";
var recordId = (rec) => {
  const id = rec ? rec.childId ?? rec.id : null;
  return id ? String(id) : "";
};
var parentIdOf = (rec) => {
  const pid = rec ? rec.parentSessionId : null;
  return typeof pid === "string" && pid ? pid : "";
};
var recordTime = (rec) => {
  const t = Number(rec ? rec.updatedAt ?? rec.createdAt ?? 0 : 0);
  return Number.isFinite(t) ? t : 0;
};
function endedByChild(histories) {
  const out = /* @__PURE__ */ new Map();
  for (const rec of Array.isArray(histories) ? histories : []) {
    const id = recordId(rec);
    if (!id || !TERMINAL_STATUS.has(rec && rec.status)) continue;
    const t = recordTime(rec);
    const prev = out.get(id);
    if (!prev || t >= prev.t) out.set(id, { status: rec.status, t });
  }
  return out;
}
function buildLabels(nodes) {
  const groups = /* @__PURE__ */ new Map();
  for (const n of nodes.values()) {
    const t = n.rec.agentType;
    const list = groups.get(t);
    if (list) list.push(n);
    else groups.set(t, [n]);
  }
  const labels = /* @__PURE__ */ new Map();
  for (const [t, list] of groups) {
    if (list.length === 1) {
      labels.set(list[0].rec.id, typeName(t));
      continue;
    }
    list.sort((a, b) => (a.rec.createdAt ?? 0) - (b.rec.createdAt ?? 0));
    list.forEach((n, i) => labels.set(n.rec.id, `${typeName(t)}#${i + 1}`));
  }
  return labels;
}
var mainViewHeld = (row) => {
  const n = row && row.retainedBy ? row.retainedBy.mainView : void 0;
  return typeof n === "number" ? n > 0 : n === true;
};
function readCurrentSessionId(sessions) {
  try {
    const list = sessions && sessions.list;
    if (list && typeof list.getSnapshot === "function") {
      const snap = list.getSnapshot();
      if (snap) {
        const current = snap.current;
        if (typeof current === "string" && current) return current;
        const byId = snap.byId;
        if (byId && typeof byId === "object") {
          const ids = Array.isArray(snap.ids) ? snap.ids : [];
          for (const id of ids) {
            if (typeof id === "string" && id && mainViewHeld(byId[id])) return id;
          }
          for (const id of Object.keys(byId)) {
            if (mainViewHeld(byId[id])) return id;
          }
        }
      }
    }
  } catch {
  }
  return void 0;
}
function mostActiveParent(items, order) {
  const latest = /* @__PURE__ */ new Map();
  for (const r of items) {
    const pid = parentIdOf(r);
    if (!pid) continue;
    const t = recordTime(r);
    if (t > (latest.get(pid) ?? -Infinity)) latest.set(pid, t);
  }
  let best = order[0];
  let bestTs = -Infinity;
  for (const pid of order) {
    const t = latest.get(pid) ?? -Infinity;
    if (t > bestTs) {
      bestTs = t;
      best = pid;
    }
  }
  return best;
}
function pickBucket(records, queue, histories, currentParentId) {
  const recs = Array.isArray(records) ? records : [];
  const que = Array.isArray(queue) ? queue : [];
  const his = Array.isArray(histories) ? histories : [];
  const all = recs.concat(que, his);
  const order = [];
  for (const r of all) {
    const pid = parentIdOf(r);
    if (pid && order.indexOf(pid) < 0) order.push(pid);
  }
  const parentCount = order.length;
  const ofParent = (list, pid) => list.filter((r) => parentIdOf(r) === pid);
  if (currentParentId !== void 0) {
    return {
      records: ofParent(recs, currentParentId),
      queue: ofParent(que, currentParentId),
      histories: ofParent(his, currentParentId),
      parentSessionId: currentParentId,
      parentCount
    };
  }
  if (parentCount <= 1) {
    return { records: recs, queue: que, histories: his, parentSessionId: order[0], parentCount };
  }
  const pick = mostActiveParent(all, order);
  return {
    records: ofParent(recs, pick),
    queue: ofParent(que, pick),
    histories: ofParent(his, pick),
    parentSessionId: pick,
    parentCount
  };
}
function toCanvasPoint(rect, clientX, clientY) {
  const width = rect && Number.isFinite(rect.width) ? rect.width : 0;
  const k = width > 0 ? W / width : 1;
  const left = rect && Number.isFinite(rect.left) ? rect.left : 0;
  const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
  return { x: (clientX - left) * k, y: (clientY - top) * k };
}
function emptyGraphHint(scope) {
  if (!scope || scope.records.length > 0 || scope.queue.length > 0) return null;
  const suffix = scope.parentCount > 1 && scope.parentSessionId ? `\uFF08\u672C\u56FE\u4EC5 \xB7${String(scope.parentSessionId).slice(-6)} \u6876\uFF09` : "";
  return `\u5F53\u524D\u4F1A\u8BDD\u65E0\u5728\u98DE\u5B50\u4EE3${suffix}`;
}
var nowMs = () => typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
var hasRaf = typeof requestAnimationFrame === "function";
function createGraphEngine(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, typeof window !== "undefined" && window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const nodes = /* @__PURE__ */ new Map();
  const particles = [];
  const edgeFlash = /* @__PURE__ */ new Map();
  const readSlots = [null, null, null];
  let writeSlotUsed = null;
  let queueView = [];
  let centerFlashT = -1e9;
  let centerFlashColor = ACCENT_RUNNING;
  let rafId = null;
  let destroyed = false;
  let reduceQuery = null;
  const t0 = nowMs();
  const T = () => nowMs() - t0;
  let seed = 42;
  const rnd = () => (seed = seed * 1103515245 + 12345 & 2147483647) / 2147483647;
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    }
  } catch {
    reduceQuery = null;
  }
  const staticMode = () => !!(reduceQuery && reduceQuery.matches);
  function addParticle(fx, fy, tx, ty, color, delay, dur, size) {
    particles.push({ fx, fy, tx, ty, color, t0: T() + delay, dur, size: size ?? 1.8 });
  }
  function burst(from, to, color, n, spreadDelay, dur) {
    for (let i = 0; i < n; i++) addParticle(from.x, from.y, to.x, to.y, color, rnd() * spreadDelay, dur + rnd() * 120, 1.5 + rnd());
  }
  function allocSlot(id, agentType) {
    if (laneOf(agentType) === "read") {
      for (let i = 0; i < READ_SLOTS.length; i++) {
        if (!readSlots[i]) {
          readSlots[i] = id;
          return READ_SLOTS[i];
        }
      }
      return READ_SLOTS[0];
    }
    writeSlotUsed = id;
    return WRITE_SLOT;
  }
  function freeSlot(n) {
    const i = readSlots.indexOf(n.rec.id);
    if (i >= 0) readSlots[i] = null;
    if (writeSlotUsed === n.rec.id) writeSlotUsed = null;
  }
  function collect(now) {
    for (const n of [...nodes.values()]) {
      if (n.fade && now > n.fade.t0 + n.fade.dur) {
        freeSlot(n);
        nodes.delete(n.rec.id);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if ((now - p.t0) / p.dur >= 1) particles.splice(i, 1);
    }
    for (const [id, t] of [...edgeFlash]) {
      if (!nodes.has(id) || now - t > EDGE_FLASH_TTL) edgeFlash.delete(id);
    }
  }
  function spawnNode(rec, id, now) {
    const pos = allocSlot(id, rec.agentType);
    const n = {
      rec: { id, agentType: rec.agentType, status: rec.status, createdAt: rec.createdAt ?? 0 },
      pos,
      born: now,
      fade: null,
      lastStream: now + rnd() * STREAM_GAP,
      lastHelp: now
    };
    nodes.set(id, n);
    edgeFlash.set(id, now);
    burst(CENTER, pos, agentColor(rec.agentType), SPAWN_BURST, 300, 600);
    return n;
  }
  function transition(n, to, now) {
    const color = agentColor(n.rec.agentType);
    if (TERMINAL_STATUS.has(to)) {
      burst(n.pos, CENTER, to === "done" ? ACCENT_RUNNING : ACCENT_HELP, REFLOW_BURST, 450, 550);
      centerFlashT = now + 250;
      centerFlashColor = to === "done" ? ACCENT_RUNNING : ACCENT_HELP;
      n.fade = { t0: now + FADE_DELAY, dur: FADE_DUR };
    } else if (to === "waiting") {
      edgeFlash.set(n.rec.id, now);
    } else if (to === "running") {
      burst(CENTER, n.pos, color, 4, 200, 500);
    }
    n.rec.status = to;
  }
  function applySnapshot(records, queue, histories) {
    if (destroyed) return;
    const now = T();
    collect(now);
    const ended = endedByChild(histories);
    const seen = /* @__PURE__ */ new Set();
    for (const rec of Array.isArray(records) ? records : []) {
      const id = recordId(rec);
      if (!id) continue;
      seen.add(id);
      const n = nodes.get(id);
      if (!n) {
        spawnNode(rec, id, now);
        continue;
      }
      if (n.fade) n.fade = null;
      if (n.rec.status !== rec.status) transition(n, rec.status, now);
    }
    for (const [id, n] of [...nodes]) {
      if (seen.has(id) || n.fade) continue;
      const end = ended.get(id);
      if (end) transition(n, end.status, now);
      else n.fade = { t0: now, dur: GONE_FADE_DUR };
    }
    queueView = (Array.isArray(queue) ? queue : []).slice(0, 3);
    if (staticMode()) render(now, true);
  }
  function drawGlyph(status, cx, cy, color, t) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    switch (status) {
      case "running":
        ctx.beginPath();
        ctx.arc(cx, cy, 4.2, 0, 7);
        ctx.fill();
        break;
      case "spawning": {
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 7);
        ctx.stroke();
        const a = t / 500 % (Math.PI * 2);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, 4.4, a, a + Math.PI);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "queued": {
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 5);
        ctx.lineTo(cx + 4, cy - 5);
        ctx.lineTo(cx - 4, cy + 5);
        ctx.lineTo(cx + 4, cy + 5);
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case "waiting": {
        ctx.beginPath();
        ctx.moveTo(cx - 2.3, cy - 1.3);
        ctx.lineTo(cx - 0.9, cy - 3.9);
        ctx.lineTo(cx + 1.9, cy - 2.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 1.9, cy - 2.3);
        ctx.lineTo(cx + 0.1, cy + 0.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 0.1, cy + 3.6, 1.1, 0, 7);
        ctx.fill();
        break;
      }
      case "done":
        ctx.beginPath();
        ctx.moveTo(cx - 4.5, cy);
        ctx.lineTo(cx - 1.5, cy + 3.5);
        ctx.lineTo(cx + 4.5, cy - 3.5);
        ctx.stroke();
        break;
      case "failed":
        ctx.beginPath();
        ctx.moveTo(cx - 3.5, cy - 3.5);
        ctx.lineTo(cx + 3.5, cy + 3.5);
        ctx.moveTo(cx + 3.5, cy - 3.5);
        ctx.lineTo(cx - 3.5, cy + 3.5);
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, 7);
        ctx.stroke();
    }
    ctx.restore();
  }
  function haloText(text2, x, y, font, color) {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = HALO_COLOR;
    ctx.strokeText(text2, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text2, x, y);
    ctx.restore();
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function render(now, isStatic) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ORBIT_COLOR;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ORBIT_R, Math.PI * 1.14, Math.PI * 1.86);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ORBIT_R, Math.PI * 0.14, Math.PI * 0.86);
    ctx.stroke();
    ctx.restore();
    haloText("\u8BFB\u6CF3\u9053 \xB7 \u22643 \u5E76\u884C", 44, 12, `9px ${MONO_FONT}`, LANE_LABEL_COLOR);
    haloText("\u5199\u6CF3\u9053 \xB7 \u5355\u7EBF", 248, 292, `9px ${MONO_FONT}`, LANE_LABEL_COLOR);
    haloText("\u961F\u5217", 26, 250, `9px ${MONO_FONT}`, LANE_LABEL_COLOR);
    for (const n of nodes.values()) {
      const { x, y } = n.pos;
      const waiting = n.rec.status === "waiting";
      const agent = agentColor(n.rec.agentType);
      let alpha = 0.3;
      const ef = edgeFlash.get(n.rec.id);
      if (ef !== void 0) alpha += 0.55 * Math.exp(-(now - ef) / 320);
      let width = 1.2;
      if (!isStatic && n.rec.status === "running") width = 1.2 + 0.4 * Math.sin(now / 700 + n.born);
      if (waiting && !isStatic) alpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(now / 200));
      let fadeA = 1;
      if (n.fade) fadeA = Math.max(0, 1 - (now - n.fade.t0) / n.fade.dur);
      const dx = x - CENTER.x, dy = y - CENTER.y, len = Math.hypot(dx, dy);
      const sx = CENTER.x + dx / len * (CENTER.r + 2), sy = CENTER.y + dy / len * (CENTER.r + 2);
      const ex = x - dx / len * (NODE_R + 2), ey = y - dy / len * (NODE_R + 2);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha) * fadeA;
      ctx.strokeStyle = waiting ? ACCENT_HELP : agent;
      ctx.lineWidth = width;
      ctx.shadowColor = waiting ? ACCENT_HELP : agent;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
    }
    if (!isStatic) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const k = (now - p.t0) / p.dur;
        if (k < 0) continue;
        if (k >= 1) {
          particles.splice(i, 1);
          continue;
        }
        for (let g = 0; g < 3; g++) {
          const kk = k - g * 0.07;
          if (kk < 0) continue;
          ctx.globalAlpha = Math.sin(Math.PI * kk) * [0.9, 0.4, 0.15][g];
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.fx + (p.tx - p.fx) * kk, p.fy + (p.ty - p.fy) * kk, p.size * (1 - g * 0.25), 0, 7);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    const labels = buildLabels(nodes);
    for (const n of nodes.values()) {
      const { x, y } = n.pos;
      const agent = agentColor(n.rec.agentType);
      let scale = 1, alpha = 1;
      const sp = Math.min(1, (now - n.born) / 400);
      if (sp < 1) {
        const c1 = 1.70158, c3 = c1 + 1;
        scale = 1 + c3 * Math.pow(sp - 1, 3) + c1 * Math.pow(sp - 1, 2);
      }
      if (isStatic) scale = 1;
      if (n.fade) {
        const k = Math.min(1, Math.max(0, (now - n.fade.t0) / n.fade.dur));
        alpha = 1 - k;
        scale *= 1 - 0.4 * k;
      }
      const waiting = n.rec.status === "waiting";
      const running = n.rec.status === "running";
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      let glow = 6;
      if (!isStatic && running) glow = 9 + 5 * Math.sin(now / 1400 * Math.PI * 2 + n.born);
      if (waiting) glow = 12;
      ctx.shadowColor = waiting ? ACCENT_HELP : agent;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      ctx.arc(0, 0, NODE_R, 0, 7);
      ctx.fillStyle = agent + "2e";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = waiting ? ACCENT_HELP : agent;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (waiting) {
        const ra = isStatic ? 0.8 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(now / 160));
        ctx.globalAlpha = alpha * ra;
        ctx.strokeStyle = ACCENT_HELP;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, NODE_R + 4.5, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      drawGlyph(n.rec.status, 0, 0, glyphColor(n.rec.status), isStatic ? 0 : now);
      ctx.restore();
      haloText(labels.get(n.rec.id) ?? typeName(n.rec.agentType), x, y + NODE_R + 11, `9.5px ${MONO_FONT}`, `rgba(200,200,200,${alpha})`);
    }
    queueView.forEach((q, i) => {
      const d = DOCK[i];
      if (!d) return;
      const c = agentColor(q && q.agentType);
      ctx.save();
      ctx.globalAlpha = isStatic ? 0.85 : 0.65 + 0.2 * Math.sin(now / 500 + i);
      ctx.fillStyle = c + "22";
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      roundRectPath(d.x - DOCK_W / 2, d.y - 8, DOCK_W, DOCK_H, 3);
      ctx.fill();
      ctx.stroke();
      drawGlyph("queued", d.x, d.y - 0.5, ACCENT_QUEUE, now);
      ctx.restore();
    });
    const flashK = Math.min(1, Math.max(0, (now - centerFlashT) / 500));
    ctx.save();
    const breathe = isStatic ? 0 : Math.sin(now / 2400 * Math.PI * 2);
    ctx.shadowColor = AGENT_COLORS.sisyphus;
    ctx.shadowBlur = 12 + 4 * breathe + flashK * 18;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, CENTER.r, 0, 7);
    ctx.fillStyle = `rgba(100,181,246,${0.16 + 0.25 * flashK})`;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = AGENT_COLORS.sisyphus;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, 6.5, 0, 7);
    ctx.fillStyle = AGENT_COLORS.sisyphus;
    ctx.fill();
    ctx.restore();
    if (flashK > 0 && !isStatic) {
      ctx.save();
      ctx.globalAlpha = 0.75 * (1 - flashK);
      ctx.strokeStyle = centerFlashColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CENTER.x, CENTER.y, CENTER.r + 4 + flashK * 20, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
    haloText("Sisyphus", CENTER.x, CENTER.y + CENTER.r + 11, `10px ${MONO_FONT}`, "#9ec9ef");
  }
  function frame() {
    if (destroyed) return;
    const now = T();
    collect(now);
    for (const n of nodes.values()) {
      if (n.fade) continue;
      if (n.rec.status === "running" && now - n.lastStream > STREAM_GAP) {
        n.lastStream = now;
        addParticle(CENTER.x, CENTER.y, n.pos.x, n.pos.y, agentColor(n.rec.agentType), 0, 900, 1.6);
      }
      if (n.rec.status === "waiting" && now - n.lastHelp > HELP_GAP) {
        n.lastHelp = now;
        addParticle(n.pos.x, n.pos.y, CENTER.x, CENTER.y, ACCENT_HELP, 0, 700, 2);
      }
    }
    render(now, false);
    rafId = hasRaf && !staticMode() ? requestAnimationFrame(frame) : null;
  }
  function onMotionPreferenceChange() {
    if (destroyed) return;
    if (staticMode()) {
      if (rafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      rafId = null;
      const now = T();
      collect(now);
      render(now, true);
      return;
    }
    if (hasRaf && rafId == null) rafId = requestAnimationFrame(frame);
  }
  if (reduceQuery) {
    if (typeof reduceQuery.addEventListener === "function") reduceQuery.addEventListener("change", onMotionPreferenceChange);
    else if (typeof reduceQuery.addListener === "function") reduceQuery.addListener(onMotionPreferenceChange);
  }
  function start() {
    if (destroyed) return;
    if (!hasRaf || staticMode()) {
      const now = T();
      collect(now);
      render(now, true);
      return;
    }
    if (rafId != null) return;
    rafId = requestAnimationFrame(frame);
  }
  function destroy() {
    destroyed = true;
    if (rafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    rafId = null;
    if (reduceQuery) {
      if (typeof reduceQuery.removeEventListener === "function") reduceQuery.removeEventListener("change", onMotionPreferenceChange);
      else if (typeof reduceQuery.removeListener === "function") reduceQuery.removeListener(onMotionPreferenceChange);
    }
    nodes.clear();
    particles.length = 0;
    edgeFlash.clear();
  }
  function hitTest(cssX, cssY) {
    let best = null;
    let bestD = NODE_R + 6;
    for (const n of nodes.values()) {
      if (n.fade) continue;
      const d = Math.hypot(cssX - n.pos.x, cssY - n.pos.y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }
  const stats = () => ({ nodes: nodes.size, particles: particles.length, flashes: edgeFlash.size, running: rafId != null });
  return { applySnapshot, start, destroy, hitTest, stats };
}
function GraphCanvas({ records, queue, histories }) {
  const canvasRef = React2.useRef(null);
  const engineRef = React2.useRef(null);
  React2.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return void 0;
    const engine = createGraphEngine(canvas);
    engineRef.current = engine;
    engine.start();
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
  }, []);
  React2.useEffect(() => {
    const engine = engineRef.current;
    if (engine) engine.applySnapshot(records, queue, histories);
  }, [records, queue, histories]);
  const onMove = (e) => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas) return;
    const p = toCanvasPoint(canvas.getBoundingClientRect(), e.clientX, e.clientY);
    const n = engine.hitTest(p.x, p.y);
    canvas.title = n ? `${typeLabel(n.rec.agentType)}
${shortId(n.rec.id)}` : "";
  };
  const onLeave = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.title = "";
  };
  return React2.createElement("canvas", {
    ref: canvasRef,
    onMouseMove: onMove,
    onMouseLeave: onLeave,
    style: { display: "block", width: W, height: "auto", maxWidth: "100%" }
  });
}
function GraphSection({ records, queue, histories, sessions }) {
  const [open, setOpen] = React2.useState(true);
  const scope = pickBucket(records, queue, histories, readCurrentSessionId(sessions));
  const waiting = scope.records.filter((r) => r && r.status === "waiting").length;
  const ownerChip = scope.parentCount > 1 && scope.parentSessionId ? React2.createElement("span", {
    title: scope.parentSessionId,
    style: {
      flexShrink: 0,
      maxWidth: 60,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontFamily: MONO_FONT,
      fontSize: 10,
      lineHeight: "15px",
      padding: "0 5px",
      borderRadius: 4,
      color: "#9e9e9e",
      background: "rgba(255,255,255,0.07)"
    }
  }, `\xB7${String(scope.parentSessionId).slice(-6)}`) : null;
  const hint = emptyGraphHint(scope);
  return React2.createElement(
    "div",
    { style: { marginBottom: 10 } },
    React2.createElement(
      "div",
      {
        style: { cursor: "pointer", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 4 },
        onClick: () => setOpen((v) => !v),
        title: open ? "\u6536\u8D77\u661F\u56FE" : "\u5C55\u5F00\u6CF3\u9053\u661F\u56FE\uFF08Sisyphus \u5B50\u4EE3\u5B9E\u65F6\u52A8\u753B\uFF1B\u5C55\u5F00\u65F6\u6309\u5F53\u524D\u5B50\u4EE3\u91CD\u653E\u4E00\u6B21\u6D3E\u5DE5\u8109\u51B2\uFF09"
      },
      React2.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, `${open ? "\u25BE" : "\u25B8"} \u661F\u56FE`),
      React2.createElement("span", {
        style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" }
      }, String(scope.records.length)),
      ownerChip,
      waiting > 0 ? React2.createElement("span", { style: { fontSize: 11, color: ACCENT_HELP } }, `${waiting} \u6C42\u52A9`) : null,
      scope.queue.length > 0 ? React2.createElement("span", { style: { fontSize: 11, color: ACCENT_QUEUE } }, `\u961F\u5217 ${scope.queue.length}`) : null,
      hint ? React2.createElement("span", { style: { fontSize: 11, color: "#777" } }, hint) : null
    ),
    open ? React2.createElement(GraphCanvas, { records: scope.records, queue: scope.queue, histories: scope.histories }) : null
  );
}

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
      const res = await connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.snapshot, {});
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
        void pollUsage();
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
  let usageVisible = false;
  let usageInFlight = false;
  let usage = { state: "idle", report: null, detail: "" };
  async function pollUsage() {
    if (!usageVisible || usageInFlight) return;
    if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") return;
    usageInFlight = true;
    try {
      const pid = usageSessionTarget(currentSessionId(), snapshot.parents);
      if (pid === null) {
        usage = { state: sessionsListPhase(sessions) === "pending" ? "session-pending" : "no-session", report: null, detail: "" };
        emit();
        return;
      }
      if (usage.state !== "ok" || usage.report?.parentSessionId !== pid) {
        usage = { state: "loading", report: null, detail: "" };
        emit();
      }
      const res = await connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.getUsage, { parentSessionId: pid });
      if (res && res.ok) {
        usage = { state: "ok", report: res.value, detail: "" };
      } else {
        usage = { state: "error", report: null, detail: String(res?.error?.message ?? "") };
        pollBackoffStep = Math.min(pollBackoffStep + 1, POLL_BACKOFF_MS.length - 1);
        nextPollAt = Date.now() + POLL_BACKOFF_MS[pollBackoffStep];
      }
      emit();
    } catch (error) {
      usage = { state: "error", report: null, detail: String(error) };
      pollBackoffStep = Math.min(pollBackoffStep + 1, POLL_BACKOFF_MS.length - 1);
      nextPollAt = Date.now() + POLL_BACKOFF_MS[pollBackoffStep];
      emit();
    } finally {
      usageInFlight = false;
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
    const [, force] = React3.useState(0);
    const [rosterOpen, setRosterOpen] = React3.useState(false);
    const [usageOpen, setUsageOpen] = React3.useState(true);
    React3.useEffect(() => {
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
    usageVisible = panelOpen && usageOpen;
    if (!panelOpen) return null;
    const s = snapshot;
    const parents = s.parents && typeof s.parents === "object" ? s.parents : {};
    const parentList = Object.values(parents).filter((p) => p && p.parentSessionId !== LEGACY_PARENT_ID);
    const multi = parentList.length > 1;
    const chip = (text2, full, color) => React3.createElement("span", {
      title: full ?? text2,
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
    }, text2);
    const typeChip = (t) => React3.createElement("span", {
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
    const row = (opts, ...cells) => React3.createElement(
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
      React3.createElement("span", { style: { flexShrink: 0, width: 14, textAlign: "center", color: opts.glyphColor } }, opts.glyph),
      ...cells
    );
    const tail = (text2, title) => React3.createElement("span", {
      title,
      style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#a0a0a0", fontSize: 12 }
    }, text2);
    const jump = (childId, parentSessionId) => {
      if (sessions && typeof sessions.openSubagent === "function") {
        sessions.openSubagent({ parentSessionId: parentSessionId ?? "", childSessionId: childId, mode: "continuable" });
      }
    };
    const currents = parentList.flatMap((p) => Array.isArray(p?.currentRecords) ? p.currentRecords.map((c) => ({ ...c, parentSessionId: p.parentSessionId })) : []);
    const queues = parentList.flatMap((p) => Array.isArray(p?.queue) ? p.queue.map((w) => ({ ...w, parentSessionId: p.parentSessionId })) : []);
    const helps = parentList.flatMap((p) => Array.isArray(p?.helpRequests) ? p.helpRequests.map((h) => ({ ...h, parentSessionId: p.parentSessionId })) : []);
    const histories = parentList.flatMap((p) => Array.isArray(p?.history) ? p.history.map((r) => ({ ...r, parentSessionId: p.parentSessionId })) : []).sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
    const sectionHeader = (title, count, hint) => React3.createElement(
      "div",
      { title: hint, style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } },
      React3.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, title),
      React3.createElement("span", { style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" } }, String(count))
    );
    return React3.createElement(
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
      React3.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React3.createElement("strong", null, "Sisyphus \u7F16\u6392"),
        React3.createElement("button", { onClick: () => {
          panelOpen = false;
          emit();
        } }, "\xD7")
      ),
      bridgeProblem === "internal" ? React3.createElement("div", {
        style: { marginBottom: 10, padding: "6px 8px", borderRadius: 6, background: "rgba(255,152,0,0.12)", border: "1px solid rgba(255,152,0,0.35)", fontSize: 12 }
      }, `\u26A0 host \u7AEF\u7F16\u6392\u5FEB\u7167\u8BFB\u53D6\u5F02\u5E38\uFF08\u88C5\u914D\u5DF2\u5B8C\u6210\uFF0C\u6865\u51FD\u6570\u629B\u9519\uFF09\uFF1A${bridgeDetail || "\u672A\u63D0\u4F9B\u539F\u56E0"}\uFF1B\u9762\u677F\u505C\u5728\u6700\u540E\u4E00\u6B21\u5B9E\u51B5\uFF0C\u6309\u9000\u907F\u8282\u594F\u81EA\u52A8\u91CD\u8BD5\u3002`) : bridgeProblem === "absent" ? React3.createElement("div", {
        style: { marginBottom: 10, padding: "6px 8px", borderRadius: 6, background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.3)", fontSize: 12 }
      }, "\u26A0 \u7F16\u6392\u6865\u672A\u5C31\u7EEA\uFF1Ahost \u7AEF /dsh-my-go RPC \u65E0\u54CD\u5E94\uFF08\u63D2\u4EF6\u672A\u6FC0\u6D3B\u6216\u4ECD\u5728\u542F\u52A8\uFF09\uFF0C\u9762\u677F\u5C06\u6301\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002") : null,
      React3.createElement(GraphSection, { records: currents, queue: queues, histories, sessions }),
      // 运行中：保留区块（空时显示「空闲」，用户习惯看它），等待求助的条目用红色
      React3.createElement(
        "div",
        { style: { marginBottom: 10 } },
        sectionHeader("\u8FD0\u884C\u4E2D", currents.length),
        currents.length > 0 ? currents.map((c) => {
          const waiting = c.status === "waiting";
          return row(
            {
              key: `cur-${c.parentSessionId}-${c.childId ?? ""}`,
              glyph: statusGlyph(c.status),
              glyphColor: waiting ? ACCENT_HELP : ACCENT_RUNNING,
              accent: waiting ? ACCENT_HELP : ACCENT_RUNNING,
              onClick: c.childId ? () => jump(c.childId, c.parentSessionId) : void 0,
              title: c.childId ? `${typeLabel(c.agentType)}
${c.childId}` : typeLabel(c.agentType)
            },
            typeChip(c.agentType),
            suffixChip(c.parentSessionId),
            c.childId ? chip(shortId(c.childId), c.childId) : null
          );
        }) : React3.createElement("div", { style: { color: "#888", fontSize: 12, padding: "2px 8px" } }, "\u25CB \u7A7A\u95F2")
      ),
      // 队列 / 求助：空时整区折叠隐藏（比显示「无」更干净）
      queues.length > 0 ? React3.createElement(
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
      helps.length > 0 ? React3.createElement(
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
          React3.createElement("span", { style: { flexShrink: 0 } }, intentLabel(h.intent)),
          suffixChip(h.parentSessionId),
          h.childId ? chip(shortId(h.childId), h.childId) : null
        ))
      ) : null,
      // 历史：工种彩色徽章 + [备选 n/m] 紫色徽章 + 结论单行省略 + 相对时间
      histories.length > 0 ? React3.createElement(
        "div",
        null,
        sectionHeader("\u5386\u53F2", Math.min(8, histories.length), "\u4EC5\u663E\u793A\u6700\u8FD1 8 \u6761\u7ED3\u8BBA"),
        histories.slice(-8).map((r, i) => {
          const { note, text: text2 } = extractFallbackNote(r.conclusion);
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
            tail(text2, title),
            rel ? React3.createElement("span", { style: { flexShrink: 0, color: "#777", fontSize: 11 } }, rel) : null
          );
        })
      ) : null,
      // 用量统计区（契约步骤 6/7）：纯展示组件，自身不发 RPC——数据来自上方
      // 共享轮询的 usage 快照；从折叠展开时立即补一发，省掉最多 600ms 空窗。
      React3.createElement(UsageSection, {
        usage,
        open: usageOpen,
        onToggle: () => {
          const next = !usageOpen;
          setUsageOpen(next);
          if (next) {
            emit();
            void pollUsage();
          }
        }
      }),
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
          return React3.createElement(
            "div",
            {
              style: { cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 },
              onClick: () => setRosterOpen(true),
              title: "\u5C55\u5F00\u53EF\u6D3E\u89D2\u8272\u4E0E\u7ED1\u5B9A\u6458\u8981"
            },
            React3.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, "\u25B8 \u82B1\u540D\u518C"),
            count > 0 ? React3.createElement("span", { style: { fontSize: 11, lineHeight: "15px", padding: "0 6px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#999" } }, String(count)) : null
          );
        }
        return React3.createElement(
          "div",
          { style: { marginBottom: 10 } },
          sectionHeader("\u82B1\u540D\u518C", count, "\u53EF\u6D3E\u89D2\u8272\u4E0E\u7ED1\u5B9A\u6458\u8981\uFF08\u70B9\u51FB\u6807\u9898\u6298\u53E0\uFF09"),
          rows ? rows.map((entry) => React3.createElement(
            "div",
            {
              key: `ros-${entry?.role ?? ""}`,
              title: `${entry?.role ?? ""}\uFF1A${entry?.modelText ?? "\u8DDF\u968F\u73AF\u5883"}\uFF1B\u5907\u9009 ${Array.isArray(entry?.chain) ? entry.chain.length : 0} \u6761\uFF1B\u5DE5\u5177 ${entry?.toolFilterText ?? ""}\uFF1B\u4EBA\u8BBE ${entry?.personaSource ?? ""}`,
              style: { fontFamily: MONO_FONT, fontSize: 11, color: "#a0a0a0", padding: "2px 8px", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }
            },
            React3.createElement("span", null, `${entry?.role ?? "?"}`),
            React3.createElement("span", { style: { color: "#c8c8c8" } }, `\xB7 ${entry?.modelText ?? "\u8DDF\u968F\u73AF\u5883"}`),
            Array.isArray(entry?.chain) && entry.chain.length > 0 ? chip(`+${entry.chain.length}`, `\u5907\u9009\u94FE ${entry.chain.length} \u6761`, ACCENT_QUEUE) : null,
            entry?.builtin === false ? chip("\u81EA\u5B9A\u4E49", "\u81EA\u5B9A\u4E49\u89D2\u8272\uFF08\u4E0D\u5728\u5185\u7F6E\u516B\u5DE5\u79CD\u5185\uFF09") : null
          )) : legacyLines ? legacyLines.map((line, i) => React3.createElement("div", {
            key: `ros-${i}`,
            title: line,
            style: { fontFamily: MONO_FONT, fontSize: 11, color: "#a0a0a0", padding: "2px 8px", overflowWrap: "anywhere" }
          }, line)) : React3.createElement("div", { style: { color: "#888", fontSize: 12, padding: "2px 8px" } }, "\u82B1\u540D\u518C\u4E0D\u53EF\u7528\uFF08host \u672A\u5C31\u7EEA\uFF09")
        );
      })()
    );
  }
  slots.inject("shell.overlay", () => slots.register(
    { name: "shell.overlay", id: "dsh-my-go-panel" },
    (props) => React3.createElement(TreePanel, props)
  ));
  slots.inject("sidebar.footer.action", () => slots.register(
    { name: "sidebar.footer.action", id: "dsh-my-go-toggle" },
    (props) => React3.createElement("button", {
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
  const stopAutoJump = timer && typeof timer.interval === "function" ? timer.interval(() => {
    if (!sessions) return;
    const parents = snapshot.parents && typeof snapshot.parents === "object" ? snapshot.parents : {};
    const running = Object.values(parents).flatMap((p) => Array.isArray(p?.currentRecords) ? p.currentRecords.filter((c) => c.childId && c.status === "running").map((c) => ({ ...c, parentSessionId: p.parentSessionId })) : []);
    const myId = currentSessionId();
    if (lastJumped) {
      const owner = parents[lastJumped.parentSessionId];
      const stillRunning = Array.isArray(owner?.currentRecords) && owner.currentRecords.some((c) => c.childId === lastJumped.childId && c.status === "running");
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
    lastJumped = { childId: target.childId, parentSessionId: target.parentSessionId };
    try {
      sessions.openSubagent({
        parentSessionId: target.parentSessionId,
        childSessionId: target.childId,
        mode: "continuable"
      });
    } catch {
    }
  }, 800) : void 0;
  return () => {
    if (stopPolling) stopPolling();
    if (stopAutoJump) stopAutoJump();
  };
}

// src/settings-core.js
var React6 = __toESM(require("react"), 1);

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

// src/client-styles.js
var SETTINGS_CSS = `
.mygo-config {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, #ddd);
}
.mygo-intro {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #999);
  overflow-wrap: anywhere;
}
.mygo-notice,
.mygo-blocked {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-1, #232323);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.mygo-noticeWarn {
  border-color: rgba(230, 162, 60, 0.45);
}
.mygo-noticeError {
  border-color: var(--dsw-alias-state-error-primary, #f44336);
}
.mygo-block {
  border: 1px solid var(--dsw-alias-border-l1, #333);
  border-radius: 8px;
  padding: 12px;
  background: var(--dsw-alias-bg-layer-1, #1f1f1f);
}
.mygo-blockHead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.mygo-blockTitle {
  font-size: 13px;
  font-weight: 600;
}
.mygo-blockHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-count {
  font-size: 10px;
  line-height: 15px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.mygo-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mygo-colHead,
.mygo-colFoot {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mygo-colFoot {
  margin-top: 2px;
}
.mygo-list {
  height: 252px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1, #333);
  border-radius: 6px;
  padding: 2px;
  background: var(--dsw-alias-bg-layer-2, #1a1a1a);
}
.mygo-listRow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
}
.mygo-listRow[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(47, 111, 237, 0.18));
}
.mygo-rowName {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.mygo-rowMeta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mygo-rowBadge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 14px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-rowBadge[data-tone='on'] {
  border-color: var(--dsw-alias-state-success-primary, #4caf50);
  color: var(--dsw-alias-state-success-primary, #4caf50);
}
.mygo-rowBadge[data-tone='warn'] {
  border-color: rgba(230, 162, 60, 0.6);
  color: #e6a23c;
}
.mygo-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.mygo-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mygo-fieldWide {
  grid-column: 1 / -1;
}
.mygo-label {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-input,
.mygo-select,
.mygo-textarea {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-2, #161616);
  color: var(--dsw-alias-label-primary, #ddd);
  font-size: 12px;
  font-family: inherit;
}
.mygo-inputMono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.mygo-textarea {
  min-height: 60px;
  resize: vertical;
}
.mygo-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.mygo-chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mygo-chainRow {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) minmax(0, 1fr) 70px;
  gap: 6px;
  align-items: center;
}
.mygo-chainIndex {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-chainActors {
  display: flex;
  gap: 4px;
}
.mygo-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mygo-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.07));
  color: var(--dsw-alias-label-secondary, #999);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.mygo-chipName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mygo-chipKill {
  cursor: pointer;
  color: var(--dsw-alias-state-error-primary, #e57373);
  flex-shrink: 0;
}
.mygo-detail {
  min-height: 62px;
  max-height: 124px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-2, #1a1a1a);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mygo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
}
.mygo-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mygo-btn,
.mygo-btnPrimary {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-button-tool-bar-fill, transparent);
  color: var(--dsw-alias-label-primary, #ddd);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.mygo-btnPrimary {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2f6fed));
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #111);
  font-weight: 600;
}
.mygo-btnMini {
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
}
.mygo-btn:disabled,
.mygo-btnPrimary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.mygo-status {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-statusOk {
  font-size: 12px;
  color: var(--dsw-alias-state-success-primary, #4caf50);
  overflow-wrap: anywhere;
}
.mygo-statusError {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary, #f44336);
  overflow-wrap: anywhere;
}
.mygo-summary {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #999);
  overflow-wrap: anywhere;
}
`;
var STYLE_TAG = "dsh-my-go/settings.css";
function mountSettingsStyles() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`);
  if (existing !== null && existing !== void 0) return () => {
  };
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin", "dsh-my-go");
  tag.setAttribute("data-plugin-css", STYLE_TAG);
  tag.textContent = SETTINGS_CSS;
  document.head.appendChild(tag);
  return () => {
    if (tag.isConnected === false) return;
    tag.remove();
  };
}

// src/roster-rows.js
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
function withPersonaOverride(existingRow, text2) {
  const base = existingRow && typeof existingRow === "object" && !Array.isArray(existingRow) ? existingRow : {};
  return { ...base, persona: typeof text2 === "string" ? text2 : "" };
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

// src/settings-guard.js
var LOADING_HINT = "\u6B63\u5728\u8BFB\u53D6\u5BBF\u4E3B\u91CC\u7684 dsh-my-go \u914D\u7F6E\u2026";
var UNAVAILABLE_HINT = "dsh-my-go \u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\u4E0D\u53EF\u7528\uFF08\u63D2\u4EF6\u672A\u542F\u7528\u3001\u5BBF\u4E3B\u672A\u63D0\u4F9B\u8BBE\u7F6E\u670D\u52A1\uFF0C\u6216\u8BFB\u53D6\u5931\u8D25\uFF09\u3002";
var MEMORY_HINT = "\u5F53\u524D\u9875\u9762\u6309\u8FDB\u7A0B\u5185\u5185\u5B58\u6863\u6253\u5F00\uFF08\u975E\u672C\u673A\u56DE\u73AF\u8BBF\u95EE\uFF09\uFF0C\u8BBE\u7F6E\u53EA\u8BFB\uFF1A\u8BF7\u6539\u7528 http://127.0.0.1 \u6253\u5F00\u5BBF\u4E3B\uFF0C\u6216\u76F4\u63A5\u7F16\u8F91 settings.yaml\u3002";
function resolveCardView(snapshot) {
  if (snapshot === null || snapshot === void 0 || snapshot.status === "loading") {
    return { kind: "loading", hint: LOADING_HINT, retryable: false };
  }
  if (snapshot.mode === "memory") return { kind: "unavailable", hint: MEMORY_HINT, retryable: false };
  if (snapshot.status !== "ready") return { kind: "unavailable", hint: UNAVAILABLE_HINT, retryable: true };
  return { kind: "ready", hint: "", retryable: false };
}
function describeSaveOutcome(landed, revision) {
  const at = typeof revision === "number" ? ` \xB7 r${revision}` : "";
  if (landed) return { ok: true, text: `\u5DF2\u4FDD\u5B58\uFF0C\u914D\u7F6E\u5373\u65F6\u751F\u6548${at}` };
  return {
    ok: false,
    text: `\u6CA1\u843D\u76D8\uFF1A\u5BBF\u4E3B\u62D2\u7EDD\u4E86\u8FD9\u6B21\u5199\u5165\uFF08\u6821\u9A8C\u4E0D\u8FC7\uFF0C\u6216\u4ED6\u5904\u521A\u6539\u8FC7\u8FD9\u4E00\u547D\u540D\u7A7A\u95F4\uFF09\uFF0C\u8BF7\u4E22\u5F03\u8349\u7A3F\u5E76\u91CD\u8BFB${at}`
  };
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

// src/usage-price-rows.js
var isRowMap = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function sanitizeBucket(value) {
  const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}
function sanitizePriceRow(row) {
  if (!isRowMap(row)) return null;
  const out = {};
  for (const bucket of PRICE_REQUIRED_BUCKETS) {
    const num = sanitizeBucket(row[bucket]);
    if (num === null) return null;
    out[bucket] = num;
  }
  for (const bucket of PRICE_OPTIONAL_BUCKETS) {
    const num = sanitizeBucket(row[bucket]);
    if (num !== null) out[bucket] = num;
  }
  return out;
}
function validatePriceRow(row) {
  if (!isRowMap(row)) return "\u884C\u6570\u636E\u4E0D\u5408\u6CD5";
  for (const bucket of PRICE_REQUIRED_BUCKETS) {
    const raw = row[bucket];
    if (raw === void 0 || raw === null || typeof raw === "string" && raw.trim() === "") {
      return `\u300C${bucket}\u300D\u4E3A\u5FC5\u586B\u5355\u4EF7`;
    }
    if (sanitizeBucket(raw) === null) return `\u300C${bucket}\u300D\u987B\u4E3A\u975E\u8D1F\u6570\u5B57`;
  }
  for (const bucket of PRICE_OPTIONAL_BUCKETS) {
    const raw = row[bucket];
    if (raw === void 0 || raw === null || typeof raw === "string" && raw.trim() === "") continue;
    if (sanitizeBucket(raw) === null) return `\u300C${bucket}\u300D\u987B\u4E3A\u975E\u8D1F\u6570\u5B57\u6216\u7559\u7A7A`;
  }
  return null;
}
function priceKeyHint(key) {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (trimmed === "") return null;
  if (!PRICE_KEY_PATTERN.test(trimmed)) return "\u952E\u683C\u5F0F\uFF1Aprovider/model\uFF08\u7B2C\u4E00\u4E2A / \u5207\u5206\uFF0Cmodel \u53EF\u542B /\uFF09\uFF0C\u4E24\u6BB5\u90FD\u4E0D\u80FD\u4E3A\u7A7A";
  return null;
}

// src/settings-ops.js
var BINDING_FIELDS = ["provider", "model", "reasoningEffort", "dsv4p0813", "fallbacks"];
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) {
  return typeof value === "string" ? value : "";
}
function isVoidValue(value) {
  if (value === void 0 || value === null || value === "" || value === false) return true;
  return Array.isArray(value) && value.length === 0;
}
function clone(value) {
  return value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));
}
function bindingFieldsOf(row) {
  const source = record(row);
  const out = {};
  for (const field of BINDING_FIELDS) {
    if (!(field in source)) continue;
    out[field] = source[field];
  }
  return out;
}
function draftFromSection(value) {
  const section = record(value);
  const roles = record(section.roles);
  const draft = { roles: { ...roles } };
  for (const type of AGENT_TYPES) {
    const carried = type === "sisyphus" ? {} : record(roles[type]);
    const row = Object.keys(carried).length > 0 ? { ...record(section[type]), ...carried } : record(section[type]);
    draft[type] = {
      provider: text(row.provider),
      model: text(row.model),
      reasoningEffort: text(row.reasoningEffort),
      dsv4p0813: row.dsv4p0813 === true,
      fallbacks: normalizeChainRows(row.fallbacks)
    };
    if (typeof row.persona === "string") draft[type].persona = row.persona;
  }
  const prices = {};
  for (const [key, row] of Object.entries(record(section.usagePrices))) {
    if (typeof key === "string" && PRICE_KEY_PATTERN.test(key)) prices[key] = { ...record(row) };
  }
  draft.usagePrices = prices;
  draft.usageCurrency = section.usageCurrency === "CNY" ? "CNY" : "USD";
  return draft;
}
function normalizeForCompare(draft) {
  const source = record(draft);
  const roles = { ...record(source.roles) };
  for (const type of AGENT_TYPES) {
    if (type === "sisyphus" || source[type] === void 0) continue;
    roles[type] = { ...record(roles[type]), ...record(source[type]) };
  }
  const out = { roles: {} };
  for (const type of AGENT_TYPES) {
    const row = record(source[type]);
    out[type] = {
      provider: text(row.provider).trim(),
      model: text(row.model).trim(),
      reasoningEffort: text(row.reasoningEffort),
      dsv4p0813: row.dsv4p0813 === true,
      fallbacks: normalizeChainRows(stripEmptyFallbackRows({ fallbacks: normalizeChainRows(row.fallbacks) }).fallbacks)
    };
  }
  for (const key of Object.keys(roles).sort()) {
    if (typeof key !== "string" || !ROLE_KEY_PATTERN.test(key) || key === "sisyphus") continue;
    const entry = record(roles[key]);
    const normalized = {};
    for (const field of BINDING_FIELDS) {
      normalized[field] = field === "fallbacks" ? normalizeChainRows(stripEmptyFallbackRows({ fallbacks: normalizeChainRows(entry.fallbacks) }).fallbacks) : field === "dsv4p0813" ? entry[field] === true : text(entry[field]).trim();
    }
    normalized.persona = text(entry.persona);
    normalized.toolFilter = {
      allow: (Array.isArray(record(entry.toolFilter).allow) ? entry.toolFilter.allow : []).map(String).filter((n) => n !== ""),
      deny: (Array.isArray(record(entry.toolFilter).deny) ? entry.toolFilter.deny : []).map(String).filter((n) => n !== "")
    };
    out.roles[key] = normalized;
  }
  const prices = {};
  for (const key of Object.keys(record(source.usagePrices)).sort()) {
    const row = record(source.usagePrices)[key];
    if (typeof key !== "string" || !PRICE_KEY_PATTERN.test(key)) continue;
    const price = sanitizePriceRow(row);
    if (price !== null) prices[key] = price;
  }
  out.usagePrices = prices;
  out.usageCurrency = source.usageCurrency === "CNY" ? "CNY" : "USD";
  return out;
}
function compareKey(draft) {
  return JSON.stringify(normalizeForCompare(draft));
}
function dirtyLabels(draft, section) {
  const next = normalizeForCompare(draft);
  const stored = normalizeForCompare(draftFromSection(section));
  const labels = [];
  if (JSON.stringify(next.sisyphus) !== JSON.stringify(stored.sisyphus)) labels.push("\u603B\u8C03\u5EA6\u7ED1\u5B9A");
  const changedRoles = [];
  for (const type of AGENT_TYPES) {
    if (type === "sisyphus") continue;
    if (JSON.stringify(next[type]) !== JSON.stringify(stored[type])) changedRoles.push(type);
  }
  if (changedRoles.length > 0) labels.push(`\u5185\u7F6E\u5DE5\u79CD ${changedRoles.length} \u9879`);
  if (JSON.stringify(next.roles) !== JSON.stringify(stored.roles)) labels.push("\u89D2\u8272\u540D\u518C");
  if (JSON.stringify(next.usagePrices) !== JSON.stringify(stored.usagePrices)) labels.push("\u5355\u4EF7\u8868");
  if (next.usageCurrency !== stored.usageCurrency) labels.push("\u5E01\u79CD");
  return labels;
}
function buildSettingsOps(draft, stored = {}) {
  const source = record(draft);
  const section = record(stored.value);
  const userLayer = record(stored.user);
  const draftRoles = record(source.roles);
  const ops = [];
  const push = (path, value) => {
    ops.push(isVoidValue(value) ? { op: "unset", path } : { op: "set", path, value: clone(value) });
  };
  const sisyphus = bindingFieldsOf(source.sisyphus);
  for (const field of BINDING_FIELDS) {
    if (!(field in sisyphus)) continue;
    push(["sisyphus", field], cleanValue(field, sisyphus[field]));
  }
  const roleKeys = [.../* @__PURE__ */ new Set([
    ...AGENT_TYPES.filter((type) => type !== "sisyphus"),
    ...Object.keys(draftRoles).filter((key) => key !== "sisyphus" && ROLE_KEY_PATTERN.test(key))
  ])];
  const storedRoles = record(section.roles);
  for (const key of roleKeys) {
    const topRow = AGENT_TYPES.includes(key) ? bindingFieldsOf(source[key]) : {};
    const roleRow = bindingFieldsOf(draftRoles[key]);
    const src = { ...roleRow, ...topRow };
    const carried = draftRoles[key];
    const fieldOps = [];
    const collect = (path, value) => {
      fieldOps.push(isVoidValue(value) ? { op: "unset", path } : { op: "set", path, value: clone(value) });
    };
    for (const field of BINDING_FIELDS) {
      if (!(field in src)) continue;
      collect(["roles", key, field], cleanValue(field, src[field]));
    }
    if (carried && typeof carried === "object") {
      if ("persona" in carried) collect(["roles", key, "persona"], text(carried.persona));
      const filter = record(carried.toolFilter);
      for (const side of ["allow", "deny"]) {
        if (!Array.isArray(filter[side])) continue;
        collect(["roles", key, "toolFilter", side], filter[side].map(String).filter((name2) => name2 !== ""));
      }
    }
    const looksLikeNewRow = carried !== null && typeof carried === "object" && Array.isArray(carried.fallbacks) && carried.toolFilter !== null && typeof carried.toolFilter === "object";
    if (!(key in storedRoles) && looksLikeNewRow && !fieldOps.some((op) => op.op === "set")) {
      ops.push({ op: "set", path: ["roles", key], value: canonicalRole(src, carried) });
      continue;
    }
    ops.push(...fieldOps);
  }
  if (source.roles !== void 0 && source.roles !== null && typeof source.roles === "object") {
    for (const key of Object.keys(record(userLayer.roles))) {
      if (AGENT_TYPES.includes(key) || key in draftRoles) continue;
      ops.push({ op: "unset", path: ["roles", key] });
    }
  }
  if (source.usagePrices !== void 0 && source.usagePrices !== null && typeof source.usagePrices === "object") {
    const written = {};
    for (const [key, row] of Object.entries(source.usagePrices)) {
      if (typeof key !== "string" || !PRICE_KEY_PATTERN.test(key)) continue;
      const price = sanitizePriceRow(row);
      if (price === null) continue;
      written[key] = price;
      ops.push({ op: "set", path: ["usagePrices", key], value: price });
    }
    if (Object.keys(written).length === 0) {
      ops.push({ op: "unset", path: ["usagePrices"] });
    } else {
      for (const key of Object.keys(record(userLayer.usagePrices))) {
        if (key in written) continue;
        ops.push({ op: "unset", path: ["usagePrices", key] });
      }
    }
  }
  const storedCurrency = section.usageCurrency === "CNY" || section.usageCurrency === "USD" ? section.usageCurrency : "USD";
  if ((source.usageCurrency === "USD" || source.usageCurrency === "CNY") && source.usageCurrency !== storedCurrency) {
    ops.push({ op: "set", path: ["usageCurrency"], value: source.usageCurrency });
  }
  return ops;
}
function canonicalRole(src, carried) {
  const row = record(src);
  const out = {};
  for (const field of BINDING_FIELDS) {
    const value = field in row ? cleanValue(field, row[field]) : void 0;
    if (value === void 0 || value === "" || value === false || Array.isArray(value) && value.length === 0) {
      out[field] = field === "dsv4p0813" ? false : field === "fallbacks" ? [] : "";
      continue;
    }
    out[field] = clone(value);
  }
  const from = record(carried);
  out.persona = text(from.persona);
  const filter = record(from.toolFilter);
  out.toolFilter = {
    allow: (Array.isArray(filter.allow) ? filter.allow : []).map(String).filter((name2) => name2 !== ""),
    deny: (Array.isArray(filter.deny) ? filter.deny : []).map(String).filter((name2) => name2 !== "")
  };
  return out;
}
function cleanValue(field, value) {
  if (field === "fallbacks") return normalizeChainRows(value);
  if (field === "dsv4p0813") return value === true;
  if (typeof value === "string") return value.trim();
  return value;
}
function sectionAfterWrite(layers, ops) {
  const next = clone(record(layers.value));
  const base = record(layers.base);
  for (const op of ops) {
    const path = Array.isArray(op.path) ? op.path : [];
    const leaf = path[path.length - 1];
    if (leaf === void 0 || path.length === 0) continue;
    if (op.op === "set") {
      const parent2 = path.slice(0, -1).reduce((node, key) => {
        if (node === null || typeof node !== "object") return node;
        if (node[key] === null || typeof node[key] !== "object") node[key] = {};
        return node[key];
      }, next);
      if (parent2 !== null && typeof parent2 === "object") parent2[leaf] = clone(op.value);
      continue;
    }
    const parent = path.slice(0, -1).reduce((node, key) => record(node)[key], next);
    if (parent !== null && typeof parent === "object") delete parent[leaf];
    const baseParent = path.slice(0, -1).reduce((node, key) => record(node)[key], base);
    const fromBase = baseParent === null || baseParent === void 0 ? void 0 : record(baseParent)[leaf];
    if (fromBase !== void 0 && parent !== null && typeof parent === "object") parent[leaf] = clone(fromBase);
  }
  return next;
}
function writeLanded(draft, layers, ops) {
  return compareKey(draft) === compareKey(draftFromSection(sectionAfterWrite(layers, ops)));
}
function summaryLine(section) {
  const draft = draftFromSection(section);
  const bound = AGENT_TYPES.filter((type) => draft[type] && (text(draft[type].provider) !== "" || text(draft[type].model) !== "")).length;
  const custom = Object.keys(record(draft.roles)).filter((key) => !AGENT_TYPES.includes(key) && ROLE_KEY_PATTERN.test(key)).length;
  const prices = Object.keys(record(draft.usagePrices)).length;
  const parts = [`\u7F16\u6392 ${AGENT_TYPES.length} \u89D2\u8272\uFF08${bound} \u4E2A\u6307\u5B9A\u4E86\u6A21\u578B\uFF09`];
  if (custom > 0) parts.push(`\u81EA\u5B9A\u4E49 ${custom}`);
  if (prices > 0) parts.push(`\u5355\u4EF7 ${prices} \u6761\uFF08${draft.usageCurrency}\uFF09`);
  else parts.push("\u672A\u914D\u5355\u4EF7\uFF08\u53EA\u7EDF\u8BA1 token\uFF09");
  return parts.join(" \xB7 ");
}

// src/roles-editor.js
var React4 = __toESM(require("react"), 1);
var el = React4.createElement;
var EFFORTS = ["", "low", "high", "max"];
var effortLabel = (value) => value === "" ? "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4\uFF08\u4E0D\u5355\u72EC\u6307\u5B9A\uFF09" : { low: "\u4F4E\uFF08low\uFF09", high: "\u9AD8\uFF08high\uFF09", max: "\u6700\u9AD8\uFF08max\uFF09" }[value] ?? value;
function renderRolesPane(deps) {
  const {
    role,
    current,
    writable,
    catalog,
    tools = [],
    toolDrafts = {},
    setToolDrafts,
    importError,
    personaFileErr = {},
    rosterFailed = false,
    setBinding,
    setChain,
    setPersona,
    setToolFilter,
    loadBuiltinPersona,
    onExportRole,
    onImportOverwrite,
    onDeleteRole,
    onRenameRole,
    onRefreshTools
  } = deps;
  const key = role.key;
  const builtin = role.builtin === true;
  const row = builtin ? current[key] ?? {} : current.roles?.[key] ?? {};
  const disabled = !writable;
  const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
  const modelMap = catalog.models && typeof catalog.models === "object" ? catalog.models : {};
  const modelsFor = (providerId) => providerId ? Array.isArray(modelMap[providerId]) ? modelMap[providerId] : [] : [...new Set(Object.values(modelMap).flat())].filter((id) => typeof id === "string" && id !== "");
  const listErrorFor = (providerId) => {
    if (!providerId) return "";
    const errors = catalog.errors && typeof catalog.errors === "object" ? catalog.errors : {};
    const detail = errors[providerId];
    return typeof detail === "string" && detail !== "" ? detail : "";
  };
  const filter = row.toolFilter && typeof row.toolFilter === "object" ? row.toolFilter : {};
  const namesOf = (side) => Array.isArray(filter[side]) ? filter[side].map(String) : [];
  const toolList = (side) => {
    const names = namesOf(side);
    const pending = toolDrafts?.[key]?.[side] ?? "";
    const listId = `mygo-tf-${key}-${side}`;
    const write = (next) => setToolFilter(key, { allow: side === "allow" ? next : namesOf("allow"), deny: side === "deny" ? next : namesOf("deny") });
    return el(
      "div",
      { className: "mygo-field" },
      el("label", { className: "mygo-label" }, side === "allow" ? "\u5DE5\u5177\u767D\u540D\u5355\uFF08allow\uFF09" : "\u5DE5\u5177\u9ED1\u540D\u5355\uFF08deny\uFF09"),
      names.length === 0 ? el("div", { className: "mygo-hint" }, side === "allow" ? "\uFF08\u7A7A = \u5168\u91CF\uFF0C\u9664\u5168\u5C40\u63A9\u7801\uFF09" : "\uFF08\u7A7A = \u4E0D\u989D\u5916\u5C4F\u853D\uFF09") : el("div", { className: "mygo-chips" }, names.map((name2, index) => el(
        "span",
        { key: `${side}-${name2}-${index}`, title: name2, className: "mygo-chip" },
        el("span", { className: "mygo-chipName" }, name2),
        el("span", {
          role: "button",
          className: "mygo-chipKill",
          title: "\u79FB\u9664",
          "aria-label": `\u79FB\u9664 ${name2}`,
          onClick: () => {
            if (!disabled) write(names.filter((_, at) => at !== index));
          }
        }, "\xD7")
      ))),
      el(
        "div",
        { className: "mygo-colFoot" },
        el("input", {
          className: "mygo-input mygo-inputMono",
          value: pending,
          list: listId,
          placeholder: "\u5DE5\u5177\u540D\uFF08\u53EF\u70B9\u9009\uFF0C\u4E5F\u53EF\u624B\u586B\u672A\u8FDE\u63A5\u5DE5\u5177\uFF09",
          disabled,
          spellCheck: false,
          onChange: (event) => setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: event.target.value } })),
          onKeyDown: (event) => {
            if (event.key === "Enter" && pending.trim() !== "" && !disabled) add();
          }
        }),
        el("datalist", { id: listId }, tools.filter((name2) => !names.includes(name2)).map((name2) => el("option", { key: name2, value: name2 }))),
        el("button", {
          className: "mygo-btn mygo-btnMini",
          disabled: disabled || pending.trim() === "",
          title: "\u52A0\u5165\u540D\u5355",
          onClick: add
        }, "+ \u6DFB\u52A0")
      )
    );
    function add() {
      const name2 = pending.trim();
      if (name2 === "" || names.includes(name2)) {
        setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: "" } }));
        return;
      }
      write([...names, name2]);
      setToolDrafts?.((prev) => ({ ...prev, [key]: { ...prev?.[key], [side]: "" } }));
    }
  };
  return el(
    "div",
    { className: "mygo-col", "data-pane": "role" },
    el(
      "div",
      { className: "mygo-colHead" },
      el("span", { className: "mygo-label" }, `\u6B63\u5728\u7F16\u8F91\uFF1A${role.label}`),
      builtin ? null : el("span", { className: "mygo-rowBadge" }, "\u81EA\u5B9A\u4E49")
    ),
    renderChainEditor(row, providers, modelsFor, listErrorFor, disabled, (shape) => setChain(key, shape)),
    el(
      "div",
      { className: "mygo-fields" },
      el(
        "div",
        { className: "mygo-field" },
        el("label", { className: "mygo-label" }, "\u601D\u8003\u6863\u4F4D\uFF08Reasoning Effort\uFF09"),
        el("select", {
          className: "mygo-select",
          value: row.reasoningEffort ?? "",
          disabled,
          onChange: (event) => setBinding(key, "reasoningEffort", event.target.value)
        }, EFFORTS.map((option) => el("option", { key: option, value: option }, effortLabel(option)))),
        el("div", { className: "mygo-hint" }, "\u63A8\u7406\u5F3A\u5EA6\uFF1A\u8D8A\u9AD8\u8D8A\u806A\u660E\uFF0C\u4E5F\u8D8A\u8D35\u3002")
      ),
      el(
        "div",
        { className: "mygo-field" },
        el("label", { className: "mygo-label" }, "DSV4P0813 \u8865\u4E01"),
        el(
          "label",
          { className: "mygo-check" },
          el("input", {
            type: "checkbox",
            checked: row.dsv4p0813 === true,
            disabled: disabled || key === "sisyphus",
            onChange: (event) => setBinding(key, "dsv4p0813", event.target.checked)
          }),
          "\u542F\u7528"
        ),
        el("div", { className: "mygo-hint" }, key === "sisyphus" ? "Sisyphus \u4F1A\u8BDD\u4E0D\u7ECF\u8FC7 DSV4P0813 \u6CE8\u5165\u8BC6\u522B\u9762\uFF0C\u52FE\u9009\u5BF9\u5176\u4E0D\u751F\u6548\uFF0C\u5DF2\u7F6E\u7070\u9501\u5B9A\u3002" : "\u4E24\u9636\u6BB5\u951A\u5B9A\u4E0A\u4E0B\u6587\u6CE8\u5165\uFF0C\u4E13\u4E3A DeepSeek V4 Pro 0813 \u8C03\u6821\uFF0C\u5176\u4ED6\u6A21\u578B\u52FF\u5F00\uFF1B\u53EA\u5BF9 MyGO preset \u6D3E\u53D1\u7684\u5B50\u4EE3\u7406\u4F1A\u8BDD\u751F\u6548\u3002")
      ),
      key === "sisyphus" ? el(
        "div",
        { className: "mygo-field mygo-fieldWide" },
        el("div", { className: "mygo-hint" }, "Sisyphus \u7684\u7F16\u6392\u7EAA\u5F8B\u4EBA\u8BBE\u4E0D\u63D0\u4F9B\u9762\u677F\u8986\u76D6\uFF1B\u603B\u8C03\u5EA6\u53EA\u8BA4\u5BF9\u8BDD\u6846\u6240\u9009\u6A21\u578B\uFF0C\u6B64\u5904\u914D\u7F6E\u4E3A\u515C\u5E95/\u8865\u4E01\u4F4D\uFF08\u4EC5\u5F53\u63D2\u4EF6\u914D\u7F6E bindSisyphus \u5F00\u542F\u65F6\u751F\u6548\uFF09\u3002")
      ) : el(
        "div",
        { className: "mygo-field mygo-fieldWide" },
        el("label", { className: "mygo-label" }, "\u4EBA\u8BBE\u8986\u76D6\uFF08Persona\uFF09"),
        el("div", { className: "mygo-hint" }, `\u5F53\u524D\u6765\u6E90\uFF1A${personaOverrideSource(current.roles?.[key])}\uFF1B\u7559\u7A7A\u4FDD\u5B58 = \u6062\u590D prompts/${key}.md \u6587\u4EF6\u9ED8\u8BA4`),
        el("textarea", {
          className: "mygo-textarea",
          value: current.roles?.[key]?.persona ?? "",
          rows: 3,
          disabled,
          placeholder: `\u7559\u7A7A = \u4F7F\u7528 prompts/${key}.md \u6587\u4EF6\u9ED8\u8BA4\u4EBA\u8BBE`,
          onChange: (event) => setPersona(key, event.target.value)
        }),
        el(
          "div",
          { className: "mygo-colFoot" },
          builtin ? el("button", {
            className: "mygo-btn mygo-btnMini",
            disabled,
            title: `\u8BFB\u53D6 prompts/${key}.md \u539F\u6587\u586B\u5165\u4E0A\u65B9\u7F16\u8F91\u6846\uFF08\u8349\u7A3F\u6001\uFF0C\u70B9\u4FDD\u5B58\u624D\u751F\u6548\uFF09`,
            onClick: () => loadBuiltinPersona(key)
          }, "\u8F7D\u5165\u6587\u4EF6\u9ED8\u8BA4") : null,
          personaFileErr[key] ? el("span", { className: "mygo-statusError" }, personaFileErr[key]) : null
        )
      )
    ),
    builtin ? null : el("div", { className: "mygo-fields" }, toolList("allow"), toolList("deny")),
    builtin ? null : el(
      "div",
      { className: "mygo-field" },
      el("label", { className: "mygo-label" }, "\u89D2\u8272\u952E\u540D"),
      el("input", {
        className: "mygo-input mygo-inputMono",
        value: key,
        disabled,
        spellCheck: false,
        onBlur: (event) => {
          const next = event.target.value.trim();
          if (!disabled && next !== "" && next !== key) onRenameRole?.(key, next);
        },
        title: "\u6539\u540D\u8BF7\u76F4\u63A5\u5728\u89D2\u8272\u6E05\u5355\u91CC\u65B0\u5EFA + \u5220\u9664\uFF1B\u8FD9\u91CC\u5931\u7126\u5373\u5C1D\u8BD5\u91CD\u547D\u540D"
      })
    ),
    builtin ? null : el(
      "div",
      { className: "mygo-colFoot" },
      el("button", { className: "mygo-btn mygo-btnMini", disabled, title: "\u628A\u8BE5\u89D2\u8272\u7684\u5B8C\u6574 JSON \u590D\u5236\u5230\u526A\u8D34\u677F", onClick: () => onExportRole?.(key) }, "\u5BFC\u51FA JSON"),
      el("button", { className: "mygo-btn mygo-btnMini", disabled, title: "\u7C98\u8D34 JSON \u8986\u76D6\u8BE5\u89D2\u8272", onClick: () => onImportOverwrite?.(key) }, "\u4ECE JSON \u8986\u76D6"),
      el("button", {
        className: "mygo-btn mygo-btnMini",
        disabled,
        onClick: () => onDeleteRole?.(key),
        title: "\u4ECE\u8349\u7A3F\u91CC\u5220\u6389\u8FD9\u4E2A\u89D2\u8272\uFF08\u4FDD\u5B58\u540E\u6574\u952E\u4ECE roles \u5B57\u5178\u79FB\u9664\uFF09"
      }, `\u5220\u9664\u300C${key}\u300D`),
      importError ? el("span", { className: "mygo-statusError" }, importError) : null
    ),
    builtin ? null : el(
      "div",
      { className: "mygo-colFoot" },
      rosterFailed ? el("span", { className: "mygo-hint" }, "\u5DE5\u5177\u82B1\u540D\u518C\u62C9\u53D6\u5931\u8D25\uFF1A\u540D\u5355\u53EA\u662F\u4E0D\u7ED9\u63D0\u793A\uFF0C\u624B\u586B\u7167\u5E38\u3002") : el("span", { className: "mygo-hint" }, `\u5BBF\u4E3B\u82B1\u540D\u518C ${tools.length} \u4E2A\u5DE5\u5177\u53EF\u70B9\u9009\u3002`),
      el("button", { className: "mygo-btn mygo-btnMini", onClick: () => onRefreshTools?.(), title: "MCP \u521A\u8FDE\u4E0A\u65B0\u5DE5\u5177\u65F6\u91CD\u62C9\u4E00\u6B21\u540D\u5355" }, "\u5237\u65B0\u82B1\u540D\u518C")
    )
  );
}
function renderChainEditor(row, providers, modelsFor, listErrorFor, disabled, onChange) {
  const chain = composeChain(row);
  const apply2 = (next) => onChange(next);
  return el(
    "div",
    { className: "mygo-field" },
    el("div", { className: "mygo-label" }, "\u6A21\u578B\u4F18\u5148\u7EA7\uFF08\u4E3B\u9009 + \u5907\u9009\u94FE\uFF09"),
    el("div", { className: "mygo-hint" }, "#1 \u4E3A\u4E3B\u9009\uFF1B\u4E3B\u6A21\u578B\u5931\u8D25\uFF08\u9650\u6D41\u91CD\u8BD5\u8017\u5C3D\u540E\uFF09\u6309\u5E8F\u81EA\u52A8\u5207\u6362\u540E\u7EED\u6761\u76EE\u3002\u5907\u9009 \u2191 \u5230\u9876 = \u4E00\u952E\u6276\u6B63\u4E3A\u4E3B\u9009\uFF1B\u5220\u9664 #1 \u5219 #2 \u81EA\u52A8\u6276\u6B63\u3002"),
    el("div", { className: "mygo-chain" }, chain.map((entry, index) => {
      const listError = listErrorFor(entry.provider);
      return el(
        React4.Fragment,
        { key: `mygo-chain-${index}` },
        el(
          "div",
          { className: "mygo-chainRow" },
          el(
            "span",
            { className: "mygo-chainIndex" },
            `#${index + 1}`,
            index === 0 ? el("span", { className: "mygo-rowBadge", "data-tone": "on" }, "\u4E3B\u9009") : null
          ),
          combobox(
            entry.provider,
            providers,
            `mygo-chain-providers-${index}`,
            index === 0 ? "\u8DDF\u968F Sisyphus\uFF08\u70B9\u9009\u6216\u624B\u586B\u6E20\u9053\uFF09" : "\uFF08\u6E20\u9053\uFF1A\u70B9\u9009\u6216\u624B\u586B\uFF09",
            disabled,
            (value) => apply2(updateChainEntry(chain, index, "provider", value))
          ),
          combobox(
            entry.model,
            modelsFor(entry.provider),
            `mygo-chain-models-${index}`,
            index === 0 ? "\u8DDF\u968F Sisyphus\uFF08\u70B9\u9009\u6216\u624B\u586B\u6A21\u578B\uFF09" : "\uFF08\u6A21\u578B\uFF1A\u70B9\u9009\u6216\u624B\u586B\uFF09",
            disabled,
            (value) => apply2(updateChainEntry(chain, index, "model", value))
          ),
          el(
            "div",
            { className: "mygo-chainActors" },
            el("button", { className: "mygo-btn mygo-btnMini", disabled: disabled || index === 0, title: "\u4E0A\u79FB\uFF08#2 \u5230\u9876\u5373\u6276\u6B63\u4E3A\u4E3B\u9009\uFF09", onClick: () => apply2(moveChainEntry(chain, index, -1)) }, "\u2191"),
            el("button", { className: "mygo-btn mygo-btnMini", disabled: disabled || index === chain.length - 1, title: "\u4E0B\u79FB\uFF08\u66F4\u540E\u5C1D\u8BD5\uFF09", onClick: () => apply2(moveChainEntry(chain, index, 1)) }, "\u2193"),
            el("button", { className: "mygo-btn mygo-btnMini", disabled: disabled || chain.length <= 1, title: "\u5220\u9664\u8BE5\u884C\uFF08\u81F3\u5C11\u4FDD\u7559\u4E3B\u9009\u4F4D\uFF1B\u5220 #1 \u5219 #2 \u6276\u6B63\uFF09", onClick: () => apply2(removeChainEntry(chain, index)) }, "\xD7")
          )
        ),
        listError ? el("div", { className: "mygo-hint" }, `\u26A0 \u6E20\u9053 ${entry.provider} \u7684\u6A21\u578B\u6E05\u5355\u8BFB\u53D6\u5931\u8D25\uFF1A${listError}\uFF08\u53EF\u76F4\u63A5\u624B\u586B\u6A21\u578B\u540D\uFF0C\u4E0D\u5F71\u54CD\u4FDD\u5B58\uFF09`) : null
      );
    })),
    el(
      "div",
      { className: "mygo-colFoot" },
      el("button", { className: "mygo-btn mygo-btnMini", disabled, onClick: () => apply2(addChainEntry(chain, { provider: "", model: "" })) }, "+ \u6DFB\u52A0\u6761\u76EE")
    )
  );
}
function combobox(value, options, listId, placeholder, disabled, onChange) {
  return el(
    "div",
    { className: "mygo-field" },
    el("input", {
      className: "mygo-input mygo-inputMono",
      value: value ?? "",
      list: listId,
      placeholder,
      disabled,
      spellCheck: false,
      onChange: (event) => onChange(event.target.value)
    }),
    el("datalist", { id: listId }, options.filter((option) => option !== "").map((option) => el("option", { key: option, value: option })))
  );
}

// src/usage-prices-editor.js
var React5 = __toESM(require("react"), 1);
var el2 = React5.createElement;
function renderPricesPane(deps) {
  const { selectedPrice, current, writable, keys = [], setCurrency, setPrice, onDeletePrice } = deps;
  const currency = current.usageCurrency === "CNY" ? "CNY" : "USD";
  const row = selectedPrice && current.usagePrices?.[selectedPrice] ? current.usagePrices[selectedPrice] : null;
  const validation = row ? validatePriceRow(row) : null;
  const unit = currency === "CNY" ? "\u5143 / 1M tokens\uFF08\u4EBA\u6C11\u5E01\uFF09" : "\u7F8E\u5143 / 1M tokens\uFF08USD\uFF09";
  return el2(
    "div",
    { className: "mygo-col", "data-pane": "price" },
    el2(
      "div",
      { className: "mygo-colHead" },
      el2("span", { className: "mygo-label" }, selectedPrice ? `\u6B63\u5728\u7F16\u8F91\uFF1A${selectedPrice}` : "\u6B63\u5728\u7F16\u8F91\uFF1A\uFF08\u672A\u9009\u62E9\u8BA1\u4EF7\u952E\uFF09"),
      selectedPrice ? null : el2("span", { className: "mygo-rowBadge" }, "\u7A7A\u8868")
    ),
    el2(
      "div",
      { className: "mygo-fields" },
      el2(
        "div",
        { className: "mygo-field" },
        el2("label", { className: "mygo-label" }, "\u8BA1\u4EF7\u5E01\u79CD\uFF08\u5168\u8868\u4E00\u4E2A\uFF09"),
        el2("select", {
          className: "mygo-select",
          value: currency,
          disabled: !writable,
          onChange: (event) => setCurrency(event.target.value)
        }, ["USD", "CNY"].map((option) => el2("option", { key: option, value: option }, option === "CNY" ? "\u4EBA\u6C11\u5E01\uFF08CNY\uFF09" : "\u7F8E\u5143\uFF08USD\uFF09"))),
        el2("div", { className: "mygo-hint" }, `\u5355\u4F4D\uFF1A${unit}\u3002\u6DF7\u5E01\u79CD\u6C42\u548C\u6CA1\u6709\u610F\u4E49\uFF0C\u6240\u4EE5\u6574\u8868\u5171\u7528\u4E00\u4E2A\u65CB\u94AE\u3002`)
      ),
      el2(
        "div",
        { className: "mygo-field" },
        el2("label", { className: "mygo-label" }, "\u8BA1\u4EF7\u952E"),
        el2("input", {
          className: "mygo-input mygo-inputMono",
          value: selectedPrice ?? "",
          disabled: true,
          list: "mygo-price-suggest",
          placeholder: "\u5F62\u5982 deepseek/deepseek-chat"
        }),
        el2("datalist", { id: "mygo-price-suggest" }, keys.map((key) => el2("option", { key, value: key }))),
        el2("div", { className: "mygo-hint" }, selectedPrice ? "\u6539\u952E\u540D\u8BF7\u65B0\u5EFA\u4E00\u884C\u518D\u5220\u65E7\u884C\u3002" : priceKeyHint("") ?? "\u952E\u683C\u5F0F\uFF1Aprovider/model\uFF08\u7B2C\u4E00\u4E2A / \u5207\u5206\uFF0C\u4E24\u6BB5\u90FD\u975E\u7A7A\uFF09\u3002")
      ),
      PRICE_BUCKETS.map((bucket) => el2(
        "div",
        { key: bucket, className: "mygo-field" },
        el2("label", { className: "mygo-label" }, `${PRICE_BUCKET_LABELS[bucket]}\uFF08${bucket}\uFF09`),
        el2("input", {
          className: "mygo-input mygo-inputMono",
          value: row ? String(row[bucket] ?? "") : "",
          type: "number",
          min: "0",
          step: "any",
          disabled: !writable || !selectedPrice,
          placeholder: PRICE_REQUIRED_BUCKETS.includes(bucket) ? "\u5FC5\u586B" : "\u53EF\u9009\uFF08\u672A\u5B9A\u4EF7\uFF09",
          "aria-label": `${selectedPrice ?? "\u4EF7\u683C"} ${bucket}`,
          onChange: (event) => setPrice(selectedPrice, bucket, event.target.value)
        })
      ))
    ),
    el2(
      "div",
      { className: "mygo-colFoot" },
      el2("span", {
        className: validation ? "mygo-statusError" : "mygo-hint",
        "data-role": "price-validation"
      }, row === null ? "\u5DE6\u5217\u9009\u4E00\u6761\u8BA1\u4EF7\u952E\u6765\u6539\uFF0C\u6216\u5728\u4E0B\u65B9\u65B0\u5EFA\u4E00\u884C\u3002" : validation ? `\u672A\u5C31\u7EEA\uFF1A${validation}\uFF08\u8FD9\u4E00\u884C\u4FDD\u5B58\u65F6\u4F1A\u88AB\u6574\u884C\u8DF3\u8FC7\uFF0C\u4E0D\u5F71\u54CD\u5176\u5B83\u884C\uFF09` : "\u56DB\u6876\u5408\u6CD5\uFF0C\u4FDD\u5B58\u5373\u751F\u6548\u3002"),
      el2("button", {
        className: "mygo-btn mygo-btnMini",
        disabled: !writable || !selectedPrice,
        onClick: () => onDeletePrice?.(selectedPrice),
        title: "\u4ECE\u8349\u7A3F\u91CC\u5220\u6389\u8FD9\u4E00\u884C\uFF08\u4FDD\u5B58\u540E\u6574\u952E\u79FB\u9664\uFF09"
      }, selectedPrice ? `\u5220\u9664\u300C${selectedPrice}\u300D` : "\u5220\u9664\u884C"),
      el2("span", { className: "mygo-hint" }, `\u5F53\u524D\u5E01\u79CD\u7B26\u53F7\uFF1A${currencySymbol(currency)}`)
    )
  );
}

// src/settings-core.js
var el3 = React6.createElement;
function SettingsCard({ view = "page", scope, face, catalog, connection }) {
  const snapshot = useScopeSnapshot(scope);
  if (view === "summary") {
    const card = resolveCardView(snapshot);
    return el3("span", { className: "mygo-summary" }, card.kind === "ready" ? summaryLine(snapshot.value) : snapshot === void 0 ? "\u914D\u7F6E\u8BFB\u53D6\u4E2D\u2026" : "\u547D\u540D\u7A7A\u95F4\u672A\u5C31\u7EEA");
  }
  return el3(SettingsPage, { snapshot, scope, face, catalog, connection });
}
function useScopeSnapshot(scope) {
  const subscribe = React6.useCallback((emit) => {
    const off = typeof scope?.subscribe === "function" ? scope.subscribe(emit) : null;
    const styleOff = mountSettingsStyles();
    return () => {
      if (typeof off === "function") off();
      styleOff();
    };
  }, [scope]);
  const get = React6.useCallback(() => scope?.getSnapshot ? scope.getSnapshot() : void 0, [scope]);
  const snapshot = React6.useSyncExternalStore(subscribe, get, get);
  React6.useEffect(() => {
    if (typeof scope?.ensure === "function") void scope.ensure();
    else if (typeof scope?.load === "function") void scope.load();
  }, [scope]);
  return snapshot;
}
function SettingsPage({ snapshot, scope, face, catalog, connection }) {
  const [draft, setDraft] = React6.useState(null);
  const [fence, setFence] = React6.useState(null);
  const [saving, setSaving] = React6.useState(false);
  const [message, setMessage] = React6.useState(null);
  const [picked, setPicked] = React6.useState(AGENT_TYPES[0]);
  const [pickedPrice, setPickedPrice] = React6.useState(null);
  const [newRoleKey, setNewRoleKey] = React6.useState("");
  const [toolDrafts, setToolDrafts] = React6.useState({});
  const [importError, setImportError] = React6.useState("");
  const [newPriceKey, setNewPriceKey] = React6.useState("");
  const [personaFileErr, setPersonaFileErr] = React6.useState({});
  const card = resolveCardView(snapshot);
  const ready = card.kind === "ready";
  const layers = ready ? { value: snapshot.value, base: snapshot.base, user: snapshot.user } : { value: {}, base: {}, user: {} };
  const stored = ready ? draftFromSection(snapshot.value) : null;
  const current = draft ?? stored ?? emptyDraft();
  const dirty = draft !== null && compareKey(draft) !== compareKey(stored ?? emptyDraft());
  const pending = draft === null ? [] : dirtyLabels(draft, snapshot?.value ?? {});
  const drifted = draft !== null && typeof fence === "number" && typeof snapshot?.revision === "number" && fence !== snapshot.revision;
  const writable = ready && snapshot.writable !== false && snapshot.mode !== "memory";
  const models = useCatalog(catalog);
  const tools = useToolRoster(connection);
  React6.useEffect(() => {
    if (!dirty) return void 0;
    return attachBeforeUnloadGuard(typeof window === "undefined" ? void 0 : window);
  }, [dirty]);
  const stage = (updater) => {
    setDraft((prev) => updater(prev ?? stored ?? emptyDraft()));
    if (draft === null && typeof snapshot?.revision === "number") setFence(snapshot.revision);
    setMessage(null);
  };
  const reload = () => {
    if (typeof face?.getSnapshot === "function") void face.load?.();
    if (typeof scope?.load === "function") void scope.load();
    else if (typeof scope?.ensure === "function") void scope.ensure();
  };
  const discardAndReload = () => {
    setDraft(null);
    setFence(null);
    setMessage(null);
    reload();
  };
  const save = async () => {
    if (!draft || !writable || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const ops = buildSettingsOps(draft, layers);
      const before = { value: snapshot.value, base: snapshot.base };
      await scope.mutate(ops, typeof fence === "number" ? fence : void 0);
      const after = scope.getSnapshot();
      const landed = ready && after?.status === "ready" && writeLanded(draft, before, ops) && compareKey(draftFromSection(after.value)) === compareKey(draft);
      setMessage(describeSaveOutcome(landed, after?.revision));
      if (landed) {
        setDraft(null);
        setFence(null);
      }
    } catch (error) {
      setMessage({ ok: false, text: `\u5199\u5165\u901A\u9053\u5F02\u5E38\uFF1A${String(error)}` });
    } finally {
      setSaving(false);
    }
  };
  const customRows = normalizeRoleRows(current.roles, AGENT_TYPES);
  const roleList = [
    ...AGENT_TYPES.map((type) => roleEntry(type, AGENT_LABELS[type] ?? type, current[type], current.roles?.[type], true)),
    ...customRows.map((row) => roleEntry(row.key, row.key, row, current.roles?.[row.key], false))
  ];
  const selectedKey = roleList.some((row) => row.key === picked) ? picked : AGENT_TYPES[0];
  const selectedRole = roleList.find((row) => row.key === selectedKey);
  const selectedBuiltin = AGENT_TYPES.includes(selectedKey);
  const rowOf = (key) => AGENT_TYPES.includes(key) ? { ...current[key], ...partialOf(key) } : { ...current.roles?.[key] };
  function partialOf(key) {
    const carried = current.roles?.[key];
    return carried && typeof carried === "object" && Object.prototype.hasOwnProperty.call(carried, "persona") ? { persona: carried.persona } : {};
  }
  const setBinding = (key, field, value) => stage((prev) => AGENT_TYPES.includes(key) ? { ...prev, [key]: { ...prev[key], [field]: value } } : { ...prev, roles: { ...prev.roles, [key]: { ...prev.roles?.[key], [field]: value } } });
  const setChain = (key, chain) => stage((prev) => {
    const split = decomposeChain(chain);
    const row = { provider: split.provider, model: split.model, fallbacks: split.fallbacks };
    if (AGENT_TYPES.includes(key)) return { ...prev, [key]: { ...prev[key], ...row } };
    return { ...prev, roles: { ...prev.roles, [key]: { ...prev.roles?.[key], ...row } } };
  });
  const setPersona = (key, text2) => stage((prev) => ({
    ...prev,
    roles: { ...prev.roles, [key]: withPersonaOverride(rowOf(key), text2) }
  }));
  const setToolFilter = (key, filter) => stage((prev) => ({
    ...prev,
    roles: { ...prev.roles, [key]: { ...prev.roles?.[key], toolFilter: { allow: [...filter.allow ?? []], deny: [...filter.deny ?? []] } } }
  }));
  const loadBuiltinPersona = async (key) => {
    if (!connection?.rpc?.call) {
      setPersonaFileErr((prev) => ({ ...prev, [key]: "\u8FDE\u63A5\u4E0D\u53EF\u7528" }));
      return;
    }
    try {
      const parsed = resolveBuiltinPersonaResult(await connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.getBuiltinPersona, { type: key }));
      if (parsed.ok) {
        setPersona(key, parsed.persona);
        setPersonaFileErr((prev) => ({ ...prev, [key]: "" }));
      } else {
        setPersonaFileErr((prev) => ({ ...prev, [key]: parsed.message }));
      }
    } catch (error) {
      setPersonaFileErr((prev) => ({ ...prev, [key]: String(error) }));
    }
  };
  const createRole = () => {
    const key = newRoleKey.trim();
    if (!writable || !isValidRoleKey2(key, customRows)) return;
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: blankRole() } }));
    setNewRoleKey("");
    setPicked(key);
    setImportError("");
  };
  const deleteRole = (key) => {
    stage((prev) => {
      const roles = { ...prev.roles };
      delete roles[key];
      return { ...prev, roles };
    });
    setPicked(AGENT_TYPES[0]);
  };
  const renameRole = (from, to) => {
    const next = String(to).trim();
    if (!isValidRoleKey2(next, customRows)) {
      setImportError(`\u952E\u540D\u300C${next}\u300D\u975E\u6CD5\u6216\u5DF2\u5B58\u5728\uFF08\u5185\u7F6E\u540D\u4E0E\u5C0F\u5199-\u89C4\u5219\u540C\u6837\u62D2\u6536\uFF09`);
      return;
    }
    stage((prev) => {
      const roles = { ...prev.roles };
      roles[next] = { ...roles[from] };
      delete roles[from];
      return { ...prev, roles };
    });
    setPicked(next);
    setImportError("");
  };
  const exportRole = async (key) => {
    const json = JSON.stringify({ key, ...current.roles?.[key] }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      if (typeof window !== "undefined") window.prompt("\u526A\u8D34\u677F\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u8BE5\u89D2\u8272 JSON\uFF1A", json);
    }
  };
  const importOverwrite = (key) => {
    const text2 = typeof window === "undefined" ? null : window.prompt(`\u7C98\u8D34 JSON \u8986\u76D6\u89D2\u8272\u300C${key}\u300D\uFF08\u952E\u540D\u4EE5\u5F53\u524D\u884C\u4E3A\u51C6\uFF09\uFF1A`);
    const parsed = parseRoleText(text2);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: parsed.row } }));
    setImportError("");
  };
  const importRole = () => {
    const text2 = typeof window === "undefined" ? null : window.prompt("\u7C98\u8D34\u89D2\u8272 JSON \u5BFC\u5165\uFF08\u53EF\u5148\u5728\u522B\u5904\u5BFC\u51FA\uFF0C\u6539 key \u540E\u5BFC\u5165\uFF09\uFF1A");
    const parsed = parseRoleText(text2);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    const key = parsed.key;
    if (!isValidRoleKey2(key, customRows)) {
      setImportError("\u952E\u540D\u7F3A\u5931\u3001\u975E\u6CD5\u6216\u5DF2\u5B58\u5728\uFF08\u542B\u5185\u7F6E\u540D\uFF09");
      return;
    }
    stage((prev) => ({ ...prev, roles: { ...prev.roles, [key]: parsed.row } }));
    setPicked(key);
    setImportError("");
  };
  const priceKeys = Object.keys(current.usagePrices ?? {}).sort();
  const selectedPrice = priceKeys.includes(pickedPrice ?? "") ? pickedPrice : priceKeys[0] ?? null;
  const setPrice = (key, bucket, value) => stage((prev) => ({
    ...prev,
    usagePrices: { ...prev.usagePrices, [key]: { ...prev.usagePrices?.[key], [bucket]: value } }
  }));
  const createPrice = () => {
    const key = newPriceKey.trim();
    if (!writable || !isValidPriceKey(key, current)) return;
    stage((prev) => ({ ...prev, usagePrices: { ...prev.usagePrices, [key]: blankPriceRow() } }));
    setNewPriceKey("");
    setPickedPrice(key);
  };
  const deletePrice = (key) => {
    stage((prev) => {
      const prices = { ...prev.usagePrices };
      delete prices[key];
      return { ...prev, usagePrices: prices };
    });
    setPickedPrice(null);
  };
  return el3(
    "section",
    { className: "mygo-config", "data-plugin": "dsh-my-go" },
    el3("p", { className: "mygo-intro" }, "\u7ED9\u6BCF\u4E2A\u5DE5\u79CD\u5355\u72EC\u6307\u5B9A\u6A21\u578B\u4F18\u5148\u7EA7\u4E0E\u601D\u8003\u6863\u4F4D\uFF1B\u7559\u7A7A = \u8DDF\u968F Sisyphus\uFF08\u5373\u5BF9\u8BDD\u6846\u91CC\u9009\u7684\u6A21\u578B\uFF09\u3002\u6539\u5B8C\u70B9\u300C\u7ACB\u5373\u4FDD\u5B58\u300D\uFF0C\u4E0B\u6B21\u6D3E\u53D1\u751F\u6548\u3002"),
    el3("p", { className: "mygo-intro" }, "\u672C\u9875\u53EA\u662F\u5BBF\u4E3B\u91CC dsh-my-go \u547D\u540D\u7A7A\u95F4\u7684\u89C6\u56FE\uFF1A\u4E0D\u70B9\u4FDD\u5B58\u4E0D\u5199\u4EFB\u4F55\u5B57\u8282\uFF1B\u6E05\u7A7A\u4E00\u4E2A\u53EF\u7A7A\u5B57\u6BB5\u7B49\u4E8E\u53D1 unset\uFF08\u56DE\u843D\u5230 cordis \u884C config \u6216 schema \u9ED8\u8BA4\uFF09\uFF1B\u624B\u6539 settings.yaml \u7684 dsh-my-go \u6BB5\u4E0E\u672C\u9762\u662F\u540C\u4E00\u5C42\u3002"),
    ready ? null : el3(BlockedNotice, { card, scope }),
    ready && !writable ? el3("div", { className: "mygo-notice mygo-noticeWarn" }, "\u8FD9\u4EFD\u6587\u6863\u5F53\u524D\u53EA\u8BFB\uFF08\u5BBF\u4E3B\u62D2\u7EDD\u5199\u5165\uFF09\uFF1A\u7F16\u8F91\u533A\u7167\u5E38\u53EF\u770B\uFF0C\u4FDD\u5B58\u5DF2\u7981\u7528\u3002") : null,
    drifted ? el3(
      "div",
      { className: "mygo-notice mygo-noticeWarn", "data-role": "drift" },
      el3("span", null, `\u5916\u90E8\u5DF2\u7ECF\u6539\u8FC7\u8FD9\u4E00\u547D\u540D\u7A7A\u95F4\uFF08\u8349\u7A3F\u5EFA\u5728 r${fence}\uFF0C\u73B0\u5728 r${snapshot?.revision}\uFF09\uFF1A\u4F60\u7684\u8349\u7A3F\u8FD8\u5728\uFF0C\u4F46\u4FDD\u5B58\u4F1A\u88AB\u62D2\u3002`),
      el3("button", { className: "mygo-btn mygo-btnMini", onClick: discardAndReload }, "\u4E22\u5F03\u8349\u7A3F\u5E76\u91CD\u8BFB")
    ) : null,
    el3(
      "div",
      { className: "mygo-block", "data-block": "roles" },
      el3(
        "div",
        { className: "mygo-blockHead" },
        el3("span", { className: "mygo-blockTitle" }, "\u6A21\u578B\u4E0E\u89D2\u8272"),
        el3("span", { className: "mygo-count" }, `${AGENT_TYPES.length} \u5185\u7F6E \xB7 ${customRows.length} \u81EA\u5B9A\u4E49`),
        el3("span", { className: "mygo-blockHint" }, "\u5DE6\u5217\u9009\u89D2\u8272\uFF0C\u53F3\u5217\u53EA\u6539\u8FD9\u4E00\u884C\u3002")
      ),
      el3(
        "div",
        { className: "mygo-grid" },
        el3(
          "div",
          { className: "mygo-col" },
          el3("div", { className: "mygo-colHead" }, el3("span", { className: "mygo-label" }, "\u89D2\u8272\u6E05\u5355")),
          el3("div", { className: "mygo-list", role: "listbox", "aria-label": "\u89D2\u8272\u6E05\u5355" }, roleList.map((entry) => el3(
            "div",
            {
              key: entry.key,
              role: "option",
              "aria-selected": entry.key === selectedKey,
              "data-selected": entry.key === selectedKey,
              className: "mygo-listRow",
              title: `${entry.label} \xB7 ${entry.meta}`,
              onClick: () => setPicked(entry.key)
            },
            el3("span", { className: "mygo-rowName" }, entry.label),
            el3("span", { className: "mygo-rowMeta" }, entry.meta),
            entry.badges.map((badge) => el3("span", { key: badge.text, className: "mygo-rowBadge", "data-tone": badge.tone ?? "" }, badge.text))
          ))),
          el3(
            "div",
            { className: "mygo-colFoot" },
            el3("input", {
              className: "mygo-input mygo-inputMono",
              value: newRoleKey,
              placeholder: "\u65B0\u89D2\u8272\u952E\u540D\uFF08\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EF\u542B -\uFF09",
              disabled: !writable,
              spellCheck: false,
              "aria-label": "\u65B0\u89D2\u8272\u952E\u540D",
              onChange: (event) => setNewRoleKey(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") createRole();
              }
            }),
            el3("button", { className: "mygo-btn", disabled: !writable || !isValidRoleKey2(newRoleKey.trim(), customRows), onClick: createRole, title: "\u65B0\u5EFA\u4E00\u4E2A\u81EA\u5B9A\u4E49\u89D2\u8272\u5E76\u9009\u4E2D\u5B83" }, "+ \u65B0\u5EFA\u89D2\u8272"),
            el3("button", { className: "mygo-btn", disabled: !writable, onClick: importRole, title: "\u7C98\u8D34\u89D2\u8272 JSON \u5BFC\u5165\u4E3A\u65B0\u89D2\u8272" }, "\u5BFC\u5165 JSON")
          )
        ),
        el3("div", { className: "mygo-col" }, selectedRole ? renderRolesPane({
          role: selectedRole,
          current,
          writable,
          catalog: models,
          tools: tools.names,
          rosterFailed: tools.failed,
          toolDrafts,
          setToolDrafts,
          importError,
          personaFileErr,
          setBinding,
          setChain,
          setPersona,
          setToolFilter,
          loadBuiltinPersona,
          onExportRole: exportRole,
          onImportOverwrite: importOverwrite,
          onDeleteRole: deleteRole,
          onRenameRole: renameRole,
          onRefreshTools: tools.refresh
        }) : null)
      ),
      el3("div", { className: "mygo-detail", "data-role": "role-detail" }, roleDetailText(selectedKey, current))
    ),
    el3(
      "div",
      { className: "mygo-block", "data-block": "prices" },
      el3(
        "div",
        { className: "mygo-blockHead" },
        el3("span", { className: "mygo-blockTitle" }, "\u7528\u91CF\u5355\u4EF7\u8868"),
        el3("span", { className: "mygo-count" }, `${priceKeys.length} \u6761`),
        el3("span", { className: "mygo-blockHint" }, "\u6309\u300C\u6E20\u9053/\u6A21\u578B\u300D\u8BB0\u56DB\u7C7B token \u5355\u4EF7\uFF0C\u7528\u91CF\u9762\u677F\u636E\u6B64\u6298\u7B97\u6210\u672C\uFF1B\u4E0D\u914D\u5C31\u53EA\u7EDF\u8BA1 token \u6570\u3002")
      ),
      el3(
        "div",
        { className: "mygo-grid" },
        el3(
          "div",
          { className: "mygo-col" },
          el3("div", { className: "mygo-colHead" }, el3("span", { className: "mygo-label" }, "\u8BA1\u4EF7\u952E")),
          el3("div", { className: "mygo-list", role: "listbox", "aria-label": "\u8BA1\u4EF7\u952E\u6E05\u5355" }, priceKeys.length === 0 ? el3("div", { className: "mygo-hint" }, "\uFF08\u8FD8\u6CA1\u6709\u4E00\u6761\u5355\u4EF7\uFF1A\u5728\u4E0B\u65B9\u8F93\u5165\u300C\u6E20\u9053/\u6A21\u578B\u300D\u5EFA\u7B2C\u4E00\u6761\uFF09") : priceKeys.map((key) => el3(
            "div",
            {
              key,
              role: "option",
              "aria-selected": key === selectedPrice,
              "data-selected": key === selectedPrice,
              className: "mygo-listRow",
              title: key,
              onClick: () => setPickedPrice(key)
            },
            el3("span", { className: "mygo-rowName" }, key),
            el3("span", { className: "mygo-rowMeta" }, priceMetaText(current.usagePrices[key]))
          ))),
          el3(
            "div",
            { className: "mygo-colFoot" },
            el3("input", {
              className: "mygo-input mygo-inputMono",
              value: newPriceKey,
              placeholder: "\u6E20\u9053/\u6A21\u578B\uFF0C\u5982 deepseek/deepseek-chat",
              disabled: !writable,
              list: "mygo-price-keys",
              spellCheck: false,
              "aria-label": "\u65B0\u8BA1\u4EF7\u952E",
              onChange: (event) => setNewPriceKey(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") createPrice();
              }
            }),
            el3("datalist", { id: "mygo-price-keys" }, priceSuggestions(models).map((key) => el3("option", { key, value: key }))),
            el3("button", { className: "mygo-btn", disabled: !writable || !isValidPriceKey(newPriceKey.trim(), current), onClick: createPrice }, "+ \u65B0\u5EFA\u884C")
          )
        ),
        el3("div", { className: "mygo-col" }, renderPricesPane({
          selectedPrice,
          current,
          writable,
          keys: priceSuggestions(models),
          setCurrency: (value) => stage((prev) => ({ ...prev, usageCurrency: value })),
          setPrice,
          onDeletePrice: deletePrice
        }))
      ),
      el3("div", { className: "mygo-detail", "data-role": "price-detail" }, priceDetailText(selectedPrice, current, layers))
    ),
    el3(
      "div",
      { className: "mygo-legend" },
      el3("span", null, "\u94FE\uFF1A#1 \u4E3B\u9009\uFF0C#2..N \u5907\u9009\uFF0C\u5931\u8D25\u6309\u5E8F\u964D\u7EA7"),
      el3("span", null, "\u8986\u76D6\uFF1Apersona \u8986\u76D6\u4E86 prompts \u6587\u4EF6\u9ED8\u8BA4"),
      el3("span", null, "DSV\uFF1A\u4E24\u9636\u6BB5\u951A\u5B9A\u6CE8\u5165\uFF0C\u4EC5 DeepSeek V4 Pro 0813"),
      el3("span", null, "\u672A\u8FDE\u63A5\uFF1A\u5DE5\u5177\u540D\u4E0D\u5728\u5BBF\u4E3B\u82B1\u540D\u518C\uFF08MCP \u672A\u8FDE\u6216\u624B\u586B\uFF09")
    ),
    el3(
      "div",
      { className: "mygo-footer" },
      el3("button", {
        className: "mygo-btnPrimary",
        "data-role": "save",
        disabled: !writable || !ready || !dirty || saving,
        onClick: save,
        title: "\u628A\u8349\u7A3F\u7F16\u8BD1\u6210\u547D\u540D\u7A7A\u95F4 ops\uFF0C\u4E00\u6B21\u539F\u5B50\u63D0\u4EA4\uFF08\u4FDD\u5B58\u524D\u4E0D\u5199\u4EFB\u4F55\u5B57\u8282\uFF09"
      }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u7ACB\u5373\u4FDD\u5B58"),
      el3("button", {
        className: "mygo-btn",
        disabled: !dirty && !drifted,
        onClick: discardAndReload,
        title: "\u4E22\u5F03\u672A\u4FDD\u5B58\u8349\u7A3F\u5E76\u91CD\u65B0\u8BFB\u53D6\u5BBF\u4E3B\u73B0\u503C"
      }, "\u4E22\u5F03\u8349\u7A3F\u5E76\u91CD\u8BFB"),
      el3("span", { className: "mygo-status", "data-role": "status" }, statusText({ ready, dirty, pending, revision: snapshot?.revision })),
      message ? el3("span", { className: message.ok ? "mygo-statusOk" : "mygo-statusError", "data-role": "receipt" }, message.text) : null
    )
  );
}
function useCatalog(catalog) {
  const subscribe = React6.useCallback((emit) => catalog ? catalog.subscribe(emit) : () => {
  }, [catalog]);
  const get = React6.useCallback(() => catalog ? catalog.get() : { status: "idle", providers: [], models: {}, errors: {} }, [catalog]);
  const state = React6.useSyncExternalStore(subscribe, get, get);
  React6.useEffect(() => {
    catalog?.load?.();
  }, [catalog]);
  return state;
}
function useToolRoster(connection) {
  const [names, setNames] = React6.useState([]);
  const [failed, setFailed] = React6.useState(false);
  const load = React6.useCallback(() => {
    if (!connection?.rpc?.call) return;
    connection.rpc.call(PANEL_RPC_CHANNEL, PANEL_ENDPOINTS.listTools, {}).then((res) => {
      if (res && res.ok && Array.isArray(res.value)) {
        setNames(res.value.filter((name2) => typeof name2 === "string" && name2 !== ""));
        setFailed(false);
      } else {
        setFailed(true);
      }
    }).catch(() => setFailed(true));
  }, [connection]);
  React6.useEffect(() => {
    load();
  }, [load]);
  return { names, failed, refresh: load };
}
function BlockedNotice({ card, scope }) {
  return el3(
    "div",
    { className: "mygo-notice mygo-noticeError", "data-role": "blocked" },
    el3("span", null, card.hint),
    card.retryable ? el3("button", { className: "mygo-btn mygo-btnMini", onClick: () => reloadScope(scope) }, "\u91CD\u8BD5") : null
  );
}
function reloadScope(scope) {
  if (typeof scope?.load === "function") void scope.load();
  else if (typeof scope?.ensure === "function") void scope.ensure();
}
function statusText({ ready, dirty, pending, revision }) {
  const at = typeof revision === "number" ? ` \xB7 r${revision}` : "";
  if (!ready) return `\u914D\u7F6E\u672A\u5C31\u7EEA${at}`;
  if (!dirty) return `\u65E0\u6539\u52A8${at}`;
  return `\u5F85\u4FDD\u5B58\uFF1A${pending.length > 0 ? pending.join(" \xB7 ") : "\u8349\u7A3F\u4E0E\u73B0\u503C\u540C\u5F62"}${at}`;
}
function roleEntry(key, label, row, carried, builtin) {
  const badges = [];
  if (typeof carried?.persona === "string" && carried.persona !== "") badges.push({ text: "\u8986\u76D6", tone: "warn" });
  if (row?.dsv4p0813 === true) badges.push({ text: "DSV", tone: "on" });
  if (!builtin) badges.push({ text: "\u81EA\u5B9A\u4E49" });
  return { key, label, meta: chainText(row), badges, builtin };
}
function chainText(row) {
  const chain = composeChain(row ?? {});
  const first = chain[0];
  const named = first && (first.provider !== "" || first.model !== "") ? `${first.provider}/${first.model}` : "\u8DDF\u968F Sisyphus";
  return chain.length > 1 ? `${named} \u2192${chain.length - 1}` : named;
}
function roleDetailText(key, current) {
  if (!key) return "\u5DE6\u5217\u9009\u4E00\u4E2A\u89D2\u8272\u6765\u7F16\u8F91\u3002";
  const builtin = AGENT_TYPES.includes(key);
  const row = builtin ? current[key] ?? {} : current.roles?.[key] ?? {};
  const chain = composeChain(row);
  const filter = row.toolFilter ?? {};
  const lines = [
    `${AGENT_LABELS[key] ?? key}\uFF08${key}\uFF09\xB7 ${builtin ? "\u5185\u7F6E\u5DE5\u79CD" : "\u81EA\u5B9A\u4E49\u89D2\u8272"}`,
    `\u6A21\u578B\u4F18\u5148\u7EA7\uFF1A${chain.map((entry, index) => `#${index + 1} ${entry.provider || "\u2014"}/${entry.model || "\u2014"}`).join("  ")}`,
    `\u601D\u8003\u6863\u4F4D\uFF1A${row.reasoningEffort || "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4"}\uFF1BDSV4P0813\uFF1A${row.dsv4p0813 === true ? "\u5F00" : "\u5173"}`
  ];
  if (key !== "sisyphus") lines.push(`\u4EBA\u8BBE\u6765\u6E90\uFF1A${personaOverrideSource(current.roles?.[key])}`);
  if (!builtin) {
    const allow = Array.isArray(filter.allow) ? filter.allow : [];
    const deny = Array.isArray(filter.deny) ? filter.deny : [];
    lines.push(`\u5DE5\u5177\u9762\uFF1A\u767D\u540D\u5355 ${allow.length} \u6761${allow.length > 0 ? `\uFF08${allow.join(", ")}\uFF09` : ""}\uFF1B\u9ED1\u540D\u5355 ${deny.length} \u6761${deny.length > 0 ? `\uFF08${deny.join(", ")}\uFF09` : ""}`);
    lines.push("\u6D3E\u53D1\u65F6 go_work \u7528\u952E\u540D\u70B9\u540D\u8BE5\u89D2\u8272\uFF1B\u5220\u9664\u540E\u4E0B\u6B21\u4FDD\u5B58\u6574\u952E\u4ECE roles \u5B57\u5178\u79FB\u9664\u3002");
  }
  return lines.join("\n");
}
function priceMetaText(row) {
  if (!row) return "";
  const at = (bucket) => row[bucket] === "" || row[bucket] === void 0 || row[bucket] === null ? "\u2014" : String(row[bucket]);
  return `\u5165 ${at("input")} / \u51FA ${at("output")}`;
}
function priceDetailText(key, current, layers) {
  if (!key) return "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u8BA1\u4EF7\u884C\uFF1A\u7528\u91CF\u9762\u677F\u53EA\u62A5 token \u6570\uFF0C\u4E0D\u6298\u7B97\u6210\u672C\u3002";
  const row = current.usagePrices?.[key] ?? {};
  const storedRow = layers.value.usagePrices?.[key];
  const unit = current.usageCurrency === "CNY" ? "\u4EBA\u6C11\u5E01" : "\u7F8E\u5143";
  const lines = [
    `${key} \xB7 ${unit} / 1M tokens`,
    PRICE_BUCKETS.map((bucket) => `${PRICE_BUCKET_LABELS[bucket]}\uFF1A${row[bucket] === "" || row[bucket] === void 0 ? "\u672A\u5B9A\u4EF7" : row[bucket]}`).join("  "),
    storedRow === void 0 ? "\u8BE5\u952E\u5728\u5BBF\u4E3B\u73B0\u503C\u91CC\u8FD8\u4E0D\u5B58\u5728\uFF1A\u4FDD\u5B58\u540E\u65B0\u589E\u3002" : `\u5BBF\u4E3B\u73B0\u503C\uFF1A\u5165 ${storedRow.input} / \u51FA ${storedRow.output}\uFF0C\u7F13\u5B58\u8BFB ${storedRow.cacheRead ?? "\u672A\u5B9A\u4EF7"} / \u5199 ${storedRow.cacheWrite ?? "\u672A\u5B9A\u4EF7"}\u3002`,
    "\u8F93\u5165/\u8F93\u51FA\u5FC5\u586B\uFF0C\u7F13\u5B58\u4E24\u6876\u53EF\u9009\uFF1B\u4E0D\u5B8C\u6574\u7684\u884C\u4FDD\u5B58\u65F6\u6574\u884C\u8DF3\u8FC7\uFF08fail-closed\uFF09\uFF0C\u4E0D\u4F1A\u6BD2\u6740\u540C\u6279\u5176\u5B83\u884C\u3002"
  ];
  return lines.join("\n");
}
function priceSuggestions(catalog) {
  const map = catalog.models && typeof catalog.models === "object" ? catalog.models : {};
  return [...new Set(Object.entries(map).flatMap(([provider, ids]) => (Array.isArray(ids) ? ids : []).map((id) => `${provider}/${id}`)))];
}
function isValidRoleKey2(key, customRows) {
  return typeof key === "string" && ROLE_KEY_PATTERN.test(key) && !AGENT_TYPES.includes(key) && !customRows.some((row) => row.key === key);
}
function isValidPriceKey(key, current) {
  return typeof key === "string" && PRICE_KEY_PATTERN.test(key) && current.usagePrices?.[key] === void 0;
}
function parseRoleText(text2) {
  if (text2 === null || String(text2).trim() === "") return { ok: false, error: "\u6CA1\u6709\u8F93\u5165\u5185\u5BB9" };
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return { ok: false, error: "\u4E0D\u662F\u5408\u6CD5 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "JSON \u5FC5\u987B\u662F\u4E00\u4E2A\u89D2\u8272\u5BF9\u8C61" };
  const key = typeof parsed.key === "string" ? parsed.key : "";
  const filter = parsed.toolFilter && typeof parsed.toolFilter === "object" ? parsed.toolFilter : {};
  const row = {
    provider: typeof parsed.provider === "string" ? parsed.provider : "",
    model: typeof parsed.model === "string" ? parsed.model : "",
    reasoningEffort: typeof parsed.reasoningEffort === "string" ? parsed.reasoningEffort : "",
    dsv4p0813: parsed.dsv4p0813 === true,
    fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
    persona: typeof parsed.persona === "string" ? parsed.persona : "",
    toolFilter: {
      allow: Array.isArray(filter.allow) ? filter.allow.map(String).filter((name2) => name2 !== "") : [],
      deny: Array.isArray(filter.deny) ? filter.deny.map(String).filter((name2) => name2 !== "") : []
    }
  };
  return { ok: true, key, row };
}
function blankRole() {
  return { provider: "", model: "", reasoningEffort: "", dsv4p0813: false, fallbacks: [], persona: "", toolFilter: { allow: [], deny: [] } };
}
function blankPriceRow() {
  return { input: "", output: "", cacheRead: "", cacheWrite: "" };
}
function emptyDraft() {
  const draft = { roles: {}, usagePrices: {}, usageCurrency: "USD" };
  for (const type of AGENT_TYPES) draft[type] = { provider: "", model: "", reasoningEffort: "", dsv4p0813: false, fallbacks: [] };
  return draft;
}

// src/client.js
var name = "dsh-my-go";
var inject = ["slots", "configForms", "connection", "remote", "remote.session"];
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
function createLazySessions(client) {
  let warned = false;
  return new Proxy({}, {
    get(_target, prop) {
      const svc = client.get("sessions");
      if (!svc) {
        if (!warned) {
          warned = true;
          console.warn("[dsh-my-go] client: sessions service unavailable; panel click-to-jump and auto-jump degrade until the service appears (snapshot polling unaffected)");
        }
        return void 0;
      }
      const value = svc[prop];
      return typeof value === "function" ? value.bind(svc) : value;
    }
  });
}
function apply(ctx) {
  const client = ctx;
  const slots = client.get("slots");
  if (!slots) return;
  const connection = client.connection;
  const sessions = createLazySessions(client);
  const timer = client.get("timer");
  const panelTimer = timer && typeof timer.interval === "function" ? timer : createSelfManagedTimer();
  const stopPanel = createOrchestrationPanel({ slots, connection, sessions, timer: panelTimer });
  const binder = client.get("configForms");
  const remote = client.get("remote");
  if (binder && slots && typeof slots.inject === "function") {
    const scope = binder.get(SETTINGS_NAMESPACE);
    const face = typeof binder.describe === "function" ? binder.describe() : null;
    const catalog = createCatalogStore(remote);
    client.effect(() => {
      let off = null;
      const sync = () => {
        const served = new Set((face?.getSnapshot?.()?.view?.namespaces ?? []).map((entry) => entry.ns));
        const available = face === null || served.has(SETTINGS_NAMESPACE);
        if (available && off === null) off = registerCard(slots, scope, face, catalog, connection);
        else if (!available && off !== null) {
          off();
          off = null;
        }
      };
      const unsubscribe = face?.subscribe ? face.subscribe(sync) : () => {
      };
      void (face?.ensure ? face.ensure() : face?.load ? face.load() : void 0);
      sync();
      return () => {
        unsubscribe();
        if (off !== null) off();
      };
    }, "dsh-my-go: configuration card");
    client.effect(() => {
      const offs = [
        remote?.$on?.("llm/adapters-updated", () => catalog.invalidate()),
        remote?.$on?.("settings/document-updated", () => catalog.invalidate())
      ];
      const reset = () => catalog.reset();
      const offReset = typeof client.on === "function" ? client.on("connection/reset", reset) : null;
      return () => {
        for (const off of offs) if (typeof off === "function") off();
        if (typeof offReset === "function") offReset();
      };
    }, "dsh-my-go: model catalog invalidations");
  }
  return () => {
    stopPanel();
  };
}
function registerCard(slots, scope, face, catalog, connection) {
  return slots.inject("plugins.bundle.config", () => slots.register(
    { name: "plugins.bundle.config", key: SETTINGS_NAMESPACE },
    (props) => React7.createElement(
      SettingsCardBoundary,
      null,
      React7.createElement(SettingsCard, { ...props, scope, face, catalog, connection })
    )
  ));
}
var SettingsCardBoundary = class extends React7.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("[dsh-my-go] configuration card render failed:", error);
  }
  render() {
    if (this.state.failed) {
      return React7.createElement("div", { className: "mygo-notice mygo-noticeError" }, "dsh-my-go \u914D\u7F6E\u5361\u6E32\u67D3\u5F02\u5E38\uFF08\u5DF2\u62E6\u622A\uFF0C\u4E0D\u5F71\u54CD\u9875\u9762\u5176\u5B83\u90E8\u5206\uFF09\u3002");
    }
    return this.props.children;
  }
};
function createCatalogStore(remote) {
  const empty = { status: "idle", providers: [], models: {}, errors: {} };
  let state = empty;
  let generation = 0;
  let started = false;
  const listeners = /* @__PURE__ */ new Set();
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };
  async function fetchCatalog() {
    const at = ++generation;
    state = { ...state, status: "loading" };
    publish();
    if (!remote?.session || typeof remote.session.modelCatalog !== "function") {
      state = { status: "error", providers: [], models: {}, errors: {} };
      publish();
      return;
    }
    try {
      const response = await remote.session.modelCatalog();
      if (at !== generation) return;
      if (!response || response.ok !== true || !response.value) {
        state = { status: "error", providers: [], models: {}, errors: {} };
        publish();
        return;
      }
      const value = response.value;
      const groups = Array.isArray(value.groups) ? value.groups : [];
      const failures = Array.isArray(value.failures) ? value.failures : [];
      const providers = (Array.isArray(value.routableProviders) && value.routableProviders.length > 0 ? value.routableProviders : groups.map((group) => group?.id)).filter((id) => typeof id === "string" && id !== "");
      const models = {};
      for (const group of groups) {
        if (!group || typeof group.id !== "string") continue;
        models[group.id] = (Array.isArray(group.models) ? group.models : []).map((model) => model?.id).filter((id) => typeof id === "string" && id !== "");
      }
      for (const provider of providers) if (!(provider in models)) models[provider] = [];
      const errors = {};
      for (const failure of failures) {
        if (failure && typeof failure.id === "string") errors[failure.id] = String(failure.message ?? "\u6A21\u578B\u6E05\u5355\u8BFB\u53D6\u5931\u8D25");
      }
      state = { status: "ready", providers, models, errors };
    } catch (error) {
      if (at !== generation) return;
      state = { status: "error", providers: [], models: {}, errors: { "": String(error) } };
    }
    publish();
  }
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load() {
      if (started) return Promise.resolve(state);
      started = true;
      return fetchCatalog();
    },
    invalidate() {
      if (!started) return Promise.resolve(state);
      return fetchCatalog();
    },
    reset() {
      started = false;
      state = empty;
      publish();
    }
  };
}

		return module.exports;
	}
});
