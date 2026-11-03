import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { requisitionSkuKeyAction, type RequisitionSku } from '@/lib/requisition-sku-picker'

export function RequisitionSkuPicker(props: {
  lineNumber: number
  skuCode: string
  onChange: (skuCode: string) => void
  onSelect: (sku: RequisitionSku) => void
}) {
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const query = props.skuCode.trim()
  const results = useQuery<{ items: RequisitionSku[] }>({
    queryKey: ['requisition-sku-search', query],
    enabled: isOpen && query.length > 0,
    staleTime: 20_000,
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', pageSize: '12', search: query })
      return api.get(`/skus?${params.toString()}`)
    },
  })
  const options = (results.data?.items ?? []).filter((sku) => sku.isActive)
  const listId = `${id}-options`
  const activeOptionId = activeIndex >= 0 && activeIndex < options.length ? `${listId}-${activeIndex}` : undefined

  const select = (sku: RequisitionSku) => {
    props.onSelect(sku)
    setIsOpen(false)
    setActiveIndex(-1)
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-xs text-pleros-muted">
        Line {props.lineNumber} SKU (optional)
      </label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen && query.length > 0}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        className="pleros-input mt-1 w-full font-mono"
        value={props.skuCode}
        onFocus={() => {
          if (query) setIsOpen(true)
        }}
        onBlur={() => setIsOpen(false)}
        onChange={(event) => {
          props.onChange(event.target.value)
          setActiveIndex(-1)
          setIsOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isOpen) event.preventDefault()
          const action = requisitionSkuKeyAction(event.key, activeIndex, options.length, isOpen)
          if (!action) return
          event.preventDefault()
          if (action.type === 'move') setActiveIndex(action.index)
          if (action.type === 'select') select(options[action.index])
          if (action.type === 'close') {
            setIsOpen(false)
            setActiveIndex(-1)
          }
        }}
      />
      {isOpen && query && (
        <div id={listId} role="listbox" className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-pleros-border bg-pleros-surface shadow-lg">
          {results.isLoading ? (
            <p className="px-3 py-2 text-xs text-pleros-muted">Searching SKUs…</p>
          ) : results.isError ? (
            <p role="alert" className="px-3 py-2 text-xs text-red-400">Could not search SKUs.</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-pleros-muted">No matching SKUs.</p>
          ) : (
            options.map((sku, index) => (
              <div
                key={sku.id}
                id={`${listId}-${index}`}
                role="option"
                aria-label={`${sku.code} ${sku.name}`}
                aria-selected={index === activeIndex}
                className={`cursor-pointer px-3 py-2 text-xs text-pleros-text ${index === activeIndex ? 'bg-pleros-surface-2' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(sku)}
              >
                <span className="font-mono">{sku.code}</span><span className="ml-2">{sku.name}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
