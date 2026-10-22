/**
 * dsh-my-go — 配置面 schema（0.1.7 契约：插件顶层导出 `Config`）。
 *
 * dsh 0.1.7 起 settings 服务不再有 register / installSection / get：插件用一枚
 * schemastery schema 声明自己的配置面，宿主据此生成官方插件页表单，并把 cordis
 * 行 config 里 schema 认得的那一层挂成 composition base、用户层（插件配置页 /
 * settings.yaml）覆盖其上——「恢复默认」回到 base，而不是把整段配置抹掉。
 * 条目标识就是本插件 Loader 行的 id（cordis.patch.yml 的 `id: dsh-my-go`）。
 *
 * 要热更的顶层字段必须标 `.volatile()`：宿主只在 volatile 字段变更时触发
 * `loader/volatile-update` 并就地换引用，不重挂插件。schemastery 的硬约束是**不得
 * 嵌套 volatile**（dict 值 / 数组元素 / union 分支内部再标会抛 "volatile fields
 * require a fixed object path"，启动即死），所以这里只有「每个顶层字段各自
 * .volatile()」这一种写法。
 *
 * `bindings` / `installPreset` 一类编排面旋钮**不在**本 schema 里（原样留在行
 * config 上）：它们不是设置页该编辑的东西，也不参与热更——「设置页复位回到行
 * config 声明值」这条语义靠的就是它们不出现在 schema 里。
 *
 * 本模块**只给宿主用**（lib/index.js 转出）：客户端 bundle 不得出现
 * `require('@deepseek-ai/schemastery')`——浏览器侧 loader 的 require 只解析注册过的
 * 客户端模块，schemastery 不在其中，静态 import 会被 esbuild 以 external 原样打进
 * dist/client.js，整张配置卡启动即死。故本文件必须留在 src/ 的 import 图之外。
 */
import z from '@deepseek-ai/schemastery'

import { KEEP_ALIVE_DEFAULTS, PRICE_KEY_PATTERN, ROLE_KEY_PATTERN } from '../preset/shared/constants.mjs'

const agentSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })),
})

const roleSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })),
  persona: z.string(),
})

// usagePrices (contract D1, docs/usage-stats-design.md): per-model price table,
// USD per 1M tokens. input/output are required; cache buckets optional (absent =
// bucket unpriced). .min(0) rejects negatives — schemastery has no isFinite
// guard, so NaN/Infinity are turned away at save time (settings-core write path)
// instead, per D1. Empty dict = tokens only, no cost.
const priceSchema = z.object({
  input: z.number().min(0).required(),
  output: z.number().min(0).required(),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
})

export const Config = z.object({
  sisyphus: agentSchema.volatile(),
  roles: z.dict(roleSchema, z.string().pattern(ROLE_KEY_PATTERN)).volatile(),
  usagePrices: z.dict(priceSchema, z.string().pattern(PRICE_KEY_PATTERN)).volatile(),
  // Global currency for the price table (D1a): one knob, not per-row —
  // mixed-currency totals are meaningless. z.union members coerce through
  // Schema.const, so anything but 'USD'/'CNY' is rejected.
  usageCurrency: z.union(['USD', 'CNY']).default('USD').volatile(),
  // keep-alive heartbeat（主编缓存心跳）: 主编空闲时被周期性唤醒跑一个极便宜的
  // 维护回合，让下一次真实唤醒落在热 prompt 缓存上。四个字段各自带默认值
  // （默认值单源在 preset/shared/constants.mjs 的 KEEP_ALIVE_DEFAULTS——运行时
  // 兜底、草稿归一、schema 默认三面同值），enabled 默认 **关**：这是会真实
  // 打断「派发后静默等待」节奏并烧 token 的机制，必须用户显式打开。
  // 内层不得再标 .volatile()（schemastery 硬约束，见文件头），故整段只有一个
  // 顶层 volatile 标注。
  keepAlive: z.object({
    enabled: z.boolean().default(KEEP_ALIVE_DEFAULTS.enabled),
    // .min(1)：0 / 负数一拍就空转甚至在定时器里变成忙循环——与 priceSchema 的
    // .min(0) 同款「写入时拒收」，别等运行时才发现（运行时另有 normalizeKeepAlive
    // 兜底，两道闸互不替代：前者拦保存，后者拦手改 yaml / 旧档）。
    orchestratorIntervalMs: z.number().min(1).default(KEEP_ALIVE_DEFAULTS.orchestratorIntervalMs),
    childPingAfterMs: z.number().min(1).default(KEEP_ALIVE_DEFAULTS.childPingAfterMs),
    escalateAfterPings: z.number().min(1).default(KEEP_ALIVE_DEFAULTS.escalateAfterPings),
  }).volatile(),
})
