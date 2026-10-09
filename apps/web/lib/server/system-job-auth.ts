import { createHash, timingSafeEqual } from 'node:crypto'
import { ApiError } from './session'

function expectedToken(): string {
  const token = process.env.SYSTEM_JOB_TOKEN?.trim()
  if (!token) throw new ApiError(503, 'System jobs are not configured (SYSTEM_JOB_TOKEN missing)')
  return token
}

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

/** Validates Authorization: Bearer <SYSTEM_JOB_TOKEN> using constant-time comparison. */
export function requireSystemJobToken(req: Request): void {
  const auth = req.headers.get('authorization')?.trim() ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) throw new ApiError(401, 'Missing system job token')
  const provided = auth.slice(7).trim()
  const expected = expectedToken()
  const a = tokenHash(provided)
  const b = tokenHash(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'Invalid system job token')
}
