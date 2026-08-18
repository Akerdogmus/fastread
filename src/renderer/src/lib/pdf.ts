// Use the "legacy" build: the default pdfjs-dist build relies on very recent
// JS engine features (e.g. Map.prototype.getOrInsertComputed) that are newer
// than the Chromium/V8 version bundled with current Electron releases, which
// makes PDFPageProxy.render() throw ("... is not a function") even though
// document loading itself succeeds. The legacy build avoids that.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export type PdfDocument = pdfjsLib.PDFDocumentProxy

export async function loadPdf(data: Uint8Array): Promise<PdfDocument> {
  // pdf.js can detach/neuter the buffer it's given; pass a copy so callers
  // that still hold a reference to `data` elsewhere are unaffected.
  const copy = new Uint8Array(data)
  const task = pdfjsLib.getDocument({ data: copy })
  return task.promise
}

/** Extract plain text for a single (1-indexed) page. */
export async function extractPageText(doc: PdfDocument, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  const strings = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
  return strings.replace(/\s+/g, ' ').trim()
}

// pdf.js refuses a second render() on a canvas that still has one in flight
// ("Cannot use the same canvas during multiple render() operations"), and if that
// happens anyway (e.g. two effects both asking to render the same page in quick
// succession) the two tasks can stomp on the same canvas/context mid-draw and leave
// it visibly corrupted (observed: the page rendering upside down). Tracking the
// in-flight task per canvas and cancelling it before starting a new one avoids both.
const activeRenderTasks = new WeakMap<HTMLCanvasElement, pdfjsLib.RenderTask>()

/**
 * Render a single page onto a canvas element at the given (logical, CSS-pixel) scale.
 *
 * The canvas's pixel buffer is rendered at `scale * devicePixelRatio` and then displayed
 * at `scale` CSS pixels via canvas.style.width/height. Without this, the buffer is
 * rendered 1:1 with CSS pixels and the browser has to upscale it on any display with
 * devicePixelRatio > 1 (most Windows displays with 125%/150% scaling, and any HiDPI
 * screen), which is what makes the page look blurry/soft.
 */
export async function renderPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.3
): Promise<void> {
  const previous = activeRenderTasks.get(canvas)
  if (previous) previous.cancel()

  const page = await doc.getPage(pageNumber)
  const dpr = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: scale * dpr })
  const context = canvas.getContext('2d')
  if (!context) return
  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.style.width = `${viewport.width / dpr}px`
  canvas.style.height = `${viewport.height / dpr}px`

  const task = page.render({ canvasContext: context, viewport, canvas })
  activeRenderTasks.set(canvas, task)
  try {
    await task.promise
  } catch (err) {
    // A render we cancelled ourselves (to make way for a newer one) rejects with
    // this — expected, not a real failure, so don't let it bubble up as one.
    if (!(err instanceof Error) || err.name !== 'RenderingCancelledException') throw err
  } finally {
    if (activeRenderTasks.get(canvas) === task) activeRenderTasks.delete(canvas)
  }
}
