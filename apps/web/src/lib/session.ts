'use client'

import type { ServerConfig } from './api'

const SESSION_KEY = 'agentroom_session'

export interface StoredSession {
  token: string
  name: string
  entityId: string
  config: ServerConfig
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {}
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {}
}
