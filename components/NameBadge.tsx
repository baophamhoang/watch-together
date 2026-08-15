'use client'

import {useEffect, useRef, useState} from 'react'
import {Check, Pencil} from 'lucide-react'
import {MAX_NICKNAME_LENGTH} from '@/lib/identity'

export function NameBadge({
  name,
  startEditing,
  onRename,
}: {
  name: string
  startEditing: boolean
  onRename(next: string): void
}) {
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // `startEditing` reflects `hasStoredNickname`, which Room can only compute
  // in its own mount effect (localStorage doesn't exist on the server) — and
  // that effect always resolves strictly after this component's first
  // render. That makes the `useState(startEditing)` above see only the
  // pre-hydration `false` for EVERY mount, link-joiner included, since
  // `useState`'s argument is read once and ignored on every render after —
  // without the block below, a link-joiner's badge silently stays closed.
  //
  // Adjusted here, during render, rather than in an Effect: this is the
  // pattern React's own docs recommend for "adjusting state when a prop
  // changes" (react.dev/learn/you-might-not-need-an-effect), it lands in the
  // same commit instead of triggering a second one, and it is what keeps
  // `react-hooks/set-state-in-effect` clean rather than suppressed. Comparing
  // against `prevStartEditing` — not e.g. `editing` — keeps this a one-way,
  // one-shot door: Room never resets `needsName` once set, so `startEditing`
  // transitions false-to-true at most once per mount, and this cannot reopen
  // the badge after the user commits a name or presses Escape. A returning
  // peer's `startEditing` is `false` on both the first render and the
  // mount-effect's re-render, so it never transitions at all — reloading
  // with a name already stored never forces the badge open.
  const [prevStartEditing, setPrevStartEditing] = useState(startEditing)
  if (startEditing !== prevStartEditing) {
    setPrevStartEditing(startEditing)
    if (startEditing) setEditing(true)
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    // An empty submission keeps the existing name rather than clearing it —
    // there is no such thing as a nameless peer, and the roster would show a
    // blank chip.
    if (trimmed) onRename(trimmed)
    else setDraft(name)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        data-testid="rename"
        aria-label={`You are ${name}. Change your name`}
        className="flex min-h-11 items-center gap-[var(--space-1)] rounded-[var(--radius-md)] px-[var(--space-2)] text-sm text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <span className="max-w-[12ch] truncate">{name}</span>
        <Pencil size={14} aria-hidden />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-[var(--space-1)]">
      <label className="sr-only" htmlFor="name-badge-input">
        Your name
      </label>
      <input
        id="name-badge-input"
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          else if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
        maxLength={MAX_NICKNAME_LENGTH}
        data-testid="name-input"
        placeholder="Your name"
        className="min-h-11 w-[12ch] rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-2)] text-sm text-text"
      />
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={commit}
        aria-label="Save name"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <Check size={16} aria-hidden />
      </button>
    </div>
  )
}
