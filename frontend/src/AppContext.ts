import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'
import type { useWorkspace } from './lib/workspace'
import type { FeatureKey } from './lib/features'
import type { BillingAccess } from './lib/billing'
import type { ToastItem, Workspace } from './types'

type WorkspaceReturn = ReturnType<typeof useWorkspace>

export interface AppContextType {
  user: User
  accessToken: string
  toast: (msg: string, type?: ToastItem['type'], opts?: Pick<ToastItem, 'onExpire' | 'action'>) => void
  activeWorkspace: Workspace | null
  userRole: 'admin' | 'member' | 'viewer' | null
  /** Feature flags ale workspace-ului activ — vezi lib/features.ts. */
  hasFeature: (key: FeatureKey) => boolean
  /** Starea abonamentului cabinetului activ (probă, abonament, acces gratuit, citire) — vezi lib/billing.ts. */
  billing: BillingAccess
  /** Poate crea/modifica date: rol admin/member ȘI acces complet (probă sau abonament valabil). */
  canEdit: boolean
  /** Rol de aplicație (nu de workspace) — vezi lib/superAdmin.ts. */
  isSuperAdmin: boolean
  workspaceCtx: WorkspaceReturn
}

export const AppCtx = createContext<AppContextType | null>(null)

export function useApp(): AppContextType {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppLayout')
  return ctx
}
