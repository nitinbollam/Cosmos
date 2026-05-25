import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { PatchCustomerDto } from './dto/patch-customer.dto'

function dec(n: number | undefined | null) {
  if (n == null) return undefined
  return new Prisma.Decimal(n)
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.customer.findMany({ where: { tenantId }, orderBy: { name: 'asc' } })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.customer.findFirst({ where: { id, tenantId } })
    if (!row) throw new NotFoundException('Customer not found')
    return row
  }

  findByExternalRef(tenantId: string, externalRef: string) {
    return this.prisma.customer.findFirst({
      where: { tenantId, externalRef },
    })
  }

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        externalRef: dto.externalRef,
        customerKind: dto.customerKind ?? 'BUSINESS',
        firstName: dto.firstName,
        lastName: dto.lastName,
        taxId: dto.taxId,
        isLicensedTobacco: dto.isLicensedTobacco ?? false,
        tobaccoLicenseNumber: dto.tobaccoLicenseNumber,
        creditLimit: dto.creditLimit != null ? new Prisma.Decimal(dto.creditLimit) : undefined,
        creditUsed: new Prisma.Decimal(dto.creditUsed ?? 0),
        paymentTermsDays: dto.paymentTermsDays ?? 0,
        salesRepUserId: dto.salesRepUserId,
        primaryAddressLine1: dto.primaryAddressLine1,
        primaryCity: dto.primaryCity,
        primaryState: dto.primaryState,
        primaryZip: dto.primaryZip,
      },
    })
  }

  async importBulk(tenantId: string, rows: CreateCustomerDto[]) {
    let created = 0
    const errors: Array<{ row: number; message: string }> = []
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const rowNum = index + 2
      if (!row.name?.trim()) {
        errors.push({ row: rowNum, message: 'name is required' })
        continue
      }
      try {
        await this.create(tenantId, row)
        created++
      } catch (e) {
        errors.push({
          row: rowNum,
          message: e instanceof Error ? e.message : 'Could not create customer',
        })
      }
    }
    return { created, failed: errors.length, errors }
  }

  async patch(tenantId: string, id: string, dto: PatchCustomerDto) {
    await this.get(tenantId, id)
    const data: Prisma.CustomerUpdateInput = {}
    if (dto.name != null) data.name = dto.name
    if (dto.email !== undefined) data.email = dto.email
    if (dto.phone !== undefined) data.phone = dto.phone
    if (dto.externalRef !== undefined) data.externalRef = dto.externalRef
    if (dto.customerKind != null) data.customerKind = dto.customerKind
    if (dto.firstName !== undefined) data.firstName = dto.firstName
    if (dto.lastName !== undefined) data.lastName = dto.lastName
    if (dto.taxId !== undefined) data.taxId = dto.taxId
    if (dto.isLicensedTobacco != null) data.isLicensedTobacco = dto.isLicensedTobacco
    if (dto.tobaccoLicenseNumber !== undefined) data.tobaccoLicenseNumber = dto.tobaccoLicenseNumber
    if (dto.creditLimit !== undefined) data.creditLimit = dto.creditLimit == null ? null : dec(dto.creditLimit)
    if (dto.creditUsed !== undefined) data.creditUsed = new Prisma.Decimal(dto.creditUsed)
    if (dto.paymentTermsDays != null) data.paymentTermsDays = dto.paymentTermsDays
    if (dto.salesRepUserId !== undefined) data.salesRepUserId = dto.salesRepUserId
    if (dto.primaryAddressLine1 !== undefined) data.primaryAddressLine1 = dto.primaryAddressLine1
    if (dto.primaryCity !== undefined) data.primaryCity = dto.primaryCity
    if (dto.primaryState !== undefined) data.primaryState = dto.primaryState
    if (dto.primaryZip !== undefined) data.primaryZip = dto.primaryZip
    return this.prisma.customer.update({
      where: { id },
      data,
    })
  }
}
