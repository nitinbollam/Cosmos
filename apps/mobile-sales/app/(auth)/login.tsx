import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { crmClient } from '../../src/api/crm.client'
import { useAuthStore, type AuthState } from '../../src/stores/auth.store'

export default function SalesLogin() {
  const router = useRouter()
  const setAuthenticated = useAuthStore((s: AuthState) => s.setAuthenticated)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      await crmClient.login(email.trim(), password)
      setAuthenticated(true)
      router.replace('/(tabs)/leads')
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message ?? 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Cosmos Sales</Text>
      <Text style={s.sub}>Field rep sign-in via gateway `_proxy` (CRM + orders).</Text>
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
    backgroundColor: '#6366F1',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bt: { color: '#EEF2FF', fontSize: 16, fontWeight: '800' },
})
