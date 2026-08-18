import type { Rect } from './pageBlocks'

/**
 * Crops a figure's region out of an already-rendered PDF page canvas, returning a PNG
 * data URL. `scale` must match whatever scale (zoom × devicePixelRatio) the canvas was
 * rendered at — `bbox` itself is always expressed in scale=1 (PDF point) units, since
 * that's resolution/zoom-independent and safe to cache.
 */
export function cropFigureFromCanvas(
  source: HTMLCanvasElement,
  bbox: Rect,
  scale: number
): string | null {
  const sx = Math.max(0, Math.round(bbox.x * scale))
  const sy = Math.max(0, Math.round(bbox.y * scale))
  if (sx >= source.width || sy >= source.height) return null

  const sw = Math.min(Math.round(bbox.width * scale), source.width - sx)
  const sh = Math.min(Math.round(bbox.height * scale), source.height - sy)
  if (sw <= 0 || sh <= 0) return null

  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  return out.toDataURL('image/png')
}
