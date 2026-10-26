import ExcelJS from 'exceljs'

export type ExportCellType = 'string' | 'number' | 'date' | 'boolean'

export interface ExportColumnSpec<T> {
  key: string
  label: string
  /** Lățime aproximativă în px, ca în ColDef — convertită euristic la unitatea de coloană Excel. */
  width?: number
  type?: ExportCellType
  getValue: (row: T) => unknown
}

export interface SummarySection {
  title: string
  rows: { label: string; value: string | number }[]
}

export interface ExportSpec<T> {
  filename: string
  sheetName: string
  columns: ExportColumnSpec<T>[]
  rows: T[]
  summary?: { sheetName: string; sections: SummarySection[] }
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAED' } }

/** Un string care începe cu `=`/`@`/tab/CR ar putea fi interpretat ca formulă de un importator
 * permisiv (CSV, LibreOffice/Sheets import) — îl prefixăm cu apostrof, convenția standard
 * (OWASP) de a-l forța ca text. NU includem `+`/`-`: telefoanele românești/internaționale
 * exportate (ex. „+40 721 234 567") încep frecvent cu „+" — le-ar corupe vizual pe toate. */
const FORMULA_TRIGGER_RE = /^[=@\t\r]/
function escapeFormulaLeadingChar(s: string): string {
  return FORMULA_TRIGGER_RE.test(s) ? `'${s}` : s
}

function cellValue<T>(col: ExportColumnSpec<T>, row: T): unknown {
  const v = col.getValue(row)
  if (v === null || v === undefined) return null
  if (col.type === 'boolean') return v ? 'Da' : 'Nu'
  if (col.type === 'date') return v instanceof Date ? v : null
  if (col.type === 'number') return typeof v === 'number' ? v : null
  return escapeFormulaLeadingChar(String(v))
}

function buildDataSheet<T>(wb: ExcelJS.Workbook, spec: ExportSpec<T>) {
  const ws = wb.addWorksheet(spec.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = spec.columns.map(col => ({
    header: col.label,
    key: col.key,
    width: Math.max(10, Math.round((col.width ?? 150) / 7)),
    style: col.type === 'date' ? { numFmt: 'dd.mm.yyyy' } : col.type === 'number' ? { numFmt: '#,##0.00' } : undefined,
  }))
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = HEADER_FILL
  for (const row of spec.rows) {
    const record: Record<string, unknown> = {}
    for (const col of spec.columns) record[col.key] = cellValue(col, row)
    ws.addRow(record)
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } }
}

function buildSummarySheet(wb: ExcelJS.Workbook, sheetName: string, sections: SummarySection[]) {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [{ key: 'label', width: 36 }, { key: 'value', width: 20 }]
  for (const section of sections) {
    const titleRow = ws.addRow([section.title])
    titleRow.font = { bold: true }
    for (const r of section.rows) {
      const row = ws.addRow([r.label, r.value])
      if (typeof r.value === 'number') row.getCell(2).numFmt = '#,##0.00'
    }
    ws.addRow([])
  }
}

/** Construiește workbook-ul — separat de exportRowsToXlsx() ca să fie testabil fără DOM
 * (vezi xlsxExport.test.ts), restul fiind doar declanșarea descărcării în browser. */
export function buildWorkbook<T>(spec: ExportSpec<T>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  buildDataSheet(wb, spec)
  if (spec.summary) buildSummarySheet(wb, spec.summary.sheetName, spec.summary.sections)
  return wb
}

export async function exportRowsToXlsx<T>(spec: ExportSpec<T>): Promise<void> {
  const wb = buildWorkbook(spec)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = spec.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
