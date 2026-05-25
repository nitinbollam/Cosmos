import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { crmClient } from '../../src/api/crm.client'
import { apiErrorMessage } from '../../src/api/apiError'
import { useAuthStore, type AuthState } from '../../src/stores/auth.store'
import { C } from '../../src/theme/colors'

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
      router.replace('/(tabs)')
    } catch (e) {
      Alert.alert('Sign in failed', apiErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Cosmos Sales</Text>
      <Text style={s.sub}>Field rep sign-in via gateway `_proxy` (CRM, inventory, orders).</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        style={s.input}
        placeholder="email"
        placeholderTextColor={C.text3}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="password"
        placeholderTextColor={C.text3}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={s.btn} onPress={() => void submit()} disabled={loading}>
        <Text style={s.bt}>{loading ? 'Signing in…' : 'Continue'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 22, justifyContent: 'center' },
  title: { color: C.text, fontSize: 28, fontWeight: '800', marginBottom: 8 },
  sub: { color: C.text2, marginBottom: 28, fontSize: 14 },
  input: {
    backgroundColor: C.surface2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
    fontSize: 16,
  },
  btn: {
    marginTop: 8,
    backgroundColor: C.primary,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bt: { color: C.white, fontSize: 16, fontWeight: '800' },
})
