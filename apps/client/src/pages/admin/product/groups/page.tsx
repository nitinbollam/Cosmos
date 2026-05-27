import { MetadataListManager } from '@/components/admin/metadata-list-manager'
import { useMetadataList } from '@/hooks/use-tenant-metadata'

export default function ProductGroupsPage() {
  const groups = useMetadataList('catalog', 'productGroups')
  return (
    <MetadataListManager
      title="Product Group"
      section="Product"
      description="Group products for reporting and merchandising."
      itemLabel="Product group"
      items={groups.items}
      onSave={groups.save}
      isLoading={groups.isLoading}
      isSaving={groups.isSaving}
    />
  )
}
