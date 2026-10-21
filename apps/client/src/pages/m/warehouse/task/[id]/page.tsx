import { Link, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import {
  cleanScan,
  lineLabel,
  nextLine,
  progress,
  shortQtyProblem,
  taskTitle,
  type PickItem,
  type PickTask,
} from '@/lib/warehouse-tasks'

const CLOSED = ['CANCELLED', 'PACKED', 'DISPATCHED']

export default function WarehouseTaskPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<PickTask | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState('')
  const [shortQty, setShortQty] = useState('')
  const [showShort, setShowShort] = useState(false)

  const base = `/wms/tasks/${encodeURIComponent(id ?? '')}`

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    try {
      setTask(await api.get<PickTask>(`/wms/tasks/${encodeURIComponent(id)}`))
    } catch (e) {
      setErr(axiosErr(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<PickTask>) {
    setBusy(true)
    setErr(null)
    try {
      setTask(await fn())
      setScan('')
      setShortQty('')
      setShowShort(false)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = (line: PickItem) =>
    run(() => api.patch<PickTask>(`${base}/pick-lines/${encodeURIComponent(line.id)}`, { pickedQty: line.quantity, scanned: cleanScan(scan) }))

  const markShort = (line: PickItem) => {
    const problem = shortQtyProblem(shortQty, line.quantity)
    if (problem) {
      setErr(problem)
      return
    }
    return run(() =>
      api.patch<PickTask>(`${base}/pick-lines/${encodeURIComponent(line.id)}`, {
        pickedQty: Number(shortQty),
        markShort: true,
        scanned: cleanScan(scan),
      }),
    )
  }

  const release = async () => {
    setBusy(true)
    try {
      await api.post(`${base}/release`, {})
      window.location.assign('/m/warehouse')
    } catch (e) {
      setErr(axiosErr(e))
      setBusy(false)
    }
  }

  const items = task?.pickItems ?? []
  const line = nextLine(items)
  const prog = progress(items)
  const open = task ? !CLOSED.includes(task.status) : false

  return (
    <div>
      <Link to="/m/warehouse" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← Tasks
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: 4 }}>{task ? taskTitle(task) : 'Task'}</h1>
      {task && (
        <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.75 }}>
          {prog.done} of {prog.total} lines · {prog.units} of {prog.unitsTotal} units
        </p>
      )}
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}

      {task && open && line && (
        <div className="pleros-mobile-card">
          <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Go to bin</p>
          <p style={{ margin: '2px 0 8px', fontSize: 40, fontWeight: 700, color: 'var(--c-accent)', lineHeight: 1.1 }}>
            {line.binCode ?? 'No bin'}
          </p>
          <strong style={{ fontSize: 16 }}>{lineLabel(line)}</strong>
          {line.skuCode ? <p style={{ margin: '2px 0 0', fontSize: 13, opacity: 0.7 }}>{line.skuCode}</p> : null}
          <p style={{ margin: '10px 0 0', fontSize: 28, fontWeight: 600 }}>
            Pick {line.quantity}
          </p>

          <input
            className="pleros-input"
            placeholder="Scan the item (optional)"
            value={scan}
            autoFocus
            onChange={(e) => setScan(e.target.value)}
            style={{ marginTop: 12, width: '100%' }}
          />

          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 10, width: '100%', padding: 14, fontSize: 16 }}
            disabled={busy}
            onClick={() => void confirm(line)}
          >
            {busy ? 'Saving…' : `Confirm ${line.quantity}`}
          </button>

          {showShort ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <input
                className="pleros-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={line.quantity - 1}
                placeholder={`Found (0–${line.quantity - 1})`}
                value={shortQty}
                onChange={(e) => setShortQty(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void markShort(line)}>
                Mark short
              </button>
            </div>
          ) : (
            <button type="button" className="btn-ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => setShowShort(true)}>
              Can't find all of it
            </button>
          )}
        </div>
      )}

      {task && open && !line && items.length > 0 && (
        <div className="pleros-mobile-card">
          <p style={{ margin: 0, color: 'var(--c-success)' }}>All lines done. Ready to pack.</p>
        </div>
      )}

      {task && open && line && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => void run(() => api.post<PickTask>(`${base}/pick-all`, {}))}
          >
            Pick all
          </button>
          <button type="button" className="btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => void release()}>
            Release task
          </button>
        </div>
      )}

      {task && !open && <p style={{ opacity: 0.7 }}>This task is {task.status.toLowerCase()}.</p>}
    </div>
  )
}
