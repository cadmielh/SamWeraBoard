import type { Dosar, SarcinaInput } from '../types'

type DosarLike = Pick<Dosar,
  'clientId' | 'clientDenumire' | 'clientDenumireLibera' | 'responsabilUid' | 'responsabilNume' | 'dataPlanificare' | 'nrInregistrareDosar'
>

/** Construiește o Sarcina legată de un dosar, pentru UN singur obiect al
 * cererii — folosită atât la crearea dosarului (câte o sarcină per obiect,
 * nu una combinată), cât și de sugestia "obiect nou → creezi o sarcină?" din
 * DosarSarciniList. Sursă unică pentru maparea câmpurilor, ca cele două
 * fluxuri să nu diveargă. */
export function buildSarcinaForObiect(dosar: DosarLike, dosarId: string, obiectLabel: string): SarcinaInput {
  const clientLabel = dosar.clientDenumire || dosar.clientDenumireLibera || ''
  const titlu = clientLabel ? `${obiectLabel} — ${clientLabel}` : obiectLabel
  return {
    titlu, titluLower: titlu.toLowerCase(),
    descriere: '',
    status: 'deschis',
    prioritate: 'medie',
    termenLimita: dosar.dataPlanificare,
    assigneeUid: dosar.responsabilUid ?? null,
    assigneeNume: dosar.responsabilNume,
    clientId: dosar.clientId,
    clientDenumire: dosar.clientDenumire,
    clientDenumireLibera: dosar.clientId ? undefined : dosar.clientDenumireLibera,
    dosarId,
    dosarLabel: dosar.nrInregistrareDosar || obiectLabel,
    obiectCererii: obiectLabel,
    order: Date.now(),
    completedAt: null,
  }
}
