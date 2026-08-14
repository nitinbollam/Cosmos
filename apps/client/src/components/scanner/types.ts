/**
 * Public contract for the Pleros scanner.
 *
 * Design principle: the scanner is a *scan engine*, not a warehouse workflow.
 * It opens a source (camera or hardware wedge), normalizes what it reads, and
 * hands a single `ScanResult` to the parent. Business logic — SKU lookup, bin
 * validation, auto-submit, "keep scanning" — lives in the parent screen.
 */

/** Normalized symbology names, unified across every engine + source. */
export type BarcodeFormat =
  | "qr_code"
  | "code_128"
  | "code_39"
  | "code_93"
  | "codabar"
  | "ean_13"
  | "ean_8"
  | "upc_a"
  | "upc_e"
  | "itf"
  | "data_matrix"
  | "pdf417"
  | "aztec"
  | "unknown";

/** Where a scan physically came from. */
export type ScanSource = "camera" | "wedge" | "manual";

export type ScanResult = {
  /** The decoded payload, exactly as read. */
  rawValue: string;
  /** Normalized symbology, when the source reports it. */
  format: BarcodeFormat;
  /** How the code was captured. */
  source: ScanSource;
  /** ISO-8601 timestamp of the successful read. */
  scannedAt: string;
};

/**
 * Typed error kinds so parent screens can render the *right* guidance instead
 * of a single "camera failed" catch-all. This distinction is the difference
 * between "grant permission in Settings" and "another app is using the camera".
 */
export type ScannerErrorKind =
  | "permission-denied" // user (or policy) blocked camera access
  | "no-camera" // no video input device found
  | "camera-busy" // device is held by another tab/app (NotReadableError)
  | "insecure-context" // page not served over HTTPS/localhost
  | "unsupported" // no getUserMedia + no usable decode engine
  | "overconstrained" // requested camera/constraints not satisfiable
  | "unknown";

export class ScannerError extends Error {
  readonly kind: ScannerErrorKind;
  readonly cause?: unknown;
  constructor(kind: ScannerErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ScannerError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** Human-facing copy for each error kind. Parents may override per surface. */
export const DEFAULT_ERROR_COPY: Record<ScannerErrorKind, string> = {
  "permission-denied":
    "Camera access is blocked. Enable it in your browser settings, then try again.",
  "no-camera": "No camera was found on this device.",
  "camera-busy": "The camera is in use by another app or tab. Close it and retry.",
  "insecure-context":
    "The camera needs a secure (HTTPS) connection. Open this app over HTTPS.",
  unsupported: "This device or browser can't scan with the camera. Use manual entry.",
  overconstrained: "The requested camera isn't available. Try switching cameras.",
  unknown: "Something went wrong starting the scanner. Please try again.",
};

export type ScannerStatus =
  | "idle" // not started
  | "starting" // requesting permission / opening stream
  | "scanning" // live, actively looking for a code
  | "paused" // stream open, detection halted (e.g. after a hit)
  | "error"; // see `error`

/** Props for the drop-in UI component (sheet/modal). */
export type BarcodeScannerProps = {
  /** Controls mounting/teardown of the camera. */
  open: boolean;
  /** Fired once per accepted (deduped) scan. */
  onDetected: (result: ScanResult) => void;
  /** User dismissed the scanner. */
  onClose: () => void;
  /** Non-fatal + fatal errors surface here for logging/toasts. */
  onError?: (error: ScannerError) => void;
  /**
   * Restrict which symbologies are decoded. Fewer formats = faster, fewer
   * misreads. Omit to accept everything the engine supports.
   */
  formats?: BarcodeFormat[];
  /**
   * When true, keep scanning after each hit (dedup still applies). When false
   * (default), pause on the first hit so the parent can act, then resume via
   * the "Scan next" control.
   */
  continuous?: boolean;
  /**
   * Ignore an identical rawValue seen again within this window (ms). Prevents a
   * single label from firing dozens of times. Default 1500.
   */
  dedupeWindowMs?: number;
  /** Also accept input from hardware keyboard-wedge scanners. Default true. */
  enableWedge?: boolean;
  /** Show a manual-entry fallback (keyed by a human, or damaged labels). */
  allowManualEntry?: boolean;
  /** Title shown in the sheet header, e.g. "Scan item to receive". */
  title?: string;
  /**
   * Layout mode.
   *  - "sheet" (default): fullscreen modal overlay. Best for one-shot scans
   *    (pick confirm, bin check) where the code is the only thing that matters.
   *  - "split": renders in-flow as a camera pane, so the parent can keep its
   *    working list visible underneath and the operator watches it update as
   *    they scan. Best for high-volume receiving / counting.
   */
  variant?: "sheet" | "split";
};
