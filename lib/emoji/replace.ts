import {SHORTCODES} from './shortcodes'

/**
 * The character class is the whole design. It admits only the characters a
 * shortcode can contain, which is what keeps ordinary text intact:
 *
 * - `https://youtu.be/x` — the colon is followed by `/`, which cannot start a
 *   code, so nothing matches.
 * - `1:30:00` — `:30:` matches the shape, finds no entry, and is returned
 *   verbatim by the fallback below. Unknown codes passing through is what
 *   makes a permissive pattern safe.
 * - `wait: what` — a space cannot appear in a code, so a lone colon is inert.
 */
const SHORTCODE = /:([a-z0-9_+-]+):/gi

export function replaceShortcodes(text: string): string {
  return text.replace(SHORTCODE, (whole, code: string) => SHORTCODES[code.toLowerCase()] ?? whole)
}
