import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, limit, startAfter, getDocs, onSnapshot,
  serverTimestamp, deleteField, Timestamp,
} from 'firebase/firestore'
import type { QueryDocumentSnapshot, DocumentData, Unsubscribe } from 'firebase/firestore'
import { db } from './firebase'
import type { Sarcina, SarcinaInput, SarcinaStatus } from '../types'
import { startOfWeek } from './dateWeek'

const PAGE_SIZE = 100

function sarciniCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'sarcini')
}

function toSarcina(d: QueryDocumentSnapshot<DocumentData>): Sarcina {
  return { ...d.data(), id: d.id } as Sarcina
}

/**
 * Board-ul (Deschis/În lucru/Finalizat din săptămâna curentă) — live, prin
 * două subscripții onSnapshot merge-uite: task-urile active (fără limită de
 * dată) și cele finalizate în săptămâna curentă. Un card finalizat înainte
 * de săptămâna curentă dispare automat din listă (vezi useArchivedSarcini).
 */
export function useSarcini(workspaceId: string | null) {
  const [active, setActive] = useState<Sarcina[]>([])
  const [doneThisWeek, setDoneThisWeek] = useState<Sarcina[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive([]); setDoneThisWeek([]); setLoading(false)
      return
    }
    setLoading(true)
    let activeLoaded = false, doneLoaded = false
    const checkLoaded = () => { if (activeLoaded && doneLoaded) setLoading(false) }

    const unsubActive: Unsubscribe = onSnapshot(
      query(sarciniCol(workspaceId), where('status', 'in', ['deschis', 'in_lucru']), orderBy('order', 'asc')),
      snap => { setActive(snap.docs.map(toSarcina)); activeLoaded = true; checkLoaded() },
      () => { activeLoaded = true; checkLoaded() },
    )
    const weekStart = Timestamp.fromDate(startOfWeek())
    const unsubDone: Unsubscribe = onSnapshot(
      query(sarciniCol(workspaceId), where('status', '==', 'finalizat'), where('completedAt', '>=', weekStart), orderBy('completedAt', 'desc')),
      // arhivatManual filtrat client-side (nu în query) — o sarcină arhivată
      // devreme trebuie să dispară imediat de pe board, chiar dacă e încă în
      // săptămâna curentă după completedAt.
      snap => { setDoneThisWeek(snap.docs.map(toSarcina).filter(s => !s.arhivatManual)); doneLoaded = true; checkLoaded() },
      () => { doneLoaded = true; checkLoaded() },
    )
    return () => { unsubActive(); unsubDone() }
  }, [workspaceId])

  const sarcini = [...active, ...doneThisWeek]

  const add = useCallback(async (workspaceId: string, data: SarcinaInput, uid: string): Promise<string> => {
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v
    }
    delete payload.id
    delete payload.createdAt
    delete payload.createdBy
    payload.createdAt = serverTimestamp()
    payload.createdBy = uid
    // O sarcină creată direct cu Stare="Finalizat" (posibil din TaskModal, unde
    // select-ul de Stare e disponibil și la creare) are nevoie de completedAt
    // de la bun început — altfel n-ar apărea în niciun query (board-ul cere
    // fie status activ, fie completedAt recent), la fel ca la update().
    if (data.status === 'finalizat') payload.completedAt = serverTimestamp()
    const ref = await addDoc(sarciniCol(workspaceId), payload)
    return ref.id
  }, [])

  const update = useCallback(async (workspaceId: string, sarcinaId: string, data: Partial<SarcinaInput>) => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      patch[k] = v === undefined ? deleteField() : v
    }
    delete patch.id
    delete patch.createdAt
    delete patch.createdBy

    // Status schimbat din formular (TaskModal) — completedAt trebuie să
    // urmeze tranziția la fel ca la mutarea prin drag (moveSarcina), altfel
    // o sarcină marcată „Finalizat" din formular n-ar avea completedAt și
    // n-ar mai apărea în niciun query (board-ul cere fie status activ, fie
    // completedAt recent).
    if (data.status !== undefined) {
      const previous = sarcini.find(s => s.id === sarcinaId)
      if (previous && previous.status !== data.status) {
        patch.completedAt = data.status === 'finalizat' ? serverTimestamp() : deleteField()
      }
    }

    await updateDoc(doc(sarciniCol(workspaceId), sarcinaId), patch)
  }, [sarcini])

  const remove = useCallback(async (workspaceId: string, sarcinaId: string) => {
    await deleteDoc(doc(sarciniCol(workspaceId), sarcinaId))
  }, [])

  return { sarcini, loading, add, update, remove }
}

/** Sarcini finalizate înainte de săptămâna curentă — one-shot + paginare, ca
 * clienti.ts. `refreshKey` — incrementat de pagină după o arhivare/restaurare
 * reușită, ca noul item să apară fără reload (hook-ul nu e live). */
