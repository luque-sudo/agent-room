'use client'

import { useState, useEffect } from 'react'
import Login from '@/components/Login'
import Chat from '@/components/Chat'
import type { ServerConfig } from '@/lib/api'
import { saveSession, loadSession, clearSession } from '@/lib/session'

interface Session {
  token: string
  name: string
  entityId: string
  config: ServerConfig
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = loadSession()
    if (!stored) {
      setIsLoading(false)
      return
    }

    fetch(`${stored.config.apiUrl}/channels`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    })
      .then(res => {
        if (res.ok) {
          setSession(stored)
        } else {
          clearSession()
        }
      })
      .catch(() => {
        clearSession()
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        Reconnecting…
      </div>
    )
  }

  if (!session) {
    return (
      <Login
        onAuth={(token, name, entityId, config) => {
          const newSession = { token, name, entityId, config }
          setSession(newSession)
          saveSession(newSession)
        }}
      />
    )
  }

  return (
    <>
      {/* Active channel is persisted inside Chat via sessionStorage */}
      <Chat
        token={session.token}
        userName={session.name}
        entityId={session.entityId}
        config={session.config}
        onLogout={() => {
          clearSession()
          setSession(null)
        }}
      />
    </>
  )
}
