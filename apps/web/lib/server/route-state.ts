/**
 * One state per route. Excise, tax stamps and van stock are all state-specific, so a route that
 * crosses a state line is refused when it is planned rather than discovered at the door.
 * Pure, so the rule can be tested alone.
 */
import { normalizeState } from './van-rules'

/** The state a stop is in: the delivery address first, then the customer's own state. */
export function stopState(address: unknown, customerState?: string | null): string | null {
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    const a = address as Record<string, unknown>
    for (const key of ['state', 'stateCode', 'region']) {
      const v = typeof a[key] === 'string' ? normalizeState(a[key] as string) : null
      if (v) return v
    }
  }
  return normalizeState(customerState)
}

export type RouteStateCheck = {
  /** The single state every stop with a known state is in, or null when none is known. */
  state: string | null
  /** Stops whose state is not on record: they cannot be checked, so the planner is told. */
  unknownStops: number
  /** Set when stops are in more than one state. */
  problem: string | null
}

export function checkRouteStates(states: ReadonlyArray<string | null>): RouteStateCheck {
  const known = [...new Set(states.filter((s): s is string => !!s))].sort()
  const unknownStops = states.filter((s) => !s).length
  if (known.length > 1) {
    return {
      state: null,
      unknownStops,
      problem: `A route must stay in one state, but these stops are in ${known.join(', ')}. Split it into one route per state`,
    }
  }
  return { state: known[0] ?? null, unknownStops, problem: null }
}
