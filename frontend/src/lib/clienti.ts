import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, deleteField,
} from 'firebase/firestore'
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import type { Client, Persoana } from '../types'

export type ClientInput = Omit<Client, 'id' | 'denumireLower' | 'createdAt' | 'createdBy'>

const PAGE_SIZE = 100

function resolveDisplayName(data: ClientInput): string {
  return data.denumire
}

function clientiCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'clienti')
}

/** Denumirea e identificator unic per workspace — verifică dacă mai există un client cu aceeași denumire. */
export async function denumireExists(workspaceId: string, denumire: string, excludeId?: string): Promise<boolean> {
  const lower = denumire.trim().toLowerCase()
  if (!lower) return false
  const q = query(clientiCol(workspaceId), where('denumireLower', '==', lower), limit(5))
  const snap = await getDocs(q)
  return snap.docs.some(d => d.id !== excludeId)
}

export function useClienti(workspaceId: string | null) {
  const [clienti, setClienti] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setClienti([]); setLoading(false); setHasMore(false); lastDocRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const q = query(clientiCol(workspaceId), orderBy('createdAt', 'desc'), limit(PAGE_SIZE))
    getDocs(q).then(snap => {
      if (cancelled) return
      setClienti(snap.docs.map(d => ({ ...d.data(), id: d.id } as Client)))
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null
      setHasMore(snap.docs.length === PAGE_SIZE)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId])

  /** Încarcă următoarea pagină de clienți (cursor-based) și o adaugă la lista curentă. */
  const loadMore = useCallback(async (workspaceId: string) => {
    if (!lastDocRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const q = query(
        clientiCol(workspaceId), orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current), limit(PAGE_SIZE)
      )
      const snap = await getDocs(q)
      setClienti(prev => [...prev, ...snap.docs.map(d => ({ ...d.data(), id: d.id } as Client))])
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current
      setHasMore(snap.docs.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore])

  const search = useCallback(async (workspaceId: string, searchQuery: string): Promise<Client[]> => {
    const q2 = searchQuery.trim().toLowerCase()
    if (!q2 || q2.length < 2) return []
    const q = query(
      clientiCol(workspaceId),
      where('denumireLower', '>=', q2),
      where('denumireLower', '<=', q2 + '\uf8ff'),
      limit(50)
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as Client))
  }, [])

  const add = useCallback(async (workspaceId: string, data: ClientInput, uid: string) => {
    const displayName = resolveDisplayName(data)
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v
    }
    // Apărare împotriva unui apelant care trimite din greșeală un Client complet
    // (cu id/createdAt/createdBy proprii) în loc de ClientInput — acele câmpuri
    // nu trebuie stocate niciodată ca date în document, doar derivate mai jos.
    delete payload.id
    delete payload.createdAt
    delete payload.createdBy
    payload.denumire = displayName
    payload.denumireLower = displayName.toLowerCase()
    payload.createdAt = serverTimestamp()
    payload.createdBy = uid
    const ref = await addDoc(clientiCol(workspaceId), payload)
    setClienti(prev => [{ ...(payload as unknown as Client), id: ref.id, createdAt: new Date().toISOString() }, ...prev])
  }, [])

  const update = useCallback(async (workspaceId: string, clientId: string, data: Partial<ClientInput>) => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      patch[k] = v === undefined ? deleteField() : v
    }
    // Vezi comentariul din add() — un apelant nu trebuie să poată suprascrie
    // identitatea documentului cu date arbitrare.
    delete patch.id
    delete patch.createdAt
    delete patch.createdBy
    if (data.denumire !== undefined || data.titular !== undefined || data.tipClient !== undefined) {
      const displayName = resolveDisplayName({ ...EMPTY_CLIENT, ...data } as ClientInput)
      patch.denumire = displayName
      patch.denumireLower = displayName.toLowerCase()
    }
    await updateDoc(doc(clientiCol(workspaceId), clientId), patch)
    setClienti(prev => prev.map(c => c.id === clientId ? { ...c, ...(data as Partial<Client>) } : c))
  }, [])

  const remove = useCallback(async (workspaceId: string, clientId: string) => {
    await deleteDoc(doc(clientiCol(workspaceId), clientId))
    setClienti(prev => prev.filter(c => c.id !== clientId))
  }, [])

  return { clienti, loading, loadingMore, hasMore, loadMore, search, add, update, remove }
}

export const EMPTY_PERSOANA: Persoana = {
  calitate: '', cotaParticipare: '',
  cnp: '', nume: '', prenume: '', serie_numar: '',
  data_nasterii: '', locul_nasterii: '', cetatenia: '',
  adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
}

export const EMPTY_CLIENT: ClientInput = {
  tipClient: 'PJ',
  subtipPF: undefined,
  titular: undefined,
  membriIF: undefined,
  denumire: '', formaJuridica: '', codFiscal: '', nrRegistrul: '',
  sediuSocial: '', caenCod: '', caenDescriere: '', caenSecundare: [], telefon: '', email: '',
  statutFiscal: '', platitorTva: false, periodaTva: '',
  tvaLaIncasare: false, inactivAnaf: false, splitTva: false, eFactura: false,
  administratoriAnaf: [],
  plafonTvaAnual: null, regimFiscal: '',
  nrSalariati: null, capitalSocial: null, anFiscal: '',
  dataAnafActualizat: null, notite: '',
  asociati: [], administratori: [],
}
