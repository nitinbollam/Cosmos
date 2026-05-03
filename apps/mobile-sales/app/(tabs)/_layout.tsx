import { Tabs, useRouter } from 'expo-router'
import { Text, TouchableOpacity } from 'react-native'
import { useAuthStore, type AuthState } from '../../src/stores/auth.store'

export default function TabsLayout() {
  const router = useRouter()
  const logout = useAuthStore((s: AuthState) => s.logout)
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0A0A0F' },
        headerTintColor: '#E2E8F0',
        tabBarStyle: { backgroundColor: '#0A0A0F', borderTopColor: '#1E1E3A' },
        tabBarActiveTintColor: '#6366F1',
        headerRight: () => (
          <TouchableOpacity
            onPress={() => {
              void logout().then(() => router.replace('/(auth)/login'))
            }}
            style={{ marginRight: 12 }}
          >
            <Text style={{ color: '#94A3B8', fontSize: 14 }}>Sign out</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen name="leads" options={{ title: 'Leads' }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers' }} />
      <Tabs.Screen name="new-lead" options={{ title: 'New lead' }} />
    </Tabs>
  )
}
