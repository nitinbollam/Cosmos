import { useRef, useState } from 'react'
import {
  downloadCsvTemplate,
  parseSpreadsheetFile,
  type BulkImportResult,
  type SpreadsheetRow,
} from '@/lib/spreadsheet-import'

type SpreadsheetImportPanelProps = {
  title?: string
  hint?: string
  expectedColumns: string[]
  templateFilename?: string
  disabled?: boolean
  onImport: (rows: SpreadsheetRow[]) => Promise<BulkImportResult | void>
  onDone?: () => void
}

export function SpreadsheetImportPanel({
  title = 'Import from CSV or Excel',
  hint,
  expectedColumns,
  templateFilename,
  disabled,
  onImport,
  onDone,
}: SpreadsheetImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<SpreadsheetRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File | null) {
    setError(null)
    setResult(null)
    if (!file) {
      setFileName(null)
      setPreview([])
      return
    }
    try {
      const rows = await parseSpreadsheetFile(file)
      if (rows.length === 0) {
        throw new Error('The file has no data rows.')
      }
      setFileName(file.name)
      setPreview(rows.slice(0, 5))
    } catch (e) {
      setFileName(null)
      setPreview([])
      setError(e instanceof Error ? e.message : 'Could not read file')
    }
  }

  async function runImport() {
    if (!inputRef.current?.files?.[0]) {
      setError('Choose a CSV or Excel file first.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const rows = await parseSpreadsheetFile(inputRef.current.files[0])
      const summary = await onImport(rows)
      if (summary) setResult(summary)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const previewHeaders = preview.length > 0 ? Object.keys(preview[0]) : expectedColumns

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-heading)' }}>
            {title}
          </p>
          {hint ? (
            <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
              {hint}
            </p>
          ) : null}
          <p className="text-xs mt-1 font-mono" style={{ color: 'var(--c-text-3)' }}>
            Columns: {expectedColumns.join(', ')}
          </p>
        </div>
        {templateFilename ? (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => downloadCsvTemplate(templateFilename, expectedColumns)}
          >
            Download template
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.xlsx,.xls"
        disabled={disabled || busy}
        className="block w-full text-sm"
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
      />

      {fileName ? (
        <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
          Selected: {fileName}
          {preview.length > 0 ? ` · ${preview.length}${preview.length === 5 ? '+' : ''} preview row(s)` : ''}
        </p>
      ) : null}

      {preview.length > 0 ? (
        <div className="overflow-x-auto max-h-40 border rounded-lg" style={{ borderColor: 'var(--c-border)' }}>
          <table className="pleros-table text-xs">
            <thead>
              <tr>
                {previewHeaders.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, index) => (
                <tr key={index}>
                  {previewHeaders.map((header) => (
                    <td key={header}>{row[header] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="text-sm space-y-1" style={{ color: 'var(--c-text-2)' }}>
          {result.created != null ? <p>Created: {result.created}</p> : null}
          {result.updated != null ? <p>Updated: {result.updated}</p> : null}
          {result.failed > 0 ? (
            <p style={{ color: 'var(--c-warning)' }}>
              Failed: {result.failed}
              {result.errors.slice(0, 5).map((entry) => (
                <span key={`${entry.row}-${entry.message}`} className="block text-xs">
                  Row {entry.row}: {entry.message}
                </span>
              ))}
            </p>
          ) : (
            <p style={{ color: 'var(--c-success)' }}>Import completed successfully.</p>
          )}
        </div>
      ) : null}

      <button
        type="button"
        className="btn-primary"
        disabled={disabled || busy || !fileName}
        onClick={() => void runImport()}
      >
        {busy ? 'Importing…' : 'Import file'}
      </button>
    </div>
  )
}
