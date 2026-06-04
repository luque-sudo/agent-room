'use client'

import { useEffect, useState } from 'react'
import { subscribeToasts, dismissToast, type Toast } from '@/lib/toast'

const kindStyles: Record<string, React.CSSProperties> = {
  info:    { background: 'var(--surface-2)', borderLeft: '3px solid var(--accent)' },
  success: { background: 'var(--surface-2)', borderLeft: '3px solid var(--success)' },
  error:   { background: 'var(--surface-2)', borderLeft: '3px solid var(--danger)' },
  mention: { background: 'var(--surface-2)', borderLeft: '3px solid #d69e2e' },
}

const kindIcon: Record<string, string> = {
  info: 'ℹ️', success: '✓', error: '✗', mention: '🔔',
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    return subscribeToasts(setToasts)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      zIndex: 1000, maxWidth: 320,
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          className="animate-toastIn"
          style={{
            ...kindStyles[t.kind],
            padding: '0.7rem 1rem',
            borderRadius: 10,
            border: '1px solid var(--border)',
            boxShadow: '0 4px 16px #0003',
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            color: 'var(--text)',
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
          onClick={() => dismissToast(t.id)}
          title="Click to dismiss"
        >
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>{kindIcon[t.kind]}</span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={e => { e.stopPropagation(); dismissToast(t.id) }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}
          >✕</button>
        </div>
      ))}
    </div>
  )
}
