import {notFound} from 'next/navigation'
import {Room} from '@/components/Room'
import {isValidRoomCode} from '@/lib/room-code'

export default async function RoomPage({params}: {params: Promise<{code: string}>}) {
  const {code} = await params
  if (!isValidRoomCode(code)) notFound()
  return <Room code={code} />
}
