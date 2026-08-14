'use client'

import {useState} from 'react'
import type {Track} from '@/lib/sync/types'
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
      const meta = await response.json()

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
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && submit()}
          placeholder="Paste a YouTube link"
          disabled={busy}
          data-testid="add-url"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          onClick={submit}
          disabled={busy}
          data-testid="add-submit"
          className="rounded-lg border border-neutral-700 px-4 text-sm hover:border-neutral-500 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
