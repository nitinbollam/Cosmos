import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import * as invoices from '../invoices'
import * as apBills from '../ap-bills'
import * as payments from '../payments'
import * as stripeConnect from '../stripe-connect'
import * as paymentIdempotency from '../payment-idempotency'
import * as savedPaymentMethods from '../saved-payment-methods'
import * as ledger from '../ledger'
import * as financialStatements from '../financial-statements'
import { buildIncomeStatementPdf } from '../financial-statement-document'
import * as bankRecon from '../bank-recon'
import * as fixedAssets from '../fixed-assets'
import * as complianceTax from '../compliance-tax'
import { getTenantTaxSettings } from '../tenant-tax'
import * as orders from '../orders'
import { ApiError, requireSession, requirePermission, assertPermission, assertRole, ADMIN_ROLES, assertNotBuyer, requireIdempotencyKey } from './common'

export async function routeInvoices(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await invoices.listInvoices(
        session.tenantId,
        +(url.searchParams.get('page') ?? 1),
        +(url.searchParams.get('pageSize') ?? 50),
        {
          status: url.searchParams.get('status') ?? undefined,
          customerId: buyerCustomerId ? undefined : url.searchParams.get('customerId') ?? undefined,
          excludeCancelled: url.searchParams.get('excludeCancelled') === '1',
        },
        buyerOpts,
      ),
    )
  }
  if (seg.length === 2 && seg[1] === 'ar-summary' && method === 'GET') {
    assertNotBuyer(session)
    return Response.json(await invoices.getArSummary(session.tenantId))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await invoices.getInvoice(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'html' && method === 'GET') {
    const html = await invoices.getInvoiceHtmlDocument(session.tenantId, seg[1], buyerOpts)
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${seg[1].slice(0, 8)}-invoice.html"`,
      },
    })
  }
  if (seg.length === 3 && seg[2] === 'pdf' && method === 'GET') {
    const { pdf, invoiceNumber } = await invoices.getInvoicePdfDocument(session.tenantId, seg[1], buyerOpts)
    const safeName = invoiceNumber.replace(/[^\w.-]+/g, '_').slice(0, 64) || seg[1].slice(0, 8)
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      },
    })
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    const body = (await req.json()) as { amount: number; method: string; reference?: string }
    if (isPortalBuyer(session.role)) {
      /* buyer-scoped via getInvoice in recordInvoicePayment */
    } else {
      assertPermission(session, 'finance.write')
    }
    return Response.json(await invoices.recordInvoicePayment(session.tenantId, seg[1], body, buyerOpts))
  }
  if (seg.length === 4 && seg[2] === 'pay' && seg[3] === 'stripe' && method === 'POST') {
    if (isPortalBuyer(session.role)) {
      /* scoped in payInvoiceWithStripe */
    } else {
      assertPermission(session, 'finance.write')
    }
    const body = (await req.json()) as { paymentMethodId: string; amount?: number; correlationId: string }
    if (!body.paymentMethodId || !body.correlationId) throw new ApiError(400, 'paymentMethodId and correlationId required')
    return Response.json(await invoices.payInvoiceWithStripe(session.tenantId, seg[1], body, buyerOpts))
  }
  throw new ApiError(404, 'Invoice route not found')
}

