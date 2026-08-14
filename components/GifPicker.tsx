'use client'

import {useEffect, useState} from 'react'
import {ImagePlay} from 'lucide-react'
import type {Gif} from '@/lib/gifs/types'

export function GifPicker({onPick}: {onPick(url: string): void}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      // Clearing stale results when the search box empties is an intentional
      // reset, not a derived value — mirrors the pattern in Room.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGifs([])
      return
    }
    // Debounced: the free tier allows 100 searches an hour, so a request per
    // keystroke would exhaust it in about a minute of typing.
    const timer = setTimeout(async () => {
      setError(null)
      try {
        const response = await fetch(`/api/gifs?q=${encodeURIComponent(trimmed)}`)
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
      } catch {
        setError('GIF search is unavailable.')
        setGifs([])
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [open, query])

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Add a GIF"
        aria-expanded={open}
        data-testid="gif-toggle"
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <ImagePlay size={18} aria-hidden />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-[var(--space-2)] w-72 rounded-[var(--radius-lg)] border border-border bg-surface p-[var(--space-2)] shadow-xl shadow-black/50">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text placeholder:text-subtle"
          />

          {error && <p className="p-[var(--space-2)] text-sm text-warn">{error}</p>}

          <div className="mt-[var(--space-2)] grid max-h-64 grid-cols-3 gap-[var(--space-1)] overflow-y-auto">
            {gifs.map(gif => (
              <button
                key={gif.id}
                onClick={() => {
                  onPick(gif.url)
                  setOpen(false)
                  setQuery('')
                }}
                className="overflow-hidden rounded-[var(--radius-sm)] cursor-pointer"
              >
                <img src={gif.previewUrl} alt={gif.title || 'GIF'} className="h-20 w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
