// Logica comună formularelor ONRC dedicate (Anexa 2a — PJ, Anexa 2b — PFA/II/IF): persoane, firma, catalogul de
// mențiuni, rubricile repetate (comunicare, facturare, deponent) și scrierea etichetelor {{<prefix>_…}} în
// `replacements` pentru /fill/docx. Convenții comune în document:
//   - casetele {{…_B_…}} → ☒/☐, opțiunile rotunde {{…_O_…}} → ●/○;
//   - un câmp dintr-un punct ales, rămas gol → „-”; orice câmp dintr-un punct nebifat → puncte, ca în formularul oficial.
import type { Client, Persoana } from '../types'
import type { IDFields } from './api'
import { extractJudet, parseAdresa, splitSerieNumar } from './adresa'
import { cetatenieText } from './cetatenie'

// ── Semne folosite în document ──────────────────────────────────────────────────────────────────────────────────────

const BOX = { da: '☒', nu: '☐' } as const
const CERC = { da: '●', nu: '○' } as const
export const DOTS = '.'.repeat(30)
const DOTS_SCURT = '.'.repeat(8)
const GOL_ACTIV = '-'
// O celulă goală din tabel: un spațiu, nu „” — /fill/docx elimină valorile goale, iar eticheta ar rămâne în document.
const CELULA_GOALA = ' '

// ── Persoane ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PersoanaA2A {
  nume: string; prenume: string; cnp: string
  domLoc: string; domStr: string; domNr: string; domBl: string; domSc: string; domEt: string; domAp: string
  domJud: string; domTara: string
  cet: string
  nastLoc: string; nastJud: string; nastTara: string; nastData: string
  actTip: string; actSeria: string; actNr: string; actEmis: string; actData: string; actValabil: string
}

export const EMPTY_PERSOANA: PersoanaA2A = {
  nume: '', prenume: '', cnp: '',
  domLoc: '', domStr: '', domNr: '', domBl: '', domSc: '', domEt: '', domAp: '', domJud: '', domTara: 'România',
  cet: '',
  nastLoc: '', nastJud: '', nastTara: 'România', nastData: '',
  actTip: 'CI', actSeria: '', actNr: '', actEmis: '', actData: '', actValabil: '',
}

/** Persoana din fișa clientului → câmpurile din formular (adresele sunt text liber în fișă, deci se despart aici). */
export function persoanaDinFisa(p: Persoana): PersoanaA2A {
  const dom = parseAdresa(p.adresa)
  const nastere = parseAdresa(p.locul_nasterii)
  const { serie, numar } = splitSerieNumar(p.serie_numar)
  return {
    nume: p.nume ?? '', prenume: p.prenume ?? '', cnp: p.cnp ?? '',
    domLoc: dom.localitate, domStr: dom.strada, domNr: dom.numar, domBl: dom.bloc, domSc: dom.scara,
    domEt: dom.etaj, domAp: dom.apartament, domJud: p.judet || extractJudet(p.adresa), domTara: 'România',
    cet: cetatenieText(p.cetatenia),
    nastLoc: nastere.localitate, nastJud: extractJudet(p.locul_nasterii), nastTara: 'România', nastData: p.data_nasterii ?? '',
    actTip: 'CI', actSeria: serie, actNr: numar, actEmis: p.emisa_de ?? '',
    actData: p.valabila_de_la ?? '', actValabil: p.valabila_pana_la ?? '',
  }
}

/** Datele citite dintr-un buletin scanat, peste cele deja scrise: un câmp pe care scanarea nu l-a citit rămâne neschimbat. */
export function persoanaDinBuletin(prev: PersoanaA2A, f: IDFields): PersoanaA2A {
  const citit = persoanaDinFisa({ ...f, calitate: '', cotaParticipare: '' })
  const out = { ...prev }
  for (const k of Object.keys(citit) as (keyof PersoanaA2A)[]) {
    // Țara și tipul actului au valori implicite în persoanaDinFisa, nu vin din scanare: nu le suprascriem.
    if (k === 'domTara' || k === 'nastTara' || k === 'actTip') continue
    if (citit[k].trim()) out[k] = citit[k]
  }
  return out
}

