import { useEffect, useRef } from 'react'
import { WedgeParser, type WedgeParserOptions } from './wedge'

/**
 * Binds a document-level keydown listener that recognizes hardware
 * keyboard-wedge scanners and calls `onScan(value)` when a burst completes.
 *
 * Warehouses often prefer ring/handheld guns over the camera — this makes the
 * same screen work with either, behind one callback. Disabled by passing
 * `enabled: false`.
 */
export function useKeyboardWedge(
  onScan: (value: string) => void,
  enabled: boolean,
  options?: WedgeParserOptions,
): void {
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return
    const parser = new WedgeParser(options)

    const handler = (e: KeyboardEvent) => {
      // Don't hijack real typing in inputs (e.g. the manual-entry field).
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }
      const value = parser.handle(e.key)
      if (value) {
        e.preventDefault()
        onScanRef.current(value)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // options is intentionally treated as static for the listener's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
