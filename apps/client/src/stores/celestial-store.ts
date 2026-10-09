import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CelestialSurface = 'shop' | 'admin'

export type CelestialChatLink = { label: string; href: string }

export type CelestialChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  links?: CelestialChatLink[]
  meta?: string
}

type SurfaceState = {
  messages: CelestialChatMessage[]
  conversationId?: string
  floatingOpen: boolean
  providerInfo: string | null
  /** When true, skip auto-restore from server (after "New chat") */
  skipHistoryRestore: boolean
}

type CelestialStore = {
  admin: SurfaceState
  shop: SurfaceState
  setFloatingOpen: (surface: CelestialSurface, open: boolean) => void
  setProviderInfo: (surface: CelestialSurface, info: string | null) => void
  setConversationId: (surface: CelestialSurface, id: string | undefined) => void
  setMessages: (
    surface: CelestialSurface,
    updater: CelestialChatMessage[] | ((prev: CelestialChatMessage[]) => CelestialChatMessage[]),
  ) => void
  updateMessage: (
    surface: CelestialSurface,
    id: string,
    patch: Partial<CelestialChatMessage>,
  ) => void
  clearChat: (surface: CelestialSurface) => void
  setSkipHistoryRestore: (surface: CelestialSurface, skip: boolean) => void
}

function emptySurface(): SurfaceState {
  return {
    messages: [],
    conversationId: undefined,
    floatingOpen: false,
    providerInfo: null,
    skipHistoryRestore: false,
  }
}

export const useCelestialStore = create<CelestialStore>()(
  persist(
    (set) => ({
      admin: emptySurface(),
      shop: emptySurface(),
      setFloatingOpen: (surface, open) =>
        set((s) => ({ [surface]: { ...s[surface], floatingOpen: open } })),
      setProviderInfo: (surface, info) =>
        set((s) => ({ [surface]: { ...s[surface], providerInfo: info } })),
      setConversationId: (surface, id) =>
        set((s) => ({ [surface]: { ...s[surface], conversationId: id } })),
      setMessages: (surface, updater) =>
        set((s) => ({
          [surface]: {
            ...s[surface],
            messages: typeof updater === 'function' ? updater(s[surface].messages) : updater,
          },
        })),
      updateMessage: (surface, id, patch) =>
        set((s) => ({
          [surface]: {
            ...s[surface],
            messages: s[surface].messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          },
        })),
      clearChat: (surface) =>
        set((s) => ({
          [surface]: {
            ...emptySurface(),
            floatingOpen: s[surface].floatingOpen,
            skipHistoryRestore: true,
          },
        })),
      setSkipHistoryRestore: (surface, skip) =>
        set((s) => ({ [surface]: { ...s[surface], skipHistoryRestore: skip } })),
    }),
    {
      name: 'pleros-celestial-v1',
      partialize: (s) => ({ admin: s.admin, shop: s.shop }),
    },
  ),
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'pleros-celestial-v1') {
      void useCelestialStore.persist.rehydrate()
    }
  })
}
