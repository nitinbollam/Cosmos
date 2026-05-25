import { assertFinite, mean } from './stats'

export type CashflowPoint = {
  period: string
  inflow: number
  outflow: number
}

export type ForecastRequest = {
  tenant_id: string
  history: CashflowPoint[]
  horizon_weeks?: number
  seasonal_period?: number | null
}

export type ForecastBucket = {
  label: string
  projected_net: number
  projected_inflow: number
  projected_outflow: number
}

export type ForecastResponse = {
  tenant_id: string
  method: string
  weekly_net_baseline: number
  forecast: ForecastBucket[]
  warnings: string[]
}

function ewma(values: number[], alpha: number): number {
  if (values.length === 0) return 0
  let w = values[0]!
  for (let i = 1; i < values.length; i++) {
    w = alpha * values[i]! + (1 - alpha) * w
  }
  return w
}

function seasonalDeseasonalize(net: number[], period: number): number[] {
  if (period < 2 || net.length < period * 2) return [...net]
  const out = net.map((v) => v)
  const overall = mean(net) || 1
  for (let i = 0; i < net.length; i++) {
    const idx: number[] = []
    for (let j = i % period; j < net.length; j += period) idx.push(j)
    const seasonMean = idx.length ? mean(idx.map((j) => net[j]!)) : 0
    out[i] = net[i]! * (overall / Math.max(seasonMean, 1e-6))
  }
  return out
}

export function forecastCashFlow(body: ForecastRequest): ForecastResponse {
  if (body.history.length < 3) {
    throw new Error('history must contain at least 3 points')
  }

  const horizonWeeks = body.horizon_weeks ?? 8
  if (horizonWeeks < 1 || horizonWeeks > 52) {
    throw new Error('horizon_weeks must be between 1 and 52')
  }

  const warns: string[] = []
  const net = body.history.map((p) => p.inflow - p.outflow)
  assertFinite(net, 'history')

  let series = net
  const methodBits = ['net_ewma']
  if (body.seasonal_period && body.seasonal_period >= 2) {
    series = seasonalDeseasonalize(net, body.seasonal_period)
    methodBits.push(`seasonal_${body.seasonal_period}`)
  }

  const alpha = Math.max(0.05, Math.min(0.55, 2 / (1 + series.length)))
  const baseline = ewma(series, alpha)

  const avgIn = mean(body.history.map((p) => p.inflow))
  const avgOut = mean(body.history.map((p) => p.outflow))
  if (avgIn < avgOut) {
    warns.push('Historical net cashflow negative on average.')
  }

  const buckets: ForecastBucket[] = []
  let lastNet = series.length ? series[series.length - 1]! : 0

  for (let h = 1; h <= horizonWeeks; h++) {
    lastNet = baseline + (lastNet - baseline) * 0.88
    const n = lastNet
    let pfIn: number
    let pfOut: number
    if (avgIn <= 1e-9) {
      pfIn = 0
      pfOut = Math.max(-n, 0)
    } else {
      const m = Math.max(0, (n + avgOut) / avgIn)
      pfIn = m * avgIn
      pfOut = avgOut
    }
    buckets.push({
      label: `W+${h}`,
      projected_net: pfIn - pfOut,
      projected_inflow: pfIn,
      projected_outflow: pfOut,
    })
  }

  return {
    tenant_id: body.tenant_id,
    method: methodBits.join('+'),
    weekly_net_baseline: baseline,
    forecast: buckets,
    warnings: warns,
  }
}
