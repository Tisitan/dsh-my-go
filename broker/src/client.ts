/**
 * dsh-my-go broker — CLIENT entry.
 *
 * Mount this row in a client composition (dsh web) for the orchestration
 * tree panel, auto-jump, and settings page.
 */
import { apply as applyClient } from './client/index.ts'

export const name = 'dsh-my-go-broker-client'
export const inject = ['slots']

export function apply(ctx: unknown): void {
  applyClient(ctx)
}
