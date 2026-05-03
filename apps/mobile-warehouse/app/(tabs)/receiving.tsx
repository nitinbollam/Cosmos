import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

export default function Receiving() {
  return (
    <View style={s.container}>
      <Text style={s.title}>Receiving — SCAFFOLD</Text>
      <Text style={s.sub}>Receiving session UI is not yet implemented. See MISSING.md.</Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700' },
  sub: { color: '#94A3B8', fontSize: 14, marginTop: 8 },
})
