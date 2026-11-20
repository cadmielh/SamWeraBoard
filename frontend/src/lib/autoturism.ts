// Datele unui autovehicul printre câmpurile manuale (CAMP_…) — comodat, vânzare-cumpărare, proces-verbal de predare…
// Se grupează într-o secțiune „Autoturism”, cu etichete clare, sugestii și verificări ușoare, după nume (regulă
// generică, pentru orice șablon). Câmpurile cu nume general (MARCA, CULOARE, PUTERE…) intră în secțiune doar când
// documentul are și un câmp clar de vehicul (VIN, înmatriculare, AUTOTURISM…), ca să nu fie luate din alte contexte.
import { JUDETE_ROMANIA } from './counties'

export interface CampAuto {
  label: string
  sugestii?: string[]
  /** Tastatură numerică pe mobil; valoarea rămâne text liber. */
  numeric?: boolean
  /** Se scrie cu majuscule (VIN, număr de înmatriculare). */
  majuscule?: boolean
  /** Avertisment (nu blochează generarea). */
  verifica?: (v: string) => string | null
}

const VEHICUL_CLAR = /SASIU|(^|_)VIN(_|$)|INMATRICUL|SRPCIV|AUTOTURISM|AUTOVEHICUL|VEHICUL/

const JUDETE_SRPCIV = ['București', ...JUDETE_ROMANIA.filter(j => !j.startsWith('București'))]

export function verificaVin(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (s.length !== 17) return `Seria de șasiu are de obicei 17 caractere (acum ${s.length}).`
  if (/[IOQ]/.test(s)) return 'Seria de șasiu nu conține literele I, O sau Q — verifică dacă nu e 1 sau 0.'
  if (!/^[A-Z0-9]+$/.test(s)) return 'Seria de șasiu are doar litere și cifre.'
  return null
}

// Ordinea contează: primul tipar potrivit câștigă (certificatul de înmatriculare înaintea numărului de înmatriculare).
const REGULI: [RegExp, CampAuto][] = [
  [/SERIE_SASIU|(^|_)VIN(_|$)/, { label: 'Serie șasiu (VIN)', majuscule: true, verifica: verificaVin }],
  [/CERTIFICAT_INMATRICULARE/, { label: 'Nr. certificat de înmatriculare', majuscule: true }],
  [/DATA_PRIMEI_INMATRICULARI/, { label: 'Data primei înmatriculări' }],
  [/(NUMAR|NR)_INMATRICULARE/, { label: 'Număr de înmatriculare', majuscule: true }],
  [/SRPCIV/, { label: 'S.R.P.C.I.V. (județul, completat din nr. de înmatriculare)', sugestii: JUDETE_SRPCIV }],
  [/^MARCA/, { label: 'Marca' }],
  [/^MODEL/, { label: 'Modelul' }],
  [/^CATEGORIE/, { label: 'Categoria', sugestii: ['M1', 'N1', 'autoturism', 'autoutilitară'] }],
  [/CAPACITATE_CILINDRICA/, { label: 'Capacitate cilindrică (cmc)', numeric: true }],
  [/PUTERE/, { label: 'Putere (kW)', numeric: true }],
  [/COMBUSTIBIL/, { label: 'Combustibil', sugestii: ['benzină', 'motorină', 'hibrid benzină', 'hibrid motorină', 'electric', 'benzină + GPL'] }],
  [/CULOARE/, { label: 'Culoare' }],
  [/^VALOARE_.*(AUTOTURISM|AUTOVEHICUL|VEHICUL)/, { label: 'Valoarea autoturismului', numeric: true }],
]

const inner = (ph: string) => ph.replace(/^\{\{CAMP_|\}\}$/g, '')
const regulaPentru = (ph: string) => REGULI.find(([re]) => re.test(inner(ph)))

/** Câmpurile de vehicul ale documentului, în ordinea din document; gol dacă documentul nu are un câmp clar de vehicul. */
export function campuriAutoturism(manualFields: string[]): Map<string, CampAuto> {
  const out = new Map<string, CampAuto>()
  if (!manualFields.some(ph => VEHICUL_CLAR.test(inner(ph)))) return out
  for (const ph of manualFields) {
    const r = regulaPentru(ph)
    // Moneda din nume intră în etichetă: VALOARE_AUTOTURISM_EURO → „Valoarea autoturismului (EURO)”
    const moneda = r?.[1].numeric && inner(ph).match(/_(EURO|EUR|LEI|RON)$/)?.[1]
    if (r) out.set(ph, moneda ? { ...r[1], label: `${r[1].label} (${moneda})` } : r[1])
  }
  return out
}

// Indicativul de județ de pe numărul de înmatriculare → județul S.R.P.C.I.V. care l-a eliberat („B” = București).
const INDICATIVE: Record<string, string> = {
  AB: 'Alba', AR: 'Arad', AG: 'Argeș', BC: 'Bacău', BH: 'Bihor', BN: 'Bistrița-Năsăud', BT: 'Botoșani', BR: 'Brăila',
  BV: 'Brașov', B: 'București', BZ: 'Buzău', CL: 'Călărași', CS: 'Caraș-Severin', CJ: 'Cluj', CT: 'Constanța',
  CV: 'Covasna', DB: 'Dâmbovița', DJ: 'Dolj', GL: 'Galați', GR: 'Giurgiu', GJ: 'Gorj', HR: 'Harghita', HD: 'Hunedoara',
  IL: 'Ialomița', IS: 'Iași', IF: 'Ilfov', MM: 'Maramureș', MH: 'Mehedinți', MS: 'Mureș', NT: 'Neamț', OT: 'Olt',
  PH: 'Prahova', SJ: 'Sălaj', SM: 'Satu Mare', SB: 'Sibiu', SV: 'Suceava', TR: 'Teleorman', TM: 'Timiș', TL: 'Tulcea',
  VL: 'Vâlcea', VS: 'Vaslui', VN: 'Vrancea',
}

/** „CJ 12 ABC”, „B-123-ABC”, „B 012345” (provizoriu) → județul; null pentru numere fără indicativ de județ (MAI, diplomatice…). */
export function judetDinNumar(nr: string): string | null {
  const m = nr.trim().toUpperCase().match(/^([A-Z]{1,2})[\s-]*\d/)
  return m ? INDICATIVE[m[1]] ?? null : null
}

/** Câmpuri de vehicul completate din altele, la schimbarea lui `ph`: județul S.R.P.C.I.V. din numărul de înmatriculare.
 * Rămâne de modificat de mână (ex. o mașină reînmatriculată în alt județ fără schimbarea numărului). */
export function completariAutoturism(manualFields: string[], ph: string, v: string): Record<string, string> {
  if (!/^(NUMAR|NR)_INMATRICULARE/.test(inner(ph))) return {}
  const srpciv = manualFields.find(f => /SRPCIV/.test(inner(f)))
  const judet = judetDinNumar(v)
  return srpciv && judet ? { [srpciv]: judet } : {}
}
