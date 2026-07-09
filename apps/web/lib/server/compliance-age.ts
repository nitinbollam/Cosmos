import { crmDb, inventoryDb, orderDb, tenantDb } from './db'
import { auditLog } from './audit-log'
import { ApiError } from './session'

export type AgeVerificationPolicy = {
  enabled: boolean
  minimumAge: number
  /** B2B: customer must have tobacco license for tobacco / age-restricted SKUs. */
  requireTobaccoLicense: boolean
  /** POS: staff must attest ID / DOB before completing a restricted sale. */
  requirePosAttestation: boolean
  /** Delivery: driver must confirm recipient age before POD on restricted orders. */
  requireDeliveryConfirmation: boolean
}

export type PosAgeAttestation = {
  method: 'ID_CHECK' | 'DOB_ENTRY' | 'LICENSE_ON_FILE'
  dateOfBirth?: string
  notes?: string
}

export type DeliveryAgeAttestation = {
  ageConfirmed: boolean
  recipientName?: string
  notes?: string
}

const DEFAULT_POLICY: AgeVerificationPolicy = {
  enabled: false,
  minimumAge: 21,
  requireTobaccoLicense: true,
  requirePosAttestation: true,
  requireDeliveryConfirmation: true,
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function clampAge(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(99, Math.max(18, Math.round(v)))
}

export async function getAgeVerificationPolicy(tenantId: string): Promise<AgeVerificationPolicy> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const settings = asRecord(org?.settings)
  const raw = asRecord(settings.ageVerification)
  return {
    enabled: Boolean(raw.enabled),
    minimumAge: clampAge(raw.minimumAge, DEFAULT_POLICY.minimumAge),
    requireTobaccoLicense:
      raw.requireTobaccoLicense === undefined
        ? DEFAULT_POLICY.requireTobaccoLicense
        : Boolean(raw.requireTobaccoLicense),
    requirePosAttestation:
      raw.requirePosAttestation === undefined
        ? DEFAULT_POLICY.requirePosAttestation
        : Boolean(raw.requirePosAttestation),
    requireDeliveryConfirmation:
      raw.requireDeliveryConfirmation === undefined
        ? DEFAULT_POLICY.requireDeliveryConfirmation
        : Boolean(raw.requireDeliveryConfirmation),
  }
}

export async function updateAgeVerificationPolicy(
  tenantId: string,
  patch: Partial<AgeVerificationPolicy>,
): Promise<AgeVerificationPolicy> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant not found')
  const settings = asRecord(org.settings)
  const current = await getAgeVerificationPolicy(tenantId)
  const next: AgeVerificationPolicy = {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    minimumAge:
      patch.minimumAge !== undefined ? clampAge(patch.minimumAge, current.minimumAge) : current.minimumAge,
    requireTobaccoLicense:
      patch.requireTobaccoLicense !== undefined
        ? Boolean(patch.requireTobaccoLicense)
        : current.requireTobaccoLicense,
    requirePosAttestation:
      patch.requirePosAttestation !== undefined
        ? Boolean(patch.requirePosAttestation)
        : current.requirePosAttestation,
    requireDeliveryConfirmation:
      patch.requireDeliveryConfirmation !== undefined
        ? Boolean(patch.requireDeliveryConfirmation)
        : current.requireDeliveryConfirmation,
  }
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: { ...settings, ageVerification: next } },
  })
  return next
}

export type RestrictedSkuInfo = {
  id: string
  code: string
  name: string
  isTobacco: boolean
  ageRestricted: boolean
  minimumAge: number
}

function effectiveRestricted(
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

export async function loadRestrictedSkusForLines(
  tenantId: string,
  lineItems: Array<{ skuId: string }>,
  policyMinAge: number,
): Promise<RestrictedSkuInfo[]> {
  const skuIds = [...new Set(lineItems.map((l) => l.skuId))]
  if (skuIds.length === 0) return []
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: skuIds } },
    select: { id: true, code: true, name: true, isTobacco: true, ageRestricted: true, minimumAge: true },
  })
  return skus
    .map((s) => effectiveRestricted(s, policyMinAge))
    .filter((s): s is RestrictedSkuInfo => s != null)
}

