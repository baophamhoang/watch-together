import {describe, expect, it} from 'vitest'
import {replaceShortcodes} from './replace'

describe('replaceShortcodes', () => {
  it('replaces a known shortcode', () => {
    expect(replaceShortcodes('that was :haha:')).toBe('that was 😄')
  })

  it('is case-insensitive', () => {
    expect(replaceShortcodes(':HAHA:')).toBe('😄')
  })

  it('replaces several in one message, including adjacent ones', () => {
    expect(replaceShortcodes(':fire::fire: :tada:')).toBe('🔥🔥 🎉')
  })

  // Unknown codes pass through untouched rather than being eaten. Someone
  // typing ":wat:" should see ":wat:", not an empty gap they cannot explain.
  it('leaves an unknown shortcode alone', () => {
    expect(replaceShortcodes('what :wat: even')).toBe('what :wat: even')
  })

  // The three cases below are why the pattern is not simply /:.+?:/ — each one
  // is ordinary chat text that a greedier pattern would mangle.
  it('leaves a URL alone', () => {
    expect(replaceShortcodes('https://youtu.be/x')).toBe('https://youtu.be/x')
  })

  it('leaves a timestamp alone', () => {
    expect(replaceShortcodes('start at 1:30:00')).toBe('start at 1:30:00')
  })

  it('leaves a lone colon alone', () => {
    expect(replaceShortcodes('wait: what')).toBe('wait: what')
  })

  it('returns an empty string unchanged', () => {
    expect(replaceShortcodes('')).toBe('')
  })
})
