import {describe, expect, it} from 'vitest'
import {InvalidYouTubeUrlError, parseTimeParam, parseYouTubeUrl} from './parse-url'

describe('parseYouTubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (input, expected) => {
    expect(parseYouTubeUrl(input).videoId).toBe(expected)
  })

  it('keeps the id when a playlist context is attached', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=4'
    expect(parseYouTubeUrl(url).videoId).toBe('dQw4w9WgXcQ')
  })

  it('reads a plain-seconds timestamp', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=42').startAtSec).toBe(42)
  })

  it('reads an h/m/s timestamp', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s'
    expect(parseYouTubeUrl(url).startAtSec).toBe(3723)
  })

  it('defaults the timestamp to zero', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ').startAtSec).toBe(0)
  })

  it.each([
    'https://www.youtube.com/watch?v=tooshort',
    'https://vimeo.com/12345678901',
    'https://www.youtube.com/',
    'not a url at all',
    '',
  ])('rejects %s', input => {
    expect(() => parseYouTubeUrl(input)).toThrow(InvalidYouTubeUrlError)
  })
})

describe('parseTimeParam', () => {
  it('returns 0 for null', () => expect(parseTimeParam(null)).toBe(0))
  it('returns 0 for junk', () => expect(parseTimeParam('banana')).toBe(0))
  it('parses bare seconds', () => expect(parseTimeParam('90')).toBe(90))
  it('parses 90s', () => expect(parseTimeParam('90s')).toBe(90))
  it('parses 1m30s', () => expect(parseTimeParam('1m30s')).toBe(90))
})
