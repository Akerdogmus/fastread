// Reconstructs a page's reading structure (headings, paragraphs, figures) from pdf.js's
// raw text-content + operator-list output, instead of treating a page as one flattened
// blob of text. This lets the reader pane mirror the original's layout: figures get a
// placeholder instead of having their internal labels bleed into the surrounding prose,
// and section titles render as headings instead of plain paragraph text.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfDocument } from './pdf'
import type { FigureBlock, PageBlock, Rect, TableBlock, TextBlock } from './pageBlocks'

const { Util, OPS } = pdfjsLib

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageXObjectRepeat
])

// A constructPath op whose paint step is one of these actually puts ink on the page; the
// remaining possibility (OPS.endPath) is a clip-only path with nothing visible, and must
// not be mistaken for a drawn rule.
const PATH_PAINT_OPS = new Set<number>([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke
])

// Matches a figure or table caption in either language, e.g. "Figure 1:", "Fig. 2", "Şekil 3:",
// "Table 2:", "Tablo 1". Kept separate so a table's caption is never attached to a figure (or
// vice versa) even when both sit at a similar page height in a multi-column layout.
const FIGURE_CAPTION_RE = /^(figure|fig\.?|şekil)\s*\d+/i
const TABLE_CAPTION_RE = /^(table|tablo)\s*\d+/i
const CAPTION_RE = /^(figure|fig\.?|table|şekil|tablo)\s*\d+/i
// A short, numbered section title, e.g. "3 THE PLANTDOC DATASET" or "3.1 Data Collection".
const HEADING_NUMBERING_RE = /^\d+(\.\d+){0,2}\.?\s+\S/

// Separate horizontal/vertical merge margins: a figure grid's rows can have a generous
// vertical gap (labels sitting between rows of thumbnails), but the horizontal margin
// has to stay narrower than a typical two-column gutter (often ~15-25pt) or a figure in
// one column merges straight across the gutter into whatever sits in the next column.
const FIGURE_CLUSTER_MARGIN_X = 10 // pt
const FIGURE_CLUSTER_MARGIN_Y = 20 // pt
const FIGURE_CAPTION_MAX_DISTANCE = 90 // pt — how far a caption line may be from a figure and still be attributed to it
const CAPTION_COLUMN_MARGIN = 30 // pt — how much horizontal slack a caption's column may have vs its figure/table's column

// A vector/SVG-style chart (a matplotlib-rendered bar chart, say) has no raster image at
// all — its "content" is just filled bar rects plus a wall of individual axis-label text
// items, which the figure-clustering above never sees. Rotated text is the strongest
// available signal that a run of text belongs to a chart rather than a sentence: ordinary
// running prose is essentially never set at an angle, but a bar chart's category labels
// routinely are (rotated 30-90° so a long category name fits under a narrow bar). Bars
// plus nearby rotated labels are clustered in a pass kept entirely separate from the
// raster-figure clustering above (to minimize false-positive risk), and — exactly like a
// table's ruled region — that "core" is only promoted into an actual FigureBlock once a
// matching Figure/Şekil caption confirms it really is a chart and not some other rotated
// oddment on the page.
const CHART_LABEL_ROTATION_MIN_DEG = 20 // ° off horizontal (either direction) before text counts as a rotated chart-label candidate
const CHART_BAR_MAX_DIMENSION = 300 // pt — excludes a full-column background fill from ever being mistaken for a single bar
const CHART_CLUSTER_MARGIN_X = 12 // pt — merge margin between bars/rotated labels making up one chart's core
const CHART_CLUSTER_MARGIN_Y = 40 // pt — generous enough to bridge from a chart's plot area down to its (diagonally offset) rotated axis labels
const CHART_ABSORB_MARGIN_X = 20 // pt — how close a nearby short line (tick numbers, axis title, legend) must sit to a confirmed chart's region to be folded into it
const CHART_ABSORB_MARGIN_Y = 28
const CHART_ABSORB_MAX_ITER = 8 // safety cap on the absorb-then-regrow loop (see absorbChartSurroundings)

// A table's *presence* is found as vector graphics (see extractVisualRects), not by
// guessing at row shape from text gaps — real cells routinely wrap their text onto two
// lines (e.g. a narrow "Training Set" column wrapping "(Set %)" beneath it), which defeats
// any per-line "looks tabular" row-by-row scan. A ruled border doesn't care how the text
// inside happened to wrap: it's the same rect regardless. The row-shape heuristic isn't
// gone entirely, though — it's kept around in a much narrower role (looksLikeTableRow,
// below) purely to recognize an unruled boundary row (e.g. a header row with no top
// border) and a caption sitting flush against a table with no blank-line gap, neither of
// which the ruling itself can tell us.
const RULE_LINE_MAX_THICKNESS = 2.5 // pt — a drawn rect this thin (in either dimension) is a ruling, not a filled box
const RULE_LINE_MIN_LENGTH = 4 // pt — the long dimension must be at least this to count (excludes tiny artifacts)
const TABLE_RULE_MARGIN_X = 10 // pt — merge margin between rule segments of the same table; stays under a typical column gutter so two tables side-by-side in a 2-col layout never merge
const TABLE_RULE_MARGIN_Y = 30 // pt — merge margin between rule segments a row apart; large enough to bridge ordinary row spacing, small enough not to swallow the next table sitting just past this one's caption
const TABLE_RULE_MIN_MEMBERS = 2 // a cluster needs at least this many rule segments before it's considered a real table
const TABLE_CAPTION_MAX_DISTANCE = 90 // pt — how far a "Table N" caption may be from its ruled region
const TABLE_ROW_GAP_FACTOR = 0.9 // a line whose largest inter-item gap exceeds (fontSize * this) reads like several separated cell values rather than one prose sentence
const TABLE_ROW_MIN_GAPS = 2 // ...and needs at least this many such gaps (i.e. >= 3 columns) to count
const TABLE_EDGE_EXTEND_WINDOW = 24 // pt — how far beyond a table's *ruled* extent an unruled boundary row (e.g. a header row with no rule above it) may still sit and be folded in
const TABLE_EDGE_EXTEND_MAX_WINDOWS = 2 // ...at most this many such windows per edge, as a safety cap (a header row can itself span 2-3 wrapped sub-baselines, all within one window)
const TABLE_COLUMN_TOLERANCE = 4 // pt — how close an item's x-start must be to a known column start (see deriveColumnStarts) to count as sitting in that column
const TABLE_INTERIOR_MARGIN_X = 6 // pt — small horizontal slack when deciding whether a line of text sits inside a table's own column (cell text should already fall within the ruled width, this just covers font-metric edge effects)
const CAPTION_CONTINUATION_MAX_FONT_DELTA = 0.4 // pt — a caption's word-wrapped second line is set in the exact same size as its first
const CAPTION_CONTINUATION_MAX_GAP_RATIO = 1.6 // a continuation line sits at ordinary single-line spacing from the one before it

const HEADING_FONT_RATIO = 1.12 // a line's font must be at least this much larger than the page's body font to count as a heading on size — and, at this ratio, must also be visibly short (see HEADING_MAX_WIDTH_RATIO)
const HEADING_STRONG_FONT_RATIO = 1.35 // ...at this much larger, though, size alone settles it: a paper's title is set far above body size and may legitimately run the full width
const HEADING_MAX_WIDTH_RATIO = 0.8 // a merely-larger line must stop at least this far short of the page's full text measure — a wrapped line of prose, by definition, does not
const HEADING_MAX_LEN = 110

