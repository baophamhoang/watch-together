# Phase 4: empty-player state and chat notification sound — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop showing YouTube's raw error screen when nothing is queued, and play a short sound when a chat message arrives from someone else.

**Architecture:** Both are local UI concerns — no protocol change, no new intent, nothing crosses the wire. The sound is generated with WebAudio rather than shipped as an asset, so there is no network request and nothing to cache.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript, Tailwind 4, Web Audio API.

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md`

## Global Constraints

- Design tokens only. Both sweeps in the phase 2 plan's Step 3 must return clean: colours/radii return nothing, spacing returns only the documented `ChatPanel.tsx` `mt-0.5` exemption. Keep `--include="*.tsx"` quoted or zsh kills the command before grep runs.
- WCAG 2.1 AA: 4.5:1 body text, 3:1 UI boundaries and icons. Interactive targets ≥44px on touch. `cursor-pointer` on clickables. Lucide icons, never emoji-as-icon.
- **Contractual, do not touch:** every `data-testid`, the label "Your name", the buttons "Start a room" and "Join", the `word-word-abcd` placeholder. `e2e/sync.spec.ts` resolves elements by all of them.
- Verify against a production build, never `next dev` — Strict Mode double-invokes effects and races host election.
- `components/Room.tsx` has no unit tests by design; it is covered by e2e.

---

### Task 1: Say what to do when the queue is empty

Reported with a screenshot: an empty room shows YouTube's own `An error occurred. Please try again later. (Playback ID: …)` screen with "Nothing playing" beneath it.

The cause is a phase 2 decision. `TapToWatch` renders whenever the player is not yet activated, *including when there is no track at all*. So an arriving user sees "Tap to watch" over an empty player, taps it, the gate dismisses and calls `handle.play()` on a player with nothing loaded — and YouTube renders its own error. The user is left looking at a failure message for something they never did wrong.

That phase 2 choice was deliberate: keeping the gate up on an empty room meant a user could add a track and have their dismissing tap double as the autoplay-unlocking gesture. This task trades that away. The cost is one extra tap in the empty-room flow — add a track, then tap the gate that now appears. The gain is that the app never shows an error screen for the ordinary state of being new.

**Files:**
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: the existing `PlayerOverlay` in this file
- Produces: nothing new

- [ ] **Step 1: Add the empty-queue overlay and gate the tap prompt on having something to watch**

In `components/Room.tsx`, inside the player shell, after the `localBlock` overlay and before `TapToWatch`:

```tsx
          {!current && !loadError && (
            <PlayerOverlay>
              Nothing queued yet. Paste a YouTube link in the Queue tab and it
              will start here for everyone at once.
            </PlayerOverlay>
          )}
