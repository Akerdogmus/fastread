import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppSettings } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  lmStudioBaseUrl: 'http://localhost:1234/v1',
  lmStudioModel: '',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  enginePriority: ['lmstudio', 'gemini'],
  targetLanguage: 'Turkish'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const p = settingsPath()
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  // This file holds the user's Gemini API key in plaintext, so it is written owner-only
  // rather than at the default 0644 — otherwise any other account on a shared machine (a
  // lab or department workstation is a realistic setting for this app) could simply read
  // it. On Windows the mode is ignored and the per-user AppData ACL already covers this.
  writeFileSync(p, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 })
  return settings
}
