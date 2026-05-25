import { detectSeriesAnomalies, type DetectRequest } from '@cosmos/analytics-engine'
import { NextResponse } from 'next/server'

/** Native TypeScript anomaly detection — replaces Python sidecar when needed. */
export async function POST(req: Request) {
  let body: DetectRequest
  try {
    body = (await req.json()) as DetectRequest
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = detectSeriesAnomalies(body)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'anomaly detection failed'
    const status = msg.includes('must contain') ? 400 : 500
    return NextResponse.json({ message: msg }, { status })
  }
}
