import { createHash, timingSafeEqual } from 'node:crypto'
import { decodeProtectedHeader, jwtVerify, importJWK } from 'jose'
import { BankReconciliationStatus, BankStatementSource, Prisma } from '@/generated/prisma-ledger'
import { bankLockBoundary } from './bank-period-lock'
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
    where: { id: bankAccountId, tenantId },
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
    try {
      await syncPlaidTransactions(acct.tenantId, acct.id)
    } catch (e) {
      // A refused page is recorded on the account's audit trail and retried by the next sync;
      // it must not stop the other accounts of this item.
      if (e instanceof ApiError && e.status === 409) {
        console.warn(`[plaid] sync of bank account ${acct.id} held: ${e.message}`)
        continue
      }
      throw e
    }
  }
}

type PlaidTxn = { date: string; name: string; amount: number; transaction_id: string }
type PlaidSyncPage = {
  added: PlaidTxn[]
  modified: PlaidTxn[]
  removed: Array<{ transaction_id: string }>
  next_cursor: string
  has_more: boolean
}
type FrozenChange = { transactionId: string; date: string; change: 'add' | 'modify' | 'remove' }

export type PlaidSyncResult = { pages: number; added: number; modified: number; removed: number; held: number }

/** Thrown inside a page transaction to roll it back; reported as 409 after the rollback. */
class FrozenPeriodPage extends Error {
  constructor(
    readonly lockedThrough: Date,
    readonly reconciliationId: string | null,
    readonly changes: FrozenChange[],
  ) {
    super('Plaid page touches a signed-off period')
  }
}

/**
 * Pulls /transactions/sync pages until has_more is false. Each page is applied in one ledger
 * transaction together with its cursor, so the cursor never moves past a transaction that was not
 * stored. A page that would add, change or delete a line dated inside a signed-off reconciliation
 * period is refused as a whole (409, recorded as a bank_statement.plaid_sync_blocked event) and the
 * cursor stays where it was: reopen that period and sync again to apply it.
 */
export async function syncPlaidTransactions(tenantId: string, bankAccountId: string, actorUserId?: string): Promise<PlaidSyncResult> {
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id: bankAccountId, tenantId } })
  if (!acct?.plaidAccessTokenEncrypted) throw new ApiError(400, 'Bank account is not linked to Plaid')

  const accessToken = decryptSecret(acct.plaidAccessTokenEncrypted)
  const total: PlaidSyncResult = { pages: 0, added: 0, modified: 0, removed: 0, held: 0 }
  let cursor = acct.plaidSyncCursor
  for (;;) {
    const page = await plaidRequest<PlaidSyncPage>('/transactions/sync', {
      access_token: accessToken,
      cursor: cursor ?? undefined,
    })
    const applied = await applyPlaidPage(tenantId, bankAccountId, cursor, page, actorUserId)
    total.pages++
    total.added += applied.added
    total.modified += applied.modified
    total.removed += applied.removed
    total.held += applied.held
    cursor = page.next_cursor
    if (!page.has_more) return total
  }
}

