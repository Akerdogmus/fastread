import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { basename, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as db from './db'
import { loadSettings, saveSettings } from './settingsStore'
import { extractCitationFromText, interpretText, translateText } from './llmService'
import type { AppSettings } from '@shared/types'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const data = readFileSync(filePath)
    return new Uint8Array(data)
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
