# Phase 3: chat emoji, queue reordering, identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emoji shortcodes in chat, drag-to-reorder for the queue, and a way for anyone — especially someone who arrived by invite link — to set and change their name.

**Architecture:** Two of the four requested items already shipped: removing a queue item, and the "added by" attribution on each row. The `reorder` intent and its reducer case also already exist and are tested, so reordering is a UI-only task wired to an existing protocol message. Likewise the name-change broadcast (`nameAction`, `announceNameRef`) was built during the phase 2 presence fix, so renaming needs no sync work either.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript, Tailwind 4, Trystero, `@dnd-kit/core` + `@dnd-kit/sortable` (new).

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md`

## Global Constraints

- Design tokens only. Both sweeps in the phase 2 plan's Step 3 must return clean: colours/radii return nothing, spacing returns only the documented `ChatPanel.tsx` `mt-0.5` exemption. Keep `--include="*.tsx"` quoted or zsh kills the command before grep runs.
- WCAG 2.1 AA: 4.5:1 body text, 3:1 UI boundaries and icons. Interactive targets ≥44px on touch surfaces. `cursor-pointer` on clickables. Lucide icons, never emoji-as-icon.
- **Contractual, do not touch:** every `data-testid` (`queue-item` above all — `e2e/sync.spec.ts` counts them), the label "Your name", the buttons "Start a room" and "Join", the `word-word-abcd` placeholder.
- Verify against a production build (`npm run build && npm run start`), never `next dev` — Strict Mode double-invokes effects and races host election. Check the port with `lsof -i:3000 -sTCP:LISTEN`; plain `lsof -ti:3000` matches client sockets and lies.
- `components/Room.tsx` has no unit tests by design; it is covered by e2e.

---

### Task 1: Emoji shortcodes in chat

Typing `:haha:` should send 😄. Native emoji from the OS keyboard already work — they are just text — so this is only about the `:code:` form.

**Files:**
- Create: `lib/emoji/shortcodes.ts`
- Create: `lib/emoji/replace.ts`
- Create: `lib/emoji/replace.test.ts`
- Modify: `components/ChatComposer.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `replaceShortcodes(text: string): string`

- [ ] **Step 1: Write the failing test**

