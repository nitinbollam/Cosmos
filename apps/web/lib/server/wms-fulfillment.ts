import type { FulfillmentTaskStatus, Prisma } from '@/generated/prisma-wms'
import { wmsDb } from './db'
import { enrichPickItemsWithBins, enrichPickItemsWithSkuLabels } from './pick-bin-resolver'
import { derivePickLineStatus } from './pick-line-status'
import { ApiError } from './session'
import { claimable, compareTasks, matchesAssigned, pickAccess, type AssignedFilter } from './pick-claim'
import { getTenantWorkflowSettings } from './tenant-workflow-settings'

import { swallowed } from './fire-and-forget'
export type ConfirmPickLineInput = {
  pickedQty: number
  markShort?: boolean
  /** What the picker scanned (item barcode/code, or the bin code). Checked against the line when sent. */
  scanned?: string
}

export type PickActor = { userId: string; role: string }

/** Atomically take a free task: only one of two simultaneous claimers wins. */
async function claimIfFree(tenantId: string, taskId: string, userId: string): Promise<boolean> {
  const res = await wmsDb.fulfillmentTask.updateMany({
    where: { id: taskId, tenantId, assignedUserId: null, status: { in: ['PENDING', 'PICKING'] } },
    data: { assignedUserId: userId },
  })
  return res.count === 1
}

/** Picking needs holding the task: the holder or a manager; anyone else is refused; an unassigned task is claimed first. */
async function assertMayPick(
  tenantId: string,
  task: { id: string; assignedUserId: string | null },
  actor: PickActor | undefined,
) {
  if (!actor) return
  const access = pickAccess(task, actor)
  if (access === 'OK') return
  if (access === 'CLAIM_FIRST') {
    if (await claimIfFree(tenantId, task.id, actor.userId)) return
    const now = await wmsDb.fulfillmentTask.findFirst({ where: { id: task.id, tenantId } })
    if (now?.assignedUserId === actor.userId) return
  }
  throw new ApiError(403, 'This task is being picked by someone else')
}

/** Keeps the idle clock honest: any pick counts as activity. */
const touch = (taskId: string) => wmsDb.fulfillmentTask.update({ where: { id: taskId }, data: { updatedAt: new Date() } })

async function assertScanMatches(tenantId: string, line: { skuId: string; locationId: string | null }, scanned: string) {
  const { findSkuByScanValue } = await import('./inventory')
  const sku = await findSkuByScanValue(tenantId, scanned).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  })
  if (sku) {
    if (sku.id !== line.skuId) throw new ApiError(400, 'That is not the item on this line')
    return
  }
  throw new ApiError(400, 'That scan does not match the item on this line')
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
  lineItems: Array<{ skuId: string; warehouseId: string; quantity: number; batchId?: string; locationId?: string }>
}

const OPEN_TASK_STATUSES: FulfillmentTaskStatus[] = ['PENDING', 'PICKING', 'PACKED']

export async function createFulfillmentTask(tenantId: string, dto: CreateFulfillmentTaskInput) {
  // Only one *open* task per order; DISPATCHED tasks stay as history so backorder
  // fills can create follow-up tasks for the same order.
  const existing = await wmsDb.fulfillmentTask.findFirst({
    where: { tenantId, orderId: dto.orderId, status: { in: OPEN_TASK_STATUSES } },
  })
  if (existing) {
    throw new ApiError(409, `Fulfillment already exists for order ${dto.orderId}`)
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
          batchId: li.batchId ?? null,
          locationId: li.locationId ?? null,
        })),
      },
    },
    include: { pickLines: true },
  })

  return { taskId: task.id, status: task.status }
}

export async function cancelFulfillmentByOrder(tenantId: string, orderId: string, _correlationId: string) {
  const result = await wmsDb.fulfillmentTask.updateMany({
    where: { tenantId, orderId, status: { in: OPEN_TASK_STATUSES } },
    data: { status: 'CANCELLED' },
  })
  return { cancelled: result.count > 0 }
}

/**
 * Route newly allocated quantities (e.g. backorder fills) to the warehouse floor:
 * append pick lines to an open PENDING/PICKING task, or create a fresh task.
 */
