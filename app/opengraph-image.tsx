import {ImageResponse} from 'next/og'
import {OG, OG_CONTENT_TYPE, OG_SIZE} from './og-theme'

export const alt = 'Watch Together — watch YouTube with friends, in sync'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

/**
 * The card for the landing page — what someone sees when the bare domain is
 * shared. Rooms get their own image alongside this one.
 *
 * satori supports a subset of CSS: flexbox only, no grid, and any element with
 * more than one child needs an explicit `display: flex`. Fonts are not loaded
 * deliberately — Next supplies a default, and fetching one would add a network
 * round trip and a failure mode to an image that is only ever decoration.
 */
export default function Image() {
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

        <div
          style={{
            fontSize: 86,
            color: OG.text,
            lineHeight: 1.1,
            marginTop: 36,
            maxWidth: 900,
          }}
        >
          Watch YouTube with friends, in sync.
        </div>

        <div style={{fontSize: 34, color: OG.muted, marginTop: 32}}>
          No accounts. No server. Just a link.
        </div>
      </div>
    ),
    size,
  )
}
