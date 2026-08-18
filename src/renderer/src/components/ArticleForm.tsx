import { useState } from 'react'
import { formatApa } from '@shared/apa'
import type { ArticleFormValues } from '../lib/articleForm'
import { parseAuthorsToChips, serializeAuthorChips } from '../lib/articleForm'

interface Props {
  initial: ArticleFormValues
  fileName?: string
  pageCount?: number
  sourceEngine?: string
  onCancel: () => void
  onConfirm: (values: ArticleFormValues, apaCitation: string) => void
  busy?: boolean
}

export default function ArticleForm({
  initial,
  fileName,
  pageCount,
  sourceEngine,
  onCancel,
  onConfirm,
  busy
}: Props): React.JSX.Element {
  const [values, setValues] = useState<ArticleFormValues>(initial)
  const [authorChips, setAuthorChips] = useState<string[]>(() =>
    parseAuthorsToChips(initial.authors)
  )
  const [newAuthor, setNewAuthor] = useState('')

  function set<K extends keyof ArticleFormValues>(key: K, v: string): void {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  function removeAuthor(index: number): void {
    setAuthorChips((prev) => prev.filter((_, i) => i !== index))
  }

  function commitNewAuthor(): void {
    const v = newAuthor.trim()
    if (v) setAuthorChips((prev) => [...prev, v])
    setNewAuthor('')
  }

  const authorsString = serializeAuthorChips(authorChips)
  const apaPreview = formatApa({ ...values, authors: authorsString })

  return (
    <div className="article-form">
      <div className="article-form__head">
        <div>
          <h3>Künyeyi onayla</h3>
          {fileName && (
            <p className="article-form__filename">
              {fileName}
              {pageCount ? ` · ${pageCount} sayfa` : ''}
            </p>
          )}
        </div>
        {sourceEngine && (
          <span className="tag tag-accent-2 article-form__engine-badge">
            <span className="tag-dot" style={{ background: '#728157' }} />
            {sourceEngine} ilk sayfadan doldurdu
          </span>
        )}
      </div>

      <div className="article-form__grid">
        <label className="article-form__span2">
          Başlık
          <input value={values.title} onChange={(e) => set('title', e.target.value)} />
        </label>

        {/* A plain div, not a <label> — the box holds several buttons plus an input, and a
            <label> wrapping more than one control triggers the browser's native
            label-click-forwarding behavior, which can activate the wrong button. */}
        <div className="article-form__span2 article-form__authors">
          <span className="article-form__authors-caption">Yazarlar</span>
          <div className="article-form__author-box">
            {authorChips.map((a, i) => (
              <span key={`${a}-${i}`} className="article-form__author-chip">
                {a}
                <button type="button" onClick={() => removeAuthor(i)} title="Kaldır">
                  ×
                </button>
              </span>
            ))}
            <input
              className="article-form__author-add"
              placeholder="+ yazar ekle"
              value={newAuthor}
              onChange={(e) => setNewAuthor(e.target.value)}
              onBlur={commitNewAuthor}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitNewAuthor()
                }
              }}
            />
          </div>
        </div>

        <label>
          Yıl
          <input value={values.year} onChange={(e) => set('year', e.target.value)} />
        </label>
        <label>
          DOI
          <input value={values.doi} onChange={(e) => set('doi', e.target.value)} />
        </label>

        <label className="article-form__span2">
          Dergi / kaynak
          <input value={values.journal} onChange={(e) => set('journal', e.target.value)} />
        </label>
        <label>
          Cilt (Volume)
          <input value={values.volume} onChange={(e) => set('volume', e.target.value)} />
        </label>
        <label>
          Sayı (Issue)
          <input value={values.issue} onChange={(e) => set('issue', e.target.value)} />
        </label>
        <label>
          Sayfa Aralığı
          <input value={values.pages} onChange={(e) => set('pages', e.target.value)} />
        </label>
        <label>
          URL
          <input value={values.url} onChange={(e) => set('url', e.target.value)} />
        </label>
      </div>

      <div className="article-form__preview">
        <div className="article-form__preview-label">APA 7 önizleme</div>
        <p className="pg">{apaPreview}</p>
      </div>

      <div className="article-form__actions">
        <span className="article-form__hint">Sonradan makale ayarlarından düzeltebilirsin.</span>
        <div className="article-form__buttons">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Vazgeç
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm({ ...values, authors: authorsString }, apaPreview)}
            disabled={busy}
          >
            {busy ? 'Kaydediliyor…' : 'Onayla ve okumaya başla'}
          </button>
        </div>
      </div>
    </div>
  )
}
