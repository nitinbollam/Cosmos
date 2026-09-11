import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Generate ENCRYPTION_KEY with: openssl rand -base64 32
const ALGO = 'aes-256-gcm'
const KEY_LEN = 32

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_LEN) {
    return scryptSync(raw, 'pleros-encryption', KEY_LEN)
  }
  return buf
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted payload')
  const iv = Buffer.from(parts[0]!, 'base64')
  const tag = Buffer.from(parts[1]!, 'base64')
  const data = Buffer.from(parts[2]!, 'base64')
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
