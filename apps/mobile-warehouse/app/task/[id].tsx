import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { BarCodeScanner } from 'expo-barcode-scanner'
import { wmsClient } from '../../src/api/wms.client'
import { syncService } from '../../src/sync/sync.service'

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [task, setTask] = useState<Awaited<ReturnType<typeof wmsClient.getTask>> | null>(null)
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [scanning, setScanning] = useState(false)
  const load = useCallback(async () => {
    if (!id) return
    const t = await wmsClient.getTask(String(id)).catch(() => null)
    if (t) {
      setTask(t)
      setPicked(Object.fromEntries(t.pickItems.map((p) => [p.id, p.pickedQty])))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    void BarCodeScanner.requestPermissionsAsync()
  }, [])

  const saveLine = async (lineId: string, skuId: string, qty: number) => {
    if (!task) return
    const payload = { taskId: task.id, lineId, skuId, pickedQty: qty }
    try {
      await wmsClient.replayAction('pick_progress', payload)
    } catch {
      await syncService.queueAction('pick_progress', payload as Record<string, unknown>)
    }
    setPicked((p) => ({ ...p, [lineId]: qty }))
  }

  const onBarcode = async ({ data }: { data: string }) => {
    setScanning(false)
    if (!task) return
    const line =
      task.pickItems.find((l) => l.skuId === data) ??
      task.pickItems.find(() => task.pickItems.length === 1)
    if (!line) {
      Alert.alert('No match', `Scanned ${data}`)
      return
    }
    const next = Math.min(line.quantity, (picked[line.id] ?? 0) + 1)
    await saveLine(line.id, line.skuId, next)
    Alert.alert('Pick', `${line.skuId} → ${next}/${line.quantity}`)
  }

  if (!task) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Task {String(id ?? '')}</Text>
        <Text style={s.sub}>Unable to load task (offline or unauthorized). Retry when online.</Text>
        <TouchableOpacity style={s.btn} onPress={() => load()}>
          <Text style={s.btnTxt}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Order {task.orderId.slice(-10)}…</Text>
      <Text style={s.meta}>
        Status {task.status} · Warehouse {task.warehouseId.slice(-8)} · {task.pickItems.length} lines
      </Text>

      <TouchableOpacity style={s.scanToggle} onPress={() => setScanning((x) => !x)}>
        <Text style={s.btnTxt}>{scanning ? 'Hide scanner' : 'Scan SKU barcode'}</Text>
      </TouchableOpacity>

      {scanning && (
        <View style={s.scanBox}>
          <BarCodeScanner onBarCodeScanned={onBarcode} style={{ height: 220, width: '100%' }} />
        </View>
      )}

      {task.pickItems.map((line) => {
        const qty = picked[line.id] ?? line.pickedQty
        return (
          <View key={line.id} style={s.row}>
            <Text style={s.sku}>{line.skuId}</Text>
            <TextInput
              style={s.input}
              keyboardType="number-pad"
              value={`${qty}`}
              onChangeText={(txt) =>
                setPicked((prev) => ({ ...prev, [line.id]: Number(txt.replace(/[^0-9]/g, '')) || 0 }))
              }
              onBlur={() => saveLine(line.id, line.skuId, picked[line.id] ?? 0)}
            />
            <Text style={s.qty}>{line.quantity} goal</Text>
          </View>
        )
      })}
      <TouchableOpacity style={s.btnGhost} onPress={() => syncService.syncWhenOnline()}>
        <Text style={s.ghostTxt}>Flush offline picks</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 16 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700' },
  meta: { color: '#94A3B8', marginTop: 8, marginBottom: 12 },
  sub: { color: '#64748B', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E3A',
  },
  sku: { color: '#E2E8F0', fontFamily: 'monospace', flex: 1 },
  input: {
    backgroundColor: '#16162A',
    color: '#E2E8F0',
    width: 64,
    textAlign: 'center',
    borderRadius: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2D2D4D',
  },
  qty: { color: '#94A3B8', width: 72, textAlign: 'right' },
  btn: {
    marginTop: 16,
    backgroundColor: '#4F46E5',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnGhost: {
    marginTop: 24,
    borderColor: '#3F3F5F',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  scanToggle: {
    marginBottom: 8,
    backgroundColor: '#1E293B',
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanBox: { marginBottom: 12, overflow: 'hidden', borderRadius: 12 },
  btnTxt: { color: '#FFF', fontWeight: '700' },
  ghostTxt: { color: '#94A3B8', fontWeight: '600' },
})
