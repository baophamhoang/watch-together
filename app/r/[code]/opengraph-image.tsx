import {ImageResponse} from 'next/og'
import {OG, OG_CONTENT_TYPE, OG_SIZE} from '@/app/og-theme'
import {isValidRoomCode} from '@/lib/room-code'

export const alt = 'An invitation to watch YouTube together'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

/**
 * The card for an invite link, showing the room it points at.
 *
 * Deliberately does NOT show what is queued. Room state lives only in peers'
 * browsers — the server knows nothing but the code in the URL, and a crawler
 * runs no JavaScript and never joins the room, so there is nothing to read.
 * Naming the room is what can be told truthfully from the URL alone.
 */
export default async function Image({params}: {params: Promise<{code: string}>}) {
  const {code} = await params
  // The page 404s on a malformed code; the image should not cheerfully render
  // an invitation to a room that cannot exist.
  const label = isValidRoomCode(code) ? code : 'watch together'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: OG.bg,
          padding: 80,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: OG.accent,
              display: 'flex',
            }}
          />
          <div style={{fontSize: 30, color: OG.muted, letterSpacing: 2}}>
            WATCH TOGETHER
          </div>
        </div>

        <div style={{fontSize: 40, color: OG.muted, marginTop: 40}}>
          You’re invited to the room
        </div>

        {/* The code is the one thing this card exists to carry, so it gets the
            size. Letter-spaced because it is read character by character when
            someone types it in rather than following the link. */}
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            padding: '28px 44px',
            borderRadius: 24,
            background: OG.surface,
            border: `2px solid ${OG.border}`,
            fontSize: 76,
            color: OG.text,
            letterSpacing: 4,
          }}
        >
          {label}
        </div>

        <div style={{fontSize: 30, color: OG.muted, marginTop: 40}}>
          Open the link and you’re watching together — no account needed.
        </div>
      </div>
    ),
    size,
  )
}
