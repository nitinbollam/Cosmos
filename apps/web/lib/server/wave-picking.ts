import { PickWaveStatus } from '@/generated/prisma-wms'
import { wmsDb } from './db'
import { enrichPickItemsWithBins } from './pick-bin-resolver'
import { ApiError } from './session'

function compareBinCodes(a?: string, b?: string) {
  const left = a ?? 'ZZZ-NO-BIN'
  const right = b ?? 'ZZZ-NO-BIN'
  return left.localeCompare(right, undefined, { numeric: true })
}

export async function listPickWaves(tenantId: string, warehouseId?: string) {
  return wmsDb.pickWave.findMany({
    where: {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: { tasks: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function createPickWave(
  tenantId: string,
  dto: { warehouseId: string; taskIds: string[]; createdBy: string },
) {
  if (dto.taskIds.length === 0) throw new ApiError(400, 'At least one task required')

  const tasks = await wmsDb.fulfillmentTask.findMany({
    where: { tenantId, id: { in: dto.taskIds }, warehouseId: dto.warehouseId, status: { in: ['PENDING', 'PICKING'] } },
  })
  if (tasks.length !== dto.taskIds.length) throw new ApiError(400, 'Some tasks are invalid or not in this warehouse')

  return wmsDb.pickWave.create({
    data: {
      tenantId,
      warehouseId: dto.warehouseId,
      status: PickWaveStatus.OPEN,
      createdBy: dto.createdBy,
      tasks: { create: dto.taskIds.map((taskId) => ({ taskId })) },
    },
    include: { tasks: true },
  })
}

export async function startPickWave(tenantId: string, waveId: string) {
  const wave = await wmsDb.pickWave.findFirst({ where: { id: waveId, tenantId }, include: { tasks: true } })
  if (!wave) throw new ApiError(404, 'Pick wave not found')
  if (wave.status !== PickWaveStatus.OPEN) throw new ApiError(400, 'Wave is not open')

  await wmsDb.fulfillmentTask.updateMany({
    where: { tenantId, id: { in: wave.tasks.map((t) => t.taskId) } },
    data: { status: 'PICKING' },
  })

  return wmsDb.pickWave.update({
    where: { id: waveId },
    data: { status: PickWaveStatus.IN_PROGRESS },
    include: { tasks: true },
  })
}

export async function completePickWave(tenantId: string, waveId: string) {
  const wave = await wmsDb.pickWave.findFirst({ where: { id: waveId, tenantId } })
  if (!wave) throw new ApiError(404, 'Pick wave not found')
  return wmsDb.pickWave.update({
    where: { id: waveId },
    data: { status: PickWaveStatus.COMPLETED },
    include: { tasks: true },
  })
}

export async function getPickWaveDetail(tenantId: string, waveId: string) {
  const wave = await wmsDb.pickWave.findFirst({
    where: { id: waveId, tenantId },
    include: { tasks: true },
  })
  if (!wave) throw new ApiError(404, 'Pick wave not found')

  const taskIds = wave.tasks.map((t) => t.taskId)
  const tasks =
    taskIds.length === 0
      ? []
      : await wmsDb.fulfillmentTask.findMany({
          where: { tenantId, id: { in: taskIds } },
          include: { pickLines: true },
        })

  const flatLines = tasks.flatMap((task) =>
    task.pickLines.map((line) => ({
      taskId: task.id,
      orderId: task.orderId,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      pickedQty: line.pickedQty,
      status: line.status,
    })),
  )

  const pickPath = (await enrichPickItemsWithBins(tenantId, flatLines)).sort((a, b) =>
    compareBinCodes(a.binCode, b.binCode),
  )

  return {
    id: wave.id,
    warehouseId: wave.warehouseId,
    status: wave.status,
    createdAt: wave.createdAt,
    createdBy: wave.createdBy,
    tasks: wave.tasks,
    pickPath,
  }
}
