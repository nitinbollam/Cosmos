import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { crmClient } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { C } from '../../src/theme/colors'

export default function HomeScreen() {
  const router = useRouter()
  const [openLeads, setOpenLeads] = useState(0)
  const [customerCount, setCustomerCount] = useState(0)
  const [todayActs, setTodayActs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [leads, customers, activities] = await Promise.all([
        crmClient.listLeads(),
        crmClient.listCustomers(),
        crmClient.listActivities(),
      ])
      const open = leads.filter((l) => l.status !== 'WON' && l.status !== 'LOST').length
      setOpenLeads(open)
      setCustomerCount(customers.length)
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setHours(23, 59, 59, 999)
      const t = activities.filter((a) => {
        const t0 = new Date(a.occurredAt).getTime()
        return t0 >= start.getTime() && t0 <= end.getTime()
      }).length
      setTodayActs(t)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load()
    }, [load]),
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
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
    >
      <Text style={styles.h1}>Sales desk</Text>
      <Text style={styles.sub}>Quick stats and shortcuts for field reps.</Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{openLeads}</Text>
          <Text style={styles.statLbl}>Open leads</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{customerCount}</Text>
          <Text style={styles.statLbl}>Customers</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statVal}>{todayActs}</Text>
          <Text style={styles.statLbl}>Today&apos;s activities</Text>
        </View>
      </View>

      <Text style={styles.section}>Quick actions</Text>
      <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/leads')}>
        <Text style={styles.actionTitle}>Pipeline</Text>
        <Text style={styles.actionSub}>Review and convert leads</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => router.push('/new-order')}>
        <Text style={styles.actionTitle}>New order</Text>
        <Text style={styles.actionSub}>Create a B2B / rep order</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/customers')}>
        <Text style={styles.actionTitle}>Customers</Text>
        <Text style={styles.actionSub}>Accounts and credit</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => router.push('/(tabs)/activities')}>
        <Text style={styles.actionTitle}>Today&apos;s log</Text>
        <Text style={styles.actionSub}>Activities by account</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  h1: { color: C.text, fontSize: 26, fontWeight: '800' },
  sub: { color: C.text2, marginTop: 6, fontSize: 14, marginBottom: 20 },
  err: { color: C.danger, marginBottom: 12, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  statVal: { color: C.accent, fontSize: 22, fontWeight: '800' },
  statLbl: { color: C.text2, fontSize: 11, marginTop: 4, fontWeight: '600' },
  section: { color: C.text2, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  action: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  actionSub: { color: C.text2, fontSize: 13, marginTop: 4 },
})
