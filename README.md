# Watch Together

Watch YouTube videos in sync with friends. Paste a link, it lands in a
shared queue, and everyone's player follows along together — with chat,
emoji shortcodes, GIFs, drag-to-reorder and live presence alongside it.

There's no server and no accounts. Peers connect directly to each other
over WebRTC (via [Trystero](https://github.com/dmotz/trystero)), finding
each other by room code through public Nostr relays. One peer is elected
host and holds the authoritative queue and playback state; everyone else
sends intents (play, pause, skip, add, remove, reorder) and reconciles
against the host's broadcasts, correcting drift by seeking against the
host's heartbeat.

## Running it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Video metadata comes from YouTube's keyless oEmbed endpoint, and playback
uses the official YouTube IFrame Player API — no key needed for either.

GIFs in chat are optional and off by default. Copy `.env.example` to `.env`
and set `GIPHY_API_KEY` to a [Giphy](https://developers.giphy.com/) key to
turn them on; without it, chat still works and the GIF button simply does
not render.

WebRTC requires a secure context: `localhost` works without HTTPS, but
reaching this from another device needs the app served over HTTPS. It also
needs the two peers to actually be able to reach each other — there is no
TURN relay, so two people both behind strict/symmetric NATs may not be able
to connect at all. See [`docs/known-limitations.md`](docs/known-limitations.md)
for this and other known gaps.

## Testing

```bash
npm test          # unit tests (vitest)
npm run test:e2e  # multi-browser Playwright suite, against a production build
```

## Current limits

Guests can't seek the shared player — playback is driven by the host's
play/pause/skip, and a guest's own seek gets corrected back by the
drift-sync loop. Host migration works, but the room's state doesn't
survive the handover intact, so the queue can jump. See
[`docs/known-limitations.md`](docs/known-limitations.md) for the full list,
including deferred edge cases around concurrent queue edits.
