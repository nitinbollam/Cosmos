import { useMemo, useState } from 'react'
import { QRCodeEncoder, QRCodeDecoderErrorCorrectionLevel } from '@zxing/library'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'
import { Link } from 'react-router-dom'

interface MobileScannerModalProps {
  open: boolean
  onClose: () => void
}

function generateQrSvgData(text: string, quietZone = 2): { viewBox: string; path: string } {
  try {
    const code = QRCodeEncoder.encode(text, QRCodeDecoderErrorCorrectionLevel.M)
    const matrix = code.getMatrix()
    if (!matrix) return { viewBox: '0 0 200 200', path: '' }

    const width = matrix.getWidth()
    const height = matrix.getHeight()
    const totalWidth = width + quietZone * 2
    const totalHeight = height + quietZone * 2

    let d = ''
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (matrix.get(x, y) === 1) {
          const px = x + quietZone
          const py = y + quietZone
          d += `M${px} ${py}h1v1h-1z `
        }
      }
    }

    return {
      viewBox: `0 0 ${totalWidth} ${totalHeight}`,
      path: d.trim(),
    }
  } catch (e) {
    console.error('Failed to generate QR path', e)
    return { viewBox: '0 0 200 200', path: '' }
  }
}

export function MobileScannerModal({ open, onClose }: MobileScannerModalProps) {
  const [copied, setCopied] = useState(false)
  const targetPath = '/m/warehouse/receiving'
  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${targetPath}` : targetPath

  const qrData = useMemo(() => generateQrSvgData(fullUrl), [fullUrl])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <PlerosDialogModal open={open} onOpenChange={(o) => !o && onClose()} title="Connect Mobile Receiving Scanner">
      <div className="space-y-5 text-center">
        <p className="text-sm text-slate-300 text-left">
          Scan this QR code with a phone or tablet camera to open the warehouse receiving scanner directly on a mobile device.
        </p>

        <div className="flex justify-center my-4">
          <div className="p-3 rounded-xl bg-white shadow-lg inline-flex items-center justify-center min-w-[216px] min-h-[216px]">
            {qrData.path ? (
              <svg
                viewBox={qrData.viewBox}
                className="w-48 h-48"
                shapeRendering="crispEdges"
                style={{ display: 'block' }}
                aria-label="QR Code for mobile warehouse scanner"
              >
                <rect width="100%" height="100%" fill="#ffffff" />
                <path d={qrData.path} fill="#000000" />
              </svg>
            ) : (
              <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-500 font-mono">
                {fullUrl}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-left">
          <span className="text-xs font-mono text-slate-300 truncate max-w-[280px]">{fullUrl}</span>
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="btn-ghost !py-1 !px-2.5 !text-xs font-semibold text-sky-400 hover:text-sky-300 whitespace-nowrap"
          >
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>

        <div className="border-t border-slate-800 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link
            to={targetPath}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-slate-200 underline inline-flex items-center gap-1"
          >
            <span>Open in new desktop tab (test webcam)</span>
            <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
          <button
            type="button"
            className="btn-primary !py-1.5 !px-4 text-xs font-semibold"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </PlerosDialogModal>
  )
}
