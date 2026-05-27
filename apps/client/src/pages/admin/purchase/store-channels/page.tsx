import { MetadataListManager } from '@/components/admin/metadata-list-manager'
import { useEffect } from 'react'
import { useMetadataList } from '@/hooks/use-tenant-metadata'

const DEFAULT_CHANNELS = ['B2B_PORTAL', 'POS', 'SALES_REP', 'API']

export default function StoreChannelsPage() {
  const channels = useMetadataList('purchase', 'storeChannels')

  useEffect(() => {
    if (!channels.isLoading && channels.items.length === 0) {
      void channels.save(DEFAULT_CHANNELS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed defaults once
  }, [channels.isLoading, channels.items.length])

  return (
    <MetadataListManager
      title="Store Channel"
      section="Purchase"
      description="Sales channels used on orders (B2B portal, POS, rep, API)."
      itemLabel="Channel"
      items={channels.items.length ? channels.items : DEFAULT_CHANNELS}
      onSave={channels.save}
      isLoading={channels.isLoading}
      isSaving={channels.isSaving}
    />
  )
}
