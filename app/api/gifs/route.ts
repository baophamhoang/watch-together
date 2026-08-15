import {giphySearchUrl, mapGiphy} from '@/lib/gifs/giphy'

const LIMIT = 18

export async function GET(request: Request) {
  const key = process.env.GIPHY_API_KEY
  if (!key) {
    return Response.json({error: 'gif search is not configured'}, {status: 501})
  }

  const query = new URL(request.url).searchParams.get('q')?.trim()
  if (!query) return Response.json({error: 'missing query'}, {status: 400})

  let upstream: Response
  try {
    // Cached the same way the sibling /api/oembed route caches YouTube. The
    // free tier is 100 searches an hour, and the case for that being enough
    // rests on debounced input AND repeated queries being answered from cache —
    // debouncing shipped, this did not, so the quota argument had a hole in it.
    // A room of five people all searching "cat" is one upstream call, not five.
    upstream = await fetch(giphySearchUrl(query, key, LIMIT), {
      next: {revalidate: 3600},
      headers: {accept: 'application/json'},
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return Response.json({error: 'giphy unreachable'}, {status: 502})
  }

  if (upstream.status === 429) {
    // The free tier is 100 searches/hour. Say so rather than showing "failed".
    return Response.json({error: 'gif search rate limit reached'}, {status: 429})
  }
  if (!upstream.ok) return Response.json({error: 'giphy rejected the request'}, {status: 502})

  try {
    return Response.json(
      {gifs: mapGiphy(await upstream.json())},
      {headers: {'cache-control': 'public, max-age=3600, stale-while-revalidate=86400'}},
    )
  } catch {
    return Response.json({error: 'unexpected giphy response'}, {status: 502})
  }
}
