import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Article, NoteRecord } from '@shared/types'
import { loadPdf, renderPageToCanvas, type PdfDocument } from '../lib/pdf'
import { extractPageLayout } from '../lib/pdfLayout'
import { cropFigureFromCanvas } from '../lib/figureCrop'
import {
  blocksToPlainText,
  footnoteNeedsTranslation,
  isMediaBlock,
  serializeBlocks,
  tryParseBlocks,
  type FigureBlock,
  type PageBlock,
  type TableBlock
} from '../lib/pageBlocks'
import { injectHighlightMarks, renderMarkdown } from '../lib/markdown'
import { revealAppend } from '../lib/typewriter'
import { useAppShell } from '../lib/useAppShell'
import MarginNotes from '../components/MarginNotes'
import './ReaderPage.css'

const MIN_ZOOM = 0.6
const MAX_ZOOM = 3
const ZOOM_STEP = 0.2

// A figure/table is never blown up past the page's own content width, and never shrunk
// so small it's hard to make out — bounds the proportional sizing used in renderMediaBlock.
const MEDIA_MIN_WIDTH_PERCENT = 32
const MEDIA_MAX_WIDTH_PERCENT = 100

/** True for a heading like "4 BENCHMARKING PLANTDOC DATASET" — set in all caps by the paper's own typesetting, not by anything meaningful for translation. */
function isShoutyCase(text: string): boolean {
  const letters = text.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '')
  return letters.length >= 4 && text === text.toUpperCase()
}

/** Turkish-aware (dotted/dotless I) lowercase-then-capitalize, used only to make an all-caps heading readable to the translator — never shown on screen. */
function toSentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('tr')
  return lower.charAt(0).toLocaleUpperCase('tr') + lower.slice(1)
}

function BackIcon(): React.JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

function ChevronLeft(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

function ChevronRight(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function SparkleIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  )
}

function TranslateIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6h10M9 4v2c0 5-2.5 8-5 9M7 12c1.5 3 4 5 7 6" />
      <path d="M13.5 20l4-10 4 10M15 17h5" />
    </svg>
  )
}

function CommentIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 4H4v12h4v4l5-4h7z" />
    </svg>
  )
}

