/** Shared CSV helpers for admin exports. */

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  return lines.join('\n')
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  downloadCsvText(filename, buildCsv(headers, rows))
}

export function downloadCsvText(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
