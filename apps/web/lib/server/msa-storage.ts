import { createWriteStream, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function msaRootDir(): string {
  const dataDir = process.env.PLEROS_DATA_DIR ?? '.data'
  const root = path.join(WEB_ROOT, dataDir, 'msa')
  mkdirSync(root, { recursive: true })
  return root
}

/** Persist MULTICAT file locally under `.data/msa/`. */
export async function persistMsaFile(relativePath: string, content: string): Promise<string> {
  const full = path.join(msaRootDir(), relativePath)
  mkdirSync(path.dirname(full), { recursive: true })
  await pipeline(Readable.from([content]), createWriteStream(full, { encoding: 'utf8' }))
  return full
}

export function readMsaFile(relativePath: string): string {
  const full = path.join(msaRootDir(), relativePath)
  if (!existsSync(full)) throw new Error(`MSA file not found: ${relativePath}`)
  return readFileSync(full, 'utf8')
}

export type MsaUploadResult = {
  uploaded: boolean
  transport: 'local' | 'webhook' | 's3'
  location: string
}

/** Upload archived report — local always; optional webhook or S3-compatible PUT. */
export async function uploadMsaReport(relativePath: string, content: string): Promise<MsaUploadResult> {
  const localPath = await persistMsaFile(relativePath, content)

  const webhook = process.env.MSA_UPLOAD_WEBHOOK_URL?.trim()
  if (webhook) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: relativePath,
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      }),
    })
    if (!res.ok) throw new Error(`MSA webhook upload failed: ${res.status}`)
    return { uploaded: true, transport: 'webhook', location: webhook }
  }

  const bucket = process.env.MSA_S3_BUCKET?.trim()
  const region = process.env.MSA_S3_REGION?.trim() ?? 'us-east-1'
  if (bucket) {
    const key = relativePath.replace(/^\/+/, '')
    const endpoint =
      process.env.MSA_S3_ENDPOINT?.trim() ??
      `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key).replace(/%2F/g, '/')}`
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        ...(process.env.MSA_S3_ACCESS_KEY
          ? { Authorization: `Bearer ${process.env.MSA_S3_ACCESS_KEY}` }
          : {}),
      },
      body: content,
    })
    if (!res.ok) throw new Error(`MSA S3 upload failed: ${res.status}`)
    return { uploaded: true, transport: 's3', location: `s3://${bucket}/${key}` }
  }

  return { uploaded: true, transport: 'local', location: localPath }
}
