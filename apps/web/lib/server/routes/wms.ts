import * as wmsFulfillment from '../wms-fulfillment'
import * as orderOrchestration from '../order-orchestration'
import * as wmsReceiving from '../wms-receiving'
import * as wmsPutaway from '../wms-putaway'
import * as wmsLabor from '../wms-labor'
import * as wmsCycleCount from '../wms-cycle-count'
import * as wavePicking from '../wave-picking'
import { ApiError, requirePermission, assertPermission } from './common'

export async function routeFulfillment(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'wms.write')

  if (seg[1] === 'tasks' && seg.length === 2 && method === 'POST') {
    const body = (await req.json()) as wmsFulfillment.CreateFulfillmentTaskInput
    return Response.json(await wmsFulfillment.createFulfillmentTask(session.tenantId, body), { status: 201 })
  }
  if (seg[1] === 'tasks' && seg.length === 3 && method === 'DELETE') {
    const body = (await req.json()) as { correlationId?: string }
    return Response.json(
      await wmsFulfillment.cancelFulfillmentByOrder(
        session.tenantId,
        seg[2],
        body.correlationId ?? 'cancel',
      ),
    )
  }
  if (seg[1] === 'tasks' && seg.length === 4 && seg[3] === 'pack' && method === 'POST') {
    const result = await wmsFulfillment.markFulfillmentPacked(session.tenantId, seg[2])
    await orderOrchestration.onFulfillmentPacked(session.tenantId, result.orderId).catch((err) =>
      console.error(`[orders] pack side-effects failed for order ${result.orderId}:`, err),
    )
    return Response.json(result)
  }
  if (seg[1] === 'tasks' && seg.length === 4 && seg[3] === 'dispatch' && method === 'POST') {
    // Single orchestrated dispatch: serials → inventory commit → backorder shorts →
    // WMS status → order/invoice/COGS. Fails atomically enough to retry (task stays PACKED).
    return Response.json(await orderOrchestration.dispatchFulfillmentTask(session.tenantId, seg[2]))
  }
  throw new ApiError(404, 'Fulfillment route not found')
}

