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
  await page.getByPlaceholder('word-word-abcd').fill(room)
  await page.getByRole('button', {name: 'Join'}).click()
  await expect(page.getByTestId('room-code')).toHaveText(room)
}

type DebugSnapshot = {at: number; position: number | null}

/**
 * Reads window.__watchTogether, the debug instrumentation gated behind
 * NEXT_PUBLIC_WT_DEBUG (which playwright.config.ts sets for this suite's
 * webServer). The YouTube iframe is cross-origin, so this is the only way to
 * read what a given peer is actually playing.
 */
const read = (page: Page) =>
  page.evaluate(() => {
    const debug = (window as unknown as {__watchTogether?: {readAt(): DebugSnapshot}})
      .__watchTogether
    if (!debug) throw new Error('window.__watchTogether is missing — is NEXT_PUBLIC_WT_DEBUG set?')
    return debug.readAt()
  })

test('two peers share a queue and converge on the same track', async ({browser}) => {
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

  // Give both players time to start. Nothing below measures the drift loop,
  // so this only needs to cover player startup, not settling — see the
  // dedicated position/drift test below for that.
  await host.waitForTimeout(5_000)

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

/**
 * A regression guard against gross desync (and against the debug hook
 * disappearing), not the precise 0.5s product target — that is a separate
 * manual measurement procedure. The bound here is deliberately generous.
 */
test('two peers converge on the same playback position', async ({browser}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  const room = await startRoom(host, 'host')
  await joinRoom(guest, 'guest', room)

  await expect(host.getByTestId('status')).toContainText('2 watching')
  await expect(guest.getByTestId('status')).toContainText('2 watching')

  await host.getByTestId('add-url').fill(VIDEO_URL)
  await host.getByTestId('add-submit').click()
  await expect(guest.getByTestId('now-playing')).not.toHaveText('Nothing playing')
  await expect(host.locator('iframe')).toHaveCount(1)
  await expect(guest.locator('iframe')).toHaveCount(1)

  // Let playback actually start and the guest's 1s drift-correction loop run
  // several passes before comparing positions.
  await host.waitForTimeout(10_000)

  const a = await read(host)
  const b = await read(guest)

  expect(a.position, 'host position').not.toBeNull()
  expect(b.position, 'guest position').not.toBeNull()

  // Subtracting the wall-clock gap between the two reads, or that gap alone
  // registers as fake drift. The non-null assertions are safe here: the
  // expect() calls above already failed the test if either was null.
  const elapsed = (b.at - a.at) / 1000
  const drift = b.position! - a.position! - elapsed

  expect(Math.abs(drift)).toBeLessThan(2)

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
