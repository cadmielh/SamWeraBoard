// Parsare/formatare best-effort a adreselor românești în componente separate
// (localitate, stradă, număr, bloc, scară, etaj, apartament, județ) — folosit
// atât pentru sediul social al clienților (Client.sediuSocial), cât și pentru
// domiciliul declarantului din Declarația de activitate ONRC.
import { JUDETE_ROMANIA } from './counties'

export interface AdresaStructurata {
  localitate: string
  strada: string
  numar: string
  bloc: string
  scara: string
  etaj: string
  apartament: string
  judet: string
}

export const EMPTY_ADRESA: AdresaStructurata = {
  localitate: '', strada: '', numar: '', bloc: '', scara: '', etaj: '', apartament: '', judet: '',
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Litere care pot apărea fie cu diacritic corect, fie într-o formă OCR/tastare
// alternativă des întâlnită (fără diacritic, sau cu sedilă în loc de virgulă
// dedesubt) — folosit ca să potrivim "Timiș"/"Timis" și "Brăila"/"Braila" cu
// același pattern, direct pe textul original (fără normalizare prealabilă).
const DIACRITIC_CLASS: Record<string, string> = {
  a: 'aăâ', ă: 'aăâ', â: 'aăâ',
  i: 'iî', î: 'iî',
  s: 'sșş', ș: 'sșş', ş: 'sșş',
  t: 'tțţ', ț: 'tțţ', ţ: 'tțţ',
}

function diacriticInsensitiveSource(word: string): string {
  return word.toLowerCase().split('').map(ch => {
    const cls = DIACRITIC_CLASS[ch]
    return cls ? `[${cls}]` : escapeRegExp(ch)
  }).join('')
}

/** Caută în text un nume de județ din lista canonică (diacritic-insensitiv,
 * tolerant la prefixe gen "jud.", "județul") — folosit atât pentru sediul
 * social, cât și pentru domiciliul/locul nașterii declarantului.
 *
 * "Sector N" e verificat separat, înaintea listei — sectoarele există doar
 * în București, deci mențiunea e suficient de specifică prin ea însăși; nu e
 * nevoie ca și "București" să apară alături (textele ANAF le pun adesea în
 * ordine sau formulare diferite, ex. "Sector 6 Mun. București", nu
 * "București - Sector 6" cum apare în lista canonică) — altfel potrivirea
 * genericului "București" din listă ar câștiga primă, mai puțin precisă.
 */
export function extractJudet(text?: string | null): string {
  if (!text) return ''
  const sectorMatch = text.match(/\bsector\s*([1-6])\b/i)
  if (sectorMatch) {
    const sectorLabel = `București - Sector ${sectorMatch[1]}`
    if (JUDETE_ROMANIA.includes(sectorLabel)) return sectorLabel
  }
  for (const judet of JUDETE_ROMANIA) {
    if (new RegExp(`\\b${diacriticInsensitiveSource(judet)}\\b`, 'i').test(text)) return judet
  }
  return ''
}

const LABEL_PREFIXES: Partial<Record<keyof AdresaStructurata, RegExp>> = {
  strada: /^(?:str\.?|strada)\s+/i,
  numar: /^(?:nr\.?|num[ăa]rul?)\s*/i,
  localitate: /^(?:mun\.?|municipiul|com\.?|comuna|ora[șş]|ora[șş]ul|sat\.?|satul)\s+/i,
}

/**
 * Curăță o etichetă redundantă ("Str.", "Nr.", "Municipiul"...) dintr-o
 * componentă de adresă venită deja izolată dintr-o sursă externă (ex. ANAF
 * întoarce uneori `sdenumire_Strada: "Str. Exemplu"` în loc de doar
 * "Exemplu") — spre deosebire de `parseAdresa`, care extrage componente
 * dintr-un text liber nesegmentat, aici pornim deja de la un singur câmp și
 * doar îi scoatem eticheta, dacă există.
 *
 * Pentru `localitate`, ANAF poate include și mențiunea sectorului chiar în
 * acest câmp (ex. "Sector 6 Mun. București") — sectorul e deja reflectat
 * separat în Județ/Sector (vezi extractJudet), deci se elimină de aici
 * oriunde ar apărea, nu doar ca prefix, ca să nu rămână dublat.
 */
export function stripAdresaLabel(field: keyof AdresaStructurata, value?: string | null): string {
  if (!value) return ''
  let v = value.trim()
  if (field === 'localitate') {
    v = v.replace(/\bsector\s*\d\b/gi, '').replace(/\s{2,}/g, ' ').trim().replace(/^[,-]+|[,-]+$/g, '').trim()
  }
  const re = LABEL_PREFIXES[field]
  return re ? v.replace(re, '').trim() : v
}

const LABELED_PARTS: { key: keyof AdresaStructurata; re: RegExp }[] = [
  { key: 'numar', re: /\bnr\.?\s*([^\s,]+)/i },
  { key: 'bloc', re: /\b(?:bl\.?|bloc)\s*([^\s,]+)/i },
  { key: 'scara', re: /\b(?:sc\.?|scara)\s*([^\s,]+)/i },
  { key: 'etaj', re: /\b(?:et\.?|etaj)\s*([^\s,]+)/i },
  { key: 'apartament', re: /\b(?:ap\.?|apartament)\s*([^\s,]+)/i },
]

/**
 * Parsare best-effort a unei adrese românești în componente. Tot ce nu se
 * potrivește unei etichete recunoscute (Str./Nr./Bl./Sc./Et./Ap./jud.) cade în
 * `localitate` — informația nu se pierde, doar ajunge în câmpul "greșit",
 * ușor de mutat manual (câmpurile rămân editabile în formular).
 */
export function parseAdresa(text?: string | null): AdresaStructurata {
  if (!text) return { ...EMPTY_ADRESA }
  let rest = text

  // Scoate județul/sectorul înainte de orice altceva, ca să nu polueze
  // "localitate" — județul are propriul câmp în șablon (extractJudet separat).
  const judet = extractJudet(rest)
  if (judet) {
    rest = rest.replace(new RegExp(`\\b(?:jud(?:e[tț]ul)?\\.?\\s*)?${diacriticInsensitiveSource(judet)}\\b`, 'i'), '')
  }
  rest = rest.replace(/\bsector\s*\d\b/i, '')

  const result: AdresaStructurata = { ...EMPTY_ADRESA, judet }
  for (const { key, re } of LABELED_PARTS) {
    const m = rest.match(re)
    if (m && m.index !== undefined) {
      result[key] = m[1].trim()
      rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length)
    }
  }

  // Strada: eticheta explicită dacă există, altfel textul rămas (mai puțin
  // sigur, dar mai bine decât un câmp gol) — comuna/localitatea rămâne oricum
  // recognoscibilă lângă ea și userul o poate corecta din formular.
  const stradaMatch = rest.match(/\b(?:str\.?|strada)\s*([^,]*)/i)
  if (stradaMatch) {
    result.strada = stradaMatch[1].trim()
    rest = rest.slice(0, stradaMatch.index) + rest.slice((stradaMatch.index ?? 0) + stradaMatch[0].length)
  }

  result.localitate = rest
    .split(',')
    .map(p => p.trim().replace(/^(?:mun\.?|municipiul|com\.?|comuna|ora[șş]|ora[șş]ul)\s+/i, '').trim())
    .filter(Boolean)
    .join(', ')

  return result
}

