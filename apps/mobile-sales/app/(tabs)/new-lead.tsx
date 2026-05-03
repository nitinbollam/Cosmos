import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { crmClient } from '../../src/api/crm.client'

export default function NewLeadScreen() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    const name = companyName.trim()
    if (!name) {
      Alert.alert('Required', 'Company name is required')
      return
    }
    setLoading(true)
    try {
      await crmClient.createLead({
        companyName: name,
        email: email.trim() || undefined,
      })
      setCompanyName('')
      setEmail('')
      Alert.alert('Saved', 'Lead created', [{ text: 'OK', onPress: () => router.replace('/(tabs)/leads') }])
    } catch (e) {
      Alert.alert('Error', (e as Error).message ?? 'Could not create lead')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={s.label}>Company</Text>
      <TextInput
        style={s.input}
        placeholder="Acme Wholesale"
        placeholderTextColor="#64748B"
        value={companyName}
        onChangeText={setCompanyName}
      />
      <Text style={s.label}>Email (optional)</Text>
      <TextInput
        style={s.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="buyer@acme.com"
        placeholderTextColor="#64748B"
        value={email}
        onChangeText={setEmail}
      />
      <TouchableOpacity style={s.btn} onPress={() => void submit()} disabled={loading}>
        <Text style={s.bt}>{loading ? 'Saving…' : 'Create lead'}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', padding: 20, paddingTop: 24 },
  label: { color: '#94A3B8', marginBottom: 8, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: '#14141F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#253041',
    color: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 18,
    fontSize: 16,
  },
  btn: {
    marginTop: 12,
    backgroundColor: '#6366F1',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bt: { color: '#EEF2FF', fontSize: 16, fontWeight: '800' },
})
