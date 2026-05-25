import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { syncService } from '../../src/sync/sync.service'
import { C } from '../../src/theme/colors'

export default function DeliveryProfileTab() {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const tenantId = useAuthStore((s) => s.tenantId)
  const logout = useAuthStore((s) => s.logout)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.meta}>Delivery driver</Text>
      <Text style={styles.meta}>{token ? 'Session active' : 'Not signed in'}</Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => {
          void syncService.syncWhenOnline(token, tenantId)
        }}
      >
        <Text style={styles.btnText}>Flush sync queue</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, styles.outline]}
        onPress={async () => {
          await logout()
          router.replace('/(auth)/login')
        }}
      >
        <Text style={[styles.btnText, { color: C.text }]}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { color: C.white, fontSize: 22, fontWeight: '700' },
  meta: { color: C.text2, marginTop: 8 },
  btn: { marginTop: 24, backgroundColor: C.primary, padding: 14, borderRadius: 10, alignItems: 'center' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '700' },
})
