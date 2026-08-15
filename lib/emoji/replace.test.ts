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

  // The character class does not save us here — the colon is followed by
  // ordinary word characters, so without the link-token skip this becomes
  // `http://x/🔥` and the link is broken.
  it('leaves a shortcode-shaped segment inside a URL alone', () => {
    expect(replaceShortcodes('http://x/:fire:')).toBe('http://x/:fire:')
    expect(replaceShortcodes('https://e.com/:fire:/p')).toBe('https://e.com/:fire:/p')
  })

  it('still replaces a code sitting next to a URL', () => {
    expect(replaceShortcodes('watch https://youtu.be/x :fire:')).toBe(
      'watch https://youtu.be/x 🔥',
    )
  })

  it('preserves newlines and runs of spaces exactly', () => {
    expect(replaceShortcodes('a  :fire:\n\nb')).toBe('a  🔥\n\nb')
  })

  // Roughly a fifth of the map uses underscores, and none of the cases above
  // would notice if `_` were dropped from the character class.
  it('replaces a code containing an underscore', () => {
    expect(replaceShortcodes(':heart_eyes:')).toBe('😍')
  })

  // `+1` exercises both the alias entries and the non-alphanumeric end of the
  // character class.
  it('replaces an alias code with punctuation', () => {
    expect(replaceShortcodes('nice :+1:')).toBe('nice 👍')
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
