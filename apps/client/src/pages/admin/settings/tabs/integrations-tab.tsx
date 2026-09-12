import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryParams } from '@/lib/use-query-params'
import { api } from '@/lib/api-admin'
import { connectStatusLabel, type StripeConnectStatus } from '@/lib/stripe-connect'
import { WebhookManager } from '@/components/settings/webhook-manager'
import { PlerosDialogModal, PlerosSheet } from '@/components/pleros/radix-overlays'
import { MsaConfig, StripeStatus, NotificationProviderStatus, errMsg } from '../types'
import { SalesChannelsSection } from './sales-channels-section'

export function IntegrationsTab() {
  const qc = useQueryClient()
  const searchParams = useQueryParams()
  const [addOpen, setAddOpen] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [reporterDid, setReporterDid] = useState('')
  const [manufacturerDid, setManufacturerDid] = useState('')
  const [manufacturerName, setManufacturerName] = useState('')
  const [ediEndpoint, setEdiEndpoint] = useState('')
  const [msaEnabled, setMsaEnabled] = useState(true)
  const [autoSubmit, setAutoSubmit] = useState(false)

  const msaQ = useQuery<MsaConfig | null>({
    queryKey: ['msa-config'],
    queryFn: () => api.get('/msa/config'),
  })

  const stripeQ = useQuery<StripeStatus>({
    queryKey: ['stripe-status'],
    queryFn: () => api.get('/payments/stripe/status'),
  })

  const connectQ = useQuery<StripeConnectStatus>({
    queryKey: ['stripe-connect-status'],
    queryFn: () => api.get('/payments/stripe/connect/status'),
  })

  const connectOnboardMut = useMutation({
    mutationFn: () => api.post<{ url: string }>('/payments/stripe/connect/onboard', {}),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url
    },
  })

  const connectRefreshMut = useMutation({
    mutationFn: () => api.post<{ url: string }>('/payments/stripe/connect/refresh', {}),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url
    },
  })

  useEffect(() => {
    const stripeParam = searchParams.get('stripe')
    if (stripeParam === 'return' || stripeParam === 'refresh') {
      void qc.invalidateQueries({ queryKey: ['stripe-connect-status'] })
    }
  }, [searchParams, qc])

  const notifProvidersQ = useQuery<NotificationProviderStatus>({
    queryKey: ['notification-providers'],
    queryFn: () => api.get('/notifications/providers/status'),
  })

  const saveMsaMut = useMutation({
    mutationFn: () =>
      api.post('/msa/config', {
        reporterDid: reporterDid.trim(),
        manufacturerDid: manufacturerDid.trim(),
        manufacturerName: manufacturerName.trim(),
        msaEnabled,
        autoSubmit,
        ...(ediEndpoint.trim() ? { ediEndpoint: ediEndpoint.trim() } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['msa-config'] })
      setAddOpen(false)
      setReporterDid('')
      setManufacturerDid('')
      setManufacturerName('')
      setEdiEndpoint('')
      setMsaEnabled(true)
      setAutoSubmit(false)
    },
  })

  const cfg = msaQ.data

  const ediPartnersQ = useQuery<
    Array<{ id: string; code: string; name: string; inboundEnabled: boolean; outboundEnabled: boolean; autoCreateOrders: boolean }>
  >({
    queryKey: ['edi-partners'],
    queryFn: () => api.get('/edi/partners'),
  })

  const [ediCode, setEdiCode] = useState('')
  const [ediName, setEdiName] = useState('')
  const [ediDrawer, setEdiDrawer] = useState(false)

  const createEdiPartner = useMutation({
    mutationFn: () =>
      api.post('/edi/partners', {
        code: ediCode.trim(),
        name: ediName.trim(),
        autoCreateOrders: true,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edi-partners'] })
      setEdiDrawer(false)
      setEdiCode('')
      setEdiName('')
    },
  })

  const ediDocsQ = useQuery<
    Array<{ id: string; docType: string; direction: string; status: string; controlNumber: string | null; createdAt: string }>
  >({
    queryKey: ['edi-documents'],
    queryFn: () => api.get('/edi/documents?limit=20'),
  })

  return (
    <div className="space-y-6">
      <SalesChannelsSection />

      <WebhookManager />

      <div className="pleros-card">
        <div className="flex flex-wrap justify-between gap-3 mb-4">
          <div>
            <h3 className="text-pleros-white font-semibold font-display">Trading partner EDI</h3>
            <p className="text-pleros-text-3 text-sm mt-1">
              Inbound 850 purchase orders, outbound 810 invoices and 856 ship notices (JSON interchange).
            </p>
          </div>
          <button type="button" className="btn-primary !text-sm" onClick={() => setEdiDrawer(true)}>
            Add partner
          </button>
        </div>
        {ediPartnersQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : (ediPartnersQ.data ?? []).length === 0 ? (
          <p className="text-sm text-pleros-text-3">No trading partners — add one to receive EDI orders.</p>
        ) : (
          <ul className="space-y-2">
            {(ediPartnersQ.data ?? []).map((p) => (
              <li key={p.id} className="text-sm flex flex-wrap gap-3 items-center" style={{ color: 'var(--c-text-2)' }}>
                <span className="font-mono text-pleros-accent">{p.code}</span>
                <span className="text-pleros-white">{p.name}</span>
                <span className="text-xs text-pleros-text-3">
                  In: {p.inboundEnabled ? 'on' : 'off'} · Out: {p.outboundEnabled ? 'on' : 'off'} · Auto orders:{' '}
                  {p.autoCreateOrders ? 'on' : 'off'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(ediDocsQ.data ?? []).length > 0 ? (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
            <p className="text-xs uppercase tracking-wider text-pleros-text-3 mb-2">Recent EDI documents</p>
            <ul className="space-y-1 text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
              {(ediDocsQ.data ?? []).slice(0, 5).map((d) => (
                <li key={d.id}>
                  {d.docType} {d.direction} · {d.status} · {d.controlNumber ?? d.id.slice(-8)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {ediDrawer ? (
        <PlerosDialogModal open={ediDrawer} onOpenChange={setEdiDrawer} title="New EDI trading partner">
          <label className="block text-xs text-pleros-text-3 mt-2">Partner code</label>
          <input className="pleros-input mt-1 w-full" value={ediCode} onChange={(e) => setEdiCode(e.target.value)} placeholder="ACME" />
          <label className="block text-xs text-pleros-text-3 mt-3">Name</label>
          <input className="pleros-input mt-1 w-full" value={ediName} onChange={(e) => setEdiName(e.target.value)} placeholder="Acme Retail EDI" />
          <div className="flex gap-2 mt-4 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setEdiDrawer(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!ediCode.trim() || !ediName.trim() || createEdiPartner.isPending}
              onClick={() => createEdiPartner.mutate()}
            >
              Save
            </button>
          </div>
        </PlerosDialogModal>
      ) : null}

      <div>
        <h2 className="text-pleros-white font-semibold font-display">Other integrations</h2>
        <p className="text-pleros-text-3 text-sm mt-1">MSA reporting config and Stripe webhook health</p>
      </div>

      <div className="pleros-card">
        <div className="flex flex-wrap justify-between gap-3 mb-4">
          <h3 className="text-pleros-white font-semibold font-display">MSA (compliance)</h3>
          <button
            type="button"
            className="btn-primary !text-sm"
            onClick={() => {
              if (msaQ.data) {
                setReporterDid(msaQ.data.reporterDid)
                setMsaEnabled(msaQ.data.msaEnabled)
              } else {
                setReporterDid('')
                setMsaEnabled(true)
              }
              setManufacturerDid('')
              setManufacturerName('')
              setEdiEndpoint('')
              setAutoSubmit(false)
              setAddOpen(true)
            }}
          >
            Add configuration
          </button>
        </div>
        {msaQ.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : msaQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(msaQ.error)}</p>
        ) : !cfg ? (
          <p className="text-sm text-pleros-text-3">No MSA tenant config yet — add reporter and manufacturer DIDs.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-pleros-text-2">
              Reporter DID: <span className="font-mono text-pleros-accent">{cfg.reporterDid}</span> · MSA{' '}
              {cfg.msaEnabled ? 'enabled' : 'disabled'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {cfg.manufacturerDids.map((m) => (
                <div key={m.id} className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
                  <p className="font-mono text-xs text-pleros-accent break-all">{m.manufacturerDid}</p>
                  <p className="text-pleros-white font-medium mt-1">{m.manufacturerName}</p>
                  <p className="text-xs text-pleros-text-3 mt-2">
                    EDI: {m.ediEndpoint || '—'} · Auto-submit: {m.autoSubmit ? 'on' : 'off'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pleros-card">
        <h3 className="text-pleros-white font-semibold font-display mb-3">Notification delivery</h3>
        <p className="text-pleros-text-3 text-sm mb-4">Email, SMS, and webhook delivery status for your tenant.</p>
        {notifProvidersQ.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : notifProvidersQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(notifProvidersQ.error)}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
              <p className="text-sm text-pleros-white font-medium">Email</p>
              <p className="text-xs text-pleros-text-3 mt-2">
                Provider: <span className="font-mono text-pleros-accent">{notifProvidersQ.data?.email.provider}</span>
              </p>
              <p className="text-xs text-pleros-text-3 mt-1">
                Configured:{' '}
                <strong className={notifProvidersQ.data?.email.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {notifProvidersQ.data?.email.configured ? 'yes' : 'console fallback'}
                </strong>
              </p>
              <p className="text-xs text-pleros-text-3 mt-1">From: {notifProvidersQ.data?.email.fromEmail}</p>
            </div>
            <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
              <p className="text-sm text-pleros-white font-medium">SMS</p>
              <p className="text-xs text-pleros-text-3 mt-2">
                Provider: <span className="font-mono text-pleros-accent">{notifProvidersQ.data?.sms.provider}</span>
              </p>
              <p className="text-xs text-pleros-text-3 mt-1">
                Configured:{' '}
                <strong className={notifProvidersQ.data?.sms.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {notifProvidersQ.data?.sms.configured ? 'yes' : 'console fallback'}
                </strong>
              </p>
              <p className="text-xs text-pleros-text-3 mt-1">
                From: {notifProvidersQ.data?.sms.fromNumberMasked ?? '—'}
              </p>
            </div>
          </div>
        )}
        {notifProvidersQ.data ? (
          <p className="text-xs text-pleros-text-3 mt-4 whitespace-pre-wrap">{notifProvidersQ.data.setupNote}</p>
        ) : null}
      </div>

      <div className="pleros-card">
        <div className="flex flex-wrap justify-between gap-3 items-start mb-3">
          <div>
            <h3 className="text-pleros-white font-semibold font-display">Stripe Connect</h3>
            <p className="text-pleros-text-3 text-sm mt-1">
              Each distributor collects payments on their own connected account.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary !text-sm"
            disabled={connectOnboardMut.isPending || connectRefreshMut.isPending}
            onClick={() => {
              if (connectQ.data?.onboardingStatus === 'ready') {
                connectRefreshMut.mutate()
              } else {
                connectOnboardMut.mutate()
              }
            }}
          >
            {connectQ.data?.onboardingStatus === 'not_started'
              ? 'Connect Stripe'
              : connectQ.data?.onboardingStatus === 'ready'
                ? 'Manage in Stripe'
                : 'Continue onboarding'}
          </button>
        </div>
        {connectQ.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : connectQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(connectQ.error)}</p>
        ) : (
          <div className="rounded-xl p-4 border space-y-2" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
            <p className="text-sm text-pleros-text">
              Status:{' '}
              <strong className="text-pleros-accent">{connectStatusLabel(connectQ.data?.onboardingStatus ?? 'not_started')}</strong>
            </p>
            {connectQ.data?.stripeConnectedAccountId ? (
              <p className="text-xs font-mono text-pleros-text-3 break-all">{connectQ.data.stripeConnectedAccountId}</p>
            ) : null}
            <p className="text-xs text-pleros-text-3">
              Charges: {connectQ.data?.stripeChargesEnabled ? 'enabled' : 'disabled'} · Payouts:{' '}
              {connectQ.data?.stripePayoutsEnabled ? 'enabled' : 'disabled'} · Details submitted:{' '}
              {connectQ.data?.stripeDetailsSubmitted ? 'yes' : 'no'}
            </p>
            {!connectQ.data?.platformFeeConfigured ? (
              <p className="text-xs text-amber-400/90">
                Platform fee not configured (STRIPE_PLATFORM_APPLICATION_FEE_BPS unset) — no application_fee_amount on charges until product confirms fee %.
              </p>
            ) : null}
          </div>
        )}
        {connectOnboardMut.error ? <p className="text-sm text-red-400 mt-2">{errMsg(connectOnboardMut.error)}</p> : null}
      </div>

      <div className="pleros-card">
        <div className="flex flex-wrap justify-between gap-3 items-start mb-3">
          <div>
            <h3 className="text-pleros-white font-semibold font-display">Stripe (platform webhooks)</h3>
            <p className="text-pleros-text-3 text-sm mt-1">GET /payments/stripe/status · POST /webhooks/stripe/connect for Connect events</p>
          </div>
          <button type="button" className="btn-ghost !text-sm" onClick={() => setRotateOpen(true)}>
            Rotate signing secret
          </button>
        </div>
        {stripeQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : stripeQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(stripeQ.error)}</p>
        ) : (
          <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
            <p className="text-sm text-pleros-text">
              Secret key:{' '}
              <strong className={stripeQ.data?.secretKeyConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                {stripeQ.data?.secretKeyConfigured ? 'configured' : 'not configured'}
              </strong>
            </p>
            <p className="text-sm text-pleros-text mt-2">
              Webhook signing secret:{' '}
              <strong className={stripeQ.data?.webhookSigningSecretConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                {stripeQ.data?.webhookSigningSecretConfigured ? 'configured' : 'not configured'}
              </strong>
            </p>
            <p className="text-sm text-pleros-text mt-2">
              Connect webhook signing secret:{' '}
              <strong className={stripeQ.data?.connectWebhookSigningSecretConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                {stripeQ.data?.connectWebhookSigningSecretConfigured ? 'configured' : 'not configured'}
              </strong>
            </p>
          </div>
        )}
      </div>

      <PlerosSheet open={addOpen} onOpenChange={setAddOpen} title="Add MSA configuration">
        <p className="text-xs text-pleros-text-3 mb-3">Connect manufacturer reporting for regulated product categories.</p>
        <label className="text-xs text-pleros-text-3">Reporter DID</label>
        <input className="pleros-input mb-3 mt-1 font-mono text-sm" value={reporterDid} onChange={(e) => setReporterDid(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Manufacturer DID</label>
        <input className="pleros-input mb-3 mt-1 font-mono text-sm" value={manufacturerDid} onChange={(e) => setManufacturerDid(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Manufacturer name</label>
        <input className="pleros-input mb-3 mt-1" value={manufacturerName} onChange={(e) => setManufacturerName(e.target.value)} />
        <label className="text-xs text-pleros-text-3">EDI endpoint (optional)</label>
        <input className="pleros-input mb-3 mt-1 font-mono text-sm" value={ediEndpoint} onChange={(e) => setEdiEndpoint(e.target.value)} />
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={msaEnabled} onChange={(e) => setMsaEnabled(e.target.checked)} />
          <span className="text-sm text-pleros-text">MSA enabled</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} />
          <span className="text-sm text-pleros-text">Auto-submit reports</span>
        </label>
        {saveMsaMut.error && <p className="text-red-400 text-sm mb-3">{errMsg(saveMsaMut.error)}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              !reporterDid.trim() || !manufacturerDid.trim() || !manufacturerName.trim() || saveMsaMut.isPending
            }
            onClick={() => saveMsaMut.mutate()}
          >
            Save
          </button>
        </div>
      </PlerosSheet>

      <PlerosDialogModal open={rotateOpen} onOpenChange={setRotateOpen} title="Rotate Stripe webhook secret" maxWidthClass="max-w-lg">
        <p className="text-sm text-pleros-text whitespace-pre-wrap">
          {stripeQ.data?.rotation ??
            'Create a new signing secret in the Stripe Dashboard for your webhook endpoint, update STRIPE_WEBHOOK_SECRET in your environment, redeploy, then remove the old secret in Stripe.'}
        </p>
      </PlerosDialogModal>
    </div>
  )
}