// Tipuri de arteră deja prezente ca text în valoarea stradă (Șoseaua,
// Bulevardul, Calea, Aleea, Intrarea, Piața, Drumul) — dacă unul dintre ele e
// deja acolo, formatAdresa nu mai adaugă și eticheta generică "Str." peste el.
const STREET_TYPE_RE = /^(?:str\.?|strada|[sșş]os\.?|[sșş]oseaua|bd\.?|bulevardul|calea|aleea|intrarea|pia[tțţ]a|drumul)\s/i

/** Inversul lui parseAdresa — reasamblează într-un singur șir liber de
 * adresă, în formatul standard (Județ, Localitate, Str./nr./bl./sc./et./ap.)
 * pe care parseAdresa știe deja să-l descompună, dacă adresa mai e reeditată
 * ulterior. Omite orice componentă necompletată. */
export function formatAdresa(a: AdresaStructurata): string {
  const parts: string[] = []
  if (a.judet) parts.push(a.judet)
  if (a.localitate) parts.push(a.localitate)
  if (a.strada) parts.push(STREET_TYPE_RE.test(a.strada) ? a.strada : `Str. ${a.strada}`)
  if (a.numar) parts.push(`nr. ${a.numar}`)
  if (a.bloc) parts.push(`bl. ${a.bloc}`)
  if (a.scara) parts.push(`sc. ${a.scara}`)
  if (a.etaj) parts.push(`et. ${a.etaj}`)
  if (a.apartament) parts.push(`ap. ${a.apartament}`)
  return parts.join(', ')
}

/** Formatul standard CI: literă(e) + cifre, ex. "TM 123456" → { serie: "TM", numar: "123456" }. */
export function splitSerieNumar(serieNumar?: string | null): { serie: string; numar: string } {
  if (!serieNumar) return { serie: '', numar: '' }
  const m = serieNumar.trim().match(/^([A-ZȘȚ]{1,3})\s*-?\s*(\d+)$/i)
  if (!m) return { serie: '', numar: serieNumar.trim() }
  return { serie: m[1].toUpperCase(), numar: m[2] }
}
