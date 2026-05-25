import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { crmClient } from '../api/crm.client'
import { apiErrorMessage } from '../api/apiError'
import { C } from '../theme/colors'

export function NewLeadSheet(props: {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('FIELD_APP')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function reset() {
    setCompanyName('')
    setContactName('')
    setEmail('')
    setSource('FIELD_APP')
    setErr(null)
  }

  function close() {
    reset()
    props.onClose()
  }

  async function save() {
    setErr(null)
    if (!companyName.trim()) {
      setErr('Company name is required')
      return
    }
    setBusy(true)
    try {
      await crmClient.createLead({
        companyName: companyName.trim(),
        contactName: contactName.trim() || undefined,
        email: email.trim() || undefined,
        source: source.trim() || undefined,
      })
      reset()
      props.onCreated()
      props.onClose()
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.sheet}>
        <Text style={styles.title}>New lead</Text>
        <Text style={styles.label}>Company *</Text>
        <TextInput
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Acme Wholesale"
          placeholderTextColor={C.text3}
          style={styles.input}
        />
        <Text style={styles.label}>Contact</Text>
        <TextInput
          value={contactName}
          onChangeText={setContactName}
          placeholder="Name"
          placeholderTextColor={C.text3}
          style={styles.input}
        />
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="email"
          placeholderTextColor={C.text3}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>Source</Text>
        <TextInput
          value={source}
          onChangeText={setSource}
          placeholder="FIELD_APP"
          placeholderTextColor={C.text3}
          style={styles.input}
        />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnGhost} onPress={close} disabled={busy}>
            <Text style={styles.btnGhostTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => void save()} disabled={busy}>
            {busy ? <ActivityIndicator color={C.white} /> : <Text style={styles.btnTxt}>Create</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  title: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 15,
  },
  err: { color: C.danger, marginTop: 8, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btnGhost: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostTxt: { color: C.text, fontWeight: '700' },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTxt: { color: C.white, fontWeight: '800' },
})
