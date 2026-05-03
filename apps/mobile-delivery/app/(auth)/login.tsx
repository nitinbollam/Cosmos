import React, { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { dispatchClient, parseAccessTokenClaims } from '../../src/api/dispatch.client'
import { useAuthStore } from '../../src/stores/auth.store'

export default function DriverLogin() {
  const router = useRouter()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setSession = useAuthStore((s) => s.setSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      const data = await dispatchClient.login(email.trim(), password)
      const claims = parseAccessTokenClaims(data.accessToken)
      setSession(data.accessToken, claims.tenantId ?? null)
      setAuthenticated(true)
      router.replace('/(tabs)/route')
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message ?? 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Cosmos Delivery</Text>
      <Text style={s.sub}>Driver authentication (gateway `_proxy`).</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        style={s.input}
        placeholder="email"
        placeholderTextColor="#64748B"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="password"
        placeholderTextColor="#64748B"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={s.btn} onPress={() => submit()} disabled={loading}>
        <Text style={s.bt}>{loading ? 'Signing in…' : 'Continue'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 22, justifyContent: 'center' },
  title: { color: '#E2E8F0', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  sub: { color: '#94A3B8', marginBottom: 28, fontSize: 14 },
  input: {
    backgroundColor: '#14141F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#253041',
    color: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
    fontSize: 16,
  },
  btn: {
    marginTop: 8,
    backgroundColor: '#10B981',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bt: { color: '#052E26', fontSize: 16, fontWeight: '800' },
})
