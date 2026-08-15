'use client'

import {useState} from 'react'
import type {Track} from '@/lib/sync/types'
import type {VideoMeta} from '@/lib/youtube/oembed'
import {InvalidYouTubeUrlError, parseYouTubeUrl} from '@/lib/youtube/parse-url'
import {probeDuration} from '@/lib/youtube/probe-duration'

export function AddTrackForm({
  onAdd,
  addedBy,
}: {
  onAdd(track: Track): void
  addedBy: {peerId: string; name: string}
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy || url.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const {videoId, startAtSec} = parseYouTubeUrl(url)

      const response = await fetch(`/api/oembed?videoId=${videoId}`)
      if (!response.ok) {
        setError(
          response.status === 404
            ? 'That video is private or no longer exists.'
            : 'Could not reach YouTube. Try again in a moment.',
        )
        return
      }
      const meta: VideoMeta = await response.json()

      // A missing duration is cosmetic and must never block adding.
      const durationSec = await probeDuration(videoId)

      onAdd({
        id: crypto.randomUUID(),
        videoId,
        title: meta.title,
        author: meta.author,
        thumbnail: meta.thumbnail,
        durationSec,
        startAtSec,
        addedBy,
        addedAt: Date.now(),
      })
      setUrl('')
    } catch (cause) {
      setError(
        cause instanceof InvalidYouTubeUrlError
          ? 'That is not a YouTube link.'
          : 'Something went wrong adding that video.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex gap-[var(--space-2)]">
        <input
          value={url}
          onChange={event => setUrl(event.target.value)}
          // `isComposing` guard: while an IME is open, Enter accepts the
          // candidate rather than submitting. Without it, typing Japanese,
          // Chinese or Korean fires this on the Enter that picks a character.
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit()
          }}
          placeholder="Paste a YouTube link"
          aria-label="YouTube link"
          disabled={busy}
          data-testid="add-url"
          className="min-h-11 flex-1 rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-3)] py-[var(--space-2)] text-sm text-text placeholder:text-subtle"
        />
        <button
          onClick={submit}
          disabled={busy}
          data-testid="add-submit"
          // One disabled treatment across the app: subtle text with the hover
          // affordance suppressed, matching ChatComposer's send button and the
          // skip button. This button's hover moves the border rather than the
          // background, so that is the one neutralised here.
          className="rounded-[var(--radius-md)] border border-border px-[var(--space-3)] text-sm text-text hover:border-border-strong disabled:text-subtle disabled:hover:border-border cursor-pointer disabled:cursor-not-allowed"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
