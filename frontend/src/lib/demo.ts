/** Datele fictive după care se recunoaște clientul demo (vezi lib/clientDemo.ts). Fără importuri: le folosește și
 * ghidul, încărcat devreme de lib/api.ts. */

// Serverul recunoaște clientul demo după aceste trei date (billing_credits.is_demo_client — ținute sincron):
// generările pentru el nu consumă credite, iar un membru îl poate șterge. O fișă schimbată pe date reale nu mai e demo.
export const DENUMIRE_DEMO = 'DEMO EXEMPLU SRL'
export const CUI_DEMO = '99999999'
export const NR_REGISTRU_DEMO = 'J40/9999/2020'

export function esteClientDemo(c: { denumire?: unknown; codFiscal?: unknown; nrRegistrul?: unknown }): boolean {
  const denumire = String(c.denumire ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  const cui = String(c.codFiscal ?? '').replace(/^RO/i, '').replace(/\s+/g, '')
  return denumire === DENUMIRE_DEMO && cui === CUI_DEMO && String(c.nrRegistrul ?? '').trim().toUpperCase() === NR_REGISTRU_DEMO
}
