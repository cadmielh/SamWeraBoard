import { describe, it, expect } from 'vitest'
import { computeSumarLunar, computeTarifStats, dataEfectivaFacturare, dataEfectivaTarif } from './dosareStats'
import type { Dosar } from '../types'

const dosar = (over: Partial<Dosar>): Dosar => ({
  id: 'd1', nrInregistrareDosar: '1/2026', responsabilNume: 'Test', obiecteCererii: [], stadiu: 'in_lucru' as Dosar['stadiu'],
  dataAdmiterii: null, dataPlanificare: null, observatii: '', taxeOnrc: null, certificatConstatator: null,
  tarifClient: null, esteClientAdi: false, semnaturaElectronica: false, facturat: false, dataFacturarii: null,
  documentePredateAt: null, createdAt: null, createdBy: 'u1', ...over,
})

describe('dataEfectivaTarif — luna în care contează un dosar pentru cardul „Tarife aplicate clienților”', () => {
  it('dosar facturat, cu dataFacturarii: contează la luna facturării', () => {
    const dt = dataEfectivaTarif(dosar({ facturat: true, dataFacturarii: '2026-03-15T10:00:00.000Z' }))
    expect(dt.getUTCFullYear()).toBe(2026)
    expect(dt.getUTCMonth()).toBe(2)   // martie (0-indexat)
  })

  it('dosar nefacturat: contează mereu ca „acum”, indiferent de createdAt', () => {
    const dt = dataEfectivaTarif(dosar({ facturat: false, createdAt: '2020-01-01T00:00:00.000Z' } as Partial<Dosar>))
    const now = new Date()
    expect(Math.abs(dt.getTime() - now.getTime())).toBeLessThan(5000)
  })

  it('dosar facturat, dar fără dataFacturarii (caz vechi): cade pe createdAt, ca Sumarul lunar — nu „acum”', () => {
    const dt = dataEfectivaTarif(dosar({ facturat: true, dataFacturarii: null, createdAt: '2024-06-15T00:00:00.000Z' } as Partial<Dosar>))
    expect(dt.getUTCFullYear()).toBe(2024)
    expect(dt.getUTCMonth()).toBe(5)   // iunie (0-indexat)
  })

  it('dosar facturat, fără dataFacturarii ȘI fără createdAt: ultimul refugiu e „acum”, ca să nu dispară din calcul', () => {
    const dt = dataEfectivaTarif(dosar({ facturat: true, dataFacturarii: null, createdAt: null }))
    const now = new Date()
    expect(Math.abs(dt.getTime() - now.getTime())).toBeLessThan(5000)
  })

  it('pentru orice dosar facturat, cade în aceeași lună ca dataEfectivaFacturare (Sumarul lunar) — cele două carduri trebuie să fie de acord', () => {
    const cazuri = [
      dosar({ facturat: true, dataFacturarii: '2026-03-10T00:00:00.000Z', createdAt: '2026-01-05T00:00:00.000Z' }),
      dosar({ facturat: true, dataFacturarii: null, createdAt: '2024-06-15T00:00:00.000Z' } as Partial<Dosar>),
    ]
    for (const d of cazuri) {
      const tarif = dataEfectivaTarif(d)
      const sumar = dataEfectivaFacturare(d)
      expect(sumar).not.toBeNull()
      expect(tarif.getUTCFullYear()).toBe(sumar!.getUTCFullYear())
      expect(tarif.getUTCMonth()).toBe(sumar!.getUTCMonth())
    }
  })
})