export interface PersoanaCandidat {
  id: string
  label: string
  /** Calitatea propusă la punctul IV (ex. „administrator”). */
  calitate: string
  persoana: Persoana
}

// ── Firma ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FirmaA2A {
  firma: string; nrReg: string; cui: string; euid: string
  loc: string; str: string; nr: string; bl: string; sc: string; et: string; ap: string; jud: string
  email: string; tel: string; web: string
}

/** Tribunalul din antet: județul sediului, fără sector, cu majuscule („București - Sector 3” → „BUCUREȘTI”). */
export function tribunalDinJudet(judet: string | undefined | null): string {
  return (judet ?? '').replace(/\s*-\s*sector\s*\d+\s*$/i, '').trim().toLocaleUpperCase('ro-RO')
}

export function firmaDinFisa(client?: Partial<Client> | null): FirmaA2A {
  const s = client?.sediuSocial
  const nrReg = client?.nrRegistrul?.trim() ?? ''
  return {
    firma: client?.denumire ?? '', nrReg, cui: client?.codFiscal?.trim() ?? '', euid: nrReg ? `ROONRC.${nrReg}` : '',
    loc: s?.localitate ?? '', str: s?.strada ?? '', nr: s?.numar ?? '', bl: s?.bloc ?? '', sc: s?.scara ?? '',
    et: s?.etaj ?? '', ap: s?.apartament ?? '', jud: s?.judet ?? '',
    email: client?.email ?? '', tel: client?.telefon ?? '', web: '',
  }
}

// ── Catalogul de mențiuni și acte (4.1/4.2 la 2a, 2.1/2.2 la 2b) ───────────────────────────────────────────────────
// Etichetele: caseta proprie <prefix>_B_<box>, opțiunile <prefix>_O_<tag> (rotunde) sau _B_<tag> (casete), textele _T_<tag>.

export interface OptiuneCatalog { tag: string; label: string }
export interface GrupOptiuni { optiuni: OptiuneCatalog[]; simbol: 'O' | 'B'; multi: boolean }
export interface TextCatalog { tag: string; label: string; scurt?: boolean; /** apare doar când e aleasă această opțiune */ pentru?: string }
export interface ElementCatalog {
  id: string
  label: string
  /** Caseta proprie a rândului. Lipsește la rândurile alcătuite doar din casete (ex. „Suspendare / Reluare”). */
  box?: string
  grupuri?: GrupOptiuni[]
  texte?: TextCatalog[]
  nota?: string
}
export interface GrupCatalog { titlu: string; elemente: ElementCatalog[] }

export const optiune = (tag: string, label: string): OptiuneCatalog => ({ tag, label })

export interface ElementStare { on: boolean; optiuni: string[]; texte: Record<string, string> }
export type CatalogStare = Record<string, ElementStare>

/** Un rând e ales dacă are caseta bifată sau, la rândurile fără casetă proprie, măcar o opțiune aleasă. */
export function elementAles(el: ElementCatalog, st: ElementStare | undefined): boolean {
  if (!st) return false
  return el.box ? st.on : st.optiuni.length > 0
}

export function elementeAlese(catalog: GrupCatalog[], stare: CatalogStare): ElementCatalog[] {
  return catalog.flatMap(g => g.elemente).filter(el => elementAles(el, stare[el.id]))
}

// ── Rubricile comune: comunicare, facturare, deponent, opis ─────────────────────────────────────────────────────────

export interface ComunicareOnrc {
  sursa: 'sub' | 'manual'
  nume: string; prenume: string; loc: string; str: string; nr: string; bl: string; sc: string; et: string; ap: string; jud: string
  cp: string; tel: string; email: string
}
export const comunicareGoala = (): ComunicareOnrc => ({
  sursa: 'sub', nume: '', prenume: '', loc: '', str: '', nr: '', bl: '', sc: '', et: '', ap: '', jud: '', cp: '', tel: '', email: '',
})

export interface FacturareOnrc {
  sursa: 'firma' | 'sub' | 'manual' | 'niciuna'
  nume: string; cnpCui: string; email: string; banca: string; iban: string; adresa: string
}
export const facturareGoala = (sursa: FacturareOnrc['sursa']): FacturareOnrc => ({ sursa, nume: '', cnpCui: '', email: '', banca: '', iban: '', adresa: '' })