// A footnote is reliably smaller than the page's own body text (typically 70-85% of it)
// AND sits in the bottom slice of the page — font size alone would misfire on any other
// small-print text (an abstract set a point smaller, a dense inline citation), so both
// signals are required together.
const FOOTNOTE_FONT_RATIO = 0.85 // a line's font must be no larger than this fraction of the median body font
const FOOTNOTE_BOTTOM_SLACK = 6 // pt — a footnote-sized line may start slightly above the very last ordinary-sized line and still count (its rule/gap can sit a touch higher)
// A footnote marker sitting right at the start of a line — one of the classic superscript/
// symbol forms, or a plain digit followed by a separator/space — signals a *fresh* footnote
// rather than the word-wrapped continuation of the one before it (see groupIntoBlocks).
const FOOTNOTE_MARKER_START_RE = /^([¹²³⁴⁵⁶⁷⁸⁹⁰*†‡§]{1,3}|\d{1,2}[.):]?\s)/

// A figure/table sitting at the very top of column 2 can have a *smaller* absolute page-Y
// than text still unread near the bottom of column 1 — interleaving purely by global Y
// would wrongly surface it before that column-1 text. See detectColumnRanges, which finds
// the page's columns by scanning for the gutters between them.
const COLUMN_SCAN_BIN = 2 // pt — resolution of the horizontal coverage scan
const COLUMN_GUTTER_COVERAGE_RATIO = 0.2 // an x position crossed by fewer than this fraction of the busiest position's lines is gutter or margin, not column — set high enough that a handful of full-width lines (title, authors) can straddle a gutter without hiding it
const COLUMN_MIN_WIDTH_RATIO = 0.12 // a covered band narrower than this fraction of the page isn't a column, just an isolated stray (a page number, a rotated stamp)

interface RawTextItem {
  str: string
  x: number
  xEnd: number
  yBaseline: number
  fontSize: number
  orderIndex: number
  /** Unit vector along this item's own baseline direction, in page space — (1, 0) for
   *  ordinary upright text. xEnd above is only a horizontal *projection* of the item's
   *  extent and degenerates toward x itself as rotation approaches 90°; dirX/dirY (with
   *  length below) recover the item's true bounding box regardless of rotation — see
   *  itemRect — and its rotation angle — see isRotatedText. */
  dirX: number
  dirY: number
  /** The item's extent along its own baseline direction (dirX, dirY), in page points —
   *  equal to xEnd - x for upright text, but the only correct measure once rotated. */
  length: number
}

interface VisualRects {
  /** Every raster image's on-page rectangle. */
  imageRects: Rect[]
  /** Every thin, ruling-shaped filled/stroked rect — the border lines a table is built from. */
  ruleRects: Rect[]
  /** Every filled/stroked rect that ISN'T thin (so, not a rule) and isn't implausibly huge
   *  either — the vector-graphic equivalent of a chart's bars. */
  barRects: Rect[]
}

/**
 * Walks the page's operator list once, tracking the current transform through
 * save/restore/cm/form-XObject ops (the same math pdf.js itself uses when actually
 * painting the page), and pulls out two kinds of on-page rectangle from it:
 *
 * - image rects, from paintImageXObject-family ops (an image's implicit unit square,
 *   mapped through the current transform);
 * - rule rects, from constructPath ops that actually put ink down (fill/stroke, not a
 *   clip-only endPath) whose bounding box is thin in one dimension — a CSS border line,
 *   once printed to PDF, comes out as exactly this: a thin filled rectangle, not a
 *   hand-drawn "line" op. constructPath's own args carry a ready-made bounding box
 *   (args[2] = [minX, minY, maxX, maxY]) in the same pre-transform space the path was
 *   built in, so it only needs the transform applied — no path-segment decoding required.
 */
async function extractVisualRects(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport
): Promise<VisualRects> {
  const opList = await page.getOperatorList()
  let ctm: number[] = viewport.transform as unknown as number[]
  const stack: number[][] = []
  const imageRects: Rect[] = []
  const ruleRects: Rect[] = []
  const barRects: Rect[] = []

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i] as unknown

    if (fn === OPS.save) {
      stack.push(ctm)
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm
    } else if (fn === OPS.transform) {
      ctm = Util.transform(ctm, args as number[])
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      const matrix = (args as [number[] | null])[0]
      if (matrix) ctm = Util.transform(ctm, matrix)
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm
    } else if (IMAGE_OPS.has(fn)) {
      const corners: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ]
      for (const c of corners) Util.applyTransform(c, ctm)
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const width = Math.max(...xs) - x
      const height = Math.max(...ys) - y
      // Skip degenerate/hairline rects (occasionally emitted for 1x1 shading masks etc.)
      if (width > 3 && height > 3) imageRects.push({ x, y, width, height })
    } else if (fn === OPS.constructPath) {
      const [paintOp, , minMax] = args as [
        number,
        [Float32Array | null],
        [number, number, number, number] | null
      ]
      if (!minMax || !PATH_PAINT_OPS.has(paintOp)) continue
      const corners: Array<[number, number]> = [
        [minMax[0], minMax[1]],
        [minMax[2], minMax[3]]
      ]
      for (const c of corners) Util.applyTransform(c, ctm)
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const width = Math.max(...xs) - x
      const height = Math.max(...ys) - y
      const thin = Math.min(width, height)
      const long = Math.max(width, height)
      if (thin <= RULE_LINE_MAX_THICKNESS && long >= RULE_LINE_MIN_LENGTH) {
        ruleRects.push({ x, y, width, height })
      } else if (long <= CHART_BAR_MAX_DIMENSION) {
        barRects.push({ x, y, width, height })
      }
    }
  }
  return { imageRects, ruleRects, barRects }
}

function rectsClose(a: Rect, b: Rect, marginX: number, marginY: number): boolean {
  return (
    a.x - marginX < b.x + b.width &&
    b.x - marginX < a.x + a.width &&
    a.y - marginY < b.y + b.height &&
    b.y - marginY < a.y + a.height
  )
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y
  }
}

interface ClusterMember {
  rect: Rect
  kind: 'image' | 'label' | 'rule' | 'bar'
  /** For kind 'label': every raw item making up this label's line (or, for a rotated chart
   *  label, just the one item), so all of them can be excluded from prose together if the
   *  line ends up absorbed into a figure/chart. */
  items?: RawTextItem[]
}

interface Cluster {
  bbox: Rect
  members: ClusterMember[]
}

/**
 * A real figure is usually several nearby image draws (a grid of sample photos, a
 * multi-panel chart) plus short label/legend text sitting *between* them (column
 * headers, row labels) rather than one clean image with nothing else nearby. Rather than
 * clustering images alone and then separately guessing which text is "inside" the
 * result, images and short label-shaped text are clustered together in one pass: a
 * cluster that ends up containing at least one real image is a figure, and every label
 * that got pulled into it is figure-internal — to be excluded from prose and folded into
 * the figure's bounding box so a crop of that box actually shows the label too.
 *
 * The same function does double duty for tables: clustering rule-rects alone (no labels
 * involved — a table's own text is absorbed separately, by bbox-containment, once its
 * ruled extent is known) into contiguous ruled regions.
 */
function clusterWithMembership(
  members: ClusterMember[],
  marginX: number,
  marginY: number
): Cluster[] {
  let clusters: Cluster[] = members.map((m) => ({ bbox: m.rect, members: [m] }))
  let mergedAny = true
  while (mergedAny) {
    mergedAny = false
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (rectsClose(clusters[i].bbox, clusters[j].bbox, marginX, marginY)) {
          const merged: Cluster = {
            bbox: unionRect(clusters[i].bbox, clusters[j].bbox),
            members: [...clusters[i].members, ...clusters[j].members]
          }
          clusters = clusters.filter((_, idx) => idx !== i && idx !== j)
          clusters.push(merged)
          mergedAny = true
          break outer
        }
      }
    }
  }
  return clusters
}

/** A short line that isn't shaped like a heading or a caption is a plausible figure-internal label (e.g. "PVD", "Apple Black Rot") — real body text lines are almost always much longer than this. */
function isLabelCandidate(text: string): boolean {
  if (text.length >= 40) return false
  if (CAPTION_RE.test(text)) return false
  if (HEADING_NUMBERING_RE.test(text)) return false
  return true
}

