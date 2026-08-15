/**
 * Shortcode → emoji. Curated, not exhaustive: this is the set people actually
 * reach for while watching something together. Unknown codes pass through
 * untouched, so the cost of a miss is that someone sees the literal text.
 *
 * Informal aliases (`haha`, `lol`, `thumbsup`) sit beside the standard names
 * because they are what people type without thinking.
 */
export const SHORTCODES: Record<string, string> = {
  // faces
  smile: '🙂', smiley: '😃', grin: '😁', haha: '😄', laughing: '😆',
  joy: '😂', lol: '😂', rofl: '🤣', sob: '😭', cry: '😢',
  wink: '😉', blush: '😊', heart_eyes: '😍', kissing_heart: '😘',
  thinking: '🤔', neutral_face: '😐', expressionless: '😑', unamused: '😒',
  roll_eyes: '🙄', smirk: '😏', sweat_smile: '😅', sweat: '😓',
  weary: '😩', tired_face: '😫', fearful: '😨', scream: '😱',
  angry: '😠', rage: '😡', sunglasses: '😎', nerd: '🤓',
  star_struck: '🤩', partying_face: '🥳', party: '🥳', yawn: '🥱',
  sleepy: '😪', zzz: '💤', shush: '🤫', drool: '🤤', vomit: '🤮',
  // hands and people
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎',
  ok_hand: '👌', clap: '👏', wave: '👋', pray: '🙏', muscle: '💪',
  point_right: '👉', point_left: '👈', raised_hands: '🙌',
  facepalm: '🤦', shrug: '🤷', dancer: '💃', eyes: '👀',
  // reactions
  fire: '🔥', tada: '🎉', sparkles: '✨', star: '⭐', zap: '⚡',
  boom: '💥', heart: '❤️', broken_heart: '💔', skull: '💀',
  clown: '🤡', poop: '💩', '100': '💯',
  // watching together
  popcorn: '🍿', pizza: '🍕', beer: '🍺', coffee: '☕', cake: '🎂',
  gift: '🎁', music: '🎵', notes: '🎶', headphones: '🎧',
  tv: '📺', movie_camera: '🎥', film: '🎬', video_game: '🎮',
  // animals and things
  cat: '🐱', dog: '🐶', monkey: '🐵', unicorn: '🦄',
  see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊',
  rocket: '🚀', moon: '🌙', sun: '☀️', rain: '🌧️', snowflake: '❄️',
  // marks
  check: '✅', white_check_mark: '✅', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗',
}