export async function routeBills(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    assertPermission(session, 'finance.read')
    return Response.json(
      await apBills.listVendorBills(session.tenantId, url.searchParams.get('status') ?? undefined, {
        startDate: url.searchParams.get('startDate') ?? undefined,
        endDate: url.searchParams.get('endDate') ?? undefined,
      }),
    )
  }
  if (seg.length === 2 && method === 'GET') {
    assertPermission(session, 'finance.read')
    return Response.json(await apBills.getVendorBill(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'POST' && seg[1] === 'from-po') {
    await requirePermission(req, 'finance.write')
    const body = (await req.json()) as apBills.CreateBillFromPoInput
    return Response.json(await apBills.createBillFromPurchaseOrder(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    await requirePermission(req, 'finance.write')
    const body = (await req.json()) as { amount: number; method: string; reference?: string }
    return Response.json(await apBills.recordBillPayment(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'match' && method === 'POST') {
    await requirePermission(req, 'finance.write')
    return Response.json(await apBills.runThreeWayMatch(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Bill route not found')
}

export async function routePayments(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg[1] === 'stripe' && seg[2] === 'status' && method === 'GET') {
    return Response.json(payments.stripeIntegrationStatus())
  }
  if (seg[1] === 'webhook' && seg[2] === 'stripe' && method === 'POST') {
    const sig = req.headers.get('stripe-signature') ?? ''
    const raw = Buffer.from(await req.arrayBuffer())
    const result = await payments.handleStripeWebhook(raw, sig)
    if (!result.received) return Response.json(result, { status: 400 })
    return Response.json(result)
  }

  const session = await requireSession(req)

  if (seg[1] === 'stripe' && seg[2] === 'config' && method === 'GET') {
    return Response.json(await payments.stripeClientConfig(session.tenantId))
  }
  if (seg[1] === 'stripe' && seg[2] === 'connect' && seg[3] === 'status' && method === 'GET') {
    assertRole(session, ADMIN_ROLES)
    return Response.json(await stripeConnect.getConnectStatus(session.tenantId))
  }
  if (seg[1] === 'stripe' && seg[2] === 'connect' && seg[3] === 'onboard' && method === 'POST') {
    assertRole(session, ADMIN_ROLES)
    const body = (await req.json().catch(() => ({}))) as { email?: string }
    return Response.json(await stripeConnect.startConnectOnboarding(session.tenantId, body.email))
  }
  if (seg[1] === 'stripe' && seg[2] === 'connect' && seg[3] === 'refresh' && method === 'POST') {
    assertRole(session, ADMIN_ROLES)
    return Response.json(await stripeConnect.createConnectAccountLink(session.tenantId, 'account_update'))
  }

  if (seg.length === 2 && seg[1] === 'authorize' && method === 'POST') {
    const key = requireIdempotencyKey(req)
    const cached = await paymentIdempotency.getIdempotentResponse(session.tenantId, key)
    if (cached) return Response.json(cached.body, { status: cached.status })
    const body = (await req.json()) as payments.AuthorizeInput
    // Buyers can authorize payment only against their own orders.
    if (isPortalBuyer(session.role)) {
      const buyerCustomerId = await requirePortalCustomerId(session)
      const order = await orders.findOrderById(session.tenantId, body.orderId, { buyerCustomerId })
      if (order.customerId !== buyerCustomerId) throw new ApiError(403, 'Forbidden')
    }
    const result = await payments.authorize(session.tenantId, body)
    await paymentIdempotency.setIdempotentResponse(key, session.tenantId, 200, result)
    return Response.json(result)
  }

  if (seg.length === 2 && seg[1] === 'confirm' && method === 'POST') {
    requireIdempotencyKey(req)
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string }
    const buyerCustomerId = isPortalBuyer(session.role) ? await requirePortalCustomerId(session) : undefined
    return Response.json(
      await payments.completeCardAuthorization(session.tenantId, body.paymentIntentId, body.correlationId, {
        buyerCustomerId,
      }),
    )
  }

  // Capture, void, and refund are back-office operations.
  assertPermission(session, 'finance.write')

  if (seg.length === 2 && seg[1] === 'capture' && method === 'POST') {
    const key = requireIdempotencyKey(req)
    const cached = await paymentIdempotency.getIdempotentResponse(session.tenantId, key)
    if (cached) return Response.json(cached.body, { status: cached.status })
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string }
    const result = await payments.capture(session.tenantId, body.paymentIntentId, body.correlationId)
    await paymentIdempotency.setIdempotentResponse(key, session.tenantId, 200, result)
    return Response.json(result)
  }
  if (seg.length === 2 && seg[1] === 'void' && method === 'POST') {
    const key = requireIdempotencyKey(req)
    const cached = await paymentIdempotency.getIdempotentResponse(session.tenantId, key)
    if (cached) return Response.json(cached.body, { status: cached.status })
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string }
    const result = await payments.voidIntent(session.tenantId, body.paymentIntentId, body.correlationId)
    await paymentIdempotency.setIdempotentResponse(key, session.tenantId, 200, result)
    return Response.json(result)
  }
  if (seg.length === 2 && seg[1] === 'refund' && method === 'POST') {
    const key = requireIdempotencyKey(req)
    const cached = await paymentIdempotency.getIdempotentResponse(session.tenantId, key)
    if (cached) return Response.json(cached.body, { status: cached.status })
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string; amount?: number }
    const result = await payments.refund(session.tenantId, body.paymentIntentId, body.amount, body.correlationId)
    await paymentIdempotency.setIdempotentResponse(key, session.tenantId, 200, result)
    return Response.json(result)
  }

  throw new ApiError(404, 'Payment route not found')
}

export async function routeSavedPaymentMethods(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const buyerCustomerId = await requirePortalCustomerId(session)
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await savedPaymentMethods.listSavedPaymentMethods(session.tenantId, buyerCustomerId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof savedPaymentMethods.savePaymentMethod>[2]
    return Response.json(await savedPaymentMethods.savePaymentMethod(session.tenantId, buyerCustomerId, body), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'default' && method === 'POST') {
    return Response.json(await savedPaymentMethods.setDefaultPaymentMethod(session.tenantId, buyerCustomerId, seg[1]))
  }
  if (seg.length === 2 && method === 'DELETE') {
    return Response.json(await savedPaymentMethods.deleteSavedPaymentMethod(session.tenantId, buyerCustomerId, seg[1]))
  }
  throw new ApiError(404, 'Saved payment method route not found')
}

export async function routeJournalEntries(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'finance.read' : 'finance.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    const filters = {
      fromIso: url.searchParams.get('fromIso') ?? undefined,
      toIso: url.searchParams.get('toIso') ?? undefined,
      accountId: url.searchParams.get('accountId') ?? undefined,
      postedOnly: url.searchParams.has('postedOnly')
        ? url.searchParams.get('postedOnly') === 'true'
        : undefined,
    }
    return Response.json(await ledger.listJournalEntries(session.tenantId, filters))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await ledger.getJournalEntry(session.tenantId, seg[1]))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as ledger.CreateJournalEntryInput
    return Response.json(await ledger.createJournalDraft(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'post' && method === 'POST') {
    return Response.json(await ledger.postJournalEntry(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Journal entry route not found')
}

export async function routeChartAccounts(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'finance.read' : 'finance.write')

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await ledger.listChartAccounts(session.tenantId))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await ledger.getChartAccount(session.tenantId, seg[1]))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as ledger.CreateChartAccountInput
    return Response.json(await ledger.createChartAccount(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as { name?: string; isActive?: boolean }
    return Response.json(await ledger.patchChartAccount(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'Chart account route not found')
}

export async function routeBankAccounts(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'finance.read' : 'finance.write')
  const url = new URL(req.url)
  if (seg.length === 1 && method === 'GET') {
    if (url.searchParams.get('summary') === 'true') {
      return Response.json(
        await bankRecon.getReconciliationSummary(session.tenantId, {
          startDate: url.searchParams.get('startDate') ?? undefined,
          endDate: url.searchParams.get('endDate') ?? undefined,
        }),
      )
    }
    return Response.json(await bankRecon.listBankAccounts(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof bankRecon.createBankAccount>[1]
    return Response.json(await bankRecon.createBankAccount(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && seg[1] === 'lines' && method === 'GET') {
    return Response.json(
      await bankRecon.listStatementLines(session.tenantId, {
        bankAccountId: url.searchParams.get('bankAccountId') ?? undefined,
        reconciled: url.searchParams.has('reconciled') ? url.searchParams.get('reconciled') === 'true' : undefined,
        type: (url.searchParams.get('type') as 'DEBIT' | 'CREDIT' | 'ALL') ?? undefined,
        startDate: url.searchParams.get('startDate') ?? undefined,
        endDate: url.searchParams.get('endDate') ?? undefined,
      }),
    )
  }
  if (seg.length === 2 && seg[1] === 'unreconciled' && method === 'GET') {
    const bankAccountId = url.searchParams.get('bankAccountId') ?? undefined
    return Response.json(await bankRecon.listUnreconciledLines(session.tenantId, bankAccountId))
  }
  if (seg.length === 3 && seg[2] === 'import' && method === 'POST') {
    const body = (await req.json()) as {
      lines: Array<{ postedAt: string; description: string; amount: number; reference?: string }>
    }
    return Response.json(await bankRecon.importStatementLines(session.tenantId, seg[1], body.lines ?? []), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'reconcile' && method === 'POST') {
    return Response.json(await bankRecon.reconcileStatementLine(session.tenantId, seg[1]))
  }
  if (seg.length === 4 && seg[2] === 'plaid' && seg[3] === 'link-token' && method === 'POST') {
    const { createLinkToken } = await import('../plaid')
    return Response.json(await createLinkToken(session.tenantId, session.userId))
  }
  if (seg.length === 4 && seg[2] === 'plaid' && seg[3] === 'exchange' && method === 'POST') {
    const body = (await req.json()) as { publicToken?: string }
    if (!body.publicToken?.trim()) throw new ApiError(400, 'publicToken required')
    const { exchangePublicToken } = await import('../plaid')
    await exchangePublicToken(session.tenantId, seg[1]!, body.publicToken.trim())
    return Response.json({ ok: true })
  }
  if (seg.length === 4 && seg[2] === 'plaid' && seg[3] === 'sync' && method === 'POST') {
    const { syncPlaidTransactions } = await import('../plaid')
    return Response.json(await syncPlaidTransactions(session.tenantId, seg[1]!))
  }
  throw new ApiError(404, 'Bank account route not found')
}

export async function routeFixedAssets(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'finance.read' : 'finance.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await fixedAssets.listFixedAssets(session.tenantId, url.searchParams.get('status') ?? undefined))
  }
  if (seg.length === 2 && seg[1] === 'summary' && method === 'GET') {
    return Response.json(await fixedAssets.getFixedAssetSummary(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as fixedAssets.CreateFixedAssetInput
    return Response.json(await fixedAssets.createFixedAsset(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && seg[1] === 'post-depreciation' && method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { date?: string }
    return Response.json(await fixedAssets.postMonthlyDepreciation(session.tenantId, body.date))
  }
  if (seg.length === 3 && seg[2] === 'dispose' && method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { disposalDate?: string; proceeds?: number }
    return Response.json(await fixedAssets.disposeFixedAsset(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'Fixed asset route not found')
}

export async function routeTax(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'settings' && method === 'GET') {
    return Response.json(await getTenantTaxSettings(session.tenantId))
  }

  assertNotBuyer(session)
  assertPermission(session, method === 'GET' ? 'compliance.read' : 'compliance.write')

  if (seg.length === 2 && seg[1] === 'settings' && method === 'PATCH') {
    assertPermission(session, 'compliance.write')
    const body = (await req.json()) as { salesTaxRate?: number }
    if (typeof body.salesTaxRate !== 'number' || body.salesTaxRate < 0 || body.salesTaxRate > 0.5) {
      throw new ApiError(400, 'salesTaxRate must be a number between 0 and 0.5')
    }
    const { updateTenantSalesTaxRate } = await import('../tenant-tax')
    return Response.json(await updateTenantSalesTaxRate(session.tenantId, body.salesTaxRate))
  }
  if (seg.length === 2 && seg[1] === 'summary' && method === 'GET') {
    return Response.json(await complianceTax.taxSummary(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'record' && method === 'POST') {
    assertPermission(session, 'compliance.write')
    const body = (await req.json()) as complianceTax.RecordTaxInput
    return Response.json(await complianceTax.recordTax(session.tenantId, body))
  }
  throw new ApiError(404, 'Tax route not found')
}

export async function routeFinancialStatements(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'finance.read')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'income-statement' && method === 'GET') {
    const fromIso = url.searchParams.get('fromIso')
    const toIso = url.searchParams.get('toIso')
    if (!fromIso || !toIso) throw new ApiError(400, 'fromIso and toIso are required')
    return Response.json(await financialStatements.getIncomeStatement(session.tenantId, fromIso, toIso))
  }

  if (seg.length === 3 && seg[1] === 'income-statement' && seg[2] === 'pdf' && method === 'GET') {
    const fromIso = url.searchParams.get('fromIso')
    const toIso = url.searchParams.get('toIso')
    if (!fromIso || !toIso) throw new ApiError(400, 'fromIso and toIso are required')
    const statement = await financialStatements.getIncomeStatement(session.tenantId, fromIso, toIso)
    const pdf = await buildIncomeStatementPdf(session.tenantId, statement)
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="income-statement-${fromIso}-to-${toIso}.pdf"`,
      },
    })
  }

  if (seg.length === 2 && seg[1] === 'balance-sheet' && method === 'GET') {
    const asOfIso = url.searchParams.get('asOfIso')
    if (!asOfIso) throw new ApiError(400, 'asOfIso is required')
    return Response.json(await financialStatements.getBalanceSheet(session.tenantId, asOfIso))
  }

  throw new ApiError(404, 'Financial statement route not found')
}
