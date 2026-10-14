import type { RootDeskAPI } from './contracts'

declare global {
  interface Window {
    rootDesk: RootDeskAPI
  }
}

export {}
