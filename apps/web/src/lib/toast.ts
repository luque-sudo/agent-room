export type ToastKind = 'info' | 'success' | 'error' | 'mention'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  duration?: number  // ms, default 3500
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners: Set<Listener> = new Set()

function notify() {
  listeners.forEach(l => l([...toasts]))
}

export function showToast(message: string, kind: ToastKind = 'info', duration = 3500): string {
  const id = Math.random().toString(36).slice(2)
  toasts = [...toasts, { id, kind, message, duration }]
  notify()
  setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id: string): void {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  fn([...toasts])
  return () => listeners.delete(fn)
}
