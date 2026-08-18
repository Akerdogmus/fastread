// The fastread app mark: an open book with three "fast page-turn" speed lines,
// on a terracotta gradient tile. Used for the sidebar brand mark and the splash
// screen. Kept as inline SVG (rather than an <img>) so it stays crisp at any
// size and needs no asset request.
export default function AppIcon({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fastread-icon-bg" x1="40" y1="20" x2="472" y2="492">
          <stop offset="0" stopColor="#e08a52" />
          <stop offset="1" stopColor="#8c491a" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#fastread-icon-bg)" />
      <g
        transform="translate(246 270)"
        fill="none"
        stroke="#f9f4ed"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M0 -78 C -70 -110 -150 -96 -150 -96 L -150 96 C -150 96 -70 82 0 114" />
        <path d="M0 -78 C 70 -110 150 -96 150 -96 L 150 96 C 150 96 70 82 0 114" />
        <path d="M0 -78 L0 114" strokeWidth="18" />
      </g>
      <g stroke="#f9f4ed" strokeWidth="19" strokeLinecap="round" opacity="0.8">
        <line x1="358" y1="146" x2="410" y2="118" />
        <line x1="374" y1="188" x2="434" y2="164" />
        <line x1="384" y1="232" x2="446" y2="214" />
      </g>
    </svg>
  )
}
