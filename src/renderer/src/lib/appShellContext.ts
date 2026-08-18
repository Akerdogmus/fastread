import { createContext } from 'react'

export interface AppShellState {
  lastArticleId: string | null
  setLastArticleId: (id: string | null) => void
}

export const AppShellContext = createContext<AppShellState | null>(null)
