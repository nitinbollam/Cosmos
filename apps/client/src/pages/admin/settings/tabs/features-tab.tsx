import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { errMsg } from '../types'

type TenantFeatures = {
  pos?: boolean
  quotes?: boolean
  contractPricing?: boolean
  wavePicking?: boolean
  splitShipments?: boolean
  advancedTax?: boolean
  celestial?: boolean
}

type FeaturesDetail = {
  plan: string
  defaults: TenantFeatures
  overrides: TenantFeatures
  effective: TenantFeatures
}

const FEATURE_META: Array<{ key: keyof TenantFeatures; label: string; blurb: string }> = [
  { key: 'pos', label: 'Point of sale', blurb: 'In-store registers and POS checkout' },
  { key: 'quotes', label: 'Quotes', blurb: 'Buyer quote requests and counter-offers' },
  { key: 'contractPricing', label: 'Contract pricing', blurb: 'Customer-specific price lists and volume tiers' },
  { key: 'wavePicking', label: 'Wave picking', blurb: 'Batch pick waves in warehouse' },
  { key: 'splitShipments', label: 'Split shipments', blurb: 'Multiple packages per order with tracking' },
  { key: 'advancedTax', label: 'Advanced tax', blurb: 'Extended sales tax engine' },
  { key: 'celestial', label: 'Celestial AI', blurb: 'In-app AI assistant for buyers and admin staff' },
]

function buildFeatureOverrides(defaults: TenantFeatures, toggles: TenantFeatures): TenantFeatures {
  const overrides: TenantFeatures = {}
  for (const { key } of FEATURE_META) {
    if (toggles[key] !== defaults[key]) overrides[key] = toggles[key]
  }
  return overrides
}

export function FeaturesTab() {
  const qc = useQueryClient()
  const detailQ = useQuery<FeaturesDetail>({
    queryKey: ['tenant-features'],
    queryFn: () => api.get('/features'),
  })
  const [toggles, setToggles] = useState<TenantFeatures>({})

  useEffect(() => {
    if (detailQ.data?.effective) setToggles(detailQ.data.effective)
  }, [detailQ.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const defaults = detailQ.data?.defaults ?? {}
      return api.patch('/tenants/me', {
        settingsPatch: { features: buildFeatureOverrides(defaults, toggles) },
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-features'] })
    },
  })

  const plan = detailQ.data?.plan ?? '—'
  const overrides = detailQ.data?.overrides ?? {}

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-pleros-white font-semibold font-display">Feature flags</h2>
        <p className="text-pleros-text-3 text-sm mt-1">
          Plan defaults for <span className="font-mono text-pleros-accent">{plan}</span> · toggle overrides for your workspace
        </p>
      </div>

      <div className="pleros-card space-y-4">
        {detailQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : detailQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(detailQ.error)}</p>
        ) : (
          FEATURE_META.map(({ key, label, blurb }) => {
            const planDefault = detailQ.data?.defaults[key] ?? false
            const overridden = overrides[key] !== undefined
            return (
              <div
                key={key}
                className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0"
                style={{ borderColor: 'var(--c-border)' }}
              >
                <div>
                  <p className="text-pleros-white font-medium">{label}</p>
                  <p className="text-xs text-pleros-text-3 mt-1">{blurb}</p>
                  <p className="text-xs text-pleros-text-3 mt-1">
                    Plan default: {planDefault ? 'On' : 'Off'}
                    {overridden ? <span className="text-pleros-accent ml-2">· overridden</span> : null}
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(toggles[key])}
                    onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span className="text-sm text-pleros-text">{toggles[key] ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            )
          })
        )}
        {saveMut.error && <p className="text-red-400 text-sm">{errMsg(saveMut.error)}</p>}
        <button
          type="button"
          className="btn-primary"
          disabled={detailQ.isLoading || saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? 'Saving…' : 'Save feature overrides'}
        </button>
      </div>
    </div>
  )
}
