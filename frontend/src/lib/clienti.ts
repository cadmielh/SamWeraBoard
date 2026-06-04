import { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, getDocs, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Client, Persoana } from '../types'

export type ClientInput = Omit<Client, 'id' | 'denumireLower' | 'createdAt' | 'createdBy'>

function clientiCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'clienti')
}

export function useClienti(workspaceId: string | null) {
  const [clienti, setClienti] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) { setClienti([]); setLoading(false); return }
    setLoading(true)
    const q = query(clientiCol(workspaceId), orderBy('createdAt', 'desc'), limit(100))
    const unsub = onSnapshot(q, snap => {
      setClienti(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [workspaceId])

  const search = useCallback(async (workspaceId: string, searchQuery: string): Promise<Client[]> => {
    const q2 = searchQuery.trim().toLowerCase()
    if (!q2 || q2.length < 2) return []
    const q = query(
      clientiCol(workspaceId),
      where('denumireLower', '>=', q2),
      where('denumireLower', '<=', q2 + ''),
      limit(50)
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Client))
  }, [])

  const add = useCallback(async (workspaceId: string, data: ClientInput, uid: string) => {
    await addDoc(clientiCol(workspaceId), {
      ...data,
      denumireLower: data.denumire.toLowerCase(),
      createdAt: serverTimestamp(),
      createdBy: uid,
    })
  }, [])

  const update = useCallback(async (workspaceId: string, clientId: string, data: Partial<ClientInput>) => {
    const patch: Record<string, unknown> = { ...data }
    if (data.denumire !== undefined) patch.denumireLower = data.denumire.toLowerCase()
    await updateDoc(doc(clientiCol(workspaceId), clientId), patch)
  }, [])

  const remove = useCallback(async (workspaceId: string, clientId: string) => {
    await deleteDoc(doc(clientiCol(workspaceId), clientId))
  }, [])

  return { clienti, loading, search, add, update, remove }
}

export const EMPTY_PERSOANA: Persoana = {
  calitate: '', cotaParticipare: '',
  cnp: '', nume: '', prenume: '', serie_numar: '',
  data_nasterii: '', locul_nasterii: '', cetatenia: '',
  adresa: '', judet: '', emisa_de: '', valabila_pana_la: '',
}

export const EMPTY_CLIENT: ClientInput = {
  denumire: '', formaJuridica: '', codFiscal: '', nrRegistrul: '',
  sediuSocial: '', caenCod: '', caenDescriere: '', telefon: '', email: '',
  statutFiscal: '', platitorTva: false, periodaTva: '',
  dataAnafActualizat: null, notite: '',
  asociati: [], administratori: [],
}
