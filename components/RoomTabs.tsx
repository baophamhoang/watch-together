'use client'

import {useState, type ReactNode} from 'react'
import {ListVideo, MessageSquare} from 'lucide-react'

export function RoomTabs({
  queue,
  chat,
  unreadCount,
}: {
  queue: ReactNode
  chat: ReactNode
  unreadCount: number
}) {
  const [tab, setTab] = useState<'queue' | 'chat'>('queue')

  const tabClass = (active: boolean) =>
    [
      'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
      'border-b-2 transition-colors cursor-pointer',
      active
        ? 'border-live text-text'
        : 'border-transparent text-muted hover:text-text',
    ].join(' ')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex border-b border-border">
        <button
          role="tab"
          aria-selected={tab === 'queue'}
          onClick={() => setTab('queue')}
          className={tabClass(tab === 'queue')}
        >
          <ListVideo size={16} aria-hidden />
          Queue
        </button>
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={tabClass(tab === 'chat')}
        >
          <MessageSquare size={16} aria-hidden />
          Chat
          {unreadCount > 0 && tab !== 'chat' && (
            <span
              className="rounded-[var(--radius-full)] bg-live px-1.5 text-xs font-semibold text-bg"
              aria-label={`${unreadCount} unread messages`}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        {tab === 'queue' ? queue : chat}
      </div>
    </div>
  )
}
