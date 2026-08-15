# Phase 5: sync stability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the "resyncing…" thrash between two watchers, and stop a joining peer's own loading from broadcasting play/pause to everyone else.

**Architecture:** Two independent defects in the existing host-authoritative design. Neither needs a new authority — host election already exists and the host never corrects itself. Task 1 stops a peer broadcasting *machine-generated* player events as if they were user intent. Task 2 stops the drift corrector fighting the network.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript, YouTube IFrame API, Trystero.

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md`

## Reference: how boombox handles this

`tinspham209/boombox` (`src/components/app/Player/index.tsx`) is worth understanding before changing ours, because it fails in the opposite direction:

- **No periodic correction at all.** It syncs only on an actual `PLAYING`/`PAUSED` state change, or once when a peer connects.
- **A 5-second tolerance:** `if (timeDiff > 5) seekTo(...)`.
- **A 500ms echo guard** plus a `timestamp` on every sync message, and it drops any incoming sync whose timestamp is older than its own last interaction.

So boombox drifts freely between events but never thrashes. Ours corrects every second against a 0.5s dead zone and oscillates. The lesson is not to copy their design — losing clock-based correction would let peers drift apart indefinitely — but that **the tolerance must exceed the noise floor of the thing being measured**, and 0.5s is far below YouTube's.

## Global Constraints

- Design tokens only. Both sweeps in the phase 2 plan's Step 3 must stay clean, keeping `--include="*.tsx"` quoted or zsh kills the command before grep runs.
- **Contractual, do not touch:** every `data-testid`, the label "Your name", the buttons "Start a room" and "Join", the `word-word-abcd` placeholder.
- `decideCorrection` and `expectedPosition` are pure and already unit-tested in `lib/sync/drift.test.ts`. Everything added to them must be unit-tested there too — this is the one part of the sync layer that can be verified without two browsers and working video.
- **This cannot be fully verified in this environment.** YouTube does not load media here (videos stall at buffering with zero duration), which is exactly the condition both defects need. Unit tests are the real gate; browser checks confirm nothing crashed.
- Verify against a production build, never `next dev`.

---

### Task 1: Stop a peer broadcasting its own loading as user intent

`lib/youtube/use-player.ts` decides whether a state change is user intent using a 700ms timer armed before each programmatic call. A video load is a network fetch and routinely takes longer than that, so the `PLAYING` event caused by our own `load()` arrives after the window closes and is reported as `onUserPlay()` — which `Room.tsx` broadcasts as a `play` intent. A peer joining a paused room un-pauses it for everyone.

Two changes, each closing a different half.

**Files:**
- Modify: `lib/youtube/use-player.ts`
- Modify: `components/Room.tsx`

**Interfaces:**
- Consumes: existing `PlayerEvents`
- Produces: `PlayerHandle.getState()`, returning `'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown'`

- [ ] **Step 1: Make a load suppress until the player settles, not until a timer expires**

In `lib/youtube/use-player.ts`, add a second suppression mechanism beside the existing one. Keep `REMOTE_SUPPRESSION_MS` for `play`/`pause`/`seekTo` — those are local and fast, and a timer is honest for them. A `load` is different in kind: its duration is a network fetch, not a constant.

Add a ref alongside `suppressUntil`:

```ts
  /**
   * A load is pending until the player reports a steady state. Unlike play,
   * pause and seek — which are local and resolve in milliseconds — a load
   * fetches over the network, so no fixed timer is honest for it. The first
   * PLAYING or PAUSED after a load is always the load completing, never a
   * person, and reporting it as intent is how a joining peer un-pauses a room
   * for everyone else.
   */
  const loadSettling = useRef(false)
```

Set it in the handle's `load`:

```ts
            load(videoId, startAtSec) {
              suppress()
              loadSettling.current = true
              playerRef.current?.loadVideoById({videoId, startSeconds: startAtSec})
            },
```

and consume it in `onStateChange`, after the `ENDED` branch and before the timer gate:

```ts
              // Swallow exactly one settling event, then resume normal
              // reporting — the person may genuinely press pause a moment
              // later, and that must still count.
              if (
                loadSettling.current &&
                (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED)
              ) {
                loadSettling.current = false
                return
              }
```

- [ ] **Step 2: Expose the player's state**

Task 2 needs it, and it belongs with the rest of the handle. Add to the `PlayerHandle` type:

```ts
  getState(): PlayerState
```

with, above it:

```ts
export type PlayerState =
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued'
  | 'unknown'
```

and in the `useMemo` that builds the handle:

```ts
            getState() {
              // Numeric literals rather than YT.PlayerState: this runs on every
              // correction tick and the API object is not in scope here.
              switch (playerRef.current?.getPlayerState()) {
                case -1:
                  return 'unstarted'
                case 0:
                  return 'ended'
                case 1:
                  return 'playing'
                case 2:
                  return 'paused'
                case 3:
                  return 'buffering'
                case 5:
                  return 'cued'
                default:
                  return 'unknown'
              }
            },
