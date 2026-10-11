/**
 * Rapid-fire dedup. A camera loop can decode the same physical label 10–30
 * times a second; a wedge can double-fire. This gate accepts a value once per
 * *sighting*: the same value is accepted again only after it has gone unseen
 * for `windowMs`, i.e. the label left the frame and came back.
 *
 * Every sighting refreshes the timer, not just accepted ones. Otherwise a label
 * held in view is re-accepted every `windowMs`, which in receiving means one
 * extra unit received each time. Values are tracked independently, so two
 * labels in view at once can't take turns re-arming each other.
 *
 * Kept as a tiny stateful class (not a hook) so it's trivially unit-testable
 * with a fake clock and reusable across camera + wedge sources.
 */
export class ScanDeduper {
  private lastSeen = new Map<string, number>()

  constructor(
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  /** True if this value should be accepted. Records the sighting either way. */
  accept(value: string): boolean {
    const t = this.now()
    const seenAt = this.lastSeen.get(value)
    this.lastSeen.set(value, t)
    this.prune(t)
    return seenAt === undefined || t - seenAt >= this.windowMs
  }

  /** Forget history — e.g. when the user explicitly taps "Scan next". */
  reset(): void {
    this.lastSeen.clear()
  }

  /** Drop values unseen for long enough that they would be accepted anyway. */
  private prune(t: number): void {
    for (const [value, seenAt] of this.lastSeen) {
      if (t - seenAt >= this.windowMs) this.lastSeen.delete(value)
    }
  }
}
