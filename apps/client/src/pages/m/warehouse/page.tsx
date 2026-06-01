import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
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

type WaveRow = {
  id: string
  status: string
  createdAt: string
  tasks: { taskId: string }[]
}

export default function WarehouseMobilePage() {
  const [tab, setTab] = useState<'tasks' | 'waves'>('tasks')
  const [tasks, setTasks] = useState<Task[]>([])
  const [waves, setWaves] = useState<WaveRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [taskData, waveData] = await Promise.all([
        api.get<Task[]>('/wms/tasks'),
        api.get<WaveRow[]>('/pick-waves').catch(() => [] as WaveRow[]),
      ])
      setTasks(Array.isArray(taskData) ? taskData : [])
      setWaves(Array.isArray(waveData) ? waveData : [])
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

  const activeWaves = waves.filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')

  return (
    <div>
      <OfflineBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'var(--font-syne)' }}>Warehouse</h1>
        <button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['tasks', 'waves'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={tab === k ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => setTab(k)}
          >
            {k === 'tasks' ? 'Pick tasks' : 'Waves'}
          </button>
        ))}
      </div>

      <Link to="/m/warehouse/receiving" className="cosmos-mobile-card" style={{ display: 'block', color: 'inherit', marginBottom: 12 }}>
        <strong>Receiving</strong>
        <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 13 }}>Start or continue a receiving session</p>
      </Link>

      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}
      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}

      {!loading && tab === 'tasks' && (
        <>
          {tasks.map((t) => (
            <Link
              key={t.id}
              to={`/m/warehouse/task/${t.id}`}
              className="cosmos-mobile-card"
              style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginBottom: 10 }}
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
          {!err && tasks.length === 0 && (
            <p style={{ opacity: 0.6, textAlign: 'center', marginTop: 24 }}>No pending tasks</p>
          )}
        </>
      )}

      {!loading && tab === 'waves' && (
        <>
          {activeWaves.map((w) => (
            <Link
              key={w.id}
              to={`/m/warehouse/waves/${w.id}`}
              className="cosmos-mobile-card"
              style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginBottom: 10 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Wave #{w.id.slice(-8)}</strong>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{w.status.replace(/_/g, ' ')}</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.7 }}>
                {w.tasks.length} task{w.tasks.length === 1 ? '' : 's'} · {new Date(w.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
          {activeWaves.length === 0 ? (
            <p style={{ opacity: 0.6, textAlign: 'center', marginTop: 24 }}>
              No active pick waves — create one in Cosmos Admin → Warehouse.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
