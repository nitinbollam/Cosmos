import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

export interface AuthState {
  isAuthenticated: boolean
  setAuthenticated: (b: boolean) => void
  logout: () => Promise<void>
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setAuthenticated: (b) => set({ isAuthenticated: b }),
  logout: async () => {
    await SecureStore.deleteItemAsync('cosmos.accessToken')
    await SecureStore.deleteItemAsync('cosmos.refreshToken')
    set({ isAuthenticated: false })
  },
  hydrate: async () => {
    const t = await SecureStore.getItemAsync('cosmos.accessToken')
    set({ isAuthenticated: !!t })
  },
}))
