'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  externalRef?: string | null
  createdAt: string
  updatedAt: string
}

type ActivityRow = {
  id: string
  type: string
  subject?: string | null
  body?: string | null
  occurredAt: string
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function CustomerDetailPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : params.id?.[0] ?? ''
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [editing, setEditing] = useState(false)

  const customer = useQuery<Customer>({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const activities = useQuery<ActivityRow[]>({
    queryKey: ['activities', 'customer', id],
    queryFn: () => api.get(`/activities?customerId=${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const patch = useMutation({
    mutationFn: (body: Partial<{ name: string; email?: string; phone?: string; externalRef?: string }>) =>
      api.patch(`/customers/${encodeURIComponent(id)}`, body),
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['customer', id] })
      void qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  const [noteSubject, setNoteSubject] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const addNote = useMutation({
    mutationFn: () =>
      api.post('/activities', {
        type: 'NOTE',
        subject: noteSubject.trim() || undefined,
        body: noteBody.trim() || undefined,
        customerId: id,
      }),
    onSuccess: () => {
      setNoteSubject('')
      setNoteBody('')
      void qc.invalidateQueries({ queryKey: ['activities', 'customer', id] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  if (!id) return null

  const c = customer.data

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers" className="text-sm text-cosmos-muted hover:text-cosmos-white">
          ← Customers
        </Link>
      </div>

      {customer.isLoading ? (
        <p className="text-cosmos-muted">Loading…</p>
      ) : customer.error || !c ? (
        <p className="text-red-400">Customer not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-cosmos-white">{c.name}</h1>
              <p className="font-mono text-xs text-cosmos-muted mt-1">{c.id}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing((e) => !e)
                if (!editing) {
                  setName(c.name)
                  setEmail(c.email ?? '')
                  setPhone(c.phone ?? '')
                  setExternalRef(c.externalRef ?? '')
                }
              }}
              className="h-9 px-4 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            >
              {editing ? 'Cancel edit' : 'Edit'}
            </button>
          </div>

          {editing ? (
            <Card>
              <CardTitle>Profile</CardTitle>
              <div className="mt-4 space-y-3 max-w-xl">
                <input
                  className="w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                />
                <input
                  className="w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                />
                <input
                  className="w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone"
                />
                <input
                  className="w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="External ref (B2B customer ref)"
                />
              </div>
              {patch.error && <p className="text-red-400 text-xs mt-2">{errMsg(patch.error)}</p>}
              <button
                type="button"
                disabled={!name.trim() || patch.isPending}
                onClick={() =>
                  patch.mutate({
                    name: name.trim(),
                    email: email.trim() || undefined,
                    phone: phone.trim() || undefined,
                    externalRef: externalRef.trim() || undefined,
                  })
                }
                className="mt-4 h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
              >
                {patch.isPending ? 'Saving…' : 'Save'}
              </button>
            </Card>
          ) : (
            <Card>
              <CardTitle>Contact</CardTitle>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Email</dt>
                  <dd className="text-cosmos-text">{c.email ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Phone</dt>
                  <dd className="text-cosmos-text">{c.phone ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">External ref</dt>
                  <dd className="font-mono text-xs text-cosmos-text">{c.externalRef ?? '—'}</dd>
                </div>
              </dl>
            </Card>
          )}

          <Card>
            <CardTitle>Add note</CardTitle>
            <input
              className="mt-4 w-full max-w-xl rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              placeholder="Subject (optional)"
              value={noteSubject}
              onChange={(e) => setNoteSubject(e.target.value)}
            />
            <textarea
              className="mt-2 w-full max-w-xl rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              rows={3}
              placeholder="Note body"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            {addNote.error && <p className="text-red-400 text-xs mt-2">{errMsg(addNote.error)}</p>}
            <button
              type="button"
              disabled={addNote.isPending || (!noteSubject.trim() && !noteBody.trim())}
              onClick={() => addNote.mutate()}
              className="mt-3 h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            >
              {addNote.isPending ? 'Saving…' : 'Save note'}
            </button>
          </Card>

          <Card>
            <CardTitle>Activity</CardTitle>
            {activities.isLoading ? (
              <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
            ) : (activities.data ?? []).length === 0 ? (
              <p className="text-cosmos-muted text-sm mt-3">No activities yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {(activities.data ?? []).map((a) => (
                  <li key={a.id} className="border border-cosmos-border rounded-lg p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <StatusBadge status={a.type} />
                      <span className="text-cosmos-muted text-xs">
                        {new Date(a.occurredAt).toLocaleString()}
                      </span>
                    </div>
                    {a.subject && <p className="text-cosmos-white font-medium mt-2">{a.subject}</p>}
                    {a.body && (
                      <p className="text-cosmos-text mt-1 whitespace-pre-wrap">{a.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
