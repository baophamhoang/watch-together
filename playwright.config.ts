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
