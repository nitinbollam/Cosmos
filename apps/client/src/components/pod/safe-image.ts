/**
 * Proof-of-delivery images come from stored data and are opened on click, so only inline
 * raster images and https links are ever rendered — a `javascript:` or HTML "image" would
 * otherwise run inside the app when clicked.
 */
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,/

export function safeImageSrc(src: string | null | undefined): string | null {
  if (!src) return null
  if (DATA_IMAGE.test(src)) return src
  try {
    return new URL(src).protocol === 'https:' ? src : null
  } catch {
    return null
  }
}
