/** Identitatea Furnizorului serviciului — SINGURUL loc de completat pentru documentele legale.
 *
 * Nu depinde de cabinetele care folosesc aplicația: paginile legale se aplică identic oricărui cabinet
 * (acesta apare în texte doar ca „Operator”). Aici se pune o singură dată cine oferă serviciul.
 * Câmpurile goale sunt omise din pagini (nu apar paranteze sau texte de completat).
 *
 * Legea cere identificarea furnizorului (art. 13 GDPR, Legea 365/2002), deci înainte de lansarea către
 * cabinete completați cel puțin `legalName`, `address` și `contactEmail`.
 */
export const PROVIDER = {
  /** Numele serviciului, afișat în texte. */
  serviceName: 'Cabinio',
  /** Denumirea completă a furnizorului (ex.: „EXEMPLU SRL” sau numele persoanei fizice autorizate). */
  legalName: 'HOLHOȘ CADMIEL-GEORGEL PFA',
  /** CUI / nr. de înregistrare (ex.: „RO12345678, J40/123/2020”). */
  registration: 'CUI 53465872',
  /** Sediul. */
  address: 'Sat Dumbrăvița, Com. Dumbrăvița, Str. Rodiei, Nr. 19, Jud. Timiș',
  /** Contact general și pentru protecția datelor (cereri ale persoanelor vizate, întrebări despre DPA). */
  contactEmail: 'hcadmiel@gmail.com',
  /** Raportarea vulnerabilităților/incidentelor; dacă lipsește se folosește `contactEmail`. */
  securityEmail: '',
} as const

export const LEGAL_UPDATED = '19 septembrie 2026'

export function providerName(): string {
  return PROVIDER.legalName || PROVIDER.serviceName
}

export function contactEmail(): string {
  return PROVIDER.contactEmail
}

export function securityEmail(): string {
  return PROVIDER.securityEmail || PROVIDER.contactEmail
}
