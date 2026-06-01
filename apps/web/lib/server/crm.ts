import { Prisma } from '@/generated/prisma-crm'
import { crmDb } from './db'
import { ApiError } from './session'

export const LEAD_KANBAN_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const

function dec(n: number | undefined | null) {
  if (n == null) return undefined
  return new Prisma.Decimal(n)
}

export function listCustomers(tenantId: string) {
  return crmDb.customer.findMany({ where: { tenantId }, orderBy: { name: 'asc' } })
}

export async function getCustomer(tenantId: string, id: string) {
  const row = await crmDb.customer.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Customer not found')
  return row
}

export function findCustomerByExternalRef(tenantId: string, externalRef: string) {
  return crmDb.customer.findFirst({ where: { tenantId, externalRef } })
}

export function findCustomerByEmail(tenantId: string, email: string) {
  return crmDb.customer.findFirst({
    where: { tenantId, email: { equals: email.trim() } },
  })
}

export function createCustomer(tenantId: string, dto: Record<string, unknown>) {
  return crmDb.customer.create({
    data: {
      tenantId,
      name: String(dto.name ?? ''),
      email: dto.email != null ? String(dto.email) : undefined,
      phone: dto.phone != null ? String(dto.phone) : undefined,
      externalRef: dto.externalRef != null ? String(dto.externalRef) : undefined,
      customerKind: dto.customerKind != null ? String(dto.customerKind) : 'BUSINESS',
      firstName: dto.firstName != null ? String(dto.firstName) : undefined,
      lastName: dto.lastName != null ? String(dto.lastName) : undefined,
      taxId: dto.taxId != null ? String(dto.taxId) : undefined,
      isLicensedTobacco: Boolean(dto.isLicensedTobacco),
      tobaccoLicenseNumber: dto.tobaccoLicenseNumber != null ? String(dto.tobaccoLicenseNumber) : undefined,
      creditLimit: dto.creditLimit != null ? dec(Number(dto.creditLimit)) : undefined,
      creditUsed: new Prisma.Decimal(Number(dto.creditUsed ?? 0)),
      paymentTermsDays: Number(dto.paymentTermsDays ?? 0),
      salesRepUserId: dto.salesRepUserId != null ? String(dto.salesRepUserId) : undefined,
      primaryAddressLine1: dto.primaryAddressLine1 != null ? String(dto.primaryAddressLine1) : undefined,
      primaryCity: dto.primaryCity != null ? String(dto.primaryCity) : undefined,
      primaryState: dto.primaryState != null ? String(dto.primaryState) : undefined,
      primaryZip: dto.primaryZip != null ? String(dto.primaryZip) : undefined,
    },
  })
}

export async function importCustomers(tenantId: string, rows: Record<string, unknown>[]) {
  let created = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNum = index + 2
    if (!String(row.name ?? '').trim()) {
      errors.push({ row: rowNum, message: 'name is required' })
      continue
    }
    try {
      await createCustomer(tenantId, row)
      created++
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Could not create customer' })
    }
  }
  return { created, failed: errors.length, errors }
}

export async function patchCustomer(tenantId: string, id: string, dto: Record<string, unknown>) {
  await getCustomer(tenantId, id)
  const data: Prisma.CustomerUpdateInput = {}
  if (dto.name != null) data.name = String(dto.name)
  if (dto.email !== undefined) data.email = dto.email != null ? String(dto.email) : null
  if (dto.phone !== undefined) data.phone = dto.phone != null ? String(dto.phone) : null
  if (dto.externalRef !== undefined) data.externalRef = dto.externalRef != null ? String(dto.externalRef) : null
  if (dto.creditLimit !== undefined) {
    data.creditLimit = dto.creditLimit == null ? null : dec(Number(dto.creditLimit))
  }
  if (dto.creditUsed !== undefined) data.creditUsed = new Prisma.Decimal(Number(dto.creditUsed))
  return crmDb.customer.update({ where: { id }, data })
}

export async function patchCustomerProfile(
  tenantId: string,
  customerId: string,
  dto: {
    phone?: string | null
    primaryAddressLine1?: string | null
    primaryCity?: string | null
    primaryState?: string | null
    primaryZip?: string | null
  },
) {
  await getCustomer(tenantId, customerId)
  const data: Prisma.CustomerUpdateInput = {}
  if (dto.phone !== undefined) data.phone = dto.phone
  if (dto.primaryAddressLine1 !== undefined) data.primaryAddressLine1 = dto.primaryAddressLine1
  if (dto.primaryCity !== undefined) data.primaryCity = dto.primaryCity
  if (dto.primaryState !== undefined) data.primaryState = dto.primaryState
  if (dto.primaryZip !== undefined) data.primaryZip = dto.primaryZip
  return crmDb.customer.update({ where: { id: customerId }, data })
}

export function listLeads(tenantId: string) {
  return crmDb.lead.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { customer: true },
  })
}

