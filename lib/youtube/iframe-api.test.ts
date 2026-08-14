// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest'
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

  it('rejects with a distinct message if the ready callback never fires', async () => {
    vi.useFakeTimers()
    try {
      const promise = loadIframeApi()
      const assertion = expect(promise).rejects.toThrow(/Timed out/)
      // onerror never firing (a filtered response, an extension neutering the
      // script) must not hang the promise forever the way it did before.
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }

    // Retrying after a timeout must work exactly like retrying after onerror.
    const retry = loadIframeApi()
    const stub = {Player: function () {}}
    ;(window as {YT?: unknown}).YT = stub
    window.onYouTubeIframeAPIReady?.()
    await expect(retry).resolves.toBe(stub)
  })
})