```

Then add `current` to the gate's condition, so it only offers to start something that exists:

```tsx
          {current && !activated && !loadError && !localBlock && (
```

Both overlays are suppressed on `loadError`, which is a harder failure and owns the screen when it happens. `localBlock` cannot coincide with `!current` — it is reset on every track change — so the two new conditions are mutually exclusive by construction rather than by ordering.

- [ ] **Step 2: Verify in a browser**

Run `npm run build && npm run start`, open a room, and confirm with an empty queue: the message is visible, no YouTube error screen appears, and the "Tap to watch" gate is **absent**. Then add a track and confirm the gate appears and dismisses normally, starting playback.

Report what the player area actually showed in the empty state — the text you read, not "the overlay appeared".

- [ ] **Step 3: Commit**

```bash
git add components/Room.tsx
git commit -m "fix: say what to do on an empty queue instead of showing YouTube's error"
```

---

### Task 2: A short sound when someone else sends a chat message

**Files:**
- Create: `lib/sound/notify.ts`
- Create: `lib/sound/notify.test.ts`
- Modify: `components/ChatComposer.tsx`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `playNotification()`, `loadSoundMuted(storage)`, `saveSoundMuted(storage, muted)`, and a `soundToggle` slot on `ChatComposer`

- [ ] **Step 1: Write the failing test**

Only the preference is unit-testable — WebAudio does not exist in jsdom, so `playNotification` is verified in a browser instead. Mirror the shape of `lib/identity.test.ts`, which is the established pattern for a storage-backed preference in this codebase.

Create `lib/sound/notify.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {loadSoundMuted, saveSoundMuted} from './notify'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = {...initial}
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('chat sound preference', () => {
  // Sound is on by default: the user asked for a notification sound, so
  // silence must be something they chose rather than something they inherit.
  it('defaults to unmuted when nothing is stored', () => {
    expect(loadSoundMuted(fakeStorage())).toBe(false)
  })

  it('round-trips muted', () => {
    const storage = fakeStorage()
    saveSoundMuted(storage, true)
    expect(loadSoundMuted(storage)).toBe(true)
  })

  it('round-trips unmuted', () => {
    const storage = fakeStorage()
    saveSoundMuted(storage, true)
    saveSoundMuted(storage, false)
    expect(loadSoundMuted(storage)).toBe(false)
  })

  // Anything unrecognised means "not muted" — a corrupt value should leave a
  // feature working, not silently disable it.
  it('treats an unrecognised value as unmuted', () => {
    expect(loadSoundMuted(fakeStorage({'watch-together:chat-sound': 'banana'}))).toBe(false)
  })

  it('survives storage being unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadSoundMuted(throwing)).toBe(false)
    expect(() => saveSoundMuted(throwing, true)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/sound`
Expected: FAIL — `notify.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `lib/sound/notify.ts`:

```ts
export type SoundStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'watch-together:chat-sound'

export function loadSoundMuted(storage: SoundStorage): boolean {
  try {
    return storage.getItem(KEY) === 'muted'
  } catch {
    // Private browsing and blocked storage both throw. Defaulting to unmuted
    // means a blocked storage costs the preference, not the feature.
    return false
  }
}

export function saveSoundMuted(storage: SoundStorage, muted: boolean): void {
  try {
    storage.setItem(KEY, muted ? 'muted' : 'on')
  } catch {
    // A preference is never worth failing a click over.
  }
}

/**
 * One AudioContext for the page. Browsers cap how many a document may create,
 * and a room can receive hundreds of messages in a sitting.
 */
let ctx: AudioContext | null = null

/**
 * A short two-tone blip, synthesised rather than fetched: no asset, no request,
 * nothing to cache, and no licence to worry about.
 *
 * Never throws. WebAudio is missing in some environments and blocked in others
 * (an AudioContext created before any user gesture starts suspended), and a
 * notification sound failing must never take the chat panel down with it.
 */
export function playNotification(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    // Autoplay policy: a context created before the first gesture starts
    // suspended. By the time a message arrives the user has almost always
    // interacted, so resuming here usually succeeds — and when it doesn't, the
    // rejection is swallowed rather than surfacing as an unhandled rejection.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.setValueAtTime(1175, now + 0.07)
    // Ramped rather than switched: a gain that jumps from 0 to full produces an
    // audible click at the discontinuity. Exponential ramps cannot touch zero,
    // hence the small non-zero endpoints.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.2)
  } catch {
    // See above: cosmetic feature, never load-bearing.
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/sound`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the mute toggle to the composer**

`ChatComposer` already takes a `gifSlot`; add a second slot rather than importing the toggle directly, keeping the composer a layout component that knows nothing about sound.

In `components/ChatComposer.tsx`, extend the props:

```tsx
export function ChatComposer({
  onSend,
  gifSlot,
  soundToggle,
}: {
  onSend(body: string): void
  gifSlot?: React.ReactNode
  soundToggle?: React.ReactNode
}) {
```

and render it immediately before `{gifSlot}`:

```tsx
      {soundToggle}
      {gifSlot}
```

Change nothing else in this file — the `isComposing` guard, the trim checks and every `data-testid` stay exactly as they are.

- [ ] **Step 6: Wire it up in `Room.tsx`**

Add the imports:

```tsx
import {Volume2, VolumeX} from 'lucide-react'
import {loadSoundMuted, playNotification, saveSoundMuted} from '@/lib/sound/notify'
```

Add state beside the existing chat state, following the file's established ref-mirror idiom — `muted` drives the button, `mutedRef` is what the message effect reads, so toggling the preference does not re-run that effect:

```tsx
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)

  useEffect(() => {
    // Same constraint as the nickname: localStorage does not exist on the
    // server, so the stored preference can only be read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(loadSoundMuted(window.localStorage))
  }, [])

  useEffect(() => {
    mutedRef.current = muted
  })
```

Then extend the existing message effect. Keep its comment and its `seenId` logic exactly as they are — only the two new lines are added:

```tsx
  useEffect(() => {
    if (!lastMessageId || lastMessageId === seenId.current) return
    const seenIndex = messages.findIndex(m => m.id === seenId.current)
    const added = messages.length - 1 - seenIndex
    const newest = messages.at(-1)
    seenId.current = lastMessageId
    if (!chatOpen.current) setUnread(u => u + added)
    // Only for other people's messages. A blip on your own send is not a
    // notification, it is your own keystroke echoed back at you.
    if (!mutedRef.current && newest && newest.peerId !== room.selfId) playNotification()
  }, [lastMessageId, messages, room.selfId])
```

Note `room.selfId` joins the dependency array, since the effect now reads it.

Finally pass the toggle into the composer, beside the existing `gifSlot`:

```tsx
                  soundToggle={
                    <button
                      onClick={() => {
                        const next = !muted
                        setMuted(next)
                        saveSoundMuted(window.localStorage, next)
                      }}
                      data-testid="sound-toggle"
                      aria-pressed={muted}
                      aria-label={muted ? 'Turn on message sounds' : 'Turn off message sounds'}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-raised hover:text-text cursor-pointer"
                    >
                      {muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
                    </button>
                  }
```

`aria-pressed` rather than a label that only changes visually: a screen reader user needs the toggle's *state*, not just its icon.

- [ ] **Step 7: Verify in a browser**

Run `npm run build && npm run start` and open the room in two contexts.

- Send a message from context A. **Context B plays a sound; context A does not.** This is the check that matters — a sound on your own send would be the obvious wrong implementation and looks identical in code review.
- Mute in context B, send again from A: silence in B.
- Reload context B: still muted, icon still shows the muted state.
- Unmute, send again: the sound returns.

You cannot hear audio, so verify by instrumenting rather than listening: before sending, patch the context's `AudioContext.prototype.createOscillator` to count calls, then assert the count went up by one in B and stayed flat in A. Say plainly that this is what you did.

- [ ] **Step 8: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green, lint 0 errors and 0 warnings.

```bash
git add lib/sound components/ChatComposer.tsx components/Room.tsx
git commit -m "feat: play a sound when someone else sends a chat message"
```

---

## Done when

- An empty room explains what to do instead of showing YouTube's error screen, and the tap-to-watch gate only appears once there is something to watch.
- A chat message from another peer plays a short sound; your own messages do not.
- The sound can be turned off, and the choice survives a reload.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` and `npx playwright test` before calling it finished, plus both token sweeps from the phase 2 plan's Step 3.

**Not in this plan:** host migration, TURN fallback, guest seek, per-peer intent sequence numbers, `role="tablist"` keyboard support, GIF intrinsic dimensions, and an `isRoomState` validator. All are recorded in `docs/known-limitations.md`.
