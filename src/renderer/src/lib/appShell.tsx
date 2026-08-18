import { useState, type ReactNode } from 'react'
import { AppShellContext } from './appShellContext'

export function AppShellProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [lastArticleId, setLastArticleId] = useState<string | null>(null)
  return (
    <AppShellContext.Provider value={{ lastArticleId, setLastArticleId }}>
      {children}
    </AppShellContext.Provider>
  )
}