describe('computeTarifStats — suma tarifelor pe baza datei de facturare', () => {
  it('dosar facturat luna trecută nu contează în luna curentă, dar contează în luna lui', () => {
    const facturatLunaTrecuta = dosar({ facturat: true, dataFacturarii: '2026-01-15T00:00:00.000Z', tarifClient: 1000 })
    const lunaCurenta: [Date, Date] = [new Date(2026, 1, 1), new Date(2026, 2, 1)]      // februarie 2026
    const lunaTrecuta: [Date, Date] = [new Date(2026, 0, 1), new Date(2026, 1, 1)]      // ianuarie 2026

    expect(computeTarifStats([facturatLunaTrecuta], lunaCurenta)).toEqual({ tarifClientTotal: 0, tarifClientFacturat: 0 })
    expect(computeTarifStats([facturatLunaTrecuta], lunaTrecuta)).toEqual({ tarifClientTotal: 1000, tarifClientFacturat: 1000 })
  })

  it('dosar nefacturat, creat acum 2 ani: apare mereu în luna curentă, nu în luna creării', () => {
    const nefacturat = dosar({ facturat: false, tarifClient: 500, createdAt: '2024-01-01T00:00:00.000Z' } as Partial<Dosar>)
    const now = new Date()
    const lunaCurenta: [Date, Date] = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)]
    const lunaCreare: [Date, Date] = [new Date(2024, 0, 1), new Date(2024, 1, 1)]

    expect(computeTarifStats([nefacturat], lunaCurenta).tarifClientTotal).toBe(500)
    expect(computeTarifStats([nefacturat], lunaCreare).tarifClientTotal).toBe(0)
  })

  it('total (fără limite): se însumează totul, indiferent de dată', () => {
    const facturat = dosar({ facturat: true, dataFacturarii: '2020-05-01T00:00:00.000Z', tarifClient: 300 })
    const nefacturat = dosar({ facturat: false, tarifClient: 700 })
    expect(computeTarifStats([facturat, nefacturat], null)).toEqual({ tarifClientTotal: 1000, tarifClientFacturat: 300 })
  })

  it('tarifClientTotal include suma facturată în perioadă; tarifClientFacturat e identic când totul e facturat', () => {
    const bounds: [Date, Date] = [new Date(2026, 2, 1), new Date(2026, 3, 1)]   // martie 2026
    const facturat = dosar({ facturat: true, dataFacturarii: '2026-03-10T00:00:00.000Z', tarifClient: 400 })
    expect(computeTarifStats([facturat], bounds)).toEqual({ tarifClientTotal: 400, tarifClientFacturat: 400 })
  })

  it('luna curentă: facturatul din luna asta + tot restanțul nefacturat intră în total, doar facturatul în „facturat”', () => {
    const now = new Date()
    const lunaCurenta: [Date, Date] = [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)]
    const facturatLunaAsta = dosar({ facturat: true, dataFacturarii: now.toISOString(), tarifClient: 1000 })
    const nefacturatVechi = dosar({ facturat: false, tarifClient: 400, createdAt: '2023-01-01T00:00:00.000Z' } as Partial<Dosar>)
    const facturatAltaLuna = dosar({ facturat: true, dataFacturarii: '2020-01-01T00:00:00.000Z', tarifClient: 9999 })

    const stats = computeTarifStats([facturatLunaAsta, nefacturatVechi, facturatAltaLuna], lunaCurenta)
    expect(stats).toEqual({ tarifClientTotal: 1400, tarifClientFacturat: 1000 })
  })
})

describe('computeSumarLunar — „De facturat către Adi” (distinct de Profit Adi)', () => {
  const dosarFacturat = (over: Partial<Dosar>): Dosar =>
    dosar({ facturat: true, dataFacturarii: '2026-03-10T00:00:00.000Z', ...over })

  it('dosar cu semnătură electronică: contribuie cu cuvenitul Sami (fără CAA fix per dosar — ca profitSamiDinDosare)', () => {
    const d = dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false })
    const stats = computeSumarLunar([d])
    // cotaSamiClientiProprii implicit 0.9 -> cuvenitSami = 900; „din dosare” nu scade CAA-ul fix per dosar
    // (14%), ca profitSamiDinDosare — CAA se scade o singură dată, cel real, în varianta „Oficial”.
    expect(stats.deFacturatCatreAdi).toBeCloseTo(900, 2)
    // caaReala = max(615, min(0.14*1000, 3073)) = 615; barou = 146; costuriComune = 761
    // Oficial = 900 - (761*900)/1000 = 215.1
    expect(stats.deFacturatCatreAdiOficial).toBeCloseTo(215.1, 2)
  })

  it('dosar fără semnătură electronică: nu contribuie deloc, nici brut nici oficial', () => {
    const d = dosarFacturat({ tarifClient: 500, semnaturaElectronica: false })
    const stats = computeSumarLunar([d])
    expect(stats.deFacturatCatreAdi).toBe(0)
    expect(stats.deFacturatCatreAdiOficial).toBe(0)
  })

  it('mai multe dosare: doar cele cu semnătură electronică se însumează', () => {
    const semnat = dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false })       // cuvenitSami = 900
    const nesemnat = dosarFacturat({ tarifClient: 500, semnaturaElectronica: false })                            // nu contează
    const semnatAdi = dosarFacturat({ tarifClient: 2000, semnaturaElectronica: true, esteClientAdi: true })      // cuvenitSami = 1200 (cota 0.6)

    const stats = computeSumarLunar([semnat, nesemnat, semnatAdi])
    expect(stats.deFacturatCatreAdi).toBeCloseTo(900 + 1200, 2)
  })

  it('e distinct de profitAdi/profitAdiOficial — nu sunt aceeași cifră', () => {
    const d = dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false })
    const stats = computeSumarLunar([d])
    expect(stats.deFacturatCatreAdi).not.toBeCloseTo(stats.profitAdiOficial, 2)
    expect(stats.deFacturatCatreAdiOficial).not.toBeCloseTo(stats.profitAdiOficial, 2)
  })

  it('descompunere: Profit Sami oficial = partea din dosarele nesemnate (brută, neatinsă de Barou/CAA) + De facturat către Adi (oficial)', () => {
    const nesemnat = dosarFacturat({ tarifClient: 2000, semnaturaElectronica: false })
    const semnat = dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false })
    const semnatAdi = dosarFacturat({ tarifClient: 1500, semnaturaElectronica: true, esteClientAdi: true })
    const stats = computeSumarLunar([nesemnat, semnat, semnatAdi])

    const nesemnatOficial = stats.profitSamiOficial - stats.deFacturatCatreAdiOficial
    // Barou+CAA se împart doar între partea semnată a lui Sami și Adi (nu pe tot venitul lunii) — partea
    // nesemnată a lui Sami rămâne exact cea brută, neatinsă de Barou/CAA (vezi testul „un dosar nesemnat nu
    // schimbă Profit Adi” mai jos, pentru de ce).
    expect(nesemnatOficial).toBeCloseTo(2000, 2)
  })

  it('un dosar nesemnat nou nu schimbă deloc Profit Adi sau De facturat către Adi — doar Barou/CAA sunt costuri comune, nu tot venitul lunii', () => {
    const semnat = dosarFacturat({ tarifClient: 2000, semnaturaElectronica: true, esteClientAdi: false })
    const inainte = computeSumarLunar([semnat])
    const nesemnatNou = dosarFacturat({ tarifClient: 20000, semnaturaElectronica: false })
    const dupa = computeSumarLunar([semnat, nesemnatNou])

    expect(dupa.profitAdiOficial).toBeCloseTo(inainte.profitAdiOficial, 6)
    expect(dupa.deFacturatCatreAdiOficial).toBeCloseTo(inainte.deFacturatCatreAdiOficial, 6)
  })
})

