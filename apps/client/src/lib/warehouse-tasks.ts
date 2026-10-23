/**
 * Warehouse picking helpers for the mobile app (PLR-169). Pure, so each rule can be tested alone.
 */

export type PickItem = {
  id: string
  skuId: string
  skuCode?: string | null
  skuName?: string | null
  quantity: number
  pickedQty: number
  status: string
  binCode?: string | null
}

export type PickTask = {
  id: string
  orderId: string
  status: string
  priority?: string
  warehouseCode?: string
  assignedUserId?: string | null
  pickItems?: PickItem[]
}

export type TaskFilter = 'mine' | 'free' | 'all'

export const lineDone = (status: string) => status === 'PICKED' || status === 'SHORT'

export function filterQuery(filter: TaskFilter): string {
  return filter === 'mine' ? 'assigned=mine' : filter === 'free' ? 'assigned=unassigned' : ''
}

/** The line to work on next: the first one not done, in the order the server sent (walking order). */
export function nextLine(items: PickItem[]): PickItem | null {
  return items.find((i) => !lineDone(i.status)) ?? null
}

export function progress(items: PickItem[]): { done: number; total: number; units: number; unitsTotal: number } {
  return {
    done: items.filter((i) => lineDone(i.status)).length,
    total: items.length,
    units: items.reduce((s, i) => s + i.pickedQty, 0),
    unitsTotal: items.reduce((s, i) => s + i.quantity, 0),
  }
}

export type TaskOwner = 'mine' | 'free' | 'other'

export function ownerOf(task: Pick<PickTask, 'assignedUserId'>, userId: string | null): TaskOwner {
  if (!task.assignedUserId) return 'free'
  return task.assignedUserId === userId ? 'mine' : 'other'
}

/** One word for the card: what the picker should do with it. */
export function actionFor(owner: TaskOwner): string {
  return owner === 'mine' ? 'Continue' : owner === 'free' ? 'Claim' : 'Taken'
}

export function taskTitle(task: Pick<PickTask, 'orderId'>): string {
  return `Order #${task.orderId.slice(-8).toUpperCase()}`
}

export function lineLabel(item: PickItem): string {
  return item.skuName?.trim() || item.skuCode?.trim() || `Item …${item.skuId.slice(-6)}`
}

/** A scan is accepted as typed; the server compares it with the item. Blank means no scan. */
export function cleanScan(raw: string): string | undefined {
  const v = raw.trim()
  return v === '' ? undefined : v
}

/**
 * Whether a short quantity is acceptable: a whole number from 0 up to one less than needed.
 * Zero means none could be found.
 */
export function shortQtyProblem(raw: string, needed: number): string | null {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < 0 || n >= needed) {
    return `Enter how many you found, from 0 to ${needed - 1}`
  }
  return null
}
