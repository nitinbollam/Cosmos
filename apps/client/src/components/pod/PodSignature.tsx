import './photo-capture.css'

type PodSignatureProps = {
  src?: string | null
  caption?: string
}

/**
 * Read-only recipient signature. Staff surfaces only.
 *
 * Deliberately not rendered on the customer order page: unlike a doorstep
 * photo, a signature image is a reusable specimen of someone's handwriting, so
 * it is kept behind staff access until someone decides otherwise.
 *
 * Renders nothing when there is no signature, so deliveries recorded before
 * this shipped display cleanly rather than showing a broken image.
 */
export function PodSignature({ src, caption = 'Signed by recipient' }: PodSignatureProps) {
  if (!src) return null

  return (
    <div className="pod-photo-view pod-signature-view">
      <img src={src} alt="Recipient signature" loading="lazy" />
      <span className="pod-photo-caption">{caption}</span>
    </div>
  )
}
