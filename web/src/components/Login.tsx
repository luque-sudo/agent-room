'use client'

import { useState, useEffect } from 'react'
import { login, register, deriveConfig, DEFAULT_CONFIG, type ServerConfig } from '@/lib/api'
import { toggleTheme, getTheme, type Theme } from '@/lib/theme'

interface Props {
  onAuth: (token: string, name: string, entityId: string, config: ServerConfig) => void
}

export default function Login({ onAuth }: Props) {
  const [loginMode, setLoginMode] = useState<'full' | 'sse' | 'simple'>('full')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serverUrl, setServerUrl] = useState(DEFAULT_CONFIG.apiUrl)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [wsUrl, setWsUrl] = useState(DEFAULT_CONFIG.wsUrl)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [theme, setThemeState] = useState<Theme>('dark')

  // Simple mode state
  const [simpleUsername, setSimpleUsername] = useState('')
  const [simpleWsUrl, setSimpleWsUrl] = useState('ws://localhost:9000')

  // SSE mode state
  const [sseServerUrl, setSseServerUrl] = useState(DEFAULT_CONFIG.apiUrl)
  const [sseEmail, setSseEmail] = useState('')
  const [ssePassword, setSsePassword] = useState('')

  useEffect(() => { setThemeState(getTheme()) }, [])

  function handleToggleTheme() {
    setThemeState(toggleTheme())
  }

  function handleServerUrlChange(val: string) {
    setServerUrl(val)
    const derived = deriveConfig(val)
    setWsUrl(derived.wsUrl)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const config: ServerConfig = {
      apiUrl: serverUrl.replace(/\/$/, ''),
      wsUrl,
    }
    sessionStorage.setItem('connType', 'ws')
    sessionStorage.removeItem('sseUrl')
    try {
      const res = mode === 'login'
        ? await login(config, email, password)
        : await register(config, name, email, password)
      onAuth(res.accessToken, res.entity.name, res.entity.id, config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSimpleConnect(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(simpleWsUrl)
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Connection timed out')) }, 5000)

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'action', from: 'client', payload: { action: 'auth', name: simpleUsername } }))
        }

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as Record<string, unknown>
            const payload = msg.payload as Record<string, unknown> | undefined
            // Accept explicit auth confirmation as success signal
            if (
              (payload?.action === 'auth' && payload?.success === true) ||
              (msg.type === 'system' && (payload?.event === 'welcome' || payload?.success === true))
            ) {
              clearTimeout(timeout)
              ws.close()
              resolve()
            }
          } catch {
            // ignore parse errors
          }
        }

        ws.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed')) }
        ws.onclose = (ev) => { if (!ev.wasClean) { clearTimeout(timeout); reject(new Error('Connection closed unexpectedly')) } }
      })

      // Success: build a simple-mode config
      // Derive HTTP URL from WS URL for any REST calls
      const httpUrl = simpleWsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
      const simpleConfig: ServerConfig = { apiUrl: httpUrl, wsUrl: simpleWsUrl }

      // Store simple mode in sessionStorage so Chat knows to use simple protocol
      sessionStorage.setItem('connType', 'simple')

      // Use username as both name and entity ID (no real entity ID in simple service)
      onAuth(`simple:${simpleUsername}`, simpleUsername, simpleUsername, simpleConfig)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSseConnect(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const apiUrl = sseServerUrl.replace(/\/$/, '')
    const config: ServerConfig = {
      apiUrl,
      wsUrl: deriveConfig(apiUrl).wsUrl,
      sseUrl: `${apiUrl.replace(/:3000$/, ':3001')}/events`,
    }
    try {
      const res = await login(config, sseEmail, ssePassword)
      sessionStorage.setItem('connType', 'sse')
      sessionStorage.setItem('sseUrl', config.sseUrl ?? '')
      onAuth(res.accessToken, res.entity.name, res.entity.id, config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.topBar}>
          <div style={s.logo}>
            <span style={s.logoIcon}>⬡</span>
            <span style={s.logoText}>AgentRoom</span>
          </div>
          <button onClick={handleToggleTheme} style={s.themeBtn} title="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        <div style={s.modeTabs}>
          <button
            style={{ ...s.modeTab, ...(loginMode === 'full' ? s.modeTabActive : {}) }}
            onClick={() => setLoginMode('full')}
          >
            🔐 Full Stack
          </button>
          <button
            style={{ ...s.modeTab, ...(loginMode === 'sse' ? s.modeTabActive : {}) }}
            onClick={() => setLoginMode('sse')}
          >
            📡 SSE
          </button>
          <button
            style={{ ...s.modeTab, ...(loginMode === 'simple' ? s.modeTabActive : {}) }}
            onClick={() => setLoginMode('simple')}
          >
            ⚡ Simple Service
          </button>
        </div>

        {loginMode === 'full' && (
          <>
            <p style={s.tagline}>Real-time multi-agent messaging</p>

            <div style={s.serverRow}>
              <label style={s.label}>API Server</label>
              <input
                style={s.input}
                value={serverUrl}
                onChange={e => handleServerUrlChange(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>

            <button style={s.advancedBtn} type="button" onClick={() => setShowAdvanced(v => !v)}>
              {showAdvanced ? '▲' : '▼'} Advanced
            </button>

            {showAdvanced && (
              <div style={s.serverRow}>
                <label style={s.label}>WebSocket URL</label>
                <input
                  style={s.input}
                  value={wsUrl}
                  onChange={e => setWsUrl(e.target.value)}
                  placeholder="ws://localhost:3001"
                />
                <div style={s.quickUrls}>
                  <span style={s.quickLabel}>Quick connect:</span>
                  <button type="button" style={s.quickBtn} onClick={() => { handleServerUrlChange('http://localhost:3000') }}>localhost:3000</button>
                  <button type="button" style={s.quickBtn} onClick={() => { setServerUrl('http://8.140.63.143:9000'); setWsUrl('ws://8.140.63.143:9000') }}>Public test server</button>
                </div>
              </div>
            )}

            <div style={s.tabs}>
              <button style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }} onClick={() => setMode('login')}>Sign in</button>
              <button style={{ ...s.tab, ...(mode === 'register' ? s.tabActive : {}) }} onClick={() => setMode('register')}>Register</button>
            </div>

            <form onSubmit={handleSubmit} style={s.form}>
              {mode === 'register' && (
                <input style={s.input} placeholder="Display name" value={name} onChange={e => setName(e.target.value)} required />
              )}
              <input style={s.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
              <input style={s.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
              {error && <p style={s.error}>{error}</p>}
              <button style={s.submit} type="submit" disabled={loading}>
                {loading ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p style={s.hint}>Default: admin@localhost / admin123</p>
          </>
        )}

        {loginMode === 'sse' && (
          <>
            <p style={s.tagline}>Read-only event stream over HTTP — no send capability</p>
            <div style={s.serverRow}>
              <label style={s.label}>API Server</label>
              <input
                style={s.input}
                value={sseServerUrl}
                onChange={e => setSseServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>
            <form onSubmit={handleSseConnect} style={s.form}>
              <input style={s.input} type="email" placeholder="Email" value={sseEmail} onChange={e => setSseEmail(e.target.value)} required />
              <input style={s.input} type="password" placeholder="Password" value={ssePassword} onChange={e => setSsePassword(e.target.value)} required />
              {error && <p style={s.error}>{error}</p>}
              <button style={s.submit} type="submit" disabled={loading}>
                {loading ? 'Connecting…' : 'Connect via SSE'}
              </button>
            </form>
            <p style={s.hint}>SSE connects to ws-server port 3001. Messages are read-only.</p>
          </>
        )}

        {loginMode === 'simple' && (
          <>
            <form onSubmit={handleSimpleConnect} style={s.form}>
              <div style={s.serverRow}>
                <label style={s.label}>Username</label>
                <input
                  style={s.input}
                  placeholder="Display name (e.g. Alice)"
                  value={simpleUsername}
                  onChange={e => setSimpleUsername(e.target.value)}
                  required
                />
              </div>
              <div style={s.serverRow}>
                <label style={s.label}>WS URL</label>
                <input
                  style={s.input}
                  placeholder="ws://localhost:9000"
                  value={simpleWsUrl}
                  onChange={e => setSimpleWsUrl(e.target.value)}
                  required
                />
                <div style={s.quickUrls}>
                  <span style={s.quickLabel}>Quick connect:</span>
                  <button type="button" style={s.quickBtn} onClick={() => setSimpleWsUrl('ws://localhost:9000')}>localhost:9000</button>
                  <button type="button" style={s.quickBtn} onClick={() => setSimpleWsUrl('ws://8.140.63.143:9000')}>Public test server (ws://8.140.63.143:9000)</button>
                </div>
              </div>
              {error && <p style={s.error}>{error}</p>}
              <button style={s.submit} type="submit" disabled={loading}>
                {loading ? 'Connecting…' : 'Connect'}
              </button>
            </form>

            <p style={s.hint}>Connects to standalone agent-room-service. No email/password required.</p>
          </>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', padding: '1rem' },
  card: { width: '100%', maxWidth: 400, background: 'var(--surface)', borderRadius: 16, padding: '1.75rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  logoIcon: { fontSize: '1.6rem', color: 'var(--accent)' },
  logoText: { fontSize: '1.3rem', fontWeight: 700, letterSpacing: '-0.02em' },
  themeBtn: { background: 'none', border: 'none', fontSize: '1.2rem', color: 'var(--text-muted)', padding: '0.25rem' },
  tagline: { color: 'var(--text-muted)', fontSize: '0.82rem' },
  serverRow: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  label: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  advancedBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'left', padding: '0', cursor: 'pointer' },
  quickUrls: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' },
  quickLabel: { fontSize: '0.72rem', color: 'var(--text-muted)' },
  quickBtn: { fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--accent)', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '0.4rem', background: 'var(--surface-2)', borderRadius: 8, padding: 4 },
  tab: { flex: 1, padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--text-muted)', borderRadius: 6, transition: 'all 0.15s', cursor: 'pointer' },
  tabActive: { background: 'var(--accent)', color: '#fff', fontWeight: 600 },
  modeTabs: { display: 'flex', gap: '0.4rem', background: 'var(--surface-2)', borderRadius: 8, padding: 4 },
  modeTab: { flex: 1, padding: '0.4rem 0.5rem', border: 'none', background: 'transparent', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.15s' },
  modeTabActive: { background: 'var(--accent)', color: '#fff', fontWeight: 600 },
  form: { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  input: { padding: '0.6rem 0.8rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', width: '100%' },
  error: { color: 'var(--danger)', fontSize: '0.82rem' },
  submit: { padding: '0.65rem', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' },
  hint: { textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' },
}
