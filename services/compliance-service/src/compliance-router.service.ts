import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { ConfigService } from '@nestjs/config'

export type IndustryVertical =
  | 'TOBACCO_VAPE'
  | 'PHARMA'
  | 'FOOD_BEVERAGE'
  | 'ALCOHOL'
  | 'GENERAL_WHOLESALE'

export interface ComplianceReport {
  tenantId: string
  vertical: IndustryVertical
  reportType: string
  periodStart: Date
  periodEnd: Date
  status: 'GENERATED' | 'SUBMITTED' | 'SKIPPED'
  filePath?: string
  notes?: string
}

@Injectable()
export class ComplianceRouterService {
  private readonly logger = new Logger(ComplianceRouterService.name)

  constructor(
    private config: ConfigService,
    private http: HttpService,
  ) {}

  async getTenantVertical(tenantId: string): Promise<IndustryVertical> {
    const tenantUrl = this.config.get<string>('TENANT_SERVICE_URL') ?? 'http://localhost:3002'
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ industry?: IndustryVertical }>(`${tenantUrl}/api/v1/internal/tenants/${tenantId}`, {
          headers: {
            'x-cosmos-internal-key': this.config.get('INTERNAL_SERVICE_SECRET') ?? '',
            'x-cosmos-tenant-id': tenantId,
          },
        }),
      )
      return data.industry ?? 'GENERAL_WHOLESALE'
    } catch (err) {
      this.logger.warn(
        { tenantId, err: (err as Error).message },
        'could not fetch tenant vertical, defaulting to GENERAL_WHOLESALE',
      )
      return 'GENERAL_WHOLESALE'
    }
  }

  describeVertical(vertical: IndustryVertical): {
    label: string
    reportingRequired: boolean
    reportFrequency: string
  } {
    const MAP: Record<IndustryVertical, { label: string; reportingRequired: boolean; reportFrequency: string }> = {
      TOBACCO_VAPE: { label: 'Tobacco & Vape', reportingRequired: true, reportFrequency: 'weekly' },
      PHARMA: { label: 'Pharmaceutical', reportingRequired: true, reportFrequency: 'monthly' },
      FOOD_BEVERAGE: { label: 'Food & Beverage', reportingRequired: true, reportFrequency: 'quarterly' },
      ALCOHOL: { label: 'Alcohol Distribution', reportingRequired: true, reportFrequency: 'monthly' },
      GENERAL_WHOLESALE: { label: 'General Wholesale', reportingRequired: false, reportFrequency: 'none' },
    }
    return MAP[vertical]
  }
}
