import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { MarketplaceNav } from '../marketplace-nav'

type SkuRow = {
  id: string
  code: string
  name: string
  category: string
  quantityAvailable?: number
  isTobacco?: boolean
  isAlcohol?: boolean
  ageRestricted?: boolean
  isRegulated?: boolean
}

const MARKETPLACE_ELIGIBLE_CATEGORIES = new Set([
  'electronics',
  'office supplies',
  'industrial supplies',
  'packaging',
  'hardware',
  'cleaning supplies',
  'safety equipment',
  'food service supplies',
  'general merchandise',
])

const AUCTION_DURATIONS = [
  { days: 3, label: '3 Days', desc: 'Fast turnaround' },
  { days: 5, label: '5 Days', desc: 'Standard auction' },
  { days: 7, label: '7 Days', desc: 'Maximum exposure' },
] as const

export default function MarketplaceCreateListingPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [skuId, setSkuId] = useState('')
  const [listingType, setListingType] = useState<'FIXED' | 'AUCTION'>('FIXED')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [description, setDescription] = useState('')
  const [reservePrice, setReservePrice] = useState('')
  const [auctionDurationDays, setAuctionDurationDays] = useState<number>(7)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const skusQ = useQuery({
    queryKey: ['inventory', 'skus', 'marketplace-create'],
    queryFn: () => api.get<{ items: SkuRow[] }>('/skus?pageSize=100'),
  })

  const { eligibleSkus, ineligibleSkus } = useMemo(() => {
    const all = skusQ.data?.items ?? []
    const eligible: SkuRow[] = []
    const ineligible: SkuRow[] = []
    for (const s of all) {
      const isReg = Boolean(s.isTobacco || s.isAlcohol || s.ageRestricted || s.isRegulated)
      const catOk = MARKETPLACE_ELIGIBLE_CATEGORIES.has((s.category ?? '').toLowerCase().trim())
      if (!isReg && catOk) {
        eligible.push(s)
      } else {
        ineligible.push(s)
      }
    }
    return { eligibleSkus: eligible, ineligibleSkus: ineligible }
  }, [skusQ.data?.items])

  const selectedSku = useMemo(() => {
    return (skusQ.data?.items ?? []).find((s) => s.id === skuId)
  }, [skusQ.data?.items, skuId])

  const createMut = useMutation({
    mutationFn: () => {
      const priceCents = Math.round(Number.parseFloat(price) * 100)
      const reserveCents =
        listingType === 'AUCTION' && reservePrice.trim()
          ? Math.round(Number.parseFloat(reservePrice) * 100)
          : undefined
      return api.post('/marketplace/listings', {
        skuId,
        listingType,
        priceCents,
        quantity: listingType === 'AUCTION' ? 1 : Number.parseInt(quantity, 10),
        description: description.trim() || undefined,
        photoUrls: photoUrls.length ? photoUrls : undefined,
        ...(listingType === 'AUCTION'
          ? {
              auctionDurationDays,
              ...(reserveCents != null && reserveCents > 0 ? { reservePriceCents: reserveCents } : {}),
            }
          : {}),
      })
    },
    onSuccess: () => void navigate('/admin/marketplace/my-listings'),
  })

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    if (photoUrls.length >= 5) {
      setUploadError('Maximum of 5 photos allowed per listing.')
      return
    }

    setUploadBusy(true)
    setUploadError(null)

    try {
      const remainingSlots = 5 - photoUrls.length
      const filesToUpload = Array.from(files).slice(0, remainingSlots)

      for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) {
          throw new Error(`File ${file.name} is not an image.`)
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`File ${file.name} exceeds 5MB limit.`)
        }

        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = String(reader.result ?? '')
            resolve(result.includes(',') ? result.split(',')[1]! : result)
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        const res = await api.post<{ url: string }>('/marketplace/uploads', {
          fileName: file.name,
          contentBase64,
          mimeType: file.type,
        })

        setPhotoUrls((prev) => [...prev, res.url].slice(0, 5))
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Photo upload failed.')
    } finally {
      setUploadBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePhoto(indexToRemove: number) {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== indexToRemove))
  }

  const numericPrice = Number.parseFloat(price) || 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="List Inventory"
        subtitle="Submit wholesale inventory lots or schedule auctions for verification and live trading."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main form container (Left 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div
            className="rounded-2xl border p-6 sm:p-8 space-y-6 shadow-xl"
            style={{
              borderColor: 'var(--c-border-card)',
              background: 'var(--c-surface)',
            }}
          >
            {/* Listing Type Segmented Control */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                Listing Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setListingType('FIXED')}
                  className="p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between"
                  style={{
                    borderColor: listingType === 'FIXED' ? 'var(--c-primary)' : 'var(--c-border)',
                    background: listingType === 'FIXED' ? 'var(--c-primary-dim)' : 'var(--c-surface-2)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base font-semibold text-pleros-white flex items-center gap-2">
                      <span>🏷️</span> Fixed Price
                    </span>
                    {listingType === 'FIXED' && (
                      <span className="w-2 h-2 rounded-full bg-pleros-primary" />
                    )}
                  </div>
                  <p className="text-xs text-pleros-text-3">
                    Direct buy-it-now order at your designated wholesale price.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setListingType('AUCTION')}
                  className="p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between"
                  style={{
                    borderColor: listingType === 'AUCTION' ? 'var(--c-primary)' : 'var(--c-border)',
                    background: listingType === 'AUCTION' ? 'var(--c-primary-dim)' : 'var(--c-surface-2)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base font-semibold text-pleros-white flex items-center gap-2">
                      <span>🔨</span> Auction Lot
                    </span>
                    {listingType === 'AUCTION' && (
                      <span className="w-2 h-2 rounded-full bg-pleros-primary" />
                    )}
                  </div>
                  <p className="text-xs text-pleros-text-3">
                    Timed bidding with countdown timer, auto-extend anti-snipe & optional reserve.
                  </p>
                </button>
              </div>
            </div>

            {/* SKU Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                Inventory SKU <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <select
                  className="pleros-input w-full !py-2.5 !text-sm appearance-none pr-10 cursor-pointer"
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                >
                  <option value="">Select a product to liquidate…</option>
                  {eligibleSkus.length > 0 && (
                    <optgroup label="Eligible Wholesale Inventory">
                      {eligibleSkus.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.code}] {s.name} — {s.category} ({s.quantityAvailable ?? 0} in stock)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {ineligibleSkus.length > 0 && (
                    <optgroup label="Ineligible (Regulated / Excluded Category)">
                      {ineligibleSkus.map((s) => (
                        <option key={s.id} value={s.id} disabled>
                          [{s.code}] {s.name} — Ineligible for Marketplace listing
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-pleros-text-3">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>

              {selectedSku && (
                <div
                  className="mt-2.5 p-3 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs"
                  style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-pleros-accent font-semibold">{selectedSku.code}</span>
                    <span className="text-pleros-text-3">·</span>
                    <span className="text-pleros-white font-medium">{selectedSku.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{ background: 'var(--c-surface)', color: 'var(--c-text-2)' }}
                    >
                      {selectedSku.category}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        (selectedSku.quantityAvailable ?? 0) > 0
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      📦 {selectedSku.quantityAvailable ?? 0} available in warehouse
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing and Quantities */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                  {listingType === 'AUCTION' ? 'Starting Bid (USD)' : 'Unit Price (USD)'}{' '}
                  <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-pleros-text-3">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="pleros-input w-full !pl-7 !py-2.5 !text-sm font-mono"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <p className="text-[11px] text-pleros-text-3 mt-1">
                  {listingType === 'AUCTION'
                    ? 'First bid must meet or exceed this amount.'
                    : 'Fixed price per unit for immediate purchase.'}
                </p>
              </div>

              {listingType === 'FIXED' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                    Available Quantity <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="pleros-input w-full !py-2.5 !text-sm font-mono"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  <p className="text-[11px] text-pleros-text-3 mt-1">
                    Units committed from warehouse inventory.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                    Reserve Price (Optional)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-pleros-text-3">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Hidden reserve"
                      className="pleros-input w-full !pl-7 !py-2.5 !text-sm font-mono"
                      value={reservePrice}
                      onChange={(e) => setReservePrice(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-pleros-text-3 mt-1">
                    Hidden threshold. Lot won&apos;t sell below this.
                  </p>
                </div>
              )}
            </div>

            {/* Auction specific duration settings */}
            {listingType === 'AUCTION' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                  Auction Duration
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {AUCTION_DURATIONS.map((d) => {
                    const active = auctionDurationDays === d.days
                    return (
                      <button
                        key={d.days}
                        type="button"
                        onClick={() => setAuctionDurationDays(d.days)}
                        className="p-3 rounded-xl border text-center transition-all"
                        style={{
                          borderColor: active ? 'var(--c-primary)' : 'var(--c-border)',
                          background: active ? 'var(--c-primary-dim)' : 'var(--c-surface-2)',
                          color: active ? 'var(--c-primary)' : 'var(--c-text)',
                        }}
                      >
                        <div className="text-sm font-semibold">{d.label}</div>
                        <div className="text-[10px] text-pleros-text-3 mt-0.5">{d.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Photo Upload Dropzone */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                  Lot Photos ({photoUrls.length}/5)
                </label>
                <span className="text-[11px] text-pleros-text-3">JPG, PNG, WebP up to 5MB</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploadBusy || photoUrls.length >= 5}
                onChange={(e) => void handleFileUpload(e.target.files)}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  void handleFileUpload(e.dataTransfer.files)
                }}
                onClick={() => {
                  if (!uploadBusy && photoUrls.length < 5) {
                    fileInputRef.current?.click()
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-pleros-primary bg-pleros-primary/10'
                    : 'hover:border-pleros-border-hover'
                }`}
                style={{
                  borderColor: isDragging ? 'var(--c-primary)' : 'var(--c-border)',
                  background: 'var(--c-surface-2)',
                }}
              >
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                    style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
                  >
                    {uploadBusy ? (
                      <span className="animate-spin text-pleros-accent">⏳</span>
                    ) : (
                      '📸'
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-pleros-white">
                      {uploadBusy
                        ? 'Uploading images…'
                        : photoUrls.length >= 5
                          ? 'Maximum photos reached'
                          : 'Click to upload or drag & drop images'}
                    </p>
                    <p className="text-xs text-pleros-text-3 mt-0.5">
                      Clear photos of packaging, pallets, and condition badges increase buyer confidence.
                    </p>
                  </div>
                </div>
              </div>

              {uploadError && (
                <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                  <span>⚠️</span> {uploadError}
                </p>
              )}

              {/* Uploaded Photos Gallery */}
              {photoUrls.length > 0 && (
                <div className="grid grid-cols-5 gap-3 mt-3">
                  {photoUrls.map((url, idx) => (
                    <div
                      key={url}
                      className="group relative aspect-square rounded-lg overflow-hidden border"
                      style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                    >
                      <img src={url} alt={`Listing photo ${idx + 1}`} className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span className="absolute bottom-1 left-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-pleros-white backdrop-blur">
                          Cover
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removePhoto(idx)
                        }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/80 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Remove photo"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
                Lot Description & Specifications (Optional)
              </label>
              <textarea
                className="pleros-input w-full min-h-[110px] !text-sm"
                placeholder="Include expiration dates, packaging details, freight shipping terms, inspection notes, or minimum purchase criteria…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Form Actions */}
            <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--c-border)' }}>
              <div className="text-xs text-pleros-text-3">
                <span>🛡️ Listings undergo automated compliance verification before going live.</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/admin/marketplace')}
                  className="btn-ghost !text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary !py-2.5 !px-5 !text-sm font-semibold inline-flex items-center gap-2"
                  disabled={!skuId || !price || numericPrice <= 0 || createMut.isPending}
                  onClick={() => void createMut.mutate()}
                >
                  {createMut.isPending ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>Submitting…</span>
                    </>
                  ) : (
                    <>
                      <span>Submit for Review</span>
                      <span>↗</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {createMut.error && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{axiosErr(createMut.error)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Buyer Preview Column (Right 1 col) */}
        <div className="space-y-6">
          <div
            className="rounded-2xl border p-5 space-y-4 sticky top-6 shadow-xl"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">
                Live Buyer Preview
              </span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--c-surface-2)', color: 'var(--c-accent)' }}
              >
                Catalog Card
              </span>
            </div>

            {/* Mocked Listing Card as seen on the browse page */}
            <div
              className="rounded-xl border overflow-hidden transition-all shadow-md"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-2)' }}
            >
              <div className="aspect-video w-full bg-black/40 relative overflow-hidden flex items-center justify-center">
                {photoUrls[0] ? (
                  <img src={photoUrls[0]} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-pleros-text-3 text-xs gap-1">
                    <span className="text-2xl">📦</span>
                    <span>No image uploaded</span>
                  </div>
                )}
                {listingType === 'AUCTION' && (
                  <span className="absolute top-2 right-2 text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded bg-pleros-accent text-pleros-white shadow">
                    Auction · {auctionDurationDays}d
                  </span>
                )}
              </div>

              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-pleros-white text-sm line-clamp-1">
                    {selectedSku?.name || 'Item title will appear here'}
                  </h3>
                </div>

                <p className="text-xs text-pleros-text-3">
                  {selectedSku?.category || 'General Wholesale'} {selectedSku?.code && `· SKU: ${selectedSku.code}`}
                </p>

                <div className="pt-2 border-t flex items-baseline justify-between" style={{ borderColor: 'var(--c-border)' }}>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-pleros-text-3 block">
                      {listingType === 'AUCTION' ? 'Starting Bid' : 'Price'}
                    </span>
                    <span className="text-base font-mono font-bold text-pleros-white">
                      ${numericPrice > 0 ? numericPrice.toFixed(2) : '0.00'}
                    </span>
                  </div>
                  {listingType === 'FIXED' && (
                    <span className="text-xs text-pleros-text-3">
                      Qty: <strong className="text-pleros-white">{quantity || '1'}</strong>
                    </span>
                  )}
                </div>

                <div
                  className="pt-2 text-[11px] text-pleros-text-3 flex items-center justify-between border-t"
                  style={{ borderColor: 'var(--c-border)' }}
                >
                  <span>Your Distributor Org</span>
                  <span>★ 5.0 · Verified</span>
                </div>
              </div>
            </div>

            {/* Helpful listing notes */}
            <div
              className="p-3.5 rounded-xl border text-xs space-y-2"
              style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
            >
              <div className="font-semibold text-pleros-white flex items-center gap-1.5">
                <span>💡</span> Listing Best Practices
              </div>
              <ul className="space-y-1.5 text-pleros-text-3 pl-4 list-disc">
                <li>Photos of physical lot seals improve sell-through by 34%.</li>
                <li>Auctions feature anti-sniping protection (+2m extension on last-minute bids).</li>
                <li>All transactions settle into your connected Stripe escrow account.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
