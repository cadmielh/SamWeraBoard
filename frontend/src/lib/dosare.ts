import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, deleteField, Timestamp,
} from 'firebase/firestore'
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import type { Dosar, DosarInput, StadiuDosar } from '../types'
import { startOfWeek } from './dateWeek'

const PAGE_SIZE = 100

/** Singurul stadiu care declanșează arhivarea (decizie explicită — nu și
 * 'dosar_eliberat', deși ambele sunt în STADII_DOSAR_FINALE). */
const TRIGGER_STADIU: StadiuDosar = 'documente_predate_client'

function dosareCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'dosare')
}

/** Determină dacă o schimbare de stadiu intră/iese din TRIGGER_STADIU —
 * folosit pentru a ști când să pornească/oprească ceasul săptămânii de
 * arhivare (documentePredateAt) în useDosare().update(). */
function stadiuTransition(prevStadiu: StadiuDosar | undefined, nextStadiu: StadiuDosar | undefined): 'enter' | 'leave' | 'none' {
  if (nextStadiu === undefined || nextStadiu === prevStadiu) return 'none'
  if (nextStadiu === TRIGGER_STADIU) return 'enter'
  if (prevStadiu === TRIGGER_STADIU) return 'leave'
  return 'none'
}

export function useDosare(workspaceId: string | null) {
  const [dosare, setDosare] = useState<Dosar[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDosare([]); setLoading(false); setHasMore(false); lastDocRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const q = query(dosareCol(workspaceId), orderBy('createdAt', 'desc'), limit(PAGE_SIZE))
    getDocs(q).then(snap => {
      if (cancelled) return
      setDosare(snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar)))
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null
      setHasMore(snap.docs.length === PAGE_SIZE)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId])

  /** Încarcă următoarea pagină de dosare (cursor-based) și o adaugă la lista curentă. */
  const loadMore = useCallback(async (workspaceId: string) => {
    if (!lastDocRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const q = query(
        dosareCol(workspaceId), orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current), limit(PAGE_SIZE)
      )
      const snap = await getDocs(q)
      setDosare(prev => [...prev, ...snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar))])
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current
      setHasMore(snap.docs.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore])

  // Nu există search() server-side aici, spre deosebire de clienti.ts:
  // DosarTable e un tabel simplu, nevirtualizat (volum modest — vezi plan),
  // iar filtrarea pe client/obiectul cererii se face client-side, direct în
  // DosarePage, peste pagina curentă de `dosare` deja încărcată.

  // add/update/remove sunt optimiste, la fel ca în clienti.ts — starea locală
  // se actualizează sincron, scrierea Firestore urmează pe fundal, cu rollback
  // la eroare. add() diferă de precedentul din clienti.ts: întoarce id-ul real
  // al documentului, necesar imediat cât timp se leagă o Sarcină nou-creată.
  const add = useCallback(async (workspaceId: string, data: DosarInput, uid: string): Promise<string> => {
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payload[k] = v
    }
    delete payload.id
    delete payload.createdAt
    delete payload.createdBy
    payload.createdAt = serverTimestamp()
    payload.createdBy = uid

    // Un dosar creat direct în TRIGGER_STADIU (rar, dar posibil — ex. import
    // istoric) tot trebuie să pornească ceasul săptămânii de arhivare.
    const localCreatedExtra: Partial<Dosar> = data.stadiu === TRIGGER_STADIU
      ? { documentePredateAt: new Date().toISOString() } : {}
    if (data.stadiu === TRIGGER_STADIU) payload.documentePredateAt = serverTimestamp()

    const tempId = `temp-${crypto.randomUUID()}`
    setDosare(prev => [{ ...(payload as unknown as Dosar), id: tempId, createdAt: new Date().toISOString(), ...localCreatedExtra }, ...prev])
    try {
      const ref = await addDoc(dosareCol(workspaceId), payload)
      setDosare(prev => prev.map(d => d.id === tempId ? { ...d, id: ref.id } : d))
      return ref.id
    } catch (err) {
      setDosare(prev => prev.filter(d => d.id !== tempId))
      throw err
    }
  }, [])

  const update = useCallback(async (workspaceId: string, dosarId: string, data: Partial<DosarInput>) => {
    let previous: Dosar | undefined
    setDosare(prev => prev.map(d => {
      if (d.id !== dosarId) return d
      previous = d
      const transition = stadiuTransition(d.stadiu, data.stadiu)
      const localExtras: Partial<Dosar> = transition === 'enter'
        ? { documentePredateAt: new Date().toISOString() }
        : transition === 'leave'
          ? { documentePredateAt: null, arhivatManual: undefined }
          : {}
      return { ...d, ...(data as Partial<Dosar>), ...localExtras }
    }))

    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      patch[k] = v === undefined ? deleteField() : v
    }
    delete patch.id
    delete patch.createdAt
    delete patch.createdBy

    // documentePredateAt pornește/oprește ceasul săptămânii de arhivare —
    // stampat aici, centralizat, ca să nu depindă de fiecare punct din UI
    // care schimbă stadiul (DosarView, DosarModal) să-l seteze corect.
    const transition = stadiuTransition(previous?.stadiu, data.stadiu)
    if (transition === 'enter') {
      patch.documentePredateAt = serverTimestamp()
    } else if (transition === 'leave') {
      patch.documentePredateAt = deleteField()
      patch.arhivatManual = deleteField()
    }

    try {
      await updateDoc(doc(dosareCol(workspaceId), dosarId), patch)
    } catch (err) {
      if (previous) { const p = previous; setDosare(prev => prev.map(d => d.id === dosarId ? p : d)) }
      throw err
    }
  }, [])

  const remove = useCallback(async (workspaceId: string, dosarId: string) => {
    let removed: Dosar | undefined
    let removedAt = -1
    setDosare(prev => {
      const idx = prev.findIndex(d => d.id === dosarId)
      if (idx === -1) return prev
      removed = prev[idx]
      removedAt = idx
      return prev.filter(d => d.id !== dosarId)
    })
    try {
      await deleteDoc(doc(dosareCol(workspaceId), dosarId))
    } catch (err) {
      if (removed) {
        const r = removed
        setDosare(prev => {
          const next = [...prev]
          next.splice(Math.min(removedAt, next.length), 0, r)
          return next
        })
      }
      throw err
    }
  }, [])

  return { dosare, loading, loadingMore, hasMore, loadMore, add, update, remove }
}

