/**
 * Rapid-fire dedup. A camera loop can decode the same physical label 10–30
 * times a second; a wedge can double-fire. This gate accepts a value only if
 * we haven't already accepted the *same* value within `windowMs`.
 *
 * Kept as a tiny stateful class (not a hook) so it's trivially unit-testable
 * with a fake clock and reusable across camera + wedge sources.
 */
export class ScanDeduper {
  private lastValue: string | null = null;
  private lastAt = 0;

  constructor(
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  /** True if this value should be accepted (and records it). */
  accept(value: string): boolean {
    const t = this.now();
    if (this.lastValue === value && t - this.lastAt < this.windowMs) {
      return false;
    }
    this.lastValue = value;
    this.lastAt = t;
    return true;
  }

  /** Forget history — e.g. when the user explicitly taps "Scan next". */
  reset(): void {
    this.lastValue = null;
    this.lastAt = 0;
  }
}
