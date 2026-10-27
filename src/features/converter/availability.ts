import { serverAvailability, type ServerStatus } from '@/lib/api'
import type { Choice } from '@/lib/registry'

export interface Availability {
  available: boolean
  reason?: string
}

/** Browser tools are always available; server tools depend on live server capabilities. */
export function availabilityOf(
  choice: Choice,
  status: ServerStatus
): Availability {
  if (choice.tool.mode === 'browser') return { available: true }
  const a = serverAvailability(status, choice.tool.id, choice.target.id)
  return a.ok ? { available: true } : { available: false, reason: a.reason }
}

export function maxBytesFor(choice: Choice, status: ServerStatus): number {
  const mb =
    choice.tool.mode === 'server'
      ? (status.tools[choice.tool.id]?.maxFileMB ?? choice.tool.maxFileMB)
      : choice.tool.maxFileMB
  return mb * 1024 * 1024
}
