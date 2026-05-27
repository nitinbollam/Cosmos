import { useEffect, useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { errMsg, useTenantMe, useTenantMetadataPatch } from '@/hooks/use-tenant-metadata'
import { readMetadata } from '@/lib/tenant-metadata'

export default function EcomThemePage() {
  const tenantQ = useTenantMe()
  const patch = useTenantMetadataPatch()
  const meta = readMetadata(tenantQ.data)
  const theme = meta.general?.ecomTheme ?? {}

  const [primaryColor, setPrimaryColor] = useState('#6366f1')
  const [accentColor, setAccentColor] = useState('#0f172a')
  const [logoUrl, setLogoUrl] = useState('')
  const [storefrontTitle, setStorefrontTitle] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPrimaryColor(theme.primaryColor ?? '#6366f1')
    setAccentColor(theme.accentColor ?? '#0f172a')
    setLogoUrl(theme.logoUrl ?? '')
    setStorefrontTitle(theme.storefrontTitle ?? tenantQ.data?.displayName ?? '')
  }, [tenantQ.data, theme.primaryColor, theme.accentColor, theme.logoUrl, theme.storefrontTitle])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    await patch.mutateAsync({
      general: {
        ...meta.general,
        ecomTheme: { primaryColor, accentColor, logoUrl, storefrontTitle },
      },
    })
    setSaved(true)
  }

  return (
    <AdminPageShell title="E-com Theme" section="General" description="Storefront branding applied to the B2B shop.">
      <form onSubmit={(e) => void save(e)} className="max-w-lg space-y-4 rounded-xl p-5" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Storefront title</span>
          <input className="cosmos-input w-full" value={storefrontTitle} onChange={(e) => setStorefrontTitle(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Primary color</span>
          <input className="cosmos-input w-full" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Accent color</span>
          <input className="cosmos-input w-full" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Logo URL</span>
          <input className="cosmos-input w-full" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        </label>
        {patch.error ? <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(patch.error)}</p> : null}
        {saved ? <p className="text-sm" style={{ color: 'var(--c-success)' }}>Theme saved.</p> : null}
        <button type="submit" className="btn-primary" disabled={patch.isPending}>Save theme</button>
      </form>
    </AdminPageShell>
  )
}
