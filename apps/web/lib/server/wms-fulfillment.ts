import type { FulfillmentTaskStatus, Prisma } from '@/generated/prisma-wms'
import { wmsDb } from './db'
import { derivePickLineStatus } from './pick-line-status'
import { ApiError } from './session'

export type ConfirmPickLineInput = {
  pickedQty: number
  markShort?: boolean
}

export { derivePickLineStatus } from './pick-line-status'

function assertTaskPickable(status: FulfillmentTaskStatus) {
  if (status === 'CANCELLED' || status === 'PACKED' || status === 'DISPATCHED') {
    throw new ApiError(400, `Cannot pick for task in status ${status}`)
  }
}

export type CreateFulfillmentTaskInput = {
  orderId: string
  correlationId: string
  priority?: string
  lineItems: Array<{ skuId: string; warehouseId: string; quantity: number }>
}

export async function createFulfillmentTask(tenantId: string, dto: CreateFulfillmentTaskInput) {
  const existing = await wmsDb.fulfillmentTask.findUnique({
    where: { tenantId_orderId: { tenantId, orderId: dto.orderId } },
  })
  if (existing && existing.status !== 'CANCELLED') {
    throw new ApiError(409, `Fulfillment already exists for order ${dto.orderId}`)
  }
  if (existing?.status === 'CANCELLED') {
    await wmsDb.pickLine.deleteMany({ where: { taskId: existing.id } })
    await wmsDb.fulfillmentTask.delete({ where: { id: existing.id } })
  }

  const first = dto.lineItems[0]
  if (!first) throw new ApiError(400, 'lineItems required')

  const warehouseId = first.warehouseId
  const warehouseCode = `WH-${warehouseId.slice(-6).toUpperCase()}`

  const task = await wmsDb.fulfillmentTask.create({
    data: {
      tenantId,
      orderId: dto.orderId,
      priority: dto.priority ?? 'NORMAL',
      correlationId: dto.correlationId,
      warehouseId,
      warehouseCode,
      pickLines: {
        create: dto.lineItems.map((li) => ({
          skuId: li.skuId,
          warehouseId: li.warehouseId,
          quantity: li.quantity,
        })),
      },
    },
    include: { pickLines: true },
  })

  return { taskId: task.id, status: task.status }
}

export async function cancelFulfillmentByOrder(tenantId: string, orderId: string, _correlationId: string) {
  const task = await wmsDb.fulfillmentTask.findUnique({
    where: { tenantId_orderId: { tenantId, orderId } },
  })
  if (!task) return { cancelled: false }
  if (task.status === 'CANCELLED') return { cancelled: false }
  await wmsDb.fulfillmentTask.update({
    where: { id: task.id },
    data: { status: 'CANCELLED' },
  })
  return { cancelled: true }
}

export async function getFulfillmentTask(tenantId: string, taskId: string) {
  const t = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!t) throw new ApiError(404, 'Task not found')
  return {
    id: t.id,
    orderId: t.orderId,
    status: t.status,
    priority: t.priority,
    warehouseCode: t.warehouseCode,
    correlationId: t.correlationId,
    warehouseId: t.warehouseId,
    assignedUserId: t.assignedUserId,
    pickItems: t.pickLines.map((p) => ({
      id: p.id,
      skuId: p.skuId,
      warehouseId: p.warehouseId,
      quantity: p.quantity,
      pickedQty: p.pickedQty,
      status: p.status,
    })),
  }
}

