'use client'

import { useState } from 'react'
import { type Channel, type Member } from '@/lib/api'

interface MemberPanelProps {
  channel: Channel | null
  members: Member[]
  currentUserEntityId: string
  onDmUser: (userName: string) => void
  onSetRole: (entityId: string, name: string) => void
}

type TabId = 'members' | 'info'

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  owner: { background: 'rgba(147,51,234,0.15)', color: '#a855f7', border: '1px solid rgba(147,51,234,0.3)' },
  admin: { background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' },
  member: { background: 'rgba(107,114,128,0.15)', color: 'var(--text-muted)', border: '1px solid rgba(107,114,128,0.25)' },
  guest: { background: 'rgba(75,85,99,0.1)', color: 'var(--text-muted)', border: '1px solid rgba(75,85,99,0.2)', opacity: 0.7 },
}

function getRoleBadgeStyle(role: string): React.CSSProperties {
  const normalized = role.toLowerCase()
  return ROLE_STYLES[normalized] ?? ROLE_STYLES.member
}

export default function MemberPanel({
  channel,
  members,
  currentUserEntityId,
  onDmUser,
  onSetRole,
}: MemberPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('members')
  const [hoveredMember, setHoveredMember] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState(false)

  function handleCopyId() {
    if (!channel) return
    navigator.clipboard.writeText(channel.id).then(() => {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    })
  }

  return (
    <aside style={s.panel}>
      {/* Tab bar */}
      <div style={s.tabBar}>
        <button
          style={{ ...s.tab, ...(activeTab === 'members' ? s.tabActive : {}) }}
          onClick={() => setActiveTab('members')}
        >
          Members
        </button>
        <button
          style={{ ...s.tab, ...(activeTab === 'info' ? s.tabActive : {}) }}
          onClick={() => setActiveTab('info')}
        >
          Channel Info
        </button>
      </div>

      {/* Members tab */}
      {activeTab === 'members' && (
        <div style={s.tabContent}>
          <div style={s.memberHeader}>
            Members — {members.length}
          </div>
          <div style={s.memberList}>
            {members.map(m => {
              const displayName = m.entityName ?? m.entityId.slice(0, 8)
              const isHovered = hoveredMember === m.entityId
              const isSelf = m.entityId === currentUserEntityId
              return (
                <div
                  key={m.entityId}
                  style={{ ...s.memberRow, ...(isHovered ? s.memberRowHover : {}) }}
                  onMouseEnter={() => setHoveredMember(m.entityId)}
                  onMouseLeave={() => setHoveredMember(null)}
                >
                  <span style={s.memberDot}>●</span>
                  <div style={s.memberInfo}>
                    <span style={s.memberName}>
                      {displayName}
                      {isSelf && <span style={s.selfTag}> (you)</span>}
                    </span>
                    <span style={{ ...s.roleBadge, ...getRoleBadgeStyle(m.role) }}>
                      {m.role}
                    </span>
                  </div>
                  {isHovered && !isSelf && (
                    <div style={s.memberActions}>
                      <button
                        style={s.actionBtn}
                        title={`DM ${displayName}`}
                        onClick={() => onDmUser(displayName)}
                      >
                        💬
                      </button>
                      <button
                        style={s.actionBtn}
                        title={`Set role for ${displayName}`}
                        onClick={() => onSetRole(m.entityId, displayName)}
                      >
                        🔑
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {members.length === 0 && (
              <p style={s.empty}>No members</p>
            )}
          </div>
        </div>
      )}

      {/* Channel Info tab */}
      {activeTab === 'info' && (
        <div style={s.tabContent}>
          {channel ? (
            <div style={s.infoBody}>
              <h3 style={s.channelName}># {channel.name}</h3>

              <div style={s.infoRow}>
                <span
                  style={{
                    ...s.typeBadge,
                    background: channel.type === 'CHANNEL'
                      ? 'rgba(108,143,255,0.15)'
                      : channel.type === 'DM'
                      ? 'rgba(128,90,213,0.15)'
                      : 'rgba(74,222,128,0.12)',
                    color: channel.type === 'CHANNEL'
                      ? 'var(--accent)'
                      : channel.type === 'DM'
                      ? '#a855f7'
                      : 'var(--success)',
                    border: `1px solid ${channel.type === 'CHANNEL'
                      ? 'rgba(108,143,255,0.3)'
                      : channel.type === 'DM'
                      ? 'rgba(128,90,213,0.3)'
                      : 'rgba(74,222,128,0.3)'}`,
                  }}
                >
                  {channel.type}
                </span>
                <span
                  style={{
                    ...s.visibilityBadge,
                    background: channel.isPublic ? 'rgba(74,222,128,0.1)' : 'rgba(255,92,92,0.1)',
                    color: channel.isPublic ? 'var(--success)' : 'var(--danger)',
                    border: `1px solid ${channel.isPublic ? 'rgba(74,222,128,0.25)' : 'rgba(255,92,92,0.25)'}`,
                  }}
                >
                  {channel.isPublic ? '🔓 Public' : '🔒 Private'}
                </span>
              </div>

              <div style={s.infoSection}>
                <span style={s.infoLabel}>Channel ID</span>
                <button style={s.copyRow} onClick={handleCopyId} title="Click to copy">
                  <code style={s.channelId}>{channel.id}</code>
                  <span style={s.copyHint}>{copiedId ? '✓ copied' : 'copy'}</span>
                </button>
              </div>

              {channel.description && (
                <div style={s.infoSection}>
                  <span style={s.infoLabel}>Description</span>
                  <p style={s.description}>{channel.description}</p>
                </div>
              )}

              <div style={s.infoSection}>
                <span style={s.infoLabel}>Members</span>
                <span style={s.infoValue}>{members.length}</span>
              </div>
            </div>
          ) : (
            <p style={s.empty}>No channel selected</p>
          )}
        </div>
      )}
    </aside>
  )
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    width: 200,
    minWidth: 170,
    background: 'var(--surface)',
    borderLeft: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '0.55rem 0.4rem',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
    letterSpacing: '0.02em',
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottomColor: 'var(--accent)',
  },
  tabContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  memberHeader: {
    padding: '0.6rem 0.85rem',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  memberList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0.3rem 0',
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.35rem 0.7rem',
    transition: 'background 0.1s',
    position: 'relative',
  },
  memberRowHover: {
    background: 'var(--surface-2)',
  },
  memberDot: {
    color: 'var(--success)',
    fontSize: '0.48rem',
    flexShrink: 0,
  },
  memberInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    overflow: 'hidden',
    flex: 1,
  },
  memberName: {
    fontSize: '0.83rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text)',
  },
  selfTag: {
    color: 'var(--text-muted)',
    fontWeight: 400,
    fontSize: '0.75rem',
  },
  roleBadge: {
    fontSize: '0.62rem',
    fontWeight: 600,
    padding: '0.05rem 0.3rem',
    borderRadius: 4,
    textTransform: 'capitalize',
    alignSelf: 'flex-start',
    letterSpacing: '0.02em',
  },
  memberActions: {
    display: 'flex',
    gap: '0.15rem',
    flexShrink: 0,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    padding: '0.15rem 0.2rem',
    cursor: 'pointer',
    fontSize: '0.8rem',
    borderRadius: 4,
    lineHeight: 1,
    opacity: 0.8,
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.8rem',
    padding: '0.75rem 0.85rem',
  },
  infoBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.85rem',
    padding: '0.85rem',
    overflowY: 'auto',
    flex: 1,
  },
  channelName: {
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '-0.01em',
  },
  infoRow: {
    display: 'flex',
    gap: '0.4rem',
    flexWrap: 'wrap',
  },
  typeBadge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '0.15rem 0.45rem',
    borderRadius: 4,
    letterSpacing: '0.05em',
  },
  visibilityBadge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '0.15rem 0.45rem',
    borderRadius: 4,
  },
  infoSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  infoLabel: {
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--text-muted)',
  },
  copyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '0.35rem 0.5rem',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  channelId: {
    fontFamily: 'monospace',
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  copyHint: {
    fontSize: '0.65rem',
    color: 'var(--accent)',
    flexShrink: 0,
    fontWeight: 600,
  },
  description: {
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  infoValue: {
    fontSize: '0.85rem',
    color: 'var(--text)',
    fontWeight: 500,
  },
}
