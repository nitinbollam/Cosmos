import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { axiosErr } from '@/lib/axios-error'

type Segment = { id: string; name: string; filterCriteria: Record<string, unknown> }
type Campaign = { id: string; name: string; subject: string; status: string; sentCount: number; segmentId: string; scheduledAt?: string | null }

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [segName, setSegName] = useState('')
  const [minDays, setMinDays] = useState('')
  const [campName, setCampName] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [previewId, setPreviewId] = useState('')

  const segmentsQ = useQuery<Segment[]>({
    queryKey: ['campaign-segments'],
    queryFn: () => api.get('/campaigns/segments'),
  })

  const campaignsQ = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns'),
  })

  const previewQ = useQuery<{ total: number; sendable: number; suppressed: number }>({
    queryKey: ['segment-preview', previewId],
    queryFn: () => api.get(`/campaigns/segments/${encodeURIComponent(previewId)}/preview`),
    enabled: !!previewId,
  })

  const createSegment = useMutation({
    mutationFn: () =>
      api.post('/campaigns/segments', {
        name: segName.trim(),
        filterCriteria: {
          ...(minDays.trim() ? { minDaysSinceLastOrder: Number(minDays) } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaign-segments'] })
      setSegName('')
      setMinDays('')
    },
  })

  const createCampaign = useMutation({
    mutationFn: () =>
      api.post('/campaigns', {
        name: campName.trim(),
        segmentId,
        subject: subject.trim(),
        body,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] })
      setCampName('')
      setSubject('')
      setBody('')
      setScheduledAt('')
    },
  })

  const send = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${encodeURIComponent(id)}/send`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }),
  })

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Marketing campaigns</h1>
        <p className="text-pleros-muted text-sm mt-1">Segments, email campaigns, and suppression-safe sends.</p>
      </div>

      <Card>
        <CardTitle>Create segment</CardTitle>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            createSegment.mutate()
          }}
        >
          <input className="pleros-input" placeholder="Segment name" value={segName} onChange={(e) => setSegName(e.target.value)} required />
          <input className="pleros-input" type="number" placeholder="Min days since last order" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
          {createSegment.isError ? (
            <p className="sm:col-span-2 text-xs text-red-400">{axiosErr(createSegment.error)}</p>
          ) : null}
          <button type="submit" className="btn-primary sm:col-span-2" disabled={createSegment.isPending}>
            Save segment
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(segmentsQ.data ?? []).map((s) => (
            <button key={s.id} type="button" className="btn-ghost !text-xs" onClick={() => setPreviewId(s.id)}>
              Preview {s.name}
            </button>
          ))}
        </div>
        {previewQ.data ? (
          <p className="text-sm text-pleros-text-2 mt-2">
            {previewQ.data.sendable} sendable / {previewQ.data.total} matched ({previewQ.data.suppressed} suppressed)
          </p>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Create campaign</CardTitle>
        <form
          className="mt-4 space-y-3 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            createCampaign.mutate()
          }}
        >
          <input className="pleros-input w-full" placeholder="Campaign name" value={campName} onChange={(e) => setCampName(e.target.value)} required />
          <select className="pleros-input w-full" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} required>
            <option value="">Select segment…</option>
            {(segmentsQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input className="pleros-input w-full" placeholder="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          <textarea className="pleros-input w-full min-h-[120px]" placeholder="Email body" value={body} onChange={(e) => setBody(e.target.value)} required />
          <div>
            <label className="text-xs text-pleros-text-3 block mb-1">Schedule send date & time (optional)</label>
            <input
              className="pleros-input w-full text-sm"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          {createCampaign.isError ? (
            <p className="text-xs text-red-400">{axiosErr(createCampaign.error)}</p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={createCampaign.isPending}>
            {scheduledAt ? 'Schedule campaign' : 'Create draft'}
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle>Campaigns</CardTitle>
        {send.isError ? (
          <p className="text-xs text-red-400 mt-2">{axiosErr(send.error)}</p>
        ) : null}
        <div className="mt-4 space-y-3">
          {(campaignsQ.data ?? []).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-pleros-border/60 pb-3">
              <div>
                <p className="text-pleros-white font-medium">{c.name}</p>
                <p className="text-xs text-pleros-muted">{c.subject}</p>
                {c.scheduledAt ? (
                  <p className="text-[11px] text-pleros-accent mt-0.5">
                    Scheduled for: {new Date(c.scheduledAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                <span className="text-xs text-pleros-muted">{c.sentCount} sent</span>
                {c.status === 'DRAFT' || c.status === 'SCHEDULED' ? (
                  <button type="button" className="btn-primary !text-xs !py-1" disabled={send.isPending} onClick={() => send.mutate(c.id)}>
                    Send now
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
