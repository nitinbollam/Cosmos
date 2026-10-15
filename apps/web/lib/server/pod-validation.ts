import { ApiError } from './session'

/** A downscaled 1280px JPEG from the driver app is well under this; anything bigger isn't ours. */
const MAX_IMAGE_CHARS = 3_000_000
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export type ProofOfDelivery = {
  deliveredAt?: string
  photoUrl: string | null
  signatureDataUrl: string | null
  notes?: string
  ageConfirmed?: boolean
  recipientName?: string
}

/**
 * Images are shown to customers and staff and opened on click, so only inline raster images
 * or https links are accepted — never `javascript:`, `data:text/html`, SVG or other schemes.
 */
function safeImage(value: unknown, field: string): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`)
  if (value.length > MAX_IMAGE_CHARS) throw new ApiError(413, `${field} is too large`)
  if (DATA_IMAGE.test(value)) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && value.length <= 2048) return url.toString()
  } catch {
    /* fall through */
  }
  throw new ApiError(400, `${field} must be a JPEG, PNG or WebP image or an https URL`)
}

/** Non-throwing check for values already stored (possibly before validation existed). */
export function isSafePodImage(value: unknown): value is string {
  try {
    return safeImage(value, 'image') !== null
  } catch {
    return false
  }
}

function boundedText(value: unknown, field: string, max: number): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new ApiError(400, `${field} must be at most ${max} characters`)
  return trimmed || undefined
}

/**
 * Keep only the proof-of-delivery fields the app knows about, validated. Anything else in the
 * request body is dropped rather than stored in the stop's JSON column.
 */
export function sanitizeProofOfDelivery(body: Record<string, unknown>): ProofOfDelivery {
  let deliveredAt: string | undefined
  if (body.deliveredAt != null) {
    const d = new Date(String(body.deliveredAt))
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'deliveredAt must be a date')
    deliveredAt = d.toISOString()
  }
  return {
    deliveredAt,
    photoUrl: safeImage(body.photoUrl, 'photoUrl'),
    signatureDataUrl: safeImage(body.signatureDataUrl, 'signatureDataUrl'),
    notes: boundedText(body.notes, 'notes', 2000),
    ageConfirmed: body.ageConfirmed === true,
    recipientName: boundedText(body.recipientName, 'recipientName', 200),
  }
}
