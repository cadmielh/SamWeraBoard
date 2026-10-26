import { describe, it, expect } from 'vitest'
import { buildWorkbook, type ExportColumnSpec } from './xlsxExport'

interface Row { name: string; amount: number; when: Date; ok: boolean }

const rows: Row[] = [
  { name: 'Ana', amount: 1234.5, when: new Date(2026, 0, 15), ok: true },
  { name: 'Ion', amount: 0, when: new Date(2026, 2, 1), ok: false },
]

const columns: ExportColumnSpec<Row>[] = [
  { key: 'name', label: 'Nume', getValue: r => r.name },
  { key: 'amount', label: 'Suma', type: 'number', getValue: r => r.amount },
  { key: 'when', label: 'Data', type: 'date', getValue: r => r.when },
  { key: 'ok', label: 'Activ', type: 'boolean', getValue: r => r.ok },
]

describe('buildWorkbook — foaia de date', () => {
  it('scrie header-ul cu label-urile coloanelor, în ordine', () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    const ws = wb.getWorksheet('Date')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Nume', 'Suma', 'Data', 'Activ'])
  })

  it('scrie valorile cu tipul corect (string/number/Date), nu text preformatat', () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    const ws = wb.getWorksheet('Date')!
    const row2 = ws.getRow(2)
    expect(row2.getCell(1).value).toBe('Ana')
    expect(row2.getCell(2).value).toBe(1234.5)
    expect(row2.getCell(3).value).toBeInstanceOf(Date)
    expect((row2.getCell(3).value as Date).getFullYear()).toBe(2026)
  })

  it('scrie boolean ca text Da/Nu, consistent cu UI', () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    const ws = wb.getWorksheet('Date')!
    expect(ws.getRow(2).getCell(4).value).toBe('Da')
    expect(ws.getRow(3).getCell(4).value).toBe('Nu')
  })

  it('o valoare null/undefined devine celulă goală, nu "null"/"undefined" ca text', () => {
    const colsWithNull: ExportColumnSpec<Row>[] = [{ key: 'name', label: 'Nume', getValue: () => null }]
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns: colsWithNull, rows: [rows[0]] })
    expect(wb.getWorksheet('Date')!.getRow(2).getCell(1).value).toBeNull()
  })

  it('header e bold și autoFilter acoperă toate coloanele', () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    const ws = wb.getWorksheet('Date')!
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.autoFilter).toEqual({ from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } })
  })
})

describe('buildWorkbook — escapare formula-injection la export (coloane string)', () => {
  const stringCol = (value: string): ExportColumnSpec<Row>[] => [{ key: 'name', label: 'Nume', getValue: () => value }]
  const exportedValue = (value: string) => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns: stringCol(value), rows: [rows[0]] })
    return wb.getWorksheet('Date')!.getRow(2).getCell(1).value
  }

  it('un string care începe cu „=" (declanșator clasic de formulă) e prefixat cu apostrof', () => {
    expect(exportedValue('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")")
  })

  it('un string care începe cu „@" e prefixat cu apostrof', () => {
    expect(exportedValue('@SUM(1,1)')).toBe("'@SUM(1,1)")
  })

  it('un telefon românesc/internațional care începe cu „+" NU e modificat — regresie reală pentru toți utilizatorii altfel', () => {
    expect(exportedValue('+40 721 234 567')).toBe('+40 721 234 567')
  })

  it('un string normal, fără caracter de start riscant, nu e modificat', () => {
    expect(exportedValue('SRL Exemplu')).toBe('SRL Exemplu')
  })
})

describe('buildWorkbook — foaia de sumar', () => {
  it('fără `summary`, workbook-ul are o singură foaie', () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    expect(wb.worksheets.map(ws => ws.name)).toEqual(['Date'])
  })

  it('cu `summary`, adaugă a doua foaie cu titlu de secțiune bold și rândurile label/valoare', () => {
    const wb = buildWorkbook({
      filename: 'x.xlsx', sheetName: 'Date', columns, rows,
      summary: { sheetName: 'Sumar', sections: [{ title: 'Totaluri', rows: [{ label: 'Total dosare', value: 5 }, { label: 'Observații', value: 'ok' }] }] },
    })
    expect(wb.worksheets.map(ws => ws.name)).toEqual(['Date', 'Sumar'])
    const ws = wb.getWorksheet('Sumar')!
    expect(ws.getRow(1).getCell(1).value).toBe('Totaluri')
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.getRow(2).getCell(1).value).toBe('Total dosare')
    expect(ws.getRow(2).getCell(2).value).toBe(5)
    expect(ws.getRow(3).getCell(2).value).toBe('ok')
  })
})

describe('buildWorkbook — round-trip real prin writeBuffer/load (fidelitate .xlsx reală)', () => {
  it('workbook-ul scris cu writeBuffer() se citește identic înapoi cu ExcelJS', async () => {
    const wb = buildWorkbook({ filename: 'x.xlsx', sheetName: 'Date', columns, rows })
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)

    const ExcelJS = (await import('exceljs')).default
    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(buffer)
    const ws = reloaded.getWorksheet('Date')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Nume', 'Suma', 'Data', 'Activ'])
    expect(ws.getRow(2).getCell(1).value).toBe('Ana')
    expect(ws.getRow(2).getCell(2).value).toBe(1234.5)
  })
})
