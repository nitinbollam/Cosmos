import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import type { CycleCountType } from '../generated/prisma-client'

type InvLevelRow = {
  skuId: string
  locationId?: string | null
  batchId?: string | null
  quantityOnHand: number
}

@Injectable()
export class CycleCountService {
  private readonly log = new Logger(CycleCountService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private internalHeaders(tenantId: string): Record<string, string> {
    const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET')
    if (!secret) {
      throw new BadRequestException('INTERNAL_SERVICE_SECRET not configured for WMS')
    }
    return {
      'x-cosmos-internal-key': secret,
      'x-cosmos-tenant-id': tenantId,
      'Content-Type': 'application/json',
    }
  }

  private inventoryBase(): string | null {
    const b = this.config.get<string>('INVENTORY_SERVICE_URL')?.replace(/\/$/, '')
    return b || null
  }

  private async fetchWarehouseLevels(tenantId: string, warehouseId: string): Promise<InvLevelRow[]> {
    const base = this.inventoryBase()
    if (!base) {
      this.log.warn('INVENTORY_SERVICE_URL not set — cycle count lines will be empty')
      return []
    }
    try {
      const { data } = await firstValueFrom(
        this.http.get<InvLevelRow[]>(
          `${base}/api/v1/inventory/levels?warehouseId=${encodeURIComponent(warehouseId)}`,
          { headers: this.internalHeaders(tenantId), timeout: 25_000 },
        ),
      )
      return Array.isArray(data) ? data : []
    } catch (e) {
      this.log.warn(`Failed to load inventory levels: ${(e as Error).message}`)
      return []
    }
  }

  private selectLinesForCountType(levels: InvLevelRow[], type: CycleCountType) {
    const nonBatch = levels.filter((l) => l.batchId == null || l.batchId === '')
    const keyed = nonBatch.map((l) => ({
      skuId: l.skuId,
      locationLabel: l.locationId?.trim() || null,
      systemQty: Math.max(0, Number(l.quantityOnHand) || 0),
    }))

    if (type === 'FULL') {
      return keyed.slice(0, 500)
    }
    if (type === 'ABC') {
      const sorted = [...keyed].sort((a, b) => b.systemQty - a.systemQty)
      return sorted.slice(0, Math.min(100, sorted.length))
    }
    const shuffled = [...keyed]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, Math.min(40, shuffled.length))
  }

  async list(tenantId: string) {
    const rows = await this.prisma.cycleCount.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { lines: true } } },
    })
    if (rows.length === 0) return []

    const ids = rows.map((r) => r.id)
    const lineAgg = await this.prisma.cycleCountLine.findMany({
      where: { countId: { in: ids } },
      select: { countId: true, systemQty: true, countedQty: true },
    })
    const vmap = new Map<string, number>()
    for (const l of lineAgg) {
      if (l.countedQty == null) continue
      if (l.countedQty === l.systemQty) continue
      vmap.set(l.countId, (vmap.get(l.countId) ?? 0) + 1)
    }
    return rows.map((r) => ({
      ...r,
      varianceItemsCount: vmap.get(r.id) ?? 0,
    }))
  }

  async create(
    tenantId: string,
    userId: string,
    dto: { warehouseId: string; type: CycleCountType; scheduledFor?: string | null },
  ) {
    const scheduled =
      dto.scheduledFor && dto.scheduledFor.length > 0 ? new Date(dto.scheduledFor) : null
    const count = await this.prisma.cycleCount.create({
      data: {
        tenantId,
        warehouseId: dto.warehouseId,
        type: dto.type,
        status: 'DRAFT',
        scheduledFor: scheduled,
        createdBy: userId,
      },
    })

    const levels = await this.fetchWarehouseLevels(tenantId, dto.warehouseId)
    const picks = this.selectLinesForCountType(levels, dto.type)
    if (picks.length > 0) {
      await this.prisma.cycleCountLine.createMany({
        data: picks.map((p) => ({
          countId: count.id,
          skuId: p.skuId,
          locationLabel: p.locationLabel,
          systemQty: p.systemQty,
          countedQty: null,
        })),
      })
      await this.prisma.cycleCount.update({
        where: { id: count.id },
        data: { status: 'IN_PROGRESS' },
      })
    }

    return this.get(tenantId, count.id)
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { id: 'asc' } } },
    })
    if (!row) throw new NotFoundException('Cycle count not found')
    return row
  }

  async importLineCounts(
    tenantId: string,
    countId: string,
    rows: Array<{ skuId?: string; skuCode?: string; locationLabel?: string; countedQty: number }>,
  ) {
    const row = await this.get(tenantId, countId)
    if (row.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Counted quantities can only be imported while count is in progress')
    }

    const codeToSkuId = new Map<string, string>()
    const unresolvedCodes = new Set<string>()
    for (const importRow of rows) {
      if (importRow.skuId || !importRow.skuCode?.trim()) continue
      const code = importRow.skuCode.trim().toLowerCase()
      if (codeToSkuId.has(code) || unresolvedCodes.has(code)) continue
      const base = this.inventoryBase()
      if (!base) {
        unresolvedCodes.add(code)
        continue
      }
      try {
        const { data } = await firstValueFrom(
          this.http.get<{ id: string }>(`${base}/api/v1/skus/lookup/by-code`, {
            params: { code: importRow.skuCode.trim() },
            headers: this.internalHeaders(tenantId),
            timeout: 15_000,
          }),
        )
        codeToSkuId.set(code, data.id)
      } catch {
        unresolvedCodes.add(code)
      }
    }

    let updated = 0
    const errors: Array<{ row: number; message: string }> = []
    for (let index = 0; index < rows.length; index++) {
      const importRow = rows[index]
      const rowNum = index + 2
      let skuId = importRow.skuId?.trim()
      if (!skuId && importRow.skuCode?.trim()) {
        skuId = codeToSkuId.get(importRow.skuCode.trim().toLowerCase())
      }
      if (!skuId) {
        errors.push({ row: rowNum, message: 'skuId or skuCode is required and must match a line' })
        continue
      }

      const location = importRow.locationLabel?.trim() || null
      const line = row.lines.find(
        (candidate) =>
          candidate.skuId === skuId &&
          (candidate.locationLabel?.trim() || null) === location,
      )
      if (!line) {
        errors.push({ row: rowNum, message: 'No matching cycle count line for SKU/location' })
        continue
      }

      await this.prisma.cycleCountLine.update({
        where: { id: line.id },
        data: { countedQty: importRow.countedQty },
      })
      updated++
    }

    return { updated, failed: errors.length, errors }
  }

  async updateLineCountedQty(tenantId: string, countId: string, lineId: string, countedQty: number) {
    const row = await this.get(tenantId, countId)
    if (row.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Counted quantities can only be edited while count is in progress')
    }
    const line = row.lines.find((l) => l.id === lineId)
    if (!line) throw new NotFoundException('Line not found')
    return this.prisma.cycleCountLine.update({
      where: { id: lineId },
      data: { countedQty },
    })
  }

  async approve(tenantId: string, id: string) {
    const row = await this.get(tenantId, id)
    if (row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only counts pending approval can be posted')
    }
    return this.prisma.cycleCount.update({
      where: { id: row.id },
      data: { status: 'COMPLETED' },
      include: { lines: true },
    })
  }

  async submitForApproval(tenantId: string, id: string) {
    const row = await this.get(tenantId, id)
    if (row.status !== 'DRAFT' && row.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Count must be draft or in progress to submit')
    }
    return this.prisma.cycleCount.update({
      where: { id: row.id },
      data: { status: 'PENDING_APPROVAL' },
      include: { lines: true },
    })
  }
}
