'use client'

import {Play} from 'lucide-react'

export function TapToWatch({onActivate}: {onActivate(): void}) {
  return (
    <button
      onClick={onActivate}
      data-testid="tap-to-watch"
      className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-black/80 cursor-pointer"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-full)] bg-text text-bg">
        <Play size={28} aria-hidden />
      </span>
      <span className="text-sm text-text">Tap to watch</span>
      <span className="max-w-xs px-[var(--space-4)] text-center text-xs text-muted">
        Browsers need one tap before they will start a video with sound.
      </span>
    </button>
  )
}
