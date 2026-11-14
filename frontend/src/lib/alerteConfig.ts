import {
  CATALOG_ALERTE, MAX_IGNORATE, MAX_PRAGURI, MAX_RESPONSABILI, MAX_ZILE_PRAG, TIP_ALERTA,
  type FelAlerta, type PreferintaSursa, type PreferintaTip, type PreferinteAlerte, type RolCabinet, type SursaDosare, type TipAlerta,
} from './alerteCatalog'

/** Setările personale ale alertelor: implicitele rolului din catalog combinate cu ce a salvat utilizatorul
 * (workspaces/{wid}/preferinteAlerte/{uid}), curățate la aceleași limite ca regulile Firestore și serverul. Funcții pure. */

/** Categoriile cu filtrul „Vreau alerte de la”. */
export type CategorieSursa = 'dosare' | 'sarcini'
export const CATEGORII_SURSA: CategorieSursa[] = ['dosare', 'sarcini']

const SURSE: SursaDosare[] = ['toate', 'ale_mele', 'responsabili']

/** Doar tipurile „termen” și „vechime” au praguri; „termen” acceptă 0 (în ziua termenului), „vechime” pornește de la 1. */
export function arePraguri(fel: FelAlerta): boolean {
  return fel === 'termen' || fel === 'vechime'
}

/** Praguri curate: numere întregi, aduse în limite, fără dubluri, descrescător, cel mult MAX_PRAGURI. */
export function normalizeazaPraguri(fel: FelAlerta, praguri: unknown): number[] {
  if (!arePraguri(fel) || !Array.isArray(praguri)) return []
  const min = fel === 'vechime' ? 1 : 0
  const curate = praguri
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    .map(p => Math.min(MAX_ZILE_PRAG, Math.max(min, Math.trunc(p))))
  return [...new Set(curate)].sort((a, b) => b - a).slice(0, MAX_PRAGURI)
}

const egale = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Lista de uid-uri curată: texte nevide, fără dubluri, cel mult MAX_RESPONSABILI. */
export function responsabiliCurati(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, MAX_RESPONSABILI) : []
}

/** Tipurile din catalog pe care rolul le poate primi, în ordinea catalogului. */
export function tipuriPentruRol(role: RolCabinet | null | undefined): TipAlerta[] {
  return role ? CATALOG_ALERTE.tipuri.filter(t => t.roluri.includes(role)) : []
}

export interface PreferintaEfectiva {
  activ: boolean
  praguri: number[]
  /** Nu se poate opri (ține de accesul la cabinet). */
  obligatoriu: boolean
  /** Diferă de implicitul rolului. */
  modificat: boolean
}

/** Ce se aplică efectiv pentru un tip: implicitul rolului, peste care se pune ce a salvat utilizatorul. */
export function preferintaEfectiva(tip: TipAlerta, prefs: PreferinteAlerte, role: RolCabinet): PreferintaEfectiva {
  const obligatoriu = tip.obligatoriu.includes(role)
  const activImplicit = obligatoriu || tip.implicit.includes(role)
  const salvat: PreferintaTip | undefined = prefs.tipuri[tip.cod]
  const activ = obligatoriu ? true : (typeof salvat?.activ === 'boolean' ? salvat.activ : activImplicit)
  const pragImplicit = normalizeazaPraguri(tip.fel, tip.praguri)
  // Un tip cu praguri nu poate rămâne fără niciunul (n-ar mai apărea niciodată): revine la cele din catalog.
  const pragSalvat = normalizeazaPraguri(tip.fel, salvat?.praguri)
  const praguri = pragSalvat.length ? pragSalvat : pragImplicit
  return { activ, praguri, obligatoriu, modificat: activ !== activImplicit || !egale(praguri, pragImplicit) }
}

/** Sursa implicită a rolului pentru o categorie (din catalog); „toate” dacă lipsește. */
export function sursaImplicita(categorie: CategorieSursa, role: RolCabinet): SursaDosare {
  return CATALOG_ALERTE.categorii.find(c => c.id === categorie)?.sursaImplicita?.[role] ?? 'toate'
}

/** „Vreau alerte de la” efectiv: ce a salvat utilizatorul, altfel implicitul rolului. */
export function sursaEfectiva(categorie: CategorieSursa, prefs: PreferinteAlerte, role: RolCabinet): PreferintaSursa {
  const salvat = prefs.surse[categorie]
  if (salvat && SURSE.includes(salvat.sursa)) return { sursa: salvat.sursa, responsabili: responsabiliCurati(salvat.responsabili) }
  return { sursa: sursaImplicita(categorie, role), responsabili: [] }
}

