import { useEffect, useRef } from 'react'
import type { NoteRecord } from '@shared/types'
import WikiText from './WikiText'
import { formatRelativeTime } from '../lib/relativeTime'
import './MarginNotes.css'

interface Props {
  notes: NoteRecord[]
  activeId: string | null
  onSetActive: (id: string | null) => void
  onSaveContent: (id: string, content: string) => void
  onSaveTitle: (id: string, title: string) => void
  onDelete: (id: string) => void
  onAddFreeform: () => void
  onWikiLinkClick: (title: string) => void
}

function CommentIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 4H4v12h4v4l5-4h7z" />
    </svg>
  )
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
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

/**
 * The right-hand comment strip, in the spirit of Word's review comments: a persistent,
 * narrow column of small note cards next to the page rather than a modal or a permanently
 * tall block. Each card is either a saved highlight quote + comment, or a freeform note.
 */
export default function MarginNotes({
  notes,
  activeId,
  onSetActive,
  onSaveContent,
  onSaveTitle,
  onDelete,
  onAddFreeform,
  onWikiLinkClick
}: Props): React.JSX.Element {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (activeId && cardRefs.current[activeId]) {
      cardRefs.current[activeId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeId])

  const sorted = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="comment-strip">
      <div className="comment-strip__head">
        <span className="comment-strip__title">Yorumlar</span>
        <span className="comment-strip__count">bu sayfada {notes.length}</span>
        <button className="comment-strip__add" title="Yeni not ekle" onClick={onAddFreeform}>
          <PlusIcon />
        </button>
      </div>

      <div className="comment-strip__list">
        {sorted.map((n) => {
          const isActive = n.id === activeId
          const isHighlight = n.type === 'highlight'
          return (
            <div
              key={n.id}
              ref={(el) => {
                cardRefs.current[n.id] = el
              }}
              className={`note-card${isActive ? ' note-card--active' : ' note-card--dim'}`}
            >
              {isHighlight && n.translatedText && (
                <p className="pg note-card__quote">&ldquo;{n.translatedText}&rdquo;</p>
              )}

              {isActive ? (
                <>
                  {!isHighlight && (
                    <input
                      className="note-card__title-input"
                      placeholder="Not başlığı ([[bağlantı]] için kullanılır)"
                      defaultValue={n.title}
                      onBlur={(e) => onSaveTitle(n.id, e.target.value)}
                    />
                  )}
                  <textarea
                    autoFocus
                    className="note-card__textarea"
                    placeholder="Notunu yaz… [[bağlantı]] kurabilirsin"
                    defaultValue={n.content}
                    onBlur={(e) => onSaveContent(n.id, e.target.value)}
                  />
                  <div className="note-card__actions">
                    <span className="note-card__meta">
                      s. {n.page} · {formatRelativeTime(n.createdAt)}
                    </span>
                    <button
                      className="btn-ghost note-card__link-btn"
                      onClick={() => onDelete(n.id)}
                    >
                      Sil
                    </button>
                    <button
                      className="btn-ghost note-card__link-btn"
                      onClick={() => onSetActive(null)}
                    >
                      Kaydet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {n.content ? (
                    <div className="note-card__text">
                      <WikiText text={n.content} onLinkClick={onWikiLinkClick} />
                    </div>
                  ) : (
                    <button className="note-card__prompt" onClick={() => onSetActive(n.id)}>
                      + yorum ekle
                    </button>
                  )}
                  <div className="note-card__meta-row">
                    <span className="note-card__meta">
                      s. {n.page} · {formatRelativeTime(n.createdAt)}
                    </span>
                    <button className="note-card__edit-link" onClick={() => onSetActive(n.id)}>
                      Düzenle
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {notes.length === 0 && (
          <div className="comment-strip__empty">
            <span className="comment-strip__empty-icon">
              <CommentIcon />
            </span>
            <div className="comment-strip__empty-title">Bu sayfada not yok</div>
            <p>Sayfada bir söz öbeğine tıkla; kenarda beliren ikonla notunu yaz.</p>
          </div>
        )}
      </div>

      <div className="comment-strip__hint">
        {notes.length === 0 ? 'Metinden bir söz öbeği seç' : 'Kenardaki ikona tıkla'}
      </div>
    </div>
  )
}
