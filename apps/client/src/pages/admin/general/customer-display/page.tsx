import { useEffect, useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { errMsg, useTenantMe, useTenantMetadataPatch } from '@/hooks/use-tenant-metadata'
import { readMetadata } from '@/lib/tenant-metadata'

export default function CustomerDisplayPage() {
  const tenantQ = useTenantMe()
  const patch = useTenantMetadataPatch()
  const meta = readMetadata(tenantQ.data)
  const display = meta.general?.customerDisplay ?? {}

  const [welcomeMessage, setWelcomeMessage] = useState('Welcome to our store')
  const [supportPhone, setSupportPhone] = useState('')
  const [showPrices, setShowPrices] = useState(true)
  const [showStock, setShowStock] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setWelcomeMessage(display.welcomeMessage ?? 'Welcome to our store')
    setSupportPhone(display.supportPhone ?? '')
    setShowPrices(display.showPrices ?? true)
    setShowStock(display.showStock ?? true)
  }, [display.welcomeMessage, display.supportPhone, display.showPrices, display.showStock])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    await patch.mutateAsync({
      general: {
        ...meta.general,
        customerDisplay: { welcomeMessage, supportPhone, showPrices, showStock },
      },
    })
    setSaved(true)
  }

  return (
    <AdminPageShell title="Customer Facing Display" section="General" description="Controls what buyers see on the storefront and portal.">
      <form onSubmit={(e) => void save(e)} className="max-w-lg space-y-4 rounded-xl p-5" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Welcome message</span>
          <input className="cosmos-input w-full" value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Support phone</span>
          <input className="cosmos-input w-full" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} />
          Show prices to customers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showStock} onChange={(e) => setShowStock(e.target.checked)} />
          Show stock availability
        </label>
        {patch.error ? <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(patch.error)}</p> : null}
        {saved ? <p className="text-sm" style={{ color: 'var(--c-success)' }}>Display settings saved.</p> : null}
        <button type="submit" className="btn-primary" disabled={patch.isPending}>Save display</button>
      </form>
    </AdminPageShell>
  )
}
