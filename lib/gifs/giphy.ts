import type {Gif} from './types'

/**
 * Whether a URL is safe to hand to an `<img src>` that a peer chose.
 *
 * NOT an XSS guard — React escapes the attribute, and `<img src>` executes
 * neither `javascript:` nor `data:text/html`. It is a beacon and availability
 * guard: without it, any peer can make every other participant's browser issue
 * a request to a host of their choosing, which leaks IP addresses and lets one
 * person point the whole room at an arbitrarily large download.
 *
 * `endsWith('.giphy.com')` with the leading dot on purpose: matching
 * `giphy.com` loosely would also accept `evilgiphy.com`.
 */
export function isGiphyUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.hostname.endsWith('.giphy.com')
}

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
