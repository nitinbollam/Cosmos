/**
 * Minimal dependency-free toast. Renders into a fixed container so call sites
 * don't need provider wiring — replaces blocking alert() dialogs.
 */

type ToastKind = 'success' | 'error' | 'info'

let container: HTMLDivElement | null = null

function ensureContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container
  container = document.createElement('div')
  container.setAttribute('role', 'status')
  container.setAttribute('aria-live', 'polite')
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(container)
  return container
}

const KIND_ACCENT: Record<ToastKind, string> = {
  success: 'var(--c-success, #34d399)',
  error: 'var(--c-danger, #f87171)',
  info: 'var(--c-accent, #5B8DEF)',
}

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 4000): void {
  const host = ensureContainer()
  const el = document.createElement('div')
  el.textContent = message
  Object.assign(el.style, {
    maxWidth: 'min(420px, calc(100vw - 48px))',
    padding: '10px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    lineHeight: '1.5',
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
    background: 'var(--c-surface, #1a1a1f)',
    color: 'var(--c-text, #e5e5ea)',
    border: `1px solid ${KIND_ACCENT[kind]}`,
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    opacity: '0',
    transition: 'opacity 160ms ease, transform 160ms ease',
    transform: 'translateY(6px)',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>)
  host.appendChild(el)

  requestAnimationFrame(() => {
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  })

  window.setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    window.setTimeout(() => el.remove(), 200)
  }, durationMs)
}
