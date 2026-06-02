import { Link, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { axiosErr } from '@/lib/axios-error'

type WaveDetail = {
  id: string
  warehouseId: string
  status: string
  createdAt: string
  tasks: { id: string; taskId: string }[]
  pickPath: Array<{
    taskId: string
    orderId: string
    lineId: string
    skuId: string
    quantity: number
    pickedQty: number
    status: string
    binCode?: string
  }>
}

export default function WarehouseWaveDetailPage() {
  const params = useParams<{ id: string }>()
  const waveId = params?.id ?? ''
  const [wave, setWave] = useState<WaveDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!waveId) return
    setLoading(true)
    setErr(null)
    try {
      const data = await api.get<WaveDetail>(`/pick-waves/${encodeURIComponent(waveId)}`)
      setWave(data)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setLoading(false)
    }
  }, [waveId])

  useEffect(() => {
    void load()
  }, [load])

  async function startWave() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/pick-waves/${encodeURIComponent(waveId)}/start`, {})
      await load()
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function completeWave() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/pick-waves/${encodeURIComponent(waveId)}/complete`, {})
      await load()
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  const taskIds = new Set(wave?.tasks.map((t) => t.taskId) ?? [])

  return (
    <div>
      <OfflineBanner />
      <Link to="/m/warehouse" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
        ← Warehouse
      </Link>
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}
      {err ? <p style={{ color: 'var(--c-danger)', fontSize: 13, marginTop: 12 }}>{err}</p> : null}
      {wave ? (
        <div style={{ marginTop: 16 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontFamily: 'var(--font-syne)' }}>
            Wave #{wave.id.slice(-8)}
          </h1>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            {wave.status.replace(/_/g, ' ')} · {wave.tasks.length} task{wave.tasks.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {wave.status === 'OPEN' ? (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void startWave()}>
                Start wave
              </button>
            ) : null}
            {wave.status === 'IN_PROGRESS' ? (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void completeWave()}>
                Complete wave
              </button>
            ) : null}
          </div>

          <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 10, opacity: 0.85 }}>Pick path (by bin)</h2>
          {wave.pickPath.length === 0 ? (
            <p style={{ opacity: 0.6, fontSize: 13 }}>No pick lines in this wave.</p>
          ) : (
            wave.pickPath.map((line) => (
              <Link
                key={line.lineId}
                to={`/m/warehouse/task/${line.taskId}`}
                className="cosmos-mobile-card"
                style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginBottom: 8 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>
                    {line.binCode ? `Bin ${line.binCode}` : 'No bin assigned'}
                  </strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>{line.status}</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.75 }}>
                  SKU …{line.skuId.slice(-6)} · qty {line.quantity} · order …{line.orderId.slice(-6)}
                </p>
              </Link>
            ))
          )}

          <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 10, opacity: 0.85 }}>Pick tasks</h2>
          {wave.tasks.length === 0 ? (
            <p style={{ opacity: 0.6, fontSize: 13 }}>No tasks in this wave.</p>
          ) : (
            [...taskIds].map((taskId) => (
              <Link
                key={taskId}
                to={`/m/warehouse/task/${taskId}`}
                className="cosmos-mobile-card"
                style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginBottom: 10 }}
              >
                <strong style={{ fontSize: 14 }}>Task …{taskId.slice(-8)}</strong>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
