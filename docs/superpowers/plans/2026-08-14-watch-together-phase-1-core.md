# Watch Together — Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people open the same link and watch the same YouTube video in lockstep, with a shared queue anyone can add to by pasting a URL.

**Architecture:** Peers connect directly over WebRTC via Trystero (Nostr signaling); no realtime backend. One peer is the host and owns canonical room state — guests send intents and apply them optimistically, then reconcile against the host's versioned broadcasts. The host emits a heartbeat every 2s; guests estimate their clock offset from it NTP-style and correct drift with a lead-compensated seek. Next.js route handlers exist only to proxy keyless YouTube metadata.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2, TypeScript, Tailwind 4, Trystero 0.25.x, Vitest, Playwright, Chrome MCP.

**Spec:** `docs/superpowers/specs/2026-08-14-watch-together-design.md`

## Verification layers

Three layers, each covering what the one below cannot:

1. **Vitest** — every pure module. Fast, deterministic, no network.
2. **Playwright** — peers connect, queue replicates, skip propagates. Cannot read playback position: the YouTube iframe is cross-origin.
3. **Chrome MCP** — drives two real tabs and reads each peer's *actual* playback position through a dev-only instrumentation hook, which is the only way to prove the core claim that both are at the same point in the video.

Tasks with a **Chrome MCP verification** step are not complete until it passes. Before calling any `mcp__claude-in-chrome__*` tool, load the schemas in ONE ToolSearch call:

```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__tabs_close_mcp
```

Call `tabs_context_mcp` first to see existing tabs, then `tabs_create_mcp` for new ones — never reuse a tab id from an earlier session. Do not trigger `alert`/`confirm` dialogs; they block the extension. If a browser step fails 2-3 times, stop and report rather than retrying blindly.

> **Prefer navigating a tab away over closing it.** During Task 10, `tabs_close_mcp` correlated with a tab-group session reset five separate times, each one orphaning tabs that no tool could then reach. To "remove" a peer from a room, navigate that tab to the app's own landing page (`http://localhost:3000/`) instead — the room component unmounts and the peer leaves exactly as a close would, without risking the reset. Note the `navigate` tool **rejects `about:blank`**, so use the landing page rather than a blank page; it also keeps the request local instead of reaching an external site. Close tabs only at the very end of a check, and if the group resets anyway, do not fight it: report the orphaned tab ids so a human can close them.

> **Drive a production build, not `npm run dev`.** Use `npm run build && npm run start` for every browser verification. React Strict Mode double-invokes effects in development — mount, unmount, mount — and Trystero caches rooms by app id and room id while `leave()` tears down asynchronously. The phantom mount's teardown therefore races the surviving mount's `joinRoom()`, and the two can share a room mid-teardown. In dev this shows up intermittently as both tabs believing they are host, which is a ghost, not a defect in the code under test. A production build does not double-mount and is what users actually run. Discovered during Task 10.

> **Console capture starts late — reload before trusting it.** `read_console_messages` only records from the moment it is *first called on that tab*. Navigate, then call it once (with any pattern) purely to begin tracking, then reload the page and do the actual work. Skip that and every error thrown during page load is invisible, and the check reports a clean console that was never observed — a false pass, which is worse than no check. Verified against the live extension on 2026-08-14.

## Global Constraints

- Next.js `16.3.1`, React `19.2.8`, Tailwind `4` — already installed, do not upgrade.
- Package manager is **npm** (repo has `package-lock.json`).
- **No YouTube Data API key anywhere.** Metadata comes only from the keyless `youtube.com/oembed` endpoint and the IFrame Player API.
- **No YouTube player wrapper library.** Use the official IFrame Player API directly.
- Everything under `lib/sync/` **except** the two React hooks (`use-room.ts`, `use-sync-playback.ts`) must be pure — no I/O, no React, no `Date.now()` passed implicitly (time is always a parameter). The hooks are the only impure modules there: `use-room.ts` owns the network, `use-sync-playback.ts` owns the correction timer. Everything they orchestrate — the reducer, the clock estimator, the drift ladder, election, pending expiry — stays pure and directly testable.
- Components never import `trystero` directly; they consume `useRoom()`.
- Queue identity is a per-entry `uuid`, never the YouTube video id. The same video may be queued twice.
- Drift constants are exact: dead zone `0.5s`, resync indicator above `2s`, correction cooldown `3000ms`, post-seek suppression `2000ms`.
- Host clock is the only authority for `positionAt` and `addedAt`.
- Never call `setPlaybackRate` for drift correction — the IFrame API rounds unsupported rates toward 1.0, making it a silent no-op.

---

### Task 1: Test harness + YouTube URL parser

The reference app's single brittle regex is the thing that most visibly fails. This task sets up Vitest and replaces that regex with an explicit, heavily-tested parser.

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/youtube/parse-url.ts`
- Create: `lib/youtube/parse-url.test.ts`
- Modify: `package.json` (add `test` scripts, devDependencies)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `parseYouTubeUrl(input: string): {videoId: string; startAtSec: number}`, throws `InvalidYouTubeUrlError`. Also `parseTimeParam(raw: string | null): number`.

- [ ] **Step 1: Install test tooling**

```bash
npm install -D vitest@^4 @types/youtube
```

- [ ] **Step 2: Create `vitest.config.mts`**

The `.mts` extension matters: this project's `package.json` has no `"type": "module"`, so a `.ts` config is loaded as CommonJS and Vite's native config loader warns on **every** test run. A permanently noisy baseline is not acceptable in a project whose later Chrome MCP checks judge success partly by an empty console. For the same reason the alias uses `import.meta.dirname` — `__dirname` does not exist under the ESM loader, so copying it here would silently break `@` path resolution.

```ts
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {environment: 'node', include: ['lib/**/*.test.ts', 'app/**/*.test.ts']},
  resolve: {alias: {'@': import.meta.dirname}},
})
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to the `"scripts"` object:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

Create `lib/youtube/parse-url.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {InvalidYouTubeUrlError, parseTimeParam, parseYouTubeUrl} from './parse-url'

describe('parseYouTubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (input, expected) => {
    expect(parseYouTubeUrl(input).videoId).toBe(expected)
  })

  it('keeps the id when a playlist context is attached', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=4'
    expect(parseYouTubeUrl(url).videoId).toBe('dQw4w9WgXcQ')
  })

  it('reads a plain-seconds timestamp', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42').startAtSec).toBe(42)
  })

  it('reads an h/m/s timestamp', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s'
    expect(parseYouTubeUrl(url).startAtSec).toBe(3723)
  })

  it('defaults the timestamp to zero', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ').startAtSec).toBe(0)
  })

  it.each([
    'https://www.youtube.com/watch?v=tooshort',
    'https://vimeo.com/12345678901',
    'https://www.youtube.com/',
    'not a url at all',
    '',
  ])('rejects %s', input => {
    expect(() => parseYouTubeUrl(input)).toThrow(InvalidYouTubeUrlError)
  })
})

describe('parseTimeParam', () => {
  it('returns 0 for null', () => expect(parseTimeParam(null)).toBe(0))
  it('returns 0 for junk', () => expect(parseTimeParam('banana')).toBe(0))
  it('parses bare seconds', () => expect(parseTimeParam('90')).toBe(90))
  it('parses 90s', () => expect(parseTimeParam('90s')).toBe(90))
  it('parses 1m30s', () => expect(parseTimeParam('1m30s')).toBe(90))
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- parse-url`
Expected: FAIL — cannot resolve `./parse-url`.

- [ ] **Step 6: Write the implementation**

Create `lib/youtube/parse-url.ts`:

```ts
export type ParsedVideo = {videoId: string; startAtSec: number}

export class InvalidYouTubeUrlError extends Error {
  constructor(input: string) {
    super(`Not a recognizable YouTube video URL: ${input}`)
    this.name = 'InvalidYouTubeUrlError'
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PATH_FORMS = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/
const HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com'])

export function parseTimeParam(raw: string | null): number {
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match || !match.slice(1).some(Boolean)) return 0
  const [h, m, s] = match.slice(1).map(v => Number(v ?? 0) || 0)
  return h * 3600 + m * 60 + s
}

export function parseYouTubeUrl(input: string): ParsedVideo {
  const trimmed = input.trim()
  if (!trimmed) throw new InvalidYouTubeUrlError(input)

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new InvalidYouTubeUrlError(input)
  }

  const host = url.hostname.replace(/^www\./, '')
  let videoId: string | null = null

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] || null
  } else if (HOSTS.has(host)) {
    videoId = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : (url.pathname.match(PATH_FORMS)?.[1] ?? null)
  }

  if (!videoId || !VIDEO_ID.test(videoId)) throw new InvalidYouTubeUrlError(input)
  return {videoId, startAtSec: parseTimeParam(url.searchParams.get('t'))}
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- parse-url`
Expected: PASS, all cases green.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.mts package.json package-lock.json lib/youtube/parse-url.ts lib/youtube/parse-url.test.ts
git commit -m "feat: YouTube URL parser with vitest harness"
```

---

### Task 2: Room codes

The room code is the invite. It must be readable aloud, safe in a URL, and have enough entropy that a stranger sweeping the relay cannot stumble into a room.

**Files:**
- Create: `lib/room-code.ts`
- Create: `lib/room-code.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `generateRoomCode(random?: () => number): string`, `isValidRoomCode(code: string): boolean`. Format is `adjective-noun-xxxx` where the suffix is 4 characters of an unambiguous base32 alphabet.

- [ ] **Step 1: Write the failing test**

Create `lib/room-code.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {generateRoomCode, isValidRoomCode} from './room-code'

describe('generateRoomCode', () => {
  it('produces a code that validates', () => {
    expect(isValidRoomCode(generateRoomCode())).toBe(true)
  })

  it('produces the adjective-noun-suffix shape', () => {
    expect(generateRoomCode()).toMatch(/^[a-z]+-[a-z]+-[0-9a-z]{4}$/)
  })

  it('is deterministic given a seeded random source', () => {
    const always = () => 0
    expect(generateRoomCode(always)).toBe(generateRoomCode(always))
  })

  it('varies across calls', () => {
    const codes = new Set(Array.from({length: 50}, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(45)
  })

  it('still produces a valid code when random() returns its exclusive bound', () => {
    expect(isValidRoomCode(generateRoomCode(() => 1))).toBe(true)
  })
})

describe('isValidRoomCode', () => {
  it.each(['ember-otter-k7qm', 'quiet-lantern-2b9x'])('accepts %s', code => {
    expect(isValidRoomCode(code)).toBe(true)
  })

  it.each([
    'ember-otter',
    'ember-otter-k7q',
    'ember-otter-k7qmm',
    'Ember-Otter-k7qm',
    'ember otter k7qm',
    '../../etc/passwd',
    '',
  ])('rejects %s', code => {
    expect(isValidRoomCode(code)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- room-code`
Expected: FAIL — cannot resolve `./room-code`.

- [ ] **Step 3: Write the implementation**

Create `lib/room-code.ts`. The alphabet omits `i`, `l`, `o`, `0`, and `1` so codes survive being read aloud.

```ts
const ADJECTIVES = [
  'amber', 'ancient', 'autumn', 'blue', 'bold', 'brave', 'bright', 'calm',
  'cosmic', 'crimson', 'crisp', 'dawn', 'deep', 'drifting', 'dusty', 'eager',
  'ember', 'fading', 'floating', 'frosty', 'gentle', 'gilded', 'golden', 'grand',
  'hidden', 'humble', 'idle', 'jolly', 'keen', 'late', 'lively', 'lucky',
  'lunar', 'misty', 'moonlit', 'noble', 'ocean', 'patient', 'plucky', 'polar',
  'proud', 'quiet', 'rapid', 'restless', 'rising', 'rustic', 'scarlet', 'shy',
  'silent', 'silver', 'sleepy', 'small', 'snowy', 'solar', 'spry', 'still',
  'summer', 'sunny', 'tidal', 'twilight', 'velvet', 'wandering', 'wild', 'winter',
] as const

const NOUNS = [
  'anchor', 'arrow', 'badger', 'beacon', 'bison', 'brook', 'canyon', 'cedar',
  'cinder', 'comet', 'coral', 'cove', 'crane', 'dune', 'eagle', 'ember',
  'falcon', 'fern', 'forest', 'fox', 'garden', 'glacier', 'harbor', 'hawk',
  'heron', 'island', 'jungle', 'kestrel', 'lantern', 'ledge', 'lynx', 'maple',
  'meadow', 'meteor', 'moth', 'otter', 'owl', 'pine', 'prairie', 'quartz',
  'raven', 'reef', 'ridge', 'river', 'robin', 'sable', 'sparrow', 'spruce',
  'stone', 'stream', 'summit', 'thicket', 'thistle', 'tiger', 'trail', 'tundra',
  'valley', 'vireo', 'walrus', 'willow', 'wolf', 'wren', 'yarrow', 'zephyr',
] as const

const SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
const SUFFIX_LENGTH = 4
const CODE_PATTERN = new RegExp(
  `^[a-z]+-[a-z]+-[${SUFFIX_ALPHABET}]{${SUFFIX_LENGTH}}$`,
)

// Clamped because `random` is an injected parameter: a caller supplying a
// PRNG that can return exactly 1 (a common rounding bug in hand-rolled
// generators) would otherwise index past the end and stringify `undefined`
// into the code, producing a code that fails its own validator.
function pick<T>(list: readonly T[], random: () => number): T {
  const index = Math.floor(random() * list.length)
  return list[Math.min(Math.max(index, 0), list.length - 1)]
}

export function generateRoomCode(random: () => number = Math.random): string {
  const suffix = Array.from({length: SUFFIX_LENGTH}, () =>
    pick(SUFFIX_ALPHABET.split(''), random),
  ).join('')
  return `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}-${suffix}`
}

export function isValidRoomCode(code: string): boolean {
  if (!CODE_PATTERN.test(code)) return false
  const [adjective, noun] = code.split('-')
  return (ADJECTIVES as readonly string[]).includes(adjective)
    && (NOUNS as readonly string[]).includes(noun)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- room-code`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/room-code.ts lib/room-code.test.ts
