'use client'

import { useState } from 'react'
import { type Channel } from '@/lib/api'
import { toggleTheme } from '@/lib/theme'
import { showToast } from '@/lib/toast'

interface SidebarProps {
  userName: string
  channels: Channel[]
  activeChannelId: string | null
  unreadCounts: Record<string, number>
  isConnected: boolean
  isMobile: boolean
  showSidebar: boolean
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onLogout: () => void
  onSelectChannel: (ch: Channel) => void
  onCreateChannel: (name: string, opts: { persistent: boolean }) => void
  onCloseSidebar: () => void
}

export default function Sidebar({
  userName,
  channels,
  activeChannelId,
  unreadCounts,
  isConnected,
  isMobile,
  theme,
  onToggleTheme,
  onLogout,
  onSelectChannel,
  onCreateChannel,
  onCloseSidebar,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [persistent, setPersistent] = useState(false)
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null)

  const filtered = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  )

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) {
      showToast('Channel name cannot be empty', 'error')
      return
    }
    onCreateChannel(trimmed, { persistent })
    setNewName('')
    setPersistent(false)
    setShowCreate(false)
  }

  function handleToggleTheme() {
    toggleTheme()
    onToggleTheme()
  }

  return (
    <aside style={s.sidebar}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.logo}>⬡ AgentRoom</span>
        <div style={s.headerActions}>
          <button
            onClick={handleToggleTheme}
            style={s.iconBtn}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {isMobile && (
            <button
              onClick={onCloseSidebar}
              style={s.iconBtn}
              title="Close sidebar"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* User row */}
      <div style={s.userRow}>
        <span
          style={{
            ...s.statusDot,
            color: isConnected ? 'var(--success)' : 'var(--danger)',
          }}
        >
          ●
        </span>
        <span style={s.userName}>{userName}</span>
        <span
          style={{
            ...s.statusBadge,
            background: isConnected ? 'rgba(74,222,128,0.12)' : 'rgba(255,92,92,0.12)',
            color: isConnected ? 'var(--success)' : 'var(--danger)',
            border: `1px solid ${isConnected ? 'rgba(74,222,128,0.3)' : 'rgba(255,92,92,0.3)'}`,
          }}
        >
          {isConnected ? '● Online' : '○ Offline'}
        </span>
      </div>

      {/* Connection status bar */}
      <div
        style={{
          height: 3,
          background: isConnected ? 'var(--success)' : 'var(--danger)',
          opacity: 0.6,
        }}
        className={isConnected ? undefined : 'animate-pulse'}
      />

      {/* Channel search */}
      <div style={s.searchWrap}>
        <input
          style={s.searchInput}
          placeholder="Search channels…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Section header */}
      <div style={s.sectionHeader}>
        <span>Channels</span>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={s.addBtn}
          title="Create channel"
        >
          +
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form style={s.createForm} onSubmit={handleCreate}>
          <input
            style={s.createInput}
            placeholder="channel-name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <label style={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={persistent}
              onChange={e => setPersistent(e.target.checked)}
              style={{ marginRight: '0.3rem' }}
            />
            Persistent
          </label>
          <div style={s.createActions}>
            <button type="submit" style={s.createBtn}>Create</button>
            <button
              type="button"
              style={s.cancelBtn}
              onClick={() => { setShowCreate(false); setNewName(''); setPersistent(false) }}
            >
              ✕
            </button>
          </div>
        </form>
      )}

      {/* Channel list */}
      <div style={s.channelList}>
        {filtered.map(ch => {
          const isActive = ch.id === activeChannelId
          const unread = unreadCounts[ch.id] ?? 0
          const isHovered = hoveredChannel === ch.id
          return (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch)}
              onMouseEnter={() => setHoveredChannel(ch.id)}
              onMouseLeave={() => setHoveredChannel(null)}
              style={{
                ...s.channelBtn,
                ...(isActive ? s.channelBtnActive : {}),
                ...(isHovered && !isActive ? s.channelBtnHover : {}),
              }}
            >
              <span style={s.channelName}># {ch.name}</span>
              {unread > 0 && (
                <span style={s.unreadBadge}>{unread > 99 ? '99+' : unread}</span>
              )}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p style={s.empty}>
            {search ? 'No channels match' : 'No channels yet'}
          </p>
        )}
      </div>

      {/* Bottom actions */}
      <div style={s.bottomBar}>
        <button style={s.bottomBtn} title="Notifications">🔔</button>
        <button style={s.bottomBtn} title="Settings">⚙️</button>
        <button
          style={{ ...s.bottomBtn, ...s.logoutBtn }}
          onClick={onLogout}
          title="Log out"
        >
          →
        </button>
      </div>
    </aside>
  )
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    minWidth: 180,
    background: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    height: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 0.85rem',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  logo: {
    fontWeight: 700,
    fontSize: '0.9rem',
    color: 'var(--accent)',
  },
  headerActions: {
    display: 'flex',
    gap: '0.3rem',
    alignItems: 'center',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.95rem',
    cursor: 'pointer',
    padding: '0.15rem',
    lineHeight: 1,
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.85rem',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  statusDot: {
    fontSize: '0.55rem',
    flexShrink: 0,
  },
  userName: {
    fontSize: '0.82rem',
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    fontWeight: 500,
  },
  statusBadge: {
    fontSize: '0.62rem',
    fontWeight: 600,
    padding: '0.1rem 0.35rem',
    borderRadius: 99,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  searchWrap: {
    padding: '0.5rem 0.6rem 0.3rem',
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    padding: '0.35rem 0.55rem',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    outline: 'none',
    fontSize: '0.8rem',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.5rem 0.85rem 0.25rem',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  addBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '1rem',
    lineHeight: 1,
    padding: '0 0.1rem',
  },
  createForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    padding: '0 0.6rem 0.4rem',
    flexShrink: 0,
  },
  createInput: {
    padding: '0.35rem 0.5rem',
    background: 'var(--surface-2)',
    border: '1px solid var(--accent)',
    borderRadius: 6,
    color: 'var(--text)',
    outline: 'none',
    fontSize: '0.82rem',
    width: '100%',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  createActions: {
    display: 'flex',
    gap: '0.3rem',
  },
  createBtn: {
    flex: 1,
    padding: '0.35rem 0.5rem',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontWeight: 600,
  },
  cancelBtn: {
    padding: '0.35rem 0.55rem',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-muted)',
    fontSize: '0.78rem',
    cursor: 'pointer',
  },
  channelList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.25rem 0.4rem',
  },
  channelBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    textAlign: 'left',
    padding: '0.4rem 0.5rem',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    borderRadius: 6,
    fontSize: '0.88rem',
    cursor: 'pointer',
    marginBottom: 1,
    transition: 'background 0.1s, color 0.1s',
  },
  channelBtnActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontWeight: 600,
  },
  channelBtnHover: {
    background: 'var(--surface-2)',
    color: 'var(--text)',
  },
  channelName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  unreadBadge: {
    background: 'var(--danger)',
    color: '#fff',
    fontSize: '0.62rem',
    fontWeight: 700,
    padding: '0.05rem 0.35rem',
    borderRadius: 99,
    minWidth: '1.2rem',
    textAlign: 'center',
    flexShrink: 0,
    marginLeft: '0.3rem',
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.8rem',
    padding: '0.5rem 0.4rem',
  },
  bottomBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.2rem',
    padding: '0.5rem 0.6rem',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  bottomBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.95rem',
    cursor: 'pointer',
    padding: '0.3rem 0.4rem',
    borderRadius: 6,
    lineHeight: 1,
  },
  logoutBtn: {
    marginLeft: 'auto',
    fontWeight: 700,
    fontSize: '1rem',
    color: 'var(--danger)',
  },
}
