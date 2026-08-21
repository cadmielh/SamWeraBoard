import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type FontKey = 'inter' | 'manrope' | 'jakarta' | 'system'

export const FONT_OPTIONS: { key: FontKey; label: string; stack: string }[] = [
  { key: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  { key: 'manrope', label: 'Manrope', stack: "'Manrope', system-ui, sans-serif" },
  { key: 'jakarta', label: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { key: 'system', label: 'Sistem', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
]

const THEME_KEY = 'swb_theme'
const FONT_KEY = 'swb_font'

function readTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function readFont(): FontKey {
  const v = localStorage.getItem(FONT_KEY)
  return FONT_OPTIONS.some(f => f.key === v) ? (v as FontKey) : 'inter'
}

function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

export function useSettings() {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [font, setFontState] = useState<FontKey>(readFont)
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const resolvedTheme = resolveTheme(theme, systemPrefersDark)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const stack = FONT_OPTIONS.find(f => f.key === font)?.stack ?? FONT_OPTIONS[0].stack
    document.documentElement.style.setProperty('--font', stack)
  }, [font])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
  }

  const setFont = (f: FontKey) => {
    setFontState(f)
    localStorage.setItem(FONT_KEY, f)
  }

  return { theme, resolvedTheme, setTheme, font, setFont }
}
