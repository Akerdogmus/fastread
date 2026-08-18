import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ breaks: true })

/**
 * Everything rendered through here is untrusted. That's easy to lose sight of, because it
 * *looks* like the user's own material — but the text originates in whatever PDF they
 * opened, passes through a language model that will happily reproduce markup it was fed, and
 * is then cached in the database and re-rendered on every later visit. A PDF is a document
 * from the internet like any other.
 *
 * marked passes raw inline HTML straight through by design, so its output is scrubbed with
 * DOMPurify before it can reach a `dangerouslySetInnerHTML`. What this used to do instead —
 * regex away `<script>` and `<iframe>` — was not equivalent, and not close: `<scr<script>
 * </script>ipt>` *became* a live `<script>` once the inner match was removed, and everything
 * else (`<meta http-equiv="refresh">`, `<base>`, `<form>`, `<object>`) sailed past untouched.
 * A `<meta refresh>` in particular needs no script execution at all, so the page's Content
 * Security Policy never came into it.
 *
 * The allowlist below is what a translated page legitimately needs: markdown's own output,
 * plus the <mark> element injectHighlightMarks adds. Notably absent are <a> and <img> — the
 * reader renders no links or remote images of its own, so permitting them would only widen
 * the surface for markup that isn't ours.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'span',
    'mark',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'sup',
    'sub'
  ],
  ALLOWED_ATTR: ['class', 'data-note-id'],
  // No URI-bearing attributes are allowed through at all, which closes off javascript:,
  // data: and remote-resource tricks without having to reason about each scheme.
  ALLOW_DATA_ATTR: false
}

/**
 * Renders LLM-produced markdown (headings, **bold**, paragraphs, lists) as HTML so the
 * translation pane reads like a formatted page instead of showing raw ** markers.
 */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }) as string, PURIFY_CONFIG)
}

/** Same idea, but for short inline text (note excerpts) — no block-level <p>/<h*> wrapping. */
export function renderInlineMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parseInline(source, { async: false }) as string, PURIFY_CONFIG)
}

/**
 * Wraps each saved highlight's excerpt in a `<mark>` tag (with a data-note-id so it can be
 * clicked to reopen its margin note) before the text is run through the markdown renderer.
 * marked passes raw inline HTML straight through, so this survives into the rendered page.
 * Best-effort string match — if the excerpt doesn't appear verbatim (e.g. selection
 * whitespace differed slightly from the source), that highlight is just skipped.
 */
export function injectHighlightMarks(
  source: string,
  highlights: Array<{ id: string; excerpt: string }>
): string {
  let result = source
  for (const { id, excerpt } of highlights) {
    const trimmed = excerpt.trim()
    if (trimmed.length < 3) continue
    const idx = result.indexOf(trimmed)
    if (idx === -1) continue
    result =
      result.slice(0, idx) +
      `<mark class="note-mark" data-note-id="${id}">${trimmed}</mark>` +
      result.slice(idx + trimmed.length)
  }
  return result
}
