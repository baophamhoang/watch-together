import {expect, test, type Page} from '@playwright/test'

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const SECOND_VIDEO_URL = 'https://www.youtube.com/watch?v=9bZkp7q19f0'
const ROOM = 'ember-otter-k7qm'

async function enterRoom(page: Page, name: string, room: string = ROOM) {
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

  await enterRoom(host, 'host')
  await enterRoom(guest, 'guest')

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
  // Its own room, so nothing from the previous test can bleed in.
  await enterRoom(page, 'solo', 'quiet-lantern-2b9x')
  await page.getByTestId('add-url').fill('https://vimeo.com/12345')
  await page.getByTestId('add-submit').click()
  await expect(page.getByText('That is not a YouTube link.')).toBeVisible()
  await expect(page.getByTestId('queue-item')).toHaveCount(0)
})