describe('computeSumarLunar — CAA reală doar pe dosarele cu semnătură electronică', () => {
  const dosarFacturat = (over: Partial<Dosar>): Dosar =>
    dosar({ facturat: true, dataFacturarii: '2026-09-10T00:00:00.000Z', ...over })

  it('un dosar mare, nesemnat, nu umflă CAA reală — doar dosarele semnate contează', () => {
    const nesemnatMare = dosarFacturat({ tarifClient: 10000, semnaturaElectronica: false })
    const semnatMic = dosarFacturat({ tarifClient: 2000, semnaturaElectronica: true, esteClientAdi: false })
    const stats = computeSumarLunar([nesemnatMare, semnatMic])
    const m = stats.luni[0]
    // 14% din 2000 = 280, sub caaMin (615) -> regim 'fix', caaReala = 615 (nu 14% din 12000 = 1680)
    expect(m.regim).toBe('fix')
    expect(m.caaReala).toBeCloseTo(615, 2)
  })

  it('fără niciun dosar semnat: CAA reală e 0, chiar dacă există venit din dosare nesemnate', () => {
    const nesemnat = dosarFacturat({ tarifClient: 5000, semnaturaElectronica: false })
    const stats = computeSumarLunar([nesemnat])
    expect(stats.luni[0].caaReala).toBe(0)
  })

  it('CAA reală rămâne consecventă cu CAA per dosare (amândouă doar pe dosarele semnate)', () => {
    const nesemnat = dosarFacturat({ tarifClient: 8000, semnaturaElectronica: false })
    const semnat = dosarFacturat({ tarifClient: 5000, semnaturaElectronica: true, esteClientAdi: false })
    const stats = computeSumarLunar([nesemnat, semnat])
    const m = stats.luni[0]
    // caaPerDosare = 14% din 5000 = 700 (deja doar pe semnate, calculDosarFinanciar dă caa=0 la nesemnate)
    expect(m.caaPerDosare).toBeCloseTo(700, 2)
    // caaReala, acum pe aceeași bază (5000, nu 13000) -> tot 700 (sub prag, deci acelasi regim 'procent')
    expect(m.caaReala).toBeCloseTo(700, 2)
  })
})

describe('computeSumarLunar — „Verificare (=0)” din foaia de calcul originală', () => {
  const dosarFacturat = (over: Partial<Dosar>): Dosar =>
    dosar({ facturat: true, dataFacturarii: '2026-09-10T00:00:00.000Z', ...over })

  it('Profit Sami + Profit Adi + Barou + CAA reală + taxe + impozit = venit total, mereu, chiar cu mix semnat/nesemnat', () => {
    const cazuri: Dosar[][] = [
      [dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false, taxeOnrc: 120, certificatConstatator: 50 })],
      [
        dosarFacturat({ tarifClient: 20000, semnaturaElectronica: false, taxeOnrc: 200 }),
        dosarFacturat({ tarifClient: 1000, semnaturaElectronica: true, esteClientAdi: false, taxeOnrc: 120, certificatConstatator: 50 }),
        dosarFacturat({ tarifClient: 1500, semnaturaElectronica: true, esteClientAdi: true }),
      ],
      [dosarFacturat({ tarifClient: 5000, semnaturaElectronica: false })],   // fără niciun dosar semnat
    ]
    for (const dosare of cazuri) {
      const stats = computeSumarLunar(dosare)
      const m = stats.luni[0]
      const verificare = m.profitSamiOficial + m.profitAdiOficial + m.barou + m.caaReala + m.taxeSuplimentare + m.impozitProfit
      expect(verificare).toBeCloseTo(m.totalVenit, 6)
    }
  })
})
