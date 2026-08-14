'use client'

import {useState} from 'react'
import {SendHorizontal} from 'lucide-react'

export function ChatComposer({
  onSend,
  gifSlot,
}: {
  onSend(body: string): void
  gifSlot?: React.ReactNode
}) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    if (!draft.trim()) return
    onSend(draft)
    setDraft('')
  }

  return (
    <div className="flex shrink-0 items-center gap-[var(--space-2)] border-t border-border p-[var(--space-2)]">
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="Message"
        aria-label="Message"
        data-testid="chat-input"
        className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-3)] py-[var(--space-2)] text-sm text-text placeholder:text-subtle"
      />
      {gifSlot}
      <button
        onClick={submit}
        disabled={!draft.trim()}
        aria-label="Send message"
        data-testid="chat-send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text hover:bg-surface-raised disabled:text-subtle disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
      >
        <SendHorizontal size={18} aria-hidden />
      </button>
    </div>
  )
}
