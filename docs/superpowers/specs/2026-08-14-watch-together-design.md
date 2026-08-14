# Watch Together — Design

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan

## Summary

A web app for watching YouTube together with friends: one shared queue, one
synchronized player, chat with GIFs, and a link that is the entire invite. No
accounts, no backend to operate.

Modeled on [boombox](https://github.com/tinspham209/boombox) feature-wise, but
not code-wise. Boombox is currently broken in the ways this design specifically
addresses.

## Goals

- Two to five friends watch the same YouTube video in lockstep, at the same
  position, with sub-second drift.
- Anyone can add videos by pasting a URL, and anyone can play, pause, seek,
  skip, remove, or reorder.
- Chat alongside the video, with a GIF picker on the message input.
- Works on a phone, not just a desktop browser.
- Zero infrastructure: no database, no realtime service, no accounts, no
  always-on server.

## Non-goals

- In-app YouTube search, playlist import, and channel browsing. All three need a
  YouTube Data API key; we deliberately chose URL-paste only. The URL parser
  should stay isolated enough that adding search later is additive.
- Rooms that outlive everyone leaving. Without a server there is nowhere for
  state to live. See "Future: headless keeper" for the escape hatch.
- Persistent chat history, moderation, or any permission model beyond "everyone
  in the room can do everything."
- Video sources other than YouTube.

## What we are fixing from the reference

Three concrete defects, each of which drives a design decision below.

**Metadata came from a stranger's server.** Boombox fetched titles and durations
from `ytb-video-finder.vercel.app`, a third-party deployment that no longer
responds. Every add fails at that fetch, which is the "can't add videos" symptom.
We use only official, keyless YouTube endpoints.

**Sync had no reference clock.** Every peer broadcast its own `currentTime` on
play and pause, and receivers corrected only when they were more than five
seconds off. There was no authority and no clock-offset estimation, so five
seconds of drift was the *design tolerance*, not the worst case.

**Queue identity was the video ID.** The same video could not be queued twice,
and merges were a union that could not express deletion.

## Architecture

```
        ┌──────── Nostr relays (signaling only) ────────┐
        │   peers discover each other, exchange SDP     │
        └───────────────────────────────────────────────┘
                            │  (never carries app data)
                            ▼
    guest ──── WebRTC data channel ────► HOST ◄──── WebRTC data channel ──── guest
                 intents                (authority)         intents
                            ◄──── state broadcasts ────►

    Next.js route handlers (stateless, no room knowledge):
      /api/oembed  → YouTube title/author/thumbnail   (keyless)
      /api/gifs    → Giphy search proxy               (server-side key)
      /api/ice     → TURN credentials                 (optional)
```

Peer transport is [Trystero](https://github.com/dmotz/trystero) v0.25.x, using
its default Nostr strategy. Trystero provides rooms, presence, typed broadcast
actions, request/response actions, round-trip timing, and end-to-end encryption
of signaling. It is actively maintained (last publish July 2026), unlike PeerJS
(June 2025), which is the library boombox depends on.

Nostr is Trystero's most redundant strategy. Switching to MQTT or BitTorrent is a
single import change, so the strategy is isolated behind our own module rather
than imported directly by components.

The Next.js server exists only for the three route handlers. It holds no room
state, so the app still works as a static-ish deployment and the P2P design is
uncompromised.

### Approaches considered

**Host-authoritative star (chosen).** One peer owns the canonical state. Others
send intents and apply optimistically. Single-writer semantics make conflict
resolution trivial and give drift correction a reference clock. Cost: the host
leaving requires migration.

**Leaderless mesh (rejected).** Boombox's model. Appealing because there is no
host to lose, but playback position is inherently a single-writer value —
last-write-wins across peers produces jitter with nothing to converge toward.
This is the root cause of the reference's sync quality.

**Headless keeper peer (deferred).** Trystero peers can run on Node/Bun, so a
tiny always-on process could hold the room. This is infrastructure, which the
zero-ops constraint rules out. It is a drop-in later without protocol changes,
because the keeper would simply be a host that never leaves.

## Data model

```ts
type Track = {
  id: string              // uuid — queue identity, NOT the video id
  videoId: string         // 11-char YouTube id
  title: string
  author: string
  thumbnail: string
  durationSec: number | null   // null until probed
  startAtSec: number           // from ?t=, default 0
  addedBy: {peerId: string; name: string}
  addedAt: number              // host clock, ms
  unplayable?: 'embed-blocked' | 'not-found'
}

type RoomState = {
  version: number         // host-assigned, monotonic
  queue: Track[]
  currentTrackId: string | null
  isPlaying: boolean
  position: number        // seconds into current track
  positionAt: number      // host clock (ms) when position was sampled
}
```

`id` being distinct from `videoId` is deliberate: the same video can be queued
more than once, and removal targets one specific entry.

`version` increments on every host state change. Guests discard any state
message whose version is not greater than their current one, which makes
out-of-order delivery harmless.

## Sync protocol

### Messages

Guests send **intents** targeted at the host only. The host is the sole writer.

| Action | Direction | Payload |
|---|---|---|
| `intent` | guest → host | `{type: 'play' \| 'pause' \| 'seek' \| 'skip' \| 'enqueue' \| 'remove' \| 'reorder', ...}` |
| `state` | host → all | full `RoomState` |
| `beat` | host → all | `{version, currentTrackId, isPlaying, position, hostClock}`, every 2s |
| `hello` | guest → host | request/response; returns `RoomState` + host clock |
| `clock` | guest → host | request/response; returns host clock |
| `chat` | any → all | chat messages, not host-mediated |
| `roster` | host → all | peer list with join order, for presence and election |

Chat deliberately bypasses the host: it needs no ordering guarantees and should
survive host hiccups.

### Clock offset estimation

Guests cannot compare positions without knowing the host's clock. Using the
`clock` request action, NTP-style:

```
offset ≈ t1 − (t0 + t2) / 2      rtt = t2 − t0
```

where `t0` is send time, `t1` the host clock in the reply, `t2` receive time.

Five samples on join, then one every 15 seconds. Keep a rolling window of five
and use the sample with the **lowest RTT** — that sample has the least
asymmetric-delay error. Trystero's `room.ping(peerId)` provides RTT independently
and is used for the connection-quality indicator.

### Drift correction

Expected position, when playing:

```
expected = beat.position + (nowLocal + offset − beat.hostClock) / 1000
```

When paused, `expected = beat.position`.

| Drift | Response |
|---|---|
| < 0.5s | nothing — dead zone |
| 0.5s–2s | `seekTo(expected + seekLatency)` |
| > 2s | same, plus a brief "resyncing" indicator |

Two refinements make the seek land accurately. **Lead compensation:** a seek takes
time to buffer and resume, so by the time playback restarts the target has moved.
We seek to `expected + seekLatency`, where `seekLatency` is measured from recent
seeks (initially 300ms) rather than assumed. **Anti-thrash:** at most one
correction every 3 seconds, and no correction within 2 seconds of any seek,
including user-initiated ones. Without this, a marginal drift oscillates.

A 0.5-second dead zone is well inside what co-watchers notice, and an order of
magnitude tighter than the reference's five seconds — enough that nobody reacts
to a joke before someone else hears it.

> **Rejected: playback-rate nudging.** The obvious refinement is to correct small
> drift by running at 0.95×/1.05× instead of seeking. It does not work here. The
> IFrame API rounds an unsupported `suggestedRate` *toward 1.0*, so
> `setPlaybackRate(1.05)` is silently a no-op, and the nearest real rate (1.25×)
> is far too coarse to be unobtrusive. Do not reintroduce this without first
> checking `getAvailablePlaybackRates()` at runtime.

### Optimistic application

A guest pressing pause applies it locally at once and marks the change pending.
The host's next `state` (higher version) confirms it. If no confirmation arrives
within 2 seconds, the guest reverts and shows "lost connection to host". This
keeps the UI instant while the host stays authoritative.

### Auto-advance

Only the host advances the queue when a video ends. Guests report the end event
but do not act, which prevents double-skips.

## Room lifecycle

Room codes are two words from a 512-word list plus two digits
(`ember-otter-42`), roughly 26 million combinations. The room URL `/r/ember-otter-42`
*is* the invite. Trystero derives its signaling encryption key from the app ID
and room ID, so a peer without the exact code cannot join or read signaling.

Joining and creating are the same action: join the Trystero room, listen for an
existing host's `beat` for 1.5 seconds, and self-promote if none arrives.

Two people opening the link at the same moment will both self-promote. This is
expected, and resolved rather than prevented: on hearing a `beat` from another
host, both run the same pure tiebreak — **lowest peer ID wins** — and the loser
demotes itself, discards its own state, and re-syncs via `hello`. Peer IDs are
random and identical on both sides, so both peers reach the same verdict without
negotiating. Losing state here is safe because a room this young is empty.

Presence comes from `onPeerJoin`/`onPeerLeave`, surfaced as an avatar row,
join/leave toasts, and "added by" on queue items. The host assigns each peer a
monotonically increasing join order as it arrives and broadcasts the roster,
because migration needs an order every peer agrees on. The host's own order is
always 0.

### Host migration (phase 3)

When the host disconnects, survivors independently run the same pure election
function over the last roster: lowest join order wins. The winner promotes
itself, bumps `version` past anything it has seen, and broadcasts state from its
own replica. Every peer keeps a full replica, so the queue survives. Playback
position may jump by up to one heartbeat, which is acceptable.

## YouTube integration

No wrapper library. A hook over the official IFrame Player API, roughly 120
lines, because drift correction needs direct `seekTo` and `setPlaybackRate`
access and because unmaintained wrappers are how the reference got into trouble.

**URL parsing** is a pure, heavily tested module — the reference's single brittle
regex is replaced by explicit handling of `youtu.be/ID`, `watch?v=ID`,
`watch?v=ID&t=90`, `/embed/ID`, `/shorts/ID`, `/live/ID`, `m.youtube.com`,
`music.youtube.com`, URLs carrying `&list=`, and `t=` in `90`, `1m30s`, and
`90s` forms. Invalid input produces a typed error, not `false`.

**Title, author, thumbnail** come from `https://www.youtube.com/oembed`, which
requires no key. Verified live on 2026-08-14, and it returns permissive CORS
headers. We proxy it through `/api/oembed` anyway, for response caching and so a
future CORS policy change cannot break the client.

**Duration** is absent from oEmbed. Rather than scrape the watch page — precisely
what died in the reference — a hidden player *cues* the video (without playing),
reads `getDuration()`, and is torn down. Official API, no key. The prober runs on
the adding client; the resulting duration travels with the enqueue intent.

## Chat and GIFs

Chat messages broadcast peer-to-peer, hold the last 200 in memory, and are lost
on refresh. There is no server, so there is nowhere to persist them, and that
should be stated in the UI rather than silently surprising anyone.

GIFs send as CDN URLs, never bytes, so a GIF costs the same as a short text
message.

GIF search needs a provider key. Tenor, the obvious choice, was frozen to new
registrations in January 2026 and shut down on 2026-06-30, so it is not
available. Giphy's free tier is a beta key capped at 100 searches/hour and 1000/day,
which is ample for a handful of friends given debounced input and cached queries.

The provider sits behind a one-file adapter (`searchGifs(query, limit)`), and
`/api/gifs` holds the key server-side. **If `GIPHY_API_KEY` is unset, the GIF
button does not render and the rest of the app is unaffected** — so nothing in
the build depends on obtaining a key.

## UI

Dark, cinema-oriented; the video is the brightest element on screen.

Desktop is a two-column layout: player and transport controls on the left, a
right rail that tabs between Queue and Chat. Portrait phones stack the player on
top with the same tabs beneath it.

Mobile requires real work beyond responsive CSS. iOS and Android block
programmatic playback, so a joiner sees a **"Tap to watch"** gate; sync begins
only after that gesture. The same gate serves desktop as the unmute action, so
it is one mechanism rather than a mobile special case.

Playback changes made by others surface as brief toasts ("minh skipped"), which
is what keeps a free-for-all control model from feeling haunted.

## Error handling

**Video refuses to embed.** IFrame errors 101 and 150 mean embedding is
disallowed; 100 means the video is gone. If the *host* hits this, it marks the
track `unplayable` and auto-advances. If a *guest* hits it — region restrictions
differ per viewer — that guest sees an overlay explaining the video is
unavailable in their region, with a "skip for everyone" button. Silently
freezing, as the reference does, is the failure mode to avoid.

**Peers cannot connect.** Trystero's `onJoinError` fires when SDP is exchanged
but WebRTC cannot establish a path, which usually means TURN is required. This
surfaces as an explicit "your network is blocking the direct connection"
message with a link to the TURN setup note, rather than an indefinite spinner.

**TURN** is not configured initially, since STUN handles most home networks. If a
real pairing fails, `/api/ice` serves credentials from env vars into Trystero's
`turnConfig`. Cloudflare's free tier is 1,000 GB/month with no credit card.

**Relays unreachable.** A connection-status chip shows connecting, connected with
peer count, or degraded. Trystero connects to multiple Nostr relays by default.

**Host disappears.** Before migration ships (phase 3), guests see "the host left
— this room has ended" with a button to start a fresh room seeded from their
local queue replica.

## Testing

The logic worth testing is pure and needs no network:

- `parseYouTubeUrl` — every URL shape listed above, plus malformed input
- `roomReducer` — enqueue, remove, reorder, skip, wrap-at-end, remove-the-
  currently-playing-track
- `estimateOffset` — lowest-RTT selection, window eviction
- `decideCorrection` — each rung of the drift ladder including exact boundaries,
  lead compensation, and the anti-thrash suppression window
- `electHost` — deterministic across peers, both for migration by join order and
  for the simultaneous-join tiebreak by peer ID
- `generateRoomCode` / `parseRoomCode` — round-trip, validation

Vitest for those. Playwright drives two browser contexts into one room and
asserts both converge on the same video and position, which is the only way to
test the actual product claim. The oEmbed and Giphy handlers are tested against
recorded fixtures so the suite does not depend on the network.

## File structure

```
app/
  page.tsx                    landing: nickname, create or join
  r/[code]/page.tsx           room shell
  api/oembed/route.ts
  api/gifs/route.ts
  api/ice/route.ts
lib/
  youtube/parse-url.ts        pure, tested
  youtube/iframe-api.ts       API loader (singleton)
  youtube/use-player.ts       hook over IFrame API
  youtube/probe-duration.ts   hidden-cue duration probe
  sync/types.ts               RoomState, Track, message types
  sync/room-reducer.ts        pure, tested
  sync/clock.ts               offset estimation, pure
  sync/drift.ts               correction ladder, pure, tested
  sync/election.ts            host election, pure, tested
  sync/use-room.ts            Trystero binding, the only impure piece
  chat/types.ts
  gifs/provider.ts            swappable adapter
  room-code.ts                pure, tested
components/                   presentational, no transport knowledge
```

The boundary that matters: everything under `lib/sync` except `use-room.ts` is
pure and testable, and components never touch Trystero directly.

## Phases

**Phase 1 — core.** Room join by code, synced player, shared queue, add by URL,
oEmbed metadata, duration probe, drift correction. This is the "core features
work" bar: two browsers, same video, same position.

**Phase 2 — social.** Chat, presence and toasts, GIF picker.

**Phase 3 — hardening.** Mobile layout and the tap-to-watch gate, host
migration, non-embeddable handling, TURN fallback, connection status.

## Risks

**Nostr relay availability.** Peer discovery depends on public relays. Trystero
uses several by default and MQTT is a one-line swap, but this is the single
external dependency of an otherwise self-contained app.

**NAT traversal.** The known cost of choosing P2P. Mitigated by TURN when needed;
the design keeps that a configuration change, not a rewrite.

**Giphy beta key limits.** 100 searches/hour is a real ceiling. Debouncing and
caching should keep a few friends well under it; the adapter makes swapping
providers cheap.

**Trystero API surface.** Version 0.25.x is pre-1.0 and the API may shift. It is
isolated to `use-room.ts` for exactly this reason.
