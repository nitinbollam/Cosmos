/**
 * Proof of delivery is mandatory: a stop can only be marked delivered with both a
 * photo and the recipient's signature. This applies to every path that marks a
 * stop delivered (the driver POD endpoint and the staff route endpoint), so there
 * is no way round it from the admin screens.
 *
 * Both are stored as image data URLs inside `RouteStop.pod` (no object storage
 * yet). Moving to hosted storage means accepting its URLs here as well.
 *
 * Returns the reason the POD is not acceptable, or null when it is. Kept free of
 * DB and session imports so it can be unit-tested on its own.
 */
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/
const SIGNATURE_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

export function podEvidenceProblem(pod: Record<string, unknown> | undefined): string | null {
  const photo = pod?.photoUrl
  const signature = pod?.signatureDataUrl
  const hasPhoto = typeof photo === 'string' && photo.trim() !== ''
  const hasSignature = typeof signature === 'string' && signature.trim() !== ''

  if (!hasPhoto && !hasSignature) return 'A delivery photo and the recipient signature are required'
  if (!hasPhoto) return 'A delivery photo is required'
  if (!hasSignature) return 'The recipient signature is required'
  if (!PHOTO_DATA_URL.test(photo as string)) return 'The delivery photo must be a JPEG, PNG or WebP image'
  if (!SIGNATURE_DATA_URL.test(signature as string)) return 'The recipient signature must be a PNG image'
  return null
}
