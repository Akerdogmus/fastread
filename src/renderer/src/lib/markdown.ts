import { marked } from 'marked'

marked.setOptions({ breaks: true })

/**
 * Renders LLM-produced markdown (headings, **bold**, paragraphs, lists) as HTML so the
 * translation pane reads like a formatted page instead of showing raw ** markers. The
 * content is always local (from the user's own PDF + their configured LM Studio/Gemini
 * engine), but as a light safety net we still strip script/iframe tags before parsing.
 */
export function renderMarkdown(source: string): string {
  const sanitizedSource = source.replace(/<\s*(script|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  return marked.parse(sanitizedSource, { async: false }) as string
}

/** Same idea, but for short inline text (note excerpts) — no block-level <p>/<h*> wrapping. */
export function renderInlineMarkdown(source: string): string {
  const sanitizedSource = source.replace(/<\s*(script|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  return marked.parseInline(sanitizedSource, { async: false }) as string
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
