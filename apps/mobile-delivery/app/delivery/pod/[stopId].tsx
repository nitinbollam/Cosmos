import React, { useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import SignatureCanvas from 'react-native-signature-canvas'
import { CameraView, useCameraPermissions } from 'expo-camera'
import NetInfo from '@react-native-community/netinfo'
import { useAuthStore } from '../../../src/stores/auth.store'
import { dispatchClient } from '../../../src/api/dispatch.client'
import { syncService } from '../../../src/sync/sync.service'
import { useRouteStore } from '../../../src/stores/route.store'

export default function PODScreen() {
  const { stopId: stopParam, routeId: routeParam } = useLocalSearchParams<{
    stopId: string
    routeId: string
  }>()
  const stopId = typeof stopParam === 'string' ? stopParam : stopParam?.[0] ?? ''
  const routeId = typeof routeParam === 'string' ? routeParam : routeParam?.[0] ?? ''
  const router = useRouter()
  const { token, tenantId } = useAuthStore()
  const markDelivered = useRouteStore((s) => s.markDelivered)
  const [podType, setPodType] = useState<'SIGNATURE' | 'PHOTO' | null>(null)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [recipientName, setRecipientName] = useState('')
  const [driverNotes, setDriverNotes] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const cameraRef = useRef<CameraView>(null)
  const [camPermission, requestCamPermission] = useCameraPermissions()

  const capturePhoto = async () => {
    if (!cameraRef.current) return
    const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.6 })
    if (photo?.base64) {
      setPhotoData(`data:image/jpeg;base64,${photo.base64}`)
      setShowCamera(false)
    }
  }

  const submit = async () => {
    if (!recipientName.trim()) {
      Alert.alert('Recipient name is required')
      return
    }
    if (!podType) {
      Alert.alert('Select POD type (Signature or Photo)')
      return
    }
    if (podType === 'SIGNATURE' && !signatureData) {
      Alert.alert('Please capture a signature')
      return
    }
    if (podType === 'PHOTO' && !photoData) {
      Alert.alert('Please take a photo')
      return
    }
    if (!stopId || !routeId) {
      Alert.alert('Missing route or stop')
      return
    }

    setSubmitting(true)
    const payload = {
      routeId,
      stopId,
      podType,
      recipientName,
      signatureDataUrl: signatureData,
      photoDataUrl: photoData,
      driverNotes,
      timestamp: new Date().toISOString(),
    }

    try {
      const net = await NetInfo.fetch()
      if (net.isConnected) {
        await dispatchClient.recordPOD(token, tenantId, payload)
      } else {
        await syncService.queueAction('record_pod', payload)
        Alert.alert('Saved offline', 'POD will sync when connected')
      }
      await markDelivered(stopId)
      router.back()
    } catch {
      await syncService.queueAction('record_pod', payload)
      Alert.alert('Saved offline', 'POD will sync when connected')
      await markDelivered(stopId)
      router.back()
    } finally {
      setSubmitting(false)
    }
  }

  if (showCamera) {
    if (!camPermission?.granted) {
      void requestCamPermission()
      return null
    }
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        <TouchableOpacity style={s.captureBtn} onPress={() => void capturePhoto()}>
          <Text style={s.captureBtnText}>📸 Capture</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelPhoto} onPress={() => setShowCamera(false)}>
          <Text style={{ color: '#fff', fontSize: 16 }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={s.title}>Proof of Delivery</Text>
      <Text style={s.label}>Recipient Name *</Text>
      <TextInput
        style={s.input}
        value={recipientName}
        onChangeText={setRecipientName}
        placeholder="Name of recipient"
        placeholderTextColor="#64748B"
      />
      <Text style={s.label}>POD Method *</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {(['SIGNATURE', 'PHOTO'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.typeBtn, podType === t && s.typeBtnActive]}
            onPress={() => setPodType(t)}
          >
            <Text style={[s.typeBtnText, podType === t && { color: '#E2E8F0' }]}>
              {t === 'SIGNATURE' ? '✍️ Signature' : '📷 Photo'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {podType === 'SIGNATURE' && (
        <View style={s.sigBox}>
          <SignatureCanvas
            onOK={setSignatureData}
            onEmpty={() => setSignatureData(null)}
            descriptionText="Sign here"
            clearText="Clear"
            confirmText="Save"
            webStyle=".m-signature-pad { background: #14141F; }"
          />
          {signatureData ? <Text style={s.captured}>✓ Signature captured</Text> : null}
        </View>
      )}
      {podType === 'PHOTO' && (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity style={s.photoBtn} onPress={() => setShowCamera(true)}>
            <Text style={s.photoBtnText}>
              {photoData ? '🔄 Retake Photo' : '📷 Take Photo'}
            </Text>
          </TouchableOpacity>
          {photoData ? <Text style={s.captured}>✓ Photo captured</Text> : null}
        </View>
      )}
      <Text style={s.label}>Notes (optional)</Text>
      <TextInput
        style={[s.input, { height: 80, textAlignVertical: 'top' }]}
        value={driverNotes}
        onChangeText={setDriverNotes}
        placeholder="Left at door, etc."
        placeholderTextColor="#64748B"
        multiline
      />
      <TouchableOpacity
        style={[s.submitBtn, submitting && { opacity: 0.6 }]}
        onPress={() => void submit()}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit POD</Text>}
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  title: { color: '#E2E8F0', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  label: { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#14141F',
    borderColor: '#1E1E3A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: '#E2E8F0',
  },
  typeBtn: {
    flex: 1,
    backgroundColor: '#14141F',
    borderColor: '#1E1E3A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  typeBtnActive: { borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.15)' },
  typeBtnText: { color: '#64748B', fontSize: 15, fontWeight: '600' },
  sigBox: {
    backgroundColor: '#14141F',
    borderRadius: 10,
    overflow: 'hidden',
    height: 220,
    marginTop: 8,
  },
  captured: { color: '#22C55E', fontSize: 13, marginTop: 6, fontWeight: '600' },
  photoBtn: { backgroundColor: '#1E1E3A', borderRadius: 10, padding: 14, alignItems: 'center' },
  photoBtnText: { color: '#E2E8F0', fontSize: 15, fontWeight: '600' },
  captureBtn: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    backgroundColor: '#6366F1',
    padding: 18,
    alignItems: 'center',
  },
  captureBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cancelPhoto: { position: 'absolute', top: 50, right: 20 },
  submitBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginTop: 32,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
