import { ElectronAPI } from '@electron-toolkit/preload'
import type { FastreadApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: FastreadApi
  }
}
