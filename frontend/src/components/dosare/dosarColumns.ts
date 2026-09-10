import type { Dosar, FacturareConfig } from '../../types'
import { STADIU_DOSAR_LABELS, obiecteCereriiText, DEFAULT_FACTURARE_CONFIG } from '../../types'
import { calculDosarFinanciar } from '../../lib/dosareStats'
import { toDateSafe, formatDateRo } from '../../lib/dates'

/* ── Column definitions — același tipar ca ClientiPage.tsx, pentru consistență ── */
export interface ColDef {
  key: string
  label: string
  width: number
  fixed?: boolean
  sortable?: boolean
  filterable?: boolean
}

export const COLUMNS: ColDef[] = [
  { key: 'clientDenumire',     label: 'Client',            width: 200, fixed: true, sortable: true,  filterable: true  },
  { key: 'createdAt',          label: 'Data creării',      width: 120, sortable: true,  filterable: true  },
  { key: 'clientCui',          label: 'CUI',                width: 120, sortable: true,  filterable: true  },
  { key: 'nrInregistrareDosar', label: 'Nr. dosar',         width: 160, sortable: true,  filterable: true  },
  { key: 'obiecteCererii',     label: 'Obiectul cererii',   width: 240, sortable: true,  filterable: true  },
  { key: 'stadiu',             label: 'Stadiu',             width: 170, sortable: true,  filterable: true  },
  { key: 'responsabilNume',    label: 'Responsabil',        width: 140, sortable: true,  filterable: true  },
  { key: 'facturat',           label: 'Facturat',           width: 100, sortable: true,  filterable: true  },
  { key: 'dataFacturarii',     label: 'Data facturării',    width: 130, sortable: true,  filterable: true  },
  { key: 'profitSami',         label: 'Profit Sami',        width: 130, sortable: true,  filterable: false },
  { key: 'profitAdi',          label: 'De facturat către Adi',         width: 130, sortable: true,  filterable: false },
  /* câmpuri suplimentare — ascunse implicit */
  { key: 'dataAdmiterii',      label: 'Data admiterii',     width: 130, sortable: true,  filterable: true  },
  { key: 'dataPlanificare',    label: 'Data planificare',   width: 140, sortable: true,  filterable: true  },
  { key: 'taxeOnrc',           label: 'Taxe ONRC',          width: 120, sortable: true,  filterable: false },
  { key: 'certificatConstatator', label: 'Taxe Certificat Constatator', width: 150, sortable: true, filterable: false },
  { key: 'tarifClient',        label: 'Tarif client',       width: 120, sortable: true,  filterable: false },
  { key: 'esteClientAdi',      label: 'Client Adi',         width: 110, sortable: true,  filterable: true  },
  { key: 'semnaturaElectronica', label: 'Semnătură electronică', width: 140, sortable: true, filterable: true  },
  { key: 'observatii',         label: 'Observații',         width: 220, sortable: false, filterable: true  },
]

export const EXTRA_COL_KEYS = new Set(['dataAdmiterii', 'dataPlanificare', 'taxeOnrc', 'certificatConstatator', 'tarifClient', 'esteClientAdi', 'semnaturaElectronica', 'observatii'])
export const EMPTY_PLACEHOLDER = '(Necompletat)'

export function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function getColValue(d: Dosar, key: string, facturareConfig: FacturareConfig = DEFAULT_FACTURARE_CONFIG): string {
  switch (key) {
    case 'clientDenumire': return d.clientDenumire || d.clientDenumireLibera || ''
    case 'stadiu': return STADIU_DOSAR_LABELS[d.stadiu]
    case 'obiecteCererii': return obiecteCereriiText(d.obiecteCererii)
    case 'facturat': return d.facturat ? 'Da' : 'Nu'
    case 'esteClientAdi': return d.esteClientAdi ? 'Da' : 'Nu'
    case 'semnaturaElectronica': return d.semnaturaElectronica ? 'Da' : 'Nu'
    case 'profitSami': return String(calculDosarFinanciar(d, facturareConfig).profitSami)
    case 'profitAdi': return String(calculDosarFinanciar(d, facturareConfig).profitAdi)
    case 'createdAt': { const dt = toDateSafe(d.createdAt); return dt ? formatDateRo(dt) : '' }
    case 'dataFacturarii': { const dt = toDateSafe(d.dataFacturarii); return dt ? formatDateRo(dt) : '' }
    default: {
      const val = (d as unknown as Record<string, unknown>)[key]
      if (val === null || val === undefined) return ''
      return String(val)
    }
  }
}

function getSortValue(d: Dosar, key: string, facturareConfig: FacturareConfig = DEFAULT_FACTURARE_CONFIG): string | number {
  if (key === 'profitSami') return calculDosarFinanciar(d, facturareConfig).profitSami
  if (key === 'profitAdi') return calculDosarFinanciar(d, facturareConfig).profitAdi
  if (key === 'taxeOnrc' || key === 'tarifClient' || key === 'certificatConstatator') return d[key] ?? Number.NEGATIVE_INFINITY
  if (key === 'createdAt') return toDateSafe(d.createdAt)?.getTime() ?? Number.NEGATIVE_INFINITY
  if (key === 'dataFacturarii') return toDateSafe(d.dataFacturarii)?.getTime() ?? Number.NEGATIVE_INFINITY
  return getColValue(d, key, facturareConfig)
}

export function getUniqueValues(dosare: Dosar[], key: string, facturareConfig: FacturareConfig = DEFAULT_FACTURARE_CONFIG): string[] {
  const set = new Set<string>()
  let hasEmpty = false
  for (const d of dosare) {
    const v = getColValue(d, key, facturareConfig)
    if (v) set.add(v)
    else hasEmpty = true
  }
  const sorted = [...set].sort((a, b) => a.localeCompare(b, 'ro', { sensitivity: 'base', numeric: true }))
  if (hasEmpty) sorted.unshift(EMPTY_PLACEHOLDER)
  return sorted
}

export function applyFilters(dosare: Dosar[], filters: Record<string, string[]>, facturareConfig: FacturareConfig = DEFAULT_FACTURARE_CONFIG): Dosar[] {
  return dosare.filter(d =>
    Object.entries(filters).every(([key, vals]) => {
      if (!vals.length) return true
      const v = getColValue(d, key, facturareConfig)
      return vals.includes(v) || (!v && vals.includes(EMPTY_PLACEHOLDER))
    })
  )
}

export function applySort(dosare: Dosar[], col: string | null, dir: 'asc' | 'desc', facturareConfig: FacturareConfig = DEFAULT_FACTURARE_CONFIG): Dosar[] {
  if (!col) return dosare
  return [...dosare].sort((a, b) => {
    const av = getSortValue(a, col, facturareConfig)
    const bv = getSortValue(b, col, facturareConfig)
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av
    }
    const as = String(av), bs = String(bv)
    if (!as && !bs) return 0
    if (!as) return 1
    if (!bs) return -1
    const cmp = as.localeCompare(bs, 'ro', { sensitivity: 'base', numeric: true })
    return dir === 'asc' ? cmp : -cmp
  })
}

export type SortState = { col: string | null; dir: 'asc' | 'desc' }
export type SortAction = { type: 'TOGGLE'; col: string } | { type: 'RESET' }

export function sortReducer(state: SortState, action: SortAction): SortState {
  if (action.type === 'RESET') return { col: null, dir: 'asc' }
  if (state.col !== action.col) return { col: action.col, dir: 'asc' }
  if (state.dir === 'asc') return { col: action.col, dir: 'desc' }
  return { col: null, dir: 'asc' }
}
