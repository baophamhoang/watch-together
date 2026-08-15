# Watch Together — Phase 2 (Social + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chat with a GIF picker, real presence, and phone support — and replace the placeholder UI with a designed one.

**Architecture:** Chat and presence ride the existing Trystero data channel, so no new transport. Presence data already exists in `room.roster` and is currently rendered as a bare count. The UI is rebuilt around one protagonist — the video — with a tabbed rail for Queue and Chat that collapses beneath the player on phones. GIF search proxies through a Next route handler so the provider key never reaches the client.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, Trystero 0.25, `lucide-react`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md` — this plan implements its Phase 2 ("chat, presence and toasts, GIF picker") plus the mobile half of Phase 3. The spec describes the UI in one paragraph; the design direction below elaborates it and supersedes that paragraph.

## Global Constraints

- Next.js `16.3.1`, React `19.2.8`, Tailwind `4` — already installed, do not upgrade.
- Package manager is **npm**.
- Add exactly two dependencies across the whole plan: `lucide-react` (Task 1) and nothing else. GIF search uses `fetch`, not an SDK.
- **No API key may reach the client.** The Giphy key lives in `GIPHY_API_KEY` and is read only inside `app/api/gifs/route.ts`.
- **If `GIPHY_API_KEY` is unset the GIF button must not render**, and everything else must work unchanged. Nothing in the build may depend on obtaining a key.
- `trystero` may be imported in exactly one file, `lib/sync/use-room.ts`. Components consume `useRoom()`.
- Everything under `lib/sync/` except the two hooks (`use-room.ts`, `use-sync-playback.ts`) stays pure — no I/O, no React, time as a parameter.
- **Never** use `setPlaybackRate` for drift correction.
- Chat history is session-only and lives in memory. There is no server, so there is nowhere to persist it, and the UI must say so rather than implying otherwise.
- **Icons come from `lucide-react`. Never use an emoji or a bare glyph (`×`, `→`) as an icon.**
- Every colour, radius and spacing value comes from a token defined in `app/globals.css`. No raw `text-neutral-500`, no `rounded-lg`, no arbitrary `gap-3`.
- **WCAG 2.1 AA contrast is a hard requirement**, not a preference: 4.5:1 for text under 18px, 3:1 for larger text and for UI component boundaries. Disabled controls must still clear 4.5:1 — dimming to `opacity-40` is forbidden.

## Design direction

The current UI fails for reasons worth naming, because each one is a rule for the rebuild:

1. **Nothing is the protagonist.** The video, the queue, the room code and the status line are all `text-sm` neutral. → *The video dominates. Everything else is support.*
2. **Contrast fails.** `text-neutral-500` on `#0a0a0a` is ~4.0:1, used for status, all queue metadata and empty states. `disabled:opacity-40` lands near 2:1. → *Tokens are contrast-checked once; components never pick raw colours.*
3. **The room code is the product's entire purpose and its least prominent element** — a small chip with no copy affordance. → *Invite is a first-class control with one-tap copy.*
4. **Spacing is arbitrary** (`gap-1`, `gap-3`, `gap-4`, `p-2`). → *A four-step scale, used everywhere.*
5. **`×` as a remove button** — a raw glyph with a ~16px hit area. → *Lucide icons, 44px minimum touch targets.*
6. **No real empty or loading states.** → *Every surface states what it is and what to do next.*
7. **The 1fr/384px split has no logic**; the video shrinks while the rail keeps its width. → *The rail is fixed and the video takes everything else; below `lg` they stack.*

**One accent colour only.** A single live-green marks connection and presence. Nothing else is coloured — no violet, no gradients, no glow, no glassmorphism. Warnings use amber, errors use red, and those are the only other hues in the app.

---

### Task 1: Design tokens and icon library

Everything downstream depends on these tokens existing, so this task lands first and alone.

**Files:**
- Modify: `app/globals.css`
- Modify: `package.json` (add `lucide-react`)

**Interfaces:**
- Consumes: nothing
- Produces: CSS custom properties every later task uses — surfaces `--bg`, `--surface`, `--surface-raised`, `--border`; text `--text`, `--text-muted`, `--text-subtle`; accent `--live`, `--warn`, `--danger`; radii `--radius-sm/md/lg/full`; spacing `--space-1/2/3/4`. Plus Tailwind utility aliases so components write `text-muted` rather than `text-[var(--text-muted)]`.

- [ ] **Step 1: Install the icon library**

```bash
npm install lucide-react
```

- [ ] **Step 2: Replace `app/globals.css`**

The scaffold's light/dark `:root` blocks and its two `body` rules go. This app is deliberately dark-only, so a colour-scheme media query is dead weight that already caused one bug.

```css
@import "tailwindcss";

:root {
  /* Surfaces. Each step is a visible lift, not a hairline difference. */
  --bg: #0b0b0c;
  --surface: #151517;
  --surface-raised: #1e1e21;

  /* Two border roles, and picking the wrong one is an accessibility bug.
     --border is DECORATIVE: dividers and separators, where the thing either
     side is already identifiable without it. At 1.3:1 it is intentionally
     quiet and WCAG 1.4.11 does not apply to it.
     --border-strong is STRUCTURAL: the boundary of a control you could not
     otherwise locate — text inputs above all, since --surface on --bg is only
     1.07:1, so the fill alone does not show you where the field is. Measured
     3.5:1 against --surface and 3.7:1 against --bg, clearing the 3:1 floor. */
  --border: #2a2a2f;
  --border-strong: #6b6b73;

  /* Text. Contrast measured against --bg:
     --text 17.9:1, --text-muted 7.7:1, --text-subtle 5.8:1.
     All clear the 4.5:1 AA floor for body text, so any of the three is
     safe on any surface here. Nothing dimmer than --text-subtle exists,
     deliberately — there is no token available to fail with. */
  --text: #f4f4f5;
  --text-muted: #a1a1aa;
  --text-subtle: #8b8b93;

  /* The only accent. Reserved for liveness: connection, presence. */
  --live: #4ade80;
  --warn: #fbbf24;
  --danger: #f87171;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-full: 999px;

  /* Four steps. If a gap does not fit one of these, the layout is wrong. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-muted: var(--text-muted);
  --color-subtle: var(--text-subtle);
  --color-live: var(--live);
  --color-warn: var(--warn);
  --color-danger: var(--danger);
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}

/* The IFrame API replaces our container div with an iframe that inherits
   neither its classes nor its styles, and defaults to 640x390. */
.yt-player-shell iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Every interactive element gets a visible focus ring. The default outline
   disappears against a dark surface. */
:where(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--live);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: succeeds. The existing components still reference old Tailwind classes; that is fine — they are replaced in Tasks 2 and 7. This step only proves the token layer parses.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css package.json package-lock.json
git commit -m "feat: contrast-checked design tokens and lucide icons"
```

