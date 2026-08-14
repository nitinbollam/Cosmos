import type { ScanEngine } from "./types";
import type { BarcodeFormat } from "../types";
import { NativeEngine } from "./native-engine";
import { ZXingEngine } from "./zxing-engine";

export type { ScanEngine, RawDetection } from "./types";
export { WAREHOUSE_DEFAULT_FORMATS } from "./formats";

/**
 * Pick the best available camera engine for the requested formats.
 *
 * Order is a deliberate policy decision (see README "Engine choice"):
 *   1. Native BarcodeDetector — only when it exists AND supports the formats.
 *   2. ZXing — the portable fallback that actually runs on iOS.
 *
 * On the vast majority of iOS devices step 1 returns null, so ZXing is the
 * effective primary there — which is why it, not the native path, gets the
 * TRY_HARDER tuning.
 */
export async function pickEngine(formats: BarcodeFormat[]): Promise<ScanEngine> {
  const native = await NativeEngine.tryCreate(formats);
  if (native) return native;
  return new ZXingEngine(formats);
}
