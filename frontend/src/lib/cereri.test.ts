import { describe, expect, it, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./api', () => ({ apiJson: vi.fn() }))

import { cerereDinFirestore, expirata, linkEmail, linkWhatsApp, mesajCerere, propuneriActe, stareCerere, type Cerere } from './cereri'
import type { Client, Persoana } from '../types'

const AZI = new Date(2026, 10, 25)
const P = (nume: string, prenume: string, pid: string, valabila = ''): Persoana =>
  ({ nume, prenume, pid, valabila_pana_la: valabila } as unknown as Persoana)
const PJ = (o: Partial<Client>): Client => ({ id: 'c1', denumire: 'Alfa SRL', tipClient: 'PJ', asociati: [], administratori: [], ...o } as unknown as Client)

describe('propuneriActe', () => {
  it('PJ: un buletin per persoană (asociat și administrator o singură dată), plus dovada sediului', () => {
    const ion = P('Popescu', 'Ion', 'p1', '01.01.2030')
    const c = PJ({ asociati: [ion, P('Ionescu', 'Ana', 'p2', '10.12.2026')], administratori: [{ ...ion }] })
    const pr = propuneriActe(c, AZI)
    expect(pr.map(p => [p.eticheta, p.tip, p.persoanaPid, p.bifat])).toEqual([
      ['CI – Popescu Ion', 'ci', 'p1', false],
      ['CI – Ionescu Ana', 'ci', 'p2', true],
      ['Dovada sediului (contract sau extras CF)', 'dovada_sediu', undefined, false],
    ])
    expect(pr[1].nota).toBe('expiră pe 10.12.2026')
  })
  it('buletin expirat sau fără date: propus bifat, cu motiv; persoane fără nume sărite', () => {
    const c = PJ({ asociati: [P('Vechi', 'Dan', 'p1', '01.01.2020'), P('Nou', 'Eva', 'p2'), P('', '', 'p3')] })
    const pr = propuneriActe(c, AZI)
    expect(pr.slice(0, 2).map(p => [p.eticheta, p.bifat, p.nota])).toEqual([
      ['CI – Vechi Dan', true, 'expirat pe 01.01.2020'],
      ['CI – Nou Eva', true, 'fără date de buletin în fișă'],
    ])
    expect(pr).toHaveLength(3)
  })
  it('PF: titularul, fără dovadă de sediu', () => {
    const c = { id: 'c2', denumire: 'Pop Ion', tipClient: 'PF', titular: P('Pop', 'Ion', 'p9', '01.01.2031') } as unknown as Client
    expect(propuneriActe(c, AZI).map(p => p.eticheta)).toEqual(['CI – Pop Ion'])
  })
})

describe('starea unei cereri', () => {
  const baza = cerereDinFirestore('r1', { clientId: 'c1', acte: [{ id: 'a1', eticheta: 'X', stare: 'ciudat' }], stare: 'deschisa' })
  const cu = (o: Partial<Cerere>): Cerere => ({ ...baza, ...o })
  it('valori implicite sigure din Firestore', () => {
    expect(baza.acte[0]).toMatchObject({ tip: 'altul', stare: 'de_trimis', fisiere: [] })
    expect(baza.deVerificat).toBe(0)
  })
  it('textul pe scurt, în ordinea importanței', () => {
    const viitor = new Date(AZI.getTime() + 86_400_000)
    const trecut = new Date(AZI.getTime() - 1)
    expect(stareCerere(cu({ stare: 'anulata', deVerificat: 2 }), AZI).text).toBe('Anulată')
    expect(stareCerere(cu({ deVerificat: 2, expiraLa: trecut }), AZI)).toEqual({ text: '2 acte de verificat', ton: 'atentie' })
    expect(stareCerere(cu({ expiraLa: trecut }), AZI).text).toBe('Link expirat')
    expect(stareCerere(cu({ expiraLa: viitor }), AZI).text).toBe('Trimisă, nedeschisă încă')
    expect(stareCerere(cu({ expiraLa: viitor, deschisaLa: AZI }), AZI).text).toBe('Deschisă de client')
    expect(expirata(cu({ stare: 'completa', expiraLa: trecut }), AZI)).toBe(false)
  })
})

describe('trimiterea linkului', () => {
  const link = 'https://cabinio.web.app/p/abc'
  const mesaj = mesajCerere('Cabinet Ionescu', link, new Date(2026, 11, 9))
  it('mesajul conține cabinetul, linkul și termenul', () => {
    expect(mesaj).toContain('cerute de Cabinet Ionescu aici:\nhttps://cabinio.web.app/p/abc')
    expect(mesaj).toContain('valabil până pe 09.12.2026')
  })
  it('WhatsApp și e-mail, cu textul codificat', () => {
    expect(linkWhatsApp('a b&c')).toBe('https://wa.me/?text=a%20b%26c')
    const m = linkEmail(' ion@ex.ro ', 'Cabinet Ionescu', 'Bună & salut')
    expect(m).toBe('mailto:ion%40ex.ro?subject=Acte%20cerute%20de%20Cabinet%20Ionescu&body=Bun%C4%83%20%26%20salut')
  })
})
