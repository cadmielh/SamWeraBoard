import { describe, it, expect } from 'vitest'
import { findClauseSpec } from './clauseFieldSpecs'

const ph = (...keys: string[]) => keys.map(k => `{{${k}}}`)
const widget = (tag: string, keys: string[]) => findClauseSpec(tag, ph(...keys))?.widget ?? null

// Clauzele din șabloanele de bază (list_clauses_in_docx pe „2 Decizia Asociatului unic” / „3 Hot AGA”) — widget-ul lor
// nu trebuie să se schimbe când potrivirea după câmpuri se aplică și clauzelor cu nume necunoscute.
describe('findClauseSpec — șabloanele de bază rămân neschimbate', () => {
  it.each([
    ['ACTUALIZARE_COD_CAEN_REV3', ['CAEN_PRINCIPAL_COD', 'CAEN_SECUNDARE_COD', 'DATA_AZI'], null],
    ['SCHIMBARE_SEDIU_SOCIAL', ['CONTRACT_SEDIU_DATA', 'CONTRACT_SEDIU_NR', 'SEDIU_NOU', 'SOCIETATE_SEDIU', 'TIP_CONTRACT_SEDIU'], null],
    ['DESCHIDERE_PUNCT_DE_LUCRU', ['CONTRACT_PUNCT_LUCRU_DATA', 'CONTRACT_PUNCT_LUCRU_NR', 'DATA_CURENTA', 'PUNCT_LUCRU_NOU_ADRESA', 'TIP_CONTRACT_PUNCT_LUCRU'], 'punctLucruOpen'],
    ['INCHIDERE_PUNCT_DE_LUCRU', ['DATA_CURENTA', 'PUNCT_LUCRU_INCHIS_ADRESA'], 'punctLucruClose'],
    ['CESIUNE_PARTI_SOCIALE', ['CAPITAL_SOCIAL', 'CEDENT_NUME', 'CESIONAR_NUME', 'COTA_PARTICIPARE', 'DATA_CONTRACT_CESIUNE', 'NR_PARTI_CEDATE', 'NUME', 'PARTI_SOCIALE', 'VALOARE_NOMINALA'], 'cesiune'],
    ['MAJORARE_CAPITAL_SOCIAL', ['ASOCIAT_APORT_COTA_PARTICIPARE', 'ASOCIAT_APORT_NUME', 'CAPITAL_SOCIAL_NOU', 'CAPITAL_SOCIAL_TOTAL', 'PARTI_SOCIALE_NOI', 'PARTI_SOCIALE_TOTALE', 'VALOARE_PARTE_SOCIALA'], 'majorareCapital'],
    ['MAJORARE_CAPITAL_SOCIAL', ['APORT', 'CAPITAL_SOCIAL_NOU', 'CAPITAL_SOCIAL_TOTAL', 'COTA_PARTICIPARE', 'NUME', 'PARTI_APORT', 'PARTI_SOCIALE_NOI', 'PARTI_SOCIALE_TOTALE', 'VALOARE_PARTE_SOCIALA'], 'majorareCapitalMulti'],
    ['SCHIMBARE_COD_CAEN_PRINCIPAL', ['CAEN_1', 'CAEN_PRINCIPAL_NOU', 'DATA_CURENTA'], 'caenSingle'],
    ['ADAUGARE_COD_CAEN', ['CAEN', 'DATA_CURENTA'], 'caenList'],
    ['SCHIMBARE_ADMINISTRATOR', ['ADMINISTRATOR_NOU_NUME', 'ADMINISTRATOR_VECHI_NUME', 'DURATA_MANDAT_ANI'], 'administrator'],
    ['DURATA_SOCIETATE_99_ANI', [], null],
    ['DURATA_MANDAT_ADMINISTRATOR_99_ANI', [], null],
    ['MODIFICARE_DATE_IDENTIFICARE_ASOCIAT', ['ASOCIAT_MODIFICAT_NUME', 'ASOCIAT_MODIFICAT_PRENUME', 'ASOCIAT_MODIFICAT_SERIE_NUMAR'], 'identitateAsociat'],
  ] as const)('%s → %s', (tag, keys, expected) => {
    expect(widget(tag, [...keys])).toBe(expected)
  })
})

describe('findClauseSpec — clauze cu alt nume, recunoscute după câmpuri', () => {
  it('alege widget-ul după câmpurile clauzei', () => {
    expect(widget('PRELUNGIRE_DURATA', ['DURATA_SOCIETATE'])).toBe('durataSocietate')
    expect(widget('INFIINTARE_SEDIU_SECUNDAR', ['PUNCT_LUCRU_NOU_ADRESA', 'CONTRACT_PUNCT_LUCRU_NR'])).toBe('punctLucruOpen')
    expect(widget('MODIFICARI_ASOCIATI', ['ASOCIATI_ACTUALIZATI_ROL', 'ASOCIATI_ACTUALIZATI'])).toBe('asociatiActualizati')
  })

  it('nu folosește spec-urile cu listă (numele blocului poate diferi) și nici câmpuri incomplete', () => {
    expect(widget('ACTIVITATI_NOI', ['CAEN'])).toBeNull()
    expect(widget('ACTUALIZARI', ['ASOCIATI_ACTUALIZATI'])).toBeNull()
  })

  it('două spec-uri potrivite în aceeași clauză → randare generică, ca să nu se piardă câmpuri', () => {
    expect(widget('DURATE', ['DURATA_SOCIETATE', 'DURATA_MANDAT'])).toBeNull()
  })
})
