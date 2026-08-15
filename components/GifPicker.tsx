'use client'

import {useEffect, useRef, useState} from 'react'
import {ImagePlay} from 'lucide-react'
import type {Gif} from '@/lib/gifs/types'

export function GifPicker({onPick}: {onPick(url: string): void}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  const close = () => {
    setOpen(false)
    toggleRef.current?.focus()
  }

  // Derived, not stored. An empty query shows nothing, and that is a function
  // of `query` at render time — writing `setGifs([])` in the effect instead
  // would cost an extra render and need a lint suppression to boot.
  const trimmedQuery = query.trim()
  const visibleGifs = trimmedQuery ? gifs : []

  useEffect(() => {
    if (!open || !trimmedQuery) return

    // Aborting matters twice over: it stops a superseded response from landing
    // after a newer one and repainting the grid with results for a query the
    // user has moved on from, and it actually cancels the request, which the
    // free tier's 100-searches-an-hour ceiling makes worth doing.
    const controller = new AbortController()

    // Debounced: a request per keystroke would exhaust that quota in about a
    // minute of typing.
    const timer = setTimeout(async () => {
      setError(null)
      setLoading(true)
      try {
        const response = await fetch(`/api/gifs?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setError(
            response.status === 429
              ? 'Too many searches — wait a minute.'
              : 'GIF search is unavailable.',
          )
          setGifs([])
          return
        }
        setGifs((await response.json()).gifs ?? [])
      } catch (cause) {
        // An abort is us superseding our own request, not a failure to report.
        if ((cause as Error | undefined)?.name === 'AbortError') return
        setError('GIF search is unavailable.')
        setGifs([])
      } finally {
        // Runs on the abort path too, which is correct: an aborted request means
        // the user typed again, so we are back in the debounce window and not
        // fetching. The replacement request sets this true again 400ms later.
        setLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, trimmedQuery])

  return (
    <div className="relative shrink-0">
      <button
        ref={toggleRef}
        onClick={() => setOpen(o => !o)}
        aria-label="Add a GIF"
        aria-expanded={open}
        data-testid="gif-toggle"
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <ImagePlay size={18} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-[var(--space-2)] w-72 rounded-[var(--radius-lg)] border border-border bg-surface p-[var(--space-2)]"
          onKeyDown={e => {
            if (e.key === 'Escape') close()
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text placeholder:text-subtle"
          />

          {/* `text-danger`, not `text-warn`: "GIF search is unavailable." is a
              failure, and the two sibling forms in this app (AddTrackForm and
              the landing page) already say so in the same colour. */}
          {error && <p className="p-[var(--space-2)] text-sm text-danger">{error}</p>}

          {/* Both states exist twelve inches away in AddTrackForm; a search box
              that shows nothing while it works reads as broken. */}
          {loading && <p className="p-[var(--space-2)] text-sm text-muted">Searching…</p>}
          {!loading && !error && trimmedQuery && visibleGifs.length === 0 && (
            <p className="p-[var(--space-2)] text-sm text-muted">
              {`No GIFs for “${trimmedQuery}”`}
            </p>
          )}

          <div className="mt-[var(--space-2)] grid max-h-64 grid-cols-3 gap-[var(--space-1)] overflow-y-auto">
            {visibleGifs.map((gif, index) => (
              <button
                key={gif.id}
                onClick={() => {
                  onPick(gif.url)
                  close()
                  setQuery('')
                }}
                className="overflow-hidden rounded-[var(--radius-sm)] cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- up to 18 animated GIFs per search; next/image passes GIFs through unoptimised, so it would proxy every one through our own server for no benefit, in front of a CDN that already is one. */}
                <img
                  src={gif.previewUrl}
                  alt={gif.title || `GIF ${index + 1}`}
                  loading="lazy"
                  className="h-20 w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
