import { MetadataListManager } from '@/components/admin/metadata-list-manager'
import { useMetadataList } from '@/hooks/use-tenant-metadata'

export default function CustomerGroupsPage() {
  const groups = useMetadataList('sales', 'customerGroups')
  return (
    <MetadataListManager
      title="Customer Group"
      section="Sales"
      description="Segment customers for pricing and promotions."
      itemLabel="Customer group"
      items={groups.items}
      onSave={groups.save}
      isLoading={groups.isLoading}
      isSaving={groups.isSaving}
    />
  )
}