export interface DeponentOnrc {
  activ: boolean
  nume: string; prenume: string; actTip: string; actSeria: string; actNr: string; cnp: string
  calitate: string; conform: string; conformNr: string; conformData: string
}
export const deponentGol = (): DeponentOnrc => ({
  activ: false, nume: '', prenume: '', actTip: 'CI', actSeria: '', actNr: '', cnp: '', calitate: '', conform: '', conformNr: '', conformData: '',
})

/** Persoana pentru comunicare, după sursa aleasă: subsemnatul (IV) sau introdusă de mână. */
export function persoanaComunicare(s: { com: ComunicareOnrc; sub: PersoanaA2A }): ComunicareOnrc {
  if (s.com.sursa === 'manual') return s.com
  return {
    ...s.com,
    nume: s.sub.nume, prenume: s.sub.prenume, loc: s.sub.domLoc, str: s.sub.domStr, nr: s.sub.domNr, bl: s.sub.domBl,
    sc: s.sub.domSc, et: s.sub.domEt, ap: s.sub.domAp, jud: s.sub.domJud,
  }
}

export const adresaText = (parts: [string, string][]) => parts.filter(([, v]) => v.trim()).map(([k, v]) => k ? `${k} ${v}` : v).join(', ')

/** Domiciliul unei persoane, pe un rând („Cluj-Napoca, str. Florilor, nr. 2, jud. Cluj”). */
export const domiciliuText = (p: PersoanaA2A) =>
  adresaText([['', p.domLoc], ['str.', p.domStr], ['nr.', p.domNr], ['bl.', p.domBl], ['sc.', p.domSc], ['et.', p.domEt], ['ap.', p.domAp], ['jud.', p.domJud]])

/** Datele de facturare, după sursă: firma, subsemnatul (IV), introduse de mână sau deloc (factura pe plătitor). */
export function dateFacturare(s: { fact: FacturareOnrc; firma: FirmaA2A; sub: PersoanaA2A }): FacturareOnrc {
  const f = s.firma
  if (s.fact.sursa === 'firma') {
    return {
      ...s.fact, nume: f.firma, cnpCui: f.cui, email: f.email,
      adresa: adresaText([['', f.loc], ['str.', f.str], ['nr.', f.nr], ['bl.', f.bl], ['sc.', f.sc], ['et.', f.et], ['ap.', f.ap], ['jud.', f.jud]]),
    }
  }
  if (s.fact.sursa === 'sub') {
    const p = s.sub
    return { ...s.fact, nume: `${p.nume} ${p.prenume}`.trim(), cnpCui: p.cnp, adresa: domiciliuText(p) }
  }
  return s.fact
}

/** Totalul de file din opis: suma rândurilor completate cu numere; gol dacă niciun rând nu are număr. */
export function totalFile(randuri: { file: string }[]): string {
  const nums = randuri.map(r => r.file.trim()).filter(v => /^\d+$/.test(v)).map(Number)
  return nums.length ? String(nums.reduce((a, b) => a + b, 0)) : ''
}

// ── Subsemnatul (IV) ────────────────────────────────────────────────────────────────────────────────────────────────

export interface SubsemnatStare {
  subSursa: string; sub: PersoanaA2A; subRegim: string; subCalitate: string; subPrin: string; subConform: string
}

// ── Validare ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VerificareOnrc<S extends string> { invalid: boolean; id: string; message: string; sectiune: S }

export const cnpOk = (v: string) => /^\d{13}$/.test(v.trim())

export function verificariSubsemnat<S extends string>(s: SubsemnatStare, sectiune: S): VerificareOnrc<S>[] {
  return [
    { invalid: !s.sub.nume.trim(), id: 'sub-nume', message: 'numele subsemnatului (IV)', sectiune },
    { invalid: !s.sub.prenume.trim(), id: 'sub-prenume', message: 'prenumele subsemnatului (IV)', sectiune },
    { invalid: !s.sub.cnp.trim(), id: 'sub-cnp', message: 'CNP-ul subsemnatului (IV)', sectiune },
    { invalid: !s.subCalitate.trim(), id: 'sub-calitate', message: 'calitatea subsemnatului (IV)', sectiune },
  ]
}