/** Dosare create în intervalul [start, end), pe baza `createdAt` — corespunde
 * modului real de completare a registrului (un rând intră în ziua deschiderii
 * dosarului), spre deosebire de `dataAdmiterii`, adesea gol cât timp dosarul
 * e "În lucru". Folosit de DosarStatsPanel (lunar sau grupat pe trimestre). */
export async function fetchDosareByRange(workspaceId: string, start: Date, end: Date): Promise<Dosar[]> {
  const q = query(
    dosareCol(workspaceId),
    where('createdAt', '>=', Timestamp.fromDate(start)),
    where('createdAt', '<', Timestamp.fromDate(end)),
    orderBy('createdAt', 'asc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar))
}

/** Dosare create în luna `month0` (0-indexat) a anului `year`. */
export async function fetchDosareByMonth(workspaceId: string, year: number, month0: number): Promise<Dosar[]> {
  return fetchDosareByRange(workspaceId, new Date(year, month0, 1), new Date(year, month0 + 1, 1))
}

/** Toate dosarele înregistrate vreodată — pentru statisticile „Overall" din
 * header (fără comparație cu perioada anterioară, care nu are sens aici). */
export async function fetchAllDosare(workspaceId: string): Promise<Dosar[]> {
  const snap = await getDocs(dosareCol(workspaceId))
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar))
}

/** Toate dosarele legate de un client — folosit de secțiunea "Dosare & Sarcini"
 * din fișa clientului. */
export async function fetchDosareByClient(workspaceId: string, clientId: string): Promise<Dosar[]> {
  const q = query(dosareCol(workspaceId), where('clientId', '==', clientId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar))
}

/** Un singur dosar, după id — folosit de board-ul de Sarcini pentru a verifica
 * stadiul curent al dosarului unei sarcini tocmai finalizate (fără a instanția
 * hook-ul complet, paginat, `useDosare`, doar pentru o singură citire). */
export async function fetchDosarById(workspaceId: string, dosarId: string): Promise<Dosar | null> {
  const snap = await getDoc(doc(dosareCol(workspaceId), dosarId))
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as Dosar) : null
}

