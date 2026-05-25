import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import NetInfo from '@react-native-community/netinfo'
import { database } from '../../src/db/watermelon'
import { OfflineQueue } from '../../src/db/models/OfflineQueue'
import { syncService } from '../../src/sync/sync.service'
import { useAuthStore } from '../../src/stores/auth.store'
import { C } from '../../src/theme/colors'

export default function ProfileTab() {
  const router = useRouter()
  const { userId, logout } = useAuthStore((s) => ({ userId: s.userId, logout: s.logout }))
  const [queued, setQueued] = useState(0)
  const [online, setOnline] = useState(true)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const refreshQueue = useCallback(async () => {
    const q = database.get<OfflineQueue>('offline_queue')
    const pending = await q.query().fetch()
    setQueued(pending.filter((p) => p.status === 'pending').length)
  }, [])

  useEffect(() => {
    void refreshQueue()
    const unsub = NetInfo.addEventListener((s) => setOnline(!!s.isConnected))
    return () => {
      unsub()
    }
  }, [refreshQueue])

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20 }}>
      {!online ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Offline — actions will queue</Text>
        </View>
      ) : null}
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.meta}>User: {userId ?? '—'}</Text>
      <Text style={styles.meta}>Warehouse operator</Text>

      <Text style={styles.label}>Pending sync actions</Text>
      <Text style={styles.value}>{queued}</Text>

      {syncMsg ? <Text style={styles.syncMsg}>{syncMsg}</Text> : null}

      <TouchableOpacity
        style={styles.btn}
        onPress={async () => {
          setSyncMsg(null)
          try {
            await syncService.syncWhenOnline()
            await refreshQueue()
            setSyncMsg('Sync complete')
          } catch (e) {
            setSyncMsg((e as Error).message)
          }
        }}
      >
        <Text style={styles.btnText}>Sync now</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnOutline]}
        onPress={async () => {
          await logout()
          await SecureStore.deleteItemAsync('cosmos.accessToken')
          router.replace('/(auth)/login')
        }}
      >
        <Text style={[styles.btnText, { color: C.text }]}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { color: C.white, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  meta: { color: C.text2, fontSize: 14, marginBottom: 4 },
  label: { color: C.text3, fontSize: 12, marginTop: 20, textTransform: 'uppercase' },
  value: { color: C.accent, fontSize: 20, fontWeight: '600', fontFamily: 'monospace' },
  syncMsg: { color: C.text2, marginTop: 12, fontSize: 13 },
  btn: { marginTop: 20, backgroundColor: C.primary, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  banner: { backgroundColor: C.warning + '33', padding: 10, borderRadius: 8, marginBottom: 12 },
  bannerText: { color: C.warning, fontSize: 13 },
})
