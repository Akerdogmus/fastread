import { useContext } from 'react'
import { AppShellContext, type AppShellState } from './appShellContext'

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext)
  if (!ctx) throw new Error('useAppShell must be used within AppShellProvider')
  return ctx
}
