'use client'

import {Play} from 'lucide-react'

export function TapToWatch({onActivate}: {onActivate(): void}) {
  return (
    <button
      onClick={onActivate}
      data-testid="tap-to-watch"
      // Without an explicit label the accessible name is built from every
      // descendant text node, so this button announces as "Tap to watch
      // Browsers need one tap before they will start a video with sound."
      // — one run-on string, on the single most important control a phone
      // joiner meets. `aria-label` wins over name-from-content, and
      // `aria-describedby` keeps the explanation as a description rather
      // than discarding it.
      aria-label="Tap to watch"
      aria-describedby="tap-to-watch-hint"
      className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-[var(--scrim)] cursor-pointer"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-full)] bg-text text-bg">
        <Play size={28} aria-hidden />
      </span>
      <span className="text-sm text-text">Tap to watch</span>
      <span
        id="tap-to-watch-hint"
        className="max-w-xs px-[var(--space-4)] text-center text-xs text-muted"
      >
        Browsers need one tap before they will start a video with sound.
      </span>
    </button>
  )
}