```

- [ ] **Step 3: Only broadcast intent from a peer whose user has actually acted**

`Room.tsx` has `activated`, set when the user taps the watch gate. Before that tap, this peer's user has expressed no intent at all, so every state change is ours or the network's.

Add a ref beside the existing ones (`sendRef`, `trackIdRef`, `isHostRef`) and mirror it in the same effect that refreshes them:

```ts
  const activatedRef = useRef(false)
```

```ts
    activatedRef.current = activated
```

Then guard both handlers:

```ts
  const onUserPlay = useCallback(() => {
    // Before the gate is tapped this user has expressed no intent, so any
    // state change is the player loading or the sync layer acting. Reporting
    // it would let one person's arrival start or stop the video for the room.
    if (!activatedRef.current) return
    sendRef.current({type: 'play'})
  }, [])

  const onUserPause = useCallback((position: number) => {
    if (!activatedRef.current) return
    sendRef.current({type: 'pause', position})
  }, [])
```

`activated` is declared later in the file than these callbacks; move its `useState` above them rather than reordering the callbacks, and keep the ref-mirror effect where it is.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green, lint 0 errors and 0 warnings.

Then a production build in a browser, two contexts. Media will not play here, so the check is narrow and honest: confirm no console errors, the gate still appears and dismisses, and playback state still replicates when you press the transport controls. Report what you observed; do **not** claim the joiner defect is fixed, because this environment cannot produce it.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube/use-player.ts components/Room.tsx
git commit -m "fix: stop a joining peer's own load from broadcasting as user intent"
```

---

### Task 2: Stop the drift corrector fighting the network

The corrector runs every second and seeks whenever measured drift exceeds 0.5s. It has no idea whether the player is buffering. A seek causes buffering; during buffering `getCurrentTime()` stops advancing while `expectedPosition` keeps running on the wall clock, so drift *grows* — which triggers another seek, which causes more buffering. On any connection that is not fast, a guest cannot win that race, and the "resyncing…" indicator flickers every few seconds forever.

Three changes: don't correct while buffering, widen the tolerance past the noise floor, and back off when corrections are not working.

**Files:**
- Modify: `lib/sync/drift.ts`
- Modify: `lib/sync/drift.test.ts`
- Modify: `lib/sync/use-sync-playback.ts`

**Interfaces:**
- Consumes: `PlayerState` from Task 1
- Produces: `CorrectionInput` gains `playerState` and `consecutiveCorrections`

- [ ] **Step 1: Write the failing tests**

Add to `lib/sync/drift.test.ts`, matching the existing `base` fixture style — extend `base` with the two new fields (`playerState: 'playing'`, `consecutiveCorrections: 0`) so the existing cases keep compiling and keep meaning what they meant.

```ts
describe('decideCorrection — network awareness', () => {
  // The spiral this exists to break: a seek causes buffering, buffering stops
  // `actual` advancing while `expected` keeps running on the clock, so drift
  // grows and triggers another seek. Correcting while buffering measures the
  // network, not the drift.
  it('never corrects while the player is buffering', () => {
    expect(
      decideCorrection({...base, playerState: 'buffering', expected: 100, actual: 0}),
    ).toEqual({kind: 'none'})
  })

  it('never corrects before the player has started', () => {
    expect(
      decideCorrection({...base, playerState: 'unstarted', expected: 100, actual: 0}),
    ).toEqual({kind: 'none'})
  })

  it('still corrects a paused player, which is a legitimate steady state', () => {
    const out = decideCorrection({
      ...base,
      playerState: 'paused',
      isPlaying: false,
      expected: 100,
      actual: 0,
    })
    expect(out.kind).toBe('seek')
  })

  // Each unsuccessful correction doubles the wait. A guest that cannot keep up
  // should give up gracefully rather than seek every three seconds forever.
  it('backs off exponentially while corrections are not landing', () => {
    const at = (consecutiveCorrections: number, sinceMs: number) =>
      decideCorrection({
        ...base,
        consecutiveCorrections,
        expected: 100,
        actual: 0,
        nowLocal: base.nowLocal,
        lastCorrectionAt: base.nowLocal - sinceMs,
      }).kind

    expect(at(0, 3500)).toBe('seek')
    expect(at(1, 3500)).toBe('none')
    expect(at(1, 6500)).toBe('seek')
    expect(at(2, 6500)).toBe('none')
    expect(at(2, 12500)).toBe('seek')
  })

  it('caps the backoff rather than growing without bound', () => {
    const out = decideCorrection({
      ...base,
      consecutiveCorrections: 99,
      expected: 100,
      actual: 0,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS * 2 ** MAX_BACKOFF_STEPS + 500),
    })
    expect(out.kind).toBe('seek')
  })

  // The old dead zone was 0.5s, below YouTube's own reporting granularity, so
  // it fired on noise. A tolerance must exceed the noise floor of the thing it
  // measures.
  it('tolerates drift that is real but not worth a seek', () => {
    expect(decideCorrection({...base, expected: 101, actual: 100}).kind).toBe('none')
  })
})
```

