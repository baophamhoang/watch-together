# Known limitations

What this app deliberately does not do yet, and what to know before working on
it. Written at the end of phase 2 (chat, presence, GIF picker, phone support,
UI rebuild) on top of the phase 1 sync core.

## Deferred by design

**Host migration.** One peer is authoritative. If the host closes their tab, a
new host is elected — but the room's state does not survive the handover
intact, so the queue can jump. Elections themselves work and are tested.

**No TURN fallback.** Connections are peer-to-peer over WebRTC with public
signalling only. Two people behind strict symmetric NATs will fail to connect
at all, and there is no relay to fall back to. This is the cost of the
zero-infrastructure design, and it is the single most likely reason for "it
just won't connect" reports.

**Guests cannot seek.** Anyone can play, pause, skip and add — the control
model is deliberately free-for-all — but scrubbing the timeline is host-only.
A guest's seek is not replicated.

**Concurrent adds can flicker.** Two people pasting a link at the same instant
can briefly see the queue reorder before it settles. The fix is a per-peer
sequence number on intents so the host can order them deterministically; the
replication protocol has no such ordering today.

**Inbound room state is not validated.** Chat messages are validated on arrival
and nicknames are clamped, but roster and state broadcasts are not — they are
trusted because they are gated on host identity. That gate is real, so the
exposure is narrow, but the asymmetry is deliberate rather than complete. The
fix is an `isRoomState` guard beside `isChatMessage` in `lib/chat/messages.ts`,
not a coercion at the point of use.

One concrete consequence, if two versions of the app ever meet: `RoomState`
gained a `trackRun` counter in phase 2, and a peer running older code would
broadcast state without it. That cannot throw, but `startTrack`'s `trackRun + 1`
is reachable from wire-received state on a guest, so the field becomes `NaN` —
and since `NaN !== NaN`, the load guard stops short-circuiting and can reload
the player repeatedly. Irrelevant to a single deployment; the reason a validator
is the right fix rather than a default value.

**Tabs have no arrow-key support.** The queue/chat tabs claim `role="tablist"`,
which promises Left/Right navigation and a roving tabindex. They are reachable
by Tab and usable, but the promise is not fully kept.

**The GIF picker has no focus trap.** Escape closes it and returns focus to the
button that opened it, but tabbing past the last result leaves the popover, and
there is no click-outside dismissal.

**GIFs have no intrinsic dimensions**, so the chat log reflows slightly as each
one loads. Giphy returns the dimensions; they are discarded in `mapGiphy`.

## Environment gotchas

**Verify against a production build, never `next dev`.** Strict Mode
double-invokes effects, and Trystero caches rooms by id while `leave()` tears
down asynchronously — so a phantom mount races the surviving one and two peers
intermittently both believe they are host. This makes anything sync-related
flaky for reasons that have nothing to do with sync.

**To check whether port 3000 is free, use `lsof -i:3000 -sTCP:LISTEN`.** Plain
`lsof -ti:3000` also matches client sockets from editors and browsers, and will
report the port busy when nothing is listening.

**YouTube will not load media in a hidden or occluded tab.** Videos stall at
`BUFFERING` with `duration: 0` and never advance. This is not an app defect —
it reproduces on youtube.com with no app involved — but it makes automated
playback measurement impossible unless the browser window is genuinely
foregrounded. The phase 1 drift-measurement gate has never run for this reason;
a headed run in a foregrounded window is the most promising way to get it.

**`<img>` is intentional in `Queue`, `ChatPanel` and `GifPicker`**, with local
lint suppressions explaining each. `next/image` would proxy up to 18 animated
GIFs through our own server for no optimisation benefit, and in the chat log the
URL comes from an untrusted peer, which an allowlist cannot express without
becoming an open image proxy.

## Design constraints worth not breaking

**`components/Room.tsx` has no unit tests by design** — it is covered by the
Playwright suite. Six of phase 2's eight tasks edited it. The presence-toast and
unread-count logic in it are pure functions of room state and would be the
natural first extraction into `lib/`, where they would fall inside the unit-test
boundary.

**The `onActivate` closure in `Room.tsx` must not be memoized.** Its
`if (!handle) return` guard is correct only because the inline closure is
rebuilt when the player becomes ready. A `useCallback` there capturing a stale
`handle` would turn "the user is stranded" into "the gate is permanently
stuck". There is a comment saying so at the call site.

**Design tokens are enforced by grep, not by convention.** `docs/superpowers/
plans/2026-08-15-watch-together-phase-2-social-and-ui.md` (Step 3) carries two
sweeps — one for colours and radii, one for spacing. Colour violations sat at
zero for the whole of phase 2 because that sweep existed; spacing violations
accumulated to 22 across eight tasks because it did not. Keep both, and keep
`--include="*.tsx"` quoted or zsh kills the command before grep runs.
