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
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
