export const DEFAULT_NICKNAME = 'friend'
export const MAX_NICKNAME_LENGTH = 24

const KEY = 'watch-together:nickname'

export type NicknameStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function normalize(raw: string): string {
  return raw.trim().slice(0, MAX_NICKNAME_LENGTH)
}

export function loadNickname(storage: NicknameStorage): string {
  try {
    return normalize(storage.getItem(KEY) ?? '') || DEFAULT_NICKNAME
  } catch {
    // Private browsing and blocked storage both throw; a default is fine.
    return DEFAULT_NICKNAME
  }
}

export function saveNickname(storage: NicknameStorage, name: string): void {
  try {
    storage.setItem(KEY, normalize(name))
  } catch {
    // Nickname is a convenience, never worth failing a join over.
  }
}
