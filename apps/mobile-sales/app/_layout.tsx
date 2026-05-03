import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { useAuthStore, type AuthState } from '../src/stores/auth.store'

export default function RootLayout() {
  const hydrate = useAuthStore((s: AuthState) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return <Stack screenOptions={{ headerShown: false }} />
}
