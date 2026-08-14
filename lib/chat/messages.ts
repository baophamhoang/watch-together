import type {ChatMessage} from './types'

/** Session-only history. There is no server, so nothing persists past a reload. */
export const CHAT_HISTORY_LIMIT = 200

export function appendMessage(
  list: ChatMessage[],
  message: ChatMessage,
  max: number = CHAT_HISTORY_LIMIT,
): ChatMessage[] {
  if (list.some(m => m.id === message.id)) return list
  return [...list, message].slice(-max)
}
