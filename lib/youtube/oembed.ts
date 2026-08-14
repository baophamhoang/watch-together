export type VideoMeta = {
  videoId: string
  title: string
  author: string
  thumbnail: string
}

export class MalformedOembedError extends Error {
  constructor(videoId: string) {
    super(`oEmbed response for ${videoId} was missing expected fields`)
    this.name = 'MalformedOembedError'
  }
}

export function oembedRequestUrl(videoId: string): string {
  const target = `https://www.youtube.com/watch?v=${videoId}`
  const url = new URL('https://www.youtube.com/oembed')
  url.searchParams.set('url', target)
  url.searchParams.set('format', 'json')
  return url.toString()
}

export function mapOembed(videoId: string, raw: unknown): VideoMeta {
  if (typeof raw !== 'object' || raw === null) throw new MalformedOembedError(videoId)
  const {title, author_name: author, thumbnail_url: thumbnail} = raw as Record<string, unknown>
  if (typeof title !== 'string' || typeof author !== 'string' || typeof thumbnail !== 'string') {
    throw new MalformedOembedError(videoId)
  }
  return {videoId, title, author, thumbnail}
}
