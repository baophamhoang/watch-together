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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Watch Together</h1>
        <p className="mt-2 text-sm text-neutral-400">
          One queue, one player, everyone in sync.
        </p>
      </header>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-400">Your name</span>
        <input
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={24}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-500"
        />
      </label>

      <button
        onClick={() => enter(generateRoomCode())}
        className="rounded-lg bg-white px-4 py-3 font-medium text-neutral-950 hover:bg-neutral-200"
      >
        Start a room
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={code}
            onChange={event => {
              setCode(event.target.value)
              setError(null)
            }}
            onKeyDown={event => event.key === 'Enter' && join()}
            placeholder="word-word-abcd"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={join}
            className="rounded-lg border border-neutral-700 px-4 py-2 hover:border-neutral-500"
          >
            Join
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </main>
  )
}