async function extractRawTextItems(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport
): Promise<RawTextItem[]> {
  const content = await page.getTextContent()
  const items: RawTextItem[] = []
  for (const raw of content.items) {
    if (!('str' in raw) || !raw.str.trim()) continue
    const m = Util.transform(viewport.transform as unknown as number[], raw.transform as number[])
    const fontSize = Math.hypot(m[2], m[3]) || 1
    // raw.width is already expressed in absolute page-point units (the same units as the
    // translation component m[4]/m[5]), not a 0–1 "text space" unit — it must NOT be
    // multiplied by the transform's own scale again, only projected along the text's
    // baseline direction (m[0]/fontSize, m[1]/fontSize) to account for any rotation.
    const dirX = m[0] / fontSize
    const dirY = m[1] / fontSize
    items.push({
      str: raw.str,
      x: m[4],
      xEnd: m[4] + raw.width * dirX,
      yBaseline: m[5],
      fontSize,
      orderIndex: items.length,
      dirX,
      dirY,
      length: raw.width
    })
  }
  return items
}

/**
 * Whether an item's baseline runs at a meaningful angle off horizontal — folding away the
 * 180°-periodicity of atan2 first, so upside-down-but-still-horizontal text (dirX < 0)
 * reads the same as rightside-up. Virtually no ordinary running prose is set at an angle;
 * a bar chart's rotated category labels are the common real-world case this is meant to
 * catch (see CHART_LABEL_ROTATION_MIN_DEG).
 */
function isRotatedText(item: RawTextItem): boolean {
  let deg = (Math.atan2(item.dirY, item.dirX) * 180) / Math.PI
  deg = ((deg % 180) + 180) % 180 // fold to [0, 180)
  if (deg > 90) deg -= 180 // fold to (-90, 90]
  return Math.abs(deg) > CHART_LABEL_ROTATION_MIN_DEG
}

interface LineInfo {
  text: string
  fontSize: number
  y: number
  xStart: number
  xEnd: number
  items: RawTextItem[]
  /** Largest horizontal gap between two consecutive items on this line — a handful of
   *  large gaps (i.e. several distinct columns) is the signal used to spot table rows. */
  maxGap: number
}

/** Groups same-line text items (by baseline proximity) into lines, joining words with a space only where the horizontal gap between items suggests one was actually there. Keeps each line's contributing items and its largest internal gap, both needed to spot table-row-shaped lines and to let a multi-fragment caption (common when a PDF splits one line across several text runs) be recognized and consumed as a whole. */
function groupIntoLinesDetailed(items: RawTextItem[]): LineInfo[] {
  const lines: LineInfo[] = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    const tolerance = Math.max(1.5, item.fontSize * 0.35)
    if (last && Math.abs(last.y - item.yBaseline) < tolerance) {
      const gap = item.x - last.xEnd
      last.text += gap > item.fontSize * 0.18 ? ` ${item.str}` : item.str
      last.xEnd = item.xEnd
      last.fontSize = Math.max(last.fontSize, item.fontSize)
      last.items.push(item)
      if (gap > last.maxGap) last.maxGap = gap
    } else {
      lines.push({
        text: item.str,
        fontSize: item.fontSize,
        y: item.yBaseline,
        xStart: item.x,
        xEnd: item.xEnd,
        items: [item],
        maxGap: 0
      })
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text)
}

/**
 * A table row *reads* as several short cell values separated by wide gaps — much wider
 * than the space between two words — rather than one continuous run of prose. This is no
 * longer how tables are actually found (see extractVisualRects/RULE_LINE_*): real cells
 * routinely wrap across sub-baselines, which defeats any attempt to scan row-by-row this
 * way. It's kept only as a light, local signal for two narrow jobs where the ruling itself
 * doesn't help — recognizing a caption sitting flush against a table row (startsNewSentence)
 * and recognizing an unruled boundary row just past a table's ruled extent (extendTableBbox).
 */
function looksLikeTableRow(line: LineInfo): boolean {
  let bigGaps = 0
  for (let i = 1; i < line.items.length; i++) {
    const gap = line.items[i].x - line.items[i - 1].xEnd
    if (gap > line.items[i].fontSize * TABLE_ROW_GAP_FACTOR) bigGaps++
  }
  return bigGaps >= TABLE_ROW_MIN_GAPS
}

/** Whether a line's horizontal extent overlaps a rect's (or another line's), with slack — used to keep a caption from being attributed to a figure/table sitting in a different column of a multi-column page. */
function xOverlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  margin: number
): boolean {
  return aStart - margin < bEnd && bStart - margin < aEnd
}

