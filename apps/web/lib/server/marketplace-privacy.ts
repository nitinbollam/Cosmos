const IDENTITY_KEYS = [
  'legalName',
  'businessName',
  'displayName',
  'address',
  'taxId',
  'email',
  'phone',
  'tenantId',
  'sellerTenantId',
  'buyerTenantId',
] as const

export function parsePhotoUrls(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}

export function redactCounterpartyPayload<T extends Record<string, unknown>>(payload: T): T {
  const clone = { ...payload }
  for (const key of IDENTITY_KEYS) {
    if (key in clone) delete clone[key]
  }
  return clone
}
