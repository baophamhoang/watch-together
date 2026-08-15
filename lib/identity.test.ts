import {describe, expect, it} from 'vitest'
import {DEFAULT_NICKNAME, hasStoredNickname, loadNickname, saveNickname} from './identity'

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

describe('hasStoredNickname', () => {
  it('is false when nothing is stored', () => {
    expect(hasStoredNickname(fakeStorage())).toBe(false)
  })

  it('is false when the stored value is blank', () => {
    const storage = fakeStorage()
    saveNickname(storage, '   ')
    expect(hasStoredNickname(storage)).toBe(false)
  })

  it('is true once a real name is stored', () => {
    const storage = fakeStorage()
    saveNickname(storage, 'zebra')
    expect(hasStoredNickname(storage)).toBe(true)
  })

  // Someone who deliberately typed "friend" has chosen a name, and must not be
  // prompted again every time they open a room. This is the case that makes
  // `hasStoredNickname` a different question from `loadNickname`, rather than a
  // convenience wrapper around it.
  it('is true when the stored value happens to equal the default', () => {
    const storage = fakeStorage()
    saveNickname(storage, DEFAULT_NICKNAME)
    expect(hasStoredNickname(storage)).toBe(true)
  })

  it('is false when storage throws', () => {
    expect(
      hasStoredNickname({
        getItem() {
          throw new Error('blocked')
        },
        setItem() {},
      }),
    ).toBe(false)
  })
})
