import type { ReactNode } from 'react'
import { PodPhoto } from './PodPhoto'
import { PodSignature } from './PodSignature'

export type StopFailureRecord = { reason: string; failedAt: string; failedBy?: string | null }

/** What `RouteStop.pod` can hold: delivery evidence, a failure, or both (failed, then redelivered). */
export type StopOutcomePod = {
  photoUrl?: string | null
  signatureDataUrl?: string | null
  deliveredAt?: string | null
  recipientName?: string | null
  notes?: string | null
  ageConfirmed?: boolean | null
  failure?: StopFailureRecord | null
}

type StopOutcomeDetailsProps = {
  status: string
  pod?: StopOutcomePod | null
  /** Resolves a user id to a display name; returns null when it can't (e.g. no users.read). */
  nameFor?: (userId: string) => string | null
}

function when(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="w-24 shrink-0 text-pleros-muted">{label}</dt>
      <dd className="text-pleros-text min-w-0 break-words">{children}</dd>
    </div>
  )
}

/**
 * Staff view of a stop's outcome: the proof of delivery (photo, signature, who
 * received it, when, notes, age check) or why it failed. Includes the signature,
 * so it belongs on staff surfaces only, never the customer's.
 */
export function StopOutcomeDetails({ status, pod, nameFor }: StopOutcomeDetailsProps) {
  const failure = pod?.failure ?? null
  const failedBy = failure?.failedBy ? nameFor?.(failure.failedBy) : null

  const failureRows = failure && (
    <>
      <Row label={status === 'FAILED' ? 'Reason' : 'Earlier attempt'}>
        <span className="text-red-400">{failure.reason}</span>
      </Row>
      {when(failure.failedAt) && <Row label="Failed at">{when(failure.failedAt)}</Row>}
      {failedBy && <Row label="Marked by">{failedBy}</Row>}
    </>
  )

  if (status === 'FAILED') {
    return <dl className="space-y-1">{failureRows ?? <Row label="Reason">No reason recorded</Row>}</dl>
  }

  if (status !== 'DELIVERED') return null

  const hasEvidence = !!(pod?.photoUrl || pod?.signatureDataUrl)
  return (
    <div className="flex flex-wrap gap-4 items-start">
      {hasEvidence && (
        <div className="flex flex-col gap-2">
          <PodPhoto src={pod?.photoUrl} caption="Delivery photo" />
          <PodSignature src={pod?.signatureDataUrl} />
        </div>
      )}
      <dl className="space-y-1 min-w-[12rem] flex-1">
        {!hasEvidence && <Row label="Proof">No photo or signature captured</Row>}
        <Row label="Received by">{pod?.recipientName || 'Not recorded'}</Row>
        {when(pod?.deliveredAt) && <Row label="Delivered at">{when(pod?.deliveredAt)}</Row>}
        <Row label="Age checked">{pod?.ageConfirmed ? 'Yes' : 'No'}</Row>
        {pod?.notes && <Row label="Notes">{pod.notes}</Row>}
        {failureRows}
      </dl>
    </div>
  )
}
