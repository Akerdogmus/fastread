import { renderInlineMarkdown } from '../lib/markdown'

interface Props {
  text: string
  onLinkClick: (title: string) => void
}

/**
 * Renders text, turning [[Title]] occurrences into clickable spans (Obsidian-style) while
 * also formatting any markdown (**bold**, *italic*) the LLM or user wrote — e.g. the
 * "Sayfayı Yorumla" output — instead of showing raw ** markers.
 */
export default function WikiText({ text, onLinkClick }: Props): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  // Fresh RegExp instance per render — a module-level shared regex would carry
  // mutable `lastIndex` state across renders/components, which is unsafe.
  const wikilinkRe = /\[\[([^\]]+)\]\]/g

  while ((match = wikilinkRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      parts.push(
        <span
          key={key++}

          dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(segment) }}
        />
      )
    }
    const title = match[1]
    parts.push(
      <span
        key={key++}
        className="wikilink"
        onClick={(e) => {
          e.stopPropagation()
          onLinkClick(title)
        }}
      >
        [[{title}]]
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex)
    parts.push(
      <span
        key={key++}

        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(segment) }}
      />
    )
  }

  return <>{parts}</>
}
