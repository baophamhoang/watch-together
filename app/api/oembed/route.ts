import {mapOembed, oembedRequestUrl} from '@/lib/youtube/oembed'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get('videoId')
  if (!videoId || !VIDEO_ID.test(videoId)) {
    return Response.json({error: 'invalid videoId'}, {status: 400})
  }

  let upstream: Response
  try {
    upstream = await fetch(oembedRequestUrl(videoId), {
      next: {revalidate: 3600},
      headers: {accept: 'application/json'},
    })
  } catch {
    return Response.json({error: 'youtube unreachable'}, {status: 502})
  }

  if (upstream.status === 404 || upstream.status === 401) {
    return Response.json({error: 'video not found or private'}, {status: 404})
  }
  if (!upstream.ok) {
    return Response.json({error: 'youtube rejected the request'}, {status: 502})
  }

  try {
    const meta = mapOembed(videoId, await upstream.json())
    return Response.json(meta, {
      headers: {'cache-control': 'public, max-age=3600, stale-while-revalidate=86400'},
    })
  } catch {
    return Response.json({error: 'unexpected youtube response'}, {status: 502})
  }
}
