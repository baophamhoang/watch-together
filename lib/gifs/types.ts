export type Gif = {
  id: string
  title: string
  /** Small still-ish version for the grid. */
  previewUrl: string
  /** The version actually sent to the room. */
  url: string
}