export async function listFulfillmentTasks(
  tenantId: string,
  status?: string,
  warehouseId?: string,
  orderId?: string,
) {
  const st = status?.trim()
  const wh = warehouseId?.trim()
  const ord = orderId?.trim()

  const base: Prisma.FulfillmentTaskWhereInput = {
    tenantId,
    ...(wh ? { warehouseId: wh } : {}),
    ...(ord ? { orderId: ord } : {}),
  }

  let where: Prisma.FulfillmentTaskWhereInput

  if (ord) {
    where = { ...base, status: { not: 'CANCELLED' } }
  } else if (!st) {
    where = {
      ...base,
      status: { in: ['PENDING', 'PICKING'] satisfies FulfillmentTaskStatus[] },
    }
  } else if (st.toUpperCase() === 'ALL') {
    where = { ...base, status: { not: 'CANCELLED' } }
  } else if (st.toUpperCase() === 'ASSIGNED') {
    where = {
      ...base,
      assignedUserId: { not: null },
      status: { not: 'CANCELLED' },
    }
  } else if (st.toUpperCase() === 'PICKED' || st.toUpperCase() === 'PACKING') {
    where = {
      ...base,
      status: 'PICKING',
      pickLines: { every: { OR: [{ status: 'PICKED' }, { status: 'SHORT' }] } },
    }
  } else {
    const u = st.toUpperCase()
    if (u === 'PENDING' || u === 'PICKING' || u === 'PACKED' || u === 'DISPATCHED' || u === 'CANCELLED') {
      where = { ...base, status: u as FulfillmentTaskStatus }
    } else {
      where = {
        ...base,
        status: { in: ['PENDING', 'PICKING'] satisfies FulfillmentTaskStatus[] },
      }
    }
  }

  const rows = await wmsDb.fulfillmentTask.findMany({
    where,
    include: { pickLines: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
  return rows.map((t) => ({
    id: t.id,
    orderId: t.orderId,
    status: t.status,
    priority: t.priority,
    warehouseCode: t.warehouseCode,
    warehouseId: t.warehouseId,
    assignedUserId: t.assignedUserId,
    createdAt: t.createdAt,
    pickItems: t.pickLines.map((p) => ({
      id: p.id,
      skuId: p.skuId,
      quantity: p.quantity,
      pickedQty: p.pickedQty,
      status: p.status,
    })),
  }))
}

export async function confirmPickLine(
  tenantId: string,
  taskId: string,
  lineId: string,
  dto: ConfirmPickLineInput,
) {
  const pickedQty = Math.floor(Number(dto.pickedQty))
  if (!Number.isFinite(pickedQty) || pickedQty < 0) {
    throw new ApiError(400, 'pickedQty must be a non-negative integer')
  }

  const task = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!task) throw new ApiError(404, 'Task not found')
  assertTaskPickable(task.status)

  const line = task.pickLines.find((p) => p.id === lineId)
  if (!line) throw new ApiError(404, 'Pick line not found')
  if (pickedQty > line.quantity) {
    throw new ApiError(400, `pickedQty cannot exceed ordered quantity (${line.quantity})`)
  }

  const status = derivePickLineStatus(line.quantity, pickedQty, dto.markShort)
  if (pickedQty > 0 && pickedQty < line.quantity && !dto.markShort) {
    throw new ApiError(400, 'Partial pick requires markShort: true or pick full quantity')
  }

  await wmsDb.pickLine.update({
    where: { id: lineId },
    data: { pickedQty, status },
  })

  const nextTaskStatus: FulfillmentTaskStatus =
    task.status === 'PENDING' && pickedQty > 0 ? 'PICKING' : task.status

  if (nextTaskStatus !== task.status) {
    await wmsDb.fulfillmentTask.update({
      where: { id: taskId },
      data: { status: nextTaskStatus },
    })
  }

  return getFulfillmentTask(tenantId, taskId)
}

export async function confirmAllPickLines(tenantId: string, taskId: string) {
  const task = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!task) throw new ApiError(404, 'Task not found')
  assertTaskPickable(task.status)
  if (task.pickLines.length === 0) throw new ApiError(400, 'Task has no pick lines')

  await wmsDb.$transaction(
    task.pickLines.map((line) =>
      wmsDb.pickLine.update({
        where: { id: line.id },
        data: { pickedQty: line.quantity, status: 'PICKED' },
      }),
    ),
  )

  if (task.status !== 'PICKING') {
    await wmsDb.fulfillmentTask.update({
      where: { id: taskId },
      data: { status: 'PICKING' },
    })
  }

  return getFulfillmentTask(tenantId, taskId)
}

export async function assignFulfillmentTask(tenantId: string, taskId: string, userId: string | null) {
  const task = await wmsDb.fulfillmentTask.findFirst({ where: { id: taskId, tenantId } })
  if (!task) throw new ApiError(404, 'Task not found')
  if (task.status === 'CANCELLED' || task.status === 'DISPATCHED') {
    throw new ApiError(400, `Cannot assign task in status ${task.status}`)
  }
  return wmsDb.fulfillmentTask.update({
    where: { id: taskId },
    data: { assignedUserId: userId },
  })
}

export async function markFulfillmentPacked(tenantId: string, taskId: string) {
  const t = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!t) throw new ApiError(404, 'Task not found')
  if (t.status === 'CANCELLED' || t.status === 'DISPATCHED') {
    throw new ApiError(400, `Cannot pack task in status ${t.status}`)
  }
  if (t.status === 'PACKED') return { taskId: t.id, orderId: t.orderId, status: t.status }

  const ready = t.pickLines.every((p) => p.status === 'PICKED' || p.status === 'SHORT')
  if (!ready) throw new ApiError(400, 'All lines must be PICKED or SHORT before packing')

  const updated = await wmsDb.fulfillmentTask.update({
    where: { id: t.id },
    data: { status: 'PACKED' },
  })
  return { taskId: updated.id, orderId: t.orderId, status: updated.status }
}

export async function markFulfillmentDispatched(tenantId: string, taskId: string) {
  const t = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!t) throw new ApiError(404, 'Task not found')
  if (t.status !== 'PACKED') throw new ApiError(400, 'Task must be PACKED before dispatch')

  const updated = await wmsDb.fulfillmentTask.update({
    where: { id: t.id },
    data: { status: 'DISPATCHED' },
  })
  return { taskId: updated.id, orderId: t.orderId, status: updated.status }
}
