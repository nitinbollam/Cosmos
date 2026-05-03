import { NextResponse } from 'next/server'

/** Server-side proxy so the browser is not blocked by CORS when calling the Python cashflow service. */
export async function POST(req: Request) {
  const base = process.env.CASHFLOW_SERVICE_URL?.replace(/\/$/, '') ?? 'http://localhost:8004'
  const body = await req.text()
  try {
    const r = await fetch(`${base}/forecast/cash-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await r.text()
    if (!r.ok) {
      return NextResponse.json({ message: text || r.statusText }, { status: r.status })
    }
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cashflow proxy failed'
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}
