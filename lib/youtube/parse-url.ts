export type ParsedVideo = {videoId: string; startAtSec: number}

export class InvalidYouTubeUrlError extends Error {
  constructor(input: string) {
    super(`Not a recognizable YouTube video URL: ${input}`)
    this.name = 'InvalidYouTubeUrlError'
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PATH_FORMS = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/
const HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com'])

export function parseTimeParam(raw: string | null): number {
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match || !match.slice(1).some(Boolean)) return 0
  const [h, m, s] = match.slice(1).map(v => Number(v ?? 0) || 0)
  return h * 3600 + m * 60 + s
}

export function parseYouTubeUrl(input: string): ParsedVideo {
  const trimmed = input.trim()
  if (!trimmed) throw new InvalidYouTubeUrlError(input)

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new InvalidYouTubeUrlError(input)
  }

  const host = url.hostname.replace(/^www\./, '')
  let videoId: string | null = null

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] || null
  } else if (HOSTS.has(host)) {
    videoId = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : (url.pathname.match(PATH_FORMS)?.[1] ?? null)
  }

  if (!videoId || !VIDEO_ID.test(videoId)) throw new InvalidYouTubeUrlError(input)
  return {videoId, startAtSec: parseTimeParam(url.searchParams.get('t'))}
}
