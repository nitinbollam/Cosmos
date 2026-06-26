# Production Readiness

Status of the go-live blockers identified in the customer/production readiness audit, and what was done to close them. Last updated: June 10, 2026.

## The 5 go-live blockers — all closed

| # | Blocker | Resolution |
|---|---------|------------|
| 1 | Shipping never decremented inventory | `commitShipmentForOrder` decrements on-hand, fulfills reservations, and writes `STOCK_SHIPPED` ledger entries on dispatch and POS sale. Expired reservations are swept every 10 minutes by an in-process background job. |
| 2 | Open `/auth/register` (tenant takeover) | Endpoint removed. Joining a tenant now requires an admin-issued invite token (`/auth/accept-invite`). Self-serve `/auth/signup` still creates a brand-new tenant only. |
| 3 | RBAC was dead code | Every route in `native-router.ts` enforces role guards (`requireRole` / `assertRole` / `assertNotBuyer`). Buyer IDOR on shipments and quote counter-offers fixed with ownership checks. |
| 4 | Books were wrong | Revenue posts once at invoice issuance (Dr AR / Cr Revenue); payment capture posts Dr Cash / Cr AR. Cancellations void/refund captured charges; credit memos reverse COGS and refund payments. GL posting failures are logged, never swallowed. |
| 5 | No SaaS plumbing | Invites carry tokens, are emailed (SendGrid or console fallback), and are accepted via `/accept-invite`. Forgot/reset/change password flows shipped. Terms and Privacy pages exist with signup consent. |

## Security hardening

- **Password policy** — 10+ characters with a letter and a number, enforced server-side on signup, invite accept, reset, and change.
- **Rate limiting** — login (per IP and per email), signup, forgot/reset password, invite accept, change password. In-memory fixed window; move to Redis for multi-replica deployments.
- **Session revalidation** — JWTs are re-checked against the user row (active flag + current role) with a 60-second cache, so deactivations and demotions take effect within a minute.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production.
- **XSS** — invoice HTML escapes all user-controlled values.
- **SSRF** — webhook URLs are validated against private/link-local/metadata IP ranges (at create time and again at send time) and payloads are HMAC-signed (`X-Pleros-Signature`).
- **Idempotency** — payment capture/refund and Stripe webhook processing are tenant-scoped idempotent.

## Identity & onboarding

- Invite flow: admin creates invite → token link emailed (and shown once in the UI for copy/paste) → `/accept-invite` page sets name + password → buyer-portal users (email matches a CRM customer) land in `/catalog`, staff land in `/admin`.
- Buyer provisioning: "Invite to buyer portal" button on the CRM customer detail page.
- Password lifecycle: `/forgot-password`, `/reset-password` (30-minute token, sessions revoked on reset), and change-password in Settings → Users.
- Tax settings UI in Settings → Company (PATCH `/tax/settings`, admin only).
- User role management in Settings → Users (PATCH `/users/:id`, self-demotion blocked).

## SaaS billing & identity (added June 10, 2026)

- **Stripe Billing** — `POST /tenants/me/billing/checkout` opens Stripe Checkout for GROWTH/ENTERPRISE; `POST /tenants/me/billing/portal` opens the Customer Portal. Subscription webhooks (`checkout.session.completed`, `customer.subscription.updated/deleted`) sync plan + `billingStatus`. Direct `POST /tenants/me/upgrade` only works when `STRIPE_SECRET_KEY` is unset (local dev).
- **Email verification** — new signups receive a 24-hour verification link; login is blocked until verified. Invite accept auto-verifies. Endpoints: `POST /auth/verify-email`, `POST /auth/resend-verification`. Page: `/verify-email`.
- **Onboarding on signup** — new tenants get the four default onboarding steps (`ORG_PROFILE`, `BILLING_CONTACT`, `FIRST_WAREHOUSE`, `COMPLIANCE_ACK`).

## Known remaining work (not blockers for a first customer)

| Item | Notes |
|------|-------|
| Multi-replica rate limiting / session cache | Current limiter and session cache are per-process; use Redis when scaling horizontally. |
| Multi-currency, consolidation, fixed assets | Intentionally out of scope (see `ERP_FEATURE_GAP.md`). |
| Native PDF invoices | Print-ready HTML only. |

## Verification

- `npm run typecheck` — clean across all workspaces
- `npm run lint` — clean
- `npm run test` — 26 tests passing
- Live smoke test (18 checks): security headers, register removal, password policy, signup, invite create/accept/reuse-rejection, token hidden from invite list, forgot/reset cycle, old-password rejection, login rate limit (429 after 10 attempts), SSRF guard (metadata IP + localhost), tax settings, change password, paginated customers.
