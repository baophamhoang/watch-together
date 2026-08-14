'use client'

import {loadIframeApi} from './iframe-api'

const PROBE_TIMEOUT_MS = 2500
/** getDuration() occasionally reports 0 until metadata lands; retry once. */
const RETRY_DELAY_MS = 500

/**
 * Constructing a player without autoplay only *cues* the video, so nothing is
 * heard. Resolves null rather than rejecting — a missing duration is cosmetic
 * and must never block adding a track.
 */
export async function probeDuration(
  videoId: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<number | null> {
  let YT: typeof globalThis.YT
  try {
    YT = await loadIframeApi()
  } catch {
    return null
  }

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;'
  document.body.appendChild(host)

  return new Promise<number | null>(resolve => {
    let player: YT.Player | null = null
    let settled = false

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        player?.destroy()
      } catch {
        // Player may have failed to construct; the host node still needs removing.
      }
      host.remove()
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    const read = (target: YT.Player) => {
      const duration = target.getDuration()
      return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
    }

    player = new YT.Player(host, {
      videoId,
      events: {
        onReady: event => {
          // The backstop may already have fired and destroyed the player while this
          // callback sat queued. That window is the whole timeout — far wider than
          // the retry's below — and reading from a destroyed player throws, with
          // nothing to catch it inside an event callback.
          if (settled) return
          const first = read(event.target)
          if (first !== null) return finish(first)
          setTimeout(() => {
            // The timeout backstop may have fired in this gap and destroyed the
            // player already. Reading from a destroyed player throws, and this is a
            // timer callback, so nothing would catch it — just a stray console error
            // muddying the browser-driven checks later. The probe is settled either
            // way, so there is nothing left to do.
            if (settled) return
            finish(read(event.target))
          }, RETRY_DELAY_MS)
        },
        onError: () => finish(null),
      },
    })
  })
}
