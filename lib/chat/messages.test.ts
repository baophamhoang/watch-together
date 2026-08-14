import {describe, expect, it} from 'vitest'
import {appendMessage, CHAT_HISTORY_LIMIT, isChatMessage, MAX_CHAT_BODY_LENGTH} from './messages'
import type {ChatMessage} from './types'

const msg = (id: string, at = 1000): ChatMessage => ({
  id,
  peerId: 'p',
  name: 'bao',
  kind: 'text',
  body: 'hi',
  at,
})

describe('appendMessage', () => {
  it('appends to the end', () => {
    expect(appendMessage([msg('a')], msg('b')).map(m => m.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the input list', () => {
    const list = [msg('a')]
    appendMessage(list, msg('b'))
    expect(list).toHaveLength(1)
  })

  it('drops the oldest once the cap is reached', () => {
    const full = Array.from({length: CHAT_HISTORY_LIMIT}, (_, i) => msg(`m${i}`))
    const next = appendMessage(full, msg('new'))
    expect(next).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(next[0].id).toBe('m1')
    expect(next[next.length - 1].id).toBe('new')
  })

  it('ignores a duplicate id, so a re-delivered message appears once', () => {
    expect(appendMessage([msg('a')], msg('a'))).toHaveLength(1)
  })
})

describe('isChatMessage', () => {
  const valid = {...msg('a')}

  it('accepts a well-formed text message', () => {
    expect(isChatMessage(valid)).toBe(true)
  })

  it('accepts a well-formed gif message', () => {
    expect(isChatMessage({...valid, kind: 'gif', body: 'https://media.giphy.com/a.gif'})).toBe(true)
  })

  it('rejects a non-object payload', () => {
    for (const value of [null, undefined, 'hi', 7, [], true]) {
      expect(isChatMessage(value)).toBe(false)
    }
  })

  it('rejects a name that is not a string — the case that throws in avatarFor', () => {
    expect(isChatMessage({...valid, name: 1})).toBe(false)
    expect(isChatMessage({...valid, name: null})).toBe(false)
  })

  it('rejects a missing field rather than rendering undefined', () => {
    for (const key of ['id', 'peerId', 'name', 'kind', 'body', 'at'] as const) {
      const incomplete: Partial<ChatMessage> = {...valid}
      delete incomplete[key]
      expect(isChatMessage(incomplete), `missing ${key}`).toBe(false)
    }
  })

  it('rejects a peerId that is not a string — charCodeAt would throw', () => {
    expect(isChatMessage({...valid, peerId: {}})).toBe(false)
  })

  it('rejects an unknown kind', () => {
    expect(isChatMessage({...valid, kind: 'video'})).toBe(false)
    expect(isChatMessage({...valid, kind: 0})).toBe(false)
  })

  it('rejects empty strings, which would render as a nameless blank line', () => {
    expect(isChatMessage({...valid, name: ''})).toBe(false)
    expect(isChatMessage({...valid, body: ''})).toBe(false)
    expect(isChatMessage({...valid, id: ''})).toBe(false)
  })

  it('caps the body, so nobody can hand the renderer a multi-megabyte string', () => {
    expect(isChatMessage({...valid, body: 'x'.repeat(MAX_CHAT_BODY_LENGTH)})).toBe(true)
    expect(isChatMessage({...valid, body: 'x'.repeat(MAX_CHAT_BODY_LENGTH + 1)})).toBe(false)
  })

  it('caps the name at the same length the nickname field enforces', () => {
    expect(isChatMessage({...valid, name: 'n'.repeat(24)})).toBe(true)
    expect(isChatMessage({...valid, name: 'n'.repeat(25)})).toBe(false)
  })

  it('rejects a non-finite timestamp', () => {
    expect(isChatMessage({...valid, at: 'now'})).toBe(false)
    expect(isChatMessage({...valid, at: NaN})).toBe(false)
    expect(isChatMessage({...valid, at: Infinity})).toBe(false)
  })
})
