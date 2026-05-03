import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { wmsClient } from '../../src/api/wms.client'

export default function NewReceivingSessionScreen() {
  const router = useRouter()
  const { token, tenantId } = useAuthStore()
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    wmsClient
      .getWarehouses(token, tenantId)
      .then(setWarehouses)
      .catch(() => Alert.alert('Error', 'Could not load warehouses'))
  }, [token, tenantId])

  const startSession = async () => {
    if (!selectedWarehouse) {
      Alert.alert('Select a warehouse')
      return
    }
    setLoading(true)
    try {
      const session = await wmsClient.startReceivingSession(token, tenantId, {
        warehouseId: selectedWarehouse,
        poId: poNumber.trim() || undefined,
      })
      router.replace(`/receiving/${session.id}`)
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message)
          : undefined
      Alert.alert('Error', msg ?? 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Start Receiving Session</Text>
      <Text style={s.label}>Warehouse</Text>
      <View style={s.pickerRow}>
        {warehouses.map((w) => (
          <TouchableOpacity
            key={w.id}
            style={[s.whBtn, selectedWarehouse === w.id && s.whBtnSelected]}
            onPress={() => setSelectedWarehouse(w.id)}
          >
            <Text style={[s.whBtnText, selectedWarehouse === w.id && s.whBtnTextSelected]}>{w.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.label}>PO Number (optional)</Text>
      <TextInput
        style={s.input}
        value={poNumber}
        onChangeText={setPoNumber}
        placeholder="e.g. PO-000042"
        placeholderTextColor="#64748B"
        autoCapitalize="characters"
      />
      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={startSession} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Start Session</Text>}
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20 },
  title: { color: '#E2E8F0', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  label: { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  whBtn: {
    backgroundColor: '#14141F',
    borderColor: '#1E1E3A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  whBtnSelected: { borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.15)' },
  whBtnText: { color: '#94A3B8', fontWeight: '600' },
  whBtnTextSelected: { color: '#E2E8F0' },
  input: {
    backgroundColor: '#14141F',
    borderColor: '#1E1E3A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: '#E2E8F0',
  },
  btn: { backgroundColor: '#6366F1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 32 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
