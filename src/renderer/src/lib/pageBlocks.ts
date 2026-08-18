/** A rectangle in viewport pixel space at scale=1 (i.e. PDF points, y-down, origin top-left). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Shared shape for anything rendered as a cropped image + translated caption (figures and tables alike). */
interface MediaBlockBase {
  /** Bounding box (scale=1) of the region, so callers can crop it from a canvas rendered at any zoom/DPR by scaling this rect. */
  bbox: Rect
  captionOriginal: string
  captionTranslated?: string
}

export interface FigureBlock extends MediaBlockBase {
  type: 'figure'
}

/**
 * A table is handled the same way as a figure — cropped straight out of the rendered
 * page canvas rather than reconstructed as HTML — because translating individual cell
 * values (numbers, model names) with a small local LLM is far more likely to corrupt the
 * data than to render it faithfully. Only the caption is translated.
 */
export interface TableBlock extends MediaBlockBase {
  type: 'table'
}

export interface TextBlock {
  type: 'heading' | 'paragraph' | 'footnote'
  original: string
  translated?: string
}

export type PageBlock = FigureBlock | TableBlock | TextBlock

// A footnote marker: one or two digits (optionally followed by "." or ")"), or one of the
// classic superscript/symbol forms, sitting right at the start of the line — stripped off
// before judging whether there's any actual prose underneath it to translate.
const FOOTNOTE_SYMBOL_MARKER_RE = /^[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡§]{1,3}\s*/
const FOOTNOTE_NUMERIC_MARKER_RE = /^\d{1,2}[.)]?\s+/
// A superscript marker glued directly onto the following word with no gap at all (e.g.
// "1https://...", as pdf.js sometimes hands it back) — only peeled off when what follows
// is a letter, so an ordinary sentence that happens to start with a number is left alone.
const FOOTNOTE_GLUED_NUMERIC_MARKER_RE = /^\d{1,2}(?=[A-Za-z])/
const BARE_URL_RE = /^(https?:\/\/|www\.)\S+$/i
// A single "word" with no spaces that's really a bare domain/path (e.g. "github.com/foo"
// typed without a scheme) — not natural-language content either.
const BARE_DOMAIN_RE = /^[\w-]+(\.[a-z]{2,})+(\/\S*)?$/i

/**
 * Whether a footnote's text is actual prose worth sending to the translator, as opposed to
 * being nothing but a URL/domain name — translating "¹https://github.com/foo/bar" produces
 * garbage and there's no reason to. A footnote that mixes a URL into real sentence text
 * (e.g. "See https://example.com for details.") is still translated normally; only a
 * footnote that's *just* the link, once its leading marker is stripped, is skipped.
 */
export function footnoteNeedsTranslation(text: string): boolean {
  const stripped = text
    .trim()
    .replace(FOOTNOTE_SYMBOL_MARKER_RE, '')
    .replace(FOOTNOTE_NUMERIC_MARKER_RE, '')
    .replace(FOOTNOTE_GLUED_NUMERIC_MARKER_RE, '')
    .trim()
  if (!stripped) return false
  if (BARE_URL_RE.test(stripped)) return false
  if (!/\s/.test(stripped) && BARE_DOMAIN_RE.test(stripped)) return false
  return true
}

/** True for anything rendered as a cropped image + caption (figures and tables). */
export function isMediaBlock(block: PageBlock): block is FigureBlock | TableBlock {
  return block.type === 'figure' || block.type === 'table'
}

const FORMAT_TAG = 'fastread-blocks-v1'

interface SerializedPageBlocks {
  format: typeof FORMAT_TAG
  blocks: PageBlock[]
}

/** Persist a page's translated block structure (figures + headings + paragraphs) as one string, for the existing plain-TEXT page_translations column. */
export function serializeBlocks(blocks: PageBlock[]): string {
  const payload: SerializedPageBlocks = { format: FORMAT_TAG, blocks }
  return JSON.stringify(payload)
}

/**
 * Parses a cached translation back into structured blocks. Returns null for anything
 * that isn't our JSON format — either an older plain-text translation from before this
 * feature existed, or a page the reader manually rewrote via "Ham metin" (which collapses
 * back to plain text, since a free-form edit no longer has a figure/heading structure to
 * preserve). Callers should fall back to rendering that raw string as before.
 */
export function tryParseBlocks(raw: string): PageBlock[] | null {
  if (!raw || raw[0] !== '{') return null
  try {
    const data = JSON.parse(raw) as Partial<SerializedPageBlocks>
    if (data && data.format === FORMAT_TAG && Array.isArray(data.blocks)) {
      return data.blocks
    }
  } catch {
    // Not JSON — legacy plain-text translation.
  }
  return null
}

/** Plain-text rendition of a block list (used for the "Ham metin" editable view, and as the text handed to note/highlight matching). */
export function blocksToPlainText(blocks: PageBlock[], useTranslated: boolean): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (isMediaBlock(b)) {
      const caption = useTranslated ? b.captionTranslated : b.captionOriginal
      if (caption) parts.push(caption)
    } else {
      const text = useTranslated ? b.translated : b.original
      if (text) parts.push(text)
    }
  }
  return parts.join('\n\n')
}
