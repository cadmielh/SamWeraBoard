import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, setDoc, updateDoc,
  query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, deleteField,
} from 'firebase/firestore'
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import type { Client, Persoana } from '../types'
import { EMPTY_ADRESA, formatAdresa, parseAdresa, type AdresaStructurata } from './adresa'
import { sanitizeForSave, savePii, deleteClientOnServer } from './pii'

export type ClientInput = Omit<Client, 'id' | 'denumireLower' | 'createdAt' | 'createdBy'>

const PAGE_SIZE = 100

/** Câmpurile de societate obligatorii pentru generarea documentelor — folosit
 * atât de ClientModal (creare/editare client), cât și de MultiPersonPreview
 * (societate nouă din acte scanate), ca lista de câmpuri lipsă afișată
 * utilizatorului să nu diveargă între cele două fluxuri. */
export function missingCompanyFields(data: {
  codFiscal: string
  formaJuridica: string
  nrRegistrul: string
  sediuSocial: AdresaStructurata
  capitalSocial: number | null
}): string[] {
  const cif = data.codFiscal.trim()
  const missing: string[] = []
  if (!cif || !/^(RO)?\d{2,10}$/i.test(cif)) missing.push('CIF')
  if (!data.formaJuridica.trim()) missing.push('forma juridică')
  if (!data.nrRegistrul.trim()) missing.push('nr. registrul comerțului')
  if (!formatAdresa(data.sediuSocial).trim()) missing.push('sediul social')
  if (data.capitalSocial == null || data.capitalSocial <= 0) missing.push('capitalul social')
  return missing
}

/** Migrare la citire: documentele vechi au `sediuSocial` ca text liber —
 * transformat best-effort în componente structurate, fără să scrie nimic
 * înapoi în Firestore (persistă abia la următorul `update`/`add`). Textul
 * original e întors separat (`legacyRaw`), nu atașat pe `Client` — altfel ar
 * ajunge, din greșeală, în payload-ul de `updateDoc` (Firestore aruncă eroare
 * la scrierea unui câmp cu valoare `undefined` pentru clienții deja migrați). */
