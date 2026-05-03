import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { dispatchClient } from '../../../src/api/dispatch.client'
import { useRouteStore } from '../../../src/stores/route.store'

export default function FailedDelivery() {
  const { id, routeId } = useLocalSearchParams<{ id: string; routeId: string }>()
  const router = useRouter()
  const markFailed = useRouteStore((s) => s.markFailed)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Please describe what went wrong')
      return
    }
    setSubmitting(true)
    try {
      if (!routeId) {
        Alert.alert('Missing route', 'Reload from the Route tab.')
        return
      }
      await dispatchClient.failDelivery(routeId, id!, reason)
      await markFailed(id!)
      router.back()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Reason for failed delivery</Text>
      <TextInput
        style={s.input}
        placeholder="Customer not present, refused, address wrong…"
        placeholderTextColor="#64748B"
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <TouchableOpacity style={s.btn} onPress={submit} disabled={submitting}>
        <Text style={s.btnText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700' },
  input: {
    marginTop: 12, backgroundColor: '#14141F', borderColor: '#1E1E3A', borderWidth: 1,
    borderRadius: 8, color: '#E2E8F0', padding: 12, minHeight: 100, textAlignVertical: 'top',
  },
  btn: { backgroundColor: '#DC2626', height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
})
