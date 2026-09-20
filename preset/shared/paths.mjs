/**
 * dsh-my-go — DSH_HOME path derivation (single source, node-side only).
 *
 * 铁律：本模块 import node:os / node:path，因此**绝不可被 src/（浏览器
 * bundle）import**——esbuild 打 src/client.js 时会把 node 内置整链拖进
 * dist/client.js 直接炸包。消费面只允许 node 侧：preset/tools、
 * preset/shared 存储层（archive/board）、lib/。
 *
 * 每次调用现算，不设模块级缓存——测试靠改 process.env.DSH_HOME 注入
 * 隔离目录（board.mjs 既有约定同款）。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

// DSH_HOME 根：环境变量缺席或空串一律回落 ~/.dsh（|| 语义——空串视同未设，
// join('', ...) 会解析出相对路径，是读写分家类故障的排障陷阱）。
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

// 本插件状态根：<DSH_HOME>/dsh-my-go（编排台账 / 观测埋点 / report board
// 三项状态的共同父目录，台账惯例同款）。
export function mygoHome(...parts) {
  return join(dshHome(), 'dsh-my-go', ...parts)
}

// 宿主会话档案根：<DSH_HOME>/sessions——dsh-session-persistence-jsonl 的
// 落点，属宿主目录树，不进本插件状态子树。
export function sessionsHome(...parts) {
  return join(dshHome(), 'sessions', ...parts)
}
