import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject
} from 'react-force-graph-2d'
import type { GraphData, GraphNode } from '@shared/types'
import './GraphPage.css'

const GRAPH_LABEL_FONT_PX = 11 // on-screen label size, divided back out by the canvas zoom so it stays constant as you zoom
const GRAPH_LABEL_MAX_CHARS = 34 // a full paper title would otherwise stretch clear across the canvas
const GRAPH_LABEL_MIN_SCALE = 0.55 // below this zoom the labels overlap into noise, so they're dropped
const GRAPH_FIT_MAX_ZOOM = 2.5 // "Ortala" brings everything into view but never magnifies past this (see fitToView)

function SearchIcon(): React.JSX.Element {
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
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  )
}

function NetworkEmptyIcon(): React.JSX.Element {
  return (
    <svg width="150" height="110" viewBox="0 0 150 110" fill="none">
      <g stroke="#f5ead8" strokeOpacity=".14" strokeDasharray="3 4">
        <path d="M75 55 L35 30 M75 55 L118 32 M75 55 L40 85 M75 55 L115 82" />
      </g>
      <g fill="#f5ead8" fillOpacity=".14">
        <circle cx="35" cy="30" r="7" />
        <circle cx="118" cy="32" r="6" />
        <circle cx="40" cy="85" r="6" />
        <circle cx="115" cy="82" r="7" />
      </g>
      <circle cx="75" cy="55" r="15" fill="#f5ead8" fillOpacity=".18" />
    </svg>
  )
}

