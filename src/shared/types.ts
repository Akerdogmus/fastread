// Shared types between main and renderer processes.

export interface Article {
  id: string
  title: string
  authors: string // "Soyad, A. & Soyad2, B." free text, comma/ampersand separated
  year: string
  journal: string
  volume: string
  issue: string
  pages: string
  doi: string
  url: string
  apaCitation: string
  filePath: string // absolute path to the source PDF on disk
  fileName: string
  pageCount: number
  createdAt: string
  updatedAt: string
}

type NoteType = 'highlight' | 'note'

export interface NoteRecord {
  id: string
  articleId: string
  type: NoteType
  title: string // short label used for [[wiki-link]] matching, like an Obsidian note title
  page: number
  originalText: string // the source-language excerpt (for highlights)
  translatedText: string // translated/edited text shown in the right pane
  content: string // free-form note/comment written by the user (may contain [[wiki-links]])
  createdAt: string
  updatedAt: string
}

export interface LinkRecord {
  id: string
  fromNoteId: string
  toNoteId: string
  label: string
  createdAt: string
}

export interface PageTranslation {
  id: string
  articleId: string
  page: number
  originalText: string
  translatedText: string
  engine: string // 'lmstudio' | 'gemini' | 'manual'
  updatedAt: string
}

export type EngineName = 'lmstudio' | 'gemini'

export interface AppSettings {
  lmStudioBaseUrl: string
  lmStudioModel: string
  geminiApiKey: string
  geminiModel: string
  enginePriority: EngineName[] // order to try, e.g. ['lmstudio', 'gemini']
  targetLanguage: string // default 'Turkish'
}

export interface GraphNode {
  id: string
  kind: 'article' | 'note'
  label: string
  articleId?: string
  page?: number
}

export interface GraphEdge {
  source: string
  target: string
  label?: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
