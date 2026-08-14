import type {RosterEntry} from './types'

/** Earliest joiner wins; equal join orders break by peer id so every peer agrees. */
export function electHost(survivors: RosterEntry[]): string | null {
  if (survivors.length === 0) return null
  return survivors.reduce((best, candidate) => {
    if (candidate.joinOrder !== best.joinOrder) {
      return candidate.joinOrder < best.joinOrder ? candidate : best
    }
    return candidate.peerId < best.peerId ? candidate : best
  }).peerId
}

/**
 * Both peers run this on the same pair of ids and reach opposite verdicts,
 * so a simultaneous-join collision resolves without negotiation.
 */
export function resolveHostTie(selfId: string, otherHostId: string): 'keep' | 'demote' {
  return selfId < otherHostId ? 'keep' : 'demote'
}
