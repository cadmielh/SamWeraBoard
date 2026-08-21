import { createContext, useContext } from 'react'
import type { FontKey, ResolvedTheme, Theme } from './lib/settings'

export interface SettingsContextType {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme) => void
  font: FontKey
  setFont: (f: FontKey) => void
}

export const SettingsCtx = createContext<SettingsContextType | null>(null)

export function useSettingsCtx(): SettingsContextType {
  const ctx = useContext(SettingsCtx)
  if (!ctx) throw new Error('useSettingsCtx must be used inside SettingsProvider')
  return ctx
}
