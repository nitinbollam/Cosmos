import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  tenantId: string | null
  setAuthenticated: (b: boolean) => void
  setSession: (token: string | null, tenantId: string | null) => void
  logout: () => Promise<void>
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  token: null,
  tenantId: null,
  setAuthenticated: (b) => set({ isAuthenticated: b }),
  setSession: (token, tenantId) => set({ token, tenantId, isAuthenticated: !!token }),
  logout: async () => {
    await SecureStore.deleteItemAsync('cosmos.accessToken')
    await SecureStore.deleteItemAsync('cosmos.refreshToken')
    await SecureStore.deleteItemAsync('cosmos.tenantId')
    await SecureStore.deleteItemAsync('cosmos.userId')
    set({ isAuthenticated: false, token: null, tenantId: null })
  },
  hydrate: async () => {
    const t = await SecureStore.getItemAsync('cosmos.accessToken')
    const tid = await SecureStore.getItemAsync('cosmos.tenantId')
    set({ isAuthenticated: !!t, token: t, tenantId: tid })
  },
}))
