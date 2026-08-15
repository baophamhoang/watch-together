import {MAX_NICKNAME_LENGTH} from '../identity'
import type {ChatMessage} from './types'

/** Session-only history. There is no server, so nothing persists past a reload. */
export const CHAT_HISTORY_LIMIT = 200

/** Long enough for anything anyone types, short enough that nobody can hand the
 *  renderer a multi-megabyte string to lay out. */
export const MAX_CHAT_BODY_LENGTH = 2000
/** UUIDs are 36; trystero peer ids are 20. This is only a sanity ceiling. */
const MAX_ID_LENGTH = 128

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * `ChatMessage` is a compile-time claim about a payload another browser wrote,
 * and nothing between the wire and the renderer checks it. `avatarFor` calls
 * `name.trim()` and `peerId.charCodeAt()`, so a peer sending `{name: 1}` — or
 * simply omitting the field — throws during render rather than at the boundary,
 * taking the player, queue and connection down with the chat panel and then
 * re-throwing on every render, because by then the payload is in state.
 *
 * The asymmetry this closes is worth naming: `mapGiphy` already carries a
 * "never throws" contract for a payload from a company with a support address.
 * A peer is strictly less trustworthy than that and had no check at all.
 */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const {id, peerId, name, kind, body, at} = value as Record<string, unknown>
  return (
    isBoundedString(id, MAX_ID_LENGTH) &&
    isBoundedString(peerId, MAX_ID_LENGTH) &&
    isBoundedString(name, MAX_NICKNAME_LENGTH) &&
    (kind === 'text' || kind === 'gif') &&
    isBoundedString(body, MAX_CHAT_BODY_LENGTH) &&
    typeof at === 'number' &&
    Number.isFinite(at)
  )
}

export function appendMessage(
  list: ChatMessage[],
  message: ChatMessage,
  max: number = CHAT_HISTORY_LIMIT,
): ChatMessage[] {
  if (list.some(m => m.id === message.id)) return list
  return [...list, message].slice(-max)
}
