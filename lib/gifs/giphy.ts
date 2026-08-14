import type {Gif} from './types'

export function giphySearchUrl(query: string, key: string, limit: number): string {
  const url = new URL('https://api.giphy.com/v1/gifs/search')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', key)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('rating', 'pg-13')
  return url.toString()
}

/**
 * Never throws. A GIF grid that fails to render is a cosmetic disappointment;
 * one that takes out the chat panel is a bug.
 */
export function mapGiphy(raw: unknown): Gif[] {
  if (typeof raw !== 'object' || raw === null) return []
  const data = (raw as {data?: unknown}).data
  if (!Array.isArray(data)) return []

  return data.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) return []
    const {id, title, images} = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof images !== 'object' || images === null) return []
    const preview = (images as Record<string, {url?: unknown}>).fixed_width_small?.url
    const full = (images as Record<string, {url?: unknown}>).fixed_width?.url
    if (typeof preview !== 'string' || typeof full !== 'string') return []
    return [{id, title: typeof title === 'string' ? title : '', previewUrl: preview, url: full}]
  })
}
