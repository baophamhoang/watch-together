const ADJECTIVES = [
  'amber', 'ancient', 'autumn', 'blue', 'bold', 'brave', 'bright', 'calm',
  'cosmic', 'crimson', 'crisp', 'dawn', 'deep', 'drifting', 'dusty', 'eager',
  'ember', 'fading', 'floating', 'frosty', 'gentle', 'gilded', 'golden', 'grand',
  'hidden', 'humble', 'idle', 'jolly', 'keen', 'late', 'lively', 'lucky',
  'lunar', 'misty', 'moonlit', 'noble', 'ocean', 'patient', 'plucky', 'polar',
  'proud', 'quiet', 'rapid', 'restless', 'rising', 'rustic', 'scarlet', 'shy',
  'silent', 'silver', 'sleepy', 'small', 'snowy', 'solar', 'spry', 'still',
  'summer', 'sunny', 'tidal', 'twilight', 'velvet', 'wandering', 'wild', 'winter',
] as const

const NOUNS = [
  'anchor', 'arrow', 'badger', 'beacon', 'bison', 'brook', 'canyon', 'cedar',
  'cinder', 'comet', 'coral', 'cove', 'crane', 'dune', 'eagle', 'ember',
  'falcon', 'fern', 'forest', 'fox', 'garden', 'glacier', 'harbor', 'hawk',
  'heron', 'island', 'jungle', 'kestrel', 'lantern', 'ledge', 'lynx', 'maple',
  'meadow', 'meteor', 'moth', 'otter', 'owl', 'pine', 'prairie', 'quartz',
  'raven', 'reef', 'ridge', 'river', 'robin', 'sable', 'sparrow', 'spruce',
  'stone', 'stream', 'summit', 'thicket', 'thistle', 'tiger', 'trail', 'tundra',
  'valley', 'vireo', 'walrus', 'willow', 'wolf', 'wren', 'yarrow', 'zephyr',
] as const

const SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
// Hoisted so the four suffix draws in generateRoomCode share one array
// instead of each re-splitting the alphabet string from scratch.
const SUFFIX_CHARS = SUFFIX_ALPHABET.split('')
const SUFFIX_LENGTH = 4
const CODE_PATTERN = new RegExp(
  `^[a-z]+-[a-z]+-[${SUFFIX_ALPHABET}]{${SUFFIX_LENGTH}}$`,
)

// Clamped because `random` is an injected parameter: a caller supplying a
// PRNG that can return exactly 1 (a common rounding bug in hand-rolled
// generators) would otherwise index past the end and stringify `undefined`
// into the code, producing a code that fails its own validator. The clamp
// alone isn't enough for a degenerate PRNG that returns NaN: Math.max/min
// propagate NaN rather than bounding it, so `index` must be checked directly.
function pick<T>(list: readonly T[], random: () => number): T {
  const index = Math.floor(random() * list.length)
  const clamped = Math.min(Math.max(index, 0), list.length - 1)
  return list[Number.isFinite(index) ? clamped : 0]
}

export function generateRoomCode(random: () => number = Math.random): string {
  const suffix = Array.from({length: SUFFIX_LENGTH}, () =>
    pick(SUFFIX_CHARS, random),
  ).join('')
  return `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}-${suffix}`
}

export function isValidRoomCode(code: string): boolean {
  if (!CODE_PATTERN.test(code)) return false
  const [adjective, noun] = code.split('-')
  return (ADJECTIVES as readonly string[]).includes(adjective)
    && (NOUNS as readonly string[]).includes(noun)
}
