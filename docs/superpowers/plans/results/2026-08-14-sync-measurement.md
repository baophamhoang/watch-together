# Task 16: Chrome MCP sync measurement

Date: 2026-08-14
Room: `frosty-fern-mcf5` — tab A (host) `1124441564`, tab B (guest) `1124441567`
Build under test: production (`npm run build && npm run start`), already running on port 3000 at dispatch.

## Verdict

**BLOCKED.** The instrumentation, video metadata, clock-offset estimation, and roster/presence
layers all check out. The one thing this task exists to prove — that two peers sustain playback
in sync — could not be validated, because real YouTube playback would not sustain in this browser
session for **any** video tested, including outside the app entirely. The app's own connection
layer also self-reported `network blocked` partway through. This looks like a genuine environment
problem, not a defect traceable to the sync/drift-correction code, but I cannot rule out with full
confidence that the app is blameless — see "Diagnosis" below for the reasoning and its limits.

All five required drift samples were taken and are reported below exactly as measured, including
the two retries the video-selection problem forced (see "What needed a retry").

## Step 1: instrumentation hook

`window.__watchTogether.readAt()` in both tabs returned a well-formed object with `position`,
`trackId`, `isPlaying`, `isHost`, `peers`, `offsetMs` on the first call, before any other action:

- Tab A (host): `{"position":0,"trackId":"5e7fdf3b-...","isPlaying":true,"isHost":true,"peers":2,"offsetMs":null}`
- Tab B (guest): `{"position":2.3015,"trackId":"5e7fdf3b-...","isPlaying":true,"isHost":false,"peers":2,"offsetMs":2}`

Hook confirmed working on both tabs. `offsetMs` correctly `null` on host, non-null on guest.

## Step 2: video queued

Added `https://www.youtube.com/watch?v=b8u2CQLQBVU` ("Lecture 1, Part I: Introduction of the
Class", MIT OpenCourseWare, 6.44M subscribers, 259K views) via the host's add form. Confirmed in
the app's queue panel with real title and **17:51** duration (later re-confirmed as **17:50** on
youtube.com directly — YouTube's own duration display is inconsistent by a second between surfaces,
not an app bug) — comfortably over the 10-minute floor. Confirmed independently on a separate,
non-app YouTube tab that the video is real, public, and not deleted/region-locked.

## What needed a retry

The originally-queued long video never produced advancing playback (see Diagnosis). Before
concluding this was a real product defect, I ruled out "dead video" by:

1. Testing the same video ID directly on `www.youtube.com` in an unrelated tab — also stalled
   indefinitely on a buffering spinner.
2. Switching to a completely different, extremely popular 20-minute video (TED, "Do schools kill
   creativity?", `iG9CE55wbtY`, 24M views) on bare youtube.com — pre-roll ads played and rendered
   correctly, but the actual talk content also stalled on the buffering spinner after being started.
3. Reloading both app tabs (fresh room state, fresh player instances, fresh peer connection) and
   re-queuing the MIT lecture — reproduced the identical stall pattern: host frozen at exactly
   `0`, guest frozen at exactly `1.3015`, bit-identical across all subsequent reads.
4. Skipping back to the original short video (Gangnam Style, which *had* advanced normally in the
   very first reading of the session) — it also failed to advance on retry, confirming the stall
   was not specific to the long video.

None of these retries fixed playback. The five samples below were taken against the frozen state
because, per the task's own instruction, the honest number is more useful than a re-run chosen to
look better — and because by this point there was no version of the room that produced advancing
playback to sample instead.

## Step 3: five drift samples

Taken against the post-reload MIT lecture track (`f2fe92ec-...`), host position frozen at `0`,
guest position frozen at `1.3015` for the entire sampling window (22:57:14–22:58:28, ~74 seconds).

| # | A.position | A.at (epoch ms) | B.position | B.at (epoch ms) | elapsed (s) | drift (s) |
|---|-----------:|-----------------:|-----------:|-----------------:|------------:|----------:|
| 1 | 0 | 1786723034193 | 1.3015 | 1786723037998 | 3.805 | **-2.5035** |
| 2 | 0 | 1786723053013 | 1.3015 | 1786723055754 | 2.741 | **-1.4395** |
| 3 | 0 | 1786723070545 | 1.3015 | 1786723073024 | 2.479 | **-1.1775** |
| 4 | 0 | 1786723088493 | 1.3015 | 1786723091180 | 2.687 | **-1.3855** |
| 5 | 0 | 1786723105385 | 1.3015 | 1786723107911 | 2.526 | **-1.2245** |

`drift = (B.position - A.position) - elapsed`

**Result: 0 of 5 samples pass `|drift| < 0.5s`. Sample 1 exceeds the 1.5s hard ceiling.** This is
an unambiguous fail against the stated threshold, full stop.

## Diagnosis

This does **not** match any of the three failure shapes the task brief anticipated:

- Not "consistently large drift in a stable direction" from a bad clock offset — `offsetMs` was
  non-null throughout and stayed small (observed values: 0, 0.5, 1, -0.5, 2.5, all in
  milliseconds-equivalent-of-seconds range, i.e. negligible).
- Not oscillating anti-thrash — the position values are **bit-identical** across every read
  spanning more than a minute (`0` on host, `1.3015` on guest), not bouncing between values.
- Not `offsetMs: null` on the guest — it was populated on every read.

What's actually happening: `position` in `readAt()` is a direct, unmodified call to the YouTube
IFrame API's `getCurrentTime()` (verified by reading `lib/youtube/use-player.ts` and
`components/Room.tsx` — there is no app-level extrapolation of this value). Both host's and guest's
real players stopped advancing within a couple of seconds of every track load, and the freeze
reproduced on:

