import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { crmClient, type LeadDto } from '../../src/api/crm.client'

export default function LeadsScreen() {
  const [rows, setRows] = useState<LeadDto[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await crmClient.listLeads()
      setRows(data)
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load leads')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && rows.length === 0) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color="#6366F1" />
      </View>
    )
  }

  return (
    <View style={s.container}>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load()
            }}
            tintColor="#6366F1"
          />
        }
        ListEmptyComponent={<Text style={s.empty}>No leads yet. Add one from the New lead tab.</Text>}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text style={s.company}>{item.companyName}</Text>
            {item.email ? <Text style={s.meta}>{item.email}</Text> : null}
            <Text style={s.badge}>{item.status}</Text>
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  centered: { flex: 1, backgroundColor: '#0A0A0F', alignItems: 'center', justifyContent: 'center' },
  err: { color: '#F87171', padding: 16, fontSize: 14 },
  empty: { color: '#64748B', padding: 24, textAlign: 'center' },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#14141F',
    borderWidth: 1,
    borderColor: '#253041',
  },
  company: { color: '#E2E8F0', fontSize: 17, fontWeight: '700' },
  meta: { color: '#94A3B8', marginTop: 4, fontSize: 14 },
  badge: { color: '#A5B4FC', marginTop: 8, fontSize: 12, fontWeight: '600' },
})
