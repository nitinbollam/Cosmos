import { HttpService } from '@nestjs/axios'
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { isAxiosError } from 'axios'
import { firstValueFrom } from 'rxjs'
import type { B2BQuote, QuoteLine } from '../generated/prisma-client'

type QuoteWithLines = B2BQuote & { lines: QuoteLine[] }

@Injectable()
export class QuoteToOrderBridge {
  private readonly logger = new Logger(QuoteToOrderBridge.name)

  constructor(private readonly http: HttpService) {}

  async createOrderFromOpenQuote(q: QuoteWithLines, authorization: string): Promise<string> {
    const inventoryBase = `${process.env.INVENTORY_SERVICE_URL?.replace(/\/$/, '')}/api/v1`
    const orderBase = `${process.env.ORDER_SERVICE_URL?.replace(/\/$/, '')}/api/v1`
    const crmBase = `${process.env.CRM_SERVICE_URL?.replace(/\/$/, '')}/api/v1`

    if (!process.env.ORDER_SERVICE_URL?.trim() || !process.env.INVENTORY_SERVICE_URL?.trim() || !process.env.CRM_SERVICE_URL?.trim()) {
      throw new ServiceUnavailableException(
        'Quote→order automation requires ORDER_SERVICE_URL, INVENTORY_SERVICE_URL, CRM_SERVICE_URL',
      )
    }

    const hdrs = {
      Authorization: authorization,
      'Content-Type': 'application/json',
    }

    try {
      const customerId = await this.resolveCustomerId(crmBase, hdrs, q.customerRef)

      const { data: whList } = await firstValueFrom(
        this.http.get<unknown[]>(`${inventoryBase}/warehouses`, { headers: hdrs, timeout: 20_000 }),
      )
      if (!Array.isArray(whList) || whList.length === 0) {
        throw new BadRequestException(
          'No warehouses found for tenant — create a warehouse before submitting quotes.',
        )
      }
      const defaultWh =
        (whList.find((w) => (w as { isDefault?: boolean }).isDefault) as { id?: string }) ?? whList[0]
      const warehouseId =
        typeof (defaultWh as { id?: string }).id === 'string' ? (defaultWh as { id: string }).id : ''
      if (!warehouseId) {
        throw new BadRequestException('Could not infer default warehouse id')
      }

      const lineItems: { skuId: string; warehouseId: string; quantity: number; unitPrice: number }[] = []

      for (const line of [...q.lines].sort((a, b) => a.lineNo - b.lineNo)) {
        const skuCode = line.skuCode?.trim()
        if (!skuCode) {
          throw new BadRequestException(
            `Quote line ${line.lineNo}: skuCode is required to create an inventory-backed order.`,
          )
        }

        const { data: sku } = await firstValueFrom(
          this.http.get<{ id: string }>(`${inventoryBase}/skus/lookup/by-code`, {
            headers: hdrs,
            params: { code: skuCode },
            timeout: 20_000,
          }),
        )
        lineItems.push({
          skuId: sku.id,
          warehouseId,
          quantity: line.qty,
          unitPrice: Number(line.unitPrice),
        })
      }

      const payload = {
        customerId,
        channel: 'B2B_PORTAL',
        paymentMethod: 'NET_TERMS',
        lineItems,
        priority: 'NORMAL',
        notes: q.notes
          ? `${q.notes}\n\nConverted from B2B quote ${q.id}.`
          : `Converted from B2B quote ${q.id}.`,
      }

      const { data: order } = await firstValueFrom(
        this.http.post<{ id: string }>(`${orderBase}/orders`, payload, { headers: hdrs, timeout: 30_000 }),
      )
      const orderId = order?.id
      if (!orderId) throw new BadRequestException('order-service returned no order id')
      return orderId
    } catch (e) {
      if (isAxiosError(e)) {
        const body = e.response?.data as { message?: unknown; errors?: unknown } | undefined
        const msg =
          typeof body?.message === 'string'
            ? body.message
            : Array.isArray(body?.errors)
              ? JSON.stringify(body?.errors)
              : e.response?.status
                ? `HTTP ${e.response.status}`
                : e.message
        this.logger.warn({ quoteId: q.id, tenantId: q.tenantId, msg }, 'quote→order downstream failed')
        throw new BadRequestException(msg || 'Quote conversion failed downstream')
      }
      throw e
    }
  }

  private async resolveCustomerId(base: string, hdrs: Record<string, string>, customerRef: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ id: string } | null>(`${base}/customers/lookup`, {
          headers: hdrs,
          params: { externalRef: customerRef.trim() },
          timeout: 15_000,
        }),
      )
      if (data?.id) return data.id
    } catch {
      /* lookup miss or transient — upsert stub */
    }

    const { data: created } = await firstValueFrom(
      this.http.post<{ id: string }>(
        `${base}/customers`,
        {
          name: customerRef,
          externalRef: customerRef,
        },
        { headers: hdrs, timeout: 15_000 },
      ),
    )
    if (!created?.id) throw new BadRequestException('Could not upsert CRM customer')
    return created.id
  }
}
