import {describe, expect, it} from 'vitest'
import {DEFAULT_NICKNAME, loadNickname, saveNickname} from './identity'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = {...initial}
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('nickname persistence', () => {
  it('falls back to a default when nothing is stored', () => {
    expect(loadNickname(fakeStorage())).toBe(DEFAULT_NICKNAME)
  })

  it('round-trips a saved nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'bao')
    expect(loadNickname(storage)).toBe('bao')
  })

  it('trims surrounding whitespace', () => {
    const storage = fakeStorage()
    saveNickname(storage, '  bao  ')
    expect(loadNickname(storage)).toBe('bao')
  })

  it('ignores a blank nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, '   ')
    expect(loadNickname(storage)).toBe(DEFAULT_NICKNAME)
  })

  it('caps an overlong nickname', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'x'.repeat(100))
    expect(loadNickname(storage)).toHaveLength(24)
  })

  it('survives storage being unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadNickname(throwing)).toBe(DEFAULT_NICKNAME)
    expect(() => saveNickname(throwing, 'bao')).not.toThrow()
  })
})