export async function routeWms(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'wms.read' : 'wms.write')
  const url = new URL(req.url)

  if (seg[1] === 'tasks') {
    if (seg.length === 2 && method === 'GET') {
      return Response.json(
        await wmsFulfillment.listFulfillmentTasks(
          session.tenantId,
          url.searchParams.get('status') ?? undefined,
          url.searchParams.get('warehouseId') ?? undefined,
          url.searchParams.get('orderId') ?? undefined,
        ),
      )
    }
    if (seg.length === 3 && method === 'GET') {
      return Response.json(await wmsFulfillment.getFulfillmentTask(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'assign' && method === 'PATCH') {
      const body = (await req.json()) as { userId?: string | null }
      return Response.json(
        await wmsFulfillment.assignFulfillmentTask(session.tenantId, seg[2], body.userId ?? null),
      )
    }
    if (seg.length === 4 && seg[3] === 'pick-all' && method === 'POST') {
      return Response.json(await wmsFulfillment.confirmAllPickLines(session.tenantId, seg[2]))
    }
    if (seg.length === 5 && seg[3] === 'lines' && seg[4] === 'pick' && method === 'POST') {
      const body = (await req.json()) as Parameters<typeof wmsFulfillment.confirmPickLine>[3]
      return Response.json(await wmsFulfillment.confirmPickLine(session.tenantId, seg[2], seg[4], body))
    }
    if (seg.length === 5 && seg[3] === 'lines' && seg[4] === 'short' && method === 'POST') {
      return Response.json(await wmsFulfillment.confirmPickLine(session.tenantId, seg[2], seg[4], { pickedQty: 0, markShort: true }))
    }
    if (seg.length === 4 && seg[3] === 'pack' && method === 'POST') {
      const result = await wmsFulfillment.markFulfillmentPacked(session.tenantId, seg[2])
      await orderOrchestration.onFulfillmentPacked(session.tenantId, result.orderId).catch((err) =>
        console.error(`[orders] pack side-effects failed for order ${result.orderId}:`, err),
      )
      return Response.json(result)
    }
    if (seg.length === 4 && seg[3] === 'dispatch' && method === 'POST') {
      return Response.json(await orderOrchestration.dispatchFulfillmentTask(session.tenantId, seg[2]))
    }
  }

  if (seg[1] === 'receiving') {
    const isSessions = seg[2] === 'sessions'
    const id = isSessions ? seg[3] : seg[2]
    const sub = isSessions ? seg[4] : seg[3]

    if ((seg.length === 2 || (seg.length === 3 && isSessions)) && method === 'GET') {
      return Response.json(
        await wmsReceiving.listReceivingSessions(session.tenantId, url.searchParams.get('status') ?? undefined),
      )
    }
    if ((seg.length === 2 || (seg.length === 3 && isSessions)) && method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        warehouseId?: string
        purchaseOrderId?: string
        poId?: string
        asnId?: string
      }
      const warehouseId = body.warehouseId || (await wmsReceiving.resolveDefaultWarehouseId(session.tenantId))
      const poId = body.purchaseOrderId ?? body.poId
      return Response.json(
        await wmsReceiving.startReceivingSession(session.tenantId, warehouseId, session.userId, poId, body.asnId),
        { status: 201 },
      )
    }
    if (((seg.length === 3 && !isSessions) || (seg.length === 4 && isSessions)) && method === 'GET') {
      return Response.json(await wmsReceiving.getReceivingSession(id, session.tenantId))
    }
    if ((sub === 'scan' || sub === 'line') && method === 'POST') {
      const body = (await req.json()) as {
        code?: string
        barcode?: string
        quantity?: number
        receivedQty?: number
        damagedQty?: number
        batchId?: string
        expiryDate?: string
        locationId?: string
      }
      return Response.json(
        await wmsReceiving.scanReceivingItem(id, session.tenantId, session.userId, {
          barcode: (body.barcode ?? body.code ?? '').trim(),
          receivedQty: body.receivedQty ?? body.quantity ?? 1,
          damagedQty: body.damagedQty,
          batchId: body.batchId,
          expiryDate: body.expiryDate,
          locationId: body.locationId,
        }),
      )
    }
    if (sub === 'import' && method === 'POST') {
      const body = (await req.json()) as { rows?: Parameters<typeof wmsReceiving.importReceivingItems>[3] }
      return Response.json(
        await wmsReceiving.importReceivingItems(id, session.tenantId, session.userId, body.rows ?? []),
      )
    }
    if (sub === 'complete' && (method === 'PATCH' || method === 'POST')) {
      const body = ((await req.json().catch(() => ({}))) ?? {}) as { notes?: string }
      return Response.json(
        await wmsReceiving.completeReceivingSession(id, session.tenantId, body.notes, session.userId),
      )
    }
  }

  if (seg[1] === 'putaway') {
    const isTasks = seg[2] === 'tasks'
    const id = isTasks ? seg[3] : seg[2]
    const sub = isTasks ? seg[4] : seg[3]

    if ((seg.length === 2 || (seg.length === 3 && isTasks)) && method === 'GET') {
      return Response.json(
        await wmsPutaway.listPutawayTasks(
          session.tenantId,
          url.searchParams.get('warehouseId') ?? undefined,
          url.searchParams.get('status') ?? undefined,
        ),
      )
    }
    if (((seg.length === 3 && !isTasks) || (seg.length === 4 && isTasks)) && method === 'GET') {
      const tasks = await wmsPutaway.listPutawayTasks(session.tenantId)
      const task = tasks.find((t) => t.id === id)
      if (!task) throw new ApiError(404, 'Putaway task not found')
      return Response.json(task)
    }
    if (sub === 'suggest-bin' && method === 'GET') {
      const skuId = url.searchParams.get('skuId')
      const warehouseId = url.searchParams.get('warehouseId')
      if (!skuId || !warehouseId) throw new ApiError(400, 'skuId and warehouseId required')
      return Response.json(await wmsPutaway.suggestPutawayBin(session.tenantId, warehouseId, skuId))
    }
    if (sub === 'lines' && (method === 'PATCH' || method === 'POST')) {
      const lineId = isTasks ? seg[5] : seg[4]
      const body = ((await req.json().catch(() => ({}))) ?? {}) as { actualBinId?: string; actualBinCode?: string }
      return Response.json(
        await wmsPutaway.confirmPutawayLine(session.tenantId, id, lineId, {
          actualBinId: body.actualBinId,
          actualBinCode: body.actualBinCode,
          performedBy: session.userId,
        }),
      )
    }
    if (sub === 'confirm' && method === 'POST') {
      const body = (await req.json()) as { lineId: string; actualBinId?: string; actualBinCode?: string }
      return Response.json(
        await wmsPutaway.confirmPutawayLine(session.tenantId, id, body.lineId, {
          actualBinId: body.actualBinId,
          actualBinCode: body.actualBinCode,
          performedBy: session.userId,
        }),
      )
    }
  }

  if (seg[1] === 'labor' && seg[2] === 'metrics' && method === 'GET') {
    const days = +(url.searchParams.get('days') ?? 7)
    return Response.json(
      await wmsLabor.getLaborMetrics(
        session.tenantId,
        url.searchParams.get('warehouseId') ?? undefined,
        days,
      ),
    )
  }

  if (seg[1] === 'cycle-counts') {
    if (seg.length === 2 && method === 'GET') {
      return Response.json(await wmsCycleCount.listCycleCounts(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      const body = (await req.json()) as Parameters<typeof wmsCycleCount.createCycleCount>[2]
      return Response.json(await wmsCycleCount.createCycleCount(session.tenantId, session.userId, body), {
        status: 201,
      })
    }
    if (seg.length === 3 && method === 'GET') {
      return Response.json(await wmsCycleCount.getCycleCount(session.tenantId, seg[2]))
    }
    if (seg.length === 5 && seg[3] === 'lines' && seg[4] === 'import' && method === 'POST') {
      const body = (await req.json()) as { rows?: Parameters<typeof wmsCycleCount.importCycleLineCounts>[2] }
      return Response.json(await wmsCycleCount.importCycleLineCounts(session.tenantId, seg[2], body.rows ?? []))
    }
    if (seg.length === 4 && seg[3] === 'submit-for-approval' && method === 'PATCH') {
      return Response.json(await wmsCycleCount.submitCycleCountForApproval(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'approve' && (method === 'POST' || method === 'PATCH')) {
      assertPermission(session, ['wms.write', 'inventory.write'])
      return Response.json(
        await wmsCycleCount.approveCycleCount(session.tenantId, seg[2], session.userId),
      )
    }
    if (seg.length === 5 && seg[3] === 'lines' && method === 'PATCH') {
      const body = (await req.json()) as { countedQty?: number }
      if (body.countedQty === undefined) throw new ApiError(400, 'countedQty required')
      return Response.json(
        await wmsCycleCount.updateCycleLineCountedQty(session.tenantId, seg[2], seg[4], body.countedQty),
      )
    }
  }

  throw new ApiError(404, 'WMS route not found')
}

export async function routePickWaves(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'wms.read' : 'wms.write')
  const url = new URL(req.url)
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await wavePicking.listPickWaves(session.tenantId, url.searchParams.get('warehouseId') ?? undefined))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await wavePicking.getPickWaveDetail(session.tenantId, seg[1]))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as { warehouseId: string; taskIds: string[] }
    return Response.json(
      await wavePicking.createPickWave(session.tenantId, { ...body, createdBy: session.userId }),
      { status: 201 },
    )
  }
  if (seg.length === 3 && seg[2] === 'start' && method === 'POST') {
    return Response.json(await wavePicking.startPickWave(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'complete' && method === 'POST') {
    return Response.json(await wavePicking.completePickWave(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Pick wave route not found')
}
