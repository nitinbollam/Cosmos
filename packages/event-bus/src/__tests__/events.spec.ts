import { EventType, createEvent } from '../index'

describe('createEvent', () => {
  it('produces a versioned base event with required fields', () => {
    const e = createEvent(
      EventType.STOCK_RECEIVED,
      { skuId: 'sku-1', warehouseId: 'wh-1', locationId: '', quantity: 10, unitCost: 1.5, supplierId: 's-1', receivedBy: 'u-1' },
      { tenantId: 't-1', correlationId: 'corr-1' },
    )
    expect(e.id).toMatch(/[0-9a-f-]{36}/)
    expect(e.type).toBe(EventType.STOCK_RECEIVED)
    expect(e.tenantId).toBe('t-1')
    expect(e.correlationId).toBe('corr-1')
    expect(e.version).toBe(1)
    expect(e.timestamp).toBeInstanceOf(Date)
    expect(e.payload.skuId).toBe('sku-1')
  })

  it('preserves causationId and metadata when provided', () => {
    const e = createEvent(
      EventType.ORDER_CREATED,
      { orderId: 'o-1', customerId: 'c-1', lineItems: [], totalAmount: 0, channel: 'API' },
      { tenantId: 't-1', correlationId: 'corr-1', causationId: 'parent-evt', metadata: { source: 'cli' } },
    )
    expect(e.causationId).toBe('parent-evt')
    expect(e.metadata?.source).toBe('cli')
  })
})
