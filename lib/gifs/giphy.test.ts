import {describe, expect, it} from 'vitest'
import {giphySearchUrl, isGiphyUrl, mapGiphy} from './giphy'

const raw = {
  data: [
    {
      id: 'abc',
      title: 'a cat',
      images: {
        fixed_width_small: {url: 'https://media.giphy.com/preview.gif'},
        fixed_width: {url: 'https://media.giphy.com/full.gif'},
      },
    },
  ],
}

describe('giphySearchUrl', () => {
  it('targets the search endpoint with the query and key', () => {
    const url = new URL(giphySearchUrl('cats', 'KEY', 12))
    expect(url.origin + url.pathname).toBe('https://api.giphy.com/v1/gifs/search')
    expect(url.searchParams.get('q')).toBe('cats')
    expect(url.searchParams.get('api_key')).toBe('KEY')
    expect(url.searchParams.get('limit')).toBe('12')
  })

  it('encodes a query with spaces and symbols', () => {
    const url = new URL(giphySearchUrl('happy dance &c', 'K', 5))
    expect(url.searchParams.get('q')).toBe('happy dance &c')
  })
})

describe('mapGiphy', () => {
  it('maps only the fields the picker needs', () => {
    expect(mapGiphy(raw)).toEqual([
      {
        id: 'abc',
        title: 'a cat',
        previewUrl: 'https://media.giphy.com/preview.gif',
        url: 'https://media.giphy.com/full.gif',
      },
    ])
  })

  it('skips entries missing an image rather than throwing', () => {
    expect(mapGiphy({data: [{id: 'x', title: 't', images: {}}]})).toEqual([])
  })

  it('returns an empty list for a malformed payload', () => {
    expect(mapGiphy(null)).toEqual([])
    expect(mapGiphy({})).toEqual([])
    expect(mapGiphy({data: 'nope'})).toEqual([])
  })

  it('falls back to an empty title rather than undefined', () => {
    const noTitle = {data: [{id: 'x', images: raw.data[0].images}]}
    expect(mapGiphy(noTitle)[0].title).toBe('')
  })
})

describe('isGiphyUrl', () => {
  it('accepts the media hosts the search endpoint actually returns', () => {
    expect(isGiphyUrl('https://media.giphy.com/media/abc/giphy.gif')).toBe(true)
    expect(isGiphyUrl('https://media4.giphy.com/media/abc/200w.gif')).toBe(true)
    expect(isGiphyUrl('https://i.giphy.com/abc.gif')).toBe(true)
  })

  it('rejects a lookalike host — the reason the check keeps the leading dot', () => {
    expect(isGiphyUrl('https://evilgiphy.com/a.gif')).toBe(false)
    expect(isGiphyUrl('https://giphy.com.attacker.test/a.gif')).toBe(false)
  })

  it('rejects any other origin, which is the whole point', () => {
    expect(isGiphyUrl('https://tracker.example/beacon.gif')).toBe(false)
    expect(isGiphyUrl('https://media.giphy.com.example/a.gif')).toBe(false)
  })

  it('rejects a non-https scheme', () => {
    expect(isGiphyUrl('http://media.giphy.com/a.gif')).toBe(false)
    expect(isGiphyUrl('data:image/gif;base64,R0lGOD')).toBe(false)
    expect(isGiphyUrl('javascript:alert(1)')).toBe(false)
  })

  it('returns false rather than throwing on anything that is not a URL', () => {
    expect(isGiphyUrl('')).toBe(false)
    expect(isGiphyUrl('hello everyone')).toBe(false)
    expect(isGiphyUrl('media.giphy.com/a.gif')).toBe(false)
  })
})
