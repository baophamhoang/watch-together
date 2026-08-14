import {describe, expect, it} from 'vitest'
import {appendMessage, CHAT_HISTORY_LIMIT} from './messages'
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
