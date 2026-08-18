// Minimal APA 7 style citation formatter for journal articles.
// Not a full APA engine — good enough for a personal knowledge base.

export interface ApaInput {
  authors: string // e.g. "Yılmaz, A., & Demir, B." or "Smith, J."
  year: string
  title: string
  journal: string
  volume: string
  issue: string
  pages: string
  doi: string
  url: string
}

export function formatApa(input: ApaInput): string {
  const parts: string[] = []

  const authors = input.authors?.trim()
  if (authors) parts.push(authors.endsWith('.') ? authors : `${authors}.`)

  const year = input.year?.trim()
  parts.push(year ? `(${year}).` : '(n.d.).')

  const title = input.title?.trim()
  if (title) parts.push(title.endsWith('.') ? title : `${title}.`)

  let journalPart = ''
  if (input.journal?.trim()) {
    journalPart = input.journal.trim()
    if (input.volume?.trim()) {
      journalPart += `, ${input.volume.trim()}`
      if (input.issue?.trim()) journalPart += `(${input.issue.trim()})`
    }
    if (input.pages?.trim()) journalPart += `, ${input.pages.trim()}`
    journalPart += '.'
    parts.push(journalPart)
  }

  if (input.doi?.trim()) {
    const doi = input.doi.trim()
    parts.push(doi.startsWith('http') ? doi : `https://doi.org/${doi}`)
  } else if (input.url?.trim()) {
    parts.push(input.url.trim())
  }

  return parts.join(' ')
}