git commit -m "feat: readable room code generation and validation"
```

---

### Task 3: Sync types and the room reducer

The single most important pure module. Every state change in the room goes through `applyIntent`, which is what makes the host authoritative and the whole thing testable without a network.

**Files:**
- Create: `lib/sync/types.ts`
- Create: `lib/sync/room-reducer.ts`
- Create: `lib/sync/room-reducer.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: types `Track`, `RoomState`, `Intent`, `RosterEntry`; `emptyRoomState(): RoomState`; `applyIntent(state: RoomState, intent: Intent, now: number): RoomState`. `now` is host-clock milliseconds and is always passed in, never read from the clock inside.

- [ ] **Step 1: Write the type module**

Create `lib/sync/types.ts`:

```ts
export type Unplayable = 'embed-blocked' | 'not-found'

export type Track = {
  id: string
  videoId: string
  title: string
  author: string
  thumbnail: string
  durationSec: number | null
  startAtSec: number
  addedBy: {peerId: string; name: string}
  addedAt: number
  unplayable?: Unplayable
}

export type RoomState = {
  version: number
  queue: Track[]
  currentTrackId: string | null
  isPlaying: boolean
  position: number
  positionAt: number
}

export type Intent =
  | {type: 'play'}
  | {type: 'pause'; position: number}
  | {type: 'seek'; position: number}
  | {type: 'skip'}
  | {type: 'enqueue'; track: Track}
  | {type: 'remove'; trackId: string}
  | {type: 'reorder'; trackId: string; toIndex: number}
  | {type: 'ended'; trackId: string}
  | {type: 'unplayable'; trackId: string; reason: Unplayable}

export type RosterEntry = {peerId: string; name: string; joinOrder: number}

export type Beat = {
  version: number
  currentTrackId: string | null
  isPlaying: boolean
  position: number
  hostClock: number
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/sync/room-reducer.test.ts`:

```ts
import {beforeEach, describe, expect, it} from 'vitest'
import {applyIntent, emptyRoomState} from './room-reducer'
import type {RoomState, Track} from './types'

const track = (id: string, startAtSec = 0): Track => ({
  id,
  videoId: `vid${id}`,
  title: `Title ${id}`,
  author: 'Author',
  thumbnail: 'https://example.test/t.jpg',
  durationSec: 100,
  startAtSec,
  addedBy: {peerId: 'p1', name: 'bao'},
  addedAt: 1000,
})

const withQueue = (ids: string[], current: string | null): RoomState => ({
  ...emptyRoomState(),
  queue: ids.map(id => track(id)),
  currentTrackId: current,
})

describe('applyIntent', () => {
  let state: RoomState

  beforeEach(() => {
    state = emptyRoomState()
  })

  it('bumps version on every change', () => {
    const next = applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    expect(next.version).toBe(state.version + 1)
  })

  it('does not mutate the input state', () => {
    applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    expect(state.queue).toHaveLength(0)
  })

  it('starts playing the first enqueued track at its start offset', () => {
    const next = applyIntent(state, {type: 'enqueue', track: track('a', 30)}, 5000)
    expect(next.currentTrackId).toBe('a')
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(30)
    expect(next.positionAt).toBe(5000)
  })

  it('appends without disturbing playback when a track is already current', () => {
    const first = applyIntent(state, {type: 'enqueue', track: track('a')}, 5000)
    const next = applyIntent(first, {type: 'enqueue', track: track('b')}, 6000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('allows the same video to be queued twice as distinct entries', () => {
    const a = {...track('a'), videoId: 'same'}
    const b = {...track('b'), videoId: 'same'}
    let next = applyIntent(state, {type: 'enqueue', track: a}, 5000)
    next = applyIntent(next, {type: 'enqueue', track: b}, 5001)
    expect(next.queue).toHaveLength(2)
  })

  it('records position and stops the clock on pause', () => {
    const next = applyIntent(withQueue(['a'], 'a'), {type: 'pause', position: 12.5}, 9000)
    expect(next.isPlaying).toBe(false)
    expect(next.position).toBe(12.5)
    expect(next.positionAt).toBe(9000)
  })

  it('restarts the clock on play without moving position', () => {
    const paused = applyIntent(withQueue(['a'], 'a'), {type: 'pause', position: 12.5}, 9000)
    const next = applyIntent(paused, {type: 'play'}, 11000)
    expect(next.isPlaying).toBe(true)
    expect(next.position).toBe(12.5)
    expect(next.positionAt).toBe(11000)
  })

  it('moves to the next track on skip', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'skip'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.position).toBe(0)
  })

  it('wraps to the first track when skipping the last', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'b'), {type: 'skip'}, 9000)
    expect(next.currentTrackId).toBe('a')
  })

  it('advances on ended only for the current track', () => {
    const base = withQueue(['a', 'b'], 'a')
    expect(applyIntent(base, {type: 'ended', trackId: 'b'}, 9000)).toBe(base)
    expect(applyIntent(base, {type: 'ended', trackId: 'a'}, 9000).currentTrackId).toBe('b')
  })

  it('advances then removes when the current track is removed', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'remove', trackId: 'a'}, 9000)
    expect(next.currentTrackId).toBe('b')
    expect(next.queue.map(t => t.id)).toEqual(['b'])
  })

  it('empties the room when the last track is removed', () => {
    const next = applyIntent(withQueue(['a'], 'a'), {type: 'remove', trackId: 'a'}, 9000)
    expect(next.queue).toHaveLength(0)
    expect(next.currentTrackId).toBeNull()
    expect(next.isPlaying).toBe(false)
    expect(next.position).toBe(0)
  })

  it('leaves playback alone when removing a non-current track', () => {
    const next = applyIntent(withQueue(['a', 'b'], 'a'), {type: 'remove', trackId: 'b'}, 9000)
    expect(next.currentTrackId).toBe('a')
    expect(next.queue.map(t => t.id)).toEqual(['a'])
  })

  it('reorders a track to a new index', () => {
    const next = applyIntent(
      withQueue(['a', 'b', 'c'], 'a'),
      {type: 'reorder', trackId: 'c', toIndex: 0},
      9000,
    )
    expect(next.queue.map(t => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('clamps an out-of-range reorder index', () => {
    const next = applyIntent(
      withQueue(['a', 'b'], 'a'),
      {type: 'reorder', trackId: 'a', toIndex: 99},
      9000,
    )
    expect(next.queue.map(t => t.id)).toEqual(['b', 'a'])
  })

  it('marks a track unplayable and skips past it when it is current', () => {
    const next = applyIntent(
      withQueue(['a', 'b'], 'a'),
      {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'},
      9000,
    )
    expect(next.queue[0].unplayable).toBe('embed-blocked')
    expect(next.currentTrackId).toBe('b')
  })

  it('stops playback when the only track is marked unplayable', () => {
    const next = applyIntent(
      withQueue(['a'], 'a'),
      {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'},
      9000,
    )
    expect(next.queue[0].unplayable).toBe('embed-blocked')
    expect(next.isPlaying).toBe(false)
  })

  it('skips over already-unplayable tracks instead of looping', () => {
    let state = withQueue(['a', 'b', 'c'], 'a')
    state = applyIntent(state, {type: 'unplayable', trackId: 'b', reason: 'embed-blocked'}, 9000)
    const next = applyIntent(state, {type: 'unplayable', trackId: 'a', reason: 'embed-blocked'}, 9500)
    expect(next.currentTrackId).toBe('c')
  })

  it('ignores intents referencing unknown tracks', () => {
    const base = withQueue(['a'], 'a')
    expect(applyIntent(base, {type: 'remove', trackId: 'ghost'}, 9000)).toBe(base)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- room-reducer`
Expected: FAIL — cannot resolve `./room-reducer`.

- [ ] **Step 4: Write the implementation**

Create `lib/sync/room-reducer.ts`:

```ts
import type {Intent, RoomState, Track} from './types'

export function emptyRoomState(): RoomState {
  return {
    version: 0,
    queue: [],
    currentTrackId: null,
    isPlaying: false,
    position: 0,
    positionAt: 0,
  }
}

function nextTrackId(queue: Track[], currentId: string | null): string | null {
  if (queue.length === 0) return null
  const index = queue.findIndex(t => t.id === currentId)
  if (index === -1) return queue[0].id
  return queue[(index + 1) % queue.length].id
}

/** Next track not already known-unplayable, or null when none remain. */
function nextPlayableTrackId(queue: Track[], currentId: string | null): string | null {
  if (queue.length === 0) return null
  const start = queue.findIndex(t => t.id === currentId)
  for (let step = 1; step <= queue.length; step++) {
    const candidate = queue[(start + step) % queue.length]
    if (!candidate.unplayable) return candidate.id
  }
  return null
}

function startTrack(state: RoomState, trackId: string | null, now: number): RoomState {
  const track = state.queue.find(t => t.id === trackId)
  return {
    ...state,
    currentTrackId: trackId,
    position: track?.startAtSec ?? 0,
    positionAt: now,
    isPlaying: trackId !== null,
  }
}

export function applyIntent(state: RoomState, intent: Intent, now: number): RoomState {
  const bump = (next: Omit<RoomState, 'version'>): RoomState =>
    ({...next, version: state.version + 1})

  switch (intent.type) {
    case 'enqueue': {
      const queue = [...state.queue, intent.track]
      const isFirst = state.currentTrackId === null
      return bump(isFirst
        ? startTrack({...state, queue}, intent.track.id, now)
        : {...state, queue})
    }

    case 'play':
      if (state.currentTrackId === null) return state
      return bump({...state, isPlaying: true, positionAt: now})

    case 'pause':
      if (state.currentTrackId === null) return state
      return bump({...state, isPlaying: false, position: intent.position, positionAt: now})

    case 'seek':
      if (state.currentTrackId === null) return state
      return bump({...state, position: intent.position, positionAt: now})

    case 'skip':
      if (state.currentTrackId === null) return state
      return bump(startTrack(state, nextTrackId(state.queue, state.currentTrackId), now))

    case 'ended':
      if (intent.trackId !== state.currentTrackId) return state
      return bump(startTrack(state, nextTrackId(state.queue, state.currentTrackId), now))

    case 'remove': {
      if (!state.queue.some(t => t.id === intent.trackId)) return state
      const isCurrent = intent.trackId === state.currentTrackId
      const advanced = isCurrent
        ? startTrack(state, nextTrackId(state.queue, state.currentTrackId), now)
        : state
      const queue = advanced.queue.filter(t => t.id !== intent.trackId)
      if (queue.length === 0) return bump(emptyRoomState())
      const currentTrackId = advanced.currentTrackId === intent.trackId
        ? queue[0].id
        : advanced.currentTrackId
      return bump({...advanced, queue, currentTrackId})
    }

    case 'reorder': {
      const from = state.queue.findIndex(t => t.id === intent.trackId)
      if (from === -1) return state
      const queue = [...state.queue]
      const [moved] = queue.splice(from, 1)
      const to = Math.max(0, Math.min(intent.toIndex, queue.length))
      queue.splice(to, 0, moved)
      return bump({...state, queue})
    }

    case 'unplayable': {
      if (!state.queue.some(t => t.id === intent.trackId)) return state
      const queue = state.queue.map(t =>
        t.id === intent.trackId ? {...t, unplayable: intent.reason} : t)
      const marked = {...state, queue}
      if (intent.trackId !== state.currentTrackId) return bump(marked)
      const next = nextPlayableTrackId(queue, state.currentTrackId)
      // Nothing left that can play. Stop, rather than restarting a track we
      // already know errors — the player would fail again, send another
      // `unplayable`, and spin, re-broadcasting state to every peer each pass.
      if (next === null) return bump({...marked, isPlaying: false})
      return bump(startTrack(marked, next, now))
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- room-reducer`
Expected: PASS, all cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/types.ts lib/sync/room-reducer.ts lib/sync/room-reducer.test.ts
git commit -m "feat: room state types and authoritative intent reducer"
```

---

### Task 4: Clock offset estimation

Guests cannot compare their playback position to the host's without knowing how far apart their clocks are. This is the NTP-style estimator that makes drift measurable at all.

**Files:**
- Create: `lib/sync/clock.ts`
- Create: `lib/sync/clock.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `makeSample(t0, hostClock, t2): ClockSample`, `pushSample(window, sample, max?): ClockSample[]`, `bestOffset(window): number | null`, constant `CLOCK_WINDOW = 5`.

- [ ] **Step 1: Write the failing test**

Create `lib/sync/clock.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {bestOffset, CLOCK_WINDOW, makeSample, pushSample} from './clock'

describe('makeSample', () => {
  it('computes zero offset for symmetric delay and matched clocks', () => {
    // sent at 1000, host replied with 1050, received at 1100
    expect(makeSample(1000, 1050, 1100).offsetMs).toBe(0)
  })

  it('computes a positive offset when the host clock runs ahead', () => {
    expect(makeSample(1000, 6050, 1100).offsetMs).toBe(5000)
  })

  it('records the round trip', () => {
    expect(makeSample(1000, 1050, 1100).rttMs).toBe(100)
  })
})

describe('pushSample', () => {
  it('keeps only the most recent samples', () => {
    let window = [] as ReturnType<typeof makeSample>[]
    for (let i = 0; i < 8; i++) window = pushSample(window, makeSample(i, i, i + 2))
    expect(window).toHaveLength(CLOCK_WINDOW)
  })
})

describe('bestOffset', () => {
  it('returns null for an empty window', () => {
    expect(bestOffset([])).toBeNull()
  })

  it('prefers the sample with the lowest round trip', () => {
    const window = [
      {offsetMs: 900, rttMs: 400},
      {offsetMs: 100, rttMs: 20},
      {offsetMs: 700, rttMs: 250},
    ]
    expect(bestOffset(window)).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sync/clock`
Expected: FAIL — cannot resolve `./clock`.

- [ ] **Step 3: Write the implementation**

Create `lib/sync/clock.ts`:

