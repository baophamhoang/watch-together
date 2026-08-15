# Phase 6: room stability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make refreshing a tab harmless. Today a rejoining peer can claim a room that already has a host, which can destroy the real host's queue and can freeze a bystander permanently.

**Architecture:** Three defects in one mechanism. The claim timer is sized below the heartbeat it waits for; the host tie-break ignores which peer actually holds state; and roster/beat are applied with no authority check at all. Fixed in that order, with the untestable parts of the lifecycle extracted into pure functions first so they can be tested at all.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript, Trystero.

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md`

## What the field does, and where we sit

Researched against real source: Syncplay, Jellyfin SyncPlay, CyTube, watchparty, Metastream, Yjs/Automerge, and two Trystero watch-party projects (`Schumipres/cowatch-p2p`, `GuimezDev/pomimochi`).

**Claim timeout against heartbeat** — every real system lands at 2–3×:

| System | Heartbeat | Claim / presume-dead | Ratio |
|---|---|---|---|
| `y-protocols/awareness.js` | 15000ms | 30000ms | 2× |
| `automerge-repo` presence | 15000ms | 45000ms | 3× |
| `cowatch-p2p` (Trystero) | 2000ms | 5000ms | 2.5× |
| **ours** | 2000ms | **1500ms** | **0.75×** |

Nobody real goes below 1×. Trystero's own default `handshakeTimeoutMs` is 10000ms, so 1500ms was aggressive before the heartbeat even entered into it.

**Two patterns we lack, both recurring independently across projects:**

- *Election as a function of confirmed presence, not a timer.* `cowatch-p2p` recomputes the reference peer on every membership change and excludes peers known only via the raw transport join (`joinedAt: 0`) until their application-level `hello` lands. It does not guess a safe timeout; it refuses to count anyone unconfirmed.
- *Epoch/term.* Nothing in the field needs it because no other project tolerates transient dual-authority — they all have exactly one legitimate writer by construction. We are the only architecture with a window where two peers each believe they are host, which is precisely why we need the one thing none of them have.

## Global Constraints

- Design tokens only; both sweeps in the phase 2 plan's Step 3 must stay clean, keeping `--include="*.tsx"` quoted or zsh kills the command before grep runs.
- **Contractual, do not touch:** every `data-testid`, the label "Your name", the buttons "Start a room" and "Join", the `word-word-abcd` placeholder.
- Verify against a production build, never `next dev`.
- **`lib/sync/use-room.ts` has zero unit tests and is where every recent bug has lived.** Every task here that adds logic to it must first extract that logic into a pure module beside its peers, and test it there. Adding untested lines to that file is not acceptable in this phase.

---

### Task 1: Stop a rejoining peer claiming a room that already has a host

**Files:**
- Modify: `lib/sync/constants.ts`
- Create: `lib/sync/claim.ts`
- Create: `lib/sync/claim.test.ts`
- Modify: `lib/sync/use-room.ts`

**Interfaces:**
- Produces: `HOST_CLAIM_MS`, `HOST_CLAIM_WITH_PEERS_MS`, `shouldClaimRoom(input)`

- [ ] **Step 1: Write the failing tests**

Create `lib/sync/claim.test.ts`. The first test is the one that would have caught this bug, and it costs three lines:

```ts
import {describe, expect, it} from 'vitest'
import {BEAT_INTERVAL_MS, HOST_CLAIM_MS, HOST_CLAIM_WITH_PEERS_MS} from './constants'
import {shouldClaimRoom} from './claim'

describe('claim timing invariants', () => {
  // The defect this phase exists to fix: a joiner gave up waiting after 1500ms
  // while the host only announced every 2000ms, so it reliably claimed a room
  // that already had one. Every comparable system sizes this at 2-3x its
  // heartbeat; we were at 0.75x.
  it('waits longer than a full heartbeat before claiming a room with peers in it', () => {
    expect(HOST_CLAIM_WITH_PEERS_MS).toBeGreaterThan(BEAT_INTERVAL_MS * 2)
  })

  it('claims an apparently empty room without waiting for a heartbeat', () => {
    expect(HOST_CLAIM_MS).toBeLessThan(HOST_CLAIM_WITH_PEERS_MS)
  })
})

