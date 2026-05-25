import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { crmClient, type LeadDto } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { NewLeadSheet } from '../../src/components/NewLeadSheet'
import { C } from '../../src/theme/colors'

const CHIPS = ['ALL', 'OPEN', 'NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
type Chip = (typeof CHIPS)[number]

function matchesChip(lead: LeadDto, chip: Chip): boolean {
  if (chip === 'ALL') return true
  if (chip === 'OPEN') return lead.status !== 'WON' && lead.status !== 'LOST'
  return lead.status === chip
}

export default function LeadsScreen() {
  const [rows, setRows] = useState<LeadDto[]>([])
  const [chip, setChip] = useState<Chip>('OPEN')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [convertLead, setConvertLead] = useState<LeadDto | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [convertBusy, setConvertBusy] = useState(false)
  const rowRefs = useRef<Map<string, Swipeable | null>>(new Map())

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await crmClient.listLeads()
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

  const filtered = useMemo(() => rows.filter((r) => matchesChip(r, chip)), [rows, chip])

  async function onConvert(l: LeadDto) {
    rowRefs.current.get(l.id)?.close()
    setConvertLead(l)
    setCustomerName(l.companyName)
  }

  async function confirmConvert() {
    if (!convertLead) return
    const name = customerName.trim()
    if (!name) {
      Alert.alert('Convert lead', 'Customer name is required')
      return
    }
    setConvertBusy(true)
    try {
      await crmClient.convertLead(convertLead.id, { customerName: name })
      setConvertLead(null)
      setCustomerName('')
      await load()
    } catch (e) {
      Alert.alert('Convert failed', apiErrorMessage(e))
    } finally {
      setConvertBusy(false)
    }
  }

  if (loading && rows.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={C.primary} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[...CHIPS]}
        keyExtractor={(c) => c}
        style={styles.chipList}
        contentContainerStyle={styles.chipListContent}
        renderItem={({ item: c }) => (
          <TouchableOpacity
            onPress={() => setChip(c)}
            style={[styles.chip, chip === c && styles.chipOn]}
          >
            <Text style={[styles.chipTxt, chip === c && styles.chipTxtOn]}>{c}</Text>
          </TouchableOpacity>
        )}
      />
      <FlatList
        data={filtered}
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
        ListEmptyComponent={
          <Text style={styles.empty}>No leads for this filter. Pull to refresh or create one.</Text>
        }
        renderItem={({ item }) => {
          const canConvert = item.status !== 'WON' && item.status !== 'LOST'
          const card = (
            <View style={styles.card}>
              <Text style={styles.company}>{item.companyName}</Text>
              {item.contactName ? <Text style={styles.meta}>{item.contactName}</Text> : null}
              {item.email ? <Text style={styles.meta}>{item.email}</Text> : null}
              <Text style={styles.badge}>{item.status}</Text>
            </View>
          )
          if (!canConvert) return card
          return (
            <Swipeable
              ref={(r) => {
                if (r) rowRefs.current.set(item.id, r)
                else rowRefs.current.delete(item.id)
              }}
              overshootRight={false}
              renderRightActions={() => (
                <TouchableOpacity style={styles.swipeConvert} onPress={() => void onConvert(item)}>
                  <Text style={styles.swipeConvertTxt}>Convert</Text>
                </TouchableOpacity>
              )}
            >
              {card}
            </Swipeable>
          )
        }}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setSheetOpen(true)} activeOpacity={0.9}>
        <Text style={styles.fabPlus}>＋</Text>
        <Text style={styles.fabLbl}>New lead</Text>
      </TouchableOpacity>

      <NewLeadSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onCreated={() => void load()} />

      <Modal visible={!!convertLead} transparent animationType="fade">
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalBg} onPress={() => !convertBusy && setConvertLead(null)} />
          <View style={styles.modalInner} pointerEvents="box-none">
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Convert to customer</Text>
              <Text style={styles.modalSub}>Creates a customer from this lead.</Text>
              <Text style={styles.label}>Customer name</Text>
              <TextInput
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Legal account name"
                placeholderTextColor={C.text3}
                style={styles.input}
                editable={!convertBusy}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.btnGhost}
                  onPress={() => setConvertLead(null)}
                  disabled={convertBusy}
                >
                  <Text style={styles.btnGhostTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={() => void confirmConvert()}
                  disabled={convertBusy}
                >
                  <Text style={styles.btnTxt}>{convertBusy ? '…' : 'Convert'}</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <Text style={styles.webHint}>
                  Web: use trackpad scroll; swipe uses pointer on supported browsers.
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  err: { color: C.danger, paddingHorizontal: 16, paddingTop: 12, fontSize: 14 },
  chipList: { maxHeight: 52, flexGrow: 0 },
  chipListContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    marginRight: 8,
  },
  chipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  chipTxt: { color: C.text2, fontSize: 12, fontWeight: '700' },
  chipTxtOn: { color: C.primary },
  listPad: { paddingBottom: 100 },
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
  company: { color: C.text, fontSize: 17, fontWeight: '700' },
  meta: { color: C.text2, marginTop: 4, fontSize: 14 },
  badge: { color: C.accent, marginTop: 8, fontSize: 12, fontWeight: '700' },
  swipeConvert: {
    backgroundColor: C.success,
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
    marginRight: 16,
    borderRadius: 12,
  },
  swipeConvertTxt: { color: C.white, fontWeight: '800', fontSize: 14 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: C.primary,
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPlus: { color: C.white, fontSize: 22, fontWeight: '300' },
  fabLbl: { color: C.white, fontWeight: '800', fontSize: 15 },
  modalWrap: { flex: 1 },
  modalBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalInner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBox: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: C.text2, fontSize: 13, marginTop: 6, marginBottom: 12 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    color: C.text,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btnGhost: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostTxt: { color: C.text, fontWeight: '700' },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTxt: { color: C.white, fontWeight: '800' },
  webHint: { color: C.text3, fontSize: 11, marginTop: 12 },
})
