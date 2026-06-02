import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import type { ReactNode } from 'react'

export function CosmosSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[100]"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        />
        <Dialog.Content
          className={clsx(
            'fixed z-[101] right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l p-5 cosmos-card rounded-none shadow-xl outline-none',
          )}
          style={{ borderRadius: 0, borderColor: 'var(--c-border)' }}
        >
          <Dialog.Title className="bento-section-title mb-4">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function CosmosDialogModal({
  open,
  onOpenChange,
  title,
  children,
  maxWidthClass = 'max-w-3xl',
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** e.g. max-w-md, max-w-3xl */
  maxWidthClass?: string
  footer?: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100]" style={{ background: 'rgba(0,0,0,0.65)' }} />
        <Dialog.Content
          className={clsx(
            'fixed z-[101] left-1/2 top-1/2 w-full max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden flex flex-col p-5 cosmos-card outline-none',
            maxWidthClass,
          )}
        >
          <div className="flex justify-between items-start gap-3 mb-4 shrink-0">
            <Dialog.Title className="bento-section-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-ghost !py-1 !px-2 shrink-0">
                Close
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="overflow-y-auto flex-1 min-h-0">{children}</div>
          {footer != null ? <div className="shrink-0 mt-4 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
