import type { Dosar, ObiectCerereItem, SarcinaInput } from '../types'

type DosarLike = Pick<Dosar,
  'clientDenumire' | 'clientDenumireLibera' | 'clientId' | 'responsabilUid' | 'responsabilNume' | 'dataPlanificare' | 'nrInregistrareDosar' | 'obiecteCererii'
>

/** Instantaneu comparabil al obiectelor cererii unui dosar — folosit pentru a
 * detecta (în DosarSarciniList) dacă sarcina auto-generată a rămas
 * desincronizată după o editare ulterioară a obiectelor, fără să depindă de
 * ordinea din array. */
export function serializeObiecte(obiecte: ObiectCerereItem[]): string {
  return [...obiecte.map(o => o.label)].sort().join('|')
}

/** Text de descriere pentru sarcina combinată — un rând per obiect al cererii.
 * Exportat separat, reutilizat de sincronizarea automată din
 * DosarSarciniList când obiectele dosarului se editează ulterior. */
export function descriereObiecte(obiecte: ObiectCerereItem[]): string {
  return obiecte.map(o => `• ${o.label}`).join('\n')
}

/** Construiește UNA singură Sarcina pentru toate obiectele cererii unui dosar
 * (nu una per obiect) — folosită atât la crearea dosarului, cât și de
 * sincronizarea automată din DosarSarciniList când obiectele se editează
 * ulterior. Sursă unică pentru maparea câmpurilor, ca cele două fluxuri să nu
 * diveargă. */
export function buildSarcinaForDosar(dosar: DosarLike, dosarId: string): SarcinaInput {
  const clientLabel = dosar.clientDenumire || dosar.clientDenumireLibera || ''
  const titlu = clientLabel ? `Dosar — ${clientLabel}` : (dosar.nrInregistrareDosar || 'Dosar nou')
  return {
    titlu, titluLower: titlu.toLowerCase(),
    descriere: descriereObiecte(dosar.obiecteCererii),
    status: 'deschis',
    prioritate: 'medie',
    termenLimita: dosar.dataPlanificare,
    assigneeUid: dosar.responsabilUid ?? null,
    assigneeNume: dosar.responsabilNume,
    clientId: dosar.clientId,
    clientDenumire: dosar.clientDenumire,
    clientDenumireLibera: dosar.clientId ? undefined : dosar.clientDenumireLibera,
    dosarId,
    dosarLabel: dosar.nrInregistrareDosar || clientLabel,
    obiectCererii: serializeObiecte(dosar.obiecteCererii),
    order: Date.now(),
    completedAt: null,
  }
}
