import {PENDING_TIMEOUT_MS} from './constants'
import type {Intent, RoomState} from './types'

export type PendingIntent = {intent: Intent; sentAt: number}

/** Versions are host-assigned and monotonic, so anything not newer is stale. */
export function shouldAcceptState(current: RoomState, incoming: RoomState): boolean {
  return incoming.version > current.version
}

/**
 * An optimistic change the host never confirmed means we lost contact with the
 * authority; the caller reverts to the last confirmed state and warns the user.
 */
export function expirePending(
  pending: PendingIntent[],
  now: number,
  timeoutMs: number = PENDING_TIMEOUT_MS,
): {kept: PendingIntent[]; expired: PendingIntent[]} {
  const kept: PendingIntent[] = []
  const expired: PendingIntent[] = []
  for (const item of pending) {
    ;(now - item.sentAt >= timeoutMs ? expired : kept).push(item)
  }
  return {kept, expired}
}
