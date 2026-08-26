import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import * as inv from '../inventory'
import * as barcodeLabels from '../barcode-labels'
import * as demandPlanning from '../demand-planning'
import * as inventoryLots from '../inventory-lots'
import * as inventorySerials from '../inventory-serials'
import * as binLocations from '../bin-locations'
import * as pricing from '../pricing'
import { ApiError, requireSession, requirePermission, assertPermission } from './common'

export async function routeSkus(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (method !== 'GET') {
    assertPermission(session, 'inventory.write')
  } else if (isPortalBuyer(session.role) && seg[1] !== 'categories' && seg.length > 2) {
    // Buyers may browse the catalog (list, categories, detail) but not internal
    // inventory views (lots, serials, demand plans, labels, lookups).
    throw new ApiError(403, 'Forbidden')
  }

  if (seg[1] === 'categories' && method === 'GET') {
    return Response.json(await inv.distinctCategories(session.tenantId))
  }
  if (seg[1] === 'lookup' && seg[2] === 'by-code' && method === 'GET') {
    const code = url.searchParams.get('code')
    if (!code) throw new ApiError(400, 'code query required')
    return Response.json(await inv.findSkuByCode(session.tenantId, code))
  }
  if (seg[1] === 'lookup' && seg[2] === 'scan-value' && method === 'GET') {
    const value = url.searchParams.get('value')
    if (!value) throw new ApiError(400, 'value query required')
    return Response.json(await inv.findSkuByScanValue(session.tenantId, value))
  }
  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: inv.CreateSkuInput[] }
    return Response.json(await inv.importSkus(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    const page = +(url.searchParams.get('page') ?? 1)
    const pageSize = +(url.searchParams.get('pageSize') ?? 50)
    const term = (url.searchParams.get('search') ?? url.searchParams.get('q'))?.trim() || undefined
    let customerId = url.searchParams.get('customerId') ?? undefined
    if (isPortalBuyer(session.role)) {
      customerId = await requirePortalCustomerId(session)
    }
    return Response.json(
      await inv.listSkus(session.tenantId, page, pageSize, term, {
        category: url.searchParams.get('category') ?? undefined,
        warehouseId: url.searchParams.get('warehouseId') ?? undefined,
        inStockOnly: url.searchParams.get('inStock') === 'true',
        customerId,
      }),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as inv.CreateSkuInput
    return Response.json(await inv.createSku(session.tenantId, body))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await inv.findSkuById(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'reorder-suggestion' && method === 'GET') {
    const warehouseId = url.searchParams.get('warehouseId') ?? undefined
    return Response.json(await inv.getSkuReorderSuggestion(session.tenantId, seg[1], warehouseId ?? undefined))
  }
  if (seg.length === 3 && seg[2] === 'demand-plan' && method === 'GET') {
    const warehouseId = url.searchParams.get('warehouseId') ?? undefined
    const days = +(url.searchParams.get('days') ?? 30)
    return Response.json(
      await demandPlanning.getSkuDemandPlan(session.tenantId, seg[1], warehouseId ?? undefined, days),
    )
  }
  if (seg.length === 3 && seg[2] === 'label' && method === 'GET') {
    const qty = +(url.searchParams.get('qty') ?? 1)
    const size = url.searchParams.get('size') ?? undefined
    const symbols = url.searchParams.get('symbols') ?? undefined
    const html = await barcodeLabels.buildSkuLabelHtml(session.tenantId, seg[1], { quantity: qty, size, symbols })
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="label-${seg[1]}.html"` },
    })
  }
  if (seg.length === 3 && seg[2] === 'tracking' && method === 'GET') {
    return Response.json(await inventoryLots.getSkuLotTracking(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'tracking' && method === 'PATCH') {
    const body = (await req.json()) as { trackLot?: boolean; trackSerial?: boolean }
    return Response.json(await inventoryLots.setSkuLotTracking(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'lots' && method === 'GET') {
    const warehouseId = url.searchParams.get('warehouseId') ?? undefined
    return Response.json(await inventoryLots.listInventoryLots(session.tenantId, seg[1], warehouseId))
  }
  if (seg.length === 3 && seg[2] === 'serials' && method === 'GET') {
    return Response.json(
      await inventorySerials.listSerialUnits(session.tenantId, {
        skuId: seg[1],
        status: url.searchParams.get('status') ?? undefined,
      }),
    )
  }
  if (seg.length === 3 && seg[2] === 'serials' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inventorySerials.registerSerialUnits>[1]
    return Response.json(await inventorySerials.registerSerialUnits(session.tenantId, { ...body, skuId: seg[1] }), {
      status: 201,
    })
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Partial<inv.CreateSkuInput> & { isActive?: boolean }
    return Response.json(await inv.updateSku(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'SKU route not found')
}

export async function routeWarehouses(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  if (method !== 'GET') assertPermission(session, 'inventory.write')

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await inv.listWarehouses(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.createWarehouse>[1]
    return Response.json(await inv.createWarehouse(session.tenantId, body))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await inv.findWarehouseById(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as { isDefault?: boolean }
    if (body.isDefault) return Response.json(await inv.setDefaultWarehouse(session.tenantId, seg[1]))
    return Response.json(await inv.findWarehouseById(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Warehouse route not found')
}

export async function routeInventory(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'inventory.read' : 'inventory.write')
  const url = new URL(req.url)

  if (seg[1] === 'ledger' && method === 'GET') {
    const skuId = url.searchParams.get('skuId')
    if (!skuId) throw new ApiError(400, 'skuId query required')
    const limit = +(url.searchParams.get('limit') ?? 100)
    return Response.json(await inv.ledgerForSku(session.tenantId, skuId, limit))
  }
  if (seg[1] === 'adjust' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.adjustStock>[1]
    return Response.json(await inv.adjustStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'receive' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.receiveStock>[1]
    return Response.json(await inv.receiveStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'transfer' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.transferStock>[1]
    return Response.json(await inv.transferStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'alerts' && method === 'GET') {
    return Response.json(await inv.lowStockAlerts(session.tenantId))
  }
  if (seg[1] === 'levels' && seg.length === 2 && method === 'GET') {
    return Response.json(
      await inv.getStockLevels(session.tenantId, {
        skuId: url.searchParams.get('skuId') ?? undefined,
        warehouseId: url.searchParams.get('warehouseId') ?? undefined,
      }),
    )
  }
  if (seg[1] === 'levels' && seg[2] === 'ensure' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.ensureStockLevel>[1]
    return Response.json(await inv.ensureStockLevel(session.tenantId, body))
  }
  if (seg[1] === 'levels' && seg.length === 3 && method === 'PATCH') {
    const body = (await req.json()) as Parameters<typeof inv.patchStockLevel>[2]
    return Response.json(await inv.patchStockLevel(session.tenantId, seg[2], body))
  }
  if (seg[1] === 'stock' && seg[2] === 'reserve' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.reserveStock>[1]
    const reservationId = await inv.reserveStock(session.tenantId, body)
    return Response.json({ reservationId })
  }
  if (seg[1] === 'stock' && seg[2] === 'release' && method === 'POST') {
    const body = (await req.json()) as { reservationId: string }
    await inv.releaseReservation(session.tenantId, body.reservationId)
    return Response.json({ released: true })
  }
  if (seg[1] === 'demand-plan' && seg.length === 2 && method === 'GET') {
    const warehouseId = url.searchParams.get('warehouseId') ?? undefined
    const days = +(url.searchParams.get('days') ?? 30)
    const limit = +(url.searchParams.get('limit') ?? 50)
    return Response.json(
      await demandPlanning.listDemandPlans(session.tenantId, warehouseId ?? undefined, days, limit),
    )
  }
  if (seg[1] === 'lots' && seg.length === 2 && method === 'GET') {
    const skuId = url.searchParams.get('skuId')
    if (!skuId) throw new ApiError(400, 'skuId query required')
    return Response.json(
      await inventoryLots.listInventoryLots(
        session.tenantId,
        skuId,
        url.searchParams.get('warehouseId') ?? undefined,
      ),
    )
  }
  throw new ApiError(404, 'Inventory route not found')
}

export async function routeBins(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'wms.read' : 'wms.write')
  const url = new URL(req.url)
  if (seg.length === 1 && method === 'GET') {
    const warehouseId = url.searchParams.get('warehouseId')
    if (!warehouseId) throw new ApiError(400, 'warehouseId required')
    return Response.json(await binLocations.listBinLocations(session.tenantId, warehouseId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof binLocations.createBinLocation>[1]
    return Response.json(await binLocations.createBinLocation(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'DELETE') {
    return Response.json(await binLocations.deleteBinLocation(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Bin route not found')
}

export async function routeVolumePrices(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'inventory.read' : 'inventory.write')
  const url = new URL(req.url)
  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await pricing.listVolumePriceBreaks(
        session.tenantId,
        url.searchParams.get('skuId') ?? undefined,
        url.searchParams.get('customerId') ?? undefined,
      ),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof pricing.upsertVolumePriceBreak>[1]
    return Response.json(await pricing.upsertVolumePriceBreak(session.tenantId, body), { status: 201 })
  }
  throw new ApiError(404, 'Volume price route not found')
}