---

### Task 2: Room layout shell with tabbed rail

Rebuilds the room's structure. Chat and presence need somewhere to live before they can be built, so the shell comes before either.

**Files:**
- Create: `components/RoomTabs.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: tokens from Task 1
- Produces: `RoomTabs` with props `{queue: ReactNode; chat: ReactNode; unreadCount: number}`. Task 5 passes a real chat panel and a real unread count; this task passes a placeholder and `0`.

- [ ] **Step 1: Write the tab component**

Create `components/RoomTabs.tsx`:

```tsx
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
          onClick={() => setTab('chat')}
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
```

- [ ] **Step 2: Restructure `Room.tsx`'s returned markup**

Replace the `return (...)` block only. Every hook above it stays exactly as it is — the instrumentation effect, the player callbacks, `positionRef`, and the `useSyncPlayback` call are all load-bearing and reviewed.

```tsx
  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      {/* The video is the protagonist: it takes every pixel the rail does not. */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="yt-player-shell relative aspect-video w-full shrink-0 bg-black lg:aspect-auto lg:flex-1">
          <div ref={containerRef} className="h-full w-full" />

          {loadError && (
            <PlayerOverlay>
              Could not load the YouTube player. An ad or privacy blocker may be
              stopping it. Reload the page to try again.
            </PlayerOverlay>
          )}

          {localBlock && (
            <PlayerOverlay
              action={{
                label: 'Skip for everyone',
                onClick: () => {
                  const trackId = trackIdRef.current
                  if (trackId) room.send({type: 'unplayable', trackId, reason: localBlock})
                },
              }}
            >
              {localBlock === 'embed-blocked'
                ? "This video can't be played here — it may be blocked in your region."
                : 'This video is unavailable for you.'}
            </PlayerOverlay>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-[var(--space-3)] border-t border-border px-[var(--space-3)] py-[var(--space-2)]">
          <button
            onClick={() => room.send({type: 'skip'})}
            disabled={room.state.queue.length === 0}
            data-testid="skip"
            aria-label="Skip to next track"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text hover:bg-surface-raised disabled:text-subtle disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
          >
            <SkipForward size={18} aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm text-text" data-testid="now-playing">
            {current ? current.title : 'Nothing playing'}
          </p>
          {resyncing && <span className="shrink-0 text-xs text-warn">resyncing…</span>}
        </div>
      </section>

      <aside className="flex min-h-0 w-full flex-col border-border lg:w-[380px] lg:shrink-0 lg:border-l">
        <RoomTabs
          unreadCount={0}
          queue={
            <div className="flex flex-col gap-[var(--space-3)] p-[var(--space-3)]">
              <AddTrackForm onAdd={add} addedBy={{peerId: room.selfId, name}} />
              <Queue
                state={room.state}
                onRemove={id => room.send({type: 'remove', trackId: id})}
              />
            </div>
          }
          chat={
            <p className="p-[var(--space-3)] text-sm text-muted">
              Chat arrives in the next task.
            </p>
          }
        />
      </aside>
    </main>
  )
```

- [ ] **Step 3: Add the overlay helper**

At the bottom of `components/Room.tsx`, below the `Room` component:

```tsx
function PlayerOverlay({
  children,
  action,
}: {
  children: React.ReactNode
  action?: {label: string; onClick(): void}
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-black/85 p-[var(--space-4)] text-center">
      <p className="max-w-sm text-sm text-text">{children}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] text-sm text-text hover:bg-surface-raised cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
```

Add `SkipForward` to the lucide import and `RoomTabs` to the component imports at the top of the file.

- [ ] **Step 4: Verify nothing regressed**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 115 tests pass, typecheck clean, lint clean. The e2e suite drives `data-testid="skip"` and `data-testid="now-playing"`, both preserved above — do not rename them.

- [ ] **Step 5: Commit**

```bash
git add components/Room.tsx components/RoomTabs.tsx
git commit -m "feat: room layout shell with tabbed rail"
```

---

### Task 3: Presence — avatars and join/leave toasts

The roster already carries every peer. It is currently rendered as the string `2 watching`. This task turns it into the thing you asked for: who is actually here, and a nudge when that changes.

**Files:**
- Create: `lib/presence.ts`
- Create: `lib/presence.test.ts`
- Create: `components/PresenceBar.tsx`
- Create: `components/Toasts.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: `RosterEntry` from `lib/sync/types.ts`
- Produces: `avatarFor(peerId, name): {initial: string; hue: number}`; `diffRoster(previous, next): {joined: RosterEntry[]; left: RosterEntry[]}`; `<PresenceBar roster selfId />`; `<Toasts items onDismiss />`

- [ ] **Step 1: Write the failing test**

Create `lib/presence.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {avatarFor, diffRoster} from './presence'
import type {RosterEntry} from './sync/types'

const peer = (peerId: string, name = peerId): RosterEntry => ({peerId, name, joinOrder: 0})

describe('avatarFor', () => {
  it('uses the first character of the name, uppercased', () => {
    expect(avatarFor('abc', 'bao').initial).toBe('B')
  })

  it('falls back to a neutral glyph for a blank name', () => {
    expect(avatarFor('abc', '   ').initial).toBe('?')
  })

  it('handles a multi-byte first character without splitting it', () => {
    expect(avatarFor('abc', '🙂 hello').initial).toBe('🙂')
  })

  it('is deterministic for the same peer id', () => {
    expect(avatarFor('abc', 'bao').hue).toBe(avatarFor('abc', 'different').hue)
  })

  it('keys the hue on peer id, not name, so a rename keeps the colour', () => {
    expect(avatarFor('abc', 'x').hue).not.toBe(avatarFor('xyz', 'x').hue)
  })

  it('produces a hue inside the colour wheel', () => {
    for (const id of ['a', 'bb', 'ccc', 'dddd', 'zzzzz']) {
      const {hue} = avatarFor(id, 'n')
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })
})

describe('diffRoster', () => {
  it('reports a peer that appeared', () => {
    const {joined, left} = diffRoster([peer('a')], [peer('a'), peer('b')])
    expect(joined.map(p => p.peerId)).toEqual(['b'])
    expect(left).toHaveLength(0)
  })

  it('reports a peer that vanished', () => {
    const {joined, left} = diffRoster([peer('a'), peer('b')], [peer('a')])
    expect(left.map(p => p.peerId)).toEqual(['b'])
    expect(joined).toHaveLength(0)
  })

  it('reports nothing when the roster is unchanged', () => {
    const {joined, left} = diffRoster([peer('a')], [peer('a')])
    expect(joined).toHaveLength(0)
    expect(left).toHaveLength(0)
  })

  it('ignores a rename of the same peer', () => {
    const {joined, left} = diffRoster([peer('a', 'old')], [peer('a', 'new')])
    expect(joined).toHaveLength(0)
    expect(left).toHaveLength(0)
  })

  it('treats an empty previous roster as no joins, so the first render is silent', () => {
    const {joined} = diffRoster([], [peer('a'), peer('b')])
    expect(joined).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- presence`
Expected: FAIL — cannot resolve `./presence`.

- [ ] **Step 3: Write the implementation**

Create `lib/presence.ts`:

```ts
import type {RosterEntry} from './sync/types'

export type Avatar = {initial: string; hue: number}

/**
 * Colour is keyed on peer id rather than name so someone changing their
 * nickname keeps the same avatar — the colour is how you recognise them at a
 * glance, and having it jump would defeat that.
 */
export function avatarFor(peerId: string, name: string): Avatar {
  const trimmed = name.trim()
  // Array.from, not [0]: a surrogate pair would otherwise split into half a
  // character and render as a replacement glyph.
  const initial = trimmed ? (Array.from(trimmed)[0] as string).toUpperCase() : '?'

  let hash = 0
  for (let i = 0; i < peerId.length; i++) {
    hash = (hash * 31 + peerId.charCodeAt(i)) % 360
  }
  return {initial, hue: hash}
}

/**
 * An empty previous roster means we have not rendered yet, so everyone
 * present counts as pre-existing rather than as arriving. Without that, every
 * peer already in the room announces itself the moment you join.
 */
export function diffRoster(
  previous: RosterEntry[],
  next: RosterEntry[],
): {joined: RosterEntry[]; left: RosterEntry[]} {
  if (previous.length === 0) return {joined: [], left: []}
  const before = new Set(previous.map(p => p.peerId))
  const after = new Set(next.map(p => p.peerId))
  return {
    joined: next.filter(p => !before.has(p.peerId)),
    left: previous.filter(p => !after.has(p.peerId)),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- presence`
Expected: PASS.

- [ ] **Step 5: Write the presence bar**

Create `components/PresenceBar.tsx`:

```tsx
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
```

The avatar background is fixed at 72% lightness and the text is `--bg`, so every hue on the wheel keeps the initial above 4.5:1 — the contrast cannot drift with the hash.

- [ ] **Step 6: Write the toast stack**

Create `components/Toasts.tsx`:

```tsx
'use client'

import {useEffect} from 'react'

export type Toast = {id: string; message: string}

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[]
  onDismiss(id: string): void
}) {
  useEffect(() => {
    if (items.length === 0) return
    const timers = items.map(item => setTimeout(() => onDismiss(item.id), 4000))
    return () => timers.forEach(clearTimeout)
  }, [items, onDismiss])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-[var(--space-4)] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-[var(--space-2)]"
      role="status"
      aria-live="polite"
    >
      {items.map(item => (
        <p
          key={item.id}
          className="rounded-[var(--radius-full)] bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text shadow-lg shadow-black/40"
        >
          {item.message}
        </p>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Wire both into `Room.tsx`**

Add state and a roster-diff effect alongside the existing hooks:

```tsx
  const [toasts, setToasts] = useState<Toast[]>([])
  const previousRoster = useRef<RosterEntry[]>([])

  useEffect(() => {
    const {joined, left} = diffRoster(previousRoster.current, room.roster)
    previousRoster.current = room.roster
    if (joined.length === 0 && left.length === 0) return
    const next = [
      ...joined.map(p => ({id: `j-${p.peerId}-${Date.now()}`, message: `${p.name} joined`})),
      ...left.map(p => ({id: `l-${p.peerId}-${Date.now()}`, message: `${p.name} left`})),
    ]
    setToasts(current => [...current, ...next])
  }, [room.roster])

  const dismissToast = useCallback(
    (id: string) => setToasts(current => current.filter(t => t.id !== id)),
    [],
  )
```

Render `<Toasts items={toasts} onDismiss={dismissToast} />` as the last child of `<main>`.

The rail already opens with a header row carrying the room code and the status text — Task 2 preserved it because the end-to-end suite depends on both test ids. **Add the presence bar into that existing row rather than creating a second one**, between the code and the status:

```tsx
<PresenceBar roster={room.roster} selfId={room.selfId} />
```

Leave `data-testid="room-code"` and `data-testid="status"` exactly as they are, including the status string — the suite asserts `2 watching` against it. Task 4 replaces this whole row with a designed invite bar; for now it is a plain row that gains an avatar stack.

- [ ] **Step 8: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 115 existing plus 11 new presence tests pass; typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add lib/presence.ts lib/presence.test.ts components/PresenceBar.tsx components/Toasts.tsx components/Room.tsx
git commit -m "feat: presence avatars and join/leave toasts"
```

---

### Task 4: Invite bar — make the room code shareable

The room code is the entire product: it is the only thing anyone sends a friend. It is currently a small chip you have to hand-select and retype. This gives it a header of its own and one-tap copy.

**Files:**
- Create: `components/InviteBar.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: `PresenceBar` from Task 3
- Produces: `<InviteBar code roster selfId status isHost />`

- [ ] **Step 1: Write the component**

Create `components/InviteBar.tsx`:

```tsx
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
```

The copied state says "Invite link copied" because the button copies the **whole URL**, not the bare code — that is what someone actually pastes to a friend.

- [ ] **Step 2: Replace the placeholder header in `Room.tsx`**

Replace the rail's whole header row — the one carrying the room code, the presence bar and the status text — with `InviteBar`, as the first child of `<aside>`. `InviteBar` renders all three itself, including both test ids, so nothing is lost:

```tsx
<InviteBar
  code={code}
  roster={room.roster}
  selfId={room.selfId}
  status={room.status}
  isHost={room.isHost}
/>
```

Remove the now-unused direct `PresenceBar` import from `Room.tsx` — it is rendered inside `InviteBar` now. Confirm `RoomStatus` is exported from `lib/sync/use-room.ts`; if it is not, export it.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green. `data-testid="room-code"` and `data-testid="status"` are preserved, so the e2e suite still resolves them.

- [ ] **Step 4: Commit**

```bash
git add components/InviteBar.tsx components/Room.tsx
git commit -m "feat: invite bar with one-tap copy"
```

---

### Task 5: Chat

Rides the existing data channel. No host mediation — chat needs no ordering guarantees and should survive a host hiccup.

**Files:**
- Create: `lib/chat/types.ts`
- Create: `lib/chat/messages.ts`
- Create: `lib/chat/messages.test.ts`
- Create: `components/ChatPanel.tsx`
- Create: `components/ChatComposer.tsx`
- Modify: `lib/sync/use-room.ts`
- Modify: `components/RoomTabs.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: `useRoom` from Task 2's shell
- Produces: `ChatMessage`; `appendMessage(list, message, max?)`; `RoomApi` gains `messages: ChatMessage[]` and `sendChat(kind, body): void`; `RoomTabs` gains `onChatOpened?: () => void`

- [ ] **Step 1: Write the types**

Create `lib/chat/types.ts`:

```ts
export type ChatKind = 'text' | 'gif'

export type ChatMessage = {
  id: string
  peerId: string
  name: string
  kind: ChatKind
  /** Text content, or a GIF URL when kind is 'gif'. */
  body: string
  at: number
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/chat/messages.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {appendMessage, CHAT_HISTORY_LIMIT} from './messages'
import type {ChatMessage} from './types'

const msg = (id: string, at = 1000): ChatMessage => ({
  id,
  peerId: 'p',
  name: 'bao',
  kind: 'text',
  body: 'hi',
  at,
})

describe('appendMessage', () => {
  it('appends to the end', () => {
    expect(appendMessage([msg('a')], msg('b')).map(m => m.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the input list', () => {
    const list = [msg('a')]
    appendMessage(list, msg('b'))
    expect(list).toHaveLength(1)
  })

  it('drops the oldest once the cap is reached', () => {
    const full = Array.from({length: CHAT_HISTORY_LIMIT}, (_, i) => msg(`m${i}`))
    const next = appendMessage(full, msg('new'))
    expect(next).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(next[0].id).toBe('m1')
    expect(next[next.length - 1].id).toBe('new')
  })

  it('ignores a duplicate id, so a re-delivered message appears once', () => {
    expect(appendMessage([msg('a')], msg('a'))).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- chat/messages`
Expected: FAIL — cannot resolve `./messages`.

- [ ] **Step 4: Write the implementation**

Create `lib/chat/messages.ts`:

```ts
import type {ChatMessage} from './types'

/** Session-only history. There is no server, so nothing persists past a reload. */
export const CHAT_HISTORY_LIMIT = 200

export function appendMessage(
  list: ChatMessage[],
  message: ChatMessage,
  max: number = CHAT_HISTORY_LIMIT,
): ChatMessage[] {
  if (list.some(m => m.id === message.id)) return list
  return [...list, message].slice(-max)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- chat/messages`
Expected: PASS.

- [ ] **Step 6: Add chat transport to `lib/sync/use-room.ts`**

Extend `RoomApi` with `messages: ChatMessage[]` and `sendChat(kind: ChatKind, body: string): void`, and add both to the returned object.

Inside the effect, alongside the other actions:

```ts
const chatAction = room.makeAction<ChatMessage>('chat')

chatAction.onMessage = incoming => {
  // Deliberately not gated on hostIdRef: chat needs no ordering guarantee and
  // should keep working through a host hand-off. The peer's own claimed name
  // is used as-is — this is a room you shared a code with, not a public space.
  setMessages(current => appendMessage(current, incoming))
}

sendChatRef.current = (kind, body) => {
  const trimmed = body.trim()
  if (!trimmed) return
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    peerId: selfId,
    name,
    kind,
    body: trimmed,
    at: Date.now(),
  }
  setMessages(current => appendMessage(current, message))
  fire(chatAction.send(message))
}
```

Declare `const [messages, setMessages] = useState<ChatMessage[]>([])` and `const sendChatRef = useRef<(kind: ChatKind, body: string) => void>(() => {})` alongside the existing state, and return `sendChat: (kind, body) => sendChatRef.current(kind, body)`. Use the existing `fire()` helper so a closed channel cannot leave an uncaught rejection.

- [ ] **Step 7: Write the composer**

Create `components/ChatComposer.tsx`:

```tsx
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
```

- [ ] **Step 8: Write the panel**

Create `components/ChatPanel.tsx`:

```tsx
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
```

- [ ] **Step 9: Wire unread counting**

In `components/RoomTabs.tsx`, add an optional `onTabChange?: (tab: 'queue' | 'chat') => void` prop. It reports **which** tab is now showing, not merely that chat was opened once — the consumer needs to know when the user leaves chat as well, or the unread badge can never re-arm.

```tsx
const select = (next: 'queue' | 'chat') => {
  setTab(next)
  onTabChange?.(next)
}
```

Both tab buttons call `select('queue')` / `select('chat')` instead of `setTab` directly.

In `Room.tsx`, track unread messages and reset on open:

```tsx
  const [unread, setUnread] = useState(0)
  const seenCount = useRef(0)
  const chatOpen = useRef(false)

  useEffect(() => {
    const added = room.messages.length - seenCount.current
    seenCount.current = room.messages.length
    if (added > 0 && !chatOpen.current) setUnread(u => u + added)
  }, [room.messages.length])
```

Pass `unreadCount={unread}` and a handler that tracks the current tab in both directions, so returning to the queue re-arms the badge:

```tsx
onTabChange={next => {
  chatOpen.current = next === 'chat'
  if (next === 'chat') setUnread(0)
}}
```

Replace the placeholder chat node with:

```tsx
chat={
  <ChatPanel
    messages={room.messages}
    selfId={room.selfId}
    composer={<ChatComposer onSend={body => room.sendChat('text', body)} />}
  />
}
```

- [ ] **Step 10: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green, plus 4 new chat tests.

- [ ] **Step 11: Commit**

```bash
git add lib/chat components/ChatPanel.tsx components/ChatComposer.tsx components/RoomTabs.tsx components/Room.tsx lib/sync/use-room.ts
git commit -m "feat: peer-to-peer chat with unread badge"
```

---

### Task 6: GIF picker

Search proxies through a route handler so the key never reaches the browser. Whether the feature exists at all is decided on the server and passed down as a boolean, so no key and no `NEXT_PUBLIC_` mirror of it is needed.

**Files:**
- Create: `lib/gifs/types.ts`
- Create: `lib/gifs/giphy.ts`
- Create: `lib/gifs/giphy.test.ts`
- Create: `app/api/gifs/route.ts`
- Create: `components/GifPicker.tsx`
- Modify: `app/r/[code]/page.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: `ChatComposer`'s `gifSlot` prop from Task 5
- Produces: `Gif = {id, previewUrl, url, title}`; `giphySearchUrl(query, key, limit)`; `mapGiphy(raw): Gif[]`; `GET /api/gifs?q=`; `<Room code gifsEnabled />`

- [ ] **Step 1: Write the failing test**

Create `lib/gifs/giphy.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {giphySearchUrl, mapGiphy} from './giphy'

const raw = {
  data: [
    {
      id: 'abc',
      title: 'a cat',
      images: {
        fixed_width_small: {url: 'https://media.giphy.com/preview.gif'},
        fixed_width: {url: 'https://media.giphy.com/full.gif'},
      },
    },
  ],
}

describe('giphySearchUrl', () => {
  it('targets the search endpoint with the query and key', () => {
    const url = new URL(giphySearchUrl('cats', 'KEY', 12))
    expect(url.origin + url.pathname).toBe('https://api.giphy.com/v1/gifs/search')
    expect(url.searchParams.get('q')).toBe('cats')
    expect(url.searchParams.get('api_key')).toBe('KEY')
    expect(url.searchParams.get('limit')).toBe('12')
  })

  it('encodes a query with spaces and symbols', () => {
    const url = new URL(giphySearchUrl('happy dance &c', 'K', 5))
    expect(url.searchParams.get('q')).toBe('happy dance &c')
  })
})

describe('mapGiphy', () => {
  it('maps only the fields the picker needs', () => {
    expect(mapGiphy(raw)).toEqual([
      {
        id: 'abc',
        title: 'a cat',
        previewUrl: 'https://media.giphy.com/preview.gif',
        url: 'https://media.giphy.com/full.gif',
      },
    ])
  })

  it('skips entries missing an image rather than throwing', () => {
    expect(mapGiphy({data: [{id: 'x', title: 't', images: {}}]})).toEqual([])
  })

  it('returns an empty list for a malformed payload', () => {
    expect(mapGiphy(null)).toEqual([])
    expect(mapGiphy({})).toEqual([])
    expect(mapGiphy({data: 'nope'})).toEqual([])
  })

  it('falls back to an empty title rather than undefined', () => {
    const noTitle = {data: [{id: 'x', images: raw.data[0].images}]}
    expect(mapGiphy(noTitle)[0].title).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- giphy`
Expected: FAIL — cannot resolve `./giphy`.

- [ ] **Step 3: Write the types and adapter**

Create `lib/gifs/types.ts`:

```ts
export type Gif = {
  id: string
  title: string
  /** Small still-ish version for the grid. */
  previewUrl: string
  /** The version actually sent to the room. */
  url: string
}
```

Create `lib/gifs/giphy.ts`:

```ts
import type {Gif} from './types'

export function giphySearchUrl(query: string, key: string, limit: number): string {
  const url = new URL('https://api.giphy.com/v1/gifs/search')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', key)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('rating', 'pg-13')
  return url.toString()
}

/**
 * Never throws. A GIF grid that fails to render is a cosmetic disappointment;
 * one that takes out the chat panel is a bug.
 */
export function mapGiphy(raw: unknown): Gif[] {
  if (typeof raw !== 'object' || raw === null) return []
  const data = (raw as {data?: unknown}).data
  if (!Array.isArray(data)) return []

  return data.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) return []
    const {id, title, images} = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof images !== 'object' || images === null) return []
    const preview = (images as Record<string, {url?: unknown}>).fixed_width_small?.url
    const full = (images as Record<string, {url?: unknown}>).fixed_width?.url
    if (typeof preview !== 'string' || typeof full !== 'string') return []
    return [{id, title: typeof title === 'string' ? title : '', previewUrl: preview, url: full}]
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- giphy`
Expected: PASS.

- [ ] **Step 5: Write the route handler**

Create `app/api/gifs/route.ts`:

```ts
import {giphySearchUrl, mapGiphy} from '@/lib/gifs/giphy'

const LIMIT = 18

export async function GET(request: Request) {
  const key = process.env.GIPHY_API_KEY
  if (!key) {
    return Response.json({error: 'gif search is not configured'}, {status: 501})
  }

  const query = new URL(request.url).searchParams.get('q')?.trim()
  if (!query) return Response.json({error: 'missing query'}, {status: 400})

  let upstream: Response
  try {
    upstream = await fetch(giphySearchUrl(query, key, LIMIT), {
      headers: {accept: 'application/json'},
    })
  } catch {
    return Response.json({error: 'giphy unreachable'}, {status: 502})
  }

  if (upstream.status === 429) {
    // The free tier is 100 searches/hour. Say so rather than showing "failed".
    return Response.json({error: 'gif search rate limit reached'}, {status: 429})
  }
  if (!upstream.ok) return Response.json({error: 'giphy rejected the request'}, {status: 502})

  try {
    return Response.json({gifs: mapGiphy(await upstream.json())})
  } catch {
    return Response.json({error: 'unexpected giphy response'}, {status: 502})
  }
}
```

- [ ] **Step 6: Write the picker**

Create `components/GifPicker.tsx`:

```tsx
'use client'

import {useEffect, useState} from 'react'
import {ImagePlay} from 'lucide-react'
import type {Gif} from '@/lib/gifs/types'

export function GifPicker({onPick}: {onPick(url: string): void}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [error, setError] = useState<string | null>(null)

  // Derived, not stored. An empty query shows nothing, and that is a function
  // of `query` at render time — writing `setGifs([])` in the effect instead
  // would cost an extra render and need a lint suppression to boot.
  const trimmedQuery = query.trim()
  const visibleGifs = trimmedQuery ? gifs : []

  useEffect(() => {
    if (!open || !trimmedQuery) return

    // Aborting matters twice over: it stops a superseded response from landing
    // after a newer one and repainting the grid with results for a query the
    // user has moved on from, and it actually cancels the request, which the
    // free tier's 100-searches-an-hour ceiling makes worth doing.
    const controller = new AbortController()

    // Debounced: a request per keystroke would exhaust that quota in about a
    // minute of typing.
    const timer = setTimeout(async () => {
      setError(null)
      try {
        const response = await fetch(`/api/gifs?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setError(
            response.status === 429
              ? 'Too many searches — wait a minute.'
              : 'GIF search is unavailable.',
          )
          setGifs([])
          return
        }
        setGifs((await response.json()).gifs ?? [])
      } catch (cause) {
        // An abort is us superseding our own request, not a failure to report.
        if ((cause as Error | undefined)?.name === 'AbortError') return
        setError('GIF search is unavailable.')
        setGifs([])
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, trimmedQuery])

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Add a GIF"
        aria-expanded={open}
        data-testid="gif-toggle"
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <ImagePlay size={18} aria-hidden />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-[var(--space-2)] w-72 rounded-[var(--radius-lg)] border border-border bg-surface p-[var(--space-2)] shadow-xl shadow-black/50">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-raised px-[var(--space-3)] py-[var(--space-2)] text-sm text-text placeholder:text-subtle"
          />

          {error && <p className="p-[var(--space-2)] text-sm text-warn">{error}</p>}

          <div className="mt-[var(--space-2)] grid max-h-64 grid-cols-3 gap-[var(--space-1)] overflow-y-auto">
            {visibleGifs.map(gif => (
              <button
                key={gif.id}
                onClick={() => {
                  onPick(gif.url)
                  setOpen(false)
                  setQuery('')
                }}
                className="overflow-hidden rounded-[var(--radius-sm)] cursor-pointer"
              >
                <img src={gif.previewUrl} alt={gif.title || 'GIF'} className="h-20 w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Decide availability on the server**

In `app/r/[code]/page.tsx`, read the key server-side and pass a boolean — never the key itself:

```tsx
  const {code} = await params
  if (!isValidRoomCode(code)) notFound()
  // Only a boolean crosses to the client. Deciding here means no
  // NEXT_PUBLIC_ mirror of the secret and no client-side probe request.
  return <Room code={code} gifsEnabled={Boolean(process.env.GIPHY_API_KEY)} />
```

In `Room.tsx`, accept `gifsEnabled: boolean` and pass the picker only when it is true:

```tsx
composer={
  <ChatComposer
    onSend={body => room.sendChat('text', body)}
    gifSlot={
      gifsEnabled ? <GifPicker onPick={url => room.sendChat('gif', url)} /> : null
    }
  />
}
```

- [ ] **Step 8: Verify both configurations**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green, plus 6 new giphy tests.

Then confirm the graceful degradation that the constraint demands. With no `GIPHY_API_KEY` set, run `npm run build && npm run start`, open a room, and confirm the chat composer renders **without** a GIF button and chat still sends. Stop the server afterwards and confirm port 3000 is free.

- [ ] **Step 9: Commit**

```bash
git add lib/gifs app/api/gifs components/GifPicker.tsx app/r components/Room.tsx
git commit -m "feat: GIF picker with server-side key and graceful degradation"
```

---

### Task 7: Tap to watch — phone support

Phones block programmatic playback, so a joiner's player never starts and the drift loop seeks a paused video forever with nothing on screen explaining it. A single gesture fixes it, and the same gate serves desktop as the unmute action.

**Files:**
- Create: `components/TapToWatch.tsx`
- Modify: `components/Room.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `PlayerHandle` from `lib/youtube/use-player.ts`
- Produces: `<TapToWatch onActivate />`

- [ ] **Step 0: Define the scrim token**

Three overlays now dim the player — `loadError`, `localBlock` and this gate —
and all three reached for a raw `bg-black/8x`, which the token rule forbids.
One token, defined once and used by all three, is the fix; converting only the
new one would leave the file less consistent than it started.

In `app/globals.css`, beside the other colour tokens:

```css
  /* Dims the video behind any overlay that needs to be read over it. Not a
     surface — it is always composited over unknown video frames, which is
     why it is an alpha rather than one of the flat surface colours. */
  --scrim: rgb(0 0 0 / 0.85);
```

Then in `components/Room.tsx`, replace `bg-black/85` on **both** existing
`PlayerOverlay` backdrops with `bg-[var(--scrim)]`. The new gate uses the same
token, so all three match at 0.85 — slightly darker than the gate's original
0.80, which only helps the text contrast over a bright frame.

- [ ] **Step 1: Write the gate**

Create `components/TapToWatch.tsx`:

```tsx
'use client'

import {Play} from 'lucide-react'

export function TapToWatch({onActivate}: {onActivate(): void}) {
  return (
    <button
      onClick={onActivate}
      data-testid="tap-to-watch"
      // Without an explicit label the accessible name is built from every
      // descendant text node, so this button announces as "Tap to watch
      // Browsers need one tap before they will start a video with sound."
      // — one run-on string, on the single most important control a phone
      // joiner meets. `aria-label` wins over name-from-content, and
      // `aria-describedby` keeps the explanation as a description rather
      // than discarding it.
      aria-label="Tap to watch"
      aria-describedby="tap-to-watch-hint"
      className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] bg-[var(--scrim)] cursor-pointer"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-full)] bg-text text-bg">
        <Play size={28} aria-hidden />
      </span>
      <span className="text-sm text-text">Tap to watch</span>
      <span
        id="tap-to-watch-hint"
        className="max-w-xs px-[var(--space-4)] text-center text-xs text-muted"
      >
        Browsers need one tap before they will start a video with sound.
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Gate playback in `Room.tsx`**

Add state and render the gate over the player until it is dismissed:

```tsx
  const [activated, setActivated] = useState(false)
```

Inside the player shell, after the existing overlays:

```tsx
{/* Suppressed alongside the other two overlays rather than stacked on top
    of them: this renders last, so an un-suppressed gate would sit above
    the unplayable overlay and swallow its "Skip for everyone" button. */}
{!activated && !loadError && !localBlock && (
  <TapToWatch
    onActivate={() => {
      // A tap before the IFrame API has finished loading must not dismiss
      // the gate. `handle` is null across a real network round trip, and
      // the gate is the largest thing on screen from first paint, so an
      // early tap is likely on exactly the slow mobile connections this
      // feature exists for. Dismissing on that tap would strand the user:
      // the gate never returns (`activated` is one-way), and the play()
      // that useSyncPlayback issues once the handle appears comes from an
      // effect, carries no user activation, and is blocked by the very
      // policy this gate exists to satisfy — leaving a dead player with
      // no affordance and nothing on screen suggesting a reload.
      if (!handle) return
      setActivated(true)
      // Called inside the click handler so it runs under a real user
      // gesture — that activation is exactly what the autoplay policy
      // requires, and it does not survive an async hop.
      handle.play()
    }}
  />
)}
```

Returning early leaves the gate up, so the next tap is its own fresh, valid gesture. It stays fully synchronous: no `await`, no timer, nothing between the click and `play()`.

The gate stays up until it is tapped, which is what makes an empty room work: a user who arrives before any video exists adds one from the rail, the gate is still covering the player, and their tap both dismisses it and starts playback under a real gesture. Deferring the gate until a track existed would move the tap to the worst possible moment.

- [ ] **Step 3: Verify on a narrow viewport**

Run `npm run build && npm run start`, then with the Chrome MCP tools open a room and resize to 390×844 (a phone viewport).

Confirm: the video sits at the top edge-to-edge, the tabs sit beneath it, the "Tap to watch" gate covers the player, tapping it dismisses the gate, and no element overflows horizontally — the page must not scroll sideways at 320px either.

Before reading the console, call `read_console_messages` once to start capture and reload, or page-load errors are invisible. Navigate the tab to `http://localhost:3000/` when finished rather than closing it, and stop the server, confirming port 3000 is free.

- [ ] **Step 4: Commit**

```bash
git add components/TapToWatch.tsx components/Room.tsx
git commit -m "feat: tap-to-watch gate for mobile autoplay"
```

---

### Task 8: Queue, form and landing polish

The last surfaces still wearing the placeholder styling. This is also the accessibility sweep.

**Files:**
- Modify: `components/Queue.tsx`
- Modify: `components/AddTrackForm.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/Room.tsx` (mobile layout fix, Step 0)
- Modify: `components/PresenceBar.tsx`, `components/Toasts.tsx`, `components/GifPicker.tsx` (routed fixes, Step 6)

**Interfaces:**
- Consumes: tokens from Task 1
- Produces: nothing new

- [ ] **Step 0: Fix the mobile layout void**

Found during Task 7's phone verification. On a phone the rail is crushed and a
band of dead black sits above it, which is the opposite of the intended
priority: the video and the bar need only their natural height, and every
remaining pixel belongs to chat and the queue.

`<main>` is `flex-col` below `lg`. The `<section>` holding the player carries
`flex-1`, so it claims all the free space even though both its children are
`shrink-0` and total roughly 270px; the `<aside>` has no `flex-1` and its
`min-h-0` lets it shrink under its own content. Swap which one grows, per
breakpoint.

In `components/Room.tsx`, the section becomes:

```tsx
      <section className="flex min-w-0 flex-col lg:flex-1">
```

and the aside becomes:

```tsx
      <aside className="flex min-h-0 w-full flex-1 flex-col border-border lg:w-[380px] lg:flex-none lg:border-l">
```

`lg:flex-none` is doing real work: without it the `flex-1` would keep applying
at desktop widths and fight the fixed `lg:w-[380px]`. It also replaces the old
`lg:shrink-0`, which `flex-none` already implies.

Verify at 390px that the rail fills everything below the now-playing bar with
no black gap, and at `lg` that the player still grows and the rail holds its
380px.

Stacking is wrong in landscape, though, and fixing only the portrait case
leaves the sibling failure: at 844×390 the `aspect-video` player is taller than
the entire viewport, so the section eats everything and `min-h-0` lets the rail
go to **0px** — chat and queue vanish outright. Width is the wrong
discriminator here (a landscape phone is 844px wide, just under `lg`, while a
portrait tablet is 768px wide and genuinely wants stacking); the real question
is whether there is vertical room to stack, which is what `landscape:`
expresses. Add it alongside every `lg:` in the layout chain:

```tsx
<main className="flex h-dvh flex-col landscape:flex-row lg:flex-row">
```

```tsx
<div className="yt-player-shell relative aspect-video w-full shrink-0 bg-black landscape:aspect-auto landscape:flex-1 lg:aspect-auto lg:flex-1" />
```

```tsx
<section className="flex min-w-0 flex-col landscape:flex-1 lg:flex-1">
```

```tsx
<aside className="flex min-h-0 w-full flex-1 flex-col border-border landscape:w-[380px] landscape:flex-none landscape:border-l lg:w-[380px] lg:flex-none lg:border-l">
```

At 844×390 that gives a 464px-wide player at 261px tall inside 390px of height,
with the rail at its full 380px — cramped but complete. Desktop is unaffected:
it is already landscape *and* `lg`, so both variants agree.

Verify at 844×390 that the rail is present and non-zero, and re-check 390×844
afterwards to confirm the portrait case did not regress.

- [ ] **Step 1: Rebuild the queue rows**

In `components/Queue.tsx`: replace the `×` with Lucide's `Trash2` in a 44px target, use tokens throughout, mark the playing row with the accent rather than a grey wash, and give the empty state something useful to say.

```tsx
import {Trash2} from 'lucide-react'
```

Empty state:

```tsx
<p className="text-sm text-muted">
  Nothing queued. Paste a YouTube link above and everyone here will see it.
</p>
```

Row:

```tsx
<li
  key={track.id}
  data-testid="queue-item"
  className={`flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] p-[var(--space-2)] ${
    track.id === state.currentTrackId ? 'bg-surface-raised' : 'hover:bg-surface'
  }`}
>
  <img src={track.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover" />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm text-text">{track.title}</p>
    <p className="truncate text-xs text-muted">
      {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
      {track.unplayable && ' · unavailable'}
    </p>
  </div>
  {track.id === state.currentTrackId && (
    <span className="shrink-0 text-xs font-medium text-live">playing</span>
  )}
  <button
    onClick={() => onRemove(track.id)}
    aria-label={`Remove ${track.title}`}
    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
  >
    <Trash2 size={16} aria-hidden />
  </button>
</li>
```

- [ ] **Step 2: Restyle the add form and the landing page**

In `AddTrackForm.tsx` and `app/page.tsx`, replace every `rounded-lg`, `border-neutral-*`, `bg-neutral-*` and `text-neutral-*` with the token equivalents (`rounded-[var(--radius-md)]`, `border-border`, `bg-surface`, `text-text` / `text-muted`). Error text uses `text-danger`.

**Every text input takes `border border-border-strong`, not `border-border`.** `--surface` against `--bg` is only 1.07:1, so a filled field with a decorative border is effectively invisible — the strong border is the only thing that shows someone where to type, and it is the token measured to clear the 3:1 boundary floor. That applies to the nickname field, the room-code field, and the add-URL field. Keep every `data-testid`, the label text "Your name", the button labels "Start a room" and "Join", and the placeholder `word-word-abcd` — the e2e suite resolves elements by all of them.

- [ ] **Step 2b: Close three accessibility and token gaps found reviewing earlier tasks**

**`components/PresenceBar.tsx`** — wrap the initial so it is not announced alongside the name. A screen reader concatenates both text nodes today, so each avatar is read out twice — once as the glyph, once as the real name:

```tsx
<span aria-hidden="true">{initial}</span>
<span className="sr-only">{isSelf ? `${entry.name}, you` : entry.name}</span>
```

Also bring its spacing onto the token scale: `-space-x-2` becomes `-space-x-[var(--space-2)]`, matching how the sibling `Toasts.tsx` spaces its items. Leave `h-8 w-8` and `border-2` — those are sizes, and no size token exists.

**`components/Toasts.tsx`** — `shadow-black/40` is a raw colour. Swap the shadow for `border border-border`, which is a token and reads better against a dark surface anyway.

**`components/GifPicker.tsx`** — three gaps, all from its own brief:

- `shadow-xl shadow-black/50` on the popover is a raw colour. Replace the shadow with `border border-border`, matching what `Toasts` now does.
- The popover has no keyboard dismissal and does not return focus. Add an `Escape` handler that closes it and moves focus back to the toggle, since when a chosen GIF's button unmounts, focus otherwise falls to `document.body` and a keyboard user loses their place entirely:

```tsx
const toggleRef = useRef<HTMLButtonElement | null>(null)

const close = () => {
  setOpen(false)
  toggleRef.current?.focus()
}
```

Attach `ref={toggleRef}` to the toggle button, call `close()` after picking a GIF instead of `setOpen(false)`, and put `onKeyDown={e => { if (e.key === 'Escape') close() }}` on the popover container.

- `alt={gif.title || 'GIF'}` announces every untitled result identically, so a screen-reader user tabbing the grid hears "GIF, GIF, GIF". Fall back to a positional name instead: `alt={gif.title || \`GIF ${index + 1}\`}`, taking `index` from the `map` callback.

- [ ] **Step 3: Check for token violations**

Run:

```bash
grep -rnE "(bg|text|border|ring|shadow|fill|stroke|divide|from|to|via|placeholder|accent|caret|outline|decoration)-(neutral|slate|gray|zinc|stone)-|rounded-(sm|md|lg|xl|2xl|3xl|full)\b|(bg|text|border|shadow|ring)-(black|white)/" components/ app/ --include="*.tsx"
```

Then the spacing sweep, which is a separate pattern because spacing and colour
fail differently — a raw colour is wrong, a raw gap is merely unanchored:

```bash
grep -rnE "(^|[\"' ])-?(m|p)[trblxyse]?-[0-9]|(^|[\"' ])(gap|space)(-[xy])?-[0-9]" components/ app/ --include="*.tsx"
```

Expected: no output, with the single documented exemption below. This pattern
deliberately keys on a leading quote or space so it matches utility names and
not fragments: `inset-0`, `right-0`, `left-1/2`, `max-w-md`, `min-w-0`,
`max-h-48` and the already-correct `-space-x-[var(--space-2)]` all pass it
untouched.

Expected: no output. Anything listed is a leftover to convert.

Three things about that command, each of which cost a run to find:

- `--include="*.tsx"` **must stay quoted.** Unquoted, zsh expands it against the current directory and the whole command dies with `no matches found` before grep ever runs — a verification step that silently fails to verify.
- The colour half is anchored to a utility prefix rather than matching the palette name loosely. A bare `slate-` matches `tran`**`slate-`**`x-1/2`, so an unanchored pattern reports a hit on every centred element and trains you to skim past real findings.
- The radius half needs `\b` so that `rounded-[var(--radius-full)]` — the correct token form — is not flagged as a violation of itself.

Two deliberate exclusions, so their absence is not read as an oversight: `bg-black` (no slash) on the player shell is the letterbox behind a video frame, where true black is the right answer and no token applies; and `--scrim` covers the overlay alphas as of Task 7.

One conversion the grep cannot see, in `app/page.tsx`: the primary CTA is `bg-white … text-neutral-950`. Make it `bg-text text-bg`, matching the play button inside `TapToWatch`. The tokens are near-white and near-black, so it looks the same and stops being the one hardcoded pair left in the app.

- [ ] **Step 4: Verify contrast and structure in a real browser**

Run `npm run build && npm run start`. With the Chrome MCP tools, open a room and run an accessibility audit:

```js
JSON.stringify(
  [...document.querySelectorAll('button, a, input, select, textarea')]
    .filter(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false
      // A form control's name can come from a <label>, which has no text of
      // its own inside the control — checking textContent alone would clear
      // every input in the app and clear nothing that was actually wrong.
      if (el.labels?.length) return false
      return !el.textContent?.trim()
    })
    .map(el => el.outerHTML.slice(0, 80))
)
```

Expected: `[]` — every control has an accessible name from somewhere.

Two notes on that selector. It covers form controls, not just `button, a`: an
earlier version queried only the latter and structurally could not see that the
room-code field's *only* accessible name was its placeholder, so it announced
as "word-word-abcd, edit text" and lost even that the moment someone typed.
And run it on more than one screen — at minimum the landing page, an empty
room, and a room with a track queued. The queue's own remove buttons do not
exist in an empty room, so a single audit of the default state cannot see the
control this task added.

Then confirm no horizontal overflow at 320px:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`.

Stop the server and confirm port 3000 is free.

- [ ] **Step 5: Set the document title**

In `app/layout.tsx`, replace the `metadata` export:

```tsx
export const metadata: Metadata = {
  title: 'Watch Together',
  description: 'Watch YouTube with friends, in sync. No accounts, no server.',
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

```bash
git add components/Queue.tsx components/AddTrackForm.tsx app/page.tsx app/layout.tsx \
        components/Room.tsx components/PresenceBar.tsx components/Toasts.tsx components/GifPicker.tsx
git commit -m "feat: token-based styling and accessibility pass"
```

That list covers all eight files this task touches — the four original surfaces, plus `Room.tsx` from Step 0 and the three carrying fixes routed here from Tasks 3, 4 and 6. Run `git status` afterwards and confirm nothing is left unstaged.

---

## Done when

- Chat works between two peers, with an unread badge and a GIF button that disappears cleanly when no key is configured.
- Presence shows who is in the room, and says when someone arrives or leaves.
- The room works on a phone: video on top, tabs below, one tap to start, no horizontal scroll at 320px.
- No component references a raw Tailwind colour or radius.
- Every icon-only control has an accessible name, and no text sits below 4.5:1.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run test:e2e` before calling it finished.

**Not in this plan:** host migration, TURN fallback, guest seek, and the per-peer intent sequence numbers that would fix the known concurrent-add flicker. Those remain phase 3.

