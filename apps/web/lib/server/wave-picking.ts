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

  // Only the first of two simultaneous starts moves the wave.
  const started = await wmsDb.pickWave.updateMany({
    where: { id: waveId, tenantId, status: PickWaveStatus.OPEN },
    data: { status: PickWaveStatus.IN_PROGRESS, startedAt: new Date() },
  })
  if (started.count !== 1) throw new ApiError(409, 'Wave was just started by someone else')

  // Only tasks that have not been picked yet; a task already packed or dispatched keeps its status.
  await wmsDb.fulfillmentTask.updateMany({
    where: { tenantId, id: { in: wave.tasks.map((t) => t.taskId) }, status: 'PENDING' },
    data: { status: 'PICKING' },
  })

  return wmsDb.pickWave.findFirstOrThrow({ where: { id: waveId }, include: { tasks: true } })
}

/** A wave task is finished once every line is picked or short, or the task has moved past picking. */
function taskFinished(task: { status: string; pickLines: Array<{ status: string }> }) {
  if (task.status === 'PACKED' || task.status === 'DISPATCHED' || task.status === 'CANCELLED') return true
  return task.pickLines.every((l) => l.status === 'PICKED' || l.status === 'SHORT')
}

export async function completePickWave(tenantId: string, waveId: string) {
  const wave = await wmsDb.pickWave.findFirst({ where: { id: waveId, tenantId }, include: { tasks: true } })
  if (!wave) throw new ApiError(404, 'Pick wave not found')
  if (wave.status === PickWaveStatus.COMPLETED) return wave
  if (wave.status === PickWaveStatus.CANCELLED) throw new ApiError(400, 'Wave is cancelled')

  // Tasks that no longer exist do not hold the wave open, so an orphaned wave can still be closed.
  const tasks = await wmsDb.fulfillmentTask.findMany({
    where: { tenantId, id: { in: wave.tasks.map((t) => t.taskId) } },
    select: { status: true, pickLines: { select: { status: true } } },
  })
  const unfinished = tasks.filter((t) => !taskFinished(t)).length
  if (unfinished > 0) {
    throw new ApiError(409, `${unfinished} task${unfinished === 1 ? ' is' : 's are'} not picked yet; finish or mark lines short first`)
  }

  await wmsDb.pickWave.updateMany({
    where: { id: waveId, tenantId, status: { in: [PickWaveStatus.OPEN, PickWaveStatus.IN_PROGRESS] } },
    data: { status: PickWaveStatus.COMPLETED, completedAt: new Date() },
  })
  return wmsDb.pickWave.findFirstOrThrow({ where: { id: waveId }, include: { tasks: true } })
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
