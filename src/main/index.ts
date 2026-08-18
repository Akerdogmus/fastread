import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { basename, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as db from './db'
import { loadSettings, saveSettings } from './settingsStore'
import { extractCitationFromText, interpretText, translateText } from './llmService'
import type { AppSettings } from '@shared/types'

/**
 * The window is only ever allowed to sit on the app's own bundled UI: the dev server in
 * development, or the built index.html in production. Nothing else.
 *
 * This is load-bearing, not boilerplate. The reader renders text lifted out of whatever PDF
 * the user opened, and a PDF is an untrusted document — an attacker who gets HTML into that
 * text (see the sanitizer in renderer/src/lib/markdown.ts) can inject a `<meta http-equiv=
 * "refresh">`, which navigates the window with no script execution at all, so the page's CSP
 * does not stop it. Should such a navigation land, the preload stays attached to the
 * webContents across it, and the attacker's own origin inherits the whole `window.api`
 * surface — arbitrary local file reads and the stored Gemini key included. Refusing the
 * navigation in the first place is what makes that chain a dead end.
 */
function isAllowedAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl && url.startsWith(devUrl)) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    return parsed.pathname.endsWith('/renderer/index.html')
  } catch {
    return false
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer parses untrusted PDFs through pdf.js in-process, which is precisely the
      // case the OS sandbox exists for: a memory-safety bug in Blink or pdf.js is contained
      // rather than running with the user's full privileges. The preload imports nothing but
      // `electron` itself, so it needs no Node access and works unchanged under the sandbox.
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault()
  })

  // Anything the app itself wants to open elsewhere goes to the real browser — but only over
  // http(s). Handing the OS shell an arbitrary scheme from injected markup is its own attack:
  // `file:///…/setup.exe` runs an installer, a Windows UNC path (`\\host\share`) leaks the
  // user's NTLM hash to a remote host without any prompt, and several `ms-*:` handlers have
  // been weaponised in the past.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url)
    } catch {
      // A URL that doesn't parse is never one worth handing to the shell.
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // ---------- Dialogs / file access ----------
  ipcMain.handle('dialog:openPdf', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const data = readFileSync(filePath)
    return { filePath, fileName: basename(filePath), data: new Uint8Array(data) }
  })

  // Reading a file is only ever legitimate for a PDF the user themselves added to the
  // library through the OS picker, so that's exactly what's permitted. Without this the
  // handler is a general "read any file on this machine" primitive sitting behind an IPC
  // channel — harmless while only the app's own code can call it, but the difference between
  // an inconvenience and a disaster if anything else ever gets to.
  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const isKnownArticle = db.listArticles().some((a) => a.filePath === filePath)
    if (!isKnownArticle) throw new Error('Bu dosyaya erişim izni yok')
    return new Uint8Array(readFileSync(filePath))
  })

  // ---------- Articles ----------
  ipcMain.handle('articles:list', () => db.listArticles())
  ipcMain.handle('articles:get', (_e, id: string) => db.getArticle(id))
  ipcMain.handle('articles:create', (_e, input: db.NewArticleInput) => db.createArticle(input))
  ipcMain.handle('articles:update', (_e, id: string, patch: Partial<db.NewArticleInput>) =>
    db.updateArticle(id, patch)
  )
  ipcMain.handle('articles:delete', (_e, id: string) => db.deleteArticle(id))

  // ---------- Notes ----------
  ipcMain.handle('notes:listByArticle', (_e, articleId: string) => db.listNotesByArticle(articleId))
  ipcMain.handle('notes:listAll', () => db.listAllNotes())
  ipcMain.handle('notes:create', (_e, input: db.NewNoteInput) => db.createNote(input))
  ipcMain.handle('notes:update', (_e, id: string, patch: Partial<db.NewNoteInput>) =>
    db.updateNote(id, patch)
  )
  ipcMain.handle('notes:delete', (_e, id: string) => db.deleteNote(id))

  // ---------- Graph ----------
  ipcMain.handle('graph:get', () => db.getGraphData())

  // ---------- Page translation cache ----------
  ipcMain.handle('pageTranslation:get', (_e, articleId: string, page: number) =>
    db.getPageTranslation(articleId, page)
  )
  ipcMain.handle(
    'pageTranslation:save',
    (
      _e,
      articleId: string,
      page: number,
      originalText: string,
      translatedText: string,
      engine: string
    ) => db.savePageTranslation(articleId, page, originalText, translatedText, engine)
  )

  // ---------- Settings ----------
  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_e, settings: AppSettings) => saveSettings(settings))

  // ---------- LLM ----------
  ipcMain.handle('llm:translate', async (_e, text: string, targetLanguage?: string) => {
    const settings = loadSettings()
    return translateText(settings, text, targetLanguage)
  })
  ipcMain.handle('llm:interpret', async (_e, text: string, targetLanguage?: string) => {
    const settings = loadSettings()
    return interpretText(settings, text, targetLanguage)
  })
  ipcMain.handle('llm:extractCitation', async (_e, firstPageText: string) => {
    const settings = loadSettings()
    return extractCitationFromText(settings, firstPageText)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.acdino.fastread')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await db.initDatabase()
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
