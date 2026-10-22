import { showToast } from '@/lib/toast'

/** What receiving returns about the supplier bill: the receipt is saved even when billing fails. */
export type ReceiptBilling = {
  bill?: { billNumber: string; totalAmount: number } | null
  billError?: string | null
}

/** Tell the person who received the goods when the supplier bill couldn't be created. */
export function showReceiptBillingResult(res: ReceiptBilling | undefined) {
  if (res?.billError) {
    showToast(
      `Goods received, but the supplier bill couldn't be created: ${res.billError}. Use "Create bill" on the purchase order to try again.`,
      'error',
      10000,
    )
  }
}
