import { Stack } from 'expo-router'
import { useEffect } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { useAuthStore } from '../src/stores/auth.store'
import { syncService } from '../src/sync/sync.service'

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate)
  const token = useAuthStore((s) => s.token)
  const tenantId = useAuthStore((s) => s.tenantId)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && token) {
        void syncService.syncWhenOnline(token, tenantId)
      }
    })
    return () => unsub()
  }, [token, tenantId])

  return <Stack screenOptions={{ headerShown: false }} />
}
