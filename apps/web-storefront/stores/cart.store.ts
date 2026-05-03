import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    { name: 'cosmos-cart-v1' },
  ),
)
