import { marketplaceDb, inventoryDb, tenantDb } from './db'
import { ApiError } from './session'

type AddressSnapshot = {
  name: string
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

function parseWarehouseAddress(json: unknown, name: string): AddressSnapshot | null {
  if (!json || typeof json !== 'object') return null
  const a = json as Record<string, unknown>
  const line1 = String(a.line1 ?? a.street ?? '').trim()
  const city = String(a.city ?? '').trim()
  const state = String(a.state ?? '').trim()
  const postalCode = String(a.postalCode ?? a.zip ?? '').trim()
  if (!line1 || !city) return null
  return {
    name,
    line1,
    line2: a.line2 ? String(a.line2) : undefined,
    city,
    state,
    postalCode,
    country: String(a.country ?? 'US'),
  }
}

async function defaultWarehouseAddress(tenantId: string): Promise<AddressSnapshot | null> {
  const wh = await inventoryDb.warehouse.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  if (!wh) return null
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  return parseWarehouseAddress(wh.address, org?.displayName ?? wh.name)
}

/** Internal-only: build Kalafleet LTL booking payload when payment is held. */
export async function createMarketplaceShipmentRequest(orderId: string) {
  const order = await marketplaceDb.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: { listing: true, shipment: true },
  })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.shipment) return order.shipment

  const pickup = await defaultWarehouseAddress(order.sellerTenantId)
  const delivery = await defaultWarehouseAddress(order.buyerTenantId)
  if (!pickup || !delivery) {
    throw new ApiError(400, 'Seller and buyer need a default warehouse address for Kalafleet booking')
  }

  const bolNumber = `MP-${order.id.slice(-8).toUpperCase()}`
  const kalafleetRef = `KF-PENDING-${order.id.slice(-10).toUpperCase()}`

  return marketplaceDb.marketplaceShipmentRequest.create({
    data: {
      orderId,
      pickupAddressJson: JSON.stringify(pickup),
      deliveryAddressJson: JSON.stringify(delivery),
      freightClass: '70',
      weightLbs: Math.max(1, order.quantity * 40),
      status: 'PENDING',
      kalafleetRef,
      bolNumber,
    },
  })
}

/** Ops confirms Kalafleet booking — assigns live ref and moves order to fulfillment. */
export async function bookMarketplaceShipment(orderId: string, kalafleetRef: string) {
  const shipment = await marketplaceDb.marketplaceShipmentRequest.findUnique({ where: { orderId } })
  if (!shipment) {
    await createMarketplaceShipmentRequest(orderId)
  }
  const updatedShipment = await marketplaceDb.marketplaceShipmentRequest.update({
    where: { orderId },
    data: { status: 'BOOKED', kalafleetRef: kalafleetRef.trim() },
  })
  await marketplaceDb.marketplaceOrder.update({
    where: { id: orderId },
    data: {
      kalafleetShipmentRef: kalafleetRef.trim(),
      orderStatus: 'IN_FULFILLMENT',
    },
  })
  return updatedShipment
}

export async function getOpsShipmentDetail(orderId: string) {
  const row = await marketplaceDb.marketplaceShipmentRequest.findUnique({ where: { orderId } })
  if (!row) return null
  return {
    orderId: row.orderId,
    status: row.status,
    kalafleetRef: row.kalafleetRef,
    bolNumber: row.bolNumber,
    pickup: JSON.parse(row.pickupAddressJson) as AddressSnapshot,
    delivery: JSON.parse(row.deliveryAddressJson) as AddressSnapshot,
  }
}
