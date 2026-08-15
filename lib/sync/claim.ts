export type ClaimInput = {
  isHost: boolean
  sawHost: boolean
  /** Peers whose transport connection is up, announced or not. */
  connectedPeers: number
  /** Whether the longer, peers-present window has already elapsed. */
  waitedFullWindow?: boolean
}

/**
 * Whether to promote ourselves to host.
 *
 * Extracted from the effect that used to decide this inline, so the rule can be
 * tested at all — the timing bug this replaces was invisible to every test we
 * had, because nothing could reach the decision.
 */
export function shouldClaimRoom(input: ClaimInput): boolean {
  if (input.isHost || input.sawHost) return false
  // Peers we can see but have not heard from are the rejoin case: they may be
  // mid-handshake, and one of them may be the host. Claiming now is how a
  // refreshed tab takes a room that already had one.
  if (input.connectedPeers > 0 && !input.waitedFullWindow) return false
  return true
}
