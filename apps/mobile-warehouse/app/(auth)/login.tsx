import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { wmsClient } from '../../src/api/wms.client'
import { useAuthStore } from '../../src/stores/auth.store'

export default function Login() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuthenticated)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      await wmsClient.login(email, password)
      setAuth(true)
      router.replace('/(tabs)/dashboard')
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Cosmos WMS</Text>
      <TextInput
        style={s.input}
        placeholder="email"
        placeholderTextColor="#64748B"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={s.input}
        placeholder="password"
        placeholderTextColor="#64748B"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
        <Text style={s.btnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20, justifyContent: 'center' },
  title: { color: '#E2E8F0', fontSize: 28, fontWeight: '700', marginBottom: 24 },
  input: {
    backgroundColor: '#14141F', borderColor: '#1E1E3A', borderWidth: 1, borderRadius: 8,
    color: '#E2E8F0', paddingHorizontal: 12, height: 44, marginBottom: 12,
  },
  btn: { backgroundColor: '#6366F1', height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
})
