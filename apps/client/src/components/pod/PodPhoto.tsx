import { useEffect, useState } from 'react'
import './photo-capture.css'

type PodPhotoProps = {
  /** A data URL or a hosted image URL — both render the same way. */
  src?: string | null
  caption?: string
  alt?: string
}

/**
 * Browsers refuse to open a `data:` URL as a top-level page, so a link straight to
 * the stored photo would do nothing. Re-wrap it as a `blob:` URL, which they will
 * open. Until the blob URL is ready the link points at the photo itself.
 */
function blobUrlFor(dataUrl: string): string | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  try {
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: match[1] }))
  } catch {
    return null
  }
}

/**
 * Read-only proof-of-delivery photo, for the staff and customer views.
 *
 * Renders nothing when there is no photo, so callers can drop it in without
 * guarding: a delivery recorded before this feature shipped simply shows no
 * image rather than a broken placeholder.
 *
 * The photo is a link to the full-size image in a new tab, which is what someone
 * resolving a dispute actually wants — and, being a link, it works from the
 * keyboard as well as the mouse.
 */
export function PodPhoto({ src, caption, alt = 'Proof of delivery photo' }: PodPhotoProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  // Create and revoke in the same effect, so a StrictMode remount (or a new src)
  // never leaves the link pointing at a URL that has already been revoked.
  useEffect(() => {
    const url = src?.startsWith('data:') ? blobUrlFor(src) : null
    setBlobUrl(url)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])

  if (!src) return null

  return (
    <div className="pod-photo-view">
      <a
        className="pod-photo-open"
        href={blobUrl ?? src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${alt}, open full size`}
      >
        <img src={src} alt={alt} loading="lazy" />
      </a>
      {caption && <span className="pod-photo-caption">{caption}</span>}
    </div>
  )
}
