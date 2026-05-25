import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { crmClient, type CustomerDto } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { C } from '../../src/theme/colors'

export default function CustomersScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<CustomerDto[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await crmClient.listCustomers()
      setRows(data)
    } catch (e) {
      setErr(apiErrorMessage(e))
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
        <ActivityIndicator color={C.primary} />
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
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={<Text style={s.empty}>No customers yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => router.push(`/customers/${item.id}`)}>
            <Text style={s.name}>{item.name}</Text>
            {item.email ? <Text style={s.meta}>{item.email}</Text> : null}
            {item.phone ? <Text style={s.meta}>{item.phone}</Text> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  err: { color: C.danger, padding: 16, fontSize: 14 },
  empty: { color: C.text3, padding: 24, textAlign: 'center' },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  name: { color: C.text, fontSize: 17, fontWeight: '700' },
  meta: { color: C.text2, marginTop: 4, fontSize: 14 },
})
