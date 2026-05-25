import { forecastCashFlow, type ForecastRequest } from '@cosmos/analytics-engine'
import { NextResponse } from 'next/server'

/** Native TypeScript cashflow forecast — no Python sidecar required. */
export async function POST(req: Request) {
  let body: ForecastRequest
  try {
    body = (await req.json()) as ForecastRequest
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = forecastCashFlow(body)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cashflow forecast failed'
    const status = msg.includes('must contain') || msg.includes('between') ? 400 : 500
    return NextResponse.json({ message: msg }, { status })
  }
}