- Two different videos (the MIT lecture and Gangnam Style) in the app.
- A third, unrelated, extremely popular video (a TED talk) on plain `youtube.com`, no app
  involved at all.
- Before and after a full page reload that rebuilt the peer connection and player instances from
  scratch.

The stalled `position` reads are therefore genuine — the local YouTube players were not actually
playing, not an artifact of the sync math or of `readAt()` itself.

Two corroborating signals point at the environment rather than the sync algorithm:

1. **The app's own connection status flipped to `network blocked`** on the host tab partway
   through (visible in the UI top-right, replacing "2 watching · host"). Reading
   `lib/sync/use-room.ts` line 46 confirms this is set exclusively by Trystero's `onJoinError`
   callback — the peer-to-peer signaling/room-join layer itself reported a failure. This did not
   appear on the guest tab, which kept showing "2 watching" normally throughout.
2. **A reproducible console error on the guest**, present in both the pre-reload and post-reload
   sessions (not a one-off): `Trystero peer error: OperationError: User-Initiated Abort,
   reason=Close called`, at 9:51:39 PM and again at 10:55:34 PM.

My best-effort read: this sandboxed browser session has some network condition — plausibly
outbound restrictions or throttling on long-lived streaming/WebSocket connections — that degrades
both YouTube's video CDN and Trystero's signaling relay independently, rather than a bug in this
app's drift-correction logic. I want to flag the limits of that conclusion honestly, though: my own
diagnostic process involved several rapid YouTube searches and video loads across three tabs in a
short window while chasing the "dead video" hypothesis, which is exactly the kind of traffic
pattern that can trip YouTube's own anti-automation throttling for a session/IP. I cannot fully
separate "this environment was already going to fail" from "my diagnosis made it worse." The
`network blocked` / Trystero-abort evidence is harder to pin on my own YouTube browsing (it's a
separate service), which is why I lean toward "environment," but I'm not certifying it.

**Recommendation: re-run this measurement in a clean session** — fresh browser profile/tabs, no
prior YouTube browsing in the same session — before treating either verdict (pass or fail) as final
for the actual sync algorithm.

## Step 4: pause / resume / seek propagation

Not meaningfully testable, and I'm reporting that plainly rather than forcing a result:

1. **Pause**: clicked the host's player at the point buffering was shown. `isPlaying` stayed
   `true` on both tabs afterward — the click did not register as a pause. Consistent with the
   YouTube player never having reached a real `PLAYING` state to leave from (per
   `use-player.ts`, the app only reacts to genuine `PAUSED`/`PLAYING` `onStateChange` events).
2. **Resume**: not reached, since pause did not take effect.
3. **Seek via guest progress bar**: the guest's embedded player was rendering a fully black frame
   with only auto-generated caption text (`[SQUEAKING] [RUSTLING] [CLICKING]`) and no visible
   YouTube control chrome — no progress bar was present to drag, on click or on hover.

## Console findings

- **Guest (`1124441567`)**: `Trystero peer error: OperationError: User-Initiated Abort,
  reason=Close called` — occurred twice, once in the original session (9:51:39 PM) and again
  after the reload (10:55:34 PM). Reproducible, not a fluke.
- **Host (`1124441564`)**: no console errors captured at any point (capture was live for the
  full session after the first `read_console_messages` call).

## What passed cleanly

- `window.__watchTogether.readAt()` — well-formed on both tabs, every field present and typed
  correctly, throughout the entire session including after reload.
- Video metadata fetch — real title, real channel, real duration, correctly surfaced in the queue
  UI before playback was trusted to start.
- Clock offset estimation — non-null on the guest at all times, small and stable values.
- Roster/presence — `peers: 2` stable on both tabs for the entire session, including through the
  `network blocked` state on host.

## Environment notes

- Server: production build, already running at dispatch; not restarted.
- Tabs were reused as instructed; `tabs_close_mcp` was never called.
- Both tabs navigated to `http://localhost:3000/` at the end and left open; server left running.