export function useArchivedSarcini(workspaceId: string | null, refreshKey = 0) {
  const [sarcini, setSarcini] = useState<Sarcina[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSarcini([]); setLoading(false); setHasMore(false); lastDocRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const weekStart = Timestamp.fromDate(startOfWeek())
    Promise.all([
      getDocs(query(
        sarciniCol(workspaceId),
        where('status', '==', 'finalizat'), where('completedAt', '<', weekStart),
        orderBy('completedAt', 'desc'), limit(PAGE_SIZE),
      )),
      // Arhivate manual devreme, încă în săptămâna curentă — nu apar în
      // query-ul de mai sus (completedAt >= weekStart), deci un al doilea
      // query mic, merge-uit și deduplicat după id.
      getDocs(query(
        sarciniCol(workspaceId),
        where('status', '==', 'finalizat'), where('arhivatManual', '==', true),
      )),
    ]).then(([naturalSnap, manualSnap]) => {
      if (cancelled) return
      const byId = new Map<string, Sarcina>()
      for (const s of naturalSnap.docs) byId.set(s.id, toSarcina(s))
      for (const s of manualSnap.docs) byId.set(s.id, toSarcina(s))
      setSarcini([...byId.values()])
      lastDocRef.current = naturalSnap.docs[naturalSnap.docs.length - 1] ?? null
      setHasMore(naturalSnap.docs.length === PAGE_SIZE)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, refreshKey])

  const loadMore = useCallback(async (workspaceId: string) => {
    if (!lastDocRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const weekStart = Timestamp.fromDate(startOfWeek())
      const q = query(
        sarciniCol(workspaceId),
        where('status', '==', 'finalizat'), where('completedAt', '<', weekStart),
        orderBy('completedAt', 'desc'), startAfter(lastDocRef.current), limit(PAGE_SIZE),
      )
      const snap = await getDocs(q)
      setSarcini(prev => {
        const ids = new Set(prev.map(s => s.id))
        return [...prev, ...snap.docs.map(toSarcina).filter(s => !ids.has(s.id))]
      })
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current
      setHasMore(snap.docs.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore])

  const search = useCallback(async (workspaceId: string, searchQuery: string): Promise<Sarcina[]> => {
    const q2 = searchQuery.trim().toLowerCase()
    if (!q2 || q2.length < 2) return []
    const weekStart = Timestamp.fromDate(startOfWeek())
    const q = query(
      sarciniCol(workspaceId),
      where('status', '==', 'finalizat'), where('completedAt', '<', weekStart),
      where('titluLower', '>=', q2), where('titluLower', '<=', q2 + ''),
      limit(50),
    )
    const snap = await getDocs(q)
    return snap.docs.map(toSarcina)
  }, [])

  /** Scoate o sarcină din arhivă, înapoi pe board — statusul țintă e ales de
   * utilizator (Deschis/În lucru), nu implicit, la fel ca la restoreDosar. */
  const restore = useCallback(async (workspaceId: string, sarcinaId: string, newStatus: SarcinaStatus, newOrder: number) => {
    await updateDoc(doc(sarciniCol(workspaceId), sarcinaId), {
      status: newStatus, order: newOrder, completedAt: deleteField(), arhivatManual: deleteField(),
    })
    setSarcini(prev => prev.filter(s => s.id !== sarcinaId))
  }, [])

  return { sarcini, loading, loadingMore, hasMore, loadMore, search, restore }
}

/** Arhivează o sarcină finalizată imediat, fără să aștepte finalul
 * săptămânii — vezi Sarcina.arhivatManual din types.ts. */
export async function archiveSarcinaNow(workspaceId: string, sarcinaId: string) {
  await updateDoc(doc(sarciniCol(workspaceId), sarcinaId), { arhivatManual: true })
}

/** Mută o sarcină spre un nou status — setează/șterge `completedAt` cu
 * serverTimestamp()/deleteField() după caz. Board-ul (onSnapshot) reflectă
 * mutarea automat; nu necesită și un apel local de stare. */
export async function moveSarcina(workspaceId: string, id: string, newStatus: SarcinaStatus, newOrder: number) {
  await updateDoc(doc(sarciniCol(workspaceId), id), {
    status: newStatus,
    order: newOrder,
    completedAt: newStatus === 'finalizat' ? serverTimestamp() : deleteField(),
  })
}

/** Re-spațiază `order` (index * 1000) pentru un set de sarcini din aceeași
 * coloană, după o reordonare prin drag — writeBatch, atomic. */
export async function reorderColumn(workspaceId: string, items: Sarcina[]) {
  const batch = writeBatch(db)
  items.forEach((item, i) => {
    batch.update(doc(sarciniCol(workspaceId), item.id), { order: i * 1000 })
  })
  await batch.commit()
}

/** Toate sarcinile legate de un dosar (orice status, active sau arhivate) —
 * sursa unică de adevăr pentru relația Dosar↔Sarcină (1:N), citită direct din
 * Sarcina.dosarId, nu dintr-un id singular ținut pe Dosar. */
export async function fetchSarciniByDosar(workspaceId: string, dosarId: string): Promise<Sarcina[]> {
  const q = query(sarciniCol(workspaceId), where('dosarId', '==', dosarId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(toSarcina)
}

/** Toate sarcinile legate de un client (orice status) — folosit de secțiunea
 * "Dosare & Sarcini" din fișa clientului. */
export async function fetchSarciniByClient(workspaceId: string, clientId: string): Promise<Sarcina[]> {
  const q = query(sarciniCol(workspaceId), where('clientId', '==', clientId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(toSarcina)
}
