import { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, addDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { DocTemplate, DocGeneration } from '../types'

function templatesCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'docTemplates')
}

export type TemplateInput = Omit<DocTemplate, 'id' | 'createdAt' | 'createdBy'>

export function useTemplates(workspaceId: string | null) {
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) { setTemplates([]); setLoading(false); return }
    setLoading(true)
    const q = query(templatesCol(workspaceId), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocTemplate)))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [workspaceId])

  const add = useCallback(async (workspaceId: string, data: TemplateInput, uid: string) => {
    await addDoc(templatesCol(workspaceId), {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: uid,
    })
  }, [])

  const remove = useCallback(async (workspaceId: string, templateId: string) => {
    await deleteDoc(doc(templatesCol(workspaceId), templateId))
  }, [])

  return { templates, loading, add, remove }
}

export async function logDocGeneration(
  workspaceId: string,
  clientId: string,
  generation: Omit<DocGeneration, 'generatedAt'> & { generatedAt?: string },
) {
  const col = collection(db, 'workspaces', workspaceId, 'clienti', clientId, 'docGenerations')
  await addDoc(col, {
    ...generation,
    generatedAt: generation.generatedAt ?? new Date().toISOString(),
  })
}
