import { lazy, Suspense, useState } from 'react'
import type { ScanResult } from './types'
import './scanner.css'

// Lazy so the decode engine is fetched only when someone actually opens the
// camera. Every screen that uses ScanButton shares the same chunk, so adding it
// to another page costs no extra bundle weight.
const BarcodeScannerSheet = lazy(() =>
  import('./BarcodeScannerSheet').then((m) => ({ default: m.BarcodeScannerSheet })),
)

type ScanButtonProps = {
  /** Fired once per scan, from the camera or a USB/keyboard-wedge scanner. */
  onScan: (result: ScanResult) => void
  /** Heading shown in the scanner sheet. */
  title?: string
  /** Button text. Keep it short — this sits beside inputs. */
  label?: string
  /**
   * Keep scanning after each hit instead of closing. Useful at a till, where
   * the operator scans several items in a row.
   */
  continuous?: boolean
  className?: string
  disabled?: boolean
}

/**
 * A button that opens the barcode scanner and hands each result to the parent.
 *
 * Deliberately just the trigger — it holds no opinion about what a scanned code
 * means. The Inventory screen resolves it to a SKU and filters the list; the POS
 * screen resolves it and drops the item straight into the cart. Same control,
 * different decisions, exactly as with the warehouse screens.
 *
 * USB scan guns are covered without extra work: the underlying sheet listens for
 * keyboard-wedge input whenever it is open.
 */
export function ScanButton({
  onScan,
  title = 'Scan barcode',
  label = 'Scan',
  continuous = false,
  className,
  disabled,
}: ScanButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* type=button so it never submits a surrounding form */}
      <button
        type="button"
        className={`scan-button ${className ?? ''}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`${label} barcode with camera or scanner`}
        title="Scan with camera or USB scanner"
      >
        <span aria-hidden="true">▣</span> {label}
      </button>

      {open && (
        <Suspense fallback={null}>
          <BarcodeScannerSheet
            open
            title={title}
            continuous={continuous}
            onDetected={(result) => {
              onScan(result)
              if (!continuous) setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}
