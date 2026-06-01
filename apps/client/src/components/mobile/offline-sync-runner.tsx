import { useEffect } from 'react'
import { registerOfflineSyncListeners } from '@/lib/offline-sync'

export function OfflineSyncRunner() {
  useEffect(() => {
    return registerOfflineSyncListeners()
  }, [])
  return null
}
