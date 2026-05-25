import { Tabs, useRouter } from 'expo-router'
import { Text, TouchableOpacity } from 'react-native'
import { useAuthStore, type AuthState } from '../../src/stores/auth.store'
import { C } from '../../src/theme/colors'

export default function TabsLayout() {
  const router = useRouter()
  const logout = useAuthStore((s: AuthState) => s.logout)
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.surface },
        headerTintColor: C.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border },
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.text3,
        headerRight: () => (
          <TouchableOpacity
            onPress={() => {
              void logout().then(() => router.replace('/(auth)/login'))
            }}
            style={{ marginRight: 12 }}
          >
            <Text style={{ color: C.text2, fontSize: 14 }}>Sign out</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="leads" options={{ title: 'Leads' }} />
      <Tabs.Screen name="activities" options={{ title: 'Activities' }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers' }} />
    </Tabs>
  )
}
