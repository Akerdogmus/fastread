export interface ArticleFormValues {
  title: string
  authors: string
  year: string
  journal: string
  volume: string
  issue: string
  pages: string
  doi: string
  url: string
}

const EMPTY: ArticleFormValues = {
  title: '',
  authors: '',
  year: '',
  journal: '',
  volume: '',
  issue: '',
  pages: '',
  doi: '',
  url: ''
}

export function emptyArticleForm(): ArticleFormValues {
  return { ...EMPTY }
}

// Authors are stored as a single free-text APA string, e.g.
// "Delgado, P., Vargas, C., & Ackerman, R." — split into per-author chips for
// editing (best-effort: pairs up "Surname" + "Initial." comma tokens), and
// re-joined the same way on save. Names that don't fit the pattern (a single
// token, a corporate author, …) are kept as their own chip unchanged.
export function parseAuthorsToChips(authors: string): string[] {
  const cleaned = authors
    .trim()
    .replace(/\s*&\s*/g, ', ')
    .replace(/\s+and\s+/gi, ', ')
  if (!cleaned) return []
  const tokens = cleaned
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const chips: string[] = []
  let i = 0
  while (i < tokens.length) {
    const surname = tokens[i]
    const initials = tokens[i + 1]
    if (initials && /^[A-ZÇĞİÖŞÜ]/.test(initials) && initials.length <= 12) {
      chips.push(`${surname}, ${initials}`)
      i += 2
    } else {
      chips.push(surname)
      i += 1
    }
  }
  return chips
}

export function serializeAuthorChips(chips: string[]): string {
  const trimmed = chips.map((c) => c.trim()).filter(Boolean)
  if (trimmed.length === 0) return ''
  if (trimmed.length === 1) return trimmed[0]
  return `${trimmed.slice(0, -1).join(', ')}, & ${trimmed[trimmed.length - 1]}`
}
