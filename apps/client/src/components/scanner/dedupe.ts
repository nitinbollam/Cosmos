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

/** 1D symbologies, which have little or no error correction: one frame can decode a blurred label as a wrong value. */
const ONE_D_FORMATS = new Set(['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e'])

type Sighting = { at: number; frame: number; hits: number; counted: boolean }

/**
 * The camera's version of ScanDeduper, fed every decoded frame (with or without a value). Two extra guards, both from
 * receiving on real phones (ClickUp 44):
 *
 * - Confirm: a 1D value counts only once it has been read in `confirmHits` frames of the same sighting. A misread is a
 *   one-off; the real value repeats. 2D codes (QR, PDF417…) carry error correction and count on the first read.
 * - "Out of view" means looked and not seen: at least `windowMs` AND `goneFrames` frames without the value. On a slow
 *   phone one decode can take most of a second, so time alone can pass with the label still in view.
 *
 * Values are tracked independently, so two labels in view don't reset each other.
 */
export class CameraScanGate {
  private frame = 0
  private sightings = new Map<string, Sighting>()

  constructor(
    private windowMs: number,
    private confirmHits = 2,
    private goneFrames = 3,
    private now: () => number = () => Date.now(),
  ) {}

  /** Record one decoded frame. Returns true when `value` should count as a new scan. */
  frameDecoded(value: string | null, format?: string): boolean {
    const t = this.now()
    this.frame++
    this.prune(t)
    if (!value) return false
    let s = this.sightings.get(value)
    if (!s) {
      s = { at: t, frame: this.frame, hits: 0, counted: false }
      this.sightings.set(value, s)
    }
    s.at = t
    s.frame = this.frame
    s.hits++
    const needed = format && !ONE_D_FORMATS.has(format) ? 1 : this.confirmHits
    if (s.counted || s.hits < needed) return false
    s.counted = true
    return true
  }

  /** Forget history — e.g. when the user explicitly taps "Scan next". */
  reset(): void {
    this.sightings.clear()
  }

  /** A sighting ends once the value has been out of view long enough, by both clock and frame count. */
  private prune(t: number): void {
    for (const [value, s] of this.sightings) {
      if (t - s.at >= this.windowMs && this.frame - s.frame > this.goneFrames) this.sightings.delete(value)
    }
  }
}
