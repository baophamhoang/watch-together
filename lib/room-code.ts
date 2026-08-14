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
const SUFFIX_LENGTH = 4
const CODE_PATTERN = new RegExp(
  `^[a-z]+-[a-z]+-[${SUFFIX_ALPHABET}]{${SUFFIX_LENGTH}}$`,
)

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)]
}

export function generateRoomCode(random: () => number = Math.random): string {
  const suffix = Array.from({length: SUFFIX_LENGTH}, () =>
    pick(SUFFIX_ALPHABET.split(''), random),
  ).join('')
  return `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}-${suffix}`
}

export function isValidRoomCode(code: string): boolean {
  if (!CODE_PATTERN.test(code)) return false
  const [adjective, noun] = code.split('-')
  return (ADJECTIVES as readonly string[]).includes(adjective)
    && (NOUNS as readonly string[]).includes(noun)
}
