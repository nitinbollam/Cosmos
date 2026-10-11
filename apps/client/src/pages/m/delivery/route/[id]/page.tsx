import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import { PhotoCapture, type CapturedPhoto } from '@/components/pod/PhotoCapture'
import { PodPhoto } from '@/components/pod/PodPhoto'
import { SignaturePad, type CapturedSignature } from '@/components/pod/SignaturePad'
import { COMMON_FAILURE_REASONS, MAX_FAILURE_REASON_LENGTH } from '@/components/pod/failure-reasons'
import { AgeTag, StopItems, type StopItem } from '@/components/pod/StopItems'

type StopFailure = { reason: string; failedAt: string }

type StopPod = {
  photoUrl?: string | null
  signatureDataUrl?: string | null
  deliveredAt?: string | null
  failure?: StopFailure | null
}

type Stop = {
  id: string
  sequence: number
  status: string
  address?: unknown
  pod?: StopPod | null
  // What is being delivered here, sent by the server for stops linked to an order.
  items?: StopItem[]
  ageRestricted?: boolean
  minimumAge?: number | null
  /** The recipient's age must be confirmed before this stop can be delivered. */
  ageCheckRequired?: boolean
}

/** Who and where, from the stop's address: name on one line, street/city on the next. */
function stopAddressLines(address: unknown): { who: string | null; where: string } {
  if (typeof address === 'string') return { who: null, where: address }
  if (!address || typeof address !== 'object') return { who: null, where: '' }
  const a = address as Record<string, unknown>
  const str = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null)
  const cityLine = [str('city'), [str('state'), str('postalCode')].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return {
    who: str('company') ?? str('customer'),
    where: [str('line1'), str('line2'), cityLine].filter(Boolean).join(', '),
  }
}

type RouteDetail = {
  id: string
  status: string
  stops: Stop[]
}

/**
 * Make sure a stop reads as delivered once its POD has been accepted.
 *
 * The POD response is the route as just written, but on staging reads have lagged
 * writes by up to ~30 s, and a stop still showing PENDING invites a second tap
 * that would submit an empty POD over the real one.
 */
/** What the driver records at the door, per stop. Never shared between stops. */
type StopDetails = { recipientName: string; notes: string; ageConfirmed: boolean }

const EMPTY_DETAILS: StopDetails = { recipientName: '', notes: '', ageConfirmed: false }

function withStopDelivered(route: RouteDetail, stopId: string, pod: StopPod): RouteDetail {
  return {
    ...route,
    stops: route.stops.map((s) =>
      s.id === stopId && s.status !== 'DELIVERED' ? { ...s, status: 'DELIVERED', pod: s.pod ?? pod } : s,
    ),
  }
}

