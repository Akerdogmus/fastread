import type { FastreadApi } from './index'

declare global {
  interface Window {
    api: FastreadApi
  }
}
