import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'
import type { useWorkspace } from './lib/workspace'
import type { ToastItem, Workspace } from './types'

type WorkspaceReturn = ReturnType<typeof useWorkspace>

export interface AppContextType {
  user: User
  accessToken: string
  toast: (msg: string, type?: ToastItem['type'], opts?: Pick<ToastItem, 'onExpire' | 'action'>) => void
  activeWorkspace: Workspace | null
  userRole: 'admin' | 'member' | null
  workspaceCtx: WorkspaceReturn
}

export const AppCtx = createContext<AppContextType | null>(null)

export function useApp(): AppContextType {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppLayout')
  return ctx
}
