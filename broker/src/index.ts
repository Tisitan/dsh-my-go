/**
 * dsh-my-go broker — plugin entry (HOST half).
 *
 * Mount this row in a cordis composition (or run it dynamically) to get the
 * orchestration tools, model binding, and conclusion injection on the host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyHost, type BrokerHostConfig } from './host/index.ts'

export const name = 'dsh-my-go-broker'
export const inject = ['tools', 'subagents', 'systemPrompt']

export interface Config extends BrokerHostConfig {}

export function apply(ctx: Context, config: Config = {}): void {
  applyHost(ctx, config)
}
