export type ChatKind = 'text' | 'gif'

export type ChatMessage = {
  id: string
  peerId: string
  name: string
  kind: ChatKind
  /** Text content, or a GIF URL when kind is 'gif'. */
  body: string
  at: number
}
