import { useEffect, useState } from 'react'
import { useQueryParams } from '@/lib/use-query-params'
import { TabId } from './types'
import { CompanyTab } from './tabs/company-tab'
import { UsersTab } from './tabs/users-tab'
import { WarehousesTab } from './tabs/warehouses-tab'
import { IntegrationsTab } from './tabs/integrations-tab'
import { BillingTab } from './tabs/billing-tab'
import { FeaturesTab } from './tabs/features-tab'
import { AuditTab } from './tabs/audit-tab'

const TAB_IDS: TabId[] = ['company', 'users', 'warehouses', 'integrations', 'billing', 'features', 'audit']

const SETTINGS_TABS: Array<[TabId, string]> = [
  ['company', 'Company'],
  ['users', 'Users'],
  ['warehouses', 'Warehouses'],
  ['integrations', 'Integrations'],
  ['billing', 'Billing'],
  ['features', 'Features'],
  ['audit', 'Audit log'],
]

function tabFromSearchParams(raw: string | null): TabId {
  if (raw && TAB_IDS.includes(raw as TabId)) return raw as TabId
  return 'company'
}

export default function SettingsPage() {
  const searchParams = useQueryParams()
  const [tab, setTab] = useState<TabId>(() => tabFromSearchParams(searchParams.get('tab')))

  useEffect(() => {
    setTab(tabFromSearchParams(searchParams.get('tab')))
  }, [searchParams])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
          Settings
        </h1>
        <p className="text-pleros-text-3 text-sm mt-1">Company profile, people, warehouses, integrations, and plan</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2" style={{ borderColor: 'var(--c-border)' }}>
        {SETTINGS_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'btn-primary !py-2 !px-3' : 'btn-ghost !py-2 !px-3'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'company' && <CompanyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'warehouses' && <WarehousesTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'billing' && <BillingTab />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}
