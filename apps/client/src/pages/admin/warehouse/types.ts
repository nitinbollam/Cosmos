export type Tab = 'picks' | 'waves' | 'bins' | 'receiving' | 'putaway' | 'labor' | 'counts'

export type PickWaveRow = {
  id: string
  warehouseId: string
  status: string
  createdBy: string
  createdAt: string
  tasks: { id: string; taskId: string }[]
}

export type BinRow = {
  id: string
  warehouseId: string
  code: string
  aisle?: string | null
  zone?: string | null
}

export type PickTask = {
  id: string
  orderId: string
  orderNumber?: number | null
  status: string
  priority: string
  warehouseCode: string
  warehouseId: string
  assignedUserId: string | null
  createdAt: string
  pickItems: { id: string; skuId: string; quantity: number; pickedQty: number; status: string }[]
}

export type WarehouseRow = { id: string; name: string; code: string }

export type ReceivingRow = {
  id: string
  warehouseId: string
  poId: string | null
  /** The PO's number, e.g. PO-1001, when the session is for a PO. */
  poNumber?: string | null
  status: string
  startedBy: string
  createdAt: string
  _count: { items: number }
}

export type ReceivingDetail = ReceivingRow & {
  items: Array<{
    id: string
    skuId: string
    skuCode?: string | null
    receivedQty: number
    damagedQty: number
    batchId: string | null
    barcode: string | null
  }>
}

export type CycleRow = {
  id: string
  warehouseId: string
  type: string
  status: string
  scheduledFor: string | null
  createdBy: string
  createdAt: string
  _count: { lines: number }
  varianceItemsCount?: number
}

export type CycleDetail = Omit<CycleRow, '_count'> & {
  lines: Array<{
    id: string
    skuId: string
    locationLabel: string | null
    /** Filled by the server for display; ids stay as the fallback. */
    skuCode?: string | null
    skuName?: string | null
    binCode?: string | null
    systemQty: number
    countedQty: number | null
  }>
}

export type PutawayTaskRow = {
  id: string
  warehouseId: string
  status: string
  receivingSessionId: string | null
  createdAt: string
  lines: Array<{
    id: string
    skuId: string
    batchId: string | null
    quantity: number
    suggestedBinCode: string | null
    actualBinCode: string | null
    status: string
  }>
}

export type LaborMetrics = {
  since: string
  totalEvents: number
  byUser: Array<{ userId: string; picks: number; receives: number; putaways: number; packs: number }>
}

export function pickProgress(task: PickTask) {
  const items = task.pickItems ?? []
  const total = items.length
  const picked = items.filter((i) => i.pickedQty >= i.quantity || i.status === 'PICKED' || i.status === 'SHORT').length
  return { picked, total }
}

export function priorityBorder(p: string): string {
  switch (p?.toUpperCase()) {
    case 'URGENT':
      return 'var(--c-danger)'
    case 'HIGH':
      return 'var(--c-warning)'
    case 'LOW':
      return 'var(--c-text-3)'
    default:
      return 'var(--c-primary)'
  }
}
