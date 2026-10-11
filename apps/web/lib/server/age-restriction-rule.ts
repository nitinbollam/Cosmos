/**
 * Which products need an age check, and from what age. One rule shared by the
 * delivery age gate (compliance-age.ts) and the "21+" tags on route stops, so the
 * two can never disagree. Free of DB imports so it can be unit-tested on its own.
 */
export type RestrictedSkuInfo = {
  id: string
  code: string
  name: string
  isTobacco: boolean
  ageRestricted: boolean
  minimumAge: number
}

/** Age-restricted or tobacco products are restricted; minimum age falls back to the company policy. */
export function effectiveRestricted(
  sku: { id: string; code: string; name: string; isTobacco: boolean; ageRestricted: boolean; minimumAge: number | null },
  policyMinAge: number,
): RestrictedSkuInfo | null {
  const restricted = Boolean(sku.ageRestricted || sku.isTobacco)
  if (!restricted) return null
  return {
    id: sku.id,
    code: sku.code,
    name: sku.name,
    isTobacco: sku.isTobacco,
    ageRestricted: sku.ageRestricted || sku.isTobacco,
    minimumAge: sku.minimumAge && sku.minimumAge > 0 ? sku.minimumAge : policyMinAge,
  }
}