// A word-wrapped line that merely *starts with* "Figure 2." or "Table 1" mid-sentence
// (e.g. "...classes shown in Figure 2. We performed two main experiments...") must never
// be mistaken for that figure/table's actual caption — it only reads that way because of
// where the column happened to wrap. A real caption instead starts a new sentence: either
// nothing precedes it in this column, or the previous line already ended one (terminal
// punctuation), or there's a block-level vertical gap before it, or — since a table
// caption commonly sits flush against its own table's last row with perfectly ordinary
// line spacing, and that row never ends in sentence punctuation itself — the previous line
// reads like a table row.
function startsNewSentence(idx: number, lines: LineInfo[]): boolean {
  if (idx === 0) return true
  const prev = lines[idx - 1]
  const cur = lines[idx]
  const bigGap = Math.abs(cur.y - prev.y) > Math.max(cur.fontSize, prev.fontSize) * 1.8
  const endsSentence = /[.!?:]["')\]]?\s*$/.test(prev.text.trim())
  const afterTableRow = looksLikeTableRow(prev)
  return bigGap || endsSentence || afterTableRow
}

/**
 * A caption that word-wraps onto a second (or third) physical line must be captured in
 * full — otherwise its tail leaks into the surrounding prose as an orphan fragment, and the
 * caption shown to the reader is truncated. A continuation line is recognized by sitting in
 * the same column, at ordinary single-line spacing from the one before it, in essentially
 * the same font size as the caption's own first line (a caption is typically set in its own
 * distinct size/style, unlike the body text that would otherwise resume right after it) —
 * and, naturally, not itself starting some other block (heading, another caption, or a
 * tabular-looking row).
 */
function collectCaptionContinuation(
  startIdx: number,
  lines: LineInfo[],
  consumedLines: Set<number>
): { text: string; consumedIdx: number[] } {
  const first = lines[startIdx]
  let text = first.text
  let cursor = first
  const consumedIdx: number[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (consumedLines.has(i)) break
    const next = lines[i]
    if (FIGURE_CAPTION_RE.test(next.text) || TABLE_CAPTION_RE.test(next.text)) break
    if (HEADING_NUMBERING_RE.test(next.text)) break
    if (looksLikeTableRow(next)) break
    if (Math.abs(next.fontSize - first.fontSize) > CAPTION_CONTINUATION_MAX_FONT_DELTA) break
    if (Math.abs(next.y - cursor.y) > cursor.fontSize * CAPTION_CONTINUATION_MAX_GAP_RATIO) break
    if (!xOverlaps(next.xStart, next.xEnd, first.xStart, first.xEnd, CAPTION_COLUMN_MARGIN)) break
    text += ` ${next.text}`
    consumedIdx.push(i)
    cursor = next
  }
  return { text, consumedIdx }
}

/**
 * An item's on-page bounding box, built from its full baseline direction rather than a
 * horizontal projection — required for a rotated item (a chart axis label, typically), for
 * which xEnd - x above degenerates toward zero. Degenerates to exactly the previous,
 * horizontal-only calculation for ordinary upright text (dirX=1, dirY=0): "up" from the
 * baseline is then (0, -1) — page space is y-down, so that's a smaller y, matching the
 * ascender going up the page — and the box reduces to [x, yBaseline-0.85*fontSize,
 * length, 1.2*fontSize], the same numbers as before.
 */
function itemRect(item: RawTextItem): Rect {
  const ascent = item.fontSize * 0.85
  const descent = item.fontSize * 0.35
  const upX = item.dirY
  const upY = -item.dirX
  const x0 = item.x
  const y0 = item.yBaseline
  const x1 = item.x + item.dirX * item.length
  const y1 = item.yBaseline + item.dirY * item.length
  const corners: Array<[number, number]> = [
    [x0 + upX * ascent, y0 + upY * ascent],
    [x0 - upX * descent, y0 - upY * descent],
    [x1 + upX * ascent, y1 + upY * ascent],
    [x1 - upX * descent, y1 - upY * descent]
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
}

/**
 * The distinct horizontal start positions cells in this table actually use, derived from
 * its already-confirmed interior content (the items inside its *ruled* extent, before any
 * edge extension). This is the strongest columnar fingerprint available for recognizing
 * more of the same table just past its ruled edge: it doesn't depend on any one row's text
 * having wrapped a particular way, since it's built from every row at once.
 */
function deriveColumnStarts(items: RawTextItem[]): number[] {
  const xs = [...items.map((it) => it.x)].sort((a, b) => a - b)
  const starts: number[] = []
  for (const x of xs) {
    if (!starts.length || x - starts[starts.length - 1] > TABLE_COLUMN_TOLERANCE * 2) starts.push(x)
  }
  return starts
}

/**
 * A table's ruled extent (see extractVisualRects) can still miss a boundary row that has
 * no rule of its own — e.g. a header row drawn with only a border-*bottom* on each cell, so
 * nothing bounds its *top* edge. Worse, that boundary row's own cells routinely wrap onto
 * several sub-baselines with too few items each to look "row-shaped" on their own (a narrow
 * header cell wrapping "Training" / "Set" onto two lines, sitting beside single-line
 * neighbours vertically centered around it) — so row-shape can't be the test here the way
 * it is for startsNewSentence. Instead, a whole window of unclaimed lines just past the
 * current edge is pulled in at once and checked together: if their items, combined, land on
 * at least two of the table's own known column positions, that's enough evidence the window
 * is one more (wrapped) row of the same table, regardless of how any single line within it
 * happened to break.
 */
function extendTableBbox(
  bbox: Rect,
  captionIdx: number,
  lines: LineInfo[],
  consumedLines: Set<number>
): { bbox: Rect; absorbedIndices: number[] } {
  const interiorItems = lines
    .filter((l) => l.y >= bbox.y - 0.5 && l.y <= bbox.y + bbox.height + 0.5)
    .flatMap((l) => l.items)
  const columnStarts = deriveColumnStarts(interiorItems)

  let top = bbox.y
  let bottom = bbox.y + bbox.height
  const absorbedIndices: number[] = []

  for (const dir of [-1, 1] as const) {
    for (let n = 0; n < TABLE_EDGE_EXTEND_MAX_WINDOWS; n++) {
      const edge = dir === -1 ? top : bottom
      const windowLines = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line, idx }) => {
          if (idx === captionIdx || consumedLines.has(idx) || absorbedIndices.includes(idx))
            return false
          if (FIGURE_CAPTION_RE.test(line.text) || TABLE_CAPTION_RE.test(line.text)) return false
          if (HEADING_NUMBERING_RE.test(line.text)) return false
          if (!xOverlaps(line.xStart, line.xEnd, bbox.x, bbox.x + bbox.width, TABLE_RULE_MARGIN_X))
            return false
          const gap = dir === -1 ? edge - line.y : line.y - edge
          return gap > 0 && gap <= TABLE_EDGE_EXTEND_WINDOW
        })
      if (windowLines.length === 0) break

      const touchedColumns = new Set<number>()
      for (const { line } of windowLines) {
        for (const item of line.items) {
          const ci = columnStarts.findIndex((cx) => Math.abs(cx - item.x) <= TABLE_COLUMN_TOLERANCE)
          if (ci !== -1) touchedColumns.add(ci)
        }
      }
      if (touchedColumns.size < 2) break

      for (const { idx, line } of windowLines) {
        absorbedIndices.push(idx)
        if (dir === -1) top = Math.min(top, line.y - line.fontSize * 0.85)
        else bottom = Math.max(bottom, line.y + line.fontSize * 0.35)
      }
    }
  }

  return { bbox: { x: bbox.x, y: top, width: bbox.width, height: bottom - top }, absorbedIndices }
}

/**
 * Once a table's final bbox is known (ruled extent plus any extendTableBbox edges), every
 * other line whose baseline falls inside it and whose column overlaps it is that table's
 * own cell text — regardless of how the cell wrapped — and must be pulled out of the prose
 * stream. This is what the old text-gap row scanner was trying (and routinely failing) to
 * do; bbox containment against a geometrically-confirmed region doesn't have that problem.
 */
function absorbTableInterior(
  bbox: Rect,
  captionIdx: number,
  lines: LineInfo[],
  consumedLines: Set<number>
): number[] {
  const absorbed: number[] = []
  lines.forEach((line, idx) => {
    if (idx === captionIdx || consumedLines.has(idx)) return
    if (FIGURE_CAPTION_RE.test(line.text) || TABLE_CAPTION_RE.test(line.text)) return
    if (line.y < bbox.y - 0.5 || line.y > bbox.y + bbox.height + 0.5) return
    if (!xOverlaps(line.xStart, line.xEnd, bbox.x, bbox.x + bbox.width, TABLE_INTERIOR_MARGIN_X))
      return
    absorbed.push(idx)
  })
  return absorbed
}

/**
 * Once a chart's core (bars + rotated axis labels — see the caption-attachment loop in
 * extractPageLayout) is confirmed by a matching caption, its remaining furniture — the
 * (non-rotated) tick numbers, an axis title, a legend — still needs to be folded in so
 * none of it leaks into the prose stream. A chart has no ruled border to extend along the
 * way a table does, so this instead repeatedly absorbs any nearby short, label-shaped line
 * (see isLabelCandidate) touching the region's current bounding box, growing that box each
 * round, until a round absorbs nothing new. Restricting this to label-shaped lines is what
 * keeps it from ever reaching out and swallowing an ordinary paragraph that just happens to
 * sit close to the chart.
 *
 * A rotated item (e.g. a Y-axis title, itself rotated 90° and so not part of `lines` at
 * all) can easily sit further from the bars than the tight initial clustering margin
 * allows, yet end up well within reach *after* the box has grown a little from absorbing
 * the tick numbers between it and the bars — so rotated candidates are folded into this
 * same growing loop rather than only being considered once, up front, at the original
 * (smaller) core-cluster bbox. Absorbed rotated items are added directly to
 * claimedRotatedItems so the caller's "leftover, never claimed" pass doesn't also surface
 * them as a stray fallback paragraph.
 */
function absorbChartSurroundings(
  bbox: Rect,
  captionIdx: number,
  lines: LineInfo[],
  consumedLines: Set<number>,
  rotatedCandidates: RawTextItem[],
  claimedRotatedItems: Set<RawTextItem>
): { bbox: Rect; absorbedIndices: number[] } {
  let current = bbox
  const absorbed: number[] = []
  for (let iter = 0; iter < CHART_ABSORB_MAX_ITER; iter++) {
    let grew = false
    lines.forEach((line, idx) => {
      if (idx === captionIdx || consumedLines.has(idx) || absorbed.includes(idx)) return
      if (FIGURE_CAPTION_RE.test(line.text) || TABLE_CAPTION_RE.test(line.text)) return
      if (HEADING_NUMBERING_RE.test(line.text)) return
      if (!isLabelCandidate(line.text)) return
      const lineRect: Rect = {
        x: line.xStart,
        y: line.y - line.fontSize * 0.85,
        width: Math.max(1, line.xEnd - line.xStart),
        height: line.fontSize * 1.2
      }
      if (!rectsClose(lineRect, current, CHART_ABSORB_MARGIN_X, CHART_ABSORB_MARGIN_Y)) return
      absorbed.push(idx)
      current = unionRect(current, lineRect)
      grew = true
    })
    for (const item of rotatedCandidates) {
      if (claimedRotatedItems.has(item)) continue
      if (!isLabelCandidate(item.str)) continue
      const rect = itemRect(item)
      if (!rectsClose(rect, current, CHART_ABSORB_MARGIN_X, CHART_ABSORB_MARGIN_Y)) continue
      claimedRotatedItems.add(item)
      current = unionRect(current, rect)
      grew = true
    }
    if (!grew) break
  }
  return { bbox: current, absorbedIndices: absorbed }
}

