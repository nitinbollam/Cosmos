import { closeExpiredAuctions } from './marketplace-auctions'
import { releaseDueMarketplaceEscrows } from './marketplace-orders'

export type MarketplaceJobResult = {
  auctionsClosed: number
  escrowsReleased: number
}

/** Background sweep — close expired auctions and release due escrows. */
export async function runMarketplaceJobs(): Promise<MarketplaceJobResult> {
  const auctionsClosed = await closeExpiredAuctions()
  const escrowsReleased = await releaseDueMarketplaceEscrows()
  return { auctionsClosed, escrowsReleased }
}
