/**
 * Visual scan-target guidance: a dimmed surround with a clear reticle and a
 * sweeping laser line. Purely decorative — it never gates detection (the whole
 * frame is decoded), it just tells the operator where to aim.
 */
export function ScanFrameOverlay({ scanning }: { scanning: boolean }) {
  return (
    <div className="scan-overlay" aria-hidden="true">
      <div className="scan-reticle">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        {scanning && <span className="laser" />}
      </div>
    </div>
  );
}