export async function ensureFulfillmentForLines(
  tenantId: string,
  orderId: string,
  lines: Array<{ skuId: string; warehouseId: string; quantity: number; batchId?: string }>,
) {
  if (lines.length === 0) return null
  const open = await wmsDb.fulfillmentTask.findFirst({
    where: { tenantId, orderId, status: { in: ['PENDING', 'PICKING'] } },
  })
  if (open) {
    await wmsDb.pickLine.createMany({
      data: lines.map((li) => ({
        taskId: open.id,
        skuId: li.skuId,
        warehouseId: li.warehouseId,
        quantity: li.quantity,
        batchId: li.batchId ?? null,
      })),
    })
    return { taskId: open.id, status: open.status }
  }
  return createFulfillmentTask(tenantId, {
    orderId,
    correlationId: `backorder-fill-${Date.now()}`,
    lineItems: lines,
  })
}

/** The walking order: by bin, numbers in order (A2 before A10), items with no bin last. */
function sortByBin<T extends { binCode?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (a.binCode ?? 'ZZZ-NO-BIN').localeCompare(b.binCode ?? 'ZZZ-NO-BIN', undefined, { numeric: true }),
  )
}

export async function getFulfillmentTask(tenantId: string, taskId: string) {
  const t = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!t) throw new ApiError(404, 'Task not found')
  const withBins = await enrichPickItemsWithBins(
    tenantId,
    t.pickLines.map((p) => ({
      id: p.id,
      skuId: p.skuId,
      warehouseId: p.warehouseId,
      quantity: p.quantity,
      pickedQty: p.pickedQty,
      status: p.status,
    })),
  )
  const pickItems = sortByBin(await enrichPickItemsWithSkuLabels(tenantId, withBins))
  return {
    id: t.id,
    orderId: t.orderId,
    status: t.status,
    priority: t.priority,
    warehouseCode: t.warehouseCode,
    correlationId: t.correlationId,
    warehouseId: t.warehouseId,
    assignedUserId: t.assignedUserId,
    pickItems,
  }
}

