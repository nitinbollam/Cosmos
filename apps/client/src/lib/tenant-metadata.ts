export type TenantMe = {
  id: string
  slug: string
  displayName: string
  plan: string
  settings?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type TenantMetadata = {
  catalog?: {
    brands?: string[]
    productGroups?: string[]
    extraCategories?: string[]
  }
  sales?: {
    customerGroups?: string[]
    promotions?: Array<{ id: string; code: string; label: string; discountPct: number; active: boolean }>
  }
  purchase?: {
    storeChannels?: string[]
  }
  general?: {
    ecomTheme?: {
      primaryColor?: string
      accentColor?: string
      logoUrl?: string
      storefrontTitle?: string
    }
    customerDisplay?: {
      welcomeMessage?: string
      showPrices?: boolean
      showStock?: boolean
      supportPhone?: string
    }
  }
}

export function readMetadata(tenant: TenantMe | undefined): TenantMetadata {
  return (tenant?.metadata ?? {}) as TenantMetadata
}

export function readSettings(tenant: TenantMe | undefined): Record<string, unknown> {
  return (tenant?.settings ?? {}) as Record<string, unknown>
}
