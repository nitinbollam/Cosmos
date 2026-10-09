import { createWriteStream, mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { ApiError } from './session'

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MAX_BYTES = 5 * 1024 * 1024

function uploadRootDir(): string {
  const dataDir = process.env.PLEROS_DATA_DIR ?? '.data'
  const root = path.join(WEB_ROOT, dataDir, 'marketplace-uploads')
  mkdirSync(root, { recursive: true })
  return root
}

function safeUploadPath(relativePath: string): string {
  const root = path.resolve(uploadRootDir())
  const resolved = path.resolve(root, relativePath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new ApiError(400, 'Invalid upload path')
  }
  return resolved
}

/** Persist a base64 image for marketplace listing photos. Returns a public API URL path. */
export async function persistMarketplacePhoto(
  tenantId: string,
  input: { fileName: string; contentBase64: string; mimeType?: string },
): Promise<string> {
  const mime = input.mimeType?.trim() || 'image/jpeg'
  if (!mime.startsWith('image/')) throw new ApiError(400, 'Only image uploads are allowed')

  const buf = Buffer.from(input.contentBase64, 'base64')
  if (buf.length < 1 || buf.length > MAX_BYTES) {
    throw new ApiError(400, `Image must be between 1 byte and ${MAX_BYTES} bytes`)
  }

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const relative = path.join(tenantId, `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`)
  const full = safeUploadPath(relative)
  mkdirSync(path.dirname(full), { recursive: true })
  await pipeline(Readable.from(buf), createWriteStream(full))

  return `/api/v1/marketplace/uploads/${relative.replace(/\\/g, '/')}`
}

export function readMarketplaceUpload(relativePath: string): { buf: Buffer; mime: string } | null {
  const full = safeUploadPath(relativePath)
  if (!existsSync(full)) return null
  const ext = path.extname(full).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return { buf: readFileSync(full), mime }
}
