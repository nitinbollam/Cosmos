import React, { useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTaskStore } from '../../src/stores/task.store'
import { syncService } from '../../src/sync/sync.service'
import NetInfo from '@react-native-community/netinfo'

export default function TasksScreen() {
  const router = useRouter()
  const { tasks, loadTasks, isLoading } = useTaskStore()
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false)
      if (state.isConnected) syncService.syncWhenOnline()
    })
    loadTasks()
    return () => unsub()
  }, [loadTasks])

  return (
    <View style={s.container}>
      {!isOnline && (
        <View style={s.offlineBanner}>
          <Text style={s.offlineText}>Offline — Changes sync on reconnect</Text>
        </View>
      )}
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadTasks} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => router.push(`/task/${item.id}`)}>
            <View style={s.header}>
              <Text style={s.orderNum}>Order #{item.orderId.slice(-8).toUpperCase()}</Text>
              <View style={[s.badge, { backgroundColor: item.status === 'PENDING' ? '#6366F1' : '#22C55E' }]}>
                <Text style={s.badgeText}>{item.status}</Text>
              </View>
            </View>
            <Text style={s.sub}>{(item.pickItems?.length ?? 0)} items · {item.priority} priority</Text>
            <Text style={s.sub2}>{item.warehouseCode}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>No pending tasks</Text>
          </View>
        }
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  offlineBanner: { backgroundColor: '#F59E0B', padding: 8, alignItems: 'center' },
  offlineText: { color: '#000', fontWeight: '600', fontSize: 12 },
  card: {
    backgroundColor: '#14141F', margin: 8, padding: 16,
    borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#6366F1',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  orderNum: { color: '#E2E8F0', fontSize: 16, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  sub: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  sub2: { color: '#64748B', fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { color: '#475569', fontSize: 16 },
})
