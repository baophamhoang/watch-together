import {SHORTCODES} from './shortcodes'

/**
 * The character class admits only what a shortcode can contain, which keeps
 * most ordinary text intact on its own:
 *
 * - `1:30:00` — `:30:` matches the shape, finds no entry, and is returned
 *   verbatim by the fallback below. Unknown codes passing through is what
 *   makes a permissive pattern tolerable.
 * - `wait: what` — a space cannot appear in a code, so a lone colon is inert.
 */
const SHORTCODE = /:([a-z0-9_+-]+):/gi

/** A whitespace-delimited token that is a link, and so must be left alone. */
const URL_TOKEN = /^https?:\/\//i

export function replaceShortcodes(text: string): string {
  // URLs are skipped as whole tokens rather than pattern-matched around,
  // because the character class alone does NOT protect them. It stops
  // `https://youtu.be/x` only because the colon there is followed by `/` —
  // but a colon later in a path is followed by ordinary word characters, so
  // `http://x/:fire:` would otherwise become `http://x/🔥` and the link would
  // break. Splitting on whitespace and skipping link tokens outright is both
  // simpler to reason about and complete, where a lookbehind on `/` would
  // still miss shapes like `https://x.com/a:fire:b`.
  //
  // The capture group in the split pattern keeps the separators in the array,
  // so `join('')` restores the original spacing exactly — including newlines
  // and runs of spaces.
  return text
    .split(/(\s+)/)
    .map(token =>
      URL_TOKEN.test(token)
        ? token
        : token.replace(SHORTCODE, (whole, code: string) => SHORTCODES[code.toLowerCase()] ?? whole),
    )
    .join('')
}
