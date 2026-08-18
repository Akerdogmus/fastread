import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import initSqlJs, { type Database } from 'sql.js'
import { randomUUID } from 'crypto'
import type {
  Article,
  GraphData,
  GraphEdge,
  GraphNode,
  LinkRecord,
  NoteRecord,
  PageTranslation
} from '@shared/types'

let db: Database | null = null
let dbFilePath = ''

function nowIso(): string {
  return new Date().toISOString()
}

/** Resolve the on-disk .sqlite file inside Electron's per-user app data folder. */
function resolveDbPath(): string {
  const userData = app.getPath('userData')
  return join(userData, 'fastread.sqlite')
}

function persist(): void {
  if (!db) return
  const data = db.export()
  const dir = dirname(dbFilePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(dbFilePath, Buffer.from(data))
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  journal TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  pages TEXT NOT NULL DEFAULT '',
  doi TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  apaCitation TEXT NOT NULL DEFAULT '',
  filePath TEXT NOT NULL DEFAULT '',
  fileName TEXT NOT NULL DEFAULT '',
  pageCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  articleId TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  page INTEGER NOT NULL DEFAULT 1,
  originalText TEXT NOT NULL DEFAULT '',
  translatedText TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  fromNoteId TEXT NOT NULL,
  toNoteId TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS page_translations (
  id TEXT PRIMARY KEY,
  articleId TEXT NOT NULL,
  page INTEGER NOT NULL,
  originalText TEXT NOT NULL DEFAULT '',
  translatedText TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL,
  UNIQUE(articleId, page)
);
`

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()
  dbFilePath = resolveDbPath()
  if (existsSync(dbFilePath)) {
    const fileBuffer = readFileSync(dbFilePath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }
  db.run(SCHEMA)
  persist()
}

function requireDb(): Database {
  if (!db) throw new Error('Database not initialized yet')
  return db
}

function rowsToObjects<T>(stmtSql: string, params: unknown[] = []): T[] {
  const database = requireDb()
  const stmt = database.prepare(stmtSql)
  stmt.bind(params as never)
  const results: T[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T)
  }
  stmt.free()
  return results
}

// ---------- Articles ----------

export function listArticles(): Article[] {
  return rowsToObjects<Article>('SELECT * FROM articles ORDER BY createdAt DESC')
}

export function getArticle(id: string): Article | null {
  const rows = rowsToObjects<Article>('SELECT * FROM articles WHERE id = ?', [id])
  return rows[0] ?? null
}

export type NewArticleInput = Omit<Article, 'id' | 'createdAt' | 'updatedAt'>

export function createArticle(input: NewArticleInput): Article {
  const database = requireDb()
  const id = randomUUID()
  const ts = nowIso()
  database.run(
    `INSERT INTO articles
      (id, title, authors, year, journal, volume, issue, pages, doi, url, apaCitation, filePath, fileName, pageCount, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.authors,
      input.year,
      input.journal,
      input.volume,
      input.issue,
      input.pages,
      input.doi,
      input.url,
      input.apaCitation,
      input.filePath,
      input.fileName,
      input.pageCount,
      ts,
      ts
    ]
  )
  persist()
  return getArticle(id) as Article
}

export function updateArticle(id: string, patch: Partial<NewArticleInput>): Article | null {
  const existing = getArticle(id)
  if (!existing) return null
  const merged: Article = { ...existing, ...patch, updatedAt: nowIso() }
  const database = requireDb()
  database.run(
    `UPDATE articles SET title=?, authors=?, year=?, journal=?, volume=?, issue=?, pages=?, doi=?, url=?, apaCitation=?, filePath=?, fileName=?, pageCount=?, updatedAt=? WHERE id=?`,
    [
      merged.title,
      merged.authors,
      merged.year,
      merged.journal,
      merged.volume,
      merged.issue,
      merged.pages,
      merged.doi,
      merged.url,
      merged.apaCitation,
      merged.filePath,
      merged.fileName,
      merged.pageCount,
      merged.updatedAt,
      id
    ]
  )
  persist()
  return getArticle(id)
}

export function deleteArticle(id: string): void {
  const database = requireDb()
  database.run('DELETE FROM notes WHERE articleId = ?', [id])
  database.run('DELETE FROM page_translations WHERE articleId = ?', [id])
  database.run('DELETE FROM articles WHERE id = ?', [id])
  persist()
}

// ---------- Notes ----------

export function listNotesByArticle(articleId: string): NoteRecord[] {
  return rowsToObjects<NoteRecord>(
    'SELECT * FROM notes WHERE articleId = ? ORDER BY page ASC, createdAt ASC',
    [articleId]
  )
}

export function listAllNotes(): NoteRecord[] {
  return rowsToObjects<NoteRecord>('SELECT * FROM notes ORDER BY createdAt ASC')
}

