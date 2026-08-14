'use client'

import {avatarFor} from '@/lib/presence'
import type {RosterEntry} from '@/lib/sync/types'

export function PresenceBar({
  roster,
  selfId,
}: {
  roster: RosterEntry[]
  selfId: string
}) {
  if (roster.length === 0) return null

  return (
    <ul className="flex items-center -space-x-2" aria-label={`${roster.length} watching`}>
      {roster.map(entry => {
        const {initial, hue} = avatarFor(entry.peerId, entry.name)
        const isSelf = entry.peerId === selfId
        return (
          <li
            key={entry.peerId}
            title={isSelf ? `${entry.name} (you)` : entry.name}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-full)] border-2 border-bg text-xs font-semibold text-bg"
            style={{backgroundColor: `hsl(${hue} 65% 72%)`}}
          >
            {initial}
            <span className="sr-only">{isSelf ? `${entry.name}, you` : entry.name}</span>
          </li>
        )
      })}
    </ul>
  )
}
