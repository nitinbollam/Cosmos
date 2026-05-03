import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

export default function Dashboard() {
  return (
    <View style={s.container}>
      <Text style={s.title}>Today</Text>
      <Text style={s.sub}>Tap "Tasks" to start picking.</Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20 },
  title: { color: '#E2E8F0', fontSize: 24, fontWeight: '700' },
  sub: { color: '#94A3B8', fontSize: 14, marginTop: 8 },
})
