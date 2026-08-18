import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Article } from '@shared/types'
import { extractPageText, loadPdf } from '../lib/pdf'
import ArticleForm from '../components/ArticleForm'
import { emptyArticleForm, type ArticleFormValues } from '../lib/articleForm'
import { parseCitationJson } from '../lib/citationParse'
import './LibraryPage.css'

interface PendingImport {
  filePath: string
  fileName: string
  data: Uint8Array
  pageCount: number
  initialValues: ArticleFormValues
  sourceEngine: string
}

type FilterKey = 'all' | 'withNotes' | 'noNotes'

function PlusIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13h6l1-13" />
    </svg>
  )
}

export default function LibraryPage(): React.JSX.Element {
  const [articles, setArticles] = useState<Article[]>([])
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const navigate = useNavigate()

  async function refresh(): Promise<void> {
    const [list, allNotes] = await Promise.all([
      window.api.articles.list(),
      window.api.notes.listAll()
    ])
    setArticles(list)
    const counts: Record<string, number> = {}
    for (const n of allNotes) counts[n.articleId] = (counts[n.articleId] ?? 0) + 1
    setNoteCounts(counts)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleAddPdf(): Promise<void> {
    setError('')
    const picked = await window.api.dialogs.openPdf()
    if (!picked) return
    setImporting(true)
    try {
      const doc = await loadPdf(picked.data)
      const firstPageText = await extractPageText(doc, 1)

      const initialValues = emptyArticleForm()
      initialValues.title = picked.fileName.replace(/\.pdf$/i, '')
      let sourceEngine = ''

      try {
        const result = await window.api.llm.extractCitation(firstPageText)
        const parsed = parseCitationJson(result.text)
        if (parsed) {
          Object.assign(initialValues, {
            title: parsed.title || initialValues.title,
            authors: parsed.authors,
            year: parsed.year,
            journal: parsed.journal,
            volume: parsed.volume,
            issue: parsed.issue,
            pages: parsed.pages,
            doi: parsed.doi
          })
          sourceEngine = result.engine
        } else {
          console.warn('Künye JSON olarak ayrıştırılamadı, ham yanıt:', result.text)
        }
      } catch (err) {
        // LLM citation extraction is best-effort; user can fill the form manually.
        console.warn('Künye otomatik çıkarılamadı, manuel doldurulacak:', err)
      }

      setPending({
        filePath: picked.filePath,
        fileName: picked.fileName,
        data: picked.data,
        pageCount: doc.numPages,
        initialValues,
        sourceEngine
      })
    } catch (err) {
      setError(`PDF açılamadı: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleConfirm(values: ArticleFormValues, apaCitation: string): Promise<void> {
    if (!pending) return
    setSaving(true)
    try {
      const article = await window.api.articles.create({
        ...values,
        apaCitation,
        filePath: pending.filePath,
        fileName: pending.fileName,
        pageCount: pending.pageCount
      })
      setPending(null)
      await refresh()
      navigate(`/reader/${article.id}`)
    } catch (err) {
      setError(`Kaydedilemedi: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Bu makaleyi ve tüm notlarını silmek istediğine emin misin?')) return
    await window.api.articles.delete(id)
    await refresh()
  }

  const withNotesCount = articles.filter((a) => (noteCounts[a.id] ?? 0) > 0).length
  const noNotesCount = articles.length - withNotesCount

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return articles.filter((a) => {
      if (filter === 'withNotes' && !(noteCounts[a.id] ?? 0)) return false
      if (filter === 'noNotes' && (noteCounts[a.id] ?? 0)) return false
      if (!q) return true
      return (
        a.title.toLowerCase().includes(q) ||
        a.authors.toLowerCase().includes(q) ||
        a.fileName.toLowerCase().includes(q)
      )
    })
  }, [articles, noteCounts, filter, search])

  const totalNotes = Object.values(noteCounts).reduce((sum, n) => sum + n, 0)

  return (
    <div className="library-page">
      <header className="library-page__header">
        <div>
          <h1>Kütüphane</h1>
          <p className="library-page__subtitle">
            {articles.length > 0
              ? `${articles.length} makale · ${totalNotes} not`
              : 'Henüz makale yok'}
          </p>
        </div>
        <div className="library-page__actions">
          <div className="library-page__search">
            <SearchIcon />
            <input
              placeholder="Başlık, yazar veya dosya ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={handleAddPdf} disabled={importing}>
            <PlusIcon />
            {importing ? 'PDF işleniyor…' : 'PDF Ekle'}
          </button>
        </div>
      </header>

      {error && <div className="library-page__error">{error}</div>}

      {articles.length > 0 && (
        <div className="library-page__filters">
          <button
            className={`tag tag-accent${filter !== 'all' ? ' tag--inactive' : ''}`}
            onClick={() => setFilter('all')}
          >
            Tümü · {articles.length}
          </button>
          <button
            className={`tag tag-neutral${filter !== 'withNotes' ? ' tag--inactive' : ''}`}
            onClick={() => setFilter('withNotes')}
          >
            Notlu · {withNotesCount}
          </button>
          <button
            className={`tag tag-neutral${filter !== 'noNotes' ? ' tag--inactive' : ''}`}
            onClick={() => setFilter('noNotes')}
          >
            Not yok · {noNotesCount}
          </button>
        </div>
      )}

      {pending && (
        <div className="modal-backdrop">
          <div className="modal">
            <ArticleForm
              initial={pending.initialValues}
              fileName={pending.fileName}
              pageCount={pending.pageCount}
              sourceEngine={pending.sourceEngine}
              onCancel={() => setPending(null)}
              onConfirm={handleConfirm}
              busy={saving}
            />
          </div>
        </div>
      )}

      {articles.length === 0 ? (
        <div className="library-page__empty-state">
          <div className="library-page__empty-icon">
            <BookOutlineIcon />
          </div>
          <h2>Kütüphane henüz boş</h2>
          <p>
            İlk PDF&apos;ini ekle. Künyesini ilk sayfadan çıkarır, onayına sunar ve seni doğrudan
            çift sayfalı okuyucuya götürürüz.
          </p>
          <button className="btn btn-primary" onClick={handleAddPdf} disabled={importing}>
            <PlusIcon />
            {importing ? 'PDF işleniyor…' : "İlk PDF'ini ekle"}
          </button>
        </div>
      ) : (
        <div className="library-page__grid">
          {visible.map((a) => (
            <div key={a.id} className="article-card" onClick={() => navigate(`/reader/${a.id}`)}>
              <button
                className="article-card__delete"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(a.id)
                }}
                title="Sil"
              >
                <TrashIcon />
              </button>
              <div className="article-card__top">
                <span className="tag tag-outline" title={a.journal || 'Makale'}>
                  {a.journal || 'Makale'}
                </span>
                {a.year && <span className="article-card__year">{a.year}</span>}
              </div>
              <h3>{a.title || a.fileName}</h3>
              <p className="article-card__meta">{a.authors}</p>
              {a.apaCitation && <p className="pg article-card__apa">{a.apaCitation}</p>}
              <div className="article-card__bottom">
                <span className="article-card__pages">{a.pageCount} sayfa</span>
                <span
                  className={`tag ${(noteCounts[a.id] ?? 0) > 0 ? 'tag-accent-2' : 'tag-neutral'}`}
                >
                  {noteCounts[a.id] ? `${noteCounts[a.id]} not` : 'not yok'}
                </span>
              </div>
            </div>
          ))}
          <button className="article-card article-card--add" onClick={handleAddPdf}>
            <span className="article-card__add-icon">
              <PlusIcon />
            </span>
            <div className="article-card__add-title">PDF ekle</div>
            <div className="article-card__add-hint">
              Künye bilgisini ilk sayfadan çıkarıp onayına sunarız.
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

function BookOutlineIcon(): React.JSX.Element {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M8 8h8M8 12h5" />
    </svg>
  )
}
