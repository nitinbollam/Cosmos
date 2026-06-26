import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'

type PickItem = {
  id: string
  skuId: string
  quantity: number
  pickedQty: number
  status: string
  binCode?: string
}

type TaskDetail = {
  id: string
  orderId: string
  status: string
  pickItems?: PickItem[]
}

function lineDone(status: string) {
  return status === 'PICKED' || status === 'SHORT'
}

export default function WarehouseTaskPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyLine, setBusyLine] = useState<string | null>(null)
  const [busyAll, setBusyAll] = useState(false)
  const [shortQty, setShortQty] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    try {
      const data = await api.get<TaskDetail>(`/wms/tasks/${encodeURIComponent(id)}`)
      setTask(data)
    } catch (e) {
      setErr(axiosErr(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function pickLine(line: PickItem, pickedQty: number, markShort?: boolean) {
    if (!id) return
    setBusyLine(line.id)
    setErr(null)
    try {
      const updated = await api.patch<TaskDetail>(
        `/wms/tasks/${encodeURIComponent(id)}/pick-lines/${encodeURIComponent(line.id)}`,
        { pickedQty, markShort },
      )
      setTask(updated)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusyLine(null)
    }
  }

  async function pickAll() {
    if (!id) return
    setBusyAll(true)
    setErr(null)
    try {
      const updated = await api.post<TaskDetail>(`/wms/tasks/${encodeURIComponent(id)}/pick-all`, {})
      setTask(updated)
    } catch (e) {
      setErr(axiosErr(e))
    } finally {
      setBusyAll(false)
    }
  }

  const pickItems = task?.pickItems ?? []
  const allDone = pickItems.length > 0 && pickItems.every((p) => lineDone(p.status))
  const canPick = task && !['CANCELLED', 'PACKED', 'DISPATCHED'].includes(task.status)

  return (
    <div>
      <Link to="/m/warehouse" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← Tasks
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Task {id?.slice(-8)}</h1>
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}
      {task && (
        <>
          <div className="pleros-mobile-card">
            <p style={{ margin: 0 }}>Status: {task.status}</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.8 }}>Order: {task.orderId}</p>
            {canPick && !allDone && (
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 12, width: '100%' }}
                disabled={busyAll || Boolean(busyLine)}
                onClick={() => void pickAll()}
              >
                {busyAll ? 'Picking…' : 'Pick all lines'}
              </button>
            )}
            {allDone && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--c-success)' }}>
                All lines picked — ready for pack in admin.
              </p>
            )}
          </div>

          {pickItems.map((li) => (
            <div key={li.id} className="pleros-mobile-card" style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>SKU …{li.skuId.slice(-6)}</strong>
                <span style={{ fontSize: 12, opacity: 0.85 }}>{li.status}</span>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.75 }}>
                Need {li.quantity} · Picked {li.pickedQty}
                {li.binCode ? (
                  <>
                    {' '}
                    · Bin <strong style={{ color: 'var(--c-accent)' }}>{li.binCode}</strong>
                  </>
                ) : null}
              </p>
              {canPick && !lineDone(li.status) && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busyLine === li.id || busyAll}
                    onClick={() => void pickLine(li, li.quantity)}
                  >
                    {busyLine === li.id ? 'Saving…' : `Pick ${li.quantity}`}
                  </button>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="pleros-input"
                      type="number"
                      min={1}
                      max={li.quantity - 1}
                      placeholder="Short qty"
                      value={shortQty[li.id] ?? ''}
                      onChange={(e) => setShortQty((s) => ({ ...s, [li.id]: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busyLine === li.id || busyAll}
                      onClick={() => {
                        const q = Number(shortQty[li.id])
                        if (!Number.isFinite(q) || q <= 0 || q >= li.quantity) {
                          setErr(`Enter a short qty between 1 and ${li.quantity - 1}`)
                          return
                        }
                        void pickLine(li, q, true)
                      }}
                    >
                      Mark short
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
