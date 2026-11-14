import catalogJson from '../../../alerte_catalog.json'

/** Catalogul alertelor: sursă unică, la rădăcina repo-ului, citită și de server (alerte.py). Vezi docs/plan-alerte.md.
 * Setările sunt doar personale; catalogul dă valorile implicite pe rol. */

export type CategorieAlerta = 'clienti' | 'dosare' | 'sarcini' | 'cabinet'

/** termen = cu N zile înainte de o dată (apoi depășit/expirat); vechime = după N zile într-o stare;
 * imediat = cât timp ține starea; eveniment = la o schimbare (asignare, membru nou). */
export type FelAlerta = 'termen' | 'vechime' | 'imediat' | 'eveniment'

export type RolCabinet = 'admin' | 'member' | 'viewer'

/** De la ce dosare/sarcini primește utilizatorul alertele: toate, doar ale lui (responsabil/asignat) sau ale anumitor colegi. */
export type SursaDosare = 'toate' | 'ale_mele' | 'responsabili'

export interface TipAlerta {
  cod: string
  categorie: CategorieAlerta
  fel: FelAlerta
  eticheta: string
  descriere: string
  /** Zile implicite: înainte de termen (fel „termen”, 0 = în ziua termenului) sau vechimea minimă (fel „vechime”). */
  praguri: number[]
  /** Rolurile care pot primi tipul (ex. abonamentul doar adminii). */
  roluri: RolCabinet[]
  /** Rolurile la care tipul e pornit până când utilizatorul își schimbă setările. */
  implicit: RolCabinet[]
  /** Rolurile la care tipul nu se poate opri (ține de accesul la cabinet). */
  obligatoriu: RolCabinet[]
}

export interface CategorieCatalog {
  id: CategorieAlerta
  eticheta: string
  /** Doar la dosare și sarcini: sursa implicită pe rol. */
  sursaImplicita?: Record<RolCabinet, SursaDosare>
}

export interface CatalogAlerte {
  categorii: CategorieCatalog[]
  tipuri: TipAlerta[]
}

export const CATALOG_ALERTE = catalogJson as unknown as CatalogAlerte

export const TIP_ALERTA: Record<string, TipAlerta> = Object.fromEntries(CATALOG_ALERTE.tipuri.map(t => [t.cod, t]))

/** Limitele impuse și de regulile Firestore și de server (alerte.py normalizează la fel). */
export const MAX_PRAGURI = 5
export const MAX_ZILE_PRAG = 365
export const MAX_RESPONSABILI = 50
export const MAX_IGNORATE = 200

// ── Setările personale: workspaces/{wid}/preferinteAlerte/{uid} ─────────────
// Se salvează doar ce diferă de implicitele rolului; un cod sau o categorie lipsă = implicitul din catalog.

/** Alegerea utilizatorului pentru un tip: pornit/oprit și, la „termen”/„vechime”, pragurile lui. */
export interface PreferintaTip {
  activ?: boolean
  praguri?: number[]
}

/** „Vreau alerte de la”, pe categorie (dosare, sarcini). */
export interface PreferintaSursa {
  sursa: SursaDosare
  /** uid-urile colegilor urmăriți, când sursa = 'responsabili' (poate include și propriul uid). */
  responsabili: string[]
}

export interface PreferinteAlerte {
  tipuri: Record<string, PreferintaTip>
  surse: Partial<Record<'dosare' | 'sarcini', PreferintaSursa>>
  /** Ignorări punctuale: o `sursa` întreagă („client:abc” = toate alertele clientului) sau o `cheieBaza`
   * („ci_expira:client:abc:pid123” = doar CI-ul acelei persoane). Se aplică în browser. */
  ignorate: string[]
}

export const PREFERINTE_IMPLICITE: PreferinteAlerte = { tipuri: {}, surse: {}, ignorate: [] }

// ── Alertele: workspaces/{wid}/notificari/{uid}__{cheie} (scrise doar de server) ──

export type SeveritateAlerta = 'info' | 'atentie' | 'urgent'

export interface Notificare {
  /** Id-ul documentului: `${uid}__${cheie}`. */
  id: string
  uid: string
  /** Cheia completă, fără date personale: `cod:sursa[:subId][:termen]`, ex. „mandat_expira:client:abc:pid1:2027-03-01”. */
  cheie: string
  /** Cheia fără data termenului; folosită pentru „nu mă mai anunța pentru această persoană”. */
  cheieBaza: string
  cod: string
  /** Entitatea de care ține: „client:<id>”, „dosar:<id>”, „sarcina:<id>” sau „cabinet”. */
  sursa: string
  severitate: SeveritateAlerta
  /** Pragul atins: număr de zile ca text („30”), „azi”, „depasit”, „expirat”, „imediat”, „eveniment”. */
  prag: string
  titlu: string
  detaliu: string
  /** Ruta din aplicație, ex. „/?open=abc&sectiune=administratori&pid=p1”, „/dosare?open=xyz”, „/sarcini?open=s1”. */
  link: string
  clientId: string | null
  dosarId: string | null
  sarcinaId: string | null
  /** Responsabilul dosarului / asignatul sarcinii (serverul îl folosește pentru „Vreau alerte de la”; aici, informativ). */
  responsabilUid: string | null
  /** Data termenului (ISO yyyy-mm-dd), pentru sortare; null la alertele fără termen. */
  termen: string | null
  eveniment: boolean
  creatLa: Date | null
  actualizatLa: Date | null
  vazut: boolean
  amanatPana: Date | null
  rezolvat: boolean
  rezolvatLa: Date | null
}

/** Câmpurile pe care destinatarul le poate schimba (regulile Firestore permit doar acestea). */
export type NotificareActualizare = Partial<{ vazut: boolean; amanatPana: Date | null }>

export const ORDINE_SEVERITATE: Record<SeveritateAlerta, number> = { urgent: 0, atentie: 1, info: 2 }
