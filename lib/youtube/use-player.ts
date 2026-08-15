'use client'

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Unplayable} from '@/lib/sync/types'
import {loadIframeApi} from './iframe-api'

/** Window after a programmatic move during which player events are not user intent. */
const REMOTE_SUPPRESSION_MS = 700

export type PlayerState =
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued'
  | 'unknown'

export type PlayerHandle = {
  load(videoId: string, startAtSec: number): void
  play(): void
  pause(): void
  seekTo(seconds: number): void
  getCurrentTime(): number
  getState(): PlayerState
}

export type PlayerEvents = {
  onEnded(): void
  onUnplayable(reason: Unplayable): void
  onUserPlay(): void
  onUserPause(position: number): void
}

export function useYouTubePlayer(events: PlayerEvents) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const suppressUntil = useRef(0)
  /**
   * A load is pending until the player reports a steady state. Unlike play,
   * pause and seek — which are local and resolve in milliseconds — a load
   * fetches over the network, so no fixed timer is honest for it. The first
   * PLAYING or PAUSED after a load is always the load completing, never a
   * person, and reporting it as intent is how a joining peer un-pauses a room
   * for everyone else.
   *
   * Known gap, deliberately left: being a boolean rather than a counter, two
   * loads in flight at once leave one settling event unswallowed — the second
   * load() re-arms it, and only the next PLAYING/PAUSED (whichever load it
   * belongs to) gets caught. A counter closes that hole but opens the opposite
   * one: a load whose settle event never arrives (an error, a track that never
   * starts) would leave the counter permanently armed, silently swallowing the
   * first genuine user action on every load after. Two loads racing is rarer
   * and cheaper (one extra reported intent) than a counter stuck open forever,
   * so this stays a boolean.
   */
  const loadSettling = useRef(false)
  const eventsRef = useRef(events)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)

  // Keep the latest event handlers available to async player callbacks without
  // re-running the setup effect below on every render (see react-hooks/refs).
  useEffect(() => {
    eventsRef.current = events
  })

  const suppress = useCallback(() => {
    suppressUntil.current = Date.now() + REMOTE_SUPPRESSION_MS
  }, [])

  useEffect(() => {
    let cancelled = false
    let player: YT.Player | null = null

    loadIframeApi()
      .then(YT => {
        if (cancelled || !containerRef.current) return

        player = new YT.Player(containerRef.current, {
          // No pixel width/height: the shell is sized responsively via CSS
          // (see .yt-player-shell in globals.css), not the player API.
          // `origin` is YouTube's recommended postMessage-channel restriction.
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!cancelled) setReady(true)
            },
            onStateChange: event => {
              // The end of a video is never an echo of something we did, so it is
              // checked BEFORE the suppression gate. If it were suppressed, a drift
              // correction landing within the window of the final second would swallow
              // it and the queue would stall at the end of the video with no way
              // forward but a manual skip. Duplicate `ended` reports are harmless: the
              // reducer only advances while the track id still matches, so the second
              // one is a no-op.
              if (event.data === YT.PlayerState.ENDED) {
                eventsRef.current.onEnded()
                return
              }
              // Swallow exactly one settling event, then resume normal
              // reporting — the person may genuinely press pause a moment
              // later, and that must still count.
              if (
                loadSettling.current &&
                (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED)
              ) {
                loadSettling.current = false
                return
              }
              // Play and pause DO echo: a move we made ourselves is not a user action,
              // and broadcasting it would bounce between peers forever.
              if (Date.now() < suppressUntil.current) return
              if (event.data === YT.PlayerState.PLAYING) {
                eventsRef.current.onUserPlay()
              } else if (event.data === YT.PlayerState.PAUSED) {
                eventsRef.current.onUserPause(event.target.getCurrentTime())
              }
            },
            onError: event => {
              const reason: Unplayable =
                event.data === 101 || event.data === 150 ? 'embed-blocked' : 'not-found'
              eventsRef.current.onUnplayable(reason)
            },
          },
        })
        playerRef.current = player
      })
      .catch((error: Error) => {
        // Without this the rejection is unhandled, and `ready` stays false
        // forever with nothing on screen explaining why no player appeared.
        if (!cancelled) setLoadError(error)
      })

    return () => {
      cancelled = true
      try {
        player?.destroy()
      } catch {
        // The iframe may already be gone during fast refresh; nothing to clean up.
      }
      playerRef.current = null
    }
  }, [])

  const handle: PlayerHandle | null = useMemo(
    () =>
      ready
        ? {
            load(videoId, startAtSec) {
              suppress()
              loadSettling.current = true
              playerRef.current?.loadVideoById({videoId, startSeconds: startAtSec})
            },
            play() {
              suppress()
              playerRef.current?.playVideo()
            },
            pause() {
              suppress()
              playerRef.current?.pauseVideo()
            },
            seekTo(seconds) {
              suppress()
              playerRef.current?.seekTo(seconds, true)
            },
            getCurrentTime() {
              return playerRef.current?.getCurrentTime() ?? 0
            },
            getState() {
              // Numeric literals rather than YT.PlayerState: this runs on every
              // correction tick and the API object is not in scope here.
              switch (playerRef.current?.getPlayerState()) {
                case -1:
                  return 'unstarted'
                case 0:
                  return 'ended'
                case 1:
                  return 'playing'
                case 2:
                  return 'paused'
                case 3:
                  return 'buffering'
                case 5:
                  return 'cued'
                default:
                  return 'unknown'
              }
            },
          }
        : null,
    [ready, suppress],
  )

  return {containerRef, handle, ready, loadError}
}