/** Actualizează doar stadiul unui dosar — scriere minimă, folosită de sugestia
 * "toate sarcinile finalizate → marchezi dosarul ca eliberat?" declanșată din
 * board-ul de Sarcini. Stampează/șterge documentePredateAt necondiționat pe
 * baza stadiului țintă — acceptabil aici (flux declanșat o singură dată per
 * tranziție), spre deosebire de update() din useDosare, care compară cu
 * stadiul anterior ca să nu reseteze ceasul la resalvări redundante. */
export async function updateDosarStadiu(workspaceId: string, dosarId: string, stadiu: StadiuDosar) {
  const patch: Record<string, unknown> = { stadiu }
  if (stadiu === TRIGGER_STADIU) {
    patch.documentePredateAt = serverTimestamp()
  } else {
    patch.documentePredateAt = deleteField()
    patch.arhivatManual = deleteField()
  }
  await updateDoc(doc(dosareCol(workspaceId), dosarId), patch)
}

/** Arhivează un dosar imediat, fără să aștepte finalul săptămânii — vezi
 * regula de arhivare din types.ts (Dosar.arhivatManual). Fără efect vizibil
 * dacă dosarul nu e deja în TRIGGER_STADIU (UI-ul nu ar trebui să ofere
 * acțiunea în afara acelui caz). */
export async function archiveDosarNow(workspaceId: string, dosarId: string) {
  await updateDoc(doc(dosareCol(workspaceId), dosarId), { arhivatManual: true })
}

/** Scoate un dosar din arhivă cu stadiul ales de utilizator — niciodată
 * implicit TRIGGER_STADIU, ca să nu reintre imediat în arhivă la următoarea
 * evaluare a regulii. */
export async function restoreDosar(workspaceId: string, dosarId: string, newStadiu: StadiuDosar) {
  await updateDoc(doc(dosareCol(workspaceId), dosarId), {
    stadiu: newStadiu,
    documentePredateAt: deleteField(),
    arhivatManual: deleteField(),
  })
}

/** Dosare arhivate — stadiu === TRIGGER_STADIU și (arhivatManual === true SAU
 * documentePredateAt < startOfWeek()). Two-query merge (una paginată pentru
 * arhivarea naturală săptămânală, una mică pentru cele arhivate manual încă
 * în săptămâna curentă), deduplicate după id — pattern identic cu
 * useArchivedSarcini din lib/sarcini.ts. `refreshKey` — one-shot, nu live
 * (onSnapshot); paginile de mai sus îl incrementează după o arhivare/
 * restaurare reușită, ca noul item să apară fără reload de pagină. */
export function useArchivedDosare(workspaceId: string | null, refreshKey = 0) {
  const [dosare, setDosare] = useState<Dosar[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDosare([]); setLoading(false); setHasMore(false); lastDocRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const weekStart = Timestamp.fromDate(startOfWeek())
    Promise.all([
      getDocs(query(
        dosareCol(workspaceId), where('stadiu', '==', TRIGGER_STADIU),
        where('documentePredateAt', '<', weekStart),
        orderBy('documentePredateAt', 'desc'), limit(PAGE_SIZE),
      )),
      getDocs(query(
        dosareCol(workspaceId), where('stadiu', '==', TRIGGER_STADIU),
        where('arhivatManual', '==', true),
      )),
    ]).then(([naturalSnap, manualSnap]) => {
      if (cancelled) return
      const byId = new Map<string, Dosar>()
      for (const d of naturalSnap.docs) byId.set(d.id, { ...d.data(), id: d.id } as Dosar)
      for (const d of manualSnap.docs) byId.set(d.id, { ...d.data(), id: d.id } as Dosar)
      setDosare([...byId.values()])
      lastDocRef.current = naturalSnap.docs[naturalSnap.docs.length - 1] ?? null
      setHasMore(naturalSnap.docs.length === PAGE_SIZE)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, refreshKey])

  const loadMore = useCallback(async (wid: string) => {
    if (!lastDocRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const snap = await getDocs(query(
        dosareCol(wid), where('stadiu', '==', TRIGGER_STADIU),
        where('documentePredateAt', '<', Timestamp.fromDate(startOfWeek())),
        orderBy('documentePredateAt', 'desc'), startAfter(lastDocRef.current), limit(PAGE_SIZE),
      ))
      setDosare(prev => {
        const ids = new Set(prev.map(d => d.id))
        return [...prev, ...snap.docs.map(d => ({ ...d.data(), id: d.id } as Dosar)).filter(d => !ids.has(d.id))]
      })
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current
      setHasMore(snap.docs.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore])

  return { dosare, loading, loadingMore, hasMore, loadMore }
}
