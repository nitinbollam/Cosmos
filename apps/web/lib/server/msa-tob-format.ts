/** MSA TOB fixed-width export (HID / BID / SID / PUR / TOT) — matches distributor .tob layout. */

export type TobCompanyProfile = {
  reporterNumber: string
  companyName: string
  addressLine1: string
  city: string
  state: string
  zip: string
  country?: string
  contactLast?: string
  contactFirst?: string
  phone?: string
  fax?: string
  email?: string
}

export type TobBidRow = {
  upc: string
  itemNo: string
  description: string
  onHand: number
  category?: string
  salesQty?: number
  field6?: number
}

export type TobStoreRow = {
  storeId: string
  name: string
  addressLine1: string
  city: string
  state: string
  zip: string
  country?: string
  phone?: string
}

export type TobPurchaseRow = {
  storeId: string
  itemNo: string
  orderNumber: string
  transactionDate: string
  quantity: number
  lineAmount: number
}

export type TobBuildInput = {
  profile: TobCompanyProfile
  weekEnding: string
  bids: TobBidRow[]
  stores: TobStoreRow[]
  purchases: TobPurchaseRow[]
}

export function padRight(value: string, width: number): string {
  const v = value ?? ''
  return v.length >= width ? v.slice(0, width) : v + ' '.repeat(width - v.length)
}

export function padLeft(value: string, width: number, char = '0'): string {
  const v = (value ?? '').replace(/\s/g, '')
  return v.length >= width ? v.slice(-width) : char.repeat(width - v.length) + v
}

export function formatMoney(value: number, intWidth: number, decWidth = 2): string {
  const n = Number.isFinite(value) ? Math.max(0, value) : 0
  const [whole, frac = ''] = n.toFixed(decWidth).split('.')
  return `${padLeft(whole, intWidth)}.${frac.padEnd(decWidth, '0').slice(0, decWidth)}`
}

export function formatYmd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

export function buildHidLine(profile: TobCompanyProfile, weekEnding: string): string {
  const line =
    'HID' +
    padLeft(profile.reporterNumber.replace(/\D/g, ''), 8) +
    'TOB  W' +
    padLeft(weekEnding.replace(/\D/g, ''), 8) +
    padRight(profile.companyName.toUpperCase(), 40) +
    padRight(profile.addressLine1.toUpperCase(), 90) +
    padRight(profile.city.toUpperCase(), 25) +
    padRight(profile.state.toUpperCase(), 2) +
    padLeft(profile.zip.replace(/\D/g, ''), 10, '0') +
    padRight((profile.country ?? 'USA').toUpperCase(), 3) +
    padRight((profile.contactLast ?? '').toUpperCase(), 25) +
    padRight((profile.contactFirst ?? '').toUpperCase(), 25) +
    padLeft(profile.phone?.replace(/\D/g, '') ?? '', 13) +
    padLeft(profile.fax?.replace(/\D/g, '') ?? '', 13) +
    padRight((profile.email ?? '').toLowerCase(), 60) +
    padLeft(weekEnding.replace(/\D/g, ''), 8) +
    '01'
  return padRight(line, 337)
}

export function buildBidLine(row: TobBidRow): string {
  const upc = padLeft(row.upc.replace(/\D/g, ''), 12)
  const itemNo = padLeft(row.itemNo.replace(/\D/g, ''), 4).slice(-4)
  const desc = padRight(row.description.toUpperCase(), 60)
  const onHand = padLeft(String(Math.max(0, Math.round(row.onHand))), 6)
  const category = padLeft((row.category ?? '003211').replace(/\D/g, ''), 6).slice(-6)
  const sales = formatMoney(row.salesQty ?? 0, 11, 2)
  const field6 = formatMoney(row.field6 ?? 0, 11, 2)
  const line =
    `BID  ${upc}          ${itemNo}${desc}` +
    `${onHand}N      ${category}                          S` +
    `${' '.repeat(70)}${sales}${field6}`
  return padRight(line, 275)
}

