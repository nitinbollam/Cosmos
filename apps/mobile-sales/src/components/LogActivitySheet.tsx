import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import type { ActivityType, CustomerDto } from '../api/crm.client'
import { crmClient } from '../api/crm.client'
import { apiErrorMessage } from '../api/apiError'
import { C } from '../theme/colors'

const TYPES: ActivityType[] = ['CALL', 'EMAIL', 'NOTE']

export function LogActivitySheet(props: {
  visible: boolean
  onClose: () => void
  onSaved: () => void
  customers: CustomerDto[]
  initialCustomerId?: string | null
  requireCustomer?: boolean
}) {
  const [customerId, setCustomerId] = useState(props.initialCustomerId ?? '')
  const [type, setType] = useState<ActivityType>('CALL')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const effectiveCustomerId = customerId.trim() || props.initialCustomerId?.trim() || ''

  useEffect(() => {
    if (props.visible && props.initialCustomerId) setCustomerId(props.initialCustomerId)
  }, [props.visible, props.initialCustomerId])

  const closeReset = () => {
    setCustomerId(props.initialCustomerId ?? '')
    setType('CALL')
    setSubject('')
    setBody('')
    setOutcome('')
    setErr(null)
    props.onClose()
  }

  async function save() {
    setErr(null)
    if (props.requireCustomer !== false && !effectiveCustomerId) {
      setErr('Select a customer')
      return
    }
    setBusy(true)
    try {
      await crmClient.createActivity({
        type,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
        outcome: outcome.trim() || undefined,
        customerId: effectiveCustomerId || undefined,
      })
      props.onSaved()
      closeReset()
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={closeReset}>
      <Pressable style={styles.backdrop} onPress={closeReset} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Log activity</Text>
        {props.requireCustomer !== false && (
          <>
            <Text style={styles.label}>Customer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {props.customers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setCustomerId(c.id)}
                  style={[styles.chip, customerId === c.id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, customerId === c.id && styles.chipTextOn]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
        <Text style={styles.label}>Type</Text>
        <View style={styles.row}>
          {TYPES.map((t) => (
            <TouchableOpacity key={t} onPress={() => setType(t)} style={[styles.typeBtn, type === t && styles.typeOn]}>
              <Text style={[styles.typeTxt, type === t && styles.typeTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Subject</Text>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="Quick subject"
          placeholderTextColor={C.text3}
          style={styles.input}
        />
        <Text style={styles.label}>Notes</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="What happened?"
          placeholderTextColor={C.text3}
          style={[styles.input, styles.ta]}
          multiline
        />
        <Text style={styles.label}>Outcome</Text>
        <TextInput
          value={outcome}
          onChangeText={setOutcome}
          placeholder="Result / next step"
          placeholderTextColor={C.text3}
          style={styles.input}
        />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnGhost} onPress={closeReset} disabled={busy}>
            <Text style={styles.btnGhostTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => void save()} disabled={busy}>
            {busy ? <ActivityIndicator color={C.white} /> : <Text style={styles.btnTxt}>Save</Text>}
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
    maxHeight: '88%',
  },
  title: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  chipScroll: { maxHeight: 44, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    marginRight: 8,
  },
  chipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  chipText: { color: C.text2, fontSize: 13, maxWidth: 140 },
  chipTextOn: { color: C.text, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  typeOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  typeTxt: { color: C.text2, fontSize: 12, fontWeight: '600' },
  typeTxtOn: { color: C.primary },
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
  ta: { minHeight: 72, textAlignVertical: 'top' },
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
