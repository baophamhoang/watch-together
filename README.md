# Watch Together

Watch YouTube videos in sync with friends. Paste a link, it lands in a
shared queue, and everyone's player follows along together.

There's no server and no accounts. Peers connect directly to each other
over WebRTC (via [Trystero](https://github.com/dmotz/trystero)), finding
each other by room code through public Nostr relays. One peer is elected
host and holds the authoritative queue and playback state; everyone else
sends intents (play, pause, skip, add, remove) and reconciles against the
host's broadcasts, correcting drift by seeking against the host's
heartbeat.

## Running it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

No API keys are needed. Video metadata comes from YouTube's keyless oEmbed
endpoint, and playback uses the official YouTube IFrame Player API.

WebRTC requires a secure context: `localhost` works without HTTPS, but
reaching this from another device needs the app served over HTTPS.

## Testing

```bash
npm test          # unit tests (vitest)
npm run test:e2e  # two-browser Playwright suite, against a production build
```

## Current limits

This is an early phase of the project. There's no chat, no GIFs, and no
mobile-specific gating yet, and guests can't seek the shared player —
playback is driven by the host's play/pause/skip, and a guest's own seek
gets corrected back by the drift-sync loop.
