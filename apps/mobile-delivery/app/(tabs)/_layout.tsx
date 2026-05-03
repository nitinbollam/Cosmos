import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0A0A0F' },
        headerTintColor: '#E2E8F0',
        tabBarStyle: { backgroundColor: '#0A0A0F', borderTopColor: '#1E1E3A' },
        tabBarActiveTintColor: '#6366F1',
      }}
    >
      <Tabs.Screen name="route" options={{ title: 'Route' }} />
    </Tabs>
  )
}
