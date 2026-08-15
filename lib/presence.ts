import type {RosterEntry} from './sync/types'

export type Avatar = {initial: string; hue: number}

/**
 * Colour is keyed on peer id rather than name so someone changing their
 * nickname keeps the same avatar — the colour is how you recognise them at a
 * glance, and having it jump would defeat that.
 */
export function avatarFor(peerId: string, name: string): Avatar {
  const trimmed = name.trim()
  // Array.from, not [0]: a surrogate pair would otherwise split into half a
  // character and render as a replacement glyph.
  const initial = trimmed ? (Array.from(trimmed)[0] as string).toUpperCase() : '?'

  let hash = 0
  for (let i = 0; i < peerId.length; i++) {
    hash = (hash * 31 + peerId.charCodeAt(i)) % 360
  }
  return {initial, hue: hash}
}

/**
 * An empty previous roster means we have not rendered yet, so everyone
 * present counts as pre-existing rather than as arriving. Without that, every
 * peer already in the room announces itself the moment you join.
 */
export function diffRoster(
  previous: RosterEntry[],
  next: RosterEntry[],
): {joined: RosterEntry[]; left: RosterEntry[]} {
  if (previous.length === 0) return {joined: [], left: []}
  const before = new Set(previous.map(p => p.peerId))
  const after = new Set(next.map(p => p.peerId))
  return {
    joined: next.filter(p => !before.has(p.peerId)),
    left: previous.filter(p => !after.has(p.peerId)),
  }
}
