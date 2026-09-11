import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type SkuRow = { id: string; code: string; name: string; category: string }

const AUCTION_DURATIONS = [3, 5, 7] as const

export default function MarketplaceCreateListingPage() {
  const navigate = useNavigate()
  const [skuId, setSkuId] = useState('')
  const [listingType, setListingType] = useState<'FIXED' | 'AUCTION'>('FIXED')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [description, setDescription] = useState('')
  const [reservePrice, setReservePrice] = useState('')
  const [auctionDurationDays, setAuctionDurationDays] = useState<number>(7)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploadBusy, setUploadBusy] = useState(false)

  const skusQ = useQuery({
    queryKey: ['inventory', 'skus', 'marketplace-create'],
    queryFn: () => api.get<{ items: SkuRow[] }>('/skus?pageSize=100'),
  })

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
    onSuccess: () => void navigate('/admin/marketplace'),
  })

  return (
    <div className="max-w-lg">
      <Link to="/admin/marketplace" className="text-sm text-pleros-accent">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-display text-pleros-white mt-2">List inventory</h1>
      <p className="text-sm text-pleros-text-3 mt-1">
        New listings are submitted for review before going live.
      </p>

      <label className="block text-sm mt-4">Listing type</label>
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          className={listingType === 'FIXED' ? 'btn-primary text-sm' : 'neo-btn-secondary text-sm px-3 py-2 rounded'}
          onClick={() => setListingType('FIXED')}
        >
          Fixed price
        </button>
        <button
          type="button"
          className={listingType === 'AUCTION' ? 'btn-primary text-sm' : 'neo-btn-secondary text-sm px-3 py-2 rounded'}
          onClick={() => setListingType('AUCTION')}
        >
          Auction
        </button>
      </div>

      <label className="block text-sm mt-4">SKU</label>
      <select className="pleros-input w-full" value={skuId} onChange={(e) => setSkuId(e.target.value)}>
        <option value="">Select SKU…</option>
        {(skusQ.data?.items ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name} ({s.category})
          </option>
        ))}
      </select>

      <label className="block text-sm mt-4">{listingType === 'AUCTION' ? 'Starting price (USD)' : 'Price (USD)'}</label>
      <input className="pleros-input w-full" value={price} onChange={(e) => setPrice(e.target.value)} />

      {listingType === 'FIXED' && (
        <>
          <label className="block text-sm mt-4">Quantity</label>
          <input className="pleros-input w-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </>
      )}

      {listingType === 'AUCTION' && (
        <>
          <label className="block text-sm mt-4">Duration (days)</label>
          <select
            className="pleros-input w-full"
            value={auctionDurationDays}
            onChange={(e) => setAuctionDurationDays(Number.parseInt(e.target.value, 10))}
          >
            {AUCTION_DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>

          <label className="block text-sm mt-4">Reserve price (USD, optional)</label>
          <input
            className="pleros-input w-full"
            value={reservePrice}
            onChange={(e) => setReservePrice(e.target.value)}
            placeholder="Hidden minimum — leave blank for no reserve"
          />
        </>
      )}

      <label className="block text-sm mt-4">Photos (optional)</label>
      <input
        type="file"
        accept="image/*"
        className="text-sm"
        disabled={uploadBusy || photoUrls.length >= 5}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          void (async () => {
            setUploadBusy(true)
            try {
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
            } finally {
              setUploadBusy(false)
              e.target.value = ''
            }
          })()
        }}
      />
      {photoUrls.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {photoUrls.map((url) => (
            <img key={url} src={url} alt="" className="w-16 h-16 object-cover rounded" />
          ))}
        </div>
      )}

      <label className="block text-sm mt-4">Description (optional)</label>
      <textarea
        className="pleros-input w-full min-h-24"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <button
        type="button"
        className="btn-primary mt-6"
        disabled={!skuId || !price || createMut.isPending}
        onClick={() => void createMut.mutate()}
      >
        {createMut.isPending ? 'Submitting…' : 'Submit for review'}
      </button>
      {createMut.error && <p className="text-sm text-red-400 mt-2">{axiosErr(createMut.error)}</p>}
    </div>
  )
}