function clientFromDoc(d: QueryDocumentSnapshot<DocumentData>): { client: Client; legacyRaw: string | null } {
  const raw = d.data() as Record<string, unknown>
  const rawSediu = raw.sediuSocial
  const legacyRaw = typeof rawSediu === 'string' ? rawSediu : null
  const sediuSocial: AdresaStructurata = legacyRaw
    ? parseAdresa(legacyRaw)
    : (rawSediu as AdresaStructurata | undefined) ?? { ...EMPTY_ADRESA }
  return { client: { ...raw, id: d.id, sediuSocial } as Client, legacyRaw }
}

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
  // Ultima listă de clienți, pentru a afla persoanele existente la salvare (vezi sanitizeForSave).
  const clientiRef = useRef<Client[]>([])
  useEffect(() => { clientiRef.current = clienti }, [clienti])
  // Textul original al sediului social pentru clienții încă nemigrați (format
  // vechi, string) — folosit doar pentru banner-ul de comparație din
  // ClientModal, ținut separat de `clienti` (vezi clientFromDoc).
  const [legacyRawById, setLegacyRawById] = useState<Record<string, string>>({})
  const mergeLegacyRaw = (rows: { client: Client; legacyRaw: string | null }[]) => {
    const additions = rows.filter((r): r is { client: Client; legacyRaw: string } => r.legacyRaw !== null)
    if (additions.length === 0) return
    setLegacyRawById(prev => {
      const next = { ...prev }
      for (const { client, legacyRaw } of additions) next[client.id] = legacyRaw
      return next
    })
  }

  useEffect(() => {
    if (!workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClienti([]); setLoading(false); setHasMore(false); lastDocRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const q = query(clientiCol(workspaceId), orderBy('createdAt', 'desc'), limit(PAGE_SIZE))
    getDocs(q).then(snap => {
      if (cancelled) return
      const rows = snap.docs.map(clientFromDoc)
      setClienti(rows.map(r => r.client))
      mergeLegacyRaw(rows)
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
      const rows = snap.docs.map(clientFromDoc)
      setClienti(prev => [...prev, ...rows.map(r => r.client)])
      mergeLegacyRaw(rows)
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
    const rows = snap.docs.map(clientFromDoc)
    mergeLegacyRaw(rows)
    return rows.map(r => r.client)
  }, [])

  // add/update/remove sunt optimiste: starea locală (deci ecranul) se
  // actualizează sincron, înainte de scrierea reală în Firestore — userul
  // vede efectul instant, fără să aștepte răspunsul rețelei. Dacă scrierea
  // eșuează, modificarea locală se anulează și eroarea e retrimisă mai
  // departe (apelantul își păstrează exact același catch/toast ca înainte).
  const add = useCallback(async (workspaceId: string, rawData: ClientInput, uid: string) => {
    // CNP/serie CI nu ajung în documentul Firestore: se separă și se trimit criptate
    // către vault (vezi lib/pii.ts); în document rămân doar `pid` și variantele mascate.
    const { data, vault } = sanitizeForSave(rawData, null)
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

    const ref = doc(clientiCol(workspaceId))
    const tempId = `temp-${crypto.randomUUID()}`
    setClienti(prev => [{ ...(payload as unknown as Client), id: tempId, createdAt: new Date().toISOString() }, ...prev])
    try {
      // Vault întâi: dacă scrierea documentului eșuează, rămâne cel mult o înregistrare
      // criptată orfană (inaccesibilă), niciodată un document fără datele lui sensibile.
      if (vault) await savePii(ref.id, vault)
      await setDoc(ref, payload)
      setClienti(prev => prev.map(c => c.id === tempId ? { ...c, id: ref.id } : c))
    } catch (err) {
      setClienti(prev => prev.filter(c => c.id !== tempId))
      throw err
    }
  }, [])

  const update = useCallback(async (workspaceId: string, clientId: string, rawData: Partial<ClientInput>) => {
    const existing = clientiRef.current.find(c => c.id === clientId) ?? null
    const { data, vault } = sanitizeForSave(rawData, existing)
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

    let previous: Client | undefined
    setClienti(prev => prev.map(c => {
      if (c.id !== clientId) return c
      previous = c
      return { ...c, ...(data as Partial<Client>) }
    }))
    try {
      if (vault) await savePii(clientId, vault)
      await updateDoc(doc(clientiCol(workspaceId), clientId), patch)
    } catch (err) {
      if (previous) { const p = previous; setClienti(prev => prev.map(c => c.id === clientId ? p : c)) }
      throw err
    }
  }, [])

  const remove = useCallback(async (_workspaceId: string, clientId: string) => {
    let removed: Client | undefined
    let removedAt = -1
    setClienti(prev => {
      const idx = prev.findIndex(c => c.id === clientId)
      if (idx === -1) return prev
      removed = prev[idx]
      removedAt = idx
      return prev.filter(c => c.id !== clientId)
    })
    try {
      // Ștergerea trece prin API: șterge în cascadă și vault-ul + istoricul generărilor.
      await deleteClientOnServer(clientId)
    } catch (err) {
      if (removed) {
        const r = removed
        setClienti(prev => {
          const next = [...prev]
          next.splice(Math.min(removedAt, next.length), 0, r)
          return next
        })
      }
      throw err
    }
  }, [])

  return { clienti, loading, loadingMore, hasMore, loadMore, search, add, update, remove, legacyRawById }
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
  sediuSocial: { ...EMPTY_ADRESA }, sediuSocialAnaf: null, sediuSocialAnafText: '',
  caenCod: '', caenDescriere: '', caenSecundare: [], puncteLucru: [], telefon: '', email: '',
  statutFiscal: '', platitorTva: false, periodaTva: '',
  tvaLaIncasare: false, inactivAnaf: false, splitTva: false, eFactura: false,
  administratoriAnaf: [],
  capitalSocial: null,
  dataAnafActualizat: null, notite: '',
  asociati: [], administratori: [],
}
