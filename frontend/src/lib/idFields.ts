import type { IDFields } from './api'
import type { Persoana } from '../types'

export const EMPTY_ID_FIELDS: IDFields = {
  cnp: '', nume: '', prenume: '', serie_numar: '',
  data_nasterii: '', locul_nasterii: '', cetatenia: '',
  adresa: '', judet: '', emisa_de: '', valabila_pana_la: '',
}

export function persoanaToIDFields(p: Persoana): IDFields {
  return {
    cnp: p.cnp, nume: p.nume, prenume: p.prenume,
    serie_numar: p.serie_numar, data_nasterii: p.data_nasterii,
    locul_nasterii: p.locul_nasterii, cetatenia: p.cetatenia,
    adresa: p.adresa, judet: p.judet, emisa_de: p.emisa_de,
    valabila_pana_la: p.valabila_pana_la,
  }
}

export function idFieldsToPersoana(f: IDFields, source: Persoana): Persoana {
  return {
    ...source, cnp: f.cnp, nume: f.nume, prenume: f.prenume, serie_numar: f.serie_numar,
    data_nasterii: f.data_nasterii, locul_nasterii: f.locul_nasterii, cetatenia: f.cetatenia,
    adresa: f.adresa, judet: f.judet, emisa_de: f.emisa_de, valabila_pana_la: f.valabila_pana_la,
  }
}