Create `lib/emoji/replace.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {replaceShortcodes} from './replace'

describe('replaceShortcodes', () => {
  it('replaces a known shortcode', () => {
    expect(replaceShortcodes('that was :haha:')).toBe('that was 😄')
  })

  it('is case-insensitive', () => {
    expect(replaceShortcodes(':HAHA:')).toBe('😄')
  })

  it('replaces several in one message, including adjacent ones', () => {
    expect(replaceShortcodes(':fire::fire: :tada:')).toBe('🔥🔥 🎉')
  })

  // Unknown codes pass through untouched rather than being eaten. Someone
  // typing ":wat:" should see ":wat:", not an empty gap they cannot explain.
  it('leaves an unknown shortcode alone', () => {
    expect(replaceShortcodes('what :wat: even')).toBe('what :wat: even')
  })

  // The three cases below are why the pattern is not simply /:.+?:/ — each one
  // is ordinary chat text that a greedier pattern would mangle.
  it('leaves a URL alone', () => {
    expect(replaceShortcodes('https://youtu.be/x')).toBe('https://youtu.be/x')
  })

  // The character class does not save us here — the colon is followed by
  // ordinary word characters, so without the link-token skip this becomes
  // `http://x/🔥` and the link is broken.
  it('leaves a shortcode-shaped segment inside a URL alone', () => {
    expect(replaceShortcodes('http://x/:fire:')).toBe('http://x/:fire:')
    expect(replaceShortcodes('https://e.com/:fire:/p')).toBe('https://e.com/:fire:/p')
  })

  it('still replaces a code sitting next to a URL', () => {
    expect(replaceShortcodes('watch https://youtu.be/x :fire:')).toBe(
      'watch https://youtu.be/x 🔥',
    )
  })

  it('preserves newlines and runs of spaces exactly', () => {
    expect(replaceShortcodes('a  :fire:\n\nb')).toBe('a  🔥\n\nb')
  })

  // Roughly a fifth of the map uses underscores, and none of the cases above
  // would notice if `_` were dropped from the character class.
  it('replaces a code containing an underscore', () => {
    expect(replaceShortcodes(':heart_eyes:')).toBe('😍')
  })

  // `+1` exercises both the alias entries and the non-alphanumeric end of the
  // character class.
  it('replaces an alias code with punctuation', () => {
    expect(replaceShortcodes('nice :+1:')).toBe('nice 👍')
  })

  it('leaves a timestamp alone', () => {
    expect(replaceShortcodes('start at 1:30:00')).toBe('start at 1:30:00')
  })

  it('leaves a lone colon alone', () => {
    expect(replaceShortcodes('wait: what')).toBe('wait: what')
  })

  it('returns an empty string unchanged', () => {
    expect(replaceShortcodes('')).toBe('')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/emoji`
Expected: FAIL — `replace.ts` does not exist.

- [ ] **Step 3: Write the shortcode map**

Create `lib/emoji/shortcodes.ts`. A curated map rather than a dependency: the full Unicode shortcode set is a large payload for a phone-first app, and nobody in a watch-together chat is reaching for `:non_potable_water:`. Anything missing can still be typed straight from the OS emoji keyboard.

Keys are lowercase; lookup lowercases the captured code, so `:HAHA:` and `:Haha:` both resolve.

```ts
/**
 * Shortcode → emoji. Curated, not exhaustive: this is the set people actually
 * reach for while watching something together. Unknown codes pass through
 * untouched, so the cost of a miss is that someone sees the literal text.
 *
 * Informal aliases (`haha`, `lol`, `thumbsup`) sit beside the standard names
 * because they are what people type without thinking.
 */
export const SHORTCODES: Record<string, string> = {
  // faces
  smile: '🙂', smiley: '😃', grin: '😁', haha: '😄', laughing: '😆',
  joy: '😂', lol: '😂', rofl: '🤣', sob: '😭', cry: '😢',
  wink: '😉', blush: '😊', heart_eyes: '😍', kissing_heart: '😘',
  thinking: '🤔', neutral_face: '😐', expressionless: '😑', unamused: '😒',
  roll_eyes: '🙄', smirk: '😏', sweat_smile: '😅', sweat: '😓',
  weary: '😩', tired_face: '😫', fearful: '😨', scream: '😱',
  angry: '😠', rage: '😡', sunglasses: '😎', nerd: '🤓',
  star_struck: '🤩', partying_face: '🥳', party: '🥳', yawn: '🥱',
  sleepy: '😪', zzz: '💤', shush: '🤫', drool: '🤤', vomit: '🤮',
  // hands and people
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎',
  ok_hand: '👌', clap: '👏', wave: '👋', pray: '🙏', muscle: '💪',
  point_right: '👉', point_left: '👈', raised_hands: '🙌',
  facepalm: '🤦', shrug: '🤷', dancer: '💃', eyes: '👀',
  // reactions
  fire: '🔥', tada: '🎉', sparkles: '✨', star: '⭐', zap: '⚡',
  boom: '💥', heart: '❤️', broken_heart: '💔', skull: '💀',
  clown: '🤡', poop: '💩', '100': '💯',
  // watching together
  popcorn: '🍿', pizza: '🍕', beer: '🍺', coffee: '☕', cake: '🎂',
  gift: '🎁', music: '🎵', notes: '🎶', headphones: '🎧',
  tv: '📺', movie_camera: '🎥', film: '🎬', video_game: '🎮',
  // animals and things
  cat: '🐱', dog: '🐶', monkey: '🐵', unicorn: '🦄',
  see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊',
  rocket: '🚀', moon: '🌙', sun: '☀️', rain: '🌧️', snowflake: '❄️',
  // marks
  check: '✅', white_check_mark: '✅', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗',
}
```

- [ ] **Step 4: Write the replacer**

Create `lib/emoji/replace.ts`:

```ts
import {SHORTCODES} from './shortcodes'

/**
 * The character class admits only what a shortcode can contain, which keeps
 * most ordinary text intact on its own:
 *
 * - `1:30:00` — `:30:` matches the shape, finds no entry, and is returned
 *   verbatim by the fallback below. Unknown codes passing through is what
 *   makes a permissive pattern tolerable.
 * - `wait: what` — a space cannot appear in a code, so a lone colon is inert.
 */
const SHORTCODE = /:([a-z0-9_+-]+):/gi

/** A whitespace-delimited token that is a link, and so must be left alone. */
const URL_TOKEN = /^https?:\/\//i

export function replaceShortcodes(text: string): string {
  // URLs are skipped as whole tokens rather than pattern-matched around,
  // because the character class alone does NOT protect them. It stops
  // `https://youtu.be/x` only because the colon there is followed by `/` —
  // but a colon later in a path is followed by ordinary word characters, so
  // `http://x/:fire:` would otherwise become `http://x/🔥` and the link would
  // break. Splitting on whitespace and skipping link tokens outright is both
  // simpler to reason about and complete, where a lookbehind on `/` would
  // still miss shapes like `https://x.com/a:fire:b`.
  //
  // The capture group in the split pattern keeps the separators in the array,
  // so `join('')` restores the original spacing exactly — including newlines
  // and runs of spaces.
  return text
    .split(/(\s+)/)
    .map(token =>
      URL_TOKEN.test(token)
        ? token
        : token.replace(SHORTCODE, (whole, code: string) => SHORTCODES[code.toLowerCase()] ?? whole),
    )
    .join('')
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/emoji`
Expected: PASS, 8 tests.

- [ ] **Step 6: Convert on send**

In `components/ChatComposer.tsx`, apply the replacement at the moment of sending, not while typing.

Converting on send rather than on render means the emoji crosses the wire, so every peer sees the same thing regardless of which version of the map they are running — and a peer who joins later and receives history sees emoji rather than codes. Converting live as the user types would fight the IME guard already in this component and would rewrite text under the cursor.

Find where the composer calls `onSend` with the trimmed body, and wrap that value:

```tsx
    onSend(replaceShortcodes(trimmed))
```

with `import {replaceShortcodes} from '@/lib/emoji/replace'` at the top. Change nothing else — the existing `!e.nativeEvent.isComposing` guard and the trim/empty checks stay exactly as they are.

- [ ] **Step 7: Cover the send path end to end**

The unit tests all call `replaceShortcodes` directly, so deleting the call in
`ChatComposer` leaves the whole suite green — the feature's headline behaviour
is unprotected. This project has no component-test tooling and covers
components with Playwright by convention, so the assertion belongs there.

Add to `e2e/sync.spec.ts`, using the existing `startRoom` / `joinRoom` helpers:

```ts
test('a shortcode is sent as an emoji and reaches the other peer', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const room = await startRoom(host, 'zebra')
  await joinRoom(guest, 'walrus', room)

  await host.getByTestId('chat-input').fill('that was :haha:')
  await host.getByTestId('chat-send').click()

  // Asserted on the GUEST, not the sender: converting on send is what puts the
  // emoji on the wire, so the receiving side is where that actually shows.
  await expect(guest.getByTestId('chat-log')).toContainText('that was 😄')
  await expect(guest.getByTestId('chat-log')).not.toContainText(':haha:')

  await hostContext.close()
  await guestContext.close()
})
```

Match the surrounding tests' setup and teardown style — if they use a shared
helper for creating the two contexts, use it rather than the inline form above.
Chat needs no video, so this test should be quick.

- [ ] **Step 8: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green, lint 0 errors and 0 warnings.

```bash
git add lib/emoji components/ChatComposer.tsx e2e/sync.spec.ts
git commit -m "feat: emoji shortcodes in chat"
```

---

### Task 2: Drag to reorder the queue

The `reorder` intent and its reducer case already exist and are tested — `{type: 'reorder'; trackId: string; toIndex: number}`, with `toIndex` clamped. This task is the UI only.

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`)
- Modify: `components/Queue.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: the existing `reorder` intent
- Produces: `<Queue onReorder />`

- [ ] **Step 1: Install**

```bash
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0
```

Both declare `react >=16.8.0`, so React 19.2.8 is supported.

**Do not consult dndkit.com, and do not trust a docs lookup for "dnd kit".** There are two coexisting generations of this library with incompatible APIs, and the documentation site covers the *other* one:

- **`@dnd-kit/react` (0.x)** — the rewrite. `useSortable` returns `{ref, handleRef, isDragging}`, where `isDragging` is a *function*. This is what dndkit.com documents.
- **`@dnd-kit/core` v6 + `@dnd-kit/sortable` v10** — the stable line, and what this task uses. `useSortable` returns `{attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging}`, where `isDragging` is a boolean.

Following the wrong one produces code that typechecks against nothing and fails at runtime. The API in Step 2 was verified directly against `node_modules/@dnd-kit/sortable/dist/hooks/useSortable.d.ts` — read that file if you need to confirm a name, not the web.

- [ ] **Step 2: Give each row a drag handle**

A dedicated handle, not a draggable row. Two reasons, both load-bearing: the row already carries a remove button, and making the whole row draggable would turn every attempt to press it into a drag; and on a phone the queue sits inside a scrolling panel, so a row-wide drag target would swallow scroll gestures.

Rewrite `components/Queue.tsx`. The `<li>` keeps `data-testid="queue-item"` — `e2e/sync.spec.ts` counts those, and losing it breaks the only end-to-end proof the app works.

```tsx
'use client'

import {DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors} from '@dnd-kit/core'
import type {DragEndEvent} from '@dnd-kit/core'
import {restrictToParentElement, restrictToVerticalAxis} from '@dnd-kit/modifiers'
import {SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {GripVertical, Trash2} from 'lucide-react'
import {formatDuration} from '@/lib/format-duration'
import type {RoomState, Track} from '@/lib/sync/types'

export function Queue({
  state,
  onRemove,
  onReorder,
}: {
  state: RoomState
  onRemove(trackId: string): void
  onReorder(trackId: string, toIndex: number): void
}) {
  const sensors = useSensors(
    // A drag must travel 6px before it starts. Without this the handle
    // swallows taps, and on touch a stationary press would begin a drag
    // instead of letting the panel scroll.
    useSensor(PointerSensor, {activationConstraint: {distance: 6}}),
    useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event
    // `over` is null when a drag is released outside the list.
    if (!over || active.id === over.id) return
    const toIndex = state.queue.findIndex(t => t.id === over.id)
    if (toIndex === -1) return
    onReorder(String(active.id), toIndex)
  }

  if (state.queue.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing queued. Paste a YouTube link above and everyone here will see it.
      </p>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={state.queue.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-[var(--space-1)]" data-testid="queue">
          {state.queue.map(track => (
            <QueueRow
              key={track.id}
              track={track}
              isCurrent={track.id === state.currentTrackId}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function QueueRow({
  track,
  isCurrent,
  onRemove,
}: {
  track: Track
  isCurrent: boolean
  onRemove(trackId: string): void
}) {
  // `setNodeRef` goes on the <li> — the thing that moves. `setActivatorNodeRef`
  // goes on the handle — the thing you grab. Putting the node ref on the button
  // is the usual mistake and makes dnd-kit measure the handle instead of the
  // row, so the drag preview is a 24px sliver and the drop targets are wrong.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({id: track.id})

  return (
    <li
      ref={setNodeRef}
      style={{transform: CSS.Transform.toString(transform), transition}}
      data-testid="queue-item"
      className={`flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] p-[var(--space-2)] ${
        isCurrent ? 'bg-surface-raised' : 'hover:bg-surface'
      } ${isDragging ? 'relative z-10 opacity-80' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${track.title}`}
        // touch-none is required, not cosmetic: without it the browser claims
        // the gesture for scrolling and the drag never starts on a phone.
        className="flex h-11 w-6 shrink-0 touch-none items-center justify-center rounded-[var(--radius-md)] text-subtle hover:text-text cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={16} aria-hidden />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 64x40 decorative thumbnail already served by YouTube's CDN; next/image would add a proxy hop and a layout wrapper to save nothing. */}
      <img
        src={track.thumbnail}
        alt=""
        loading="lazy"
        className="h-10 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{track.title}</p>
        <p className="truncate text-xs text-muted">
          {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
          {track.unplayable && ' · unavailable'}
        </p>
      </div>
      {isCurrent && <span className="shrink-0 text-xs font-medium text-live">playing</span>}
      <button
        onClick={() => onRemove(track.id)}
        aria-label={`Remove ${track.title}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <Trash2 size={16} aria-hidden />
      </button>
    </li>
  )
}
```

- [ ] **Step 3: Install the two remaining packages**

Step 2 also imports `@dnd-kit/modifiers` and `@dnd-kit/utilities`. Both are separate packages, and while `utilities` arrives as a transitive dependency of core, importing it directly means declaring it:

```bash
npm install @dnd-kit/modifiers@^9.0.0 @dnd-kit/utilities@^3.2.2
```

`restrictToVerticalAxis` keeps a row from drifting sideways out of a 380px rail, and `restrictToParentElement` keeps it inside the list.

Fold this into Step 1's install if you prefer a single `npm install`; the split exists only so the reason for each package is stated where it is used.

- [ ] **Step 4: Wire it in `Room.tsx`**

Find the `<Queue>` element and add the handler beside the existing `onRemove`:

```tsx
              <Queue
                state={room.state}
                onRemove={id => room.send({type: 'remove', trackId: id})}
                onReorder={(trackId, toIndex) => room.send({type: 'reorder', trackId, toIndex})}
              />
```

Nothing else in `Room.tsx` changes. `room.send` already applies the intent optimistically and reconciles against the host, so a drag feels instant on a guest and is corrected if the host disagrees.

- [ ] **Step 5: Verify in a browser**

Run `npm run build && npm run start`. Queue three tracks.

- Drag the middle row by its handle to the top with a mouse. The order changes and holds.
- Tab to a handle, press Space, press Arrow Down, press Space. The row moves — dnd-kit's keyboard sensor drives the same code path, and reordering that only works by dragging fails WCAG 2.1 SC 2.1.1.
- Press the remove button on a row. It removes rather than starting a drag.
- At 390px width, drag a row on touch and confirm the panel does not scroll underneath the drag; then scroll the panel by dragging *outside* the handle and confirm scrolling still works.
- Open a second browser as a guest and confirm a reorder in one window lands in the other.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green. The e2e suite counts `queue-item`, so a pass here is also the proof that the test id survived.

```bash
git add package.json package-lock.json components/Queue.tsx components/Room.tsx
git commit -m "feat: drag to reorder the queue"
```

---

### Task 3: Let anyone set their name, especially a link-joiner

The bug: `/r/[code]` renders `<Room>` directly, and `Room` reads the nickname from `localStorage`. Someone who arrives by invite link has never seen the landing page, so nothing is stored, `loadNickname` returns `DEFAULT_NICKNAME`, and they are `friend` to everyone with no way to change it. This is also why "added by" appears broken — the attribution is correct, the name simply never got set.

No sync work: `announceNameRef` already broadcasts on every change of the `name` passed to `useRoom`, and `nameAction` already sends targeted on peer join. This is UI plus one storage helper.

**Files:**
- Modify: `lib/identity.ts`
- Modify: `lib/identity.test.ts`
- Create: `components/NameBadge.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: `loadNickname`, `saveNickname`
- Produces: `hasStoredNickname(storage): boolean`, `<NameBadge name onRename />`

- [ ] **Step 1: Write the failing test**

`loadNickname` cannot currently distinguish "nothing stored" from "stored the word friend", and the difference decides whether to prompt. Add to `lib/identity.test.ts`:

The file already has a `fakeStorage()` helper and seeds it through `saveNickname` rather than writing raw keys — follow that, both to match the surrounding style and because the storage key is a private constant that tests have no business knowing.

```ts
describe('hasStoredNickname', () => {
  it('is false when nothing is stored', () => {
    expect(hasStoredNickname(fakeStorage())).toBe(false)
  })

  it('is false when the stored value is blank', () => {
    const storage = fakeStorage()
    saveNickname(storage, '   ')
    expect(hasStoredNickname(storage)).toBe(false)
  })

  it('is true once a real name is stored', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'zebra')
    expect(hasStoredNickname(storage)).toBe(true)
  })

  // Someone who deliberately typed "friend" has chosen a name, and must not be
  // prompted again every time they open a room. This is the case that makes
  // `hasStoredNickname` a different question from `loadNickname`, rather than a
  // convenience wrapper around it.
  it('is true when the stored value happens to equal the default', () => {
    const storage = fakeStorage()
    saveNickname(storage, DEFAULT_NICKNAME)
    expect(hasStoredNickname(storage)).toBe(true)
  })

  it('is false when storage throws', () => {
    expect(
      hasStoredNickname({
        getItem() {
          throw new Error('blocked')
        },
        setItem() {},
      }),
    ).toBe(false)
  })
})
```

Add `hasStoredNickname` to the existing import on line 2; `DEFAULT_NICKNAME` and `saveNickname` are already imported.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/identity`
Expected: FAIL — `hasStoredNickname` is not exported.

- [ ] **Step 3: Add the helper**

In `lib/identity.ts`, beside `loadNickname`:

```ts
/**
 * Whether the user has ever chosen a name, as distinct from whether they
 * currently have one. `loadNickname` answers the second question and returns
 * the default for both cases, which is what makes it useless for deciding
 * whether to prompt.
 */
export function hasStoredNickname(storage: NicknameStorage): boolean {
  try {
    return normalize(storage.getItem(KEY) ?? '').length > 0
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/identity`
Expected: PASS.

- [ ] **Step 5: Build the badge**

Create `components/NameBadge.tsx`. It displays the current name and swaps to an input when editing, so renaming is available to everyone at all times — not only to a first-time joiner.

```tsx
'use client'

import {useEffect, useRef, useState} from 'react'
import {Check, Pencil} from 'lucide-react'
import {MAX_NICKNAME_LENGTH} from '@/lib/identity'

export function NameBadge({
  name,
  startEditing,
  onRename,
}: {
  name: string
  startEditing: boolean
  onRename(next: string): void
}) {
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    // An empty submission keeps the existing name rather than clearing it —
    // there is no such thing as a nameless peer, and the roster would show a
    // blank chip.
    if (trimmed) onRename(trimmed)
    else setDraft(name)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        data-testid="rename"
        aria-label={`You are ${name}. Change your name`}
        className="flex min-h-11 items-center gap-[var(--space-1)] rounded-[var(--radius-md)] px-[var(--space-2)] text-sm text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <span className="max-w-[12ch] truncate">{name}</span>
        <Pencil size={14} aria-hidden />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-[var(--space-1)]">
      <label className="sr-only" htmlFor="name-badge-input">
        Your name
      </label>
      <input
        id="name-badge-input"
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          else if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
        maxLength={MAX_NICKNAME_LENGTH}
        data-testid="name-input"
        placeholder="Your name"
        className="min-h-11 w-[12ch] rounded-[var(--radius-md)] border border-border-strong bg-surface px-[var(--space-2)] text-sm text-text"
      />
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={commit}
        aria-label="Save name"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
      >
        <Check size={16} aria-hidden />
      </button>
    </div>
  )
}
```

The `onMouseDown` preventDefault on the save button is deliberate: without it, mousing from the input to the button fires `onBlur` first, which commits and unmounts the button before its click ever lands.

Note the label says "Your name" to match the landing page, and is visually hidden because the input sits inline in a crowded bar. The `sr-only` class is a Tailwind built-in.

- [ ] **Step 6: Wire it into `Room.tsx`**

Two changes. First, the mount effect that hydrates the nickname must also record whether one was ever stored:

```tsx
  const [name, setName] = useState('friend')
  const [needsName, setNeedsName] = useState(false)

  useEffect(() => {
    // Reading localStorage must wait until after mount (it doesn't exist on
    // the server), so hydrating the nickname here is unavoidable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(loadNickname(window.localStorage))
    // Someone who arrived by invite link has never seen the landing page, so
    // nothing is stored and they would be "friend" to everyone with no way to
    // change it. Opening the badge in edit mode is the whole fix for that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNeedsName(!hasStoredNickname(window.localStorage))
  }, [])
```

Import `hasStoredNickname` and `saveNickname` alongside the existing `loadNickname`.

Second, render the badge in the rail. Put it directly above `<RoomTabs>`, after the warning banner, so it sits with the room's identity information rather than inside a tab:

```tsx
        <div className="flex shrink-0 items-center justify-between gap-[var(--space-2)] border-b border-border px-[var(--space-3)] py-[var(--space-1)]">
          <span className="text-xs text-subtle">You</span>
          <NameBadge
            name={name}
            startEditing={needsName}
            onRename={next => {
              setName(next)
              saveNickname(window.localStorage, next)
            }}
          />
        </div>
```

`setName` is all that is needed to tell everyone: `useRoom` already watches `name` and broadcasts the change, and the roster rebuilds from it.

- [ ] **Step 7: Verify in a browser**

Run `npm run build && npm run start`.

- In a fresh context with no stored nickname, open a room URL **directly** — the bug's actual path. The badge must already be in edit mode and focused. Type a name, press Enter.
- Open a second context, join the same room by link, set a different name. Each window must show the other's real name in the presence bar and on chat messages, and a track added by either must read "added by <that name>" rather than "added by friend".
- Reload one window. The name persists and no prompt appears.
- Click the name in a settled session, change it, press Enter. The other window updates.
- Press Escape while editing. The old name comes back unchanged.

- [ ] **Step 8: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green, lint 0 errors and 0 warnings.

```bash
git add lib/identity.ts lib/identity.test.ts components/NameBadge.tsx components/Room.tsx
git commit -m "fix: let a link-joiner set their name, and anyone rename"
```

---

## Done when

- Typing `:haha:` in chat sends 😄, and an unknown code like `:wat:` is left alone.
- A queue row can be dragged by its handle to a new position with a mouse, by touch on a phone, and by keyboard — and the new order reaches other peers.
- Removing a track and the "added by" attribution both still work.
- Someone opening an invite link is asked for a name before they are anyone else's "friend", and anyone can rename themselves at any time.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` and `npx playwright test` before calling it finished, plus both token sweeps from the phase 2 plan's Step 3.

**Not in this plan:** host migration, TURN fallback, guest seek, per-peer intent sequence numbers, `role="tablist"` keyboard support, GIF intrinsic dimensions, and an `isRoomState` validator. All are recorded in `docs/known-limitations.md`.
