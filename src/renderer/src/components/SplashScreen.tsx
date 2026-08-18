import { useEffect, useState } from 'react'
import AppIcon from './AppIcon'
import './SplashScreen.css'

const HOLD_MS = 1150
const FADE_MS = 420

interface Props {
  onDone: () => void
}

// A short, purely cosmetic "intro" shown while the real app mounts behind it.
// There's nothing to actually wait for — it just holds for a beat, plays a
// fake progress fill, then fades out.
export default function SplashScreen({ onDone }: Props): React.JSX.Element {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const holdTimer = setTimeout(() => setFading(true), HOLD_MS)
    return () => clearTimeout(holdTimer)
  }, [])

  useEffect(() => {
    if (!fading) return
    const fadeTimer = setTimeout(onDone, FADE_MS)
    return () => clearTimeout(fadeTimer)
  }, [fading, onDone])

  return (
    <div className={`splash${fading ? ' splash--fade' : ''}`}>
      <div className="splash__mark">
        <AppIcon size={84} />
      </div>
      <h1 className="splash__wordmark">fastread</h1>
      <p className="splash__tagline">Akademik okuma, hızlandırılmış.</p>
      <div className="splash__track">
        <div className="splash__fill" />
      </div>
    </div>
  )
}
