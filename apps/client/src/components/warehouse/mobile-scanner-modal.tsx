import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeSvgWriter } from '@zxing/browser'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'
import { Link } from 'react-router-dom'

interface MobileScannerModalProps {
  open: boolean
  onClose: () => void
}

export function MobileScannerModal({ open, onClose }: MobileScannerModalProps) {
  const qrRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const targetPath = '/m/warehouse/receiving'
  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${targetPath}` : targetPath

  useEffect(() => {
    if (!open || !qrRef.current) return
    try {
      const writer = new BrowserQRCodeSvgWriter()
      const svg = writer.write(fullUrl, 200, 200)
      svg.setAttribute('style', 'border-radius: 8px; background: #ffffff; padding: 8px;')
      qrRef.current.innerHTML = ''
      qrRef.current.appendChild(svg)
    } catch (e) {
      console.error('Failed to generate QR code', e)
    }
  }, [open, fullUrl])

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
          <div
            ref={qrRef}
            className="p-3 rounded-xl bg-white shadow-lg inline-flex items-center justify-center min-w-[216px] min-h-[216px]"
          />
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
