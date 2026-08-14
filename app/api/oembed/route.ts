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

  // YouTube answers 400 for a well-formed id with no video behind it, and
  // 401/404 for private or removed ones. We build this request ourselves and
  // the id is regex-validated above, so an upstream 400 means "no such video",
  // never "your request was malformed" — bucketing it as 502 would tell the
  // user to retry something that will never exist.
  if ([400, 401, 404].includes(upstream.status)) {
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