export default function GraphPage(): React.JSX.Element {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const navigate = useNavigate()

  useEffect(() => {
    window.api.graph.get().then(setGraph)
  }, [])

  // Deliberately keyed on the node count, not just mount: the element this observes only
  // exists in the non-empty branch further down, and the graph data arrives asynchronously.
  // On a cold open the first pass therefore renders the empty state, containerRef is still
  // null, and the effect bails — so without re-running once nodes land, the observer would
  // never attach at all and the canvas would sit at its 800x600 starting guess in the corner
  // of the page for the rest of the session.
  const nodeCount = graph.nodes.length
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [nodeCount])

  const articleNodes = graph.nodes.filter((n) => n.kind === 'article')
  const noteNodes = graph.nodes.filter((n) => n.kind === 'note')
  const q = search.trim().toLowerCase()
  const matchesQuery = (n: GraphNode): boolean => !q || n.label.toLowerCase().includes(q)

  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const n = node as unknown as GraphNode
      if (n.kind === 'article') {
        setSelectedId(n.id)
      } else {
        navigate(`/reader/${n.articleId}?note=${n.id.replace(/^note:/, '')}`)
      }
    },
    [navigate]
  )

  const selectedArticleRawId = selectedId?.replace(/^article:/, '') ?? null
  const selectedArticle = articleNodes.find((n) => n.id === selectedId) ?? null
  const connectedNotes = useMemo(
    () =>
      selectedArticleRawId ? noteNodes.filter((n) => n.articleId === selectedArticleRawId) : [],
    [noteNodes, selectedArticleRawId]
  )
  const linkCount = useMemo(() => {
    if (!selectedArticleRawId) return 0
    const noteIds = new Set(connectedNotes.map((n) => n.id))
    return graph.edges.filter(
      (e) => e.label !== 'belongs to' && (noteIds.has(e.source) || noteIds.has(e.target))
    ).length
  }, [graph.edges, connectedNotes, selectedArticleRawId])

  function zoomBy(factor: number): void {
    const fg = fgRef.current
    if (!fg) return
    fg.zoom(fg.zoom() * factor, 300)
  }

  /**
   * Fit every node on screen — but only ever zooming *out* to do it. A plain zoom-to-fit on
   * a young graph of half a dozen nodes magnifies them until a handful of blobs fill the
   * canvas, which is a worse view than the one it replaced; "fit" is only ever wanted here
   * in the sense of "bring everything into view".
   */
  function fitToView(): void {
    const fg = fgRef.current
    if (!fg) return
    fg.zoomToFit(500, 60)
    window.setTimeout(() => {
      const current = fg.zoom()
      if (current > GRAPH_FIT_MAX_ZOOM) fg.zoom(GRAPH_FIT_MAX_ZOOM, 300)
    }, 520)
  }

  return (
    <div className="graph-page">
      <div className="graph-sidebar">
        <h1>Bilgi Ağı</h1>
        <div className="graph-sidebar__search">
          <SearchIcon />
          <input
            placeholder="Ağda ara"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <div className="graph-sidebar__section-label">Göster</div>
          <div className="graph-sidebar__legend">
            <div className="graph-sidebar__legend-row">
              <span className="graph-sidebar__dot" style={{ background: '#f6a06b' }} />
              Makaleler <span className="graph-sidebar__legend-count">{articleNodes.length}</span>
            </div>
            <div className="graph-sidebar__legend-row">
              <span className="graph-sidebar__dot" style={{ background: '#aebf92' }} />
              Notlar <span className="graph-sidebar__legend-count">{noteNodes.length}</span>
            </div>
          </div>
        </div>
        <p className="graph-sidebar__hint">Düğüme tıkla → sağda detayı açılır.</p>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="graph-empty">
          <div className="graph-empty__inner">
            <NetworkEmptyIcon />
            <h2>Ağ henüz kurulmadı</h2>
            <p>
              Okurken aldığın her not buraya bir düğüm olarak düşer. İki notu{' '}
              <span className="graph-empty__accent">[[çift köşeli parantez]]</span> ile bağladığında
              aralarında bir kenar belirir.
            </p>
            <button className="btn" onClick={() => navigate('/')}>
              Kütüphaneye git
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="graph-canvas" ref={containerRef}>
            <ForceGraph2D
              ref={fgRef}
              width={size.width}
              height={size.height}
              graphData={{
                nodes: graph.nodes as unknown as NodeObject[],
                links: graph.edges as unknown as LinkObject[]
              }}
              nodeId="id"
              nodeLabel="label"
              nodeColor={(n) => {
                const gn = n as unknown as GraphNode
                if (gn.kind === 'article') {
                  if (!matchesQuery(gn)) return 'rgba(214,127,72,0.25)'
                  return gn.id === selectedId ? '#f6a06b' : '#d67f48'
                }
                return matchesQuery(gn) ? '#aebf92' : 'rgba(174,191,146,0.25)'
              }}
              nodeVal={(n) => {
                const gn = n as unknown as GraphNode
                if (gn.kind === 'article') return gn.id === selectedId ? 12 : 8
                return 4
              }}
              // A knowledge graph is only readable if you can see what each node *is* —
              // hover tooltips alone (nodeLabel) leave a screenful of anonymous circles. The
              // dot itself is still drawn by the library's default painter; this only adds
              // the caption underneath it, dimmed in step with the node whenever a search
              // filters it out, and truncated so a long paper title can't run across the
              // whole canvas.
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(n, ctx, globalScale) => {
                const gn = n as unknown as GraphNode
                const node = n as NodeObject & { x?: number; y?: number }
                if (node.x === undefined || node.y === undefined) return
                // Labels would turn to unreadable mush stacked on top of each other when
                // zoomed far out, so they fade out below a legible on-screen size.
                if (globalScale < GRAPH_LABEL_MIN_SCALE) return
                const isArticle = gn.kind === 'article'
                const label =
                  gn.label.length > GRAPH_LABEL_MAX_CHARS
                    ? `${gn.label.slice(0, GRAPH_LABEL_MAX_CHARS - 1).trimEnd()}…`
                    : gn.label
                const dimmed = !matchesQuery(gn)
                ctx.font = `${isArticle ? 600 : 400} ${GRAPH_LABEL_FONT_PX / globalScale}px Figtree, sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillStyle = dimmed
                  ? 'rgba(245,234,216,0.22)'
                  : isArticle
                    ? 'rgba(246,160,107,0.95)'
                    : 'rgba(245,234,216,0.72)'
                // Matches the library's own default painter: radius = sqrt(nodeVal) * 4, in
                // graph units — the same space as node.x/node.y, so it must NOT be scaled.
                // Only the gap below the dot is a screen-space measure and gets divided out.
                const radius = Math.sqrt(isArticle ? (gn.id === selectedId ? 12 : 8) : 4) * 4
                ctx.fillText(label, node.x, node.y + radius + 3 / globalScale)
              }}
              linkColor={() => 'rgba(245,234,216,0.13)'}
              linkDirectionalParticles={0}
              onNodeClick={handleNodeClick}
              backgroundColor="#1c1a19"
            />
            <div className="graph-canvas__controls">
              <button onClick={() => zoomBy(1.3)} title="Yakınlaştır">
                +
              </button>
              <button onClick={() => zoomBy(1 / 1.3)} title="Uzaklaştır">
                −
              </button>
              <button className="graph-canvas__controls-center" onClick={fitToView}>
                Ortala
              </button>
            </div>
          </div>

          {selectedArticle && (
            <div className="graph-detail">
              <div className="graph-detail__kind">
                <span className="graph-sidebar__dot" style={{ background: '#f6a06b' }} />
                Makale düğümü
              </div>
              <h2>{selectedArticle.label}</h2>
              <div className="graph-detail__tags">
                <span className="tag tag-accent-2">{connectedNotes.length} not</span>
                <span className="tag tag-neutral">{linkCount} bağlantı</span>
              </div>
              <div className="graph-detail__divider" />
              <div className="graph-sidebar__section-label">Bağlı notlar</div>
              <div className="graph-detail__notes">
                {connectedNotes.length === 0 && (
                  <p className="graph-detail__no-notes">Bu makalede henüz not yok.</p>
                )}
                {connectedNotes.map((n) => (
                  <button
                    key={n.id}
                    className="graph-detail__note"
                    onClick={() =>
                      navigate(`/reader/${n.articleId}?note=${n.id.replace(/^note:/, '')}`)
                    }
                  >
                    {n.label}
                    {n.page ? <span className="graph-detail__note-page">s. {n.page}</span> : null}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary graph-detail__open"
                onClick={() => navigate(`/reader/${selectedArticleRawId}`)}
              >
                Okuyucuda aç
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
