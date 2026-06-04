'use client'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('theme') as Theme) ?? 'dark'
}

export function setTheme(theme: Theme) {
  localStorage.setItem('theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
}

export function toggleTheme(): Theme {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
