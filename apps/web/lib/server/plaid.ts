import { createHash, timingSafeEqual } from 'node:crypto'
import { decodeProtectedHeader, jwtVerify, importJWK } from 'jose'
import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { ApiError } from './session'
import { encryptSecret, decryptSecret } from './crypto-util'

function plaidBaseUrl(): string {
  const env = (process.env.PLAID_ENV ?? 'sandbox').trim().toLowerCase()
  if (env === 'production') return 'https://production.plaid.com'
  if (env === 'development') return 'https://development.plaid.com'
  return 'https://sandbox.plaid.com'
}

function plaidCredentials() {
  const clientId = process.env.PLAID_CLIENT_ID?.trim()
  const secret = process.env.PLAID_SECRET?.trim()
  if (!clientId || !secret) {
    throw new ApiError(503, 'Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET missing)')
  }
  return { clientId, secret }
}

async function plaidRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret } = plaidCredentials()
  const res = await fetch(`${plaidBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  })
  const json = (await res.json()) as T & { error_message?: string }
  if (!res.ok) {
    throw new ApiError(502, (json as { error_message?: string }).error_message ?? 'Plaid request failed')
  }
  return json
}

export async function createLinkToken(tenantId: string, userId: string): Promise<{ linkToken: string }> {
  const res = await plaidRequest<{ link_token: string }>('/link/token/create', {
    user: { client_user_id: `${tenantId}:${userId}` },
    client_name: 'Pleros',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
  })
  return { linkToken: res.link_token }
}

export async function exchangePublicToken(tenantId: string, bankAccountId: string, publicToken: string) {
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id: bankAccountId, tenantId } })
  if (!acct) throw new ApiError(404, 'Bank account not found')

  const res = await plaidRequest<{ access_token: string; item_id: string }>('/item/public_token/exchange', {
    public_token: publicToken,
  })

  await ledgerDb.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      plaidAccessTokenEncrypted: encryptSecret(res.access_token),
      plaidItemId: res.item_id,
      plaidSyncCursor: null,
    },
  })
}

type PlaidWebhookPayload = {
  webhook_type?: string
  webhook_code?: string
  item_id?: string
}

export async function verifyPlaidWebhook(req: Request, rawBody: Buffer): Promise<void> {
  const token = req.headers.get('plaid-verification')?.trim()
  if (!token) throw new ApiError(401, 'Missing Plaid-Verification header')

  const header = decodeProtectedHeader(token)
  const keyRes = await plaidRequest<{ key?: { alg?: string; kid?: string; kty?: string; crv?: string; x?: string; y?: string; use?: string } }>(
    '/webhook_verification_key/get',
    { key_id: header.kid },
  )
  if (!keyRes.key) throw new ApiError(401, 'Unable to fetch Plaid verification key')

  const key = await importJWK(keyRes.key as never, keyRes.key.alg ?? 'ES256')
  const { payload } = await jwtVerify(token, key, { maxTokenAge: '5 min' })
  const claimedHash = String((payload as { request_body_sha256?: string }).request_body_sha256 ?? '')
  const actualHash = createHash('sha256').update(rawBody).digest('hex')
  const a = Buffer.from(claimedHash)
  const b = Buffer.from(actualHash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'Plaid webhook body hash mismatch')
  }
}

export async function handlePlaidWebhook(payload: PlaidWebhookPayload): Promise<void> {
  if (payload.webhook_type !== 'TRANSACTIONS') return
  if (!payload.item_id) return

  const accounts = await ledgerDb.bankAccount.findMany({
    where: { plaidItemId: payload.item_id, isActive: true },
  })

  for (const acct of accounts) {
    if (!acct.plaidAccessTokenEncrypted) continue
    await syncPlaidTransactions(acct.tenantId, acct.id)
  }
}

export async function syncPlaidTransactions(tenantId: string, bankAccountId: string) {
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id: bankAccountId, tenantId } })
  if (!acct?.plaidAccessTokenEncrypted) throw new ApiError(400, 'Bank account is not linked to Plaid')

  const accessToken = decryptSecret(acct.plaidAccessTokenEncrypted)
  const res = await plaidRequest<{
    added: Array<{ date: string; name: string; amount: number; transaction_id: string }>
    modified: Array<{ date: string; name: string; amount: number; transaction_id: string }>
    removed: Array<{ transaction_id: string }>
    next_cursor: string
    has_more: boolean
  }>('/transactions/sync', {
    access_token: accessToken,
    cursor: acct.plaidSyncCursor ?? undefined,
  })

  const incoming = [...res.added, ...res.modified]
  const refIds = incoming.map((t) => t.transaction_id).filter(Boolean)

  if (refIds.length > 0) {
    const existing = await ledgerDb.bankStatementLine.findMany({
      where: {
        tenantId,
        bankAccountId,
        reference: { in: refIds },
      },
    })
    const existingMap = new Map(existing.map((e) => [e.reference, e]))

    for (const tx of incoming) {
      const existingLine = existingMap.get(tx.transaction_id)
      if (existingLine) {
        if (!existingLine.reconciled) {
          await ledgerDb.bankStatementLine.update({
            where: { id: existingLine.id },
            data: {
              postedAt: new Date(tx.date),
              description: tx.name.trim(),
              amount: new Prisma.Decimal(-tx.amount),
            },
          })
        }
      } else {
        await ledgerDb.bankStatementLine.create({
          data: {
            tenantId,
            bankAccountId,
            postedAt: new Date(tx.date),
            description: tx.name.trim(),
            amount: new Prisma.Decimal(-tx.amount),
            reference: tx.transaction_id,
          },
        })
      }
    }
  }

  if (res.removed?.length) {
    const removedIds = res.removed.map((r) => r.transaction_id).filter(Boolean)
    if (removedIds.length > 0) {
      await ledgerDb.bankStatementLine.deleteMany({
        where: {
          tenantId,
          bankAccountId,
          reference: { in: removedIds },
          reconciled: false,
        },
      })
    }
  }

  await ledgerDb.bankAccount.update({
    where: { id: bankAccountId },
    data: { plaidSyncCursor: res.next_cursor },
  })

  if (res.has_more) {
    await syncPlaidTransactions(tenantId, bankAccountId)
  }
}