/** Firma și localitatea/județul sediului (social la PJ, profesional la PFA/II/IF). */
export function verificariFirma<S extends string>(f: FirmaA2A, sediu: string, sectiune: S): VerificareOnrc<S>[] {
  return [
    { invalid: !f.firma.trim(), id: 'firma-denumire', message: 'denumirea firmei', sectiune },
    { invalid: !f.loc.trim(), id: 'firma-loc', message: `localitatea ${sediu}`, sectiune },
    { invalid: !f.jud.trim(), id: 'firma-jud', message: `județul ${sediu}`, sectiune },
  ]
}

// ── Scrierea etichetelor ────────────────────────────────────────────────────────────────────────────────────────────

/** Scrierea etichetelor unui formular ONRC ({{<prefix>_…}}) în `r`, cu convențiile comune Anexelor 2a și 2b. */
export function scriitorOnrc(prefix: string) {
  const r: Record<string, string> = {}
  const box = (tag: string, on: boolean) => { r[`{{${prefix}_B_${tag}}}`] = on ? BOX.da : BOX.nu }
  const cerc = (tag: string, on: boolean) => { r[`{{${prefix}_O_${tag}}}`] = on ? CERC.da : CERC.nu }
  /** Câmp text: în punctul ales, gol → „-”; în afara lui → puncte. */
  const txt = (tag: string, v: string | undefined, activ: boolean, scurt = false) => {
    const val = (v ?? '').trim()
    r[`{{${prefix}_${tag}}}`] = !activ ? (scurt ? DOTS_SCURT : DOTS) : (val || GOL_ACTIV)
  }
  /** Câmp care, chiar și în punctul ales, rămâne de completat de mână dacă e gol (număr, mențiune). */
  const txtManual = (tag: string, v: string | undefined, activ: boolean, scurt = false) => {
    const val = (v ?? '').trim()
    r[`{{${prefix}_${tag}}}`] = activ && val ? val : (scurt ? DOTS_SCURT : DOTS)
  }
  /** Celulă de tabel (opis, coduri CAEN): goală rămâne goală, ca în formular. */
  const celula = (tag: string, v: string | undefined) => { r[`{{${prefix}_${tag}}}`] = (v ?? '').trim() || CELULA_GOALA }
  const persoana = (pre: string, p: PersoanaA2A, activ: boolean) => {
    const scurt = new Set(['domNr', 'domBl', 'domSc', 'domEt', 'domAp', 'actSeria'])
    const map: [keyof PersoanaA2A, string][] = [
      ['nume', 'NUME'], ['prenume', 'PRENUME'], ['cnp', 'CNP'],
      ['domLoc', 'DOM_LOC'], ['domStr', 'DOM_STR'], ['domNr', 'DOM_NR'], ['domBl', 'DOM_BL'], ['domSc', 'DOM_SC'],
      ['domEt', 'DOM_ET'], ['domAp', 'DOM_AP'], ['domJud', 'DOM_JUD'], ['domTara', 'DOM_TARA'], ['cet', 'CET'],
      ['nastLoc', 'NAST_LOC'], ['nastJud', 'NAST_JUD'], ['nastTara', 'NAST_TARA'], ['nastData', 'NAST_DATA'],
      ['actTip', 'ACT_TIP'], ['actSeria', 'ACT_SERIA'], ['actNr', 'ACT_NR'], ['actEmis', 'ACT_EMIS'],
      ['actData', 'ACT_DATA'], ['actValabil', 'ACT_VALABIL'],
    ]
    for (const [k, tag] of map) txt(`${pre}_${tag}`, p[k], activ, scurt.has(k))
  }
  /** „pentru firma …”: la înmatriculare/înregistrare (`cuNrReg` fals) firma nu are încă nr. de înregistrare, CUI, EUID. */
  const firmaBlock = (pre: string, f: FirmaA2A, activ: boolean, cuNrReg = true) => {
    txt(`${pre}_FIRMA`, f.firma, activ)
    if (cuNrReg) {
      txt(`${pre}_NRREG`, f.nrReg, activ)
      txt(`${pre}_CUI`, f.cui, activ)
      txt(`${pre}_EUID`, f.euid, activ)
    }
    txt(`${pre}_LOC`, f.loc, activ); txt(`${pre}_STR`, f.str, activ)
    txt(`${pre}_NR`, f.nr, activ, true); txt(`${pre}_BL`, f.bl, activ, true); txt(`${pre}_SC`, f.sc, activ, true)
    txt(`${pre}_ET`, f.et, activ, true); txt(`${pre}_AP`, f.ap, activ, true); txt(`${pre}_JUD`, f.jud, activ)
    txt(`${pre}_EMAIL`, f.email, activ); txt(`${pre}_TEL`, f.tel, activ); txt(`${pre}_WEB`, f.web, activ)
  }
  /** Casetele, opțiunile și textele unui catalog de mențiuni/acte. */
  const catalog = (cat: GrupCatalog[], stare: CatalogStare, activ: boolean) => {
    for (const el of cat.flatMap(g => g.elemente)) {
      const st = stare[el.id]
      const ales = activ && elementAles(el, st)
      if (el.box) box(el.box, ales)
      for (const g of el.grupuri ?? []) {
        for (const opt of g.optiuni) {
          const on = ales && !!st?.optiuni.includes(opt.tag)
          if (g.simbol === 'O') cerc(opt.tag, on); else box(opt.tag, on)
        }
      }
      for (const t of el.texte ?? []) {
        const vizibil = ales && (!t.pentru || !!st?.optiuni.includes(t.pentru))
        txtManual(`T_${t.tag}`, st?.texte[t.tag], vizibil, t.scurt)
      }
    }
  }
  /** Punctul IV: persoana, regimul matrimonial, calitatea, „prin” și „conform”. */
  const subsemnat = (st: SubsemnatStare) => {
    persoana('SUB', st.sub, true)
    txt('SUB_REGIM', st.subRegim, true); txt('SUB_CALITATE', st.subCalitate, true)
    txt('SUB_PRIN', st.subPrin, true); txt('SUB_CONFORM', st.subConform, true)
  }
  /** Persoana pentru comunicare (deja rezolvată cu persoanaComunicare). */
  const comunicare = (com: ComunicareOnrc) => {
    txt('COM_NUME', com.nume, true); txt('COM_PRENUME', com.prenume, true)
    txt('COM_LOC', com.loc, true); txt('COM_STR', com.str, true); txt('COM_NR', com.nr, true, true)
    txt('COM_BL', com.bl, true, true); txt('COM_SC', com.sc, true, true); txt('COM_ET', com.et, true, true)
    txt('COM_AP', com.ap, true, true); txt('COM_JUD', com.jud, true); txt('COM_CP', com.cp, true)
    txt('COM_TEL', com.tel, true); txt('COM_EMAIL', com.email, true)
  }
  /** Datele de facturare (deja rezolvate cu dateFacturare); „niciuna”: rubrica rămâne punctată, factura e pe plătitor. */
  const facturare = (fact: FacturareOnrc) => {
    const activ = fact.sursa !== 'niciuna'
    txt('FACT_NUME', fact.nume, activ); txt('FACT_CNP_CUI', fact.cnpCui, activ); txt('FACT_EMAIL', fact.email, activ)
    txt('FACT_BANCA', fact.banca, activ); txt('FACT_IBAN', fact.iban, activ); txt('FACT_ADRESA', fact.adresa, activ)
  }
  /** Deponentul — doar dacă e altă persoană decât semnatarul. */
  const deponent = (d: DeponentOnrc, dataSemnare: string) => {
    const a = d.activ
    txt('DEP_NUME', d.nume, a); txt('DEP_PRENUME', d.prenume, a); txt('DEP_ACT_TIP', d.actTip, a, true)
    txt('DEP_ACT_SERIA', d.actSeria, a, true); txt('DEP_ACT_NR', d.actNr, a, true); txt('DEP_CNP', d.cnp, a)
    txt('DEP_CALITATE', d.calitate, a); txt('DEP_CONFORM', d.conform, a)
    txtManual('DEP_CONFORM_NR', d.conformNr, a, true); txtManual('DEP_CONFORM_DATA', d.conformData, a)
    txtManual('DEP_DATA', a ? dataSemnare : '', a)
  }
  return { r, box, cerc, txt, txtManual, celula, persoana, firmaBlock, catalog, subsemnat, comunicare, facturare, deponent }
}