```ts
export type ClockSample = {offsetMs: number; rttMs: number}

export const CLOCK_WINDOW = 5

/**
 * NTP-style offset: assumes the request and response legs took equal time,
 * so the host's clock at the midpoint of the round trip is comparable to ours.
 */
export function makeSample(t0: number, hostClock: number, t2: number): ClockSample {
  return {offsetMs: hostClock - (t0 + t2) / 2, rttMs: t2 - t0}
}

export function pushSample(
  window: ClockSample[],
  sample: ClockSample,
  max: number = CLOCK_WINDOW,
): ClockSample[] {
  return [...window, sample].slice(-max)
}

/** The lowest-RTT sample carries the least asymmetric-delay error. */
export function bestOffset(window: ClockSample[]): number | null {
  if (window.length === 0) return null
  return window.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sync/clock`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/clock.ts lib/sync/clock.test.ts
git commit -m "feat: NTP-style clock offset estimation"
```

---

### Task 5: Drift correction

The heart of the product claim. Note the constraint: rate nudging is not an option, so correction is a lead-compensated seek guarded against oscillation.

**Files:**
- Create: `lib/sync/drift.ts`
- Create: `lib/sync/drift.test.ts`

**Interfaces:**
- Consumes: `Beat` from `lib/sync/types.ts`
- Produces: `expectedPosition(beat, nowLocal, offsetMs): number`, `decideCorrection(input: CorrectionInput): Correction`, constants `DEAD_ZONE_S`, `RESYNC_S`, `CORRECTION_COOLDOWN_MS`, `SEEK_SUPPRESSION_MS`, `DEFAULT_SEEK_LATENCY_MS`.

- [ ] **Step 1: Write the failing test**

Create `lib/sync/drift.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {
  CORRECTION_COOLDOWN_MS,
  decideCorrection,
  expectedPosition,
  type CorrectionInput,
} from './drift'

const base: CorrectionInput = {
  expected: 100,
  actual: 100,
  isPlaying: true,
  nowLocal: 1_000_000,
  lastCorrectionAt: null,
  lastSeekAt: null,
  seekLatencyMs: 300,
}

describe('expectedPosition', () => {
  const beat = {
    version: 1,
    currentTrackId: 't',
    isPlaying: true,
    position: 50,
    hostClock: 1000,
  }

  it('advances position by elapsed host time while playing', () => {
    // local clock is 5000ms behind the host, so offset is +5000
    expect(expectedPosition(beat, -1000, 5000)).toBe(53)
  })

  it('holds position while paused', () => {
    expect(expectedPosition({...beat, isPlaying: false}, 99_999, 0)).toBe(50)
  })
})

