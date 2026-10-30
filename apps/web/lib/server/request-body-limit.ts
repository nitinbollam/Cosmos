/**
 * How large an API request body may be. The server reads the whole body into memory before it
 * checks who is calling, so the limit is enforced first — on the declared size, and again while
 * the bytes arrive — and anything over it is answered 413 without being read further.
 */

/** Ordinary JSON requests: forms, orders, settings. */
export const DEFAULT_BODY_LIMIT_BYTES = 2 * 1024 * 1024

/** Requests that carry a file or bulk rows (see LARGE_BODY_ROUTES). */
export const LARGE_BODY_LIMIT_BYTES = 8 * 1024 * 1024

/** POST routes (after /api/v1) that legitimately need more than the default. */
const LARGE_BODY_ROUTES: RegExp[] = [
  /^\/dispatch\/stops\/[^/]+\/pod$/, // proof of delivery: photo + signature, each up to ~3 MB
  /^\/marketplace\/uploads$/, // listing photo, up to 5 MB, sent as base64
  /^\/expense-reports\/receipts$/, // receipt, up to 5 MB, sent as base64
  /^\/(customers|leads|skus)\/import$/, // spreadsheet imports
  /^\/bank-accounts\/[^/]+\/import$/, // bank statement lines
  /^\/bank-reconciliations\/[^/]+\/import-csv$/, // bank statement CSV
  /^\/wms\/receiving\/(sessions\/)?[^/]+\/import$/, // receiving scans
  /^\/wms\/cycle-counts\/[^/]+\/lines\/import$/, // cycle count lines
  /^\/msa\/transactions\/import$/, // MSA transactions
]

export function maxRequestBodyBytes(method: string, path: string): number {
  if (method.toUpperCase() !== 'POST') return DEFAULT_BODY_LIMIT_BYTES
  const route = path.replace(/^\/api\/v1(?=\/)/, '').replace(/\/+$/, '')
  return LARGE_BODY_ROUTES.some((r) => r.test(route)) ? LARGE_BODY_LIMIT_BYTES : DEFAULT_BODY_LIMIT_BYTES
}
