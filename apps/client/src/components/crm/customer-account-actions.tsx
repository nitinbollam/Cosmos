import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { PlerosDialogModal, PlerosSheet } from '@/components/pleros/radix-overlays'
import { customerFormErrors, customerFormFrom, customerPatch, type CustomerForm } from '@/lib/customer-edit'

type Customer = Parameters<typeof customerFormFrom>[0] & { id: string; name: string; isActive?: boolean | null }

const FIELD_LABELS: Array<[keyof CustomerForm, string, string?]> = [
  ['name', 'Name'],
  ['email', 'Email', 'email'],
  ['phone', 'Phone', 'tel'],
  ['firstName', 'Contact first name'],
  ['lastName', 'Contact last name'],
  ['taxId', 'Tax ID'],
  ['externalRef', 'External reference'],
  ['paymentTermsDays', 'Payment terms (days)', 'number'],
  ['primaryAddressLine1', 'Address'],
  ['primaryCity', 'City'],
  ['primaryState', 'State'],
  ['primaryZip', 'ZIP'],
]

/** Edit, deactivate / reactivate and delete for one customer (ticket 2). Shown only with crm.write. */
export function CustomerAccountActions({ customer }: { customer: Customer }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isActive = customer.isActive !== false
  const [editOpen, setEditOpen] = useState(false)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)
  const [original, setOriginal] = useState<CustomerForm>(() => customerFormFrom(customer))
  const [form, setForm] = useState<CustomerForm>(original)
  const [touched, setTouched] = useState(false)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['customer', customer.id] })
    void qc.invalidateQueries({ queryKey: ['customers'] })
  }

  const save = useMutation({
    mutationFn: () => api.patch(`/customers/${encodeURIComponent(customer.id)}`, customerPatch(original, form)),
    onSuccess: () => {
      refresh()
      setEditOpen(false)
    },
  })

  const setActive = useMutation({
    mutationFn: (next: boolean) => api.patch(`/customers/${encodeURIComponent(customer.id)}`, { isActive: next }),
    onSuccess: () => {
      refresh()
      setConfirm(null)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/customers/${encodeURIComponent(customer.id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] })
      navigate('/admin/crm')
    },
  })

  const openEdit = () => {
    const start = customerFormFrom(customer)
    setOriginal(start)
    setForm(start)
    setTouched(false)
    save.reset()
    setEditOpen(true)
  }

  const errors = customerFormErrors(form)
  const hasErrors = Object.keys(errors).length > 0
  const changed = Object.keys(customerPatch(original, form)).length > 0

  return (
    <>
      <button type="button" className="btn-ghost" onClick={openEdit}>
        Edit
      </button>
      {isActive ? (
        <button type="button" className="btn-ghost" onClick={() => { setActive.reset(); setConfirm('deactivate') }}>
          Deactivate
        </button>
      ) : (
        <button type="button" className="btn-ghost" disabled={setActive.isPending} onClick={() => setActive.mutate(true)}>
          {setActive.isPending ? 'Reactivating…' : 'Reactivate'}
        </button>
      )}
      <button
        type="button"
        className="btn-ghost"
        style={{ color: 'var(--c-danger)' }}
        onClick={() => { remove.reset(); setConfirm('delete') }}
      >
        Delete
      </button>
      {!isActive && setActive.error ? (
        <p className="text-sm w-full" role="alert" style={{ color: 'var(--c-danger)' }}>{axiosErr(setActive.error)}</p>
      ) : null}

      <PlerosSheet open={editOpen} onOpenChange={setEditOpen} title="Edit customer">
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!hasErrors && changed) save.mutate()
          }}
        >
          {FIELD_LABELS.map(([key, label, type]) => (
            <div key={key}>
              <label htmlFor={`customer-${key}`} className="text-xs font-medium block mb-1" style={{ color: 'var(--c-text-2)' }}>
                {label}
              </label>
              <input
                id={`customer-${key}`}
                className="pleros-input w-full"
                type={type ?? 'text'}
                min={type === 'number' ? 0 : undefined}
                max={type === 'number' ? 365 : undefined}
                value={form[key]}
                aria-invalid={touched && errors[key] ? true : undefined}
                aria-describedby={touched && errors[key] ? `customer-${key}-error` : undefined}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
              {touched && errors[key] ? (
                <p id={`customer-${key}-error`} className="text-xs mt-1" style={{ color: 'var(--c-danger)' }}>
                  {errors[key]}
                </p>
              ) : null}
            </div>
          ))}
          {save.error ? (
            <p className="text-sm" role="alert" style={{ color: 'var(--c-danger)' }}>{axiosErr(save.error)}</p>
          ) : null}
          <div className="flex gap-2 pt-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={save.isPending || !changed}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </PlerosSheet>

      <PlerosDialogModal
        open={confirm === 'deactivate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Deactivate ${customer.name}?`}
        maxWidthClass="max-w-md"
      >
        <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
          They won&rsquo;t be offered for new orders or quotes, and new orders and quotes for them are refused. Their orders,
          invoices and activity stay as they are, and you can reactivate them at any time.
        </p>
        {setActive.error ? (
          <p className="text-sm mt-3" role="alert" style={{ color: 'var(--c-danger)' }}>{axiosErr(setActive.error)}</p>
        ) : null}
        <div className="flex gap-2 pt-4">
          <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-1" disabled={setActive.isPending} onClick={() => setActive.mutate(false)}>
            {setActive.isPending ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </PlerosDialogModal>

      <PlerosDialogModal
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${customer.name}?`}
        maxWidthClass="max-w-md"
      >
        <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
          This permanently removes the customer and their contract prices. It&rsquo;s only allowed for a customer with no
          orders, invoices, quotes, subscriptions or payments; otherwise deactivate them instead.
        </p>
        {remove.error ? (
          <p className="text-sm mt-3" role="alert" style={{ color: 'var(--c-danger)' }}>{axiosErr(remove.error)}</p>
        ) : null}
        <div className="flex gap-2 pt-4">
          <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            style={{ background: 'var(--c-danger)' }}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Deleting…' : 'Delete customer'}
          </button>
        </div>
      </PlerosDialogModal>
    </>
  )
}
