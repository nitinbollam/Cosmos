/** Shared CSV helpers for admin exports. */

/**
 * Spreadsheet apps run a cell that starts with = + - @ (or a tab or carriage return) as a formula,
 * so customer-typed text like "=1+1" or a phone number like "+1-555-1424" would be calculated.
 * Such cells get a leading apostrophe, which Excel and Sheets show as plain text. Plain numbers
 * ("-12.50") are left alone so they stay numbers.
 */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
}

export function csvEscape(value: unknown): string {
  const s = neutralizeFormula(value == null ? '' : String(value))
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
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking straight after click() cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
