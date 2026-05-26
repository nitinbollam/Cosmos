import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type TaskDetail = {
  id: string
  orderId: string
  status: string
  pickItems?: { id: string; skuId: string; quantity: number }[]
}

export default function WarehouseTaskPage() {
  const { id } = useParams<{ id: string }>()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void api
      .get<TaskDetail>(`/wms/tasks/${encodeURIComponent(id)}`)
      .then(setTask)
      .catch((e) => setErr(axiosErr(e)))
  }, [id])

  return (
    <div>
      <Link to="/m/warehouse" style={{ color: '#94a3b8', fontSize: 13 }}>
        ← Tasks
      </Link>
      <h1 style={{ fontFamily: 'var(--font-syne)' }}>Task {id?.slice(-8)}</h1>
      {err && <p style={{ color: '#f87171' }}>{err}</p>}
      {task && (
        <div className="cosmos-mobile-card">
          <p>Status: {task.status}</p>
          <p>Order: {task.orderId}</p>
          <ul style={{ margin: '12px 0 0', paddingLeft: 18 }}>
            {(task.pickItems ?? []).map((li) => (
              <li key={li.id} style={{ fontSize: 13 }}>
                SKU {li.skuId.slice(-6)} × {li.quantity}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
