import { assertFinite, mean } from './stats'

export type DemandPoint = {
  date: string
  quantity: number
}

export type DemandForecastRequest = {
  history: DemandPoint[]
  leadTimeDays?: number
  safetyStock?: number
  horizonDays?: number
  seasonalPeriod?: number | null
}

export type DemandForecastResponse = {
  method: string
  avgDailyUsage: number
  ewmaDailyUsage: number
  forecastDaily: number[]
  suggestedCoverQty: number
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

function seasonalDeseasonalize(values: number[], period: number): number[] {
  if (period < 2 || values.length < period * 2) return [...values]
  const out = values.map((v) => v)
  const overall = mean(values) || 1
  for (let i = 0; i < values.length; i++) {
    const idx: number[] = []
    for (let j = i % period; j < values.length; j += period) idx.push(j)
    const seasonMean = idx.length ? mean(idx.map((j) => values[j]!)) : 0
    out[i] = values[i]! * (overall / Math.max(seasonMean, 1e-6))
  }
  return out
}

/** EWMA daily usage forecast for replenishment (pure; no DB). */
export function forecastDemandUsage(body: DemandForecastRequest): DemandForecastResponse {
  const leadTimeDays = body.leadTimeDays ?? 7
  const safetyStock = body.safetyStock ?? 0
  const horizonDays = body.horizonDays ?? Math.max(leadTimeDays, 7)
  const warnings: string[] = []

  if (leadTimeDays < 0 || leadTimeDays > 365) {
    throw new Error('leadTimeDays must be between 0 and 365')
  }
  if (horizonDays < 1 || horizonDays > 365) {
    throw new Error('horizonDays must be between 1 and 365')
  }

  const quantities = body.history.map((p) => Math.max(0, Number(p.quantity) || 0))
  assertFinite(quantities, 'history')

  if (quantities.length === 0 || quantities.every((q) => q <= 0)) {
    return {
      method: 'STATIC_REORDER',
      avgDailyUsage: 0,
      ewmaDailyUsage: 0,
      forecastDaily: Array.from({ length: horizonDays }, () => 0),
      suggestedCoverQty: Math.ceil(safetyStock),
      warnings: ['No outbound usage in sample window.'],
    }
  }

  let series = quantities
  const methodBits = ['USAGE_EWMA']
  const seasonalPeriod = body.seasonalPeriod
  if (seasonalPeriod && seasonalPeriod >= 2 && series.length >= seasonalPeriod * 2) {
    series = seasonalDeseasonalize(quantities, seasonalPeriod)
    methodBits.push('SEASONAL')
  } else if (seasonalPeriod && seasonalPeriod >= 2) {
    warnings.push(`Seasonal period ${seasonalPeriod} needs at least ${seasonalPeriod * 2} days of history.`)
  }

  const alpha = Math.max(0.05, Math.min(0.55, 2 / (1 + series.length)))
  const ewmaDailyUsage = ewma(series, alpha)
  const avgDailyUsage = mean(quantities)

  if (ewmaDailyUsage < avgDailyUsage * 0.35 && avgDailyUsage > 0) {
    warnings.push('Recent usage is well below the period average — forecast may understate demand.')
  }

  const forecastDaily: number[] = []
  let last = ewmaDailyUsage
  for (let d = 0; d < horizonDays; d++) {
    last = ewmaDailyUsage + (last - ewmaDailyUsage) * 0.92
    forecastDaily.push(Math.max(0, last))
  }

  const suggestedCoverQty = Math.ceil(ewmaDailyUsage * leadTimeDays + safetyStock)

  return {
    method: methodBits.join('_'),
    avgDailyUsage: Math.round(avgDailyUsage * 1000) / 1000,
    ewmaDailyUsage: Math.round(ewmaDailyUsage * 1000) / 1000,
    forecastDaily,
    suggestedCoverQty,
    warnings,
  }
}
