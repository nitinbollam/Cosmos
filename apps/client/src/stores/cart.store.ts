import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { currentIdentity, ownerKeyOf } from '@/lib/session-identity'

/**
 * Every buyer keeps their own saved cart on the device, under `pleros-cart-v1:<tenant>:<user>`.
 * Signing out switches to an empty guest cart instead of deleting anything, so the buyer
 * finds their cart again when they sign back in, while the next person on a shared device
 * never sees it. Items added while signed out are merged into the buyer's cart on sign-in.
 */
const CART_KEY = 'pleros-cart-v1'
const GUEST_KEY = `${CART_KEY}:guest`

function cartKeyForSession(): string {
  const owner = ownerKeyOf(currentIdentity('shop'))
  return owner ? `${CART_KEY}:${owner}` : GUEST_KEY
}

/** The key the in-memory cart was loaded from; writes always go back to the same place. */
let activeKey: string | null = null

function storageArea(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const perUserStorage: StateStorage = {
  getItem: () => {
    const ls = storageArea()
    if (!ls) return null
    activeKey ??= cartKeyForSession()
    const own = ls.getItem(activeKey)
    if (own != null) return own
    // A cart saved before carts were per user belongs to whoever signs in first.
    const legacy = ls.getItem(CART_KEY)
    if (legacy != null && activeKey !== GUEST_KEY) {
      ls.removeItem(CART_KEY)
      ls.setItem(activeKey, legacy)
      return legacy
    }
    return null
  },
  setItem: (_name, value) => {
    const ls = storageArea()
    if (!ls) return
    activeKey ??= cartKeyForSession()
    ls.setItem(activeKey, value)
  },
  removeItem: () => {
    const ls = storageArea()
    if (ls && activeKey) ls.removeItem(activeKey)
  },
}

export interface CartItem {
  skuId: string
  skuName: string
  skuCode: string
  unitPrice: number
  quantity: number
  warehouseId: string
}

interface CartStore {
  items: CartItem[]
  addItem: (item: CartItem) => void
  addItems: (items: CartItem[]) => void
  removeItem: (skuId: string) => void
  setQty: (skuId: string, qty: number) => void
  clear: () => void
  subtotal: () => number
  count: () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) =>
        set((s) => {
          const ex = s.items.find((i) => i.skuId === item.skuId)
          if (ex) {
            return {
              items: s.items.map((i) =>
                i.skuId === item.skuId ? { ...i, quantity: i.quantity + item.quantity } : i,
              ),
            }
          }
          return { items: [...s.items, item] }
        }),
      addItems: (items) =>
        set((s) => {
          let next = [...s.items]
          for (const item of items) {
            const ex = next.find((i) => i.skuId === item.skuId)
            if (ex) {
              next = next.map((i) =>
                i.skuId === item.skuId ? { ...i, quantity: i.quantity + item.quantity, unitPrice: item.unitPrice } : i,
              )
            } else {
              next.push(item)
            }
          }
          return { items: next }
        }),
      removeItem: (skuId) => set((s) => ({ items: s.items.filter((i) => i.skuId !== skuId) })),
      setQty: (skuId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.skuId !== skuId)
              : s.items.map((i) => (i.skuId === skuId ? { ...i, quantity: qty } : i)),
        })),
      clear: () => set({ items: [] }),
      subtotal: () => get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    { name: CART_KEY, storage: createJSONStorage(() => perUserStorage) },
  ),
)

function readGuestItems(): CartItem[] {
  try {
    const raw = storageArea()?.getItem(GUEST_KEY)
    const items = raw ? (JSON.parse(raw) as { state?: { items?: CartItem[] } }).state?.items : null
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

/**
 * Point the cart at whoever is signed in to the buyer portal now. Call after any change to
 * that login (sign-in, sign-out, expiry, another tab). Loads that buyer's saved cart, and on
 * sign-in folds in anything added while signed out.
 */
export function syncCartToSession() {
  if (!storageArea()) return
  const next = cartKeyForSession()
  if (next === activeKey) return
  const guestItems = next !== GUEST_KEY ? readGuestItems() : []
  activeKey = next
  void Promise.resolve(useCartStore.persist.rehydrate()).then(() => {
    // rehydrate leaves the previous user's items in memory when the new key is empty.
    const saved = storageArea()?.getItem(next)
    if (saved == null) useCartStore.setState({ items: [] })
    if (guestItems.length > 0) {
      useCartStore.getState().addItems(guestItems)
      storageArea()?.removeItem(GUEST_KEY)
    }
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // Another tab changed this buyer's cart: reload it so the badge and totals stay current.
    if (event.key && event.key === activeKey) void useCartStore.persist.rehydrate()
  })
}
