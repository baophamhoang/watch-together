import {notFound} from 'next/navigation'
import {Room} from '@/components/Room'
import {isValidRoomCode} from '@/lib/room-code'

export default async function RoomPage({params}: {params: Promise<{code: string}>}) {
  const {code} = await params
  if (!isValidRoomCode(code)) notFound()
  // Only a boolean crosses to the client. Deciding here means no
  // NEXT_PUBLIC_ mirror of the secret and no client-side probe request.
  return <Room code={code} gifsEnabled={Boolean(process.env.GIPHY_API_KEY)} />
}
