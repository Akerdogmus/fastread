/**
 * Progressively "types" `chunkText` onto the end of `prior` (separated by a blank line,
 * so the markdown renderer treats it as its own paragraph), calling `onUpdate` with the
 * growing string a few characters at a time. Resolves with the final, fully-appended
 * string once the reveal finishes.
 *
 * The step size scales with chunk length so the reveal always takes roughly the same
 * ~500ms regardless of whether the chunk is a short sentence or a long paragraph —
 * enough to read as a deliberate "typing" effect without making the reader wait on it.
 */
export function revealAppend(
  prior: string,
  chunkText: string,
  onUpdate: (next: string) => void
): Promise<string> {
  const base = prior ? `${prior}\n\n` : ''
  const full = base + chunkText

  if (!chunkText) {
    onUpdate(full)
    return Promise.resolve(full)
  }

  return new Promise((resolve) => {
    const TICK_MS = 16
    const TARGET_TICKS = 35
    const step = Math.max(2, Math.ceil(chunkText.length / TARGET_TICKS))
    let shown = 0

    const tick = (): void => {
      shown = Math.min(chunkText.length, shown + step)
      onUpdate(base + chunkText.slice(0, shown))
      if (shown < chunkText.length) {
        setTimeout(tick, TICK_MS)
      } else {
        resolve(full)
      }
    }
    tick()
  })
}
