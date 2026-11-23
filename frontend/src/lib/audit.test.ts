import { describe, it, expect, vi } from 'vitest'

vi.mock('./api', () => ({ apiJson: vi.fn(async () => []) }))

import { actionLabel, categoryOf, describe as describeEntry, toCsv, fetchAudit, type AuditEntry } from './audit'
import sursa from '../../../fisiere_api.py?raw'
import { apiJson } from './api'

const E = (o: Partial<AuditEntry>): AuditEntry => ({
  id: 'x', ts: '2026-09-19T10:00:00+00:00', actorUid: 'u1', action: 'pii.reveal', target: null, meta: {}, ip: '1.2.3.4', ...o,
})
const nameOf = (uid: string) => ({ u1: 'Ana Pop', u2: 'Ion Vlad' } as Record<string, string>)[uid] ?? `necunoscut ${uid}`

describe('etichete și categorii', () => {
  it('acțiunile cunoscute au etichetă română și categorie', () => {
    expect(actionLabel('pii.reveal')).toBe('Vizualizare CNP / serie CI')
    expect(actionLabel('ocr.extract')).toBe('Scanare act de identitate (OCR)')
    expect(actionLabel('document.generate')).toBe('Generare document')
    expect(categoryOf('pii.reveal')).toBe('date')
    expect(categoryOf('ocr.extract')).toBe('date')
    expect(categoryOf('document.generate')).toBe('documente')
    expect(categoryOf('member.remove')).toBe('membri')
    expect(categoryOf('consent.accept')).toBe('cont')
  })
  it('o acțiune necunoscută nu strică afișarea', () => {
    expect(actionLabel('ceva.nou')).toBe('ceva.nou')
    expect(categoryOf('ceva.nou')).toBeNull()
    expect(describeEntry(E({ action: 'ceva.nou', meta: { x: 1 } }), nameOf)).toBe('')
  })
})

describe('detalii lizibile (doar din metadate nesensibile)', () => {
  it('OCR', () => {
    const d = describeEntry(E({ action: 'ocr.extract', meta: { source: 'drive', engine: 'local', outcome: 'empty', sizeKb: 12, cnp: false } }), nameOf)
    expect(d).toBe('sursă: Google Drive · motor: local · rezultat: fără date extrase · 12 KB · CNP găsit: nu')
  })
  it('generare document', () => {
    const d = describeEntry(E({ action: 'document.generate', meta: { format: 'docx', template: 'builtin:act_constitutiv', destination: 'drive', fields: 7, cnp: true } }), nameOf)
    expect(d).toBe('DOCX · șablon: Act constitutiv · destinație: Google Drive · 7 câmpuri · CNP inclus: da')
  })
  it('documentele Google Docs completate în browser sunt marcate ca raportate de browser', () => {
    const d = describeEntry(E({ action: 'document.generate', meta: { format: 'gdoc', template: 'drive', destination: 'drive', fields: 4, cnp: false, reportedBy: 'client' } }), nameOf)
    expect(d).toBe('GDOC · șablon: din Google Drive · destinație: Google Drive · 4 câmpuri · CNP inclus: nu · raportat de browser')
  })
  it('vizualizare CNP arată scopul, numărul de persoane și doar coada id-ului clientului', () => {
    const d = describeEntry(E({ action: 'pii.reveal', target: 'clientABCDEFGH123456', meta: { purpose: 'generate', persons: 3 } }), nameOf)
    expect(d).toBe('3 persoane · scop: generare document · client …123456')
    expect(d).not.toContain('clientABCDEFGH')
  })
  it('schimbare de rol rezolvă numele membrului', () => {
    expect(describeEntry(E({ action: 'member.role_change', target: 'u2', meta: { role: 'viewer' } }), nameOf)).toBe('Ion Vlad → Doar citire')
  })
})

describe('export CSV', () => {
  it('are antet, BOM pentru Excel și nume rezolvate', () => {
    const csv = toCsv([E({ actorUid: 'u1' }), E({ actorUid: 'system', action: 'migration.import' })], nameOf)
    expect(csv.startsWith('﻿"Data și ora (UTC)"')).toBe(true)
    expect(csv).toContain('"Ana Pop"')
    expect(csv).toContain('"Sistem"')
    expect(csv.split('\r\n')).toHaveLength(3)
  })
  it('protejează împotriva formulelor Excel și a ghilimelelor', () => {
    const csv = toCsv([E({ actorUid: 'x', action: 'a"b' })], () => '=HYPERLINK("http://evil")')
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)      // prefixat cu apostrof, ghilimele dublate
    expect(csv).toContain('"a""b"')
  })
})

describe('fetchAudit', () => {
  it('codifică marcajul de timp (+ din +00:00) în URL', async () => {
    await fetchAudit('ws1', { limit: 50, before: '2026-09-19T10:00:00+00:00' })
    const url = (apiJson as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)![1]
    expect(url).toBe('/workspaces/ws1/audit?limit=50&before=2026-09-19T10%3A00%3A00%2B00%3A00')
  })
})

describe('documentele clienților', () => {
  it('fiecare acțiune scrisă de fisiere_api.py are etichetă și categorie', () => {
    const actiuni = [...sursa.matchAll(/audit\.log\([^"]*"([a-z_.]+)"/g)].map(m => m[1])
    expect(actiuni.length).toBeGreaterThan(5)
    for (const a of actiuni) {
      expect(actionLabel(a), a).not.toBe(a)
      expect(categoryOf(a), a).toBe('documente')
    }
  })
  it('detalii fără nume de fișiere', () => {
    expect(describeEntry(E({ action: 'fisier.upload', target: 'abcdef123456', meta: { client: 'cli999888', marime: 2048, tip: 'pdf' } }), nameOf))
      .toBe('PDF · 2 KB · client …999888')
    expect(describeEntry(E({ action: 'fisier.upload', target: 'x', meta: { client: 'cli999888', marime: 4096, tip: 'docx', sursa: 'generat' } }), nameOf))
      .toBe('copie document generat · DOCX · 4 KB · client …999888')
    expect(describeEntry(E({ action: 'fisier.update', target: 'abc123456', meta: { redenumit: true, mutat: false } }), nameOf))
      .toBe('redenumit · document …123456')
    expect(describeEntry(E({ action: 'client.delete', target: 'cli111222', meta: { fisiere: 3, mod: 'arhiveaza' } }), nameOf))
      .toBe('client …111222 · 3 documente arhivate')
  })
})
