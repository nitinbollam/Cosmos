import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CloseShiftDto } from './dto/close-shift.dto'
import { CreateRegisterDto } from './dto/create-register.dto'
import { CreateSaleDto } from './dto/create-sale.dto'
import { OpenShiftDto } from './dto/open-shift.dto'
import { VoidSaleDto } from './dto/void-sale.dto'

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  listRegisters(tenantId: string) {
    return this.prisma.posRegister.findMany({ where: { tenantId }, orderBy: { code: 'asc' } })
  }

  async createRegister(tenantId: string, dto: CreateRegisterDto) {
    try {
      return await this.prisma.posRegister.create({
        data: { tenantId, code: dto.code, name: dto.name },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Register code exists')
      }
      throw e
    }
  }

  async openShift(tenantId: string, dto: OpenShiftDto) {
    const reg = await this.prisma.posRegister.findFirst({
      where: { id: dto.registerId, tenantId },
    })
    if (!reg) throw new BadRequestException('Unknown register')
    const open = await this.prisma.posShift.findFirst({
      where: { registerId: dto.registerId, closedAt: null },
    })
    if (open) throw new ConflictException('Shift already open on this register')
    return this.prisma.posShift.create({
      data: {
        tenantId,
        registerId: dto.registerId,
        openingCash: new Prisma.Decimal(dto.openingCash),
        openedBy: dto.openedBy,
      },
    })
  }

  async closeShift(tenantId: string, shiftId: string, dto: CloseShiftDto) {
    const shift = await this.prisma.posShift.findFirst({
      where: { id: shiftId, tenantId },
    })
    if (!shift) throw new NotFoundException('Shift not found')
    if (shift.closedAt) throw new BadRequestException('Shift already closed')
    return this.prisma.posShift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        closingCash: new Prisma.Decimal(dto.closingCash),
        closedBy: dto.closedBy,
      },
    })
  }

  async createSale(tenantId: string, dto: CreateSaleDto) {
    const shift = await this.prisma.posShift.findFirst({
      where: { id: dto.shiftId, tenantId },
    })
    if (!shift) throw new BadRequestException('Unknown shift')
    if (shift.closedAt) throw new BadRequestException('Shift is closed')
    return this.prisma.posSale.create({
      data: {
        tenantId,
        shiftId: dto.shiftId,
        saleRef: dto.saleRef,
        lines: dto.lines as unknown as Prisma.InputJsonValue,
        total: new Prisma.Decimal(dto.total),
      },
    })
  }

  listSales(tenantId: string, shiftId?: string) {
    return this.prisma.posSale.findMany({
      where: { tenantId, ...(shiftId ? { shiftId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
  }

  async voidSale(tenantId: string, saleId: string, dto: VoidSaleDto) {
    const sale = await this.prisma.posSale.findFirst({ where: { id: saleId, tenantId } })
    if (!sale) throw new NotFoundException('Sale not found')
    if (sale.voided) throw new BadRequestException('Already voided')
    return this.prisma.posSale.update({
      where: { id: saleId },
      data: {
        voided: true,
        voidReason: dto.reason ?? `voidedBy:${dto.voidedBy}`,
      },
    })
  }
}
