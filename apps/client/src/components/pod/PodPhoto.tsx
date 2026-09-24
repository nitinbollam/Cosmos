import './photo-capture.css'

type PodPhotoProps = {
  /** A data URL or a hosted image URL — both render the same way. */
  src?: string | null
  caption?: string
  alt?: string
}

/**
 * Read-only proof-of-delivery photo, for the staff and customer views.
 *
 * Renders nothing when there is no photo, so callers can drop it in without
 * guarding: a delivery recorded before this feature shipped simply shows no
 * image rather than a broken placeholder.
 *
 * Clicking opens the full-size image in a new tab, which is what someone
 * resolving a dispute actually wants.
 */
export function PodPhoto({ src, caption, alt = 'Proof of delivery photo' }: PodPhotoProps) {
  if (!src) return null

  return (
    <div className="pod-photo-view">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onClick={() => window.open(src, '_blank', 'noopener')}
      />
      {caption && <span className="pod-photo-caption">{caption}</span>}
    </div>
  )
}
