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
    upstream = await fetch(giphySearchUrl(query, key, LIMIT), {
      headers: {accept: 'application/json'},
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
    return Response.json({gifs: mapGiphy(await upstream.json())})
  } catch {
    return Response.json({error: 'unexpected giphy response'}, {status: 502})
  }
}
