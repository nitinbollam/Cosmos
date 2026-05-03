export const STOREFRONT_AUTH_EVENT = 'cosmos-auth-changed'

export function emitStorefrontAuthChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STOREFRONT_AUTH_EVENT))
}