/** Preferințele de salvat: doar ce diferă de implicitele rolului. Codurile necunoscute (sau pe care rolul nu le poate
 * primi) și valorile greșite se elimină; „ignorate” rămâne, curățată. */
export function curataPreferinte(prefs: PreferinteAlerte, role: RolCabinet): PreferinteAlerte {
  const tipuri: Record<string, PreferintaTip> = {}
  for (const [cod, v] of Object.entries(prefs.tipuri ?? {})) {
    const tip = TIP_ALERTA[cod]
    if (!tip || !tip.roluri.includes(role) || !v || typeof v !== 'object') continue
    const obligatoriu = tip.obligatoriu.includes(role)
    const intrare: PreferintaTip = {}
    if (!obligatoriu && typeof v.activ === 'boolean' && v.activ !== tip.implicit.includes(role)) intrare.activ = v.activ
    const praguri = normalizeazaPraguri(tip.fel, v.praguri)
    if (praguri.length && !egale(praguri, normalizeazaPraguri(tip.fel, tip.praguri))) intrare.praguri = praguri
    if (Object.keys(intrare).length) tipuri[cod] = intrare
  }
  const surse: PreferinteAlerte['surse'] = {}
  for (const cat of CATEGORII_SURSA) {
    if (!prefs.surse?.[cat]) continue
    const s = sursaEfectiva(cat, prefs, role)
    if (s.sursa === 'responsabili') surse[cat] = s
    else if (s.sursa !== sursaImplicita(cat, role)) surse[cat] = { sursa: s.sursa, responsabili: [] }
  }
  const ignorate = Array.isArray(prefs.ignorate)
    ? [...new Set(prefs.ignorate.filter(x => typeof x === 'string' && x.length > 0))].slice(-MAX_IGNORATE)
    : []
  return { tipuri, surse, ignorate }
}

/** Utilizatorul a schimbat ceva față de implicitele rolului (tipuri sau surse; ignorările nu contează)? */
export function areModificari(prefs: PreferinteAlerte, role: RolCabinet): boolean {
  const c = curataPreferinte(prefs, role)
  return Object.keys(c.tipuri).length > 0 || Object.keys(c.surse).length > 0
}

/** „7 zile”, „o zi”, „30 de zile” — cu „de” de la 20 în sus, ca în română. */
export function zileText(n: number): string {
  if (n === 1) return 'o zi'
  return n % 100 === 0 || n % 100 >= 20 ? `${n} de zile` : `${n} zile`
}

/** Unitatea pentru ultimul număr dintr-o enumerare: „zi” / „zile” / „de zile”. */
function unitate(n: number): string {
  if (n === 1) return 'zi'
  return n % 100 === 0 || n % 100 >= 20 ? 'de zile' : 'zile'
}

function enumera(parti: string[]): string {
  if (parti.length <= 1) return parti.join('')
  return `${parti.slice(0, -1).join(', ')} și ${parti[parti.length - 1]}`
}

/** Numere urmate de unitatea ultimului („90, 30 și 7 zile”); „1 zi” la final își păstrează unitatea („7, 3 zile și 1 zi”). */
function numereCuZile(nr: number[]): string {
  if (nr.length === 0) return ''
  const ultim = nr[nr.length - 1]
  if (nr.length > 1 && ultim === 1) {
    const restul = nr.slice(0, -1)
    return `${restul.join(', ')} ${unitate(restul[restul.length - 1])} și 1 zi`
  }
  return `${enumera(nr.map(String))} ${unitate(ultim)}`
}

/** Când apare alerta, pe scurt: „90, 30 și 7 zile înainte”, „în ziua termenului”, „după 14 zile”, „imediat”, „la eveniment”. */
export function descrierePraguri(tip: Pick<TipAlerta, 'fel'>, praguri: number[]): string {
  if (tip.fel === 'imediat') return 'imediat'
  if (tip.fel === 'eveniment') return 'la eveniment'
  const p = normalizeazaPraguri(tip.fel, praguri)
  if (tip.fel === 'vechime') {
    return p.length ? `după ${numereCuZile([...p].reverse())}` : ''
  }
  const inainte = p.filter(x => x > 0)
  const inZiua = p.includes(0)
  if (!inainte.length) return inZiua ? 'în ziua termenului' : ''
  const text = `${numereCuZile(inainte)} înainte`
  return inZiua ? `${text}, apoi în ziua termenului` : text
}
