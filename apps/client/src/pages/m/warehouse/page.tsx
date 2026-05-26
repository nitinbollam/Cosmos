import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'

type Task = {
  id: string
  orderId: string
  status: string
  priority?: string
  warehouseCode?: string
  pickItems?: { id: string }[]
}

export default function WarehouseMobilePage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const data = await api.get<Task[]>('/wms/tasks?status=PENDING')
      setTasks(Array.isArray(data) ? data : [])
    } catch (e) {
      if (!navigator.onLine) {
        enqueueAction('wms_tasks_refresh', {})
        setErr('Offline — showing last state when available')
      } else {
        setErr(axiosErr(e))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <OfflineBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'var(--font-syne)' }}>Pick tasks</h1>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <Link to="/m/warehouse/receiving" className="cosmos-mobile-card" style={{ display: 'block', color: 'inherit' }}>
        <strong>Receiving</strong>
        <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 13 }}>Start or continue a receiving session</p>
      </Link>
      {err && <p style={{ color: '#f87171', fontSize: 13 }}>{err}</p>}
      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
      {!loading &&
        tasks.map((t) => (
          <Link
            key={t.id}
            to={`/m/warehouse/task/${t.id}`}
            className="cosmos-mobile-card"
            style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>Order #{t.orderId.slice(-8).toUpperCase()}</strong>
              <span style={{ fontSize: 12, opacity: 0.8 }}>{t.status}</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.7 }}>
              {(t.pickItems?.length ?? 0)} items · {t.priority ?? 'normal'} · {t.warehouseCode ?? '—'}
            </p>
          </Link>
        ))}
      {!loading && !err && tasks.length === 0 && (
        <p style={{ opacity: 0.6, textAlign: 'center', marginTop: 24 }}>No pending tasks</p>
      )}
    </div>
  )
}
