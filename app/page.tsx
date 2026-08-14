'use client'

import {useRouter} from 'next/navigation'
import {useEffect, useState} from 'react'
import {DEFAULT_NICKNAME, loadNickname, saveNickname} from '@/lib/identity'
import {generateRoomCode, isValidRoomCode} from '@/lib/room-code'

export default function LandingPage() {
  const router = useRouter()
  const [name, setName] = useState(DEFAULT_NICKNAME)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Reading localStorage must wait until after mount (it doesn't exist on
    // the server), so hydrating the nickname here is unavoidable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(loadNickname(window.localStorage))
  }, [])

  const enter = (roomCode: string) => {
    saveNickname(window.localStorage, name)
    router.push(`/r/${roomCode}`)
  }

  const join = () => {
    const trimmed = code.trim().toLowerCase()
    if (!isValidRoomCode(trimmed)) {
      setError('That does not look like a room code.')
      return
    }
    enter(trimmed)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-[var(--space-5)] px-[var(--space-4)]">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Watch Together</h1>
        <p className="mt-[var(--space-2)] text-sm text-muted">
          One queue, one player, everyone in sync.
        </p>
      </header>

      <label className="flex flex-col gap-[var(--space-2)] text-sm">
        <span className="text-muted">Your name</span>
        <input
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={24}
          className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-3)] py-[var(--space-2)] text-text"
        />
      </label>

      <button
        onClick={() => enter(generateRoomCode())}
        className="rounded-[var(--radius-md)] bg-text px-[var(--space-3)] py-[var(--space-3)] font-medium text-bg hover:bg-text/90 cursor-pointer"
      >
        Start a room
      </button>

      <div className="flex flex-col gap-[var(--space-2)]">
        <div className="flex gap-[var(--space-2)]">
          <input
            value={code}
            onChange={event => {
              setCode(event.target.value)
              setError(null)
            }}
            // `isComposing` guard: while an IME is open, Enter accepts the
            // candidate rather than submitting the form.
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) join()
            }}
            placeholder="word-word-abcd"
            aria-label="Room code"
            className="min-h-11 flex-1 rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-3)] py-[var(--space-2)] text-text placeholder:text-subtle"
          />
          <button
            onClick={join}
            className="rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-text hover:border-border-strong cursor-pointer"
          >
            Join
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </main>
  )
}
