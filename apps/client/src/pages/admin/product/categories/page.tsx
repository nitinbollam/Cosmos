import { useQuery } from '@tanstack/react-query'
import { MetadataListManager } from '@/components/admin/metadata-list-manager'
import { api } from '@/lib/api-admin'
import { useMetadataList } from '@/hooks/use-tenant-metadata'

export default function ProductCategoriesPage() {
  const apiCategories = useQuery({ queryKey: ['sku-categories'], queryFn: () => api.get<string[]>('/skus/categories') })
  const extra = useMetadataList('catalog', 'extraCategories')

  const merged = Array.from(new Set([...(apiCategories.data ?? []), ...extra.items].filter(Boolean))).sort()

  return (
    <>
      <MetadataListManager
        title="Category"
        section="Product"
        description="Categories from products plus custom catalog categories."
        itemLabel="Category"
        items={extra.items}
        onSave={extra.save}
        isLoading={extra.isLoading || apiCategories.isLoading}
        isSaving={extra.isSaving}
      />
      <div className="px-6 pb-6 max-w-6xl -mt-2">
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border-card)' }}>
          <h2 className="font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>All categories in use</h2>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
            {merged.length ? merged.join(', ') : 'None yet — assign categories when editing products.'}
          </p>
        </div>
      </div>
    </>
  )
}
