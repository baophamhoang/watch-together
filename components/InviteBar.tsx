'use client'

import {useState} from 'react'
import {Check, Copy} from 'lucide-react'
import {PresenceBar} from './PresenceBar'
import type {RosterEntry} from '@/lib/sync/types'
import type {RoomStatus} from '@/lib/sync/use-room'

export function InviteBar({
  code,
  roster,
  selfId,
  status,
  isHost,
}: {
  code: string
  roster: RosterEntry[]
  selfId: string
  status: RoomStatus
  isHost: boolean
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is denied in some contexts (insecure origin, or the
      // user declined). The code stays selectable on screen, so there is a
      // manual path — silently leaving the button un-ticked is honest.
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-[var(--space-3)] border-b border-border px-[var(--space-3)] py-[var(--space-2)]">
      {/* `min-w-0` on both groups, and `shrink-0` on the presence stack below,
          so a room with many peers squeezes the code rather than shunting the
          status text off the edge. */}
      <div className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]">
        <code
          className="min-w-0 truncate text-sm font-medium tracking-wide text-text"
          data-testid="room-code"
        >
          {code}
        </code>
        <button
          onClick={copy}
          aria-label={copied ? 'Invite link copied' : 'Copy invite link'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
        >
          {copied ? (
            <Check size={16} className="text-live" aria-hidden />
          ) : (
            <Copy size={16} aria-hidden />
          )}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-[var(--space-2)]">
        <PresenceBar roster={roster} selfId={selfId} />
        <span className="text-xs text-muted" data-testid="status">
          {status === 'connected'
            ? `${roster.length} watching${isHost ? ' · host' : ''}`
            : status === 'blocked'
              ? 'network blocked'
              : 'connecting…'}
        </span>
      </div>
    </div>
  )
}
