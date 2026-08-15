import {describe, expect, it} from 'vitest'
import {loadSoundMuted, saveSoundMuted} from './notify'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = {...initial}
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('chat sound preference', () => {
  // Sound is on by default: the user asked for a notification sound, so
  // silence must be something they chose rather than something they inherit.
  it('defaults to unmuted when nothing is stored', () => {
    expect(loadSoundMuted(fakeStorage())).toBe(false)
  })

  it('round-trips muted', () => {
    const storage = fakeStorage()
    saveSoundMuted(storage, true)
    expect(loadSoundMuted(storage)).toBe(true)
  })

  it('round-trips unmuted', () => {
    const storage = fakeStorage()
    saveSoundMuted(storage, true)
    saveSoundMuted(storage, false)
    expect(loadSoundMuted(storage)).toBe(false)
  })

  // Anything unrecognised means "not muted" — a corrupt value should leave a
  // feature working, not silently disable it.
  it('treats an unrecognised value as unmuted', () => {
    expect(loadSoundMuted(fakeStorage({'watch-together:chat-sound': 'banana'}))).toBe(false)
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
    expect(loadSoundMuted(throwing)).toBe(false)
    expect(() => saveSoundMuted(throwing, true)).not.toThrow()
  })
})
