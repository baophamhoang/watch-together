import {describe, expect, it} from 'vitest'
import {MalformedOembedError, mapOembed, oembedRequestUrl} from './oembed'

const raw = {
  title: 'Never Gonna Give You Up',
  author_name: 'Rick Astley',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
}

describe('oembedRequestUrl', () => {
  it('targets the keyless oembed endpoint with an encoded watch url', () => {
    const url = new URL(oembedRequestUrl('dQw4w9WgXcQ'))
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/oembed')
    expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(url.searchParams.get('format')).toBe('json')
  })
})

describe('mapOembed', () => {
  it('maps the fields we use', () => {
    expect(mapOembed('dQw4w9WgXcQ', raw)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      author: 'Rick Astley',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
  })

  it.each([
    ['missing title', {...raw, title: undefined}],
    ['missing author', {...raw, author_name: undefined}],
    ['missing thumbnail', {...raw, thumbnail_url: undefined}],
    ['non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_label, payload) => {
    expect(() => mapOembed('dQw4w9WgXcQ', payload)).toThrow(MalformedOembedError)
  })
})
