import { apiJson } from './api'
import type { Client, Persoana } from '../types'
import type { ClientInput } from './clienti'

/** Date sensibile (CNP, serie/număr CI): în Firestore rămân doar variante mascate
 * (`cnpMasked`/`serieMasked`) + un `pid` stabil; valorile reale stau criptate pe
 * server (vault.py) și se citesc doar prin API, cu jurnal de acces. În memorie,
 * o persoană „încărcată” (`piiLoaded`) are `cnp`/`serie_numar` completate. */

export interface PiiEntry { cnp: string; serie_numar: string }
export type PiiMap = Record<string, PiiEntry>
export type PiiPurpose = 'view' | 'edit' | 'generate'

const PERSON_FIELDS = ['titular', 'membriIF', 'asociati', 'administratori'] as const
type PersonField = typeof PERSON_FIELDS[number]

/** CNP fără spații sau alte caractere albe. Aceleași reguli ca pe server (pii_api.normalize_cnp). */
export function normalizeCnp(v: string | undefined | null): string {
  return (v ?? '').replace(/\s+/g, '')
}

/** Seria/numărul actului: spațiile, taburile și liniile noi devin un singur spațiu. Scanarea produce adesea „MX⏎123456”;
 * un câmp de text ar șterge linia nouă și ar lipi seria de număr („MX123456”). Aceleași reguli ca pe server. */
export function normalizeSerie(v: string | undefined | null): string {
  return (v ?? '').split(/\s+/).filter(Boolean).join(' ')
}

export function maskCnp(cnp: string): string {
  const d = (cnp ?? '').trim()
  return d ? '•'.repeat(Math.max(0, d.length - 4)) + d.slice(-4) : ''
}

/** Păstrează literele/spațiile seriei și ultimele 2 cifre: „MX 123456” → „MX ••••56”. */
export function maskSerie(s: string): string {
  const v = (s ?? '').trim()
  if (!v) return ''
  const digits = v.replace(/\D/g, '').length
  let seen = 0
  return v.replace(/\d/g, d => (++seen > digits - 2 ? d : '•'))
}

function personsOf(c: Partial<Client>, field: PersonField): Persoana[] {
  const v = c[field]
  return Array.isArray(v) ? v : v ? [v] : []
}

/** Persoana are date sensibile stocate în vault care nu au fost încă aduse în memorie. */
export function needsReveal(p: Persoana): boolean {
  return !!p.pid && !p.piiLoaded && !!(p.cnpMasked || p.serieMasked)
}

export function clientNeedsReveal(c: Client): boolean {
  return PERSON_FIELDS.some(f => personsOf(c, f).some(needsReveal))
}

/** Citește din vault (audit pe server). Aruncă dacă vreo înregistrare nu se poate
 * decripta — mai bine eroare decât date parțiale care, salvate înapoi, ar goli vault-ul. */
export async function fetchPii(clientId: string, purpose: PiiPurpose): Promise<PiiMap> {
  const r = await apiJson<{ persons: PiiMap; failed: number }>('GET', `/clients/${clientId}/pii?purpose=${purpose}`)
  if (r.failed > 0) throw new Error('pii_decrypt_failed')
  // Valorile din vault pot proveni din scanări mai vechi (ex. seria pe două linii): le curățăm la citire.
  return Object.fromEntries(Object.entries(r.persons).map(([pid, v]) => [pid, {
    cnp: normalizeCnp(v.cnp), serie_numar: normalizeSerie(v.serie_numar),
  }]))
}

export function applyPii(client: Client, pii: PiiMap): Client {
  const fill = (p: Persoana): Persoana => needsReveal(p)
    ? { ...p, cnp: pii[p.pid!]?.cnp ?? '', serie_numar: pii[p.pid!]?.serie_numar ?? '', piiLoaded: true }
    : p
  return {
    ...client,
    ...(client.titular ? { titular: fill(client.titular) } : {}),
    ...(client.membriIF ? { membriIF: client.membriIF.map(fill) } : {}),
    asociati: (client.asociati ?? []).map(fill),
    administratori: (client.administratori ?? []).map(fill),
  }
}

/** Aduce în memorie CNP/serie pentru toate persoanele clientului (o singură cerere). */
export async function revealClient(client: Client, purpose: PiiPurpose): Promise<Client> {
  if (!client.id || client.id.startsWith('temp-') || !clientNeedsReveal(client)) return client
  return applyPii(client, await fetchPii(client.id, purpose))
}

export interface VaultWrite { persons: PiiMap; keep?: string[] }

/** Separă datele sensibile de restul fișei înainte de scriere.
 *  - persoanele noi sau „încărcate” trimit valorile către vault (inclusiv golirea);
 *  - persoanele neîncărcate nu ating vault-ul (păstrează valorile existente);
 *  - în Firestore ajung doar `pid` și variantele mascate.
 * `existing` (fișa curentă) permite calcularea persoanelor eliminate. */
export function sanitizeForSave<T extends Partial<ClientInput>>(
  data: T, existing: Client | null,
): { data: T; vault: VaultWrite | null } {
  const out: Record<string, unknown> = { ...data }
  const vaultPersons: PiiMap = {}
  const keep = new Set<string>()

  const strip = (p: Persoana): Persoana => {
    const pid = p.pid ?? crypto.randomUUID()
    const sendPlain = !!p.piiLoaded || !p.pid || !!p.cnp || !!p.serie_numar
    const copy: Persoana = { ...p, pid, cnp: '', serie_numar: '' }
    delete copy.piiLoaded
    if (sendPlain) {
      const cnp = normalizeCnp(p.cnp)
      const serie = normalizeSerie(p.serie_numar)
      vaultPersons[pid] = { cnp, serie_numar: serie }
      copy.cnpMasked = maskCnp(cnp)
      copy.serieMasked = maskSerie(serie)
    }
    keep.add(pid)
    return copy
  }

  for (const f of PERSON_FIELDS) {
    if (!(f in data)) continue
    const v = (data as Record<string, unknown>)[f] as Persoana | Persoana[] | undefined
    if (Array.isArray(v)) out[f] = v.map(strip)
    else if (v) out[f] = strip(v)
  }

  const provided = PERSON_FIELDS.filter(f => f in data)
  let keepList: string[] | undefined
  if (existing) {
    for (const f of PERSON_FIELDS) {
      if (!provided.includes(f)) for (const p of personsOf(existing, f)) if (p.pid) keep.add(p.pid)
    }
    keepList = [...keep]
  } else if (provided.length === PERSON_FIELDS.length) {
    keepList = [...keep]
  }

  const removed = existing
    ? PERSON_FIELDS.flatMap(f => personsOf(existing, f)).filter(p => p.pid && !keep.has(p.pid)).length
    : 0
  const hasWrites = Object.keys(vaultPersons).length > 0
  const vault = hasWrites || removed > 0 ? { persons: vaultPersons, keep: keepList } : null
  return { data: out as T, vault }
}

export function savePii(clientId: string, vault: VaultWrite): Promise<unknown> {
  return apiJson('PUT', `/clients/${clientId}/pii`, vault)
}

export function deleteClientOnServer(clientId: string): Promise<unknown> {
  return apiJson('DELETE', `/clients/${clientId}`)
}