Import `CORRECTION_COOLDOWN_MS` and `MAX_BACKOFF_STEPS` alongside the existing imports.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/sync/drift`
Expected: FAIL — `playerState` and `consecutiveCorrections` are not on `CorrectionInput`.

- [ ] **Step 3: Widen the tolerance and teach the decision about the network**

In `lib/sync/drift.ts`:

```ts
import type {PlayerState} from '@/lib/youtube/use-player'
import type {Beat} from './types'

/**
 * Below this, a difference is not worth a seek. Raised from 0.5s, which sat
 * under YouTube's own reporting granularity and so fired on measurement noise
 * rather than on drift — every correction then caused buffering, which caused
 * more apparent drift, which caused another correction.
 */
export const DEAD_ZONE_S = 1.5
export const RESYNC_S = 3
export const CORRECTION_COOLDOWN_MS = 3000
/** Doubling stops here: 3s, 6s, 12s, 24s. */
export const MAX_BACKOFF_STEPS = 3
export const SEEK_SUPPRESSION_MS = 2000
export const DEFAULT_SEEK_LATENCY_MS = 300

export type CorrectionInput = {
  expected: number
  actual: number
  isPlaying: boolean
  nowLocal: number
  lastCorrectionAt: number | null
  lastSeekAt: number | null
  seekLatencyMs: number
  playerState: PlayerState
  /** Corrections issued since drift was last inside the dead zone. */
  consecutiveCorrections: number
}
```

Then, in `decideCorrection`, before the drift comparison:

```ts
  // Only a settled player can be measured. While buffering, `actual` is frozen
  // and `expected` keeps advancing, so the drift being computed is the
  // network's latency, not the peer's position — and seeking on it makes the
  // buffering worse.
  if (input.playerState !== 'playing' && input.playerState !== 'paused') {
    return {kind: 'none'}
  }
```

and replace the fixed cooldown check with a backing-off one:

```ts
  // Each correction that fails to close the gap doubles the wait. A peer on a
  // slow link cannot win a forward-seek race, and retrying every three seconds
  // forever is the visible symptom the user reported.
  const backoff = CORRECTION_COOLDOWN_MS * 2 ** Math.min(input.consecutiveCorrections, MAX_BACKOFF_STEPS)
  if (since(input.lastCorrectionAt) < backoff) return {kind: 'none'}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/sync/drift`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Track the streak and pass the state**

In `lib/sync/use-sync-playback.ts`, add a ref beside `lastCorrectionAt`:

```ts
  const consecutiveCorrections = useRef(0)
```

Pass both new fields into `decideCorrection`:

```ts
        playerState: handle.getState(),
        consecutiveCorrections: consecutiveCorrections.current,
```

Reset the streak when the gap closes, in the `kind === 'none'` branch — but only when the player is actually settled, so a run of buffering ticks does not look like success:

```ts
      if (correction.kind === 'none') {
        // A settled player inside the dead zone is the definition of caught up.
        // Buffering ticks also return 'none', and must NOT reset the streak —
        // that would restart the doubling every time the network hiccuped and
        // reintroduce the loop this exists to break.
        const settled = handle.getState() === 'playing' || handle.getState() === 'paused'
        if (settled) consecutiveCorrections.current = 0
        setResyncing(false)
        return
      }
```

and increment it beside the other bookkeeping when a seek is issued:

```ts
      consecutiveCorrections.current += 1
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`
Expected: all green, lint 0 errors and 0 warnings.

Browser check, production build, two contexts. Media does not load here, so the honest check is: no console errors, the room still connects, "2 watching" appears on both sides, and the drift interval does not throw. Report what you observed and state plainly that the thrash itself cannot be reproduced in this environment.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/drift.ts lib/sync/drift.test.ts lib/sync/use-sync-playback.ts
git commit -m "fix: stop the drift corrector fighting the network"
```

---

## Done when

- A peer that has not tapped the watch gate never broadcasts play or pause.
- The first `PLAYING` or `PAUSED` after a programmatic load is never reported as user intent.
- No correction is issued while the player is buffering or has not started.
- Repeated unsuccessful corrections back off to 6s, 12s then 24s rather than retrying every 3s forever.
- `lib/sync/drift.test.ts` covers all of the above, including the pre-existing cases unchanged in meaning.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` and `npx playwright test` before calling it finished, plus both token sweeps.

**Verification that must happen outside this environment:** whether the "resyncing…" flicker actually stops, and whether a joining peer stops disturbing others. Both need two real peers with video that plays, which this environment cannot provide.

**Not in this plan:** host migration, TURN fallback, guest seek, per-peer intent sequence numbers, `role="tablist"` keyboard support, GIF intrinsic dimensions, an `isRoomState` validator.