function ageFromDob(dobIso: string, at = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dob = new Date(Date.UTC(y, mo - 1, d))
  if (Number.isNaN(dob.getTime())) return null
  let age = at.getUTCFullYear() - y
  const hadBirthday =
    at.getUTCMonth() > mo - 1 || (at.getUTCMonth() === mo - 1 && at.getUTCDate() >= d)
  if (!hadBirthday) age -= 1
  return age
}

export async function assertAgeComplianceForOrder(
  tenantId: string,
  input: {
    customerId: string
    channel: string
    lineItems: Array<{ skuId: string }>
    userId?: string
    posAttestation?: PosAgeAttestation | null
  },
): Promise<{ restrictedSkus: RestrictedSkuInfo[]; requiredMinAge: number } | null> {
  const policy = await getAgeVerificationPolicy(tenantId)
  if (!policy.enabled) return null

  const restrictedSkus = await loadRestrictedSkusForLines(tenantId, input.lineItems, policy.minimumAge)
  if (restrictedSkus.length === 0) return null

  const requiredMinAge = Math.max(policy.minimumAge, ...restrictedSkus.map((s) => s.minimumAge))
  const channel = (input.channel || 'ADMIN').toUpperCase()
  // Only the POS register path may use staff attestation. Every other channel
  // (B2B portal, admin, EDI, quotes, unknown) requires a licensed customer when
  // the policy says so — unknown channels must not bypass checks.
  const isPos = channel === 'POS'

  const customer = await crmDb.customer.findFirst({
    where: { id: input.customerId, tenantId },
    select: {
      id: true,
      name: true,
      isLicensedTobacco: true,
      tobaccoLicenseNumber: true,
      customerKind: true,
    },
  })
  if (!customer) throw new ApiError(404, 'Customer not found')

  const needsLicense = policy.requireTobaccoLicense && !isPos

  if (needsLicense) {
    const licensed =
      customer.isLicensedTobacco && Boolean(customer.tobaccoLicenseNumber?.trim())
    if (!licensed) {
      void auditLog(tenantId, {
        action: 'age_verification.blocked',
        entityType: 'Customer',
        entityId: customer.id,
        userId: input.userId,
        metadata: {
          reason: 'missing_tobacco_license',
          channel: input.channel,
          skuIds: restrictedSkus.map((s) => s.id),
        },
      }).catch(() => undefined)
      throw new ApiError(
        403,
        `Age-restricted items require a licensed customer (minimum age ${requiredMinAge}). Add a tobacco/regulated license on the customer record before ordering.`,
      )
    }
  }

  if (isPos && policy.requirePosAttestation) {
    const att = input.posAttestation
    if (!att?.method) {
      void auditLog(tenantId, {
        action: 'age_verification.blocked',
        entityType: 'Customer',
        entityId: customer.id,
        userId: input.userId,
        metadata: {
          reason: 'pos_attestation_required',
          channel: 'POS',
          skuIds: restrictedSkus.map((s) => s.id),
          requiredMinAge,
        },
      }).catch(() => undefined)
      throw new ApiError(
        403,
        `Age verification required for restricted items (minimum age ${requiredMinAge}). Confirm customer ID or enter date of birth.`,
      )
    }

    if (att.method === 'DOB_ENTRY') {
      if (!att.dateOfBirth) {
        throw new ApiError(400, 'dateOfBirth is required when using DOB_ENTRY verification')
      }
      const age = ageFromDob(att.dateOfBirth)
      if (age == null) throw new ApiError(400, 'dateOfBirth must be YYYY-MM-DD')
      if (age < requiredMinAge) {
        void auditLog(tenantId, {
          action: 'age_verification.blocked',
          entityType: 'Customer',
          entityId: customer.id,
          userId: input.userId,
          metadata: { reason: 'underage', age, requiredMinAge, channel: 'POS' },
        }).catch(() => undefined)
        throw new ApiError(403, `Customer does not meet the minimum age of ${requiredMinAge}`)
      }
    }

    if (att.method === 'LICENSE_ON_FILE') {
      const licensed =
        customer.isLicensedTobacco && Boolean(customer.tobaccoLicenseNumber?.trim())
      if (!licensed) {
        throw new ApiError(
          403,
          'Selected customer has no regulated-product license on file. Use ID check or DOB entry instead.',
        )
      }
    }

    void auditLog(tenantId, {
      action: 'age_verification.passed',
      entityType: 'Customer',
      entityId: customer.id,
      userId: input.userId,
      metadata: {
        channel: 'POS',
        method: att.method,
        requiredMinAge,
        skuIds: restrictedSkus.map((s) => s.id),
        notes: att.notes ?? null,
      },
    }).catch(() => undefined)
  } else if (!isPos) {
    void auditLog(tenantId, {
      action: 'age_verification.passed',
      entityType: 'Customer',
      entityId: customer.id,
      userId: input.userId,
      metadata: {
        channel: input.channel,
        method: 'LICENSE_ON_FILE',
        requiredMinAge,
        skuIds: restrictedSkus.map((s) => s.id),
      },
    }).catch(() => undefined)
  }

  return { restrictedSkus, requiredMinAge }
}

