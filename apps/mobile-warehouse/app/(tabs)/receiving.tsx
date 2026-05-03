import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'

export default function Receiving() {
  const router = useRouter()
  return (
    <View style={s.container}>
      <Text style={s.title}>Receiving</Text>
      <Text style={s.sub}>Start a session to scan inbound inventory against a PO.</Text>
      <TouchableOpacity style={s.btn} onPress={() => router.push('/receiving/new')}>
        <Text style={s.btnText}>Start receiving session</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700' },
  sub: { color: '#94A3B8', fontSize: 14, marginTop: 8 },
  btn: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
