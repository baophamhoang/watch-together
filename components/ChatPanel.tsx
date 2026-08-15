'use client'

import {useEffect, useRef} from 'react'
import {avatarFor} from '@/lib/presence'
import {isGiphyUrl} from '@/lib/gifs/giphy'
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

  // Keyed on the newest message's identity, not on `messages.length`: the
  // history is capped, so the length pins at the cap forever and the log would
  // silently stop following new messages from the 200th onward.
  const lastMessageId = messages.at(-1)?.id

  useEffect(() => {
    endRef.current?.scrollIntoView({block: 'end'})
  }, [lastMessageId])

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
                  {/* The avatar's 2px top offset below is optical baseline
                      correction against a 24px avatar next to a 16px text
                      line, not a gap — exempt from the spacing scale, same as
                      PresenceBar's h-8 w-8/border-2. */}
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
                    {/* Rendered as an image only when the URL is one we handed
                        out. `body` on a gif message is an arbitrary string from
                        another browser, and an unchecked <img src> lets any peer
                        point every participant's browser at a host of their
                        choosing. Anything else falls back to text, which is
                        honest — the URL is still readable. */}
                    {message.kind === 'gif' && isGiphyUrl(message.body) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- src is an arbitrary peer-supplied URL; next/image's remotePatterns is an allowlist, so it would either reject these or turn our server into a public open image proxy.
                      <img
                        src={message.body}
                        alt="GIF"
                        className="mt-[var(--space-1)] max-h-48 rounded-[var(--radius-md)]"
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
