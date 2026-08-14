/**
 * Hardware keyboard-wedge parser.
 *
 * Ring scanners / handheld HID guns emit a barcode as a burst of keystrokes
 * terminated by Enter — much faster than any human types. We distinguish
 * "scanner burst" from "person typing" purely by inter-key timing: if the gap
 * between keys stays under `maxIntervalMs`, it's a scanner.
 *
 * Pure and framework-free so the timing heuristic can be tested deterministically
 * with an injected clock. The React binding lives in `useKeyboardWedge`.
 */
export type WedgeParserOptions = {
  /** Max gap (ms) between keys to still count as one scan burst. Default 50. */
  maxIntervalMs?: number;
  /** Minimum length to accept, filtering stray Enter presses. Default 3. */
  minLength?: number;
};

export class WedgeParser {
  private buffer = "";
  private lastKeyAt = 0;
  private readonly maxIntervalMs: number;
  private readonly minLength: number;

  constructor(
    options: WedgeParserOptions = {},
    private now: () => number = () => Date.now(),
  ) {
    this.maxIntervalMs = options.maxIntervalMs ?? 50;
    this.minLength = options.minLength ?? 3;
  }

  /**
   * Feed one keydown-like event. Returns the decoded value when a complete,
   * fast-enough burst terminates with Enter; otherwise null.
   */
  handle(key: string): string | null {
    const t = this.now();
    const gap = t - this.lastKeyAt;
    this.lastKeyAt = t;

    // A slow keypress means a human — abandon any partial buffer and restart
    // from this character so genuine typing never accumulates.
    if (gap > this.maxIntervalMs && this.buffer.length > 0) {
      this.buffer = "";
    }

    if (key === "Enter") {
      const value = this.buffer;
      this.buffer = "";
      if (value.length >= this.minLength) return value;
      return null;
    }

    // Only single printable characters are part of a code; ignore modifiers,
    // arrows, Tab, etc.
    if (key.length === 1) {
      this.buffer += key;
    }
    return null;
  }

  reset(): void {
    this.buffer = "";
    this.lastKeyAt = 0;
  }
}
