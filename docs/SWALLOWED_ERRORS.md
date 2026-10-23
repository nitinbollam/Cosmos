# Swallowed errors (PLR-159)

Every `.catch(() => undefined|null)` in `apps/web/lib/server` as of this change (77 sites in 27 files),
classified by what a lost error would cost. The count is enforced by `scripts/check-code-health.mjs`
(part of `npm run lint` in `apps/web`): a file may not gain a new swallow. When you fix a site, run
`node scripts/check-code-health.mjs --update` to lower the baseline.

| Class | Meaning | What to do |
|---|---|---|
| **A** | Fire-and-forget by design: a notification, audit line, domain event or cache push. Losing it is acceptable. | Use `fireAndForget(label, work, { tenantId, orderId })`, which logs with context and counts a metric. |
| **B** | Best-effort cleanup or a lookup with a safe fallback. | `fireAndForget(..., { level: 'warn' })`, or handle and log at the call site. |
| **C** | Money, stock or order state. A lost error leaves the books or the order wrong with no signal. | Propagate the error, or queue the work through the posting outbox so a worker retries it. Never swallow. |

A new swallow that is genuinely safe goes on a line with `// swallow-ok: <reason>`.

## Class C: fixed (28 sites, PLR-159)

Fixed in open pull requests (6): `order-saga.ts:5` and `order-orchestration.ts:217` (#69), and
`order-orchestration.ts:455, 456, 465, 469` (#70, cancel).

Still to fix, grouped by area, one PR per area after the open PRs merge (22):

| Area | Site | What is lost today | Fix |
|---|---|---|---|
| Payments | `payments.ts:180`, `:545` | Invoice not re-synced after a payment, so paid amount and status drift | Propagate; the payment is already recorded, so return a retryable error or queue a sync — **done** |
| Payments | `order-payment-admin.ts:125`, `:283` | Same, after a manual payment or refund | Same — **done** |
| Payments | `order-payment-admin.ts:129` | AR payment journal not posted | Enqueue through the posting outbox (phase 2) — **done** |
| Payments | `order-payment-admin.ts:314` | Authorization not voided | Propagate — **done** |
| Payments | `stripe-webhook-events.ts:47` | If the dedupe row is not deleted after a failure, Stripe's retry is ignored | Log and surface; do not swallow — **done** |
| Orders | `orders.ts:225`, `:409` | Invoice not synced after order create / payment | Propagate or queue — **done** |
| Orders | `orders.ts:399` | Customer credit not released after payment | Propagate — **done** |
| Orders | `orders.ts:414` | AR payment journal not posted | Outbox — **done** |
| Invoices | `invoices.ts:727` | Credit not released after a credit memo | Propagate — **done** |
| Invoices | `invoices.ts:765` | Invoice not synced after a refund | Propagate or queue — **done** |
| Purchasing | `ap-bills.ts:305`, `po-receiving.ts:303` | AP payment journal not posted | Outbox — **done** |
| Purchasing | `po-receiving.ts:300` | Bill payment not recorded | Propagate — **done** |
| Inventory | `inventory.ts:288` | Backorders not filled after a receipt | Propagate or queue — **done** |
| Delivery | `dispatch.ts:380` | Order not moved to DELIVERED after the stop was delivered | Propagate — **done** |
| Subscriptions | `subscriptions.ts:188` | Failed-payment order not cancelled (stock and credit stay held) | Log with order id and queue a retry; cancel now reports its failed step (#70) — **done** |
| Billing | `billing.ts:133`, `:142`, `:184` | Tenant plan not updated after a Stripe event | Propagate so the webhook is retried — **done** |

## Class A: `fireAndForget` / `swallowed` (done, PLR-159)

`notification-triggers.ts` (9, all notifications), `payments.ts:151, 152, 253, 256` (order-created
notification and the pipeline kick-off, which logs its own failure since #69), `orders.ts:237, 449`,
`invoices.ts:108, 127`, `inventory.ts:9, 706`, `order-orchestration.ts:402, 404`,
`subscriptions.ts:201, 230`, `routes/gift-cards.ts:51`, `crm.ts:127`, `celestial/orchestrator.ts:175`,
`pos.ts:293, 360`, `wms-fulfillment.ts:285, 331`, `wms-receiving.ts:254`, `stripe-connect.ts:178`.

## Class B: best effort, logged at warn (done, PLR-159)

`auth.ts:118` (legacy token clear), `auth-security.ts:61` (rate-limit bucket prune),
`payment-idempotency.ts:20, 68`, `saved-payment-methods.ts:74`, `marketplace-buyer-payments.ts:103`
(provider detach), `ap-bills.ts:266` (three-way match, recoverable), `stripe-connect.ts:160` (dispute
audit), `routes/gift-cards.ts:29` and `orders.ts:461` (lookups with a safe fallback),
`compliance-age.ts:189, 211, 231, 259, 272, 313, 331` (compliance audit lines: failures should at least
be visible, so these move to `fireAndForget` at warn level and are worth a metric alert).

## Money handling

`lib/server/money.ts` is the single place for money arithmetic (Decimal internally, integer cents at
boundaries, decimal strings in API output, ROUND_HALF_UP to 2 places, largest-remainder `allocate`).

Done in PLR-159: base-currency conversion (`fx-util.toBaseDecimal`) and the revenue/tax split
(`splitBaseAmounts`) work in decimal, so `1.005` converts to `1.01` rather than `1.00`. A property test
(`order-invoice-ledger.property.test.ts`, 60 random orders, partial shipments, tax rates up to 12.5%,
random FX) proves order total = sum of invoices = ledger AR, revenue + tax = AR, and tax payable =
invoiced tax, to the cent.

API convention: money leaves the API as a two-decimal string via `formatMoney`; amounts that arrive as
JSON numbers are converted once with `fromFloat`. Display formatting is covered by tests.

Enforcement: `check-code-health.mjs` counts `.toFixed(` and `new Decimal(<non-literal>)` outside
`money.ts`. The baseline is the allow-list: no file may exceed its count (84 `toFixed`, 131
`new Decimal(x)` today, mostly display formatting and reads of Prisma Decimals). `--money=strict`
fails on any remaining site and is the target once the per-area migrations are finished; a site that is
correct as written carries `// money-ok: <reason>`.

Remaining migration order (one PR per area): tax-reclass and credit-limit, payments, orders,
reports, purchasing, then API output as strings everywhere.


## How it is enforced now

- `scripts/check-code-health.mjs` (run by the `apps/web` lint script) has a swallow baseline of zero. A new `.catch(() => undefined|null|{})` or empty `catch {}` fails lint.
- Work that is safe to lose uses `fireAndForget(label, work, ctx)` when nothing waits on it, or `.catch(swallowed(label, ctx))` when the promise is awaited or chained. Both log the label and context and count `[metric] fire_and_forget_failed`.
- Where a swallow is genuinely correct, add `// swallow-ok: <reason>` to the line.
- Class C work goes through `lib/server/deferred-work.ts` (`attemptOrQueue`, `syncInvoiceOrQueue`) or the posting outbox: it is tried inline, queued with backoff on failure, and only throws if it cannot even be queued (`[metric] deferred_work_lost`).
