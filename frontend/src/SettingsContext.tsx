import type { ReactNode } from 'react'
import { useSettings } from './lib/settings'
import { SettingsCtx } from './SettingsCtx'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  return <SettingsCtx.Provider value={settings}>{children}</SettingsCtx.Provider>
}
