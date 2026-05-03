import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PurchaseOrderStatus, Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto'
import { ReceiveGoodsDto } from './dto/receive-goods.dto'
import { assertReceiveIncrementsValid } from './receiveGoodsValidate'

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, status?: PurchaseOrderStatus) {
    return this.prisma.purchaseOrder.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    })
    if (!row) throw new NotFoundException('Purchase order not found')
    return row
  }

  async create(tenantId: string, dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    })
    if (!supplier) throw new BadRequestException('Unknown supplier for tenant')

    const lineNos = new Set(dto.lines.map((l) => l.lineNo))
    if (lineNos.size !== dto.lines.length) throw new BadRequestException('Duplicate line numbers')

    try {
      return await this.prisma.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: dto.supplierId,
          number: dto.number,
          notes: dto.notes,
          status: PurchaseOrderStatus.DRAFT,
          lines: {
            create: dto.lines.map((l) => ({
              lineNo: l.lineNo,
              skuCode: l.skuCode,
              description: l.description,
              qtyOrdered: l.qtyOrdered,
            })),
          },
        },
        include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('PO number already exists for tenant')
      }
      throw e
    }
  }

  async submit(tenantId: string, id: string) {
    const po = await this.get(tenantId, id)
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be submitted')
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.SUBMITTED },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    })
  }

  async cancel(tenantId: string, id: string) {
    const po = await this.get(tenantId, id)
    if (po.status === PurchaseOrderStatus.CLOSED || po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('PO already terminal')
    }
    if (po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Cannot cancel a partially received PO')
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    })
  }

  async receiveGoods(tenantId: string, id: string, dto: ReceiveGoodsDto) {
    const po = await this.get(tenantId, id)
    if (po.status === PurchaseOrderStatus.CANCELLED || po.status === PurchaseOrderStatus.CLOSED) {
      throw new BadRequestException('PO is not open for receiving')
    }
    if (po.status === PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Submit the PO before receiving')
    }

    assertReceiveIncrementsValid(po.lines, dto.lines)

    await this.prisma.$transaction(
      dto.lines.map((r) =>
        this.prisma.purchaseOrderLine.update({
          where: { id: r.lineId },
          data: { qtyReceived: { increment: r.qtyReceived } },
        }),
      ),
    )

    const updated = await this.get(tenantId, id)
    const allFullyReceived = updated.lines.every((l) => l.qtyReceived >= l.qtyOrdered)
    const anyReceived = updated.lines.some((l) => l.qtyReceived > 0)

    let nextStatus: PurchaseOrderStatus = po.status
    if (allFullyReceived) nextStatus = PurchaseOrderStatus.CLOSED
    else if (anyReceived) nextStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED
    else nextStatus = PurchaseOrderStatus.SUBMITTED

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: nextStatus },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    })
  }
}
