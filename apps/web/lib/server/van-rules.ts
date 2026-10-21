/**
 * Rules for selling from a van (PLR-167). Pure, no DB, so each rule can be tested alone.
 *
 * - A van belongs to one driver and one state.
 * - Only accounts a manager has approved for van sales may buy from it.
 * - A van never sells across state lines: the customer's state must be the van's state.
 */

export type VanSaleRefusal = { code: 'NOT_APPROVED' | 'NO_STATE' | 'WRONG_STATE' | 'NOT_YOUR_VAN' | 'VAN_INACTIVE'; message: string }

const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

export function normalizeState(state: string | null | undefined): string | null {
  const v = norm(state)
  return /^[A-Z]{2}$/.test(v) ? v : null
}

export function vanSaleRefusal(input: {
  van: { assignedDriverId: string | null; stateCode: string | null; isActive: boolean }
  driverId: string
  customer: { vanSalesApproved: boolean; primaryState: string | null }
}): VanSaleRefusal | null {
  const { van, driverId, customer } = input
  if (!van.isActive) return { code: 'VAN_INACTIVE', message: 'This van is not in service' }
  if (van.assignedDriverId !== driverId) return { code: 'NOT_YOUR_VAN', message: 'This van is assigned to another driver' }
  if (!customer.vanSalesApproved) {
    return { code: 'NOT_APPROVED', message: 'This account is not approved for van sales. Ask a manager to approve it' }
  }
  const customerState = normalizeState(customer.primaryState)
  const vanState = normalizeState(van.stateCode)
  if (!customerState || !vanState) {
    return { code: 'NO_STATE', message: 'The customer or the van has no state on record, so the sale cannot be checked' }
  }
  if (customerState !== vanState) {
    return { code: 'WRONG_STATE', message: `This van sells in ${vanState} only. The customer is in ${customerState}` }
  }
  return null
}

export type VanLine = { skuId: string; quantity: number }

/** Why a list of van lines is not acceptable, or null when it is. */
export function vanLinesProblem(lines: unknown, max = 200): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return 'Add at least one item'
  if (lines.length > max) return 'Too many lines in one go'
  const seen = new Set<string>()
  for (const raw of lines) {
    const l = (raw ?? {}) as Record<string, unknown>
    if (typeof l.skuId !== 'string' || !l.skuId) return 'Every line needs an item'
    if (seen.has(l.skuId)) return 'An item can only appear once per load'
    seen.add(l.skuId)
    if (typeof l.quantity !== 'number' || !Number.isInteger(l.quantity) || l.quantity <= 0) {
      return 'Quantities must be whole numbers above zero'
    }
  }
  return null
}
