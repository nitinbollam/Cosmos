import 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useAuthStore, type AuthState } from '../src/stores/auth.store'

export default function RootLayout() {
  const hydrate = useAuthStore((s: AuthState) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  )
}
