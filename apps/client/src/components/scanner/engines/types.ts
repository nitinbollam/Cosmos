import type { BarcodeFormat } from "../types";

/** A single decoded detection from an engine, pre-normalization consumer-side. */
export type RawDetection = {
  rawValue: string;
  format: BarcodeFormat;
};

/**
 * Uniform decode surface over every camera engine. Given a rendered frame
 * (a canvas), return the first detection or `null` if nothing was found.
 * Implementations must never throw on "not found" — only on genuine faults.
 */
export interface ScanEngine {
  readonly name: string;
  decode(canvas: HTMLCanvasElement): Promise<RawDetection | null>;
  /** Release any engine-held resources (workers, readers). */
  dispose(): void;
}
