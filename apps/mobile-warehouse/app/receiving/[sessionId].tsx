import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import NetInfo from '@react-native-community/netinfo'
import { useAuthStore } from '../../src/stores/auth.store'
import { wmsClient } from '../../src/api/wms.client'
import { syncService } from '../../src/sync/sync.service'

type ScannedItem = {
  id: string
  skuId: string
  skuName: string
  barcode?: string
  receivedQty: number
  damagedQty: number
  locationId?: string
  batchId?: string
}

function promptQty(
  title: string,
  defaultVal: string,
  kind: 'int' | 'plain',
  onValue: (v: string) => void,
) {
  const ap = (Alert as unknown as { prompt?: (...a: unknown[]) => void }).prompt
  if (typeof ap === 'function') {
    ap(
      title,
      '',
      (v: string) => onValue(v),
      'plain-text',
      defaultVal,
      kind === 'int' ? 'numeric' : 'default',
    )
    return
  }
  onValue(defaultVal)
}

export default function ReceivingSessionScreen() {
  const { sessionId: sessionIdParam } = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam?.[0] ?? ''
  const { token, tenantId, userId } = useAuthStore()
  const router = useRouter()
  const [session, setSession] = useState<{
    poId?: string | null
    items?: ScannedItem[]
  } | null>(null)
  const [items, setItems] = useState<ScannedItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  const loadSession = useCallback(async () => {
    if (!sessionId) return
    try {
      const data = (await wmsClient.getReceivingSession(token, tenantId, sessionId)) as {
        poId?: string | null
        items?: ScannedItem[]
      }
      setSession(data)
      setItems((data.items ?? []) as ScannedItem[])
    } catch {
      Alert.alert('Error', 'Could not load session')
    }
  }, [sessionId, token, tenantId])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setIsOnline(s.isConnected ?? false))
    void loadSession()
    return () => unsub()
  }, [loadSession])

  const handleBarcodeScan = useCallback(
    async ({ data: barcode }: { data: string }) => {
      setScanning(false)
      Alert.alert('Scanned: ' + barcode, 'Enter quantities', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: () => {
            promptQty('Received Qty', '1', 'int', (qtyStr) => {
              const qty = parseInt(qtyStr ?? '0', 10)
              if (Number.isNaN(qty) || qty < 0) return
              promptQty('Damaged Qty', '0', 'int', async (dmgStr) => {
                const dmg = parseInt(dmgStr ?? '0', 10)
                const uid = userId ?? ''
                const scanPayload = {
                  sessionId,
                  userId: uid,
                  barcode,
                  receivedQty: qty,
                  damagedQty: Number.isNaN(dmg) ? 0 : dmg,
                }
                if (isOnline) {
                  try {
                    await wmsClient.scanReceivingItem(token, tenantId, sessionId, {
                      barcode,
                      receivedQty: qty,
                      damagedQty: Number.isNaN(dmg) ? 0 : dmg,
                    })
                    await loadSession()
                  } catch (e: unknown) {
                    const msg =
                      e && typeof e === 'object' && 'response' in e
                        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message)
                        : 'Scan failed — saved offline'
                    Alert.alert('Offline', msg)
                    await syncService.queueAction('receiving_scan', scanPayload)
                  }
                } else {
                  await syncService.queueAction('receiving_scan', scanPayload)
                  Alert.alert('Queued', 'Scan saved — will sync on reconnect')
                }
              })
            })
          },
        },
      ])
    },
    [sessionId, isOnline, token, tenantId, userId, loadSession],
  )

  const handleComplete = async () => {
    if (items.length === 0) {
      Alert.alert('No items scanned yet')
      return
    }
    const finish = (notes: string) => {
      setCompleting(true)
      wmsClient
        .completeReceivingSession(token, tenantId, sessionId, notes)
        .then(() => {
          Alert.alert('Session completed', undefined, [{ text: 'OK', onPress: () => router.back() }])
        })
        .catch((e: unknown) => {
          const msg =
            e && typeof e === 'object' && 'response' in e
              ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message)
              : 'Failed to complete session'
          Alert.alert('Error', msg)
        })
        .finally(() => setCompleting(false))
    }
    if (Platform.OS === 'ios') {
      const ap = (Alert as unknown as { prompt?: (...a: unknown[]) => void }).prompt
      ap?.('Notes (optional)', 'Any discrepancy notes?', (notes: string) => finish(notes ?? ''), 'plain-text')
    } else {
      finish('')
    }
  }

  if (scanning) {
    if (!permission?.granted) {
      void requestPermission()
      return null
    }
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          onBarcodeScanned={handleBarcodeScan}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'qr'] }}
        />
        <TouchableOpacity style={s.cancelScan} onPress={() => setScanning(false)}>
          <Text style={s.cancelScanText}>✕ Cancel</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={s.container}>
      {!isOnline && (
        <View style={s.banner}>
          <Text style={s.bannerText}>📡 Offline — scans queued</Text>
        </View>
      )}
      <View style={s.header}>
        <Text style={s.title}>Session {sessionId.slice(-8).toUpperCase()}</Text>
        {session?.poId ? <Text style={s.sub}>PO: {session.poId}</Text> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={s.itemCard}>
            <Text style={s.itemName}>{item.skuName ?? item.skuId}</Text>
            <Text style={s.itemQty}>
              Received: {item.receivedQty}{' '}
              {item.damagedQty > 0 ? `• Damaged: ${item.damagedQty}` : ''}
            </Text>
            {item.batchId ? <Text style={s.itemSub}>Batch: {item.batchId}</Text> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No items scanned yet</Text>}
        contentContainerStyle={{ paddingBottom: 120 }}
      />
      <View style={s.footer}>
        <TouchableOpacity style={s.scanBtn} onPress={() => setScanning(true)}>
          <Text style={s.scanBtnText}>📷 Scan Item</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.completeBtn, completing && s.disabled]}
          onPress={() => void handleComplete()}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.completeBtnText}>Complete Session</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  banner: { backgroundColor: '#F59E0B', padding: 8, alignItems: 'center' },
  bannerText: { color: '#000', fontWeight: '600', fontSize: 12 },
  header: { padding: 16 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700' },
  sub: { color: '#64748B', fontSize: 13 },
  itemCard: {
    backgroundColor: '#14141F',
    margin: 8,
    padding: 14,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#22D3EE',
  },
  itemName: { color: '#E2E8F0', fontSize: 15, fontWeight: '600' },
  itemQty: { color: '#94A3B8', fontSize: 13, marginTop: 4 },
  itemSub: { color: '#64748B', fontSize: 12 },
  empty: { color: '#475569', textAlign: 'center', marginTop: 60, fontSize: 15 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 10,
    backgroundColor: '#0A0A0F',
  },
  scanBtn: { backgroundColor: '#1E1E3A', borderRadius: 12, padding: 14, alignItems: 'center' },
  scanBtnText: { color: '#E2E8F0', fontSize: 16, fontWeight: '600' },
  completeBtn: { backgroundColor: '#6366F1', borderRadius: 12, padding: 16, alignItems: 'center' },
  completeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  cancelScan: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 16,
    alignItems: 'center',
  },
  cancelScanText: { color: '#fff', fontSize: 16 },
})
