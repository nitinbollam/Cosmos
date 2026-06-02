export type SpreadsheetRow = Record<string, string>

export type BulkImportResult = {
  created?: number
  updated?: number
  failed: number
  errors: Array<{ row: number; message: string }>
}

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export function rowValue(row: SpreadsheetRow, ...keys: string[]): string {
  const map = new Map(Object.entries(row).map(([k, v]) => [normalizeHeader(k), v]))
  for (const key of keys) {
    const value = map.get(normalizeHeader(key))
    if (value != null && value.trim() !== '') return value.trim()
  }
  return ''
}

export function rowNumber(row: SpreadsheetRow, ...keys: string[]): number | undefined {
  const raw = rowValue(row, ...keys)
  if (!raw) return undefined
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsv(await file.text())
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) return []
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [String(key), String(value ?? '').trim()]),
      ),
    )
  }
  throw new Error('Unsupported file type. Upload CSV or Excel (.xlsx).')
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}

function parseCsv(text: string): SpreadsheetRow[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line, index, all) => index < all.length - 1 || line.trim())
  if (lines.length === 0) return []

  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  const rows: SpreadsheetRow[] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = parseCsvLine(lines[i])
    const row: SpreadsheetRow = {}
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

export function downloadCsvTemplate(filename: string, headers: string[]) {
  const blob = new Blob([`${headers.join(',')}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
