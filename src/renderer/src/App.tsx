import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { AppSettings } from '@shared/types'
import LibraryPage from './pages/LibraryPage'
import ReaderPage from './pages/ReaderPage'
import GraphPage from './pages/GraphPage'
import SettingsPage from './pages/SettingsPage'
import AppIcon from './components/AppIcon'
import SplashScreen from './components/SplashScreen'
import { AppShellProvider } from './lib/appShell'
import { useAppShell } from './lib/useAppShell'
import './App.css'

function BookIcon(): React.JSX.Element {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
    </svg>
  )
}

function ReaderIcon(): React.JSX.Element {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="7.5" height="16" rx="2" />
      <rect x="13.5" y="4" width="7.5" height="16" rx="2" />
    </svg>
  )
}

function GraphIcon(): React.JSX.Element {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="18" r="2.5" />
      <path d="M10.5 6.8 6.6 15.6M13.5 6.8l3.9 8.8M7.5 18h9" />
    </svg>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </svg>
  )
}

function Sidebar(): React.JSX.Element {
  const { lastArticleId } = useAppShell()
  const location = useLocation()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    window.api.settings.load().then(setSettings)
  }, [location.pathname])

  // Settings can also change without a route change (editing engine priority while
  // already on /settings) — refetch so the status dot/label stay in sync.
  useEffect(() => {
    const onChange = (): void => {
      window.api.settings.load().then(setSettings)
    }
    window.addEventListener('fastread:settings-changed', onChange)
    return () => window.removeEventListener('fastread:settings-changed', onChange)
  }, [])

  const isReaderActive = location.pathname.startsWith('/reader')
  const primaryEngine = settings?.enginePriority?.[0] ?? 'lmstudio'

  function goReader(): void {
    if (isReaderActive) return
    if (lastArticleId) navigate(`/reader/${lastArticleId}`)
    else navigate('/')
  }

  return (
    <nav className="rail">
      <div className="rail__brand" title="fastread">
        <AppIcon size={30} />
      </div>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `rail__icon${isActive ? ' rail__icon--active' : ''}`}
        title="Kütüphane"
      >
        <BookIcon />
      </NavLink>
      <button
        className={`rail__icon${isReaderActive ? ' rail__icon--active' : ''}${!lastArticleId && !isReaderActive ? ' rail__icon--disabled' : ''}`}
        onClick={goReader}
        title="Okuyucu"
        disabled={!lastArticleId && !isReaderActive}
      >
        <ReaderIcon />
      </button>
      <NavLink
        to="/graph"
        className={({ isActive }) => `rail__icon${isActive ? ' rail__icon--active' : ''}`}
        title="Bilgi Ağı"
      >
        <GraphIcon />
      </NavLink>
      <NavLink
        to="/settings"
        className={({ isActive }) => `rail__icon${isActive ? ' rail__icon--active' : ''}`}
        title="Ayarlar"
      >
        <SettingsIcon />
      </NavLink>
      <div className="rail__status">
        <span
          className={`rail__status-dot${primaryEngine === 'lmstudio' ? ' rail__status-dot--local' : ' rail__status-dot--cloud'}`}
        />
        <span className="rail__status-label">
          {primaryEngine === 'lmstudio' ? (
            <>
              LM
              <br />
              Studio
            </>
          ) : (
            'Gemini'
          )}
        </span>
      </div>
    </nav>
  )
}

function AppShell(): React.JSX.Element {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/reader/:articleId" element={<ReaderPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

function App(): React.JSX.Element {
  const [showSplash, setShowSplash] = useState(true)
  return (
    <AppShellProvider>
      <AppShell />
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
    </AppShellProvider>
  )
}

export default App
