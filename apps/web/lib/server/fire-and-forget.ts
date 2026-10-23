/**
 * Run work whose failure must not fail the caller (a notification, an audit line, a cache warm-up),
 * without hiding that it failed. A bare `.catch(() => undefined)` makes every swallow look the same;
 * this one logs the label, tenant and correlation id and counts the failure under a metric name, so
 * a rising count is visible. It never throws and never rejects.
 *
 * Use it only for work that is safe to lose. Anything that moves money, stock or order state must
 * propagate its error or be queued through the posting outbox: see docs/SWALLOWED_ERRORS.md.
 */
export type FireAndForgetContext = {
  tenantId?: string
  correlationId?: string
  orderId?: string
  /** `warn` for best-effort cleanup that is expected to fail now and then. Default `error`. */
  level?: 'warn' | 'error'
}

const failures = new Map<string, number>()

/** Failure counts by label since the process started (for tests and a health endpoint). */
export function fireAndForgetFailures(): Record<string, number> {
  return Object.fromEntries(failures)
}

export function resetFireAndForgetFailures(): void {
  failures.clear()
}

function record(label: string, err: unknown, ctx: FireAndForgetContext): void {
  failures.set(label, (failures.get(label) ?? 0) + 1)
  const where = [
    ctx.tenantId && `tenant=${ctx.tenantId}`,
    ctx.orderId && `order=${ctx.orderId}`,
    ctx.correlationId && `correlation=${ctx.correlationId}`,
  ]
    .filter(Boolean)
    .join(' ')
  const log = ctx.level === 'warn' ? console.warn : console.error
  log(`[bg:${label}] failed${where ? ` (${where})` : ''}:`, err)
  console.error(`[metric] fire_and_forget_failed 1 label=${label}`)
}

/**
 * A `.catch` handler for work that is safe to lose but must not fail silently: logs the label and
 * counts the failure, then resolves to undefined. Use it where the promise is awaited or chained
 * (`await x().catch(swallowed('area.step'))`); use fireAndForget() when nothing waits on it.
 */
export function swallowed(label: string, ctx: FireAndForgetContext = {}): (err: unknown) => undefined {
  return (err) => {
    record(label, err, ctx)
    return undefined
  }
}

export function fireAndForget(
  label: string,
  work: Promise<unknown> | (() => Promise<unknown>),
  ctx: FireAndForgetContext = {},
): void {
  let promise: Promise<unknown>
  try {
    promise = typeof work === 'function' ? work() : work
  } catch (err) {
    promise = Promise.reject(err)
  }
  promise.catch((err: unknown) => record(label, err, ctx))
}
