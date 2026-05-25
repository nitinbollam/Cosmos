import { useCallback, useLayoutEffect, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { orderClient, type OrderSummaryDto } from '../../src/api/order.client'
import { crmClient, type ActivityDto, type CustomerDto } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { LogActivitySheet } from '../../src/components/LogActivitySheet'
import { C } from '../../src/theme/colors'

function dec(n: string | number | null | undefined): number {
  if (n == null) return 0
  if (typeof n === 'number') return n
  const x = parseFloat(n)
  return Number.isFinite(x) ? x : 0
}

function barColor(pct: number): string {
  if (pct >= 95) return C.danger
  if (pct >= 75) return C.warning
  return C.primary
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const navigation = useNavigation()
  const router = useRouter()
  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [orders, setOrders] = useState<OrderSummaryDto[]>([])
  const [activities, setActivities] = useState<ActivityDto[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return
    setErr(null)
    try {
      const [c, ord, act] = await Promise.all([
        crmClient.getCustomer(id),
        orderClient.listForCustomer(id, 8),
        crmClient.listActivities({ customerId: id }),
      ])
      setCustomer(c)
      setOrders(ord.items)
      setActivities(act)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useLayoutEffect(() => {
    void load()
  }, [load])

  useLayoutEffect(() => {
    if (customer?.name) {
      navigation.setOptions({ title: customer.name })
    }
  }, [customer?.name, navigation])

  const limit = dec(customer?.creditLimit)
  const used = dec(customer?.creditUsed)
  const avail = Math.max(0, limit - used)
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0

  if (loading && !customer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  if (err && !customer) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{err}</Text>
      </View>
    )
  }

  if (!customer) return null

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTintColor: C.text,
          headerStyle: { backgroundColor: C.surface },
        }}
      />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scrollContent}
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
        {err ? <Text style={styles.banner}>{err}</Text> : null}
        <Text style={styles.addr}>
          {[customer.primaryAddressLine1, customer.primaryCity, customer.primaryState, customer.primaryZip]
            .filter(Boolean)
            .join(', ') || '—'}
        </Text>

        <Text style={styles.h2}>Credit</Text>
        <View style={styles.creditCard}>
          <View style={styles.creditBarBg}>
            <View
              style={[
                styles.creditBarFill,
                { width: `${pct}%`, backgroundColor: barColor(pct) },
              ]}
            />
          </View>
          <View style={styles.creditRow}>
            <Text style={styles.creditLbl}>Used</Text>
            <Text style={styles.creditVal}>
              {used.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
            </Text>
          </View>
          <View style={styles.creditRow}>
            <Text style={styles.creditLbl}>Limit</Text>
            <Text style={styles.creditVal}>
              {limit > 0
                ? limit.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
                : '—'}
            </Text>
          </View>
          <View style={styles.creditRow}>
            <Text style={styles.creditLbl}>Available</Text>
            <Text style={[styles.creditVal, { color: C.accent }]}>
              {limit > 0
                ? avail.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
                : '—'}
            </Text>
          </View>
          <Text style={styles.terms}>Payment terms: {customer.paymentTermsDays ?? 0} days</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push(`/new-order?customerId=${encodeURIComponent(customer.id)}`)}
        >
          <Text style={styles.primaryBtnTxt}>New order</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setLogOpen(true)}>
          <Text style={styles.secondaryBtnTxt}>Log activity</Text>
        </TouchableOpacity>

        <Text style={styles.h2}>Recent orders</Text>
        {orders.length === 0 ? (
          <Text style={styles.muted}>No orders yet.</Text>
        ) : (
          orders.map((o) => (
            <View key={o.id} style={styles.orderRow}>
              <Text style={styles.orderId} numberOfLines={1}>
                {o.id}
              </Text>
              <Text style={styles.orderMeta}>{o.status}</Text>
              <Text style={styles.orderAmt}>
                {dec(o.totalAmount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.h2}>Activity timeline</Text>
        {activities.length === 0 ? (
          <Text style={styles.muted}>No activities.</Text>
        ) : (
          activities.map((a) => (
            <View key={a.id} style={styles.actRow}>
              <Text style={styles.actType}>{a.type}</Text>
              {a.subject ? <Text style={styles.actSubj}>{a.subject}</Text> : null}
              {a.outcome ? <Text style={styles.actOut}>{a.outcome}</Text> : null}
              <Text style={styles.actTime}>{new Date(a.occurredAt).toLocaleString()}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <LogActivitySheet
        visible={logOpen}
        onClose={() => setLogOpen(false)}
        onSaved={() => void load()}
        customers={[customer]}
        initialCustomerId={customer.id}
        requireCustomer={false}
      />
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  err: { color: C.danger, padding: 16 },
  banner: { color: C.warning, padding: 12, backgroundColor: C.surface2, fontSize: 13 },
  addr: { color: C.text2, paddingHorizontal: 16, paddingTop: 12, fontSize: 14 },
  h2: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  creditCard: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  creditBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: C.surface3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  creditBarFill: {
    height: 8,
    borderRadius: 4,
    maxWidth: '100%',
  },
  creditRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  creditLbl: { color: C.text2, fontSize: 13 },
  creditVal: { color: C.text, fontSize: 13, fontWeight: '600' },
  terms: { color: C.text3, fontSize: 12, marginTop: 8 },
  primaryBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: C.primary,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { color: C.white, fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.border,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface2,
  },
  secondaryBtnTxt: { color: C.text, fontWeight: '700' },
  muted: { color: C.text3, paddingHorizontal: 16, marginBottom: 8 },
  orderRow: {
    marginHorizontal: 16,
    padding: 12,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  orderId: { color: C.text2, fontSize: 11 },
  orderMeta: { color: C.accent, fontSize: 13, fontWeight: '700', marginTop: 4 },
  orderAmt: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  actRow: {
    marginHorizontal: 16,
    padding: 12,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  actType: { color: C.accent, fontWeight: '800', fontSize: 12 },
  actSubj: { color: C.text, marginTop: 4, fontWeight: '600' },
  actOut: { color: C.text2, marginTop: 4, fontSize: 13 },
  actTime: { color: C.text3, fontSize: 11, marginTop: 6 },
})