describe('shouldClaimRoom', () => {
  const base = {isHost: false, sawHost: false, connectedPeers: 0}

  it('claims when alone and nobody has announced', () => {
    expect(shouldClaimRoom(base)).toBe(true)
  })

  it('never claims once a host has announced', () => {
    expect(shouldClaimRoom({...base, sawHost: true})).toBe(false)
  })

  it('never claims when already host', () => {
    expect(shouldClaimRoom({...base, isHost: true})).toBe(false)
  })

  // The rejoin case. Peers are present but none has announced yet — they may
  // still be completing Trystero's handshake, which the library itself allows
  // ten seconds for. Claiming here is what destroyed the room.
  it('does not claim while connected peers have not yet announced', () => {
    expect(shouldClaimRoom({...base, connectedPeers: 1})).toBe(false)
  })

  it('claims once the longer window has elapsed even with peers present', () => {
    expect(shouldClaimRoom({...base, connectedPeers: 1, waitedFullWindow: true})).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run lib/sync/claim`
Expected: FAIL — `claim.ts` does not exist and the constants are missing.

- [ ] **Step 3: Add the constants**

In `lib/sync/constants.ts`, replace the single claim constant:

```ts
/**
 * How long a joiner listens before claiming an *apparently empty* room. Short
 * on purpose: nobody is there to contradict it, and making the first person
 * wait is pure cost.
 */
export const HOST_CLAIM_MS = 1500

/**
 * How long a joiner listens once it can see peers. Must exceed a full beat
 * interval by a wide margin, because the beat is the only thing that tells us a
 * host exists — and the peer may still be completing Trystero's handshake,
 * which the library itself allows 10s for. At 0.75x the beat interval this was
 * 1500ms, and a rejoining peer reliably claimed a room that already had a host.
 * Every comparable system sizes this at 2-3x its heartbeat; this is 2.5x.
 */
export const HOST_CLAIM_WITH_PEERS_MS = 5000
```

- [ ] **Step 4: Write the decision as a pure function**

Create `lib/sync/claim.ts`:

```ts
export type ClaimInput = {
  isHost: boolean
  sawHost: boolean
  /** Peers whose transport connection is up, announced or not. */
  connectedPeers: number
  /** Whether the longer, peers-present window has already elapsed. */
  waitedFullWindow?: boolean
}

/**
 * Whether to promote ourselves to host.
 *
 * Extracted from the effect that used to decide this inline, so the rule can be
 * tested at all — the timing bug this replaces was invisible to every test we
 * had, because nothing could reach the decision.
 */
export function shouldClaimRoom(input: ClaimInput): boolean {
  if (input.isHost || input.sawHost) return false
  // Peers we can see but have not heard from are the rejoin case: they may be
  // mid-handshake, and one of them may be the host. Claiming now is how a
  // refreshed tab takes a room that already had one.
  if (input.connectedPeers > 0 && !input.waitedFullWindow) return false
  return true
}
```

- [ ] **Step 5: Wire it into the effect**

In `lib/sync/use-room.ts`, replace the single `claimTimer` with a rescheduling one. Keep `sawHostRef` and `isHostRef` exactly as they are.

```ts
    let claimTimer: ReturnType<typeof setTimeout>
    const scheduleClaim = (delayMs: number, waitedFullWindow = false) => {
      clearTimeout(claimTimer)
      claimTimer = setTimeout(() => {
        if (
          shouldClaimRoom({
            isHost: isHostRef.current,
            sawHost: sawHostRef.current,
            connectedPeers: joinOrderRef.current.size,
            waitedFullWindow,
          })
        ) {
          promote()
        } else if (!waitedFullWindow) {
          // Peers appeared but none has announced. Give them the full window
          // once, then claim regardless — a room where every peer defers
          // forever is worse than one with a wrongly-chosen host.
          scheduleClaim(HOST_CLAIM_WITH_PEERS_MS, true)
        }
      }, delayMs)
    }
    scheduleClaim(HOST_CLAIM_MS)
```

and in `room.onPeerJoin`, after `joinOrderRef` is updated, restart the wait for a peer that has just appeared:

```ts
      // A peer we have not heard from yet may be the host, still completing its
      // handshake. Restart the wait rather than counting the time it spent
      // connecting against it.
      if (!isHostRef.current && !sawHostRef.current) scheduleClaim(HOST_CLAIM_WITH_PEERS_MS, true)
```

The cleanup already clears `claimTimer`; leave it.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`

```bash
git add lib/sync/constants.ts lib/sync/claim.ts lib/sync/claim.test.ts lib/sync/use-room.ts
git commit -m "fix: stop a rejoining peer claiming a room that already has a host"
```

---

### Task 2: Make a wrong claim harmless

Task 1 makes a false claim rare. This makes it survivable, which matters because the consequences today are severe and silent: the legitimate host wipes its own queue if it loses an arbitrary peer-id comparison, and a bystander can be frozen permanently because an impostor's version counter restarts near zero while theirs is higher.

**Files:**
- Modify: `lib/sync/election.ts`
- Modify: `lib/sync/election.test.ts`
- Modify: `lib/sync/use-room.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/sync/election.test.ts`:

```ts
describe('resolveHostTie', () => {
  // The peer holding the room's actual content must win, whatever its id.
  // Peer id alone is a coin flip with no relationship to legitimacy, and the
  // loser wipes its own state — so the arbitrary half of the time, the real
  // queue was destroyed by the peer that had just arrived with nothing.
  it('keeps the host with more state, regardless of peer id', () => {
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 20, otherVersion: 0})).toBe('keep')
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 0, otherVersion: 20})).toBe('demote')
  })

  it('falls back to peer id when both hold the same amount of state', () => {
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 5, otherVersion: 5})).toBe('keep')
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 5, otherVersion: 5})).toBe('demote')
  })

  // Two empty peers racing in a genuinely new room is the ordinary
  // simultaneous-join case, and must still resolve deterministically.
  it('resolves an empty-room race deterministically', () => {
    expect(resolveHostTie('aaa', 'zzz', {selfVersion: 0, otherVersion: 0})).toBe('keep')
    expect(resolveHostTie('zzz', 'aaa', {selfVersion: 0, otherVersion: 0})).toBe('demote')
  })
})
```

- [ ] **Step 2: Run and watch fail, then widen the signature**

Run: `npx vitest run lib/sync/election` — fails on arity.

In `lib/sync/election.ts`:

```ts
/**
 * Both peers run this on the same pair of inputs and reach opposite verdicts,
 * so a simultaneous-join collision resolves without negotiation.
 *
 * State wins before identity. Peer id is a deterministic tiebreak, not a
 * measure of legitimacy — and because the loser resets its replica to empty,
 * deciding on id alone meant a peer that had just arrived with nothing could
 * destroy a room's entire queue by winning a string comparison.
 */
export function resolveHostTie(
  selfId: string,
  otherHostId: string,
  versions: {selfVersion: number; otherVersion: number},
): 'keep' | 'demote' {
  if (versions.selfVersion !== versions.otherVersion) {
    return versions.selfVersion > versions.otherVersion ? 'keep' : 'demote'
  }
  return selfId < otherHostId ? 'keep' : 'demote'
}
```

- [ ] **Step 3: Pass the versions at the call site**

In `lib/sync/use-room.ts`'s `beatAction.onMessage`, the incoming `Beat` already carries `version` — no wire change is needed:

```ts
        if (
          resolveHostTie(selfId, peerId, {
            selfVersion: confirmedRef.current.version,
            otherVersion: incoming.version,
          }) === 'demote'
        ) {
          demote()
        }
```

- [ ] **Step 4: Gate roster and beat on the host, like state**

Both are currently applied unconditionally. `rosterAction.onMessage` already checks `peerId !== hostIdRef.current`, but `beatAction.onMessage` calls `setBeat(incoming)` with no staleness check at all, so an impostor's beat replaces a real one. Add, immediately before `setBeat`:

```ts
      // A beat from a peer whose replica is behind ours is not a newer truth,
      // it is an impostor mid-election. Playback currently survives this only
      // because the drift corrector happens to bail when the track id does not
      // match what is loaded — luck, in unrelated code, not a guard.
      if (!isHostRef.current && incoming.version < confirmedRef.current.version) return
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test`

```bash
git add lib/sync/election.ts lib/sync/election.test.ts lib/sync/use-room.ts
git commit -m "fix: let the peer holding the room's state win a host tie"
```

---

### Task 3: Test that a refresh does not destroy the room

The tests we had could not have caught any of this: `use-room.ts` has no unit tests, and the entire e2e suite performs one reload, in a single-peer test. Every recent bug has been in the assembly, and nothing tested the assembly.

**Files:**
- Modify: `e2e/sync.spec.ts`

- [ ] **Step 1: Add the refresh suite**

These are slow but they are the only tests that exercise the real lifecycle. No video playback is needed — queue replication is enough, which matters because YouTube does not stream media in CI here.

```ts
test('a guest refreshing does not disturb the room', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const room = await startRoom(host, 'host')
  await joinRoom(guest, 'guest', room)
  await expect(host.getByTestId('status')).toContainText('2 watching')

  await host.getByTestId('add-url').fill(VIDEO_URL)
  await host.getByTestId('add-submit').click()
  await expect(guest.getByTestId('queue-item')).toHaveCount(1)

  await guest.reload()

  // The queue must survive on BOTH sides. The defect this guards against
  // destroyed it on the host, not the peer that refreshed.
  await expect(guest.getByTestId('queue-item')).toHaveCount(1)
  await expect(host.getByTestId('queue-item')).toHaveCount(1)
  await expect(host.getByTestId('status')).toContainText('2 watching')

  await hostContext.close()
  await guestContext.close()
})

test('the room survives repeated guest refreshes', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const room = await startRoom(host, 'host')
  await joinRoom(guest, 'guest', room)
  await host.getByTestId('add-url').fill(VIDEO_URL)
  await host.getByTestId('add-submit').click()
  await expect(guest.getByTestId('queue-item')).toHaveCount(1)

  // Each refresh was an independent coin flip on peer id, so one is a weak
  // test. Three makes a surviving bug overwhelmingly likely to show.
  for (let i = 0; i < 3; i++) {
    await guest.reload()
    await expect(guest.getByTestId('queue-item')).toHaveCount(1)
    await expect(host.getByTestId('queue-item')).toHaveCount(1)
  }

  await hostContext.close()
  await guestContext.close()
})

test('a third peer joining late receives the existing queue', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const laterContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()
  const later = await laterContext.newPage()

  const room = await startRoom(host, 'host')
  await joinRoom(guest, 'guest', room)
  await host.getByTestId('add-url').fill(VIDEO_URL)
  await host.getByTestId('add-submit').click()
  await expect(guest.getByTestId('queue-item')).toHaveCount(1)

  // Nothing in the suite covered a third peer, and a late joiner is the case
  // the claim timer got wrong.
  await joinRoom(later, 'later', room)
  await expect(later.getByTestId('queue-item')).toHaveCount(1)
  await expect(host.getByTestId('status')).toContainText('3 watching')

  await hostContext.close()
  await guestContext.close()
  await laterContext.close()
})
```

- [ ] **Step 2: Confirm they fail before the fixes, if you can**

If Tasks 1 and 2 are already committed, note that and skip. Otherwise `git stash` them, run these three, and report which fail — a regression test that has never been seen red is a guess.

- [ ] **Step 3: Verify and commit**

Run: `npx playwright test`

```bash
git add e2e/sync.spec.ts
git commit -m "test: cover refresh, repeated refresh and late join"
```

---

## Done when

- A joiner never claims a room while peers it has not heard from are present, until a window well past a full heartbeat has passed.
- A host tie is won by the peer holding more state; peer id decides only a genuine draw.
- A beat from a peer with an older replica is ignored rather than applied.
- Refreshing a guest — once, or three times — leaves the queue intact on every peer.
- A third peer joining late receives the queue.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` and `npx playwright test`, plus both token sweeps.

**Deliberately deferred, and recorded in `docs/known-limitations.md`:**

- **Epoch/term numbers.** The research surfaced a worse latent failure than the reported one: after any host transition where the successor's replica is older than a bystander's, `shouldAcceptState`'s strict `>` freezes that bystander permanently — it can never accept state from the room again. Tasks 1 and 2 make the impostor case rare and survivable, but the general fix is an epoch that increments on every host transition, with replication gated on `(epoch, version)`. That is a wire-format change and deserves its own phase.
- **Stable identity across refresh.** A refreshed peer gets a brand-new Trystero id and is indistinguishable from a stranger, which is why any refresh triggers an election at all. Metastream persists a keypair; we could persist a peer id.
- **Muted-autoplay fallback on mobile.** watchparty auto-plays muted (browsers permit this without a gesture) and shows an unmute prompt, rather than blocking the player behind a tap. Likely improves the reported "phone cannot start the video" symptom independently of the election fix.
- **Two-phase snapshot.** CyTube, watchparty and Jellyfin all re-send state once the receiver's player signals ready; we send once on join with no readiness barrier.
- Host migration, TURN fallback, guest seek, per-peer intent sequence numbers, `role="tablist"` keyboard support, GIF intrinsic dimensions, `isRoomState` validator.