export async function assertDeliveryAgeCompliance(
  tenantId: string,
  orderId: string,
  pod: Record<string, unknown> | undefined,
  userId?: string,
): Promise<void> {
  const policy = await getAgeVerificationPolicy(tenantId)
  if (!policy.enabled || !policy.requireDeliveryConfirmation) return

  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  const restrictedSkus = await loadRestrictedSkusForLines(
    tenantId,
    order.lineItems.map((li) => ({ skuId: li.skuId })),
    policy.minimumAge,
  )
  if (restrictedSkus.length === 0) return

  const requiredMinAge = Math.max(policy.minimumAge, ...restrictedSkus.map((s) => s.minimumAge))
  const ageConfirmed = Boolean(pod?.ageConfirmed)
  if (!ageConfirmed) {
    void auditLog(tenantId, {
      action: 'age_verification.blocked',
      entityType: 'Order',
      entityId: orderId,
      userId,
      metadata: {
        reason: 'delivery_age_not_confirmed',
        requiredMinAge,
        skuIds: restrictedSkus.map((s) => s.id),
      },
    }).catch(() => undefined)
    throw new ApiError(
      403,
      `This delivery includes age-restricted items (minimum age ${requiredMinAge}). Confirm recipient age before marking delivered.`,
    )
  }

  void auditLog(tenantId, {
    action: 'age_verification.passed',
    entityType: 'Order',
    entityId: orderId,
    userId,
    metadata: {
      channel: 'DELIVERY',
      method: 'RECIPIENT_CONFIRMATION',
      requiredMinAge,
      recipientName: typeof pod?.recipientName === 'string' ? pod.recipientName : null,
    },
  }).catch(() => undefined)
}

/** Preview helper for clients — does not throw. */
export async function previewOrderAgeRequirements(
  tenantId: string,
  customerId: string,
  lineItems: Array<{ skuId: string }>,
  channel: string,
) {
  const policy = await getAgeVerificationPolicy(tenantId)
  if (!policy.enabled) {
    return { required: false, policy, restrictedSkus: [] as RestrictedSkuInfo[], requiredMinAge: policy.minimumAge }
  }
  const restrictedSkus = await loadRestrictedSkusForLines(tenantId, lineItems, policy.minimumAge)
  if (restrictedSkus.length === 0) {
    return { required: false, policy, restrictedSkus, requiredMinAge: policy.minimumAge }
  }
  const requiredMinAge = Math.max(policy.minimumAge, ...restrictedSkus.map((s) => s.minimumAge))
  const customer = await crmDb.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { isLicensedTobacco: true, tobaccoLicenseNumber: true },
  })
  const licensed =
    Boolean(customer?.isLicensedTobacco) && Boolean(customer?.tobaccoLicenseNumber?.trim())
  const isPos = channel.toUpperCase() === 'POS'
  return {
    required: true,
    policy,
    restrictedSkus,
    requiredMinAge,
    customerLicensed: licensed,
    needsPosAttestation: isPos && policy.requirePosAttestation,
    needsTobaccoLicense: !isPos && policy.requireTobaccoLicense && !licensed,
  }
}
