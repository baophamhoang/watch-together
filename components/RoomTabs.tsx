'use client'

import {useState, type ReactNode} from 'react'
import {ListVideo, MessageSquare} from 'lucide-react'

export function RoomTabs({
  queue,
  chat,
  unreadCount,
  onChatOpened,
}: {
  queue: ReactNode
  chat: ReactNode
  unreadCount: number
  onChatOpened?: () => void
}) {
  const [tab, setTab] = useState<'queue' | 'chat'>('queue')

  const tabClass = (active: boolean) =>
    [
      'flex flex-1 items-center justify-center gap-[var(--space-2)] py-[var(--space-3)] text-sm font-medium',
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
          id="tab-queue"
          aria-controls="panel-queue"
          aria-selected={tab === 'queue'}
          onClick={() => setTab('queue')}
          className={tabClass(tab === 'queue')}
        >
          <ListVideo size={16} aria-hidden />
          Queue
        </button>
        <button
          role="tab"
          id="tab-chat"
          aria-controls="panel-chat"
          aria-selected={tab === 'chat'}
          onClick={() => {
            setTab('chat')
            onChatOpened?.()
          }}
          className={tabClass(tab === 'chat')}
        >
          <MessageSquare size={16} aria-hidden />
          Chat
          {unreadCount > 0 && tab !== 'chat' && (
            <span
              className="rounded-[var(--radius-full)] bg-live px-[var(--space-2)] text-xs font-semibold text-bg"
              aria-label={`${unreadCount} unread messages`}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* One panel whose identity follows the selected tab, rather than two
          panels toggled by hidden. Either satisfies the APG; this keeps the
          scroll container single so switching tabs does not resurrect a stale
          scroll position from the other one. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="tabpanel"
        id={tab === 'queue' ? 'panel-queue' : 'panel-chat'}
        aria-labelledby={tab === 'queue' ? 'tab-queue' : 'tab-chat'}
      >
        {tab === 'queue' ? queue : chat}
      </div>
    </div>
  )
}
