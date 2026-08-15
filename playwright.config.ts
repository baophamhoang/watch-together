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
    //
    // The `rm -rf .next` is not housekeeping. NEXT_PUBLIC_ vars are baked into
    // the client bundle at build time, so the bundle on disk carries whatever
    // NEXT_PUBLIC_WT_DEBUG was — or wasn't — set for the build that produced
    // it. Any earlier `npm run build` or `next dev` in this checkout leaves a
    // .next behind whose Room.tsx guard reads `process.env.NEXT_PUBLIC_WT_DEBUG`
    // against a browser `process` shim with an empty `env`, so the guard is
    // permanently false and window.__watchTogether is never assigned. Building
    // from clean is what guarantees the inlining belongs to THIS run.
    command: 'rm -rf .next && npm run build && npm run start',
    // NEXT_PUBLIC_ vars are inlined into the client bundle at `next build`
    // time, not read at server start — and `command` runs both, so this `env`
    // must (and does) cover the build step for window.__watchTogether to
    // exist in the served bundle at all.
    env: {...process.env, NEXT_PUBLIC_WT_DEBUG: '1'},
    url: 'http://localhost:3000',
    // Deliberately false, and it must stay false. Reusing a server that is
    // already on :3000 skips `command` entirely — including the rebuild above —
    // so the suite would silently run against whatever bundle that server was
    // started with. `next start` serves the client chunks that are on disk, and
    // a stranded server from an earlier run (or a plain `npm run dev`) is
    // exactly the case where those lack the debug hook. The suite then fails on
    // "window.__watchTogether is missing", which reads like a sync defect and is
    // not one. Failing loudly on a busy port costs one `kill`; a silent reuse
    // costs an afternoon. This line protects the only instrument the suite has
    // for reading inside a cross-origin YouTube iframe.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
