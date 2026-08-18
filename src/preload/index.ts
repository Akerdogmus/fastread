import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings } from '@shared/types'
import type { NewArticleInput, NewNoteInput } from '../main/db'

const api = {
  dialogs: {
    openPdf: () =>
      ipcRenderer.invoke('dialog:openPdf') as Promise<{
        filePath: string
        fileName: string
        data: Uint8Array
      } | null>
  },
  files: {
    read: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<Uint8Array>
  },
  articles: {
    list: () => ipcRenderer.invoke('articles:list'),
    get: (id: string) => ipcRenderer.invoke('articles:get', id),
    create: (input: NewArticleInput) => ipcRenderer.invoke('articles:create', input),
    update: (id: string, patch: Partial<NewArticleInput>) =>
      ipcRenderer.invoke('articles:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('articles:delete', id)
  },
  notes: {
    listByArticle: (articleId: string) => ipcRenderer.invoke('notes:listByArticle', articleId),
    listAll: () => ipcRenderer.invoke('notes:listAll'),
    create: (input: NewNoteInput) => ipcRenderer.invoke('notes:create', input),
    update: (id: string, patch: Partial<NewNoteInput>) =>
      ipcRenderer.invoke('notes:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('notes:delete', id)
  },
  graph: {
    get: () => ipcRenderer.invoke('graph:get')
  },
  pageTranslation: {
    get: (articleId: string, page: number) =>
      ipcRenderer.invoke('pageTranslation:get', articleId, page),
    save: (
      articleId: string,
      page: number,
      originalText: string,
      translatedText: string,
      engine: string
    ) =>
      ipcRenderer.invoke(
        'pageTranslation:save',
        articleId,
        page,
        originalText,
        translatedText,
        engine
      )
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load') as Promise<AppSettings>,
    save: (settings: AppSettings) =>
      ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>
  },
  llm: {
    translate: (text: string, targetLanguage?: string) =>
      ipcRenderer.invoke('llm:translate', text, targetLanguage),
    interpret: (text: string, targetLanguage?: string) =>
      ipcRenderer.invoke('llm:interpret', text, targetLanguage),
    extractCitation: (firstPageText: string) =>
      ipcRenderer.invoke('llm:extractCitation', firstPageText)
  }
}

export type FastreadApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
