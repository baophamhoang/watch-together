/**
 * Colours for generated Open Graph images.
 *
 * Duplicated from `globals.css` rather than imported, because `ImageResponse`
 * renders through satori, which never sees a stylesheet — it resolves inline
 * styles only, so a CSS custom property would come through as the literal
 * string `var(--bg)` and paint nothing. Keeping the values in one module means
 * the duplication is stated once here instead of scattered across every image.
 */
export const OG = {
  bg: '#0b0b0c',
  surface: '#151517',
  border: '#2a2a2f',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#4ade80',
} as const

/** The size every social crawler expects; anything else gets cropped. */
export const OG_SIZE = {width: 1200, height: 630} as const

export const OG_CONTENT_TYPE = 'image/png'
