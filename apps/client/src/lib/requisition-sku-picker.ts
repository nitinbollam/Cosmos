export type RequisitionSku = { id: string; code: string; name: string; isActive: boolean }

export type RequisitionSkuKeyAction =
  | { type: 'move'; index: number }
  | { type: 'select'; index: number }
  | { type: 'close' }

export function requisitionSkuKeyAction(
  key: string,
  activeIndex: number,
  optionCount: number,
  isOpen: boolean,
): RequisitionSkuKeyAction | null {
  if (key === 'ArrowDown' && optionCount > 0) {
    return { type: 'move', index: activeIndex < 0 ? 0 : (activeIndex + 1) % optionCount }
  }
  if (key === 'ArrowUp' && optionCount > 0) {
    return { type: 'move', index: activeIndex < 0 ? optionCount - 1 : (activeIndex - 1 + optionCount) % optionCount }
  }
  if (key === 'Enter' && isOpen && activeIndex >= 0 && activeIndex < optionCount) {
    return { type: 'select', index: activeIndex }
  }
  if (key === 'Escape' && isOpen) return { type: 'close' }
  return null
}

export function selectSkuForRequisitionLine<T extends { skuCode: string; description: string }>(
  line: T,
  sku: Pick<RequisitionSku, 'code' | 'name'>,
): T {
  return {
    ...line,
    skuCode: sku.code,
    description: line.description.trim() ? line.description : sku.name,
  }
}