/**
 * Being set a little larger than the body font is, on its own, weak evidence of a heading —
 * and acting on it alone breaks badly on any page where the body-size estimate is pulled
 * downward by a mass of small print (a closing page carrying a short conclusion plus a long
 * reference list: see deriveBodyFontSize). There, every ordinary conclusion line measures
 * "larger than body" and, because headings never merge with their neighbours, the paragraph
 * shatters into one heading per physical line.
 *
 * So a merely-larger line has to corroborate: a real heading also *stops well short of the
 * column's right edge*, while a wrapped line of prose runs the full measure — that's what
 * makes it a wrapped line in the first place. Only a decisively larger font (a paper's
 * title, which can legitimately fill the full width and even wrap) skips that requirement.
 * The numbering and all-caps rules stand on their own as before; both are independent
 * evidence that doesn't depend on any size estimate.
 */
function looksLikeHeading(
  text: string,
  fontSize: number,
  bodyFontSize: number,
  lineWidth: number,
  textWidth: number,
  continuesParagraph: boolean
): boolean {
  if (text.length > HEADING_MAX_LEN) return false

  // Section numbering and all-caps are self-evident: they say "heading" no matter what the
  // surrounding text is doing, so they're checked first and are never suppressed below.
  if (HEADING_NUMBERING_RE.test(text)) return true
  const letters = text.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
  if (letters.length >= 4 && text === text.toUpperCase() && text.length < 70) return true

  // Size, by contrast, is only ever circumstantial evidence — and inside a paragraph that's
  // already running it means nothing at all (see the caller), so it doesn't get consulted.
  if (continuesParagraph) return false
  if (fontSize > bodyFontSize * HEADING_STRONG_FONT_RATIO) return true
  if (
    fontSize > bodyFontSize * HEADING_FONT_RATIO &&
    lineWidth < textWidth * HEADING_MAX_WIDTH_RATIO
  )
    return true
  return false
}

/**
 * A footnote reads at a smaller size than the page's own body text AND sits at or below
 * where the ordinary-sized body text on this page actually stops — both signals are
 * required together (font size alone would misfire on any other small-print text
 * elsewhere on the page, e.g. a reference list entry). "Below where body text stops" is
 * deliberately relative to this page's own content rather than a fixed fraction of the
 * full page height: a page that doesn't run all the way to the bottom margin (a short
 * final page, a page with a lot of figures) would otherwise never trip an absolute
 * bottom-of-page threshold at all.
 */
function looksLikeFootnote(
  fontSize: number,
  y: number,
  medianFontSize: number,
  bodyBottomY: number
): boolean {
  return (
    fontSize <= medianFontSize * FOOTNOTE_FONT_RATIO && y >= bodyBottomY - FOOTNOTE_BOTTOM_SLACK
  )
}

/**
 * The page's body-text font size: the size that the most *characters* on the page are set
 * in, rounded to a quarter point so trivially different sizes (9.6 vs 9.63) count as one.
 *
 * Character-weighted mode, rather than the median of the per-line sizes, because the median
 * is badly skewed by which *lines* happen to survive onto a page. A closing page holding a
 * short conclusion plus a long reference list plus two footnotes has more small-print lines
 * than body lines, so a line-median lands on the reference size — and every ordinary body
 * line then measures "much larger than the body font" and is misread as a heading (headings
 * never merge, so the conclusion would shatter into one heading per physical line). Weighing
 * by character count instead asks the more meaningful question — which size is most of this
 * page's actual text set in — and answers it correctly whether the page is mostly prose,
 * mostly references, or an even mix.
 */
function deriveBodyFontSize(lines: Array<{ text: string; fontSize: number }>): number {
  const charsBySize = new Map<number, number>()
  for (const line of lines) {
    if (line.fontSize <= 0) continue
    const bucket = Math.round(line.fontSize * 4) / 4
    charsBySize.set(bucket, (charsBySize.get(bucket) ?? 0) + line.text.length)
  }
  let best = 10
  let bestChars = -1
  for (const [size, chars] of charsBySize) {
    // Ties break toward the larger size: body text is never the smallest thing on a page.
    if (chars > bestChars || (chars === bestChars && size > best)) {
      bestChars = chars
      best = size
    }
  }
  return best
}

interface TextBlockEntry {
  block: TextBlock
  y: number
  xStart: number
  xEnd: number
}

type BlockKind = 'heading' | 'paragraph' | 'footnote'

/**
 * Groups consecutive body lines into paragraphs, breaking on unusually large vertical
 * gaps, a switch into/out of heading-sized (or footnote-sized) text, or a crossing from one
 * column into the next. Returns each block alongside the position (Y, and the starting
 * line's X-range) of the line it started on, so the caller can later interleave figures into
 * this sequence by position, without having to re-derive "which line did this block start
 * on" from the merged text.
 *
 * The column seam has to be an explicit break because vertical spacing can't reveal it: the
 * bottom of one column and the top of the next are consecutive in reading order but sit at
 * unrelated heights, and when the next column happens to start slightly *below* where the
 * last one ended, the seam is indistinguishable from ordinary line spacing — silently
 * welding the tail of one column onto the head of the next.
 */
