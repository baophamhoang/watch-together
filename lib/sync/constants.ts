/** Namespaces our rooms on the public relays; must be globally distinctive. */
export const APP_ID = 'watch-together-p2p-v1'

/** How long a joiner listens for an existing host before claiming the room. */
export const HOST_CLAIM_MS = 1500

export const BEAT_INTERVAL_MS = 2000
export const CLOCK_RESAMPLE_MS = 15_000
export const CLOCK_BURST_SAMPLES = 5
export const PENDING_TIMEOUT_MS = 2000
