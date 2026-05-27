import { MetadataListManager } from '@/components/admin/metadata-list-manager'
import { useMetadataList } from '@/hooks/use-tenant-metadata'

export default function ProductBrandsPage() {
  const brands = useMetadataList('catalog', 'brands')
  return (
    <MetadataListManager
      title="Brand"
      section="Product"
      description="Maintain product brands for your catalog."
      itemLabel="Brand"
      items={brands.items}
      onSave={brands.save}
      isLoading={brands.isLoading}
      isSaving={brands.isSaving}
    />
  )
}
