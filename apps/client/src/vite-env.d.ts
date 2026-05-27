/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string
  readonly VITE_WEB_ADMIN_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
