/**
 * Data that belongs to whoever is signed in to an area — carts, buyer identity and assistant
 * history — and must never carry over to the next person on a shared device.
 *
 * Each area has its own owner stamp, because each area has its own login:
 * - shop: cart, B2B cart, buyer identity, buyer-side assistant history
 * - admin: admin-side assistant history
 * - mobile: nothing here (the offline queue tracks its own owners)
 *
 * An explicit sign-out wipes that area's data; a session that merely expires keeps it, so the
 * same person signing back in finds their cart where they left it.
 */
import { clearCart as clearB2bCart } from '@/lib/b2b-cart'
import { clearB2bSession } from '@/lib/session'
import { currentIdentity, currentSurface, ownerKeyOf, type Surface } from '@/lib/session-identity'
import { useCartStore } from '@/stores/cart.store'
import { useCelestialStore } from '@/stores/celestial-store'

const LEGACY_OWNER_KEY = 'pleros.dataOwner'

function ownerKey(surface: Surface): string {
  return `pleros.${surface}.dataOwner`
}

function readOwner(surface: Surface): string | null {
  try {
    return window.localStorage.getItem(ownerKey(surface))
  } catch {
    return null
  }
}

function writeOwner(surface: Surface, owner: string | null) {
  try {
    if (owner) window.localStorage.setItem(ownerKey(surface), owner)
    else window.localStorage.removeItem(ownerKey(surface))
    window.localStorage.removeItem(LEGACY_OWNER_KEY)
  } catch {
    /* storage blocked — nothing to stamp */
  }
}

function blankAssistant() {
  return {
    messages: [],
    conversationId: undefined,
    floatingOpen: false,
    providerInfo: null,
    skipHistoryRestore: false,
  }
}

export function wipeUserData(surface: Surface = currentSurface()) {
  if (typeof window === 'undefined') return
  if (surface === 'shop') {
    useCartStore.getState().clear()
    clearB2bCart()
    clearB2bSession()
    useCelestialStore.setState({ shop: blankAssistant() })
  } else if (surface === 'admin') {
    useCelestialStore.setState({ admin: blankAssistant() })
  }
  writeOwner(surface, null)
}

/**
 * Call on boot and whenever an area's signed-in user may have changed. If that area's data
 * belongs to someone else, it is wiped before the new user can see it. Data saved before
 * stamping existed is adopted by the first user who signs in.
 */
export function reconcileUserDataOwner(surface: Surface = currentSurface()) {
  if (typeof window === 'undefined') return
  const current = ownerKeyOf(currentIdentity(surface))
  if (!current) return
  const stamped = readOwner(surface)
  if (stamped && stamped !== current) wipeUserData(surface)
  writeOwner(surface, current)
}