export default function ReaderPage(): React.JSX.Element {
  const { articleId } = useParams<{ articleId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setLastArticleId } = useAppShell()

  const [article, setArticle] = useState<Article | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1.3)
  const [pageBlocks, setPageBlocks] = useState<PageBlock[]>([])
  const [pageWidth, setPageWidth] = useState(0)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [figureImages, setFigureImages] = useState<Record<number, string>>({})
  // A page translated before this feature existed (or one the reader free-edited via
  // "Ham metin") has no figure/heading structure — it's rendered as one plain block,
  // exactly like before.
  const [legacyTranslatedText, setLegacyTranslatedText] = useState('')
  const [engine, setEngine] = useState('')
  const [translating, setTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [activeTranslateBlock, setActiveTranslateBlock] = useState<number | null>(null)
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [error, setError] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const [translationEditing, setTranslationEditing] = useState(false)
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)
  const [markerTops, setMarkerTops] = useState<Record<string, number>>({})

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const translationRef = useRef<HTMLDivElement>(null)
  const lastSelectionRef = useRef<string>('')
  const translateGenerationRef = useRef(0)
  const pageBlocksRef = useRef<PageBlock[]>([])
  // Mirrors `pageBlocks` for the canvas-render effect below to read without depending on
  // it reactively (see that effect's comment). useLayoutEffect (not a render-time
  // assignment) so it's committed before that effect runs, and before paint.
  useLayoutEffect(() => {
    pageBlocksRef.current = pageBlocks
  }, [pageBlocks])

  useEffect(() => {
    if (articleId) setLastArticleId(articleId)
  }, [articleId, setLastArticleId])

  // Bumping this on every page/article change invalidates any chunked translation
  // loop still running for the page the reader just left, so its late-arriving chunks
  // don't get typed into the (now different) page that's on screen.
  useEffect(() => {
    translateGenerationRef.current++
  }, [articleId, page])

  // ---------- Load article + PDF ----------
  useEffect(() => {
    if (!articleId) return
    let cancelled = false
    ;(async () => {
      const a = await window.api.articles.get(articleId)
      if (cancelled || !a) return
      setArticle(a)
      const bytes = await window.api.files.read(a.filePath)
      if (cancelled) return
      const doc = await loadPdf(bytes)
      setPdfDoc(doc)
    })()
    return () => {
      cancelled = true
    }
  }, [articleId])

  const refreshNotes = useCallback(async () => {
    if (!articleId) return
    setNotes(await window.api.notes.listByArticle(articleId))
  }, [articleId])

  useEffect(() => {
    refreshNotes()
  }, [refreshNotes])

  // ---------- Extract this page's structure (headings/paragraphs/figures) and overlay
  // any cached translation. Deliberately NOT dependent on zoom — re-parsing the page's
  // text/operator-list layout is comparatively expensive and has nothing to do with zoom. ----------
  useEffect(() => {
    if (!pdfDoc || !articleId) return
    let cancelled = false
    setTranslationEditing(false)
    setActiveMarkerId(null)
    ;(async () => {
      const { blocks, pageWidth: extractedPageWidth } = await extractPageLayout(pdfDoc, page)
      if (cancelled) return

      const cached = await window.api.pageTranslation.get(articleId, page)
      let finalBlocks = blocks
      let legacy = ''
      let cachedEngine = ''
      if (cached && cached.translatedText) {
        cachedEngine = cached.engine
        const parsed = tryParseBlocks(cached.translatedText)
        const structureMatches =
          parsed &&
          parsed.length === blocks.length &&
          parsed.every((p, i) => p.type === blocks[i].type)
        if (parsed && structureMatches) {
          finalBlocks = blocks.map((b, i) => {
            const p = parsed[i]
            if (isMediaBlock(b) && isMediaBlock(p)) {
              return { ...b, captionTranslated: p.captionTranslated || undefined }
            }
            if (!isMediaBlock(b) && !isMediaBlock(p)) {
              return { ...b, translated: p.translated || undefined }
            }
            return b
          })
        } else {
          // Older plain-text translation, or this page's extracted structure no longer
          // lines up with what was cached (e.g. after an app update) — fall back to
          // showing it as one plain block rather than mismatching translations to blocks.
          legacy = cached.translatedText
        }
      }
      if (cancelled) return
      setPageBlocks(finalBlocks)
      setPageWidth(extractedPageWidth)
      setLegacyTranslatedText(legacy)
      setEngine(cachedEngine)
      setLayoutVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, page, articleId])

  // ---------- Render this page's canvas at the current zoom, then crop each figure's
  // pixels straight out of it. Depends on layoutVersion (not pageBlocks directly) so that
  // typing a translation into pageBlocks — which happens dozens of times per section as
  // it streams in — doesn't repeatedly re-render/re-crop the page; only a genuinely new
  // page layout or a zoom change should do that. ----------
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    ;(async () => {
      if (canvasRef.current) {
        try {
          await renderPageToCanvas(pdfDoc, page, canvasRef.current, zoom)
        } catch (err) {
          // A rendering failure (e.g. a pdf.js/engine incompatibility) shouldn't block
          // text extraction and translation, which are the core of the app.
          console.error('Sayfa görüntüleme hatası:', err)
        }
      }
      if (cancelled) return
      const crops: Record<number, string> = {}
      if (canvasRef.current) {
        const dpr = window.devicePixelRatio || 1
        const scale = zoom * dpr
        for (let i = 0; i < pageBlocksRef.current.length; i++) {
          const b = pageBlocksRef.current[i]
          if (!isMediaBlock(b)) continue
          const dataUrl = cropFigureFromCanvas(canvasRef.current, b.bbox, scale)
          if (dataUrl) crops[i] = dataUrl
        }
      }
      if (!cancelled) setFigureImages(crops)
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, page, zoom, layoutVersion])

  // Jump to a note passed via ?note=<id>, once notes have loaded.
  useEffect(() => {
    const noteId = searchParams.get('note')
    if (!noteId || notes.length === 0) return
    const target = notes.find((n) => n.id === noteId)
    if (target && target.page !== page) {
      setPage(target.page)
    }
    setActiveMarkerId(noteId)
  }, [searchParams, notes, page])

  async function handleTranslate(): Promise<void> {
    if (!articleId || pageBlocks.length === 0) return
    const myGeneration = ++translateGenerationRef.current
    const stale = (): boolean => translateGenerationRef.current !== myGeneration

    // A footnote that's nothing but a URL/domain (see footnoteNeedsTranslation) is never
    // sent to the translator — there's no prose in it to translate, and running it through
    // the model just garbles the link. It still needs to be *shown*, though, so it isn't
    // included here but is seeded straight from its original text below instead.
    const translatableIndices = pageBlocks
      .map((_, i) => i)
      .filter((i) => {
        const b = pageBlocks[i]
        if (isMediaBlock(b)) return !!b.captionOriginal.trim()
        if (b.type === 'footnote' && !footnoteNeedsTranslation(b.original)) return false
        return !!b.original.trim()
      })

    const hasFootnoteText = pageBlocks.some((b) => b.type === 'footnote' && !!b.original.trim())
    if (translatableIndices.length === 0 && !hasFootnoteText) return

    setTranslating(true)
    setError('')
    setTranslateProgress(null)

    // Re-translating an already-translated page should visibly start from a blank page,
    // not leave every block showing its old translation until its own turn comes up
    // several seconds later — clear all of them up front. Also drop any stale legacy
    // (flat-text) rendering so the block view underneath is what's actually shown as the
    // fresh translation streams in.
    let working: PageBlock[] = pageBlocks.map((b) => {
      if (isMediaBlock(b)) return { ...b, captionTranslated: undefined }
      if (b.type === 'footnote' && !footnoteNeedsTranslation(b.original)) {
        // Skipped entirely by the loop below — show the original text right away, still
        // styled as a footnote, instead of leaving it blank forever.
        return { ...b, translated: b.original }
      }
      return { ...b, translated: undefined }
    })
    setPageBlocks(working)
    setLegacyTranslatedText('')
    let lastEngine = ''

    try {
      for (let idx = 0; idx < translatableIndices.length; idx++) {
        const i = translatableIndices[idx]
        const block = working[i]
        const rawSource = isMediaBlock(block) ? block.captionOriginal : block.original
        // Section headings are often set in ALL CAPS by the paper's own typesetting
        // (e.g. "4 BENCHMARKING PLANTDOC DATASET"); feeding that shouting-case run-on
        // straight to a small local model tends to produce garbled Turkish. We render
        // headings bold ourselves regardless of casing, so it's safe to normalize the
        // text sent for translation without losing anything visual.
        const sourceText =
          block.type === 'heading' && isShoutyCase(rawSource)
            ? toSentenceCase(rawSource)
            : rawSource
        const result = await window.api.llm.translate(sourceText)
        if (stale()) return
        lastEngine = result.engine

        if (!stale()) setActiveTranslateBlock(i)
        await revealAppend('', result.text, (partial) => {
          if (stale()) return
          working = working.map((b, bi) => {
            if (bi !== i) return b
            return isMediaBlock(b)
              ? { ...b, captionTranslated: partial }
              : { ...b, translated: partial }
          })
          setPageBlocks(working)
        })
        if (stale()) return

        setEngine(lastEngine)
        setTranslateProgress({ done: idx + 1, total: translatableIndices.length })
        await window.api.pageTranslation.save(
          articleId,
          page,
          blocksToPlainText(working, false),
          serializeBlocks(working),
          lastEngine
        )
      }
      // A page whose only "translation" work was seeding URL-only footnotes from their
      // original text (no block actually needed the LLM) never runs the loop above, so
      // that seeded state has to be persisted here instead or it wouldn't survive a reload.
      if (translatableIndices.length === 0 && !stale()) {
        await window.api.pageTranslation.save(
          articleId,
          page,
          blocksToPlainText(working, false),
          serializeBlocks(working),
          engine || 'manual'
        )
      }
    } catch (err) {
      if (!stale()) setError(`Çeviri başarısız: ${(err as Error).message}`)
    } finally {
      if (!stale()) {
        setTranslating(false)
        setTranslateProgress(null)
        setActiveTranslateBlock(null)
      }
    }
  }

  const translatedPlainText = legacyTranslatedText || blocksToPlainText(pageBlocks, true)
  const hasTranslationContent =
    legacyTranslatedText !== '' ||
    pageBlocks.some((b) => (isMediaBlock(b) ? !!b.captionTranslated : !!b.translated))

  async function handleTranslationEdit(value: string): Promise<void> {
    setLegacyTranslatedText(value)
    if (!articleId) return
    await window.api.pageTranslation.save(
      articleId,
      page,
      blocksToPlainText(pageBlocks, false),
      value,
      engine || 'manual'
    )
  }

  async function handleInterpret(): Promise<void> {
    if (!articleId || !translatedPlainText) return
    setInterpreting(true)
    setError('')
    try {
      const result = await window.api.llm.interpret(translatedPlainText)
      await window.api.notes.create({
        articleId,
        type: 'note',
        title: `Yorum - sayfa ${page}`,
        page,
        originalText: '',
        translatedText: '',
        content: result.text
      })
      await refreshNotes()
    } catch (err) {
      setError(`Yorumlama başarısız: ${(err as Error).message}`)
    } finally {
      setInterpreting(false)
    }
  }

  // ---------- Selecting text in the translation page auto-saves a highlight, then opens
  // its margin note card so a comment can be added right away (Word-review-style). ----------
  const handleSelectionUp = useCallback(async () => {
    if (!articleId) return
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!text || text.length < 3) return
    if (!translationRef.current || !sel || sel.rangeCount === 0) return
    const anchorNode = sel.anchorNode
    if (!anchorNode || !translationRef.current.contains(anchorNode)) return
    if (text === lastSelectionRef.current) return
    lastSelectionRef.current = text

    const created = await window.api.notes.create({
      articleId,
      type: 'highlight',
      title: text.slice(0, 60),
      page,
      originalText: '',
      translatedText: text,
      content: ''
    })
    await refreshNotes()
    setActiveMarkerId(created.id)
  }, [articleId, page, refreshNotes])

  // Clicking an already-highlighted (marked) span in the page reopens its margin card.
  function handlePageClick(e: React.MouseEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement
    const mark = target.closest('mark.note-mark')
    const noteId = mark?.getAttribute('data-note-id')
    if (noteId) setActiveMarkerId(noteId)
  }

  async function handleAddFreeform(): Promise<void> {
    if (!articleId) return
    const created = await window.api.notes.create({
      articleId,
      type: 'note',
      title: '',
      page,
      originalText: '',
      translatedText: '',
      content: ''
    })
    await refreshNotes()
    setActiveMarkerId(created.id)
  }

  async function handleSaveNoteContent(id: string, content: string): Promise<void> {
    await window.api.notes.update(id, { content })
    await refreshNotes()
  }

  async function handleSaveNoteTitle(id: string, title: string): Promise<void> {
    await window.api.notes.update(id, { title })
    await refreshNotes()
  }

  async function handleDeleteNote(id: string): Promise<void> {
    await window.api.notes.delete(id)
    if (activeMarkerId === id) setActiveMarkerId(null)
    await refreshNotes()
  }

  async function handleWikiLinkClick(title: string): Promise<void> {
    const all = await window.api.notes.listAll()
    const target = all.find((n) => n.title.trim().toLowerCase() === title.trim().toLowerCase())
    if (!target) {
      alert(`"${title}" başlıklı bir not bulunamadı.`)
      return
    }
    if (target.articleId === articleId) {
      setPage(target.page)
      setActiveMarkerId(target.id)
    } else {
      navigate(`/reader/${target.articleId}?note=${target.id}`)
    }
  }

  const pageNotes = useMemo(() => notes.filter((n) => n.page === page), [notes, page])

  const highlightNotes = useMemo(
    () => pageNotes.filter((n) => n.type === 'highlight' && n.translatedText),
    [pageNotes]
  )
  const highlightExcerpts = useMemo(
    () => highlightNotes.map((n) => ({ id: n.id, excerpt: n.translatedText })),
    [highlightNotes]
  )

  const legacyRenderedHtml = useMemo(() => {
    if (!legacyTranslatedText) return ''
    const html = renderMarkdown(injectHighlightMarks(legacyTranslatedText, highlightExcerpts))
    return translating ? `${html}<span class="typing-cursor">▌</span>` : html
  }, [legacyTranslatedText, highlightExcerpts, translating])

  // Position small floating markers next to each saved highlight's <mark> in the
  // rendered translation, so a note's anchor in the text stays visible even while the
  // comment strip lists it out of position order.
  useLayoutEffect(() => {
    const container = translationRef.current
    if (!container || translationEditing) {
      setMarkerTops({})
      return
    }
    const compute = (): void => {
      const next: Record<string, number> = {}
      const containerRect = container.getBoundingClientRect()
      for (const n of highlightNotes) {
        const el = container.querySelector(`mark[data-note-id="${n.id}"]`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        next[n.id] = rect.top - containerRect.top + container.scrollTop
      }
      setMarkerTops(next)
    }
    const raf = requestAnimationFrame(compute)
    const observer = new ResizeObserver(compute)
    observer.observe(container)
    container.addEventListener('scroll', compute)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      container.removeEventListener('scroll', compute)
    }
  }, [highlightNotes, pageBlocks, legacyRenderedHtml, translationEditing])

  function renderMediaBlock(block: FigureBlock | TableBlock, index: number): React.JSX.Element {
    const caption = block.captionTranslated
    const aspect = block.bbox.height > 0 ? block.bbox.width / block.bbox.height : 1.6
    // Size the crop relative to how wide it actually is on the original page, instead of
    // always stretching it to fill the translation pane — otherwise a figure that's a
    // small inset in the source PDF ends up looking blown up next to the original.
    const widthPercent = pageWidth > 0 ? (block.bbox.width / pageWidth) * 100 : 100
    const clampedWidthPercent = Math.min(
      MEDIA_MAX_WIDTH_PERCENT,
      Math.max(MEDIA_MIN_WIDTH_PERCENT, widthPercent)
    )
    const altFallback = block.type === 'table' ? 'Tablo' : 'Şekil'
    return (
      <figure key={index} className="page-surface__figure">
        <div
          className="page-surface__figure-frame"
          style={{ aspectRatio: aspect, width: `${clampedWidthPercent}%` }}
        >
          {figureImages[index] ? (
            <img src={figureImages[index]} alt={caption || block.captionOriginal || altFallback} />
          ) : (
            <div className="page-surface__figure-placeholder" />
          )}
        </div>
        {(caption || block.captionOriginal) && (
          <figcaption
            className={`page-surface__figure-caption${caption ? '' : ' page-surface__figure-caption--pending'}`}
          >
            {caption || block.captionOriginal}
          </figcaption>
        )}
      </figure>
    )
  }

  function renderBlock(block: PageBlock, index: number): React.JSX.Element | null {
    if (isMediaBlock(block)) return renderMediaBlock(block, index)

    const showCursor = translating && activeTranslateBlock === index

    if (block.type === 'heading') {
      if (!block.translated) return null
      return (
        <h3 key={index} className="page-surface__heading">
          {block.translated}
          {showCursor && <span className="typing-cursor">▌</span>}
        </h3>
      )
    }

    if (!block.translated) return null
    const html = renderMarkdown(injectHighlightMarks(block.translated, highlightExcerpts))
    const finalHtml = showCursor ? `${html}<span class="typing-cursor">▌</span>` : html

    // A footnote is rendered visually distinct from body paragraphs (smaller, muted, set
    // off by a rule) whether or not it actually went through translation — a URL-only
    // footnote is seeded straight from its original text (see handleTranslate) and still
    // needs to read as a footnote, not get lost looking like an ordinary sentence.
    if (block.type === 'footnote') {
      return (
        <div
          key={index}
          className="page-surface__footnote pg"
          dangerouslySetInnerHTML={{ __html: finalHtml }}
        />
      )
    }

    return (
      <div
        key={index}
        className="page-surface__content pg"
        dangerouslySetInnerHTML={{ __html: finalHtml }}
      />
    )
  }

  const zoomPercent = Math.round(zoom * 100)

  if (!article) return <div className="reader-page__loading">Yükleniyor…</div>

  return (
    <div className="reader-page">
      {error && <div className="reader-page__error">{error}</div>}

      <div className="reader-toolbar">
        <button className="reader-toolbar__back" onClick={() => navigate('/')} title="Kütüphane">
          <BackIcon />
        </button>
        <div className="reader-toolbar__title">
          <div className="reader-toolbar__title-text">{article.title || article.fileName}</div>
          <div className="reader-toolbar__subtitle">
            {article.authors}
            {article.year ? ` · ${article.year}` : ''}
          </div>
        </div>

        <div className="reader-toolbar__group">
          <div className="pager-pill">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft />
            </button>
            <span>
              {page} / {pdfDoc?.numPages ?? '…'}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pdfDoc?.numPages ?? p, p + 1))}
              disabled={!pdfDoc || page >= pdfDoc.numPages}
            >
              <ChevronRight />
            </button>
          </div>

          <div className="pager-pill">
            <button
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= MIN_ZOOM}
            >
              −
            </button>
            <span>{zoomPercent}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= MAX_ZOOM}
            >
              +
            </button>
          </div>

          <button
            className="btn btn-ghost reader-toolbar__ai"
            onClick={handleInterpret}
            disabled={interpreting || !translatedPlainText}
          >
            <SparkleIcon />
            {interpreting ? 'Yorumlanıyor…' : 'Sayfayı yorumla'}
          </button>

          {engine && (
            <span className={`tag ${engine === 'lmstudio' ? 'tag-accent-2' : 'tag-accent'}`}>
              <span
                className="tag-dot"
                style={{ background: engine === 'lmstudio' ? '#aebf92' : '#f6a06b' }}
              />
              {engine}
            </span>
          )}

          <button
            className={`btn ${hasTranslationContent ? '' : 'btn-primary'} reader-toolbar__translate`}
            onClick={handleTranslate}
            disabled={translating || pageBlocks.length === 0}
          >
            <TranslateIcon />
            {translating
              ? translateProgress
                ? `Çevriliyor… (${translateProgress.done}/${translateProgress.total})`
                : 'Çevriliyor…'
              : hasTranslationContent
                ? 'Yeniden çevir'
                : 'Sayfayı Çevir'}
          </button>
        </div>
      </div>

      <div className="reader-body">
        <div className="reader-pages">
          <div className="page-surface page-surface--pdf-wrap">
            <div className="page-surface__header">
              <span className="page-surface__label">Orijinal</span>
              <span className="page-surface__rule" />
              <span className="page-surface__page-no">s. {page}</span>
            </div>
            <div className="pdf-scroll-area">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="page-surface page-surface--translation">
            <div className="page-surface__header">
              <span className="page-surface__label">Türkçe</span>
              {engine && !translationEditing && (
                <span className="page-surface__engine-badge">
                  <span
                    className="tag-dot"
                    style={{ background: engine === 'lmstudio' ? '#728157' : '#b2622d' }}
                  />
                  {engine}
                </span>
              )}
              <span className="page-surface__rule" />
              {hasTranslationContent && (
                <button
                  className="page-surface__raw-toggle"
                  onClick={() => setTranslationEditing((v) => !v)}
                >
                  {translationEditing ? 'Sayfa görünümü' : 'Ham metin'}
                </button>
              )}
            </div>

            {translationEditing ? (
              <textarea
                autoFocus
                className="page-surface__edit"
                value={translatedPlainText}
                placeholder="Bu sayfa henüz çevrilmedi. 'Sayfayı Çevir' butonuna basın ya da buraya kendin yaz."
                onChange={(e) => handleTranslationEdit(e.target.value)}
              />
            ) : (
              <div
                className="page-surface__body"
                ref={translationRef}
                onMouseUp={handleSelectionUp}
                onClick={handlePageClick}
              >
                {hasTranslationContent ? (
                  <>
                    {legacyTranslatedText ? (
                      <div
                        className="page-surface__content pg"
                        dangerouslySetInnerHTML={{ __html: legacyRenderedHtml }}
                      />
                    ) : (
                      pageBlocks.map((b, i) => renderBlock(b, i))
                    )}
                    {highlightNotes.map((n) =>
                      markerTops[n.id] !== undefined ? (
                        <button
                          key={n.id}
                          className={`margin-marker-dot${activeMarkerId === n.id ? ' margin-marker-dot--active' : ''}`}
                          style={{ top: markerTops[n.id] }}
                          onClick={() => setActiveMarkerId(n.id)}
                          title="Notu aç"
                        >
                          <CommentIcon />
                        </button>
                      ) : null
                    )}
                  </>
                ) : (
                  <div className="page-surface__placeholder">
                    <div className="page-surface__placeholder-icon">
                      <TranslateIcon />
                    </div>
                    <div className="page-surface__placeholder-title">Bu sayfa henüz çevrilmedi</div>
                    <p>Çeviri bilgisayarındaki LM Studio ile yapılır; sayfa metni dışarı çıkmaz.</p>
                    <button className="btn btn-primary" onClick={handleTranslate}>
                      <TranslateIcon />
                      Sayfayı Çevir
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <MarginNotes
          notes={pageNotes}
          activeId={activeMarkerId}
          onSetActive={setActiveMarkerId}
          onSaveContent={handleSaveNoteContent}
          onSaveTitle={handleSaveNoteTitle}
          onDelete={handleDeleteNote}
          onAddFreeform={handleAddFreeform}
          onWikiLinkClick={handleWikiLinkClick}
        />
      </div>
    </div>
  )
}
