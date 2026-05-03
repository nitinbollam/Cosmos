import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

export interface LabelStubResult {
  trackingNum: string
  labelUrl: string
}

/** Placeholder until carrier APIs (UPS/FedEx) are configured. */
@Injectable()
export class ShippingLabelService {
  issueLabel(_carrier: string, _serviceLevel?: string): LabelStubResult {
    const trackingNum = `COSMOS-${randomUUID().slice(0, 8).toUpperCase()}`
    return {
      trackingNum,
      labelUrl: `https://labels.cosmos.local/stub/${trackingNum}.pdf`,
    }
  }
}
