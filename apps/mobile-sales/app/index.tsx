import { Redirect } from 'expo-router'
import { useAuthStore, type AuthState } from '../src/stores/auth.store'

export default function Index() {
  const authed = useAuthStore((s: AuthState) => s.isAuthenticated)
  if (authed) return <Redirect href="/(tabs)" />
  return <Redirect href="/(auth)/login" />
}