export default function DeliveryRoutePage() {
  const { id } = useParams<{ id: string }>()
  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Everything captured for a delivery is held per stop and cleared once the stop
  // has an outcome, so a name, note or age confirmation can't carry over to the
  // next stop.
  const [details, setDetails] = useState<Record<string, StopDetails>>({})
  const [photos, setPhotos] = useState<Record<string, CapturedPhoto | null>>({})
  const [signatures, setSignatures] = useState<Record<string, CapturedSignature | null>>({})
  // Stops whose photo is still being downscaled: their `photos` entry is not final yet.
  const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  // The stop whose "mark failed" form is open, and the reason being entered.
  const [failingStop, setFailingStop] = useState<string | null>(null)
  const [failReason, setFailReason] = useState('')

  const detailsFor = (stopId: string) => details[stopId] ?? EMPTY_DETAILS
  const setDetail = (stopId: string, patch: Partial<StopDetails>) =>
    setDetails((prev) => ({ ...prev, [stopId]: { ...(prev[stopId] ?? EMPTY_DETAILS), ...patch } }))
  const clearStop = (stopId: string) => {
    setPhotos((prev) => ({ ...prev, [stopId]: null }))
    setSignatures((prev) => ({ ...prev, [stopId]: null }))
    setDetails((prev) => ({ ...prev, [stopId]: EMPTY_DETAILS }))
  }

  useEffect(() => {
    if (!id) return
    void api
      .get<RouteDetail>(`/routes/${encodeURIComponent(id)}`)
      .then(setRoute)
      .catch((e) => setErr(axiosErr(e)))
  }, [id])

  /** Which proof of delivery is still missing for this stop, or null when none is. */
  function missingEvidence(stop: Stop): string | null {
    const missing = [
      !photos[stop.id] && 'photo',
      !signatures[stop.id] && 'signature',
      stop.ageCheckRequired && !detailsFor(stop.id).ageConfirmed && 'age check',
    ].filter((x): x is string => !!x)
    if (missing.length === 0) return null
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} required`
  }

  async function markDelivered(stopId: string) {
    // Proof of delivery is mandatory; the server enforces it too.
    const stop = route?.stops.find((x) => x.id === stopId)
    if (!id || !stop || submitting || photoBusy[stopId] || missingEvidence(stop)) return
    setSubmitting(stopId)
    const pod = {
      deliveredAt: new Date().toISOString(),
      signatureDataUrl: signatures[stopId]?.dataUrl ?? null,
      // A data: URL is a valid URL, so the existing photoUrl field carries the
      // downscaled JPEG. Swapping to hosted storage later means changing what
      // goes in here and what the server's POD check accepts.
      photoUrl: photos[stopId]?.dataUrl ?? null,
    }
    const { recipientName, notes, ageConfirmed } = detailsFor(stopId)
    try {
      const updated = await api.post<RouteDetail>(`/dispatch/stops/${stopId}/pod`, {
        routeId: id,
        ...pod,
        notes: notes.trim() || undefined,
        ageConfirmed,
        recipientName: recipientName.trim() || undefined,
      })
      setRoute(withStopDelivered(updated, stopId, pod))
      clearStop(stopId)
      setErr(null)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setSubmitting(null)
    }
  }

  function openFailForm(stopId: string) {
    setFailingStop(stopId)
    setFailReason('')
  }

  // An in-page form rather than window.prompt: prompts are blocked in some in-app
  // browsers and PWA wrappers, where the button then silently did nothing.
  async function markFailed(stopId: string) {
    const reason = failReason.trim()
    if (!id || submitting || !reason) return
    setSubmitting(stopId)
    try {
      // Use the route as just written: a re-read can lag and still show the stop pending.
      const updated = await api.post<RouteDetail>(
        `/routes/${encodeURIComponent(id)}/stops/${encodeURIComponent(stopId)}/failed`,
        { reason },
      )
      setRoute(updated)
      clearStop(stopId)
      setFailingStop(null)
      setFailReason('')
      setErr(null)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div>
      <Link to="/m/delivery" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← Routes
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Route {id?.slice(-8)}</h1>
      {err && <p style={{ color: 'var(--c-danger)' }}>{err}</p>}
      {(route?.stops ?? []).map((s) => (
        <div key={s.id} className="pleros-mobile-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <strong>Stop #{s.sequence}</strong>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {s.ageRestricted && <AgeTag minimumAge={s.minimumAge ?? null} />}
              <span style={{ fontSize: 12 }}>{s.status}</span>
            </span>
          </div>
          {(() => {
            const { who, where } = stopAddressLines(s.address)
            return (
              <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                {who && <span style={{ fontWeight: 600, display: 'block' }}>{who}</span>}
                {where && <span style={{ opacity: 0.7 }}>{where}</span>}
              </p>
            )
          })()}
          <StopItems items={s.items} />
          {s.status === 'DELIVERED' &&
            (s.pod?.photoUrl ? (
              <PodPhoto src={s.pod.photoUrl} caption="Proof of delivery" />
            ) : (
              <p style={{ fontSize: 12, opacity: 0.7, margin: '8px 0 0' }}>Delivered · no photo recorded</p>
            ))}
          {s.status === 'FAILED' && (
            <p style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--c-danger)' }}>
              Failed · {s.pod?.failure?.reason ?? 'no reason recorded'}
            </p>
          )}
          {s.status !== 'DELIVERED' && s.status !== 'FAILED' && failingStop === s.id && (
            <div style={{ marginTop: 8 }}>
              <label htmlFor={`fail-reason-${s.id}`} style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Why couldn't this stop be delivered?
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {COMMON_FAILURE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    aria-pressed={failReason === r}
                    onClick={() => setFailReason(r)}
                    disabled={submitting === s.id}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                id={`fail-reason-${s.id}`}
                className="pleros-input"
                placeholder="Reason (required)"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                rows={2}
                maxLength={MAX_FAILURE_REASON_LENGTH}
                style={{ width: '100%' }}
                disabled={submitting === s.id}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void markFailed(s.id)}
                  disabled={!!submitting || !failReason.trim()}
                >
                  {submitting === s.id ? 'Saving…' : 'Mark failed'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFailingStop(null)}
                  disabled={submitting === s.id}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {s.status !== 'DELIVERED' && s.status !== 'FAILED' && (
            // Hidden, not unmounted, while the failed form is open: the photo and the
            // signature strokes must still be there if the driver cancels.
            <div hidden={failingStop === s.id}>
              <input
                className="pleros-input"
                placeholder="Recipient name (optional)"
                aria-label={`Recipient name, stop ${s.sequence}`}
                value={detailsFor(s.id).recipientName}
                onChange={(e) => setDetail(s.id, { recipientName: e.target.value })}
                style={{ width: '100%', margin: '8px 0' }}
                disabled={submitting === s.id}
              />
              <textarea
                className="pleros-input"
                placeholder="POD notes (optional)"
                aria-label={`POD notes, stop ${s.sequence}`}
                value={detailsFor(s.id).notes}
                onChange={(e) => setDetail(s.id, { notes: e.target.value })}
                rows={2}
                style={{ width: '100%', marginBottom: 8 }}
                disabled={submitting === s.id}
              />
              {/* Only stops with age-restricted products ask for the age check. */}
              {s.ageRestricted && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={detailsFor(s.id).ageConfirmed}
                    onChange={(e) => setDetail(s.id, { ageConfirmed: e.target.checked })}
                    disabled={submitting === s.id}
                  />
                  <span>
                    I checked the recipient’s ID: they are {s.minimumAge ?? 21} or older
                    {s.ageCheckRequired ? ' (required)' : ''}
                  </span>
                </label>
              )}
              <PhotoCapture
                value={photos[s.id] ?? null}
                onChange={(photo) => setPhotos((prev) => ({ ...prev, [s.id]: photo }))}
                onBusyChange={(busy) => setPhotoBusy((prev) => ({ ...prev, [s.id]: busy }))}
                disabled={submitting === s.id}
              />
              <SignaturePad
                value={signatures[s.id] ?? null}
                onChange={(sig) => setSignatures((prev) => ({ ...prev, [s.id]: sig }))}
                disabled={submitting === s.id}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void markDelivered(s.id)}
                  // Needs a finished photo and a signature: a photo still being
                  // processed would submit the previous one, or none.
                  disabled={!!submitting || !!photoBusy[s.id] || !!missingEvidence(s)}
                >
                  {submitting === s.id ? 'Saving…' : photoBusy[s.id] ? 'Processing photo…' : 'Delivered'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => openFailForm(s.id)}
                  disabled={!!submitting}
                >
                  Failed
                </button>
              </div>
              {missingEvidence(s) && !photoBusy[s.id] && (
                <p style={{ fontSize: 12, opacity: 0.7, margin: '6px 0 0' }}>
                  {missingEvidence(s)}. If you can't take a photo or get a signature, mark the stop Failed with the reason.
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
