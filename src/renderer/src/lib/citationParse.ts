export interface RawCitationFields {
  title: string
  authors: string
  year: string
  journal: string
  volume: string
  issue: string
  pages: string
  doi: string
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value
      .map((v) => toDisplayString(v))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'object') return ''
  return String(value).trim()
}

/**
 * Local/small LLMs frequently ignore "respond with ONLY json" instructions and wrap their
 * answer in a markdown code fence (```json ... ```), add a leading sentence, or return array
 * values for fields we expect as plain strings (e.g. authors: ["A", "B"]). This tries a few
 * increasingly forgiving strategies to recover a usable object instead of failing outright.
 */
export function parseCitationJson(raw: string): RawCitationFields | null {
  const candidates: string[] = [raw]

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.unshift(fenced[1])

  const braceMatch = raw.match(/\{[\s\S]*\}/)
  if (braceMatch) candidates.push(braceMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim())
      if (parsed && typeof parsed === 'object') {
        return {
          title: toDisplayString(parsed.title),
          authors: toDisplayString(parsed.authors),
          year: toDisplayString(parsed.year),
          journal: toDisplayString(parsed.journal),
          volume: toDisplayString(parsed.volume),
          issue: toDisplayString(parsed.issue),
          pages: toDisplayString(parsed.pages),
          doi: toDisplayString(parsed.doi)
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null
}
