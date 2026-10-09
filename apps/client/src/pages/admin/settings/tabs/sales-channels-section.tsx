import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryParams } from '@/lib/use-query-params'
import { api } from '@/lib/api-admin'
import { errMsg } from '../types'

type SalesChannelConnection = {
  id: string
  type: string
  shopDomain: string | null
  isActive: boolean
  lastSyncedAt: string | null
  createdAt: string
  listingCount: number
  errorCount: number
}

type SalesChannelListing = {
  id: string
  skuId: string
  externalListingId: string | null
  syncStatus: 'PENDING' | 'SYNCED' | 'ERROR'
  lastSyncedAt: string | null
  lastError: string | null
  sku: { id: string; code: string; name: string; price: unknown; isActive: boolean } | null
}

export function SalesChannelsSection() {
  const qc = useQueryClient()
  const searchParams = useQueryParams()
  const [shopDomain, setShopDomain] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)

  const connectionsQ = useQuery<SalesChannelConnection[]>({
    queryKey: ['sales-channels'],
    queryFn: () => api.get('/sales-channels'),
  })

  const listingsQ = useQuery<SalesChannelListing[]>({
    queryKey: ['sales-channels', selectedConnectionId, 'listings'],
    queryFn: () => api.get(`/sales-channels/${selectedConnectionId}/listings`),
    enabled: Boolean(selectedConnectionId),
  })

  const disconnectMut = useMutation({
    mutationFn: (connectionId: string) => api.delete(`/sales-channels/${connectionId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-channels'] })
      setSelectedConnectionId(null)
    },
  })

  const syncAllMut = useMutation({
    mutationFn: (connectionId: string) => api.post(`/sales-channels/${connectionId}/sync-all`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-channels'] })
      if (selectedConnectionId) {
        void qc.invalidateQueries({ queryKey: ['sales-channels', selectedConnectionId, 'listings'] })
      }
    },
  })

  const flushMut = useMutation({
    mutationFn: (connectionId: string) => api.post(`/sales-channels/${connectionId}/flush`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-channels'] })
      if (selectedConnectionId) {
        void qc.invalidateQueries({ queryKey: ['sales-channels', selectedConnectionId, 'listings'] })
      }
    },
  })

  const retryMut = useMutation({
    mutationFn: ({ connectionId, listingId }: { connectionId: string; listingId: string }) =>
      api.post(`/sales-channels/${connectionId}/listings/${listingId}/retry`, {}),
    onSuccess: () => {
      if (selectedConnectionId) {
        void qc.invalidateQueries({ queryKey: ['sales-channels', selectedConnectionId, 'listings'] })
      }
    },
  })

  useEffect(() => {
    if (searchParams.get('shopify') === 'connected') {
      void qc.invalidateQueries({ queryKey: ['sales-channels'] })
    }
  }, [searchParams, qc])

  useEffect(() => {
    const active = (connectionsQ.data ?? []).find((c) => c.isActive)
    if (active && !selectedConnectionId) setSelectedConnectionId(active.id)
  }, [connectionsQ.data, selectedConnectionId])

  const connectShopify = () => {
    const shop = shopDomain.trim()
    if (!shop) return
    window.location.href = `/api/v1/sales-channels/shopify/connect?shop=${encodeURIComponent(shop)}`
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/webhooks/shopify/orders`
      : '/api/v1/webhooks/shopify/orders'

  const errorListings = (listingsQ.data ?? []).filter((l) => l.syncStatus === 'ERROR')

  return (
    <div className="pleros-card">
      <div className="flex flex-wrap justify-between gap-3 items-start mb-4">
        <div>
          <h3 className="text-pleros-white font-semibold font-display">Sales channels</h3>
          <p className="text-pleros-text-3 text-sm mt-1">
            Sync catalog and orders with external storefronts. Shopify is available now; Amazon, eBay, and Walmart adapters
            ship in later phases.
          </p>
        </div>
      </div>

      <div className="rounded-xl p-4 border mb-4" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
        <p className="text-sm text-pleros-white font-medium mb-2">Connect Shopify</p>
        <p className="text-xs text-pleros-text-3 mb-3">
          Enter your development store domain (e.g. <span className="font-mono">your-store.myshopify.com</span>). After
          OAuth, register the orders webhook in Shopify Admin → Settings → Notifications → Webhooks:{' '}
          <span className="font-mono break-all">{webhookUrl}</span> (orders/create, JSON).
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="pleros-input flex-1 min-w-[220px]"
            placeholder="your-store.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
          />
          <button type="button" className="btn-primary !text-sm" onClick={connectShopify} disabled={!shopDomain.trim()}>
            Connect Shopify
          </button>
        </div>
      </div>

      {connectionsQ.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : connectionsQ.isError ? (
        <p className="text-sm text-red-400">{errMsg(connectionsQ.error)}</p>
      ) : (connectionsQ.data ?? []).length === 0 ? (
        <p className="text-sm text-pleros-text-3">No sales channels connected yet.</p>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2">
            {(connectionsQ.data ?? []).map((conn) => (
              <li
                key={conn.id}
                className="rounded-xl p-4 border flex flex-wrap gap-3 items-center justify-between"
                style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
              >
                <div>
                  <p className="text-sm text-pleros-white font-medium">
                    {conn.type}{' '}
                    {conn.shopDomain ? <span className="font-mono text-pleros-accent">{conn.shopDomain}</span> : null}
                  </p>
                  <p className="text-xs text-pleros-text-3 mt-1">
                    {conn.listingCount} listing(s) · {conn.errorCount} error(s) ·{' '}
                    {conn.isActive ? 'active' : 'disconnected'}
                    {conn.lastSyncedAt ? ` · last sync ${new Date(conn.lastSyncedAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost !text-sm" onClick={() => setSelectedConnectionId(conn.id)}>
                    View listings
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !text-sm"
                    disabled={syncAllMut.isPending}
                    onClick={() => syncAllMut.mutate(conn.id)}
                  >
                    Queue all SKUs
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !text-sm"
                    disabled={flushMut.isPending}
                    onClick={() => flushMut.mutate(conn.id)}
                  >
                    Flush now
                  </button>
                  {conn.isActive ? (
                    <button
                      type="button"
                      className="btn-ghost !text-sm text-red-400"
                      disabled={disconnectMut.isPending}
                      onClick={() => disconnectMut.mutate(conn.id)}
                    >
                      Disconnect
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {selectedConnectionId ? (
            <div className="border-t pt-4" style={{ borderColor: 'var(--c-border)' }}>
              <p className="text-xs uppercase tracking-wider text-pleros-text-3 mb-2">Listing sync status</p>
              {listingsQ.isLoading ? (
                <div className="skeleton h-20 w-full" />
              ) : (listingsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-pleros-text-3">No listings queued — use Queue all SKUs after connecting.</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto">
                  {(listingsQ.data ?? []).map((listing) => (
                    <li key={listing.id} className="text-sm flex flex-wrap gap-2 items-center justify-between">
                      <span style={{ color: 'var(--c-text-2)' }}>
                        <span className="font-mono text-pleros-accent">{listing.sku?.code ?? listing.skuId.slice(-8)}</span>{' '}
                        {listing.sku?.name ?? 'SKU'} ·{' '}
                        <span
                          className={
                            listing.syncStatus === 'SYNCED'
                              ? 'text-emerald-400'
                              : listing.syncStatus === 'ERROR'
                                ? 'text-red-400'
                                : 'text-amber-400'
                          }
                        >
                          {listing.syncStatus}
                        </span>
                        {listing.lastError ? (
                          <span className="block text-xs text-red-400/90 mt-0.5">{listing.lastError}</span>
                        ) : null}
                      </span>
                      {listing.syncStatus === 'ERROR' ? (
                        <button
                          type="button"
                          className="btn-ghost !text-xs !py-1 !px-2"
                          disabled={retryMut.isPending}
                          onClick={() =>
                            retryMut.mutate({ connectionId: selectedConnectionId, listingId: listing.id })
                          }
                        >
                          Retry
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {errorListings.length > 0 ? (
                <p className="text-xs text-pleros-text-3 mt-2">{errorListings.length} listing(s) need attention.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {disconnectMut.error ? <p className="text-sm text-red-400 mt-2">{errMsg(disconnectMut.error)}</p> : null}
    </div>
  )
}