async function applyPlaidPage(
  tenantId: string,
  bankAccountId: string,
  cursor: string | null,
  page: PlaidSyncPage,
  actorUserId?: string,
) {
  const incoming = [...(page.added ?? []), ...(page.modified ?? [])]
  const removedIds = (page.removed ?? []).map((r) => r.transaction_id).filter(Boolean)
  try {
    return await ledgerDb.$transaction(
      async (tx) => {
        // Lock the account and claim the cursor in one write: a concurrent sync of the same page
        // loses here, and sign-off, imports and matching of this account (lockBankAccount) wait.
        const claimed = await tx.bankAccount.updateMany({
          where: { id: bankAccountId, tenantId, plaidSyncCursor: cursor },
          data: { updatedAt: new Date() },
        })
        if (claimed.count !== 1) throw new ApiError(409, 'Another Plaid sync of this bank account ran at the same time; sync again')

        // Signed-off reconciliation periods are frozen: no Plaid edit, insert or delete may change them.
        const boundary = await bankLockBoundary(tx, tenantId, bankAccountId)
        const isFrozen = (d: Date) => boundary !== null && d < boundary
        const refs = [...new Set([...incoming.map((t) => t.transaction_id), ...removedIds].filter(Boolean))]
        const existing = refs.length
          ? await tx.bankStatementLine.findMany({
              where: { tenantId, bankAccountId, reference: { in: refs } },
              include: { matchItems: { select: { activeStatementLineId: true } } },
            })
          : []
        const byRef = new Map(existing.map((e) => [e.reference, e]))

        const frozen: FrozenChange[] = []
        // Changes Plaid reports for a matched line are not applied over the match; the event keeps them.
        const held: Record<string, string>[] = []
        const creates = new Map<string, Prisma.BankStatementLineCreateManyInput>()
        const updates: { id: string; postedAt: Date; description: string; amount: Prisma.Decimal }[] = []
        const deletes: string[] = []

        for (const t of incoming) {
          const postedAt = new Date(t.date)
          const description = t.name.trim()
          const amount = new Prisma.Decimal(-t.amount)
          const line = byRef.get(t.transaction_id)
          if (!line) {
            if (isFrozen(postedAt)) frozen.push({ transactionId: t.transaction_id, date: t.date, change: 'add' })
            else {
              creates.set(t.transaction_id, {
                tenantId,
                bankAccountId,
                postedAt,
                description,
                amount,
                reference: t.transaction_id,
                source: BankStatementSource.PLAID,
              })
            }
            continue
          }
          const unchanged =
            +line.postedAt === +postedAt && line.description === description && new Prisma.Decimal(line.amount).equals(amount)
          if (unchanged) continue
          if (line.lockedAt || isFrozen(line.postedAt) || isFrozen(postedAt)) {
            frozen.push({ transactionId: t.transaction_id, date: t.date, change: 'modify' })
          } else if (line.reconciled || line.matchItems.some((i) => i.activeStatementLineId)) {
            held.push({ transactionId: t.transaction_id, change: 'modify', date: t.date, amount: amount.toFixed(2), description }) // money-ok: Decimal to 2-decimal string
          } else {
            updates.push({ id: line.id, postedAt, description, amount })
          }
        }
        for (const id of removedIds) {
          const line = byRef.get(id)
          if (!line) {
            creates.delete(id)
            continue
          }
          if (line.lockedAt || isFrozen(line.postedAt)) {
            frozen.push({ transactionId: id, date: line.postedAt.toISOString().slice(0, 10), change: 'remove' })
          } else if (line.reconciled || line.matchItems.length) {
            // Lines with match history are kept: the match items reference them.
            held.push({ transactionId: id, change: 'remove' })
          } else {
            deletes.push(line.id)
          }
        }

        if (frozen.length) {
          const signed = await tx.bankReconciliation.findFirst({
            where: { tenantId, bankAccountId, status: BankReconciliationStatus.SIGNED_OFF },
            orderBy: { periodEnd: 'desc' },
            select: { id: true },
          })
          throw new FrozenPeriodPage(boundary!, signed?.id ?? null, frozen)
        }

        if (creates.size) await tx.bankStatementLine.createMany({ data: [...creates.values()] })
        for (const u of updates) {
          await tx.bankStatementLine.update({
            where: { id: u.id, tenantId },
            data: { postedAt: u.postedAt, description: u.description, amount: u.amount },
          })
        }
        if (deletes.length) await tx.bankStatementLine.deleteMany({ where: { tenantId, id: { in: deletes } } })
        await tx.bankAccount.update({ where: { id: bankAccountId, tenantId }, data: { plaidSyncCursor: page.next_cursor } })

        const counts = { added: creates.size, modified: updates.length, removed: deletes.length, held: held.length }
        if (counts.added || counts.modified || counts.removed || counts.held) {
          await tx.bankReconciliationEvent.create({
            data: {
              tenantId,
              bankAccountId,
              action: 'bank_statement.plaid_synced',
              userId: actorUserId ?? null,
              metadata: { ...counts, held },
            },
          })
        }
        return counts
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
  } catch (e) {
    if (e instanceof FrozenPeriodPage) {
      const through = new Date(e.lockedThrough.getTime() - 86_400_000).toISOString().slice(0, 10)
      try {
        await ledgerDb.bankReconciliationEvent.create({
          data: {
            tenantId,
            bankAccountId,
            reconciliationId: e.reconciliationId,
            action: 'bank_statement.plaid_sync_blocked',
            userId: actorUserId ?? null,
            metadata: { lockedThrough: through, cursorKept: true, transactions: e.changes },
          },
        })
      } catch (err) {
        console.error('[plaid] could not record the refused sync page:', err)
      }
      throw new ApiError(
        409,
        `${e.changes.length} Plaid transaction(s) fall in the signed-off reconciliation period through ${through}. ` +
          'Nothing from this sync page was saved and the sync position was kept; reopen that period with a reason, then sync again.',
        undefined,
        e.changes,
      )
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code)) {
      throw new ApiError(409, 'Another change to this bank account happened at the same time; sync again')
    }
    throw e
  }
}