function groupIntoBlocks(
  lines: Array<{ text: string; fontSize: number; y: number; xStart: number; xEnd: number }>,
  columns: ColumnRange[]
): TextBlockEntry[] {
  if (lines.length === 0) return []

  const gaps = lines.slice(1).map((l, i) => Math.abs(l.y - lines[i].y))
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const typicalGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0
  const bodyFontSize = deriveBodyFontSize(lines)
  // The bottommost line that reads as ordinary body text (i.e. not itself footnote-sized) —
  // see looksLikeFootnote. Deliberately derived from this page's own content rather than a
  // fixed fraction of the page height, so the check still works on a page that doesn't run
  // all the way down to the bottom margin.
  const bodyLines = lines.filter((l) => l.fontSize > bodyFontSize * FOOTNOTE_FONT_RATIO)
  const bodyBottomY = bodyLines.length ? Math.max(...bodyLines.map((l) => l.y)) : -Infinity
  // The full measure a wrapped line of prose runs to — i.e. a column's text width, or the
  // page's if it isn't columned. Taken as the widest line present rather than an average,
  // since that is exactly the "line that reached the right margin" being looked for.
  const textWidth = Math.max(...lines.map((l) => l.xEnd - l.xStart), 1)

  const result: TextBlockEntry[] = []
  let current: {
    text: string
    fontSize: number
    kind: BlockKind
    y: number
    xStart: number
    xEnd: number
  } | null = null

  let currentColumn = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const gapFromPrev = i > 0 ? Math.abs(line.y - lines[i - 1].y) : Infinity
    const bigGap = typicalGap > 0 && gapFromPrev > typicalGap * 1.35
    const fontSwitch = current !== null && Math.abs(line.fontSize - current.fontSize) > 0.75
    const column = columns.length ? nearestColumnIndex((line.xStart + line.xEnd) / 2, columns) : 0
    const columnChanged = current !== null && column !== currentColumn

    // A paragraph already in progress simply carries on into a line set in the same size at
    // ordinary line spacing — that line is a continuation, and is never re-judged on its own
    // shape. Without this, a paragraph's *last* line gets misread as a heading whenever the
    // page's body-size estimate is low (see looksLikeHeading): being the last line, it stops
    // short of the full measure, which is precisely the shape a heading has. Note this only
    // protects a run already established as prose — a two-line title stays two heading lines,
    // because the block it would be continuing is itself a heading, not a paragraph — and it
    // never reaches across a column seam, where "the line above" is not the line before.
    const continuesParagraph =
      current !== null && current.kind === 'paragraph' && !bigGap && !fontSwitch && !columnChanged

    // Heading wins over footnote if a line's shape somehow satisfies both (e.g. a short,
    // bottom-of-page, oddly-sized line) — an actual footnote is never heading-numbered or
    // all-caps in the way looksLikeHeading tests for, so this ordering is only a tie-break.
    const kind: BlockKind = looksLikeHeading(
      line.text,
      line.fontSize,
      bodyFontSize,
      line.xEnd - line.xStart,
      textWidth,
      continuesParagraph
    )
      ? 'heading'
      : continuesParagraph
        ? 'paragraph'
        : looksLikeFootnote(line.fontSize, line.y, bodyFontSize, bodyBottomY)
          ? 'footnote'
          : 'paragraph'
    // Several distinct footnotes commonly sit stacked with no gap at all between them (each
    // its own line, right below the last) — without this, footnote 1 and footnote 2 would
    // merge into a single block, and a URL-only footnote 1 could no longer be told apart
    // from a prose-bearing footnote 2 once translation time decides what to skip. A line
    // that itself opens with a fresh footnote marker is a new footnote, never a continuation
    // of the one before it (a word-wrapped continuation line never starts with one).
    const startsNewFootnote = kind === 'footnote' && FOOTNOTE_MARKER_START_RE.test(line.text)

    // A heading never merges with anything, even another heading right below it (kept from
    // the original heading-only logic this generalizes). A footnote merges with a preceding
    // footnote line the same way a paragraph merges with a preceding paragraph — so a
    // word-wrapped footnote reads as one block — but never with a paragraph or heading.
    const startsNewBlock =
      current === null ||
      kind === 'heading' ||
      current.kind === 'heading' ||
      kind !== current.kind ||
      startsNewFootnote ||
      columnChanged ||
      bigGap ||
      fontSwitch

    if (startsNewBlock || !current) {
      if (current) {
        result.push({
          block: { type: current.kind, original: current.text },
          y: current.y,
          xStart: current.xStart,
          xEnd: current.xEnd
        })
      }
      current = {
        text: line.text,
        fontSize: line.fontSize,
        kind,
        y: line.y,
        xStart: line.xStart,
        xEnd: line.xEnd
      }
    } else {
      current.text += ` ${line.text}`
    }
    currentColumn = column
  }
  if (current) {
    result.push({
      block: { type: current.kind, original: current.text },
      y: current.y,
      xStart: current.xStart,
      xEnd: current.xEnd
    })
  }
  return result.filter((entry) => hasTranslatableContent(entry.block.original))
}

/**
 * Whether a block holds anything a translator could actually work on. A superscript
 * footnote/citation marker in running text ("...released publicly.¹") is set a couple of
 * points smaller than the body, so the font-switch rule splits it off as a block of its
 * own — leaving a block whose entire content is "1". Sending that to the model returns a
 * spelled-out number ("bir") dropped into the page as if it were a sentence. Anything with
 * no letters at all and barely any length is one of these markers, a stray page number, or
 * a rule artifact; none of them carry meaning worth a translation round-trip.
 */
function hasTranslatableContent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/\p{L}/u.test(trimmed)) return true
  return trimmed.length > 3
}

/** The min distance from a caption line to a candidate region's top/bottom edge. */
function verticalDistanceToRect(lineY: number, rect: Rect): number {
  return Math.min(Math.abs(lineY - rect.y), Math.abs(lineY - (rect.y + rect.height)))
}

interface ColumnRange {
  xStart: number
  xEnd: number
}

/**
 * Recovers the page's column layout by finding its *gutters* — the vertical bands of white
 * space that almost no line crosses — from the complete, unfiltered line list.
 *
 * Every x position on the page is scored by how many lines horizontally span it. Inside a
 * column that count is high (every line of running text covers it); in the gutter between
 * two columns it collapses to near zero. A band still counts as a gutter even when a few
 * lines do cross it, which is what makes this robust on a real paper's first page: the
 * title, authors and affiliation run the full width across the top, straddling the gutter,
 * but four such lines against forty lines of body text per column leave the gutter's score
 * far below any column's.
 *
 * Reading order comes out as simple left-to-right band order. The obvious alternative —
 * inferring the seam from content-stream order, where Y jumps back up as one column ends
 * and the next begins — is what this replaced, because a column's x-range then came from
 * whatever range of lines happened to fall between two seams: a full-width title widened
 * the first column to the whole page, and any content emitted out of flow (Chromium writes
 * a chart's own labels after the surrounding text, not in place) widened the second. Both
 * columns then overlapped so heavily that a right-column table could be filed under the
 * left column and surface among its opening paragraphs.
 */
function detectColumnRanges(lines: LineInfo[], pageWidth: number): ColumnRange[] {
  if (lines.length === 0 || pageWidth <= 0) return []

  const binCount = Math.ceil(pageWidth / COLUMN_SCAN_BIN) + 1
  const coverage = new Array<number>(binCount).fill(0)
  for (const line of lines) {
    const from = Math.max(0, Math.floor(line.xStart / COLUMN_SCAN_BIN))
    const to = Math.min(binCount - 1, Math.ceil(line.xEnd / COLUMN_SCAN_BIN))
    for (let b = from; b <= to; b++) coverage[b]++
  }

  const peak = Math.max(...coverage)
  if (peak === 0) return []
  const threshold = peak * COLUMN_GUTTER_COVERAGE_RATIO

  const bands: ColumnRange[] = []
  let bandStart = -1
  for (let b = 0; b < binCount; b++) {
    const covered = coverage[b] > threshold
    if (covered && bandStart === -1) bandStart = b
    else if (!covered && bandStart !== -1) {
      bands.push({ xStart: bandStart * COLUMN_SCAN_BIN, xEnd: b * COLUMN_SCAN_BIN })
      bandStart = -1
    }
  }
  if (bandStart !== -1) bands.push({ xStart: bandStart * COLUMN_SCAN_BIN, xEnd: pageWidth })

  const columns = bands.filter((b) => b.xEnd - b.xStart >= pageWidth * COLUMN_MIN_WIDTH_RATIO)
  // A page whose text is too sparse or too irregular to show clean gutters (a title page, a
  // full-page figure) falls back to one column spanning everything, which is exactly the
  // single-column behaviour the rest of the pipeline already handles.
  if (columns.length === 0) {
    return [
      {
        xStart: Math.min(...lines.map((l) => l.xStart)),
        xEnd: Math.max(...lines.map((l) => l.xEnd))
      }
    ]
  }
  return columns
}

/**
 * Which of the page's columns a given X position sits closest to — 0 distance if it falls
 * inside one outright, and on a tie the *narrowest* containing column wins.
 *
 * That tie-break matters on the first page of essentially every academic paper: the title,
 * authors and affiliation span the full page width above the two-column body, so the run of
 * lines before the first column seam mixes those full-width lines in with column 1's, and
 * detectColumnRanges (which takes each run's min/max extent) ends up reporting column 0 as
 * spanning the whole page. Column 1's much narrower range then sits entirely inside column
 * 0's, so anything genuinely in column 1 is contained by both — and picking the first
 * zero-distance match would file all of it under column 0, scrambling the reading order
 * (a right-column table would surface among the left column's opening paragraphs). The
 * narrower range is always the more specific, and therefore better, answer.
 */
