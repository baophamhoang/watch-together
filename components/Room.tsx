'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {AddTrackForm} from './AddTrackForm'
import {Queue} from './Queue'
import {loadNickname} from '@/lib/identity'
import type {Track, Unplayable} from '@/lib/sync/types'
import {useRoom} from '@/lib/sync/use-room'
import {useSyncPlayback} from '@/lib/sync/use-sync-playback'
import {useYouTubePlayer} from '@/lib/youtube/use-player'

export function Room({code}: {code: string}) {
  const [name, setName] = useState('friend')
  const positionRef = useRef<() => number>(() => 0)

  useEffect(() => {
    // Reading localStorage must wait until after mount (it doesn't exist on
    // the server), so hydrating the nickname here is unavoidable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(loadNickname(window.localStorage))
  }, [])

  const room = useRoom(code, name, positionRef)

  // Refs keep the player's event callbacks stable, so the player is never
  // rebuilt just because room state changed. `room` is a fresh object every
  // render (see useRoom), so these can't be synced via a dependency array —
  // refreshed every render instead, same as `roomRef` in useSyncPlayback.
  const sendRef = useRef(room.send)
  const trackIdRef = useRef<string | null>(null)
  const isHostRef = useRef(room.isHost)
  useEffect(() => {
    sendRef.current = room.send
    trackIdRef.current = room.state.currentTrackId
    isHostRef.current = room.isHost
  })

  const [localBlock, setLocalBlock] = useState<Unplayable | null>(null)

  const onEnded = useCallback(() => {
    const trackId = trackIdRef.current
    if (trackId) sendRef.current({type: 'ended', trackId})
  }, [])

  // Embed and region restrictions differ per viewer, so only the host's verdict
  // skips the track for everyone. A guest who cannot play it says so locally.
  const onUnplayable = useCallback((reason: Unplayable) => {
    const trackId = trackIdRef.current
    if (!trackId) return
    if (isHostRef.current) sendRef.current({type: 'unplayable', trackId, reason})
    else setLocalBlock(reason)
  }, [])

  const onUserPlay = useCallback(() => sendRef.current({type: 'play'}), [])
  const onUserPause = useCallback(
    (position: number) => sendRef.current({type: 'pause', position}),
    [],
  )

  useEffect(() => {
    // A track change is a fresh chance to play, so a stale block message from
    // the previous track must not carry over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBlock(null)
  }, [room.state.currentTrackId])

  const {containerRef, handle, loadError} = useYouTubePlayer({
    onEnded,
    onUnplayable,
    onUserPlay,
    onUserPause,
  })

  useEffect(() => {
    positionRef.current = () => handle?.getCurrentTime() ?? 0
  }, [handle])

  const {resyncing, current} = useSyncPlayback(room, handle)

  // Debug instrumentation. The YouTube iframe is cross-origin, so this is the
  // only way an automated check can read what each peer is actually playing.
  // No `NODE_ENV === 'production'` guard: `next build` inlines NODE_ENV into
  // the client bundle at build time, so `next start` — the only way this whole
  // phase is verified, since dev's Strict Mode double-invokes effects and
  // races the host election — is indistinguishable from production here. A
  // guard would strip this from the exact build it needs to work in. This
  // project has no real deployment yet, so there is no other build to protect.
  useEffect(() => {
    ;(window as unknown as {__watchTogether?: unknown}).__watchTogether = {
      readAt: () => ({
        at: Date.now(),
        position: handle?.getCurrentTime() ?? null,
        trackId: room.state.currentTrackId,
        title: current?.title ?? null,
        isPlaying: room.state.isPlaying,
        isHost: room.isHost,
        peers: room.roster.length,
        offsetMs: room.offsetMs,
      }),
    }
  }, [handle, room, current])

  const add = (track: Track) => room.send({type: 'enqueue', track})

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 p-4 lg:flex-row">
      <section className="flex-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <div ref={containerRef} className="h-full w-full" />
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center">
              <p className="text-sm text-neutral-300">
                Could not load the YouTube player. An ad or privacy blocker may be
                stopping it. Reload the page to try again.
              </p>
            </div>
          )}
          {localBlock && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
              <p className="text-sm text-neutral-300">
                {localBlock === 'embed-blocked'
                  ? "This video can't be played here — it may be blocked in your region."
                  : 'This video is unavailable for you.'}
              </p>
              <button
                onClick={() => {
                  const trackId = trackIdRef.current
                  if (trackId) room.send({type: 'unplayable', trackId, reason: localBlock})
                }}
                className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm hover:border-neutral-400"
              >
                Skip for everyone
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => room.send({type: 'skip'})}
            disabled={room.state.queue.length === 0}
            data-testid="skip"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500 disabled:opacity-40"
          >
            Skip
          </button>
          <p className="truncate text-sm text-neutral-400" data-testid="now-playing">
            {current ? current.title : 'Nothing playing'}
          </p>
          {resyncing && <span className="text-xs text-amber-400">resyncing…</span>}
        </div>
      </section>

      <aside className="flex w-full flex-col gap-4 lg:w-96">
        <div className="flex items-center justify-between text-sm">
          <code className="rounded bg-neutral-900 px-2 py-1" data-testid="room-code">
            {code}
          </code>
          <span className="text-neutral-500" data-testid="status">
            {room.status === 'connected'
              ? `${room.roster.length} watching${room.isHost ? ' · host' : ''}`
              : room.status === 'blocked'
                ? 'network blocked'
                : 'connecting…'}
          </span>
        </div>

        {room.warning && (
          <p className="rounded-lg bg-amber-950/60 px-3 py-2 text-sm text-amber-300">
            {room.warning}
          </p>
        )}

        <AddTrackForm onAdd={add} addedBy={{peerId: room.selfId, name}} />
        <Queue state={room.state} onRemove={id => room.send({type: 'remove', trackId: id})} />
      </aside>
    </main>
  )
}
