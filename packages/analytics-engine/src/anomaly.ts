import { assertFinite, mean, median, quantile } from './stats'

export type SeriesPoint = {
  timestamp: string
  value: number
}

export type DetectRequest = {
  tenant_id: string
  metric: string
  points: SeriesPoint[]
  z_threshold?: number
  iqr_k?: number
}

export type AnomalyHit = {
  timestamp: string
  value: number
  score: number
  reason: string
}

export type DetectResponse = {
  tenant_id: string
  metric: string
  anomalies: AnomalyHit[]
  stats: Record<string, number>
}

export function detectSeriesAnomalies(body: DetectRequest): DetectResponse {
  if (body.points.length < 8) {
    throw new Error('points must contain at least 8 entries')
  }

  const zThreshold = body.z_threshold ?? 3.5
  const iqrK = body.iqr_k ?? 1.5
  const vals = body.points.map((p) => p.value)
  assertFinite(vals, 'series')

  const med = median(vals)
  const q1 = quantile(vals, 0.25)
  const q3 = quantile(vals, 0.75)
  const iqr = Math.max(q3 - q1, 1e-9)
  const hiFence = q3 + iqrK * iqr
  const loFence = q1 - iqrK * iqr

  const dev = vals.map((v) => v - med)
  const mad = median(dev.map(Math.abs)) + 1e-9
  const robustStd = 1.4826 * mad
  const meanVal = mean(vals)

  const anomalies: AnomalyHit[] = []
  for (const p of body.points) {
    const v = p.value
    const reasons: string[] = []
    const z = Math.abs(v - med) / Math.max(robustStd, 1e-9)
    if (z >= zThreshold) {
      reasons.push(`robust_z>=${zThreshold.toFixed(2)}`)
    }
    if (v > hiFence || v < loFence) {
      reasons.push('tukey_iqr')
    }
    if (reasons.length) {
      anomalies.push({
        timestamp: p.timestamp,
        value: v,
        score: z,
        reason: reasons.join(','),
      })
    }
  }

  return {
    tenant_id: body.tenant_id,
    metric: body.metric,
    anomalies,
    stats: {
      median: med,
      mean: meanVal,
      q1,
      q3,
      iqr,
      mad,
      robust_std: robustStd,
    },
  }
}
