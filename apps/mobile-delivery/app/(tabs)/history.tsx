import { View, Text, FlatList, StyleSheet } from 'react-native'
import { useRouteStore } from '../../src/stores/route.store'
import { C } from '../../src/theme/colors'

export default function HistoryTab() {
  const stops = useRouteStore((s) => s.stops)
  const done = stops.filter((s) => s.status === 'DELIVERED' || s.status === 'FAILED')

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Today</Text>
      <FlatList
        data={done}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No completed stops yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.customerName}</Text>
            <Text style={styles.meta}>
              {item.status === 'DELIVERED' ? '✓ Delivered' : '✗ Failed'} · Order {item.orderId}
            </Text>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 16 },
  title: { color: C.white, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  name: { color: C.text, fontWeight: '600' },
  meta: { color: C.text2, fontSize: 13, marginTop: 4 },
  empty: { color: C.text3, textAlign: 'center', marginTop: 40 },
})
