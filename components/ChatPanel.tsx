'use client'

import {useEffect, useRef} from 'react'
import {avatarFor} from '@/lib/presence'
import type {ChatMessage} from '@/lib/chat/types'

export function ChatPanel({
  messages,
  selfId,
  composer,
}: {
  messages: ChatMessage[]
  selfId: string
  composer: React.ReactNode
}) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({block: 'end'})
  }, [messages.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--space-3)]">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">
            No messages yet. Chat lives only in this tab — nothing is stored, so it
            clears when you reload.
          </p>
        ) : (
          <ul className="flex flex-col gap-[var(--space-3)]" data-testid="chat-log">
            {messages.map(message => {
              const {initial, hue} = avatarFor(message.peerId, message.name)
              return (
                <li key={message.id} className="flex gap-[var(--space-2)]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-full)] text-[10px] font-semibold text-bg"
                    style={{backgroundColor: `hsl(${hue} 65% 72%)`}}
                  >
                    {initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">
                      {message.peerId === selfId ? `${message.name} (you)` : message.name}
                    </p>
                    {message.kind === 'gif' ? (
                      <img
                        src={message.body}
                        alt="GIF"
                        className="mt-1 max-h-48 rounded-[var(--radius-md)]"
                      />
                    ) : (
                      <p className="break-words text-sm text-text">{message.body}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>
      {composer}
    </div>
  )
}
