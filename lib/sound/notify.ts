export type SoundStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'watch-together:chat-sound'

export function loadSoundMuted(storage: SoundStorage): boolean {
  try {
    return storage.getItem(KEY) === 'muted'
  } catch {
    // Private browsing and blocked storage both throw. Defaulting to unmuted
    // means a blocked storage costs the preference, not the feature.
    return false
  }
}

export function saveSoundMuted(storage: SoundStorage, muted: boolean): void {
  try {
    storage.setItem(KEY, muted ? 'muted' : 'on')
  } catch {
    // A preference is never worth failing a click over.
  }
}

/**
 * One AudioContext for the page. Browsers cap how many a document may create,
 * and a room can receive hundreds of messages in a sitting.
 */
let ctx: AudioContext | null = null

/**
 * A short two-tone blip, synthesised rather than fetched: no asset, no request,
 * nothing to cache, and no licence to worry about.
 *
 * Never throws. WebAudio is missing in some environments and blocked in others
 * (an AudioContext created before any user gesture starts suspended), and a
 * notification sound failing must never take the chat panel down with it.
 */
export function playNotification(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    // Autoplay policy: a context created before the first gesture starts
    // suspended. By the time a message arrives the user has almost always
    // interacted, so resuming here usually succeeds — and when it doesn't, the
    // rejection is swallowed rather than surfacing as an unhandled rejection.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.setValueAtTime(1175, now + 0.07)
    // Ramped rather than switched: a gain that jumps from 0 to full produces an
    // audible click at the discontinuity. Exponential ramps cannot touch zero,
    // hence the small non-zero endpoints.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.2)
  } catch {
    // See above: cosmetic feature, never load-bearing.
  }
}