function nearestColumnIndex(x: number, columns: ColumnRange[]): number {
  let best = 0
  let bestDist = Infinity
  let bestWidth = Infinity
  columns.forEach((c, i) => {
    const dist = x < c.xStart ? c.xStart - x : x > c.xEnd ? x - c.xEnd : 0
    const width = c.xEnd - c.xStart
    if (dist < bestDist || (dist === bestDist && width < bestWidth)) {
      bestDist = dist
      bestWidth = width
      best = i
    }
  })
  return best
}

/**
 * Extracted page dimensions (scale=1 / PDF points), returned alongside the blocks so
 * callers can size a rendered figure/table relative to the *page*, not just stretch it to
 * fill whatever width the translation pane happens to have.
 */
export interface PageLayout {
  blocks: PageBlock[]
  pageWidth: number
  pageHeight: number
}

/**
 * Builds the full reading-order block list for a page: figures and tables (each with
 * their own caption, and with internal labels/cell text stripped out of the surrounding
 * prose) interleaved with heading and paragraph blocks. Text-to-text order is left
 * exactly as pdf.js extracted it — that already matches visual reading order for ordinary
 * multi-column layouts — only figures/tables need to be *placed* among that text using
 * their vertical position, since they have no natural slot in the text stream.
 */
export async function extractPageLayout(doc: PdfDocument, pageNumber: number): Promise<PageLayout> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const pageWidth = viewport.width
  const pageHeight = viewport.height

  const [{ imageRects, ruleRects, barRects }, allItems] = await Promise.all([
    extractVisualRects(page, viewport),
    extractRawTextItems(page, viewport)
  ])

  // Cluster images together with short label-shaped text (captions/headings are excluded
  // from candidacy up front, see isLabelCandidate) — a cluster only counts as a figure
  // once it actually contains an image; a cluster of label-shaped text with no image
  // nearby just means ordinary short lines, and stays untouched. With no images at all,
  // this is simply an empty cluster list — the rest of the pipeline (caption/table
  // detection) still runs, since a page can have tables with no figures on it.
  //
  // Label candidacy is judged per *line*, not per raw text item — pdf.js can split one
  // baseline into several item runs (a font change, a trailing initial that just barely
  // wrapped onto the same line as the sentence before it), and judging candidacy per item
  // would let a short trailing fragment of an ordinary long sentence pass as "short
  // standalone label text" merely because it happened to arrive as its own item. A genuine
  // figure-internal label (e.g. "PVD", "Apple Black Rot") really is short as a *whole
  // line*; that isn't true of an arbitrary item plucked out of one.
  const allLines = groupIntoLinesDetailed(allItems)
  const clusterMembers: ClusterMember[] = [
    ...imageRects.map((rect): ClusterMember => ({ rect, kind: 'image' })),
    ...allLines
      .filter((line) => isLabelCandidate(line.text))
      .map((line): ClusterMember => ({
        rect: line.items.map(itemRect).reduce((a, b) => unionRect(a, b)),
        kind: 'label',
        items: line.items
      }))
  ]
  const clusters =
    imageRects.length > 0
      ? clusterWithMembership(clusterMembers, FIGURE_CLUSTER_MARGIN_X, FIGURE_CLUSTER_MARGIN_Y)
      : []
  const figureClusters = clusters.filter((c) => c.members.some((m) => m.kind === 'image'))

  const absorbedLabelItems = new Set<RawTextItem>()
  for (const c of figureClusters) {
    for (const m of c.members) {
      if (m.kind === 'label' && m.items) {
        for (const it of m.items) absorbedLabelItems.add(it)
      }
    }
  }

  // Text sitting inside a figure's region is a label/legend belonging to the figure, not
  // running prose — pull it out of the stream entirely before even grouping into lines.
  const remainingAfterFigures = allItems.filter((item) => !absorbedLabelItems.has(item))

  // Rotated text (a chart's angled axis labels, overwhelmingly) is pulled out before line
  // grouping even runs — it doesn't belong in ordinary prose lines regardless of whether a
  // chart cluster ultimately confirms it (ordinary running prose is essentially never set
  // at an angle). Anything left unclaimed once chart detection below has had its chance is
  // added back as a fallback paragraph near the end of extractPageLayout, so a stray
  // rotated item never just silently vanishes.
  const rotatedItems = remainingAfterFigures.filter(isRotatedText)
  const remainingItems = remainingAfterFigures.filter((item) => !isRotatedText(item))
  const linesDetailed = groupIntoLinesDetailed(remainingItems)
  const consumedLines = new Set<number>()

  // --- Figure captions: attach each to whichever figure cluster is vertically closest,
  // preferring one whose column (horizontal extent) actually overlaps the caption's —
  // without that check, a caption in one column of a two-column page can get attributed
  // to a figure sitting in the *other* column just because it happens to be closer in Y. ---
  const figures: FigureBlock[] = figureClusters.map((c) => ({
    type: 'figure',
    bbox: c.bbox,
    captionOriginal: ''
  }))
  linesDetailed.forEach((line, idx) => {
    if (!FIGURE_CAPTION_RE.test(line.text)) return
    if (!startsNewSentence(idx, linesDetailed)) return
    const withOverlap = figureClusters
      .map((_, ci) => ci)
      .filter((ci) =>
        xOverlaps(
          line.xStart,
          line.xEnd,
          figureClusters[ci].bbox.x,
          figureClusters[ci].bbox.x + figureClusters[ci].bbox.width,
          CAPTION_COLUMN_MARGIN
        )
      )
    const pool = withOverlap.length > 0 ? withOverlap : figureClusters.map((_, ci) => ci)
    let bestIdx = -1
    let bestDist = Infinity
    for (const ci of pool) {
      const dist = verticalDistanceToRect(line.y, figureClusters[ci].bbox)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = ci
      }
    }
    if (bestIdx !== -1 && bestDist <= FIGURE_CAPTION_MAX_DISTANCE) {
      const { text, consumedIdx } = collectCaptionContinuation(idx, linesDetailed, consumedLines)
      figures[bestIdx].captionOriginal = text
      consumedLines.add(idx)
      for (const ci of consumedIdx) consumedLines.add(ci)
    }
  })

  // --- Vector/SVG-style charts: cluster bars with nearby rotated labels (a pass kept
  // entirely separate from the raster-figure clustering above), then require a matching,
  // still-unclaimed "Figure N"/"Şekil N" caption before promoting the result into a real
  // FigureBlock — a stray rotated element or thick rect, on its own, is nowhere near enough
  // evidence of an actual chart, exactly as a lone ruled region isn't enough evidence of an
  // actual table below. ---
  const chartMembers: ClusterMember[] = [
    ...barRects.map((rect): ClusterMember => ({ rect, kind: 'bar' })),
    ...rotatedItems.map((item): ClusterMember => ({
      rect: itemRect(item),
      kind: 'label',
      items: [item]
    }))
  ]
  const chartCoreClusters =
    chartMembers.length > 0
      ? clusterWithMembership(chartMembers, CHART_CLUSTER_MARGIN_X, CHART_CLUSTER_MARGIN_Y).filter(
          (c) =>
            c.members.some((m) => m.kind === 'bar') && c.members.some((m) => m.kind === 'label')
        )
      : []
  const claimedChartClusters = new Set<number>()
  const claimedRotatedItems = new Set<RawTextItem>()

  const chartCaptionCandidates = linesDetailed
    .map((line, idx) => ({ line, idx }))
    .filter(
      ({ line, idx }) =>
        !consumedLines.has(idx) &&
        FIGURE_CAPTION_RE.test(line.text) &&
        startsNewSentence(idx, linesDetailed)
    )
    .sort((a, b) => a.line.y - b.line.y)

  for (const { line: capLine, idx: capIdx } of chartCaptionCandidates) {
    if (consumedLines.has(capIdx)) continue

    let bestCi = -1
    let bestDist = Infinity
    chartCoreClusters.forEach((cluster, ci) => {
      if (claimedChartClusters.has(ci)) return
      if (
        !xOverlaps(
          capLine.xStart,
          capLine.xEnd,
          cluster.bbox.x,
          cluster.bbox.x + cluster.bbox.width,
          CAPTION_COLUMN_MARGIN
        )
      )
        return
      const dist = verticalDistanceToRect(capLine.y, cluster.bbox)
      if (dist < bestDist) {
        bestDist = dist
        bestCi = ci
      }
    })
    if (bestCi === -1 || bestDist > FIGURE_CAPTION_MAX_DISTANCE) continue

    claimedChartClusters.add(bestCi)
    for (const m of chartCoreClusters[bestCi].members) {
      if (m.kind === 'label' && m.items) for (const it of m.items) claimedRotatedItems.add(it)
    }

    const { text: captionText, consumedIdx: captionContinuationIdx } = collectCaptionContinuation(
      capIdx,
      linesDetailed,
      consumedLines
    )
    consumedLines.add(capIdx)
    for (const ci of captionContinuationIdx) consumedLines.add(ci)

    const { bbox: chartBbox, absorbedIndices: chartAbsorbed } = absorbChartSurroundings(
      chartCoreClusters[bestCi].bbox,
      capIdx,
      linesDetailed,
      consumedLines,
      rotatedItems,
      claimedRotatedItems
    )
    for (const ai of chartAbsorbed) consumedLines.add(ai)

    figures.push({ type: 'figure', bbox: chartBbox, captionOriginal: captionText })
  }

  // --- Tables: cluster the page's ruled line-segments into contiguous regions (a real
  // table's borders sit close together; unrelated rules elsewhere on the page don't), then
  // match each unclaimed "Table N" caption to the nearest unclaimed region in the same
  // column. Unlike figures, a table is *required* to have a matching caption — a lone
  // ruled region with nothing captioning it is far more likely to be a stray divider than
  // an actual table, so it's left alone rather than kept as an uncaptioned block. ---
  const tableClusters =
    ruleRects.length > 0
      ? clusterWithMembership(
          ruleRects.map((rect): ClusterMember => ({ rect, kind: 'rule' })),
          TABLE_RULE_MARGIN_X,
          TABLE_RULE_MARGIN_Y
        ).filter((c) => c.members.length >= TABLE_RULE_MIN_MEMBERS)
      : []
  const claimedClusters = new Set<number>()

  const tableCaptionCandidates = linesDetailed
    .map((line, idx) => ({ line, idx }))
    .filter(
      ({ line, idx }) =>
        !consumedLines.has(idx) &&
        TABLE_CAPTION_RE.test(line.text) &&
        startsNewSentence(idx, linesDetailed)
    )
    .sort((a, b) => a.line.y - b.line.y)

  const tables: TableBlock[] = []
  for (const { line: capLine, idx: capIdx } of tableCaptionCandidates) {
    if (consumedLines.has(capIdx)) continue

    let bestCi = -1
    let bestDist = Infinity
    tableClusters.forEach((cluster, ci) => {
      if (claimedClusters.has(ci)) return
      if (
        !xOverlaps(
          capLine.xStart,
          capLine.xEnd,
          cluster.bbox.x,
          cluster.bbox.x + cluster.bbox.width,
          CAPTION_COLUMN_MARGIN
        )
      )
        return
      const dist = verticalDistanceToRect(capLine.y, cluster.bbox)
      if (dist < bestDist) {
        bestDist = dist
        bestCi = ci
      }
    })
    if (bestCi === -1 || bestDist > TABLE_CAPTION_MAX_DISTANCE) continue

    claimedClusters.add(bestCi)
    // Consume the caption (and any word-wrapped continuation of it) before extending/
    // absorbing the table's own region, so a continuation line sitting just past the
    // table's ruled edge is never mistaken for one more (wrapped) row of the table itself.
    const { text: captionText, consumedIdx: captionContinuationIdx } = collectCaptionContinuation(
      capIdx,
      linesDetailed,
      consumedLines
    )
    consumedLines.add(capIdx)
    for (const ci of captionContinuationIdx) consumedLines.add(ci)

    const { bbox: tableBbox, absorbedIndices: edgeAbsorbed } = extendTableBbox(
      tableClusters[bestCi].bbox,
      capIdx,
      linesDetailed,
      consumedLines
    )
    for (const ai of edgeAbsorbed) consumedLines.add(ai)
    for (const ai of absorbTableInterior(tableBbox, capIdx, linesDetailed, consumedLines)) {
      consumedLines.add(ai)
    }
    tables.push({ type: 'table', bbox: tableBbox, captionOriginal: captionText })
  }

  // Column ranges come from the *complete* line list, not from whatever text happened to
  // survive figure/table absorption — a column can open with exactly the row that got
  // absorbed into a table, so the surviving prose alone wouldn't show where it begins.
  const columnRanges = detectColumnRanges(linesDetailed, pageWidth)

  const proseLines = linesDetailed
    .filter((_, idx) => !consumedLines.has(idx))
    .map(({ text, fontSize, y, xStart, xEnd }) => ({ text, fontSize, y, xStart, xEnd }))

  const textBlocks = groupIntoBlocks(proseLines, columnRanges)

  // A rotated item that never ended up part of any confirmed chart (no bar cluster nearby,
  // or no matching Figure/Şekil caption within reach) still came from the actual PDF text —
  // rather than silently drop it, surface it as a small fallback block at the end of
  // whichever column it sits in. This is a rare path (ordinary prose is never rotated,
  // so an unclaimed rotated item usually means either a genuinely unusual page element or a
  // chart whose caption just wasn't found), so an imperfect position is an acceptable
  // trade-off against losing text outright.
  const leftoverRotatedItems = rotatedItems.filter((item) => !claimedRotatedItems.has(item))
  if (leftoverRotatedItems.length > 0) {
    const fallbackLines = groupIntoLinesDetailed(leftoverRotatedItems).map(
      ({ text, fontSize, y, xStart, xEnd }) => ({ text, fontSize, y, xStart, xEnd })
    )
    textBlocks.push(...groupIntoBlocks(fallbackLines, columnRanges))
  }

  // Interleave: figures/tables are inserted into the text-block sequence based on vertical
  // position, but *within the column being read* — a media block is only ever inserted
  // ahead of text that's actually in, or past, its own column, so a table sitting at the
  // very top of column 2 can never jump ahead of column-1 text that hasn't been read yet
  // just because its absolute page-Y happens to be smaller.
  const mediaSortedByY = [...figures, ...tables].sort((a, b) => a.bbox.y - b.bbox.y)

  const blocks: PageBlock[] = []
  if (columnRanges.length === 0) {
    // No text on the page at all — nothing to anchor columns to, so just emit media by Y.
    blocks.push(...mediaSortedByY)
  } else {
    const textByColumn: TextBlockEntry[][] = columnRanges.map(() => [])
    for (const entry of textBlocks) {
      textByColumn[nearestColumnIndex((entry.xStart + entry.xEnd) / 2, columnRanges)].push(entry)
    }
    const mediaByColumn: Array<Array<FigureBlock | TableBlock>> = columnRanges.map(() => [])
    for (const m of mediaSortedByY) {
      mediaByColumn[nearestColumnIndex(m.bbox.x + m.bbox.width / 2, columnRanges)].push(m)
    }

    for (let ci = 0; ci < columnRanges.length; ci++) {
      const colMedia = mediaByColumn[ci]
      let mediaCursor = 0
      for (const entry of textByColumn[ci]) {
        while (mediaCursor < colMedia.length && colMedia[mediaCursor].bbox.y < entry.y) {
          blocks.push(colMedia[mediaCursor])
          mediaCursor++
        }
        blocks.push(entry.block)
      }
      while (mediaCursor < colMedia.length) {
        blocks.push(colMedia[mediaCursor])
        mediaCursor++
      }
    }
  }

  return { blocks, pageWidth, pageHeight }
}
