import { describe, it, expect } from 'vitest'
import { getDosarDateValue, getExportValue, DATE_FIELD_OPTIONS } from './dosarColumns'
import type { Dosar } from '../../types'

const dosar = (over: Partial<Dosar>): Dosar => ({
  id: 'd1', nrInregistrareDosar: '1/2026', responsabilNume: 'Test', obiecteCererii: [], stadiu: 'in_lucru' as Dosar['stadiu'],
  dataAdmiterii: null, dataPlanificare: null, observatii: '', taxeOnrc: null, certificatConstatator: null,
  tarifClient: null, esteClientAdi: false, semnaturaElectronica: false, facturat: false, dataFacturarii: null,
  documentePredateAt: null, createdAt: null, createdBy: 'u1', ...over,
})

describe('getDosarDateValue — câmpul de dată ales pentru intervalul de export', () => {
  it('createdAt/dataFacturarii (Timestamp-like ISO) se parsează cu toDateSafe', () => {
    const d = dosar({ createdAt: '2026-03-15T10:00:00.000Z', dataFacturarii: '2026-04-01T00:00:00.000Z' })
    expect(getDosarDateValue(d, 'createdAt')?.getUTCFullYear()).toBe(2026)
    expect(getDosarDateValue(d, 'dataFacturarii')?.getUTCMonth()).toBe(3)
  })

  it('dataAdmiterii/dataPlanificare (string ISO simplu yyyy-mm-dd) se parsează ca dată LOCALĂ, nu UTC', () => {
    const d = dosar({ dataAdmiterii: '2026-01-15', dataPlanificare: '2026-06-30' })
    const admitere = getDosarDateValue(d, 'dataAdmiterii')!
    expect(admitere.getFullYear()).toBe(2026)
    expect(admitere.getMonth()).toBe(0)
    expect(admitere.getDate()).toBe(15)   // nu 14, cum ar fi dacă ar cădea UTC->local într-un fus negativ

    const planificare = getDosarDateValue(d, 'dataPlanificare')!
    expect(planificare.getMonth()).toBe(5)
    expect(planificare.getDate()).toBe(30)
  })

  it('câmp absent sau necunoscut → null', () => {
    const d = dosar({})
    expect(getDosarDateValue(d, 'createdAt')).toBeNull()
    expect(getDosarDateValue(d, 'altceva')).toBeNull()
  })

  it('DATE_FIELD_OPTIONS conține exact cele 4 câmpuri de dată disponibile pentru interval', () => {
    expect(DATE_FIELD_OPTIONS.map(o => o.key)).toEqual(['createdAt', 'dataAdmiterii', 'dataPlanificare', 'dataFacturarii'])
  })
})

describe('getExportValue — valori tipate pentru exportul .xlsx (nu text preformatat)', () => {
  it('facturat/esteClientAdi/semnaturaElectronica rămân boolean real, nu "Da"/"Nu"', () => {
    const d = dosar({ facturat: true, esteClientAdi: false, semnaturaElectronica: true })
    expect(getExportValue(d, 'facturat')).toBe(true)
    expect(getExportValue(d, 'esteClientAdi')).toBe(false)
    expect(getExportValue(d, 'semnaturaElectronica')).toBe(true)
  })

  it('taxeOnrc/certificatConstatator/tarifClient rămân number | null, nu text formatat "RON"', () => {
    const d = dosar({ taxeOnrc: 120, certificatConstatator: null, tarifClient: 500.5 })
    expect(getExportValue(d, 'taxeOnrc')).toBe(120)
    expect(getExportValue(d, 'certificatConstatator')).toBeNull()
    expect(getExportValue(d, 'tarifClient')).toBe(500.5)
  })

  it('createdAt/dataFacturarii/dataAdmiterii/dataPlanificare întorc Date | null, ca getDosarDateValue', () => {
    const d = dosar({ createdAt: '2026-02-01T00:00:00.000Z', dataAdmiterii: '2026-02-10' })
    expect(getExportValue(d, 'createdAt')).toBeInstanceOf(Date)
    expect(getExportValue(d, 'dataAdmiterii')).toBeInstanceOf(Date)
    expect(getExportValue(d, 'dataPlanificare')).toBeNull()
  })

  it('coloanele necunoscute cad pe getColValue (text), ca în UI', () => {
    const d = dosar({ responsabilNume: 'Avocat X' })
    expect(getExportValue(d, 'responsabilNume')).toBe('Avocat X')
  })
})
