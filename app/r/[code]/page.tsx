import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import {Room} from '@/components/Room'
import {isValidRoomCode} from '@/lib/room-code'

/**
 * An invite link's preview should say what it is an invite to. Without this the
 * card carries the site's generic title, so the image names the room and the
 * text beside it does not — and in clients that render the title more
 * prominently than the image, the invitation reads as a plain homepage link.
 *
 * Only the code is available here: room state lives in peers' browsers, and a
 * crawler runs no JavaScript and never joins. Naming the room is the most that
 * can be said truthfully from the URL alone.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{code: string}>
}): Promise<Metadata> {
  const {code} = await params
  // A malformed code 404s below; inheriting the default title is right for it.
  if (!isValidRoomCode(code)) return {}

  const title = `Join ${code}`
  const description = 'Watch YouTube together, in sync. Open the link — no account needed.'
  return {
    title,
    description,
    openGraph: {title, description},
    twitter: {title, description},
  }
}

export default async function RoomPage({params}: {params: Promise<{code: string}>}) {
  const {code} = await params
  if (!isValidRoomCode(code)) notFound()
  // Only a boolean crosses to the client. Deciding here means no
  // NEXT_PUBLIC_ mirror of the secret and no client-side probe request.
  return <Room code={code} gifsEnabled={Boolean(process.env.GIPHY_API_KEY)} />
}