export async function listFulfillmentTasks(
  tenantId: string,
  status?: string,
  warehouseId?: string,
  orderId?: string,
  opts?: { assigned?: AssignedFilter; viewerId?: string },
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

  const filter = opts?.assigned ?? 'all'
  const rows = (
    await wmsDb.fulfillmentTask.findMany({
      where: {
        ...where,
        ...(filter === 'mine' && opts?.viewerId ? { assignedUserId: opts.viewerId } : {}),
        ...(filter === 'unassigned' ? { assignedUserId: null } : {}),
      },
      include: { pickLines: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  )
    .filter((t) => matchesAssigned(filter, t.assignedUserId, opts?.viewerId ?? ''))
    .sort(compareTasks)
  return Promise.all(
    rows.map(async (t) => ({
      id: t.id,
      orderId: t.orderId,
      status: t.status,
      priority: t.priority,
      warehouseCode: t.warehouseCode,
      warehouseId: t.warehouseId,
      assignedUserId: t.assignedUserId,
      createdAt: t.createdAt,
      pickItems: sortByBin(
        await enrichPickItemsWithSkuLabels(
          tenantId,
          await enrichPickItemsWithBins(
            tenantId,
            t.pickLines.map((p) => ({
              id: p.id,
              skuId: p.skuId,
              warehouseId: p.warehouseId,
              quantity: p.quantity,
              pickedQty: p.pickedQty,
              status: p.status,
            })),
          ),
        ),
      ),
    })),
  )
}

export async function confirmPickLine(
  tenantId: string,
  taskId: string,
  lineId: string,
  dto: ConfirmPickLineInput,
  actor?: PickActor,
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
  await assertMayPick(tenantId, task, actor)

  const line = task.pickLines.find((p) => p.id === lineId)
  if (!line) throw new ApiError(404, 'Pick line not found')
  if (dto.scanned && dto.scanned.trim()) await assertScanMatches(tenantId, line, dto.scanned)
  if (line.batchId) {
    const { checkBatchNotRecalled } = await import('./compliance-recall')
    await checkBatchNotRecalled(tenantId, line.batchId, line.skuId)
  }
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
  await touch(taskId)

  const nextTaskStatus: FulfillmentTaskStatus =
    task.status === 'PENDING' && pickedQty > 0 ? 'PICKING' : task.status

  if (nextTaskStatus !== task.status) {
    await wmsDb.fulfillmentTask.update({
      where: { id: taskId },
      data: { status: nextTaskStatus },
    })
  }

  if (pickedQty > 0) {
    const { recordLaborEvent } = await import('./wms-labor')
    void recordLaborEvent(tenantId, {
      userId: actor?.userId ?? task.assignedUserId ?? 'system',
      eventType: 'PICK',
      referenceId: lineId,
      quantity: pickedQty,
      warehouseId: task.warehouseId,
    }).catch(swallowed('wms-fulfillment.confirmPickLine'))
  }

  return getFulfillmentTask(tenantId, taskId)
}

export async function confirmAllPickLines(tenantId: string, taskId: string, actor?: PickActor) {
  const task = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!task) throw new ApiError(404, 'Task not found')
  assertTaskPickable(task.status)
  await assertMayPick(tenantId, task, actor)
  if (task.pickLines.length === 0) throw new ApiError(400, 'Task has no pick lines')

  const { checkBatchNotRecalled } = await import('./compliance-recall')
  for (const line of task.pickLines) {
    if (line.batchId) {
      await checkBatchNotRecalled(tenantId, line.batchId, line.skuId)
    }
  }

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
  } else {
    await touch(taskId)
  }

  const { recordLaborEvent } = await import('./wms-labor')
  for (const line of task.pickLines) {
    void recordLaborEvent(tenantId, {
      userId: actor?.userId ?? task.assignedUserId ?? 'system',
      eventType: 'PICK',
      referenceId: line.id,
      quantity: line.quantity,
      warehouseId: task.warehouseId,
    }).catch(swallowed('wms-fulfillment.confirmAllPickLines'))
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

/** Take a task to pick. Free or already yours: yes. Held by someone who has gone quiet: yes. Otherwise 409. */
export async function claimFulfillmentTask(tenantId: string, taskId: string, userId: string) {
  const task = await wmsDb.fulfillmentTask.findFirst({ where: { id: taskId, tenantId } })
  if (!task) throw new ApiError(404, 'Task not found')
  if (task.status !== 'PENDING' && task.status !== 'PICKING') {
    throw new ApiError(400, `Cannot pick a task in status ${task.status}`)
  }
  const { pickClaimStaleMinutes } = await getTenantWorkflowSettings(tenantId)
  const now = new Date()
  if (!claimable(task, userId, now, pickClaimStaleMinutes)) {
    throw new ApiError(409, 'Someone else is picking this task')
  }
  // Compare-and-set on who held it when we looked: of two simultaneous claimers only one lands.
  const res = await wmsDb.fulfillmentTask.updateMany({
    where: { id: taskId, tenantId, assignedUserId: task.assignedUserId, status: { in: ['PENDING', 'PICKING'] } },
    data: { assignedUserId: userId, updatedAt: now },
  })
  if (res.count !== 1) throw new ApiError(409, 'Someone else is picking this task')
  return getFulfillmentTask(tenantId, taskId)
}

/** Give a task back. The holder or a manager can; picked lines stay picked. */
export async function releaseFulfillmentTask(tenantId: string, taskId: string, actor: PickActor) {
  const task = await wmsDb.fulfillmentTask.findFirst({ where: { id: taskId, tenantId } })
  if (!task) throw new ApiError(404, 'Task not found')
  if (task.assignedUserId === null) return getFulfillmentTask(tenantId, taskId)
  if (pickAccess(task, actor) !== 'OK') throw new ApiError(403, 'Only the picker or a manager can release this task')
  await wmsDb.fulfillmentTask.update({ where: { id: taskId }, data: { assignedUserId: null } })
  return getFulfillmentTask(tenantId, taskId)
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

  const { checkBatchNotRecalled } = await import('./compliance-recall')
  for (const p of t.pickLines) {
    if (p.batchId) {
      await checkBatchNotRecalled(tenantId, p.batchId, p.skuId)
    }
  }

  const updated = await wmsDb.fulfillmentTask.update({
    where: { id: t.id },
    data: { status: 'PACKED' },
  })
  return { taskId: updated.id, orderId: t.orderId, status: updated.status }
}

/** Raw task + pick lines (incl. batch) for dispatch processing. */
export async function getFulfillmentTaskRaw(tenantId: string, taskId: string) {
  const t = await wmsDb.fulfillmentTask.findFirst({
    where: { id: taskId, tenantId },
    include: { pickLines: true },
  })
  if (!t) throw new ApiError(404, 'Task not found')
  return t
}

export async function markFulfillmentDispatched(tenantId: string, taskId: string) {
  const t = await getFulfillmentTaskRaw(tenantId, taskId)
  if (t.status !== 'PACKED') throw new ApiError(400, 'Task must be PACKED before dispatch')

  const { checkBatchNotRecalled } = await import('./compliance-recall')
  for (const p of t.pickLines) {
    if (p.batchId) {
      await checkBatchNotRecalled(tenantId, p.batchId, p.skuId)
    }
  }

  const updated = await wmsDb.fulfillmentTask.update({
    where: { id: t.id },
    data: { status: 'DISPATCHED' },
  })
  return { taskId: updated.id, orderId: t.orderId, status: updated.status }
}
