import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Crypto from 'expo-crypto'
import { Stack, useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { crmClient, type CustomerDto } from '../src/api/crm.client'
import { inventoryClient, type SkuRow } from '../src/api/inventory.client'
import type { OrderLineItemDto, PaymentMethod } from '../src/api/order.client'
import { orderClient } from '../src/api/order.client'
import { apiErrorMessage } from '../src/api/apiError'
import { C } from '../src/theme/colors'

type CartLine = {
  skuId: string
  code: string
  name: string
  quantity: number
  unitPrice: number
}

const PAYMENTS: PaymentMethod[] = ['NET_TERMS', 'CARD', 'CASH', 'CHECK', 'ACH']

export default function NewOrderScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { customerId: paramCustomerId } = useLocalSearchParams<{ customerId?: string }>()

  const [step, setStep] = useState(0)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [customerId, setCustomerId] = useState<string | null>(paramCustomerId ?? null)
  const [custQuery, setCustQuery] = useState('')
  const [skuQuery, setSkuQuery] = useState('')
  const [skuRows, setSkuRows] = useState<SkuRow[]>([])
  const [skuLoading, setSkuLoading] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('NET_TERMS')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOrder, setConfirmOrder] = useState<{ id: string; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const warehouseId = warehouses[0]?.id ?? ''

  const loadMeta = useCallback(async () => {
    setLoadErr(null)
    try {
      const [c, w] = await Promise.all([crmClient.listCustomers(), inventoryClient.listWarehouses()])
      setCustomers(c)
      setWarehouses(w.map((x) => ({ id: x.id, name: x.name })))
      if (paramCustomerId) setCustomerId(paramCustomerId)
    } catch (e) {
      setLoadErr(apiErrorMessage(e))
    }
  }, [paramCustomerId])

  useLayoutEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useLayoutEffect(() => {
    const titles = ['New order · Customer', 'New order · Products', 'New order · Review', 'Order placed']
    navigation.setOptions({ title: titles[Math.min(step, 3)] })
  }, [navigation, step])

  const filteredCustomers = useMemo(() => {
    const q = custQuery.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.includes(q) ?? false),
    )
  }, [customers, custQuery])

  const searchSkus = useCallback(async () => {
    setSkuLoading(true)
    setErr(null)
    try {
      const r = await inventoryClient.searchSkus(skuQuery, 40)
      setSkuRows(r.items.filter((i) => i.isActive !== false))
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setSkuLoading(false)
    }
  }, [skuQuery])

  function addSku(s: SkuRow | { id: string; code: string; name: string; price: number; category: string }) {
    const price = typeof s.price === 'number' ? s.price : parseFloat(String(s.price)) || 0
    setCart((prev) => {
      const i = prev.findIndex((p) => p.skuId === s.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], quantity: next[i].quantity + 1 }
        return next
      }
      return [...prev, { skuId: s.id, code: s.code, name: s.name, quantity: 1, unitPrice: price }]
    })
  }

  function decLine(skuId: string) {
    setCart((prev) =>
      prev
        .map((l) => (l.skuId === skuId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    )
  }

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

  async function submit() {
    if (!customerId || !warehouseId || cart.length === 0) {
      setErr('Customer, warehouse, and line items are required.')
      return
    }
    setSubmitting(true)
    setErr(null)
    const lineItems: OrderLineItemDto[] = cart.map((l) => ({
      skuId: l.skuId,
      warehouseId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }))
    const idem = Crypto.randomUUID()
    try {
      const order = await orderClient.create(
        {
          customerId,
          channel: 'SALES_REP',
          paymentMethod: payment,
          lineItems,
          notes: notes.trim() || undefined,
        },
        idem,
      )
      const total = typeof order.totalAmount === 'number' ? order.totalAmount : parseFloat(String(order.totalAmount))
      setConfirmOrder({ id: order.id, total: Number.isFinite(total) ? total : subtotal })
      setStep(3)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (loadErr && warehouses.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{loadErr}</Text>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTintColor: C.text,
          headerStyle: { backgroundColor: C.surface },
        }}
      />
      <View style={styles.root}>
        {err ? <Text style={styles.banner}>{err}</Text> : null}

        {step === 0 && (
          <View style={styles.panel}>
            <Text style={styles.label}>Search customers</Text>
            <TextInput
              value={custQuery}
              onChangeText={setCustQuery}
              placeholder="Name, email, phone"
              placeholderTextColor={C.text3}
              style={styles.input}
            />
            <FlatList
              data={filteredCustomers}
              keyExtractor={(c) => c.id}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.rowItem, customerId === item.id && styles.rowItemOn]}
                  onPress={() => setCustomerId(item.id)}
                >
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  {item.email ? <Text style={styles.rowSub}>{item.email}</Text> : null}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, !customerId && styles.btnDisabled]}
              disabled={!customerId}
              onPress={() => setStep(1)}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 1 && (
          <View style={styles.panel}>
            <Text style={styles.label}>Product search</Text>
            <View style={styles.rowGap}>
              <TextInput
                value={skuQuery}
                onChangeText={setSkuQuery}
                placeholder="SKU code or name"
                placeholderTextColor={C.text3}
                style={[styles.input, { flex: 1 }]}
                onSubmitEditing={() => void searchSkus()}
              />
              <TouchableOpacity style={styles.smallBtn} onPress={() => void searchSkus()}>
                <Text style={styles.smallBtnTxt}>Search</Text>
              </TouchableOpacity>
            </View>
            {!warehouseId ? <Text style={styles.warn}>No warehouse — add one in admin.</Text> : null}
            {skuLoading ? <ActivityIndicator color={C.primary} style={{ marginTop: 12 }} /> : null}
            <FlatList
              data={skuRows}
              keyExtractor={(s) => s.id}
              style={styles.list}
              ListEmptyComponent={
                skuQuery.trim() ? (
                  <Text style={styles.muted}>No results. Tap Search.</Text>
                ) : (
                  <Text style={styles.muted}>Search to add products.</Text>
                )
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.rowItem} onPress={() => addSku(item)}>
                  <Text style={styles.rowTitle}>
                    {item.code} · {item.name}
                  </Text>
                  <Text style={styles.rowSub}>
                    {px(item.price).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <Text style={styles.h3}>Cart ({cart.reduce((n, l) => n + l.quantity, 0)})</Text>
            {cart.map((l) => (
              <View key={l.skuId} style={styles.cartRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{l.code}</Text>
                  <Text style={styles.rowSub}>{l.name}</Text>
                </View>
                <TouchableOpacity onPress={() => decLine(l.skuId)} style={styles.qtyBtn}>
                  <Text style={styles.qtyTxt}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyNum}>{l.quantity}</Text>
                <TouchableOpacity
                  onPress={() =>
                    addSku({
                      id: l.skuId,
                      code: l.code,
                      name: l.name,
                      price: l.unitPrice,
                      category: '',
                    })
                  }
                  style={styles.qtyBtn}
                >
                  <Text style={styles.qtyTxt}>+</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.primaryBtn, (cart.length === 0 || !warehouseId) && styles.btnDisabled]}
              disabled={cart.length === 0 || !warehouseId}
              onPress={() => setStep(2)}
            >
              <Text style={styles.primaryBtnTxt}>Review</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep(0)}>
              <Text style={styles.ghostBtnTxt}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View style={styles.panel}>
            <Text style={styles.label}>Payment & notes</Text>
            <View style={styles.payRow}>
              {PAYMENTS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.payChip, payment === p && styles.payChipOn]}
                  onPress={() => setPayment(p)}
                >
                  <Text style={[styles.payChipTxt, payment === p && styles.payChipTxtOn]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Order notes (optional)"
              placeholderTextColor={C.text3}
              style={[styles.input, styles.ta]}
              multiline
            />
            <Text style={styles.total}>
              Total {subtotal.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, submitting && styles.btnDisabled]}
              disabled={submitting}
              onPress={() => void submit()}
            >
              <Text style={styles.primaryBtnTxt}>{submitting ? 'Submitting…' : 'Place order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setStep(1)} disabled={submitting}>
              <Text style={styles.ghostBtnTxt}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && confirmOrder && (
          <View style={styles.panel}>
            <Text style={styles.successTitle}>Order confirmed</Text>
            <Text style={styles.orderIdMono}>{confirmOrder.id}</Text>
            <Text style={styles.total}>
              {confirmOrder.total.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
              <Text style={styles.primaryBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </>
  )
}

function px(n: string | number): number {
  if (typeof n === 'number') return n
  const x = parseFloat(n)
  return Number.isFinite(x) ? x : 0
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: C.bg },
  err: { color: C.danger, textAlign: 'center' },
  banner: { color: C.danger, padding: 10, backgroundColor: C.surface2, fontSize: 13 },
  panel: { flex: 1, padding: 16 },
  label: { color: C.text2, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    color: C.text,
    fontSize: 16,
  },
  ta: { minHeight: 80, textAlignVertical: 'top', marginTop: 12 },
  list: { flex: 1, marginTop: 12 },
  rowItem: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  rowItemOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  rowTitle: { color: C.text, fontWeight: '700' },
  rowSub: { color: C.text2, fontSize: 13, marginTop: 4 },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: C.primary,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnTxt: { color: C.white, fontWeight: '800', fontSize: 16 },
  ghostBtn: { marginTop: 10, padding: 12, alignItems: 'center' },
  ghostBtnTxt: { color: C.text2, fontWeight: '600' },
  rowGap: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  smallBtn: {
    backgroundColor: C.surface3,
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  smallBtnTxt: { color: C.text, fontWeight: '700' },
  warn: { color: C.warning, marginTop: 8, fontSize: 13 },
  muted: { color: C.text3, marginTop: 16, textAlign: 'center' },
  h3: { color: C.text, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    padding: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  qtyTxt: { color: C.text, fontSize: 18, fontWeight: '700' },
  qtyNum: { color: C.text, fontWeight: '800', minWidth: 24, textAlign: 'center' },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  payChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  payChipOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  payChipTxt: { color: C.text2, fontSize: 11, fontWeight: '700' },
  payChipTxtOn: { color: C.primary },
  total: {
    color: C.accent,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 8,
  },
  successTitle: { color: C.success, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  orderIdMono: { color: C.text2, fontSize: 12, marginBottom: 12 },
})
