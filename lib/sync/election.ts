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
 * Both peers run this on the same pair of inputs and reach opposite verdicts,
 * so a simultaneous-join collision resolves without negotiation.
 *
 * State wins before identity. Peer id is a deterministic tiebreak, not a
 * measure of legitimacy — and because the loser resets its replica to empty,
 * deciding on id alone meant a peer that had just arrived with nothing could
 * destroy a room's entire queue by winning a string comparison.
 */
export function resolveHostTie(
  selfId: string,
  otherHostId: string,
  versions: {selfVersion: number; otherVersion: number},
): 'keep' | 'demote' {
  if (versions.selfVersion !== versions.otherVersion) {
    return versions.selfVersion > versions.otherVersion ? 'keep' : 'demote'
  }
  return selfId < otherHostId ? 'keep' : 'demote'
}