export function buildSidLine(store: TobStoreRow): string {
  const storeKey = padRight(store.storeId, 8)
  const name = padRight(store.name.toUpperCase(), 40)
  const addr = padRight(store.addressLine1.toUpperCase(), 90)
  const city = padRight(store.city.toUpperCase(), 25)
  const state = padRight(store.state.toUpperCase(), 2)
  const zip = padLeft(store.zip.replace(/\D/g, ''), 10, '0')
  const country = padRight((store.country ?? 'USA').toUpperCase(), 3)
  const phone = padLeft(store.phone?.replace(/\D/g, '') ?? '', 10)
  const left =
    `SID${storeKey}${padRight(store.storeId, 8)}${name}${addr}${city}${state}${zip}${country}   ${phone}Retailer                   Y                   ${padRight(store.storeId, 8)}`
  const right =
    `${padRight(store.name.toUpperCase(), 32)}${padRight(store.addressLine1.toUpperCase(), 90)}${city}${state}${zip}${country}     ${phone}               Y`
  return padRight(left + right, 550)
}

export function buildPurRow(row: TobPurchaseRow): string {
  const head =
    'PUR' +
    padRight(row.storeId, 8) +
    padRight(row.storeId, 8) +
    padRight('', 24) +
    padRight(row.itemNo.replace(/\D/g, ''), 5) +
    '   ' +
    padRight(row.orderNumber, 20) +
    padRight('', 15) +
    padLeft(row.transactionDate.replace(/\D/g, ''), 8) +
    padRight('', 20)
  const tail =
    `001${formatMoney(row.quantity, 8, 2)}` +
    `002${formatMoney(row.lineAmount, 11, 2)}` +
    `0040000000.00` +
    `0050000000.00` +
    `0060000000.00`
  return padRight(padRight(head, 94) + tail, 158)
}

export function buildTotLine(input: {
  profile: TobCompanyProfile
  weekEnding: string
  bidCount: number
  sidCount: number
  purCount: number
  totalPurchases: number
  totalSalesAmount: number
}): string {
  const line =
    'TOT' +
    padLeft(input.profile.reporterNumber.replace(/\D/g, ''), 8) +
    padLeft(input.weekEnding.replace(/\D/g, ''), 8) +
    formatMoney(input.bidCount, 4, 3) +
    formatMoney(input.sidCount, 4, 3) +
    formatMoney(input.purCount, 4, 2) +
    `${' '.repeat(40)}001${formatMoney(input.purCount, 11, 2)}002${formatMoney(input.totalPurchases, 11, 2)}003${formatMoney(input.totalSalesAmount, 11, 2)}0040000000000.0000500000000.0000600000000.00`
  return padRight(line, 194)
}

export function buildTobFile(input: TobBuildInput): string {
  const weekEnding = input.weekEnding.replace(/\D/g, '')
  const lines: string[] = [buildHidLine(input.profile, weekEnding)]
  for (const bid of input.bids) lines.push(buildBidLine(bid))
  for (const store of input.stores) lines.push(buildSidLine(store))
  for (const purchase of input.purchases) lines.push(buildPurRow(purchase))

  const totalPurchases = input.purchases.reduce((s, p) => s + p.lineAmount, 0)
  const totalSalesAmount = input.bids.reduce((s, b) => s + (b.salesQty ?? 0), 0)
  lines.push(
    buildTotLine({
      profile: input.profile,
      weekEnding,
      bidCount: input.bids.length,
      sidCount: input.stores.length,
      purCount: input.purchases.length,
      totalPurchases,
      totalSalesAmount,
    }),
  )
  return lines.join('\n') + '\n'
}

export function suggestTobFileName(weekEnding: Date, generatedAt = new Date()): string {
  const gen = `${generatedAt.getUTCFullYear()}-${String(generatedAt.getUTCMonth() + 1).padStart(2, '0')}-${String(generatedAt.getUTCDate()).padStart(2, '0')}`
  const end = `${weekEnding.getUTCFullYear()}-${String(weekEnding.getUTCMonth() + 1).padStart(2, '0')}-${String(weekEnding.getUTCDate()).padStart(2, '0')}`
  return `${gen}_${end}.tob`
}