describe('decideCorrection', () => {
  it('does nothing inside the dead zone', () => {
    expect(decideCorrection({...base, actual: 100.4}).kind).toBe('none')
  })

  it('corrects just outside the dead zone', () => {
    expect(decideCorrection({...base, actual: 99.4}).kind).toBe('seek')
  })

  it('adds lead compensation when playing', () => {
    const result = decideCorrection({...base, actual: 90})
    expect(result).toEqual({kind: 'seek', to: 100.3, resyncing: true})
  })

  it('omits lead compensation when paused', () => {
    const result = decideCorrection({...base, actual: 90, isPlaying: false})
    expect(result).toEqual({kind: 'seek', to: 100, resyncing: true})
  })

  it('flags small corrections as not resyncing', () => {
    const result = decideCorrection({...base, actual: 99})
    expect(result).toMatchObject({kind: 'seek', resyncing: false})
  })

  it('suppresses corrections shortly after a seek', () => {
    const result = decideCorrection({...base, actual: 90, lastSeekAt: base.nowLocal - 500})
    expect(result.kind).toBe('none')
  })

  it('allows corrections once the seek suppression window passes', () => {
    const result = decideCorrection({...base, actual: 90, lastSeekAt: base.nowLocal - 2500})
    expect(result.kind).toBe('seek')
  })

  it('respects the correction cooldown', () => {
    const result = decideCorrection({
      ...base,
      actual: 90,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS - 100),
    })
    expect(result.kind).toBe('none')
  })

  it('corrects again after the cooldown expires', () => {
    const result = decideCorrection({
      ...base,
      actual: 90,
      lastCorrectionAt: base.nowLocal - (CORRECTION_COOLDOWN_MS + 100),
    })
    expect(result.kind).toBe('seek')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- drift`
Expected: FAIL — cannot resolve `./drift`.

- [ ] **Step 3: Write the implementation**

Create `lib/sync/drift.ts`:

```ts
import type {Beat} from './types'

export const DEAD_ZONE_S = 0.5
export const RESYNC_S = 2
export const CORRECTION_COOLDOWN_MS = 3000
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
}

export type Correction =
  | {kind: 'none'}
  | {kind: 'seek'; to: number; resyncing: boolean}

export function expectedPosition(beat: Beat, nowLocal: number, offsetMs: number): number {
  if (!beat.isPlaying) return beat.position
  return beat.position + (nowLocal + offsetMs - beat.hostClock) / 1000
}

export function decideCorrection(input: CorrectionInput): Correction {
  const drift = Math.abs(input.expected - input.actual)
  if (drift < DEAD_ZONE_S) return {kind: 'none'}

  const since = (at: number | null) => (at === null ? Infinity : input.nowLocal - at)
  if (since(input.lastSeekAt) < SEEK_SUPPRESSION_MS) return {kind: 'none'}
  if (since(input.lastCorrectionAt) < CORRECTION_COOLDOWN_MS) return {kind: 'none'}

  // Seeking takes time to buffer; by the time playback resumes the target has
  // moved on, so aim slightly ahead. Only meaningful while the clock is running.
  const lead = input.isPlaying ? input.seekLatencyMs / 1000 : 0
  return {kind: 'seek', to: input.expected + lead, resyncing: drift > RESYNC_S}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- drift`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/drift.ts lib/sync/drift.test.ts
git commit -m "feat: lead-compensated drift correction with anti-thrash guards"
```

---

### Task 6: Host election

Two rules, both pure: who takes over when the host vanishes, and who backs down when two peers claim the room at once.

**Files:**
- Create: `lib/sync/election.ts`
- Create: `lib/sync/election.test.ts`

**Interfaces:**
- Consumes: `RosterEntry` from `lib/sync/types.ts`
- Produces: `electHost(survivors: RosterEntry[]): string | null`, `resolveHostTie(selfId: string, otherHostId: string): 'keep' | 'demote'`.

- [ ] **Step 1: Write the failing test**

Create `lib/sync/election.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {electHost, resolveHostTie} from './election'
import type {RosterEntry} from './types'

const peer = (peerId: string, joinOrder: number): RosterEntry =>
  ({peerId, name: peerId, joinOrder})

describe('electHost', () => {
  it('returns null when nobody is left', () => {
    expect(electHost([])).toBeNull()
  })

  it('picks the earliest joiner', () => {
    expect(electHost([peer('c', 3), peer('a', 1), peer('b', 2)])).toBe('a')
  })

  it('is independent of roster ordering', () => {
    const roster = [peer('c', 3), peer('a', 1), peer('b', 2)]
    expect(electHost([...roster].reverse())).toBe(electHost(roster))
  })

  it('breaks equal join orders deterministically by peer id', () => {
    expect(electHost([peer('z', 1), peer('a', 1)])).toBe('a')
  })
})

describe('resolveHostTie', () => {
  it('keeps the lower peer id as host', () => {
    expect(resolveHostTie('aaa', 'zzz')).toBe('keep')
  })

  it('demotes the higher peer id', () => {
    expect(resolveHostTie('zzz', 'aaa')).toBe('demote')
  })

  it('reaches opposite verdicts on the two sides of the same tie', () => {
    expect(resolveHostTie('aaa', 'zzz')).not.toBe(resolveHostTie('zzz', 'aaa'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- election`
Expected: FAIL — cannot resolve `./election`.

- [ ] **Step 3: Write the implementation**

Create `lib/sync/election.ts`:

```ts
import type {RosterEntry} from './types'

/** Earliest joiner wins; equal join orders break by peer id so every peer agrees. */
export function electHost(survivors: RosterEntry[]): string | null {
  if (survivors.length === 0) return null
  return survivors.reduce((best, candidate) => {
    if (candidate.joinOrder !== best.joinOrder) {
      return candidate.joinOrder < best.joinOrder ? candidate : best
    }
    return candidate.peerId < best.peerId ? candidate : best
  }).peerId
}

/**
 * Both peers run this on the same pair of ids and reach opposite verdicts,
 * so a simultaneous-join collision resolves without negotiation.
 */
export function resolveHostTie(selfId: string, otherHostId: string): 'keep' | 'demote' {
  return selfId < otherHostId ? 'keep' : 'demote'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- election`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/election.ts lib/sync/election.test.ts
git commit -m "feat: deterministic host election and tie resolution"
```

---

### Task 7: Keyless video metadata

Replaces the reference app's dependency on a dead third-party service. Pure mapping logic is separated from the route handler so it can be tested without the network.

**Files:**
- Create: `lib/youtube/oembed.ts`
- Create: `lib/youtube/oembed.test.ts`
- Create: `app/api/oembed/route.ts`

**Interfaces:**
- Consumes: nothing
- Produces: type `VideoMeta = {videoId, title, author, thumbnail}`; `oembedRequestUrl(videoId): string`; `mapOembed(videoId, raw): VideoMeta` throwing `MalformedOembedError`. Route `GET /api/oembed?videoId=<id>` returns `VideoMeta` as JSON.

- [ ] **Step 1: Write the failing test**

Create `lib/youtube/oembed.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {MalformedOembedError, mapOembed, oembedRequestUrl} from './oembed'

const raw = {
  title: 'Never Gonna Give You Up',
  author_name: 'Rick Astley',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
}

describe('oembedRequestUrl', () => {
  it('targets the keyless oembed endpoint with an encoded watch url', () => {
    const url = new URL(oembedRequestUrl('dQw4w9WgXcQ'))
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/oembed')
    expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(url.searchParams.get('format')).toBe('json')
  })
})

describe('mapOembed', () => {
  it('maps the fields we use', () => {
    expect(mapOembed('dQw4w9WgXcQ', raw)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      author: 'Rick Astley',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
  })

  it.each([
    ['missing title', {...raw, title: undefined}],
    ['missing author', {...raw, author_name: undefined}],
    ['missing thumbnail', {...raw, thumbnail_url: undefined}],
    ['non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_label, payload) => {
    expect(() => mapOembed('dQw4w9WgXcQ', payload)).toThrow(MalformedOembedError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- oembed`
Expected: FAIL — cannot resolve `./oembed`.

- [ ] **Step 3: Write the mapping module**

Create `lib/youtube/oembed.ts`:

```ts
export type VideoMeta = {
  videoId: string
  title: string
  author: string
  thumbnail: string
}

export class MalformedOembedError extends Error {
  constructor(videoId: string) {
    super(`oEmbed response for ${videoId} was missing expected fields`)
    this.name = 'MalformedOembedError'
  }
}

export function oembedRequestUrl(videoId: string): string {
  const target = `https://www.youtube.com/watch?v=${videoId}`
  const url = new URL('https://www.youtube.com/oembed')
  url.searchParams.set('url', target)
  url.searchParams.set('format', 'json')
  return url.toString()
}

export function mapOembed(videoId: string, raw: unknown): VideoMeta {
  if (typeof raw !== 'object' || raw === null) throw new MalformedOembedError(videoId)
  const {title, author_name: author, thumbnail_url: thumbnail} = raw as Record<string, unknown>
  if (typeof title !== 'string' || typeof author !== 'string' || typeof thumbnail !== 'string') {
    throw new MalformedOembedError(videoId)
  }
  return {videoId, title, author, thumbnail}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- oembed`
Expected: PASS.

- [ ] **Step 5: Write the route handler**

Create `app/api/oembed/route.ts`. Upstream failures are distinguished so the UI can say something useful instead of "failed to enqueue".

```ts
import {mapOembed, oembedRequestUrl} from '@/lib/youtube/oembed'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get('videoId')
  if (!videoId || !VIDEO_ID.test(videoId)) {
    return Response.json({error: 'invalid videoId'}, {status: 400})
  }

  let upstream: Response
  try {
    upstream = await fetch(oembedRequestUrl(videoId), {
      next: {revalidate: 3600},
      headers: {accept: 'application/json'},
    })
  } catch {
    return Response.json({error: 'youtube unreachable'}, {status: 502})
  }

  // YouTube answers 400 for a well-formed id with no video behind it, and
  // 401/404 for private or removed ones. We build this request ourselves and
  // the id is regex-validated above, so an upstream 400 means "no such video",
  // never "your request was malformed" — bucketing it as 502 would tell the
  // user to retry something that will never exist.
  if ([400, 401, 404].includes(upstream.status)) {
    return Response.json({error: 'video not found or private'}, {status: 404})
  }
  if (!upstream.ok) {
    return Response.json({error: 'youtube rejected the request'}, {status: 502})
  }

  try {
    const meta = mapOembed(videoId, await upstream.json())
    return Response.json(meta, {
      headers: {'cache-control': 'public, max-age=3600, stale-while-revalidate=86400'},
    })
  } catch {
    return Response.json({error: 'unexpected youtube response'}, {status: 502})
  }
}
```

- [ ] **Step 6: Verify the route against the real endpoint**

Run in one terminal: `npm run dev`
Then run: `curl -s "http://localhost:3000/api/oembed?videoId=dQw4w9WgXcQ"`
Expected: JSON containing `"title"`, `"author"`, and a `thumbnail` URL on `i.ytimg.com`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/oembed?videoId=bogus"`
Expected: `400` — rejected by our own validation, never reaching YouTube.

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/oembed?videoId=aaaaaaaaaaa"`
Expected: `404` — well-formed id, no such video. This is the case that must not
surface as 502, or the UI tells the user to retry a video that cannot exist.

- [ ] **Step 7: Commit**

```bash
git add lib/youtube/oembed.ts lib/youtube/oembed.test.ts app/api/oembed/route.ts
git commit -m "feat: keyless YouTube metadata via oEmbed proxy"
```

---

### Task 8: IFrame API loader and player hook

The spec forbids a wrapper library, so this is our own thin layer. The critical detail is **suppression**: when we move the player to correct drift, the player fires the same events a human click would, and broadcasting those creates a feedback loop between peers.

**Files:**
- Create: `lib/youtube/iframe-api.ts`
- Create: `lib/youtube/iframe-api.test.ts`
- Create: `lib/youtube/use-player.ts`
- Modify: `package.json` (add `jsdom`)

**Interfaces:**
- Consumes: `Unplayable` from `lib/sync/types.ts`
- Produces: `loadIframeApi(): Promise<typeof YT>`, `resetIframeApiLoaderForTests(): void`; `useYouTubePlayer(events: PlayerEvents): {containerRef, handle: PlayerHandle | null, ready: boolean}` where `PlayerHandle = {load(videoId, startAtSec), play(), pause(), seekTo(seconds), getCurrentTime(): number}`.

- [ ] **Step 1: Install jsdom for DOM-dependent tests**

```bash
npm install -D jsdom
```

- [ ] **Step 2: Write the failing test**

Create `lib/youtube/iframe-api.test.ts`:

```ts
// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest'
import {loadIframeApi, resetIframeApiLoaderForTests} from './iframe-api'

afterEach(() => {
  resetIframeApiLoaderForTests()
  document.head.innerHTML = ''
  delete (window as {YT?: unknown}).YT
  delete (window as {onYouTubeIframeAPIReady?: unknown}).onYouTubeIframeAPIReady
})

describe('loadIframeApi', () => {
  it('resolves immediately when the API is already present', async () => {
    const stub = {Player: function () {}}
    ;(window as {YT?: unknown}).YT = stub
    await expect(loadIframeApi()).resolves.toBe(stub)
  })

  it('injects the script tag exactly once across concurrent calls', () => {
    loadIframeApi()
    loadIframeApi()
    expect(document.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(1)
  })

  it('returns the same promise on repeated calls', () => {
    expect(loadIframeApi()).toBe(loadIframeApi())
  })

  it('resolves when YouTube invokes the global ready callback', async () => {
    const promise = loadIframeApi()
    const stub = {Player: function () {}}
    ;(window as {YT?: unknown}).YT = stub
    window.onYouTubeIframeAPIReady?.()
    await expect(promise).resolves.toBe(stub)
  })

  it('retries cleanly after the script fails to load', async () => {
    const promise = loadIframeApi()
    const script = document.querySelector('script[src*="iframe_api"]') as HTMLScriptElement
    script.onerror?.(new Event('error'))
    await expect(promise).rejects.toThrow(/Failed to load/)

    // The dead node must be gone. If it lingers, the retry's injection guard
    // matches it, skips appending, and the second promise never settles —
    // asserting only that the promises differ would not catch that.
    expect(document.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(0)

    const retry = loadIframeApi()
    expect(retry).not.toBe(promise)
    expect(document.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(1)

    const stub = {Player: function () {}}
    ;(window as {YT?: unknown}).YT = stub
    window.onYouTubeIframeAPIReady?.()
    await expect(retry).resolves.toBe(stub)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- iframe-api`
Expected: FAIL — cannot resolve `./iframe-api`.

- [ ] **Step 4: Write the loader**

Create `lib/youtube/iframe-api.ts`:

```ts
declare global {
  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}

const SCRIPT_SRC = 'https://www.youtube.com/iframe_api'
let pending: Promise<typeof YT> | null = null

export function resetIframeApiLoaderForTests(): void {
  pending = null
}

export function loadIframeApi(): Promise<typeof YT> {
  if (pending) return pending

  pending = new Promise<typeof YT>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The YouTube IFrame API requires a browser'))
      return
    }
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT as typeof YT)
    }

    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onerror = () => {
      // Remove the dead node before rejecting. The guard above skips injection
      // whenever a matching script already exists, so leaving a failed node
      // attached makes every retry return early without appending — and the
      // retry's promise then never settles, hanging the player with no error,
      // no timeout, and no recovery short of a full page reload.
      script.remove()
      reject(new Error('Failed to load the YouTube IFrame API'))
    }
    document.head.appendChild(script)
  })

  // Let a failed load be retried rather than poisoning every later call.
  pending.catch(() => {
    pending = null
  })

  return pending
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- iframe-api`
Expected: PASS.

- [ ] **Step 6: Write the player hook**

Create `lib/youtube/use-player.ts`. There are no unit tests for this file — jsdom cannot run the YouTube player. Task 15's Playwright test is its coverage.

```ts
'use client'

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Unplayable} from '@/lib/sync/types'
import {loadIframeApi} from './iframe-api'

/** Window after a programmatic move during which player events are not user intent. */
const REMOTE_SUPPRESSION_MS = 700

export type PlayerHandle = {
  load(videoId: string, startAtSec: number): void
  play(): void
  pause(): void
  seekTo(seconds: number): void
  getCurrentTime(): number
}

export type PlayerEvents = {
  onEnded(): void
  onUnplayable(reason: Unplayable): void
  onUserPlay(): void
  onUserPause(position: number): void
}

export function useYouTubePlayer(events: PlayerEvents) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const suppressUntil = useRef(0)
  const eventsRef = useRef(events)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)

  // Written in an effect, not during render: assigning to a ref while
  // rendering trips react-hooks/refs and misbehaves under concurrent
  // rendering. No dependency array, so it tracks the latest events every pass.
  useEffect(() => {
    eventsRef.current = events
  })

  const suppress = useCallback(() => {
    suppressUntil.current = Date.now() + REMOTE_SUPPRESSION_MS
  }, [])

  useEffect(() => {
    let cancelled = false
    let player: YT.Player | null = null

    loadIframeApi()
      .then(YT => {
        if (cancelled || !containerRef.current) return

        player = new YT.Player(containerRef.current, {
          playerVars: {playsinline: 1, rel: 0, modestbranding: 1},
          events: {
            onReady: () => {
              if (!cancelled) setReady(true)
            },
            onStateChange: event => {
              // The end of a video is never an echo of something we did, so it
              // is checked BEFORE the suppression gate. If it were suppressed,
              // a drift correction landing within the window of the final
              // second would swallow it and the queue would stall at the end
              // of the video with no way forward but a manual skip. Duplicate
              // `ended` reports are harmless: the reducer only advances while
              // the track id still matches, so the second one is a no-op.
              if (event.data === YT.PlayerState.ENDED) {
                eventsRef.current.onEnded()
                return
              }
              // Play and pause DO echo: a move we made ourselves is not a user
              // action, and broadcasting it would bounce between peers forever.
              if (Date.now() < suppressUntil.current) return
              if (event.data === YT.PlayerState.PLAYING) {
                eventsRef.current.onUserPlay()
              } else if (event.data === YT.PlayerState.PAUSED) {
                eventsRef.current.onUserPause(event.target.getCurrentTime())
              }
            },
            onError: event => {
              const reason: Unplayable =
                event.data === 101 || event.data === 150 ? 'embed-blocked' : 'not-found'
              eventsRef.current.onUnplayable(reason)
            },
          },
        })
        playerRef.current = player
      })
      .catch((error: Error) => {
        // Without this the rejection is unhandled, and `ready` stays false
        // forever with nothing on screen explaining why no player appeared.
        if (!cancelled) setLoadError(error)
      })

    return () => {
      cancelled = true
      try {
        player?.destroy()
      } catch {
        // The iframe may already be gone during fast refresh; nothing to clean up.
      }
      playerRef.current = null
    }
  }, [])

  // Memoized on `ready` alone. Every method closes over `playerRef` (a ref)
  // and `suppress` (stable via useCallback), so nothing else can change it.
  // Task 12 puts `handle` in a dependency array — a fresh object each render
  // would re-fire that effect on every parent render, tearing down and
  // rebuilding the drift-correction interval each time.
  const handle: PlayerHandle | null = useMemo(
    () =>
      ready
        ? {
            load(videoId, startAtSec) {
              suppress()
              playerRef.current?.loadVideoById({videoId, startSeconds: startAtSec})
            },
            play() {
              suppress()
              playerRef.current?.playVideo()
            },
            pause() {
              suppress()
              playerRef.current?.pauseVideo()
            },
            seekTo(seconds) {
              suppress()
              playerRef.current?.seekTo(seconds, true)
            },
            getCurrentTime() {
              return playerRef.current?.getCurrentTime() ?? 0
            },
          }
        : null,
    [ready, suppress],
  )

  return {containerRef, handle, ready, loadError}
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/youtube/iframe-api.ts lib/youtube/iframe-api.test.ts lib/youtube/use-player.ts
git commit -m "feat: YouTube IFrame API loader and player hook"
```

---

### Task 9: Duration probe

oEmbed does not return duration and scraping the watch page is what broke the reference app. Cueing the video in a throwaway hidden player and reading `getDuration()` uses only the official API.

**Files:**
- Create: `lib/youtube/probe-duration.ts`

**Interfaces:**
- Consumes: `loadIframeApi` from `lib/youtube/iframe-api.ts`
- Produces: `probeDuration(videoId: string, timeoutMs?: number): Promise<number | null>` — resolves to whole seconds, or `null` if the video cannot be read. Never rejects.

- [ ] **Step 1: Write the implementation**

Create `lib/youtube/probe-duration.ts`. No unit test: this needs a live YouTube player, so Step 2's manual check plus Task 15 are its verification.

```ts
'use client'

import {loadIframeApi} from './iframe-api'

const PROBE_TIMEOUT_MS = 8000
/** getDuration() occasionally reports 0 until metadata lands; retry once. */
const RETRY_DELAY_MS = 500

/**
 * Constructing a player without autoplay only *cues* the video, so nothing is
 * heard. Resolves null rather than rejecting — a missing duration is cosmetic
 * and must never block adding a track.
 */
export async function probeDuration(
  videoId: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<number | null> {
  let YT: typeof globalThis.YT
  try {
    YT = await loadIframeApi()
  } catch {
    return null
  }

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;'
  document.body.appendChild(host)

  return new Promise<number | null>(resolve => {
    let player: YT.Player | null = null
    let settled = false

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        player?.destroy()
      } catch {
        // Player may have failed to construct; the host node still needs removing.
      }
      host.remove()
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)

    const read = (target: YT.Player) => {
      const duration = target.getDuration()
      return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
    }

    player = new YT.Player(host, {
      videoId,
      events: {
        onReady: event => {
          // The backstop may already have fired and destroyed the player while
          // this callback sat queued. That window is the whole timeout — far
          // wider than the retry's below — and reading from a destroyed player
          // throws, with nothing to catch it inside an event callback.
          if (settled) return
          const first = read(event.target)
          if (first !== null) return finish(first)
          setTimeout(() => {
            // The timeout backstop may have fired in this gap and destroyed the
            // player already. Reading from a destroyed player throws, and this
            // is a timer callback, so nothing would catch it — just a stray
            // console error muddying the browser-driven checks later. The probe
            // is settled either way, so there is nothing left to do.
            if (settled) return
            finish(read(event.target))
          }, RETRY_DELAY_MS)
        },
        onError: () => finish(null),
      },
    })
  })
}
```

- [ ] **Step 2: Note the deferred verification**

There is nothing to run yet — the probe has no caller until Task 14. Its verification is Task 14 Step 9 item 2, which asserts a real duration (`3:33` for `dQw4w9WgXcQ`) rather than `—`. Adding a track must still succeed when the probe returns null, since duration is cosmetic.

- [ ] **Step 3: Commit**

```bash
git add lib/youtube/probe-duration.ts
git commit -m "feat: keyless duration probe via hidden cued player"
```

---

### Task 10: Peer connection, roster, and host determination

First networked task. After this, two tabs on the same room code see each other and exactly one of them is host.

**Files:**
- Create: `lib/sync/constants.ts`
- Create: `lib/sync/use-room.ts`
- Modify: `package.json` (add `trystero`)

**Interfaces:**
- Consumes: `electHost`, `resolveHostTie` from `lib/sync/election.ts`; `emptyRoomState` from `lib/sync/room-reducer.ts`; types from `lib/sync/types.ts`
- Produces: `useRoom(code: string, name: string): RoomApi` where `RoomApi = {state, roster, selfId, isHost, status, beat, offsetMs, send(intent)}`. Tasks 11 and 12 extend this same file. Constants `APP_ID`, `HOST_CLAIM_MS`, `BEAT_INTERVAL_MS`, `CLOCK_RESAMPLE_MS`, `PENDING_TIMEOUT_MS`.

- [ ] **Step 1: Install Trystero**

```bash
npm install trystero
```

- [ ] **Step 2: Create the constants module**

Create `lib/sync/constants.ts`:

```ts
/** Namespaces our rooms on the public relays; must be globally distinctive. */
export const APP_ID = 'watch-together-p2p-v1'

/** How long a joiner listens for an existing host before claiming the room. */
export const HOST_CLAIM_MS = 1500

export const BEAT_INTERVAL_MS = 2000
export const CLOCK_RESAMPLE_MS = 15_000
export const CLOCK_BURST_SAMPLES = 5
export const PENDING_TIMEOUT_MS = 2000
```

- [ ] **Step 3: Write the connection hook**

Create `lib/sync/use-room.ts`:

```ts
'use client'

import {useEffect, useRef, useState} from 'react'
import {joinRoom, selfId} from 'trystero'
import {APP_ID, HOST_CLAIM_MS} from './constants'
import {electHost, resolveHostTie} from './election'
import {emptyRoomState} from './room-reducer'
import type {Beat, Intent, RoomState, RosterEntry} from './types'

export type RoomStatus = 'connecting' | 'connected' | 'blocked'

export type RoomApi = {
  state: RoomState
  roster: RosterEntry[]
  selfId: string
  isHost: boolean
  status: RoomStatus
  beat: Beat | null
  offsetMs: number | null
  send(intent: Intent): void
}

export function useRoom(code: string, name: string): RoomApi {
  const [state, setState] = useState<RoomState>(emptyRoomState)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [isHost, setIsHost] = useState(false)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [beat] = useState<Beat | null>(null)
  const [offsetMs] = useState<number | null>(null)

  const isHostRef = useRef(false)
  const joinOrderRef = useRef(new Map<string, number>())
  const nextJoinOrderRef = useRef(1)
  const sendRef = useRef<(intent: Intent) => void>(() => {})

  useEffect(() => {
    const room = joinRoom({appId: APP_ID}, code, {
      onJoinError: () => setStatus('blocked'),
    })

    // Trystero 0.25 actions are objects: `.send(data, opts)` and an assignable
    // `.onMessage`. The older `const [send, get] = makeAction()` tuple is gone.
    const beatAction = room.makeAction<Beat>('beat')
    const rosterAction = room.makeAction<RosterEntry[]>('roster')

    const nameRef = new Map<string, string>()

    // React state is stale inside these long-lived closures, so anything a
    // callback reads must live in a ref.
    const rosterRef = {current: [] as RosterEntry[]}
    const sawHostRef = {current: false}

    const publishRoster = () => {
      const entries: RosterEntry[] = [
        {peerId: selfId, name, joinOrder: 0},
        ...[...joinOrderRef.current.entries()].map(([peerId, joinOrder]) => ({
          peerId,
          name: nameRef.get(peerId) ?? 'friend',
          joinOrder,
        })),
      ]
      rosterRef.current = entries
      setRoster(entries)
      rosterAction.send(entries)
    }

    /**
     * A presence beat. Task 12 replaces the placeholder fields with a real
     * snapshot, but the host must announce itself from the very first task or
     * nobody can tell who the authority is.
     */
    const announce = () => {
      beatAction.send({
        version: 0,
        currentTrackId: null,
        isPlaying: false,
        position: 0,
        hostClock: Date.now(),
      })
    }

    const promote = () => {
      isHostRef.current = true
      setIsHost(true)
      setStatus('connected')
      publishRoster()
      announce()
    }

    const demote = () => {
      isHostRef.current = false
      setIsHost(false)
      // `joinOrderRef` is deliberately NOT cleared here: it records who is
      // connected, which is independent of whether we happen to be host.
      // Clearing it would leave a later promotion — when the host departs —
      // publishing a roster that omits every peer already in the room.
      setState(emptyRoomState())
    }

    // Claim the room only if no existing host announced itself first.
    const claimTimer = setTimeout(() => {
      if (!isHostRef.current && !sawHostRef.current) promote()
    }, HOST_CLAIM_MS)

    beatAction.onMessage = (_incoming, {peerId}) => {
      setStatus('connected')
      if (!isHostRef.current) {
        sawHostRef.current = true
        return
      }
      // Two peers claimed the room at once; both sides resolve it identically.
      if (resolveHostTie(selfId, peerId) === 'demote') demote()
    }

    rosterAction.onMessage = entries => {
      if (isHostRef.current) return
      rosterRef.current = entries
      setRoster(entries)
    }

    room.onPeerJoin = peerId => {
      nameRef.set(peerId, 'friend')
      // Recorded for EVERY peer, not only while we are host. `onPeerJoin`
      // fires once per peer and never again, so when two tabs connect before
      // either has claimed the room — the ordinary case when a link is shared
      // — a host-gated version misses the other peer permanently. Both would
      // then publish a roster containing only themselves, and a later
      // successor election would find no survivors and leave the room
      // hostless and frozen.
      joinOrderRef.current.set(peerId, nextJoinOrderRef.current++)
      if (isHostRef.current) {
        publishRoster()
        // Re-announce so the newcomer learns who the host is without waiting
        // for the next beat. This broadcasts; it is not a targeted send.
        announce()
      }
      setStatus('connected')
    }

    room.onPeerLeave = peerId => {
      joinOrderRef.current.delete(peerId)
      nameRef.delete(peerId)
      if (isHostRef.current) {
        publishRoster()
        return
      }
      // Host vanished: phase 3 migrates properly, phase 1 just promotes the
      // deterministic successor so the room does not silently freeze.
      sawHostRef.current = false
      const survivors = rosterRef.current.filter(entry => entry.peerId !== peerId)
      if (electHost(survivors) === selfId) promote()
    }

    sendRef.current = () => {}

    return () => {
      clearTimeout(claimTimer)
      room.leave()
    }
    // Reconnect only when the room identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return {
    state,
    roster,
    selfId,
    isHost,
    status,
    beat,
    offsetMs,
    send: intent => sendRef.current(intent),
  }
}
```

> **Note for the implementer:** `sendRef` is inert here and `beat`/`offsetMs` are always null; Tasks 11 and 12 wire them up. Leaving them stubbed keeps this task independently reviewable — the room connects and elects a host, but does not yet share state. `beatAction` is created here because host determination listens on it, even though nothing sends a beat until Task 12.

- [ ] **Step 4: Chrome MCP verification — two peers, exactly one host**

Temporarily replace the body of `app/page.tsx` with a probe that exposes the hook's output to the page:

```tsx
'use client'

import {useRoom} from '@/lib/sync/use-room'

export default function Probe() {
  // Two arguments here: `useRoom` does not gain its third parameter until
  // Task 12, when the host's heartbeat needs a live player position.
  const room = useRoom('ember-otter-k7qm', 'probe')
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        status: room.status,
        isHost: room.isHost,
        self: room.selfId,
        // Peer ids, not a count. `publishRoster` always includes self, so a
        // bare length is easy to misread — ids make it unambiguous who each
        // peer believes is in the room.
        roster: room.roster.map(entry => entry.peerId),
      })}
    </pre>
  )
}
```

**Build and serve a production bundle — do not use `npm run dev` for this check:**

```bash
npm run build && npm run start
```

React Strict Mode double-invokes effects in development (mount, unmount, mount). Trystero caches rooms by app id and room id, and `leave()` tears down asynchronously, so the phantom mount's teardown races the surviving mount's `joinRoom()` and they can share a room mid-teardown. The result in dev is intermittent: sometimes both tabs believe they are host. A production build does not double-mount, and is also what users actually run. See the deferred note about making the hook resilient to fast remounts.

Then, with the Chrome MCP tools loaded (see "Verification layers"):

1. `tabs_context_mcp` to see the current tabs.
2. `tabs_create_mcp` twice, both to `http://localhost:3000`.
3. Wait about 5 seconds for relay discovery, then in **each** tab run `javascript_tool` with:

```js
console.log('[probe]', document.querySelector('[data-testid=probe]').textContent)
```

4. `read_console_messages` with pattern `\[probe\]` on each tab.

Expected: both tabs report `"status":"connected"`, **exactly one** reports `"isHost":true`, and each tab's `roster` contains **both** peers' ids — its own `self` value and the other tab's.

Report the two `roster` arrays verbatim. If a tab's roster holds only its own id while both are plainly connected, that is a real defect in roster propagation, not a wording quibble — say so rather than moving on, because Task 14 renders this as the "N watching" presence row.

If both claim host, the presence `announce()` is not reaching the other peer, or `resolveHostTie` is not demoting the loser — do not proceed to Task 11 until exactly one host survives, because every later task assumes a single writer.

4. Also run `read_console_messages` with pattern `error|failed` and confirm no relay or WebRTC errors.
5. Close the second tab with `tabs_close_mcp` and re-read the probe in the first: it should still report exactly one host, and its `roster` should shrink back to just its own id.

Note the roster never empties — `publishRoster` always lists self first, so any peer that has been host reports at least one entry. Do not expect zero.
6. `tabs_close_mcp` on the remaining tab, then revert `app/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/sync/constants.ts lib/sync/use-room.ts
git commit -m "feat: peer connection, roster, and host determination"
```

---

### Task 11: State replication and intents

Makes the host authoritative in practice: guests send intents, the host is the only writer, and versioning makes out-of-order delivery harmless.

**Files:**
- Create: `lib/sync/pending.ts`
- Create: `lib/sync/pending.test.ts`
- Modify: `lib/sync/use-room.ts`

**Interfaces:**
- Consumes: `applyIntent` from `lib/sync/room-reducer.ts`; `PENDING_TIMEOUT_MS` from `lib/sync/constants.ts`
- Produces: `shouldAcceptState(current, incoming): boolean`, `expirePending(pending, now, timeoutMs?): {kept, expired}`, type `PendingIntent = {intent: Intent; sentAt: number}`. `RoomApi.send` becomes functional.

- [ ] **Step 1: Write the failing test**

Create `lib/sync/pending.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {expirePending, shouldAcceptState, type PendingIntent} from './pending'
import {emptyRoomState} from './room-reducer'

describe('shouldAcceptState', () => {
  const current = {...emptyRoomState(), version: 5}

  it('accepts a newer version', () => {
    expect(shouldAcceptState(current, {...current, version: 6})).toBe(true)
  })

  it('rejects a stale version arriving out of order', () => {
    expect(shouldAcceptState(current, {...current, version: 4})).toBe(false)
  })

  it('rejects a duplicate of the current version', () => {
    expect(shouldAcceptState(current, {...current, version: 5})).toBe(false)
  })
})

describe('expirePending', () => {
  const pending: PendingIntent[] = [
    {intent: {type: 'play'}, sentAt: 1000},
    {intent: {type: 'skip'}, sentAt: 4000},
  ]

  it('keeps intents still inside the window', () => {
    const {kept, expired} = expirePending(pending, 4500, 2000)
    expect(kept).toHaveLength(1)
    expect(expired).toHaveLength(1)
    expect(expired[0].intent.type).toBe('play')
  })

  it('keeps everything when nothing has timed out', () => {
    // 2500, not 4100: the fixture's first intent was sent at 1000, so at 4100
    // it is 3100ms old and already past a 2000ms timeout. The assertion would
    // be unsatisfiable.
    expect(expirePending(pending, 2500, 2000).expired).toHaveLength(0)
  })

  it('handles an empty list', () => {
    expect(expirePending([], 9999, 2000)).toEqual({kept: [], expired: []})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- pending`
Expected: FAIL — cannot resolve `./pending`.

- [ ] **Step 3: Write the implementation**

Create `lib/sync/pending.ts`:

```ts
import {PENDING_TIMEOUT_MS} from './constants'
import type {Intent, RoomState} from './types'

export type PendingIntent = {intent: Intent; sentAt: number}

/** Versions are host-assigned and monotonic, so anything not newer is stale. */
export function shouldAcceptState(current: RoomState, incoming: RoomState): boolean {
  return incoming.version > current.version
}

/**
 * An optimistic change the host never confirmed means we lost contact with the
 * authority; the caller reverts to the last confirmed state and warns the user.
 */
export function expirePending(
  pending: PendingIntent[],
  now: number,
  timeoutMs: number = PENDING_TIMEOUT_MS,
): {kept: PendingIntent[]; expired: PendingIntent[]} {
  const kept: PendingIntent[] = []
  const expired: PendingIntent[] = []
  for (const item of pending) {
    ;(now - item.sentAt >= timeoutMs ? expired : kept).push(item)
  }
  return {kept, expired}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- pending`
Expected: PASS.

- [ ] **Step 5: Wire replication into `lib/sync/use-room.ts`**

Change the existing `room-reducer` import (it already imports `emptyRoomState`) to add the reducer, and add the new module:

```ts
import {applyIntent, emptyRoomState} from './room-reducer'
import {expirePending, shouldAcceptState, type PendingIntent} from './pending'
```

Add a warning field to the `RoomApi` type and to the returned object:

```ts
export type RoomApi = {
  // ...existing fields
  warning: string | null
}
```

```ts
const [warning, setWarning] = useState<string | null>(null)
```

Inside the `useEffect`, after the `roster` action is created, add the state and intent actions.

> **Why two state refs.** A guest applying an intent optimistically must not bump
> the version it compares against — if it did, the host's authoritative reply
> would carry an equal version, fail the `incoming.version > current.version`
> check, and be discarded, leaving the guest permanently diverged. `confirmedRef`
> holds the last host-issued state and is the only thing versions are compared
> against; the optimistic result is display-only.

```ts
const stateAction = room.makeAction<RoomState>('state')
const intentAction = room.makeAction<Intent>('intent')

/** Last state issued by the host. The only basis for version comparison. */
const confirmedRef = {current: emptyRoomState()}
/** What the user sees: confirmed state plus any un-acknowledged local intents. */
const displayRef = {current: emptyRoomState()}
const pendingRef = {current: [] as PendingIntent[]}

const showConfirmed = (next: RoomState) => {
  confirmedRef.current = next
  displayRef.current = next
  pendingRef.current = []
  setState(next)
  setWarning(null)
}

// Host is the only writer: apply, then broadcast the new authoritative state.
intentAction.onMessage = intent => {
  if (!isHostRef.current) return
  const next = applyIntent(confirmedRef.current, intent, Date.now())
  if (next === confirmedRef.current) return
  showConfirmed(next)
  stateAction.send(next)
}

stateAction.onMessage = incoming => {
  if (isHostRef.current) return
  if (!shouldAcceptState(confirmedRef.current, incoming)) return
  showConfirmed(incoming)
}

sendRef.current = (intent: Intent) => {
  const now = Date.now()
  if (isHostRef.current) {
    const next = applyIntent(confirmedRef.current, intent, now)
    if (next === confirmedRef.current) return
    showConfirmed(next)
    stateAction.send(next)
    return
  }
  // Guests render the change immediately; the host's broadcast replaces it.
  displayRef.current = applyIntent(displayRef.current, intent, now)
  pendingRef.current = [...pendingRef.current, {intent, sentAt: now}]
  setState(displayRef.current)
  intentAction.send(intent)
}

// An intent the host never acknowledged means we lost the authority.
const pendingTimer = setInterval(() => {
  if (isHostRef.current || pendingRef.current.length === 0) return
  const {kept, expired} = expirePending(pendingRef.current, Date.now())
  if (expired.length === 0) return
  pendingRef.current = kept
  // Rebuild the display from confirmed state plus the intents still in
  // flight, rather than hard-resetting to confirmed alone. Keeping an entry
  // in `pendingRef` while erasing its visual effect is self-contradictory:
  // the user would watch a change made half a second ago vanish even though
  // we still expect it to land.
  displayRef.current = kept.reduce(
    (state, item) => applyIntent(state, item.intent, item.sentAt),
    confirmedRef.current,
  )
  setState(displayRef.current)
  setWarning('Lost contact with the host — that change did not stick.')
}, 500)
```

Add the timer to the cleanup function alongside `clearTimeout(claimTimer)`:

```ts
clearInterval(pendingTimer)
```

Replace every remaining reference to the old `stateRef` in this file with `confirmedRef` — specifically in `promote()` and in the `onPeerJoin` hand-off.

Finally, extend `demote()` to reset the replication refs alongside React state:

```ts
const demote = () => {
  isHostRef.current = false
  setIsHost(false)
  // `joinOrderRef` is deliberately NOT cleared — see Task 10.
  // The replication refs, by contrast, MUST be reset. `shouldAcceptState`
  // compares incoming state against `confirmedRef`, so a peer that briefly
  // held the room and applied even one intent keeps a version high enough to
  // reject the winner's authoritative state — and stays permanently diverged.
  // That is precisely the failure the confirmed/display split exists to
  // prevent, arriving through the back door.
  confirmedRef.current = emptyRoomState()
  displayRef.current = emptyRoomState()
  pendingRef.current = []
  // Clear the warning too, or a "lost contact with the host" message can
  // linger after losing a tie — alarming and no longer true.
  setWarning(null)
  setState(emptyRoomState())
}
```

> **Known gap, deferred to a later phase: pending intents are cleared imprecisely.**
> `RoomState.version` is a single global counter, not correlated to any particular
> guest's intent, so `showConfirmed` clears *all* of a guest's pending entries
> whenever it accepts any newer state — including state produced by a different
> guest's unrelated intent. In ordinary concurrent use the effect is transient:
> guest A's change briefly disappears from A's own view until the host's next
> broadcast includes it. The lossy case is narrow — the host dying between
> broadcasting one guest's intent and processing another's — but it is silent,
> because the pending entry that would have raised a warning is already gone.
>
> Fixing this properly requires per-intent correlation on the wire: each intent
> carries a per-peer sequence number, the host echoes the highest sequence it has
> applied per peer in `RoomState`, and a guest clears only entries at or below its
> own acknowledged sequence. That changes the reducer contract and `RoomState`,
> which is more than phase 1's "core features work" bar justifies. Do **not**
> attempt the naive alternative of never clearing and always re-folding pending
> onto confirmed — that guarantees double-application of already-confirmed
> intents (a double skip, for instance) until they expire.

**Add** a state broadcast to `promote()` so a new host seeds peers from its replica. Add it — do not replace the body. `announce()` must stay: beat-based tie resolution depends on every promotion announcing itself, and `stateAction.onMessage` no-ops whenever the receiver already believes it is host, so the state broadcast cannot substitute for it. Dropping `announce()` would leave a simultaneous double-claim undetected.

```ts
const promote = () => {
  isHostRef.current = true
  setIsHost(true)
  setStatus('connected')
  publishRoster()
  announce()
  stateAction.send(confirmedRef.current)
}
```

Add a targeted state hand-off inside `room.onPeerJoin`, immediately after `publishRoster()`, so a joiner receives the queue without waiting for the next change:

```ts
stateAction.send(confirmedRef.current, {target: peerId})
```

> **Deviation from the spec:** the spec describes a `hello` request/response that a joiner sends to pull state. Pushing state to the joiner instead achieves the same result with one message and no timeout to tune, so `hello` is not implemented. The spec's message table is accurate about intent, not about direction.

- [ ] **Step 6: Chrome MCP verification — state replicates both ways**

Restore the Task 10 probe page, extended to expose `send` and the queue:

```tsx
'use client'

import {useRef} from 'react'
import {useRoom} from '@/lib/sync/use-room'

export default function Probe() {
  const positionRef = useRef<() => number>(() => 0)
  const room = useRoom('ember-otter-k7qm', 'probe', positionRef)

  if (typeof window !== 'undefined') {
    ;(window as unknown as {__probe?: unknown}).__probe = room
  }

  return (
    <pre data-testid="probe">
      {JSON.stringify({
        isHost: room.isHost,
        version: room.state.version,
        queue: room.state.queue.map(t => t.id),
      })}
    </pre>
  )
}
```

Run `npm run dev`, open two tabs via `tabs_create_mcp`, wait ~5s, then in the **guest** tab (the one reporting `isHost:false`) run `javascript_tool`:

```js
window.__probe.send({
  type: 'enqueue',
  track: {
    id: 'probe-1', videoId: 'dQw4w9WgXcQ', title: 'probe', author: 'a',
    thumbnail: '', durationSec: 10, startAtSec: 0,
    addedBy: {peerId: 'x', name: 'probe'}, addedAt: Date.now(),
  },
})
```

Then log the probe text in both tabs and read it back with `read_console_messages`.

Expected: **both** tabs list `"probe-1"` in the queue, and both report the same `version`. A guest-originated change reaching the host and coming back is the whole point of this task — if only the guest shows it, intents are not reaching the host; if the guest shows it and then loses it after ~2 seconds, the host is not acknowledging and the pending-expiry warning fired.

Close both tabs and revert `app/page.tsx`.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/pending.ts lib/sync/pending.test.ts lib/sync/use-room.ts
git commit -m "feat: host-authoritative state replication with optimistic intents"
```

---

### Task 12: Heartbeat, clock sync, and drift correction

Everything built so far converges here. After this task the pure drift logic from Task 5 is actually driving a real player.

**Files:**
- Modify: `lib/sync/use-room.ts`
- Create: `lib/sync/use-sync-playback.ts`

**Interfaces:**
- Consumes: `makeSample`, `pushSample`, `bestOffset` from `lib/sync/clock.ts`; `expectedPosition`, `decideCorrection`, `DEFAULT_SEEK_LATENCY_MS` from `lib/sync/drift.ts`; `PlayerHandle` from `lib/youtube/use-player.ts`
- Produces: **`useRoom` signature changes** to `useRoom(code: string, name: string, positionRef: RefObject<() => number>): RoomApi` — the host needs the real player position for its heartbeat, and only the component owning the player can supply it. `RoomApi.beat` and `RoomApi.offsetMs` become live. Also `useSyncPlayback(room: RoomApi, handle: PlayerHandle | null): {resyncing: boolean; current: Track | null}`.

- [ ] **Step 1: Change the `useRoom` signature**

In `lib/sync/use-room.ts`, update the import line and the function signature:

```ts
import {type RefObject, useEffect, useRef, useState} from 'react'

export function useRoom(
  code: string,
  name: string,
  positionRef: RefObject<() => number>,
): RoomApi {
```

Change the two stubbed state declarations to be settable:

```ts
const [beat, setBeat] = useState<Beat | null>(null)
const [offsetMs, setOffsetMs] = useState<number | null>(null)
```

- [ ] **Step 2: Add the host heartbeat**

Add these imports at the top of `lib/sync/use-room.ts`:

```ts
import {BEAT_INTERVAL_MS, CLOCK_BURST_SAMPLES, CLOCK_RESAMPLE_MS} from './constants'
import {bestOffset, makeSample, pushSample, type ClockSample} from './clock'
```

Replace the placeholder `announce()` from Task 10 with one that sends a real snapshot. The host reads position from the live player rather than from stored state, because the player is the ground truth for what is actually on screen:

```ts
const hostIdRef = {current: null as string | null}
const samplesRef = {current: [] as ClockSample[]}

const announce = () => {
  const snapshot = confirmedRef.current
  beatAction.send({
    version: snapshot.version,
    currentTrackId: snapshot.currentTrackId,
    isPlaying: snapshot.isPlaying,
    position: positionRef.current(),
    hostClock: Date.now(),
  })
}

const beatTimer = setInterval(() => {
  if (isHostRef.current) announce()
}, BEAT_INTERVAL_MS)
```

> **Beat on an empty queue.** Send the beat even when `currentTrackId` is null. Guests use beats to discover who the host is and to sample its clock, and every room starts empty — gating beats on having a track would leave a fresh room with no discoverable authority. `useSyncPlayback` already ignores beats whose track does not match what is loaded, so an empty-room beat is harmless.

- [ ] **Step 3: Add clock sampling**

Still inside the `useEffect`, add the request action and the sampling routine:

```ts
const clockAction = room.makeAction('clock', {
  kind: 'request',
  onRequest: () => Date.now(),
})

const sampleClock = async () => {
  const hostId = hostIdRef.current
  if (!hostId || isHostRef.current) return
  try {
    const t0 = Date.now()
    const hostClock = await clockAction.request(null, {target: hostId, timeoutMs: 3000})
    const t2 = Date.now()
    samplesRef.current = pushSample(samplesRef.current, makeSample(t0, Number(hostClock), t2))
    setOffsetMs(bestOffset(samplesRef.current))
  } catch {
    // A dropped sample is harmless; the next one will land.
  }
}

const clockTimer = setInterval(sampleClock, CLOCK_RESAMPLE_MS)
```

Extend the existing `beatAction.onMessage` handler so guests record the beat, learn who the host is, and take a burst of clock samples the first time they hear from it:

```ts
beatAction.onMessage = (incoming, {peerId}) => {
  setStatus('connected')
  if (isHostRef.current) {
    // Two peers claimed the room at once; both sides resolve it identically.
    if (resolveHostTie(selfId, peerId) === 'demote') demote()
    return
  }
  // A beat proves a host already exists, so the claim timer must not
  // self-promote. Losing this line makes every guest joining an established
  // room claim it after HOST_CLAIM_MS, broadcast a roster nobody should
  // trust, and only then get demoted on hearing the real host.
  sawHostRef.current = true
  const isNewHost = hostIdRef.current !== peerId
  hostIdRef.current = peerId
  setBeat(incoming)
  if (isNewHost) {
    samplesRef.current = []
    for (let i = 0; i < CLOCK_BURST_SAMPLES; i++) void sampleClock()
  }
}
```

Add both timers to the cleanup function:

```ts
return () => {
  clearTimeout(claimTimer)
  // Task 11's pending-expiry timer. Keep it — this snippet showing only the
  // timers Task 12 adds does not mean the earlier one should be dropped.
  clearInterval(pendingTimer)
  clearInterval(beatTimer)
  clearInterval(clockTimer)
  room.leave()
}
```

- [ ] **Step 4: Write the playback sync hook**

Create `lib/sync/use-sync-playback.ts`:

```ts
'use client'

import {useEffect, useRef, useState} from 'react'
import {decideCorrection, DEFAULT_SEEK_LATENCY_MS, expectedPosition} from './drift'
import type {RoomApi} from './use-room'
import type {Track} from './types'
import type {PlayerHandle} from '@/lib/youtube/use-player'

const CHECK_INTERVAL_MS = 1000
/** Distance at which a seek counts as landed, for latency measurement. */
const LANDED_TOLERANCE_S = 0.5

export function useSyncPlayback(room: RoomApi, handle: PlayerHandle | null) {
  const lastCorrectionAt = useRef<number | null>(null)
  const lastSeekAt = useRef<number | null>(null)
  const seekLatencyMs = useRef(DEFAULT_SEEK_LATENCY_MS)
  const inFlightSeek = useRef<{target: number; startedAt: number} | null>(null)
  const loadedTrackId = useRef<string | null>(null)
  const [resyncing, setResyncing] = useState(false)

  const {state} = room
  const current: Track | null =
    state.queue.find(track => track.id === state.currentTrackId) ?? null

  // Load whenever the room moves to a different queue entry.
  useEffect(() => {
    if (!handle || !current) return
    if (loadedTrackId.current === current.id) return
    loadedTrackId.current = current.id
    handle.load(current.videoId, state.position)
    lastSeekAt.current = Date.now()
  }, [handle, current, state.position])

  // Follow the authoritative play/pause flag.
  useEffect(() => {
    if (!handle || !current) return
    if (state.isPlaying) handle.play()
    else handle.pause()
  }, [handle, current, state.isPlaying])

  // `room` is a fresh object literal on every render, so it must never appear
  // in a dependency array — the interval below would be torn down and rebuilt
  // on every render (roughly every 2s once beats arrive) and would tick
  // erratically or barely at all. Drift correction is the entire product
  // claim, and nothing in the test suite would notice it failing.
  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  })

  // Guests correct drift against the host's heartbeat. The host defines truth
  // and therefore never corrects itself.
  useEffect(() => {
    if (!handle || room.isHost) return

    const timer = setInterval(() => {
      const {beat, offsetMs} = roomRef.current
      if (!beat || offsetMs === null) return
      if (beat.currentTrackId !== loadedTrackId.current) return

      const now = Date.now()
      const actual = handle.getCurrentTime()

      // Measure how long the last seek took so the next one aims correctly.
      const pending = inFlightSeek.current
      if (pending && Math.abs(actual - pending.target) < LANDED_TOLERANCE_S) {
        const observed = now - pending.startedAt
        seekLatencyMs.current = Math.round((seekLatencyMs.current + observed) / 2)
        inFlightSeek.current = null
      }

      const correction = decideCorrection({
        expected: expectedPosition(beat, now, offsetMs),
        actual,
        isPlaying: beat.isPlaying,
        nowLocal: now,
        lastCorrectionAt: lastCorrectionAt.current,
        lastSeekAt: lastSeekAt.current,
        seekLatencyMs: seekLatencyMs.current,
      })

      if (correction.kind === 'none') {
        // Unconditional: `resyncing` is not a dependency of this effect, so
        // reading it here would be a stale closure. React bails out when the
        // value is unchanged, making the redundant call free.
        setResyncing(false)
        return
      }

      handle.seekTo(correction.to)
      lastCorrectionAt.current = now
      lastSeekAt.current = now
      inFlightSeek.current = {target: correction.to, startedAt: now}
      setResyncing(correction.resyncing)
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(timer)
    // `room` is deliberately absent — see the roomRef note above. Only
    // `room.isHost` matters, because it decides whether this effect runs at
    // all, and it is a primitive so it does not churn.
  }, [handle, room.isHost])

  return {resyncing, current}
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/sync/use-room.ts lib/sync/use-sync-playback.ts
git commit -m "feat: host heartbeat, clock sampling, and live drift correction"
```

---

### Task 13: Identity and landing page

**Files:**
- Create: `lib/identity.ts`
- Create: `lib/identity.test.ts`
- Modify: `app/page.tsx`
- Modify: `app/globals.css` (dark base)

**Interfaces:**
- Consumes: `generateRoomCode`, `isValidRoomCode` from `lib/room-code.ts`
- Produces: `loadNickname(storage): string`, `saveNickname(storage, name): void`, `DEFAULT_NICKNAME`.

- [ ] **Step 1: Write the failing test**

Create `lib/identity.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {DEFAULT_NICKNAME, loadNickname, saveNickname} from './identity'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = {...initial}
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('nickname persistence', () => {
  it('falls back to a default when nothing is stored', () => {
    expect(loadNickname(fakeStorage())).toBe(DEFAULT_NICKNAME)
  })

  it('round-trips a saved nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'bao')
    expect(loadNickname(storage)).toBe('bao')
  })

  it('trims surrounding whitespace', () => {
    const storage = fakeStorage()
    saveNickname(storage, '  bao  ')
    expect(loadNickname(storage)).toBe('bao')
  })

  it('ignores a blank nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, '   ')
    expect(loadNickname(storage)).toBe(DEFAULT_NICKNAME)
  })

  it('caps an overlong nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'x'.repeat(100))
    expect(loadNickname(storage)).toHaveLength(24)
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
    expect(loadNickname(throwing)).toBe(DEFAULT_NICKNAME)
    expect(() => saveNickname(throwing, 'bao')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- identity`
Expected: FAIL — cannot resolve `./identity`.

- [ ] **Step 3: Write the implementation**

Create `lib/identity.ts`:

```ts
export const DEFAULT_NICKNAME = 'friend'
export const MAX_NICKNAME_LENGTH = 24

const KEY = 'watch-together:nickname'

export type NicknameStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function normalize(raw: string): string {
  return raw.trim().slice(0, MAX_NICKNAME_LENGTH)
}

export function loadNickname(storage: NicknameStorage): string {
  try {
    return normalize(storage.getItem(KEY) ?? '') || DEFAULT_NICKNAME
  } catch {
    // Private browsing and blocked storage both throw; a default is fine.
    return DEFAULT_NICKNAME
  }
}

export function saveNickname(storage: NicknameStorage, name: string): void {
  try {
    storage.setItem(KEY, normalize(name))
  } catch {
    // Nickname is a convenience, never worth failing a join over.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- identity`
Expected: PASS.

- [ ] **Step 5: Write the landing page**

Replace the contents of `app/page.tsx`:

```tsx
'use client'

import {useRouter} from 'next/navigation'
import {useEffect, useState} from 'react'
import {DEFAULT_NICKNAME, loadNickname, saveNickname} from '@/lib/identity'
import {generateRoomCode, isValidRoomCode} from '@/lib/room-code'

export default function LandingPage() {
  const router = useRouter()
  const [name, setName] = useState(DEFAULT_NICKNAME)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(loadNickname(window.localStorage))
  }, [])

  const enter = (roomCode: string) => {
    saveNickname(window.localStorage, name)
    router.push(`/r/${roomCode}`)
  }

  const join = () => {
    const trimmed = code.trim().toLowerCase()
    if (!isValidRoomCode(trimmed)) {
      setError('That does not look like a room code.')
      return
    }
    enter(trimmed)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Watch Together</h1>
        <p className="mt-2 text-sm text-neutral-400">
          One queue, one player, everyone in sync.
        </p>
      </header>

      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-400">Your name</span>
        <input
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={24}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-500"
        />
      </label>

      <button
        onClick={() => enter(generateRoomCode())}
        className="rounded-lg bg-white px-4 py-3 font-medium text-neutral-950 hover:bg-neutral-200"
      >
        Start a room
      </button>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={code}
            onChange={event => {
              setCode(event.target.value)
              setError(null)
            }}
            onKeyDown={event => event.key === 'Enter' && join()}
            placeholder="ember-otter-k7qm"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={join}
            className="rounded-lg border border-neutral-700 px-4 py-2 hover:border-neutral-500"
          >
            Join
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Set the dark base**

In `app/globals.css`, append this at the **end of the file**. Placement matters: the scaffold already defines a `body` rule further down, so adding this near the top lets that later rule override it — and because the dark palette only differs under a light-mode preference, the bug is invisible to anyone testing on a dark-mode machine. Keep every pre-existing line, including `font-family`.

```css
body {
  background-color: #0a0a0a;
  color: #ededed;
}
```

- [ ] **Step 7: Chrome MCP verification — landing page**

Build and serve a production bundle — `npm run build && npm run start`. This also proves the page builds, which `npm run dev` does not.

1. `tabs_create_mcp`, then `navigate` to `http://localhost:3000`.
2. Call `read_console_messages` once with any pattern **now**, purely to begin capture, then `navigate` to the same URL again to reload. Console tracking only starts when that tool is first called on a tab, so without this every page-load error is invisible and the check reports a clean console nobody observed.
3. `read_page` to confirm the name field, "Start a room", the code input, and "Join" all render.
4. `form_input` the name field with `bao`, then `computer` click "Start a room".
5. Expected: the URL becomes `/r/<adjective>-<noun>-<4 chars>`. A 404 body is correct at this task — Task 14 adds the route.
6. `navigate` back to `/`, then `read_page`. Expected: the name field shows `bao`, restored from storage.
7. `form_input` the code field with `not-a-real-code` and click "Join". Expected: the error text appears and the URL does **not** change.
8. `read_console_messages` with pattern `error` — expect nothing beyond the 404.
9. Navigate the tab to `about:blank` rather than closing it. `tabs_close_mcp` has been observed resetting the extension's tab group and orphaning tabs; close only at the very end, and report any orphaned ids if the group resets anyway.

Stop the server and confirm port 3000 is free.

- [ ] **Step 8: Commit**

```bash
git add lib/identity.ts lib/identity.test.ts app/page.tsx app/globals.css
git commit -m "feat: landing page with nickname persistence and room entry"
```

---

### Task 14: Room UI

Assembles the room: player, queue, add-by-URL. At the end of this task the product works.

**Files:**
- Create: `lib/format-duration.ts`
- Create: `lib/format-duration.test.ts`
- Create: `app/r/[code]/page.tsx`
- Create: `components/Room.tsx`
- Create: `components/AddTrackForm.tsx`
- Create: `components/Queue.tsx`

**Interfaces:**
- Consumes: `useRoom`, `useSyncPlayback`, `useYouTubePlayer`, `probeDuration`, `parseYouTubeUrl`, `isValidRoomCode`, `loadNickname`
- Produces: `formatDuration(seconds: number | null): string`

- [ ] **Step 1: Write the failing test**

Create `lib/format-duration.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {formatDuration} from './format-duration'

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0:00'],
    [9, '0:09'],
    [213, '3:33'],
    [600, '10:00'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })

  it('rounds fractional seconds down', () => {
    expect(formatDuration(213.9)).toBe('3:33')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- format-duration`
Expected: FAIL — cannot resolve `./format-duration`.

- [ ] **Step 3: Write the implementation**

Create `lib/format-duration.ts`:

```ts
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- format-duration`
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `app/r/[code]/page.tsx`. Note that `params` is a Promise in this Next version:

```tsx
import {notFound} from 'next/navigation'
import {Room} from '@/components/Room'
import {isValidRoomCode} from '@/lib/room-code'

export default async function RoomPage({params}: {params: Promise<{code: string}>}) {
  const {code} = await params
  if (!isValidRoomCode(code)) notFound()
  return <Room code={code} />
}
```

- [ ] **Step 6: Write the add-track form**

Create `components/AddTrackForm.tsx`:

```tsx
'use client'

import {useState} from 'react'
import type {Track} from '@/lib/sync/types'
import {InvalidYouTubeUrlError, parseYouTubeUrl} from '@/lib/youtube/parse-url'
import {probeDuration} from '@/lib/youtube/probe-duration'

export function AddTrackForm({
  onAdd,
  addedBy,
}: {
  onAdd(track: Track): void
  addedBy: {peerId: string; name: string}
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy || url.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const {videoId, startAtSec} = parseYouTubeUrl(url)

      const response = await fetch(`/api/oembed?videoId=${videoId}`)
      if (!response.ok) {
        setError(
          response.status === 404
            ? 'That video is private or no longer exists.'
            : 'Could not reach YouTube. Try again in a moment.',
        )
        return
      }
      const meta = await response.json()

      // A missing duration is cosmetic and must never block adding.
      const durationSec = await probeDuration(videoId)

      onAdd({
        id: crypto.randomUUID(),
        videoId,
        title: meta.title,
        author: meta.author,
        thumbnail: meta.thumbnail,
        durationSec,
        startAtSec,
        addedBy,
        addedAt: Date.now(),
      })
      setUrl('')
    } catch (cause) {
      setError(
        cause instanceof InvalidYouTubeUrlError
          ? 'That is not a YouTube link.'
          : 'Something went wrong adding that video.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && submit()}
          placeholder="Paste a YouTube link"
          disabled={busy}
          data-testid="add-url"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          onClick={submit}
          disabled={busy}
          data-testid="add-submit"
          className="rounded-lg border border-neutral-700 px-4 text-sm hover:border-neutral-500 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Write the queue**

Create `components/Queue.tsx`:

```tsx
'use client'

import {formatDuration} from '@/lib/format-duration'
import type {RoomState} from '@/lib/sync/types'

export function Queue({
  state,
  onRemove,
}: {
  state: RoomState
  onRemove(trackId: string): void
}) {
  if (state.queue.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing queued yet. Paste a link above.</p>
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="queue">
      {state.queue.map(track => (
        <li
          key={track.id}
          data-testid="queue-item"
          className={`flex items-center gap-3 rounded-lg p-2 ${
            track.id === state.currentTrackId ? 'bg-neutral-800' : 'hover:bg-neutral-900'
          }`}
        >
          <img src={track.thumbnail} alt="" className="h-10 w-16 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{track.title}</p>
            <p className="truncate text-xs text-neutral-500">
              {track.author} · {formatDuration(track.durationSec)} · added by {track.addedBy.name}
              {track.unplayable && ' · unavailable'}
            </p>
          </div>
          <button
            onClick={() => onRemove(track.id)}
            aria-label={`Remove ${track.title}`}
            className="px-2 text-neutral-500 hover:text-neutral-200"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 8: Write the room shell**

Create `components/Room.tsx`. The `positionRef` indirection exists because the host's heartbeat needs the live player position, which only this component owns:

```tsx
'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {AddTrackForm} from './AddTrackForm'
import {Queue} from './Queue'
import {loadNickname} from '@/lib/identity'
import type {Track, Unplayable} from '@/lib/sync/types'
import {useRoom} from '@/lib/sync/use-room'
import {useSyncPlayback} from '@/lib/sync/use-sync-playback'
import {useYouTubePlayer} from '@/lib/youtube/use-player'

export function Room({code}: {code: string}) {
  const [name, setName] = useState('friend')
  const positionRef = useRef<() => number>(() => 0)

  useEffect(() => {
    setName(loadNickname(window.localStorage))
  }, [])

  const room = useRoom(code, name, positionRef)

  // Refs keep the player's event callbacks stable, so the player is never
  // rebuilt just because room state changed.
  const sendRef = useRef(room.send)
  sendRef.current = room.send
  const trackIdRef = useRef<string | null>(null)
  trackIdRef.current = room.state.currentTrackId
  const isHostRef = useRef(room.isHost)
  isHostRef.current = room.isHost

  const [localBlock, setLocalBlock] = useState<Unplayable | null>(null)

  const onEnded = useCallback(() => {
    const trackId = trackIdRef.current
    if (trackId) sendRef.current({type: 'ended', trackId})
  }, [])

  // Embed and region restrictions differ per viewer, so only the host's verdict
  // skips the track for everyone. A guest who cannot play it says so locally.
  const onUnplayable = useCallback((reason: Unplayable) => {
    const trackId = trackIdRef.current
    if (!trackId) return
    if (isHostRef.current) sendRef.current({type: 'unplayable', trackId, reason})
    else setLocalBlock(reason)
  }, [])

  const onUserPlay = useCallback(() => sendRef.current({type: 'play'}), [])
  const onUserPause = useCallback(
    (position: number) => sendRef.current({type: 'pause', position}),
    [],
  )

  useEffect(() => {
    setLocalBlock(null)
  }, [room.state.currentTrackId])

  const {containerRef, handle, loadError} = useYouTubePlayer({
    onEnded,
    onUnplayable,
    onUserPlay,
    onUserPause,
  })

  positionRef.current = () => handle?.getCurrentTime() ?? 0

  const {resyncing, current} = useSyncPlayback(room, handle)

  // Probe for automated verification. The YouTube iframe is cross-origin, so
  // this is the only way a check can read what each peer is actually playing.
  //
  // Deliberately NOT guarded on `process.env.NODE_ENV`. Next inlines that value
  // into the client bundle at build time, and every browser check in this plan
  // runs against `npm run build && npm run start` — because dev's Strict Mode
  // double-invokes effects and races the host election. A production guard
  // would therefore strip this hook from the exact build that needs it, and
  // Task 16 could not measure anything at all.
  useEffect(() => {
    ;(window as unknown as {__watchTogether?: unknown}).__watchTogether = {
      readAt: () => ({
        at: Date.now(),
        position: handle?.getCurrentTime() ?? null,
        trackId: room.state.currentTrackId,
        title: current?.title ?? null,
        isPlaying: room.state.isPlaying,
        isHost: room.isHost,
        peers: room.roster.length,
        offsetMs: room.offsetMs,
      }),
    }
  }, [handle, room, current])

  const add = (track: Track) => room.send({type: 'enqueue', track})

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 p-4 lg:flex-row">
      <section className="flex-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <div ref={containerRef} className="h-full w-full" />
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center">
              <p className="text-sm text-neutral-300">
                Could not load the YouTube player. An ad or privacy blocker may be
                stopping it. Reload the page to try again.
              </p>
            </div>
          )}
          {localBlock && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
              <p className="text-sm text-neutral-300">
                {localBlock === 'embed-blocked'
                  ? "This video can't be played here — it may be blocked in your region."
                  : 'This video is unavailable for you.'}
              </p>
              <button
                onClick={() => {
                  const trackId = trackIdRef.current
                  if (trackId) room.send({type: 'unplayable', trackId, reason: localBlock})
                }}
                className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm hover:border-neutral-400"
              >
                Skip for everyone
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => room.send({type: 'skip'})}
            disabled={room.state.queue.length === 0}
            data-testid="skip"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500 disabled:opacity-40"
          >
            Skip
          </button>
          <p className="truncate text-sm text-neutral-400" data-testid="now-playing">
            {current ? current.title : 'Nothing playing'}
          </p>
          {resyncing && <span className="text-xs text-amber-400">resyncing…</span>}
        </div>
      </section>

      <aside className="flex w-full flex-col gap-4 lg:w-96">
        <div className="flex items-center justify-between text-sm">
          <code className="rounded bg-neutral-900 px-2 py-1" data-testid="room-code">
            {code}
          </code>
          <span className="text-neutral-500" data-testid="status">
            {room.status === 'connected'
              ? `${room.roster.length} watching${room.isHost ? ' · host' : ''}`
              : room.status === 'blocked'
                ? 'network blocked'
                : 'connecting…'}
          </span>
        </div>

        {room.warning && (
          <p className="rounded-lg bg-amber-950/60 px-3 py-2 text-sm text-amber-300">
            {room.warning}
          </p>
        )}

        <AddTrackForm onAdd={add} addedBy={{peerId: room.selfId, name}} />
        <Queue state={room.state} onRemove={id => room.send({type: 'remove', trackId: id})} />
      </aside>
    </main>
  )
}
```

- [ ] **Step 9: Chrome MCP verification — the whole product**

Build and serve a production bundle: `npm run build && npm run start`. Do **not** use `npm run dev` — React Strict Mode double-invokes effects and races Trystero's room cache, so two tabs intermittently both believe they are host. That is a dev-only ghost and it will waste your time.

Open tab A via `tabs_create_mcp` to `http://localhost:3000`. Before doing anything else, call `read_console_messages` once with any pattern to begin capture, then reload — console tracking only starts when that tool is first called on a tab, so page-load errors are otherwise invisible and you would report a clean console you never observed. Repeat that capture-then-reload on tab B once it exists.

Then click "Start a room" in tab A and read the resulting `/r/<code>` URL. Open tab B with `tabs_create_mcp` to that same URL.

Walk through, using `computer` to click and `form_input` to type, and `read_page` to check results. Note that ref-based clicks have been seen to silently no-op; if a click appears to do nothing, retry with coordinates.

1. Both tabs show `2 watching`, exactly one marked `host`.
2. Paste `https://youtu.be/dQw4w9WgXcQ` into tab A's add field and submit. Both tabs show the track with its title, author, and a real duration (`3:33`), not `—`. A `—` means the duration probe failed — check the console before moving on.
3. Both tabs render an `iframe` and show the title under the player.
4. Add `https://www.youtube.com/watch?v=9bZkp7q19f0` from **tab B**. Both queues show two items.
5. Click Skip in tab B. Both tabs move to the same new title.
6. Remove a track in tab A. It disappears from both.
7. Paste `https://vimeo.com/12345` into tab A. The "not a YouTube link" error shows and the queue is unchanged.
8. `read_console_messages` with pattern `error|warn` on both tabs. Expect no React key warnings, no unhandled rejections, no repeated WebRTC failures.

Leave both tabs open — Task 16 measures sync on this same pair.

- [ ] **Step 10: Commit**

```bash
git add lib/format-duration.ts lib/format-duration.test.ts app/r components/
git commit -m "feat: room UI with synced player, queue, and add-by-URL"
```

---

### Task 15: Two-browser end-to-end test

Encodes the actual product claim so a regression cannot pass silently.

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/sync.spec.ts`
- Modify: `package.json` (add `test:e2e`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the running app
- Produces: `npm run test:e2e`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write the config**

Create `playwright.config.ts`. Timeouts are generous because peer discovery goes through public relays:

```ts
import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {timeout: 30_000},
  fullyParallel: false,
  workers: 1,
  use: {baseURL: 'http://localhost:3000'},
  webServer: {
    // A production build, never `npm run dev`. React Strict Mode double-invokes
    // effects in development, and Trystero caches rooms by id while `leave()`
    // tears down asynchronously — so the phantom mount races the surviving one
    // and two peers intermittently both believe they are host. That would make
    // this suite flaky for reasons that have nothing to do with sync.
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
```

- [ ] **Step 3: Add the script**

Add to `"scripts"` in `package.json`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Ignore Playwright output**

Append to `.gitignore`:

```
/test-results/
/playwright-report/
```

- [ ] **Step 5: Write the test**

Create `e2e/sync.spec.ts`:

```ts
import {expect, test, type Page} from '@playwright/test'

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const SECOND_VIDEO_URL = 'https://www.youtube.com/watch?v=9bZkp7q19f0'
/**
 * Creates a fresh room through the real UI and returns its code.
 *
 * Never hardcode a room code in this suite. Rooms are discovered over a public
 * relay network, so a fixed code names a room anyone in the world may already
 * be sitting in — and the obvious candidate doubles as the join field's
 * placeholder text, which makes it the single most discoverable room the app
 * has. A test asserting "2 watching" that fails because a stranger wandered in
 * is failing for no reason of its own. Creating a room per run also exercises
 * the create flow, which a fixed code never touches.
 */
async function startRoom(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', {name: 'Start a room'}).click()
  await expect(page.getByTestId('room-code')).toBeVisible()
  return (await page.getByTestId('room-code').innerText()).trim()
}

async function joinRoom(page: Page, name: string, room: string) {
  await page.goto('/')
  await page.getByLabel('Your name').fill(name)
  await page.getByPlaceholder('ember-otter-k7qm').fill(room)
  await page.getByRole('button', {name: 'Join'}).click()
  await expect(page.getByTestId('room-code')).toHaveText(room)
}

test('two peers share a queue and converge on the same position', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const room = await startRoom(host, 'host')
  await joinRoom(guest, 'guest', room)

  // Both peers must see each other before anything is shared.
  await expect(host.getByTestId('status')).toContainText('2 watching')
  await expect(guest.getByTestId('status')).toContainText('2 watching')

  await host.getByTestId('add-url').fill(VIDEO_URL)
  await host.getByTestId('add-submit').click()

  // The queue replicates to the peer that did not add it.
  await expect(guest.getByTestId('queue-item')).toHaveCount(1)
  await expect(guest.getByTestId('now-playing')).not.toHaveText('Nothing playing')

  // Give both players time to start and the drift loop time to settle.
  await host.waitForTimeout(15_000)

  // Both peers mounted a real player for the same track.
  await expect(host.locator('iframe')).toHaveCount(1)
  await expect(guest.locator('iframe')).toHaveCount(1)
  await expect(guest.getByTestId('now-playing')).toHaveText(
    await host.getByTestId('now-playing').innerText(),
  )

  // A second track, added by the *guest*, so replication is proven both ways.
  await guest.getByTestId('add-url').fill(SECOND_VIDEO_URL)
  await guest.getByTestId('add-submit').click()
  await expect(host.getByTestId('queue-item')).toHaveCount(2)

  // Skipping on one peer must move the other to the same, different track.
  const before = await host.getByTestId('now-playing').innerText()
  await host.getByTestId('skip').click()
  await expect(host.getByTestId('now-playing')).not.toHaveText(before)
  await expect(guest.getByTestId('now-playing')).toHaveText(
    await host.getByTestId('now-playing').innerText(),
  )

  await hostContext.close()
  await guestContext.close()
})

test('a malformed link is rejected without touching the queue', async ({page}) => {
  // Its own freshly created room, so neither the previous test nor a stranger
  // on the relay network can bleed in.
  await startRoom(page, 'solo')
  await page.getByTestId('add-url').fill('https://vimeo.com/12345')
  await page.getByTestId('add-submit').click()
  await expect(page.getByText('That is not a YouTube link.')).toBeVisible()
  await expect(page.getByTestId('queue-item')).toHaveCount(0)
})
```

> **Known limitation:** the YouTube iframe is cross-origin, so Playwright cannot read the true playback position from it. This test proves peers connect, replicate the queue, and both load a player. Verifying that positions actually match is the manual check in Task 14 Step 9. Closing that gap properly means exposing the player's current time on `window` behind a test-only flag — worth doing, but scoped to a later task rather than smuggled in here.

- [ ] **Step 6: Run the test**

Run: `npm run test:e2e`
Expected: both tests PASS. If peer discovery times out, confirm the relays are reachable before assuming a code defect — this suite depends on the public Nostr network.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json .gitignore
git commit -m "test: two-browser end-to-end sync coverage"
```

---

### Task 16: Chrome MCP sync measurement

The product claim is "same video, same position." Vitest proves the drift *math*; Playwright proves peers connect. Neither proves two real browsers actually land on the same second. This task does, and it is the acceptance gate for phase 1.

**Files:**
- Create: `docs/superpowers/plans/results/2026-08-14-sync-measurement.md`

**Interfaces:**
- Consumes: `window.__watchTogether.readAt()` from Task 14
- Produces: a recorded measurement, committed as evidence

- [ ] **Step 1: Set up two peers on a long video**

A **production** server and two tabs on one room are normally still running from Task 14 — reuse them. Never use `npm run dev` here: Strict Mode double-invokes effects and races the room cache, and the instrumentation hook this task depends on is only meaningful in the build users actually run. If the server or tabs are gone, rebuild with `npm run build && npm run start` and re-create a room through the UI.

Queue a video **at least ten minutes long**, so a track ending cannot disturb the measurements. Do not trust a hardcoded id from this plan to still exist — pick one, add it, and confirm its real title and duration appear in the queue before measuring. A dead id would otherwise look like a sync failure.

Let playback run for **30 seconds** before measuring, so the clock estimator has its burst plus at least one resample, and the drift loop has had time to act.

- [ ] **Step 2: Measure drift**

Reading two tabs takes two separate calls, so the wall-clock gap between them must be subtracted or it shows up as fake drift. Run `javascript_tool` in tab A, then immediately in tab B:

```js
console.log('[sync]', JSON.stringify(window.__watchTogether.readAt()))
```

Collect both with `read_console_messages` using pattern `\[sync\]`, then compute:

```
elapsed = (B.at - A.at) / 1000
drift   = (B.position - A.position) - elapsed
```

Repeat **five times**, roughly five seconds apart.

- [ ] **Step 3: Judge the result**

Expected: `|drift| < 0.5s` on at least four of five samples, and never above 1.5s.

If drift is consistently large and **positive or negative in a stable direction**, the clock offset is wrong — check that `offsetMs` is non-null in the guest's reading and that `bestOffset` is picking the low-RTT sample.

If drift oscillates between large positive and negative values, anti-thrash is not working — verify `lastCorrectionAt` and `lastSeekAt` are actually being set after each seek.

If `offsetMs` is `null` on the guest, no beat is reaching it; confirm the host's beat timer is running and not gated on a non-null track.

- [ ] **Step 4: Verify pause and seek propagate**

1. `computer` click the player in tab A to pause. Wait 2 seconds, then `readAt()` in both: `isPlaying` false in both, and positions within 0.5s.
2. Click again to resume. Both report `isPlaying` true.
3. In the **host** tab, use the YouTube progress bar to seek roughly halfway. Within ~3 seconds both `readAt()` positions should agree within 1.5s.

> **Seek only from the host.** A guest cannot move the room's position in phase 1: no UI emits a `seek` intent, and `use-player.ts` has no seek detection — dragging the progress bar produces BUFFERING then PLAYING, which maps to a positionless `play` intent. The drift loop therefore pulls a guest's seek back within a few seconds. **That is the designed behaviour, not a bug**, and no amount of suppression tuning changes it. The host's seek propagates for free, because the heartbeat carries the host's live `getCurrentTime()`.
>
> Guest-initiated seek is deferred. Building it means detecting a position discontinuity in `onStateChange` and emitting `{type: 'seek', position}` — the reducer and the `seek` intent already exist and are tested, so only the detection is missing.

- [ ] **Step 5: Record the evidence**

Write the five drift samples and the pause/seek results to `docs/superpowers/plans/results/2026-08-14-sync-measurement.md`, including the video used, the observed `offsetMs` on the guest, and anything that needed a retry. State plainly if a criterion was not met rather than rounding in the app's favor.

- [ ] **Step 6: Close tabs and commit**

Navigate both tabs to the app's landing page (`http://localhost:3000/`) rather than closing them — `tabs_close_mcp` correlated with extension tab-group resets that orphaned tabs no tool could reach. Leave the tabs themselves open and report their ids; the controller stops the server.

```bash
git add docs/superpowers/plans/results/
git commit -m "test: recorded two-browser sync measurement for phase 1"
```

---

## Phase 1 done

At this point: two people open one link, share a queue, and watch in sync. Phases 2 (chat, presence, GIFs) and 3 (mobile gate, host migration, TURN) get their own plans.

Before considering the phase complete, all three layers must pass:

```bash
npm test          # every pure module
npm run test:e2e  # peers connect, queue replicates, skip propagates
```

plus Task 16's recorded Chrome MCP measurement showing drift under 0.5s. A green `npm test` alone does not mean the app works — the pure logic can be perfect while the peers never find each other.