function getNote(id: string): NoteRecord | null {
  const rows = rowsToObjects<NoteRecord>('SELECT * FROM notes WHERE id = ?', [id])
  return rows[0] ?? null
}

export type NewNoteInput = Omit<NoteRecord, 'id' | 'createdAt' | 'updatedAt'>

export function createNote(input: NewNoteInput): NoteRecord {
  const database = requireDb()
  const id = randomUUID()
  const ts = nowIso()
  database.run(
    `INSERT INTO notes (id, articleId, type, title, page, originalText, translatedText, content, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.articleId,
      input.type,
      input.title,
      input.page,
      input.originalText,
      input.translatedText,
      input.content,
      ts,
      ts
    ]
  )
  persist()
  syncWikiLinksForNote(id)
  return getNote(id) as NoteRecord
}

export function updateNote(id: string, patch: Partial<NewNoteInput>): NoteRecord | null {
  const existing = getNote(id)
  if (!existing) return null
  const merged: NoteRecord = { ...existing, ...patch, updatedAt: nowIso() }
  const database = requireDb()
  database.run(
    `UPDATE notes SET type=?, title=?, page=?, originalText=?, translatedText=?, content=?, updatedAt=? WHERE id=?`,
    [
      merged.type,
      merged.title,
      merged.page,
      merged.originalText,
      merged.translatedText,
      merged.content,
      merged.updatedAt,
      id
    ]
  )
  persist()
  syncWikiLinksForNote(id)
  return getNote(id)
}

export function deleteNote(id: string): void {
  const database = requireDb()
  database.run('DELETE FROM links WHERE fromNoteId = ? OR toNoteId = ?', [id, id])
  database.run('DELETE FROM notes WHERE id = ?', [id])
  persist()
}

// ---------- Links (Obsidian-style [[wiki-links]]) ----------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

/** Re-derive auto links for one note's content against other notes' titles. */
function syncWikiLinksForNote(noteId: string): void {
  const database = requireDb()
  const note = getNote(noteId)
  if (!note) return
  database.run("DELETE FROM links WHERE fromNoteId = ? AND label = '#wikilink'", [noteId])

  const targets = new Set<string>()
  let match: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(note.content)) !== null) {
    targets.add(match[1].trim().toLowerCase())
  }
  if (targets.size === 0) return

  const allNotes = listAllNotes()
  for (const target of targets) {
    const matchNote = allNotes.find((n) => n.title.trim().toLowerCase() === target)
    if (matchNote && matchNote.id !== noteId) {
      database.run(
        `INSERT INTO links (id, fromNoteId, toNoteId, label, createdAt) VALUES (?, ?, ?, '#wikilink', ?)`,
        [randomUUID(), noteId, matchNote.id, nowIso()]
      )
    }
  }
  persist()
}

/** Links exist only as derived data (see syncWikiLinksForNote), so this stays internal — the graph is the only consumer. */
function listLinks(): LinkRecord[] {
  return rowsToObjects<LinkRecord>('SELECT * FROM links')
}

// ---------- Page translations (cache so we don't re-call the LLM every time) ----------

export function getPageTranslation(articleId: string, page: number): PageTranslation | null {
  const rows = rowsToObjects<PageTranslation>(
    'SELECT * FROM page_translations WHERE articleId = ? AND page = ?',
    [articleId, page]
  )
  return rows[0] ?? null
}

export function savePageTranslation(
  articleId: string,
  page: number,
  originalText: string,
  translatedText: string,
  engine: string
): void {
  const database = requireDb()
  const existing = getPageTranslation(articleId, page)
  const ts = nowIso()
  if (existing) {
    database.run(
      'UPDATE page_translations SET originalText=?, translatedText=?, engine=?, updatedAt=? WHERE id=?',
      [originalText, translatedText, engine, ts, existing.id]
    )
  } else {
    database.run(
      `INSERT INTO page_translations (id, articleId, page, originalText, translatedText, engine, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), articleId, page, originalText, translatedText, engine, ts]
    )
  }
  persist()
}

// ---------- Graph ----------

export function getGraphData(): GraphData {
  const articles = listArticles()
  const notes = listAllNotes()
  const links = listLinks()

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (const a of articles) {
    nodes.push({ id: `article:${a.id}`, kind: 'article', label: a.title || a.fileName })
  }
  for (const n of notes) {
    nodes.push({
      id: `note:${n.id}`,
      kind: 'note',
      label: n.title || n.content.slice(0, 40) || '(untitled note)',
      articleId: n.articleId,
      page: n.page
    })
    // every note belongs-to its article
    edges.push({ source: `note:${n.id}`, target: `article:${n.articleId}`, label: 'belongs to' })
  }
  for (const l of links) {
    edges.push({ source: `note:${l.fromNoteId}`, target: `note:${l.toNoteId}`, label: l.label })
  }

  return { nodes, edges }
}
