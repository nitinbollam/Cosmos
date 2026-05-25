import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { crmClient, type ActivityDto, type CustomerDto } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { LogActivitySheet } from '../../src/components/LogActivitySheet'
import { C } from '../../src/theme/colors'

type Section = { title: string; customerId: string | null; data: ActivityDto[] }

function startEndToday() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export default function ActivitiesScreen() {
  const [sections, setSections] = useState<Section[]>([])
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [acts, custRows] = await Promise.all([crmClient.listActivities(), crmClient.listCustomers()])
      setCustomers(custRows)
      const nameById = new Map(custRows.map((c) => [c.id, c.name]))
      const { start, end } = startEndToday()
      const today = acts.filter((a) => {
        const t = new Date(a.occurredAt).getTime()
        return t >= start.getTime() && t <= end.getTime()
      })
      const byC = new Map<string | null, ActivityDto[]>()
      for (const a of today) {
        const k = a.customerId ?? null
        const arr = byC.get(k) ?? []
        arr.push(a)
        byC.set(k, arr)
      }
      const out: Section[] = []
      const keys = [...byC.keys()].sort((a, b) => {
        const na = a ? (nameById.get(a) ?? a) : ''
        const nb = b ? (nameById.get(b) ?? b) : ''
        return na.localeCompare(nb)
      })
      for (const k of keys) {
        const title = k ? (nameById.get(k) ?? k) : 'No customer'
        const data = (byC.get(k) ?? []).sort(
          (x, y) => new Date(y.occurredAt).getTime() - new Date(x.occurredAt).getTime(),
        )
        out.push({ title, customerId: k, data })
      }
      setSections(out)
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

  if (loading && sections.length === 0 && !err) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <SectionList
        sections={sections}
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
        contentContainerStyle={styles.listPad}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.type}>{item.type}</Text>
            {item.subject ? <Text style={styles.subj}>{item.subject}</Text> : null}
            {item.outcome ? <Text style={styles.out}>{item.outcome}</Text> : null}
            <Text style={styles.time}>
              {new Date(item.occurredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No activities logged today.</Text>}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setLogOpen(true)} activeOpacity={0.9}>
        <Text style={styles.fabTxt}>Log activity</Text>
      </TouchableOpacity>
      <LogActivitySheet
        visible={logOpen}
        onClose={() => setLogOpen(false)}
        onSaved={() => void load()}
        customers={customers}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  err: { color: C.danger, padding: 16, fontSize: 14 },
  listPad: { paddingBottom: 96 },
  sectionHead: {
    backgroundColor: C.surface2,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  row: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  type: { color: C.accent, fontSize: 12, fontWeight: '800' },
  subj: { color: C.text, fontSize: 15, fontWeight: '600', marginTop: 4 },
  out: { color: C.text2, fontSize: 13, marginTop: 4 },
  time: { color: C.text3, fontSize: 12, marginTop: 6 },
  empty: { color: C.text3, textAlign: 'center', padding: 32, fontSize: 14 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: C.primary,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  fabTxt: { color: C.white, fontWeight: '800', fontSize: 15 },
})