export async function getLead(tenantId: string, id: string) {
  const row = await crmDb.lead.findFirst({
    where: { id, tenantId },
    include: { customer: true, activities: true },
  })
  if (!row) throw new ApiError(404, 'Lead not found')
  return row
}

export function createLead(tenantId: string, dto: Record<string, unknown>) {
  return crmDb.lead.create({
    data: {
      tenantId,
      companyName: String(dto.companyName ?? ''),
      contactName: dto.contactName != null ? String(dto.contactName) : undefined,
      email: dto.email != null ? String(dto.email) : undefined,
      source: dto.source != null ? String(dto.source) : undefined,
      pipelineValue:
        dto.pipelineValue != null && dto.pipelineValue !== ''
          ? new Prisma.Decimal(Number(dto.pipelineValue))
          : undefined,
      assignedToUserId: dto.assignedToUserId != null ? String(dto.assignedToUserId) : undefined,
      status: 'NEW',
    },
  })
}

export async function importLeads(tenantId: string, rows: Record<string, unknown>[]) {
  let created = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNum = index + 2
    if (!String(row.companyName ?? '').trim()) {
      errors.push({ row: rowNum, message: 'companyName is required' })
      continue
    }
    const status = row.status != null ? String(row.status) : 'NEW'
    if (!LEAD_KANBAN_STATUSES.includes(status as (typeof LEAD_KANBAN_STATUSES)[number])) {
      errors.push({ row: rowNum, message: 'Invalid status' })
      continue
    }
    try {
      await crmDb.lead.create({
        data: {
          tenantId,
          companyName: String(row.companyName).trim(),
          contactName: row.contactName != null ? String(row.contactName) : undefined,
          email: row.email != null ? String(row.email) : undefined,
          source: row.source != null ? String(row.source) : undefined,
          pipelineValue:
            row.pipelineValue != null ? new Prisma.Decimal(Number(row.pipelineValue)) : undefined,
          assignedToUserId: row.assignedToUserId != null ? String(row.assignedToUserId) : undefined,
          status,
        },
      })
      created++
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Could not create lead' })
    }
  }
  return { created, failed: errors.length, errors }
}

export async function patchLead(tenantId: string, id: string, dto: Record<string, unknown>) {
  await getLead(tenantId, id)
  const data: Prisma.LeadUpdateInput = {}
  if (dto.status != null) {
    const st = String(dto.status)
    if (!LEAD_KANBAN_STATUSES.includes(st as (typeof LEAD_KANBAN_STATUSES)[number])) {
      throw new ApiError(400, 'Invalid status')
    }
    data.status = st
  }
  if (dto.companyName != null) data.companyName = String(dto.companyName)
  if (dto.contactName !== undefined) data.contactName = dto.contactName != null ? String(dto.contactName) : null
  if (dto.email !== undefined) data.email = dto.email != null ? String(dto.email) : null
  if (Object.keys(data).length === 0) return getLead(tenantId, id)
  return crmDb.lead.update({ where: { id }, data, include: { customer: true } })
}

export async function convertLead(tenantId: string, id: string, customerName: string) {
  const lead = await getLead(tenantId, id)
  if (lead.status === 'WON' || lead.status === 'LOST') throw new ApiError(400, 'Cannot convert a closed lead')
  if (lead.customerId) throw new ApiError(400, 'Lead already linked to a customer')
  return crmDb.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        tenantId,
        name: customerName,
        email: lead.email ?? undefined,
        externalRef: `lead:${lead.id}`,
      },
    })
    return tx.lead.update({
      where: { id },
      data: { status: 'WON', customerId: customer.id },
      include: { customer: true },
    })
  })
}

export function listActivities(tenantId: string, customerId?: string, leadId?: string) {
  return crmDb.activity.findMany({
    where: {
      tenantId,
      ...(customerId ? { customerId } : {}),
      ...(leadId ? { leadId } : {}),
    },
    orderBy: { occurredAt: 'desc' },
  })
}

export async function createActivity(tenantId: string, dto: Record<string, unknown>) {
  if (!dto.customerId && !dto.leadId) throw new ApiError(400, 'customerId or leadId required')
  if (dto.customerId) {
    const c = await crmDb.customer.findFirst({ where: { id: String(dto.customerId), tenantId } })
    if (!c) throw new ApiError(400, 'Invalid customerId')
  }
  if (dto.leadId) {
    const l = await crmDb.lead.findFirst({ where: { id: String(dto.leadId), tenantId } })
    if (!l) throw new ApiError(400, 'Invalid leadId')
  }
  return crmDb.activity.create({
    data: {
      tenantId,
      type: String(dto.type ?? 'NOTE') as 'CALL' | 'EMAIL' | 'NOTE',
      subject: dto.subject != null ? String(dto.subject) : undefined,
      body: dto.body != null ? String(dto.body) : undefined,
      outcome: dto.outcome != null ? String(dto.outcome) : undefined,
      customerId: dto.customerId != null ? String(dto.customerId) : undefined,
      leadId: dto.leadId != null ? String(dto.leadId) : undefined,
    },
  })
}
