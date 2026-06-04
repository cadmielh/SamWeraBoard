import { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, addDoc, deleteField, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Workspace, WorkspaceMember } from '../types'

function encodeEmail(email: string) {
  return email.replace(/\./g, '_DOT_').replace(/@/g, '_AT_')
}

export function useWorkspace(uid: string | null) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  const loadWorkspaces = useCallback(async () => {
    if (!uid) { setWorkspaces([]); setActiveWorkspaceState(null); setLoading(false); return }
    setLoading(true)
    try {
      const q = query(collection(db, 'workspaces'), where(`members.${uid}.role`, 'in', ['admin', 'member']))
      const snap = await getDocs(q)
      const list: Workspace[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Workspace))
      setWorkspaces(list)

      const userDoc = await getDoc(doc(db, 'users', uid))
      const activeId = userDoc.data()?.activeWorkspaceId as string | undefined
      const active = list.find(w => w.id === activeId) ?? list[0] ?? null
      setActiveWorkspaceState(active)
    } catch (e) {
      console.error('useWorkspace load error', e)
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => { void loadWorkspaces() }, [loadWorkspaces])

  const setActiveWorkspace = useCallback(async (workspace: Workspace) => {
    setActiveWorkspaceState(workspace)
    if (uid) {
      await setDoc(doc(db, 'users', uid), { activeWorkspaceId: workspace.id }, { merge: true })
    }
  }, [uid])

  const createWorkspace = useCallback(async (name: string, user: { uid: string; email: string; displayName: string }) => {
    const member: WorkspaceMember = {
      role: 'admin',
      email: user.email,
      displayName: user.displayName,
      addedAt: null,
    }
    const ref = await addDoc(collection(db, 'workspaces'), {
      name,
      ownerId: user.uid,
      members: { [user.uid]: { ...member, addedAt: serverTimestamp() } },
      createdAt: serverTimestamp(),
    })
    await setDoc(doc(db, 'users', user.uid), { activeWorkspaceId: ref.id }, { merge: true })
    await loadWorkspaces()
    return ref.id
  }, [loadWorkspaces])

  const inviteMember = useCallback(async (workspaceId: string, email: string, role: 'admin' | 'member', workspaceName: string, invitedByUid: string) => {
    const encoded = encodeEmail(email)
    await setDoc(doc(db, 'invitations', encoded), {
      workspaceId,
      workspaceName,
      role,
      invitedBy: invitedByUid,
      invitedAt: serverTimestamp(),
    })
  }, [])

  const removeMember = useCallback(async (workspaceId: string, memberUid: string) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), {
      [`members.${memberUid}`]: deleteField(),
    })
    await loadWorkspaces()
  }, [loadWorkspaces])

  const changeMemberRole = useCallback(async (workspaceId: string, memberUid: string, role: 'admin' | 'member') => {
    await updateDoc(doc(db, 'workspaces', workspaceId), {
      [`members.${memberUid}.role`]: role,
    })
    await loadWorkspaces()
  }, [loadWorkspaces])

  const renameWorkspace = useCallback(async (workspaceId: string, newName: string) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), { name: newName })
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, name: newName } : w))
    setActiveWorkspaceState(prev => prev?.id === workspaceId ? { ...prev, name: newName } : prev)
  }, [])

  const checkAndJoinInvitations = useCallback(async (user: { uid: string; email: string; displayName: string }) => {
    const encoded = encodeEmail(user.email)
    const invRef = doc(db, 'invitations', encoded)
    const invSnap = await getDoc(invRef)
    if (!invSnap.exists()) return
    const inv = invSnap.data()
    const member: WorkspaceMember = {
      role: inv.role,
      email: user.email,
      displayName: user.displayName,
      addedAt: null,
    }
    await updateDoc(doc(db, 'workspaces', inv.workspaceId), {
      [`members.${user.uid}`]: { ...member, addedAt: serverTimestamp() },
    })
    // Delete invitation
    await setDoc(invRef, { used: true }, { merge: true })
    await loadWorkspaces()
  }, [loadWorkspaces])

  return {
    workspaces,
    activeWorkspace,
    loading,
    setActiveWorkspace,
    createWorkspace,
    inviteMember,
    removeMember,
    changeMemberRole,
    renameWorkspace,
    checkAndJoinInvitations,
    reload: loadWorkspaces,
  }
}
