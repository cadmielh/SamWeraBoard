import { apiJson } from './api'

/** Intrare din jurnalul de acces al workspace-ului. Jurnalul e scris exclusiv de server și NU conține
 * valori de date personale (CNP, nume, adrese), doar cine, când, ce acțiune și metadate. */
export interface AuditEntry {
  id: string
  ts: string | null
  actorUid: string
  action: string
  target: string | null
  meta: Record<string, unknown>
  ip: string | null
}

export type AuditCategory = 'date' | 'documente' | 'membri' | 'cont'
export type CategoryFilter = 'toate' | AuditCategory

export const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  toate: 'Toate acțiunile',
  date: 'Date personale și clienți',
  documente: 'Documente generate',
  membri: 'Membri și invitații',
  cont: 'Cont și spațiu de lucru',
}

const ACTIONS: Record<string, { label: string; category: AuditCategory }> = {
  'pii.reveal': { label: 'Vizualizare CNP / serie CI', category: 'date' },
  'pii.write': { label: 'Salvare CNP / serie CI', category: 'date' },
  'ocr.extract': { label: 'Scanare act de identitate (OCR)', category: 'date' },
  'client.delete': { label: 'Ștergere client', category: 'date' },
  'document.generate': { label: 'Generare document', category: 'documente' },
  'member.role_change': { label: 'Schimbare rol', category: 'membri' },
  'member.remove': { label: 'Eliminare membru', category: 'membri' },
  'invite.create': { label: 'Invitație trimisă', category: 'membri' },
  'invite.accept': { label: 'Invitație acceptată', category: 'membri' },
  'invite.decline': { label: 'Invitație refuzată', category: 'membri' },
  'invite.revoke': { label: 'Invitație anulată', category: 'membri' },
  'workspace.create': { label: 'Creare spațiu de lucru', category: 'cont' },
  'consent.accept': { label: 'Acceptare termeni și DPA', category: 'cont' },
  'migration.import': { label: 'Import date din sistemul anterior', category: 'cont' },
}

const ROLE_LABELS: Record<string, string> = { admin: 'Administrator', member: 'Membru', viewer: 'Doar citire' }
const PURPOSE_LABELS: Record<string, string> = { view: 'vizualizare', edit: 'editare', generate: 'generare document' }
const OUTCOME_LABELS: Record<string, string> = { ok: 'reușit', empty: 'fără date extrase', error: 'eroare' }

export function actionLabel(action: string): string {
  return ACTIONS[action]?.label ?? action
}

export function categoryOf(action: string): AuditCategory | null {
  return ACTIONS[action]?.category ?? null
}

/** Numele afișat pentru un id de utilizator din jurnal (membrii curenți; altfel „utilizator eliminat”). */
export type NameOf = (uid: string) => string

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const yesNo = (v: unknown): string => (v ? 'da' : 'nu')

function templateLabel(t: string): string {
  if (t === 'drive') return 'din Google Drive'
  if (t === 'upload') return 'încărcat manual'
  if (t.startsWith('builtin:')) {
    const name = t.slice('builtin:'.length).replace(/_/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return t
}

const shortId = (id: string | null): string => (id ? `…${id.slice(-6)}` : '')

/** Detalii lizibile, construite exclusiv din metadatele nesensibile ale intrării. */
export function describe(e: AuditEntry, nameOf: NameOf = uid => uid): string {
  const m = e.meta ?? {}
  switch (e.action) {
    case 'pii.reveal':
      return `${num(m.persons)} persoane · scop: ${PURPOSE_LABELS[str(m.purpose)] ?? (str(m.purpose) || '—')} · client ${shortId(e.target)}`
    case 'pii.write':
      return `${num(m.written)} salvate, ${num(m.removed)} eliminate · client ${shortId(e.target)}`
    case 'ocr.extract':
      return [
        `sursă: ${m.source === 'drive' ? 'Google Drive' : 'încărcare'}`,
        `motor: ${m.engine === 'local' ? 'local' : 'Azure'}`,
        `rezultat: ${OUTCOME_LABELS[str(m.outcome)] ?? (str(m.outcome) || '—')}`,
        `${num(m.sizeKb)} KB`,
        `CNP găsit: ${yesNo(m.cnp)}`,
      ].join(' · ')
    case 'document.generate':
      return [
        String(m.format ?? '').toUpperCase(),
        `șablon: ${templateLabel(str(m.template))}`,
        `destinație: ${m.destination === 'drive' ? 'Google Drive' : 'descărcare'}`,
        `${num(m.fields)} câmpuri`,
        `CNP inclus: ${yesNo(m.cnp)}`,
        ...(m.reportedBy === 'client' ? ['raportat de browser'] : []),    // generat direct în Google Docs, fără să treacă prin server
      ].join(' · ')
    case 'client.delete':
      return `client ${shortId(e.target)}`
    case 'member.role_change':
      return `${e.target ? nameOf(e.target) : '—'} → ${ROLE_LABELS[str(m.role)] ?? (str(m.role) || '—')}`
    case 'member.remove':
      return e.target ? nameOf(e.target) : '—'
    case 'invite.create':
    case 'invite.accept':
      return `rol: ${ROLE_LABELS[str(m.role)] ?? (str(m.role) || '—')}`
    case 'consent.accept':
      return `versiune termeni ${str(m.tos) || '—'}, DPA ${str(m.dpa) || '—'}`
    default:
      return ''
  }
}

export interface FetchAuditOptions { limit?: number; before?: string | null }

export function fetchAudit(workspaceId: string, { limit = 100, before = null }: FetchAuditOptions = {}): Promise<AuditEntry[]> {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (before) qs.set('before', before)         // URLSearchParams codifică „+” din „+00:00”
  return apiJson<AuditEntry[]>('GET', `/workspaces/${workspaceId}/audit?${qs.toString()}`)
}

/** CSV pentru arhivare/audit. Celulele care ar putea fi interpretate ca formule în Excel sunt prefixate cu apostrof. */
export function toCsv(entries: AuditEntry[], nameOf: NameOf): string {
  const cell = (v: string): string => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return `"${safe.replace(/"/g, '""')}"`
  }
  const rows = entries.map(e => [
    e.ts ?? '',
    e.actorUid === 'system' ? 'Sistem' : nameOf(e.actorUid),
    actionLabel(e.action),
    describe(e, nameOf),
    e.ip ?? '',
  ].map(cell).join(','))
  return '﻿' + [['Data și ora (UTC)', 'Utilizator', 'Acțiune', 'Detalii', 'Adresa IP'].map(cell).join(','), ...rows].join('\r\n')
}
