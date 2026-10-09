import { requireSystemJobToken } from '../system-job-auth'
import { fetchAndCacheDailyRates } from '../exchange-rates'
import { ApiError } from '../session'

export async function routeSystemJobs(method: string, seg: string[], req: Request): Promise<Response> {
  requireSystemJobToken(req)

  if (seg.length === 2 && seg[1] === 'exchange-rates' && method === 'POST') {
    return Response.json(await fetchAndCacheDailyRates())
  }

  throw new ApiError(404, 'System job route not found')
}
