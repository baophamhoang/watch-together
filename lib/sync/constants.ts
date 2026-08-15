/** Namespaces our rooms on the public relays; must be globally distinctive. */
export const APP_ID = 'watch-together-p2p-v1'

/**
 * How long a joiner listens before claiming an *apparently empty* room. Short
 * on purpose: nobody is there to contradict it, and making the first person
 * wait is pure cost.
 */
export const HOST_CLAIM_MS = 1500

/**
 * How long a joiner listens once it can see peers. Must exceed a full beat
 * interval by a wide margin, because the beat is the only thing that tells us a
 * host exists — and the peer may still be completing Trystero's handshake,
 * which the library itself allows 10s for. At 0.75x the beat interval this was
 * 1500ms, and a rejoining peer reliably claimed a room that already had a host.
 * Every comparable system sizes this at 2-3x its heartbeat; this is 2.5x.
 */
export const HOST_CLAIM_WITH_PEERS_MS = 5000

export const BEAT_INTERVAL_MS = 2000
export const CLOCK_RESAMPLE_MS = 15_000
export const CLOCK_BURST_SAMPLES = 5
export const PENDING_TIMEOUT_MS = 2000
