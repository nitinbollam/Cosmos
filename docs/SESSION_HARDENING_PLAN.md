# Session & Stale-State Hardening Plan

Branch reviewed: `staging` @ `17b168e`. **Status: all phases implemented together in one commit on `fix/session-hardening`** (originally planned as six PRs). See [Implementation notes](#implementation-notes) for where the build differs from the plan.

## Phase 0 — Access-token TTL to 45 minutes

- `apps/web/lib/server/auth.ts:38` default `'15m'` → `'45m'`; `.env.example`, `.env.production.example`, `docs/TESTING_FLOW.md` updated.
- **Check the deployed env:** `render.yaml` does not set `JWT_ACCESS_TTL`, but if someone copied `15m` into the Render dashboard (staging or production), that value still wins. Remove it or set it to `45m`.
- With Phase 3, 45 minutes is no longer a logout: the client refreshes before expiry.
- Logout and password reset take effect within 60 seconds via the Phase 2 session-id check, so the longer TTL doesn't widen revocation.

---

## Phase 1 — Server quick fixes (small PR, no schema change)

| # | Change | Where |
|---|--------|-------|
| 1.1 | **Fail closed with 503.** When the auth-DB lookup throws, throw `ApiError(503, 'Auth service unavailable')` instead of returning `active: true`. `getSession`'s outer `catch` must rethrow `ApiError` instead of turning it into `null` (which would become a 401 and log everyone out during a DB blip). | `session.ts:43-46`, `session.ts:81-83` |
| 1.2 | **Use DB permissions even when empty.** Return `state.permissions` whenever the user row was found. An empty list already means "role defaults" in `hasPermission`, so falling back to the token's stale custom permissions is wrong. | `session.ts:79` |
| 1.3 | **Refresh checks the user.** `refreshUserTokens` rejects inactive users and unverified signups, and checks that the token's `tenantId` matches the user row. | `auth.ts:144-157` |
| 1.4 | **Token type claim.** `signPair` adds `typ: 'access'` / `typ: 'refresh'`. `getSession` rejects `typ === 'refresh'`; refresh rejects `typ === 'access'`. Transition: tokens without `typ` are accepted for one refresh TTL (7 days), then a follow-up removes the legacy path. | `auth.ts:31-52`, `session.ts:60` |
| 1.5 | **Require `JWT_REFRESH_SECRET` in production.** `jwtRefreshSecret()` throws when `NODE_ENV=production` and it is unset; add the check to `scripts/production-preflight.mjs`. **Gate:** confirm the variable is set on Render production first (`sync: false` there), or production fails to boot. | `env.ts:8` |
| 1.6 | **`Cache-Control: no-store` on API JSON** by default in the API router. Routes that set their own header (marketplace images) keep it. This is a second layer under Phase 4. | `apps/web/server/api-router.ts` |

**Tests:** new `session.test.ts`:
- a DB throw gives 503, not a null session
- empty DB permissions don't fall back to token permissions
- an inactive user can't refresh
- a refresh token is rejected as an access token, and vice versa

---

## Phase 2 — Per-device sessions (server, additive schema)

**Problem:** one `User.refreshTokenHash` per user. Each login or refresh overwrites it, so logging in on a phone kills the laptop session.

**New model** in `apps/web/prisma/auth/schema.prisma`, using only types that work under both SQLite and Postgres:

```prisma
model AuthSession {
  id                String    @id @default(cuid())
  userId            String
  tenantId          String
  refreshTokenHash  String    // sha256 of the refresh JWT (high-entropy, so no bcrypt; enables lookup)
  prevTokenHash     String?   // previous hash, accepted for 30s to absorb multi-tab races
  rotatedAt         DateTime?
  userAgent         String?
  createdAt         DateTime  @default(now())
  lastUsedAt        DateTime  @default(now())
  expiresAt         DateTime
  revokedAt         DateTime?
  @@index([userId])
}
```

Deploys run `prisma db push --accept-data-loss`, so adding a table is safe. **Keep `User.refreshTokenHash` for one release.** Dropping it in the same deploy would break tokens issued before the deploy.

**Token flow:**
- Login and accept-invite create a session row; both tokens carry `sid`.
- **Refresh:**
  - verify the JWT and load the session by `sid`
  - reject it if revoked or expired
  - compare against `refreshTokenHash`, or `prevTokenHash` if `rotatedAt` is under 30 seconds old
  - rotate the hash in place and update `lastUsedAt`
  - on a hash mismatch outside the grace window, treat it as token reuse and revoke the session
- **Legacy tokens without `sid`:** fall back to the `User.refreshTokenHash` check once, then create a session row.
- **`getSession` checks `sid`:** extend the 60-second revalidation cache to include session revocation. Logout and password reset then take effect within 60 seconds, which closes the 45-minute gap from Phase 0.
- `/auth/refresh` derives the user from the token; the `userId` body field stays accepted but is ignored.

**Move every revocation site** (`git grep refreshTokenHash`). If any is missed, revocation silently stops working:

| Site | New behaviour |
|------|---------------|
| `auth.ts:54-58` `signPair` | write to `AuthSession` |
| `auth.ts:153-154` `refreshUserTokens` | session lookup (see above) |
| `auth.ts:162` `logoutUser` | revoke **this** session (`sid`) |
| `auth.ts:341` `resetPassword` | revoke **all** of the user's sessions |
| `auth.ts:356` `changePassword` | revoke all sessions **except the current one** |
| `users.ts:46` deactivate | revoke all |
| `users.ts:91` patch `isActive: false` | revoke all |

**Logout works after the access token expires:** `/auth/logout` accepts `{ refreshToken }` in the body (verified with the refresh secret), falling back to the Bearer token. This fixes the case where an expired access token returned 401 and left the refresh token valid for 7 days.

**Optional:** add `GET /auth/sessions` and `DELETE /auth/sessions/:id` so users can see and revoke their own devices (Settings → Security).

**Tests:**
- two concurrent logins both stay refreshable
- a rotated token is accepted inside the grace window and rejected after it
- a reused token revokes the session
- each revocation site revokes the right sessions
- logout with an expired access token plus a refresh token revokes the session
- a legacy token without `sid` migrates

---

## Phase 3 — Client token refresh (the real fix for forced logouts)

### `packages/web-gateway-client`

Add callback hooks. The package must not import client code.

```ts
createGatewayApi({
  ...,
  refresh?: () => Promise<string | null>,   // returns new access token or null
  onUnauthorized?: () => void,               // expiry path (NOT explicit sign-out)
})
```

Interceptor behaviour:
1. On a 401 from a non-`/auth/*` request not yet retried: `await refresh()`. On success, retry once with the new token; on `null`, call `onUnauthorized()`.
2. 503 and network errors **never** log out.
3. Drop the inline `localStorage.removeItem` and `location.assign`; that moves into `onUnauthorized`.

### `apps/client/src/lib/auth-session.ts` becomes the single auth module

- `getAccessToken`, `setTokens`, and `refreshTokens()`. Refresh is single-flight within the tab (shared promise) and across tabs via `navigator.locks.request('pleros-auth-refresh', …)`. Inside the lock, re-read `localStorage`: if another tab already rotated the token, reuse it without calling the server.
  - The refresh call uses a bare axios or `fetch`, never the intercepted client, to avoid loops.
- **Proactive refresh:** decode `exp`, and refresh when under 2 minutes remain, on `visibilitychange`/`focus` and before offline-queue replay.
- `authFetch(input, init)`: a wrapper with the same 401 → refresh → retry logic, for the raw `fetch` callers:
  - `pages/admin/pos/page.tsx:92`
  - `pages/admin/inventory/[skuId]/page.tsx:133`
  - `pages/admin/finance/tabs/income-statement-tab.tsx:44`
  - `pages/invoices/[id]/page.tsx:200`
  - `components/celestial/celestial-stream.ts:99`, which also drops its own 401 redirect and token wipe (lines 24-25, 127)
- `handleSessionExpired()`: the **expiry path**. It clears tokens and routes to the right login page with `?next=`, and **keeps** local data (offline queue, cart).
- `signOut()`: the **explicit path**. See Phase 5 for what it wipes.
- Add a global `storage` listener: if another tab removes the token, route this tab to login.
- Wire the three API clients (`api.ts`, `api-admin.ts`, `api-mobile.ts`) to `refresh` and `onUnauthorized`.
- Replace the direct `localStorage.getItem('pleros.accessToken')` reads in components with `getAccessToken()`/`isSignedIn()`.

**Tests** (`node:test`, already used by the package):
- five concurrent 401s trigger one refresh and five retries
- refresh failure calls `onUnauthorized` once
- 503 doesn't log out
- a token already rotated by another tab is reused

**Manual check:** set `JWT_ACCESS_TTL=1m` locally. Work across two tabs and the `/m` PWA for 10 minutes with no logout.

---

## Phase 4 — Service worker API cache (`apps/client/public/sw.js`)

Today every same-origin `/api/` GET is answered from cache first, keyed by URL only. That causes two problems:
- **Stale after saving:** e.g. the POD screen's refetch returns the pre-save route.
- **Cross-user leaks:** on shared devices, the next user sees the previous user's cached data.

Changes:
1. **Network-first for `/api/`.** Serve from cache only when the network fails, as an offline fallback. Remove stale-while-revalidate for API calls.
2. **Partition by identity.** Decode `sub` and `tenantId` from the request's `Authorization: Bearer` payload (no verification needed; this is only a cache key) and store under `pleros-api-v4:<tenantId>:<sub>`. A request with no Authorization header is **never** cached or served from cache.
3. **Clear on explicit sign-out.** The client posts `{ type: 'PLEROS_CLEAR_API_CACHE' }`, and the SW deletes every `pleros-api-v4*` cache. The expiry path doesn't clear, since partitioning already isolates users.
4. **Version bump to v4.** Change the activate handler's keep-set (`sw.js:47`) to a prefix match, so it keeps the v4 partitions and purges all `v3` caches. `skipWaiting` and `clients.claim` are already present (`sw.js:39,50`), so the new worker takes over on the next load.
5. **Optional:** register the SW only in production builds (`import.meta.env.PROD` in `main.tsx:16`), to avoid confusing behaviour in dev.

**Manual checklist** (Chrome DevTools → Application):
- Mark a stop delivered, and the list shows DELIVERED immediately.
- Sign in as user A, load orders, sign out. Sign in as user B (another tenant), load orders: no A data appears, and the A partition is gone.
- Go offline as B: cached B data loads; data from users who aren't signed in never appears.
- Upgrading from v3 purges `pleros-api-v3`.

---

## Phase 5 — Client state ownership (cart, assistant history, offline queue, buyer identity)

Rule: **an explicit sign-out wipes user-scoped state; session expiry keeps it.** Anything that persists gets an owner stamp (`ownerKey = tenantId:sub`). On boot and on every auth change, any store whose owner doesn't match the current session is reset.

| State | Change |
|-------|--------|
| `pleros-cart-v1` (`stores/cart.store.ts`) | Rename to `pleros-cart-v2` with an `ownerKey`; reset on owner mismatch; wipe on `signOut()`. |
| B2B cart (`lib/b2b-cart.ts`) | Same treatment. |
| `pleros-celestial-v1` (`stores/celestial-store.ts`) | Same; AI chat history must never carry over to another user. |
| `pleros.offlineQueue` (`lib/offline-queue.ts`) | Add `userId` and `tenantId` to `OfflineAction` at enqueue. `replayOfflineQueue` replays only entries matching the current session; others stay held and show in the queue UI as "belongs to another user", with a discard option. **Legacy untagged entries:** mark them `conflict` so a person confirms before they replay. **Explicit sign-out with unsynced entries:** show a confirmation dialog; never wipe silently. |
| Buyer identity (`lib/session.ts`) | Stop using per-tab `sessionStorage`. Add a `useBuyerSession()` hook that loads `/auth/me` once per app load (memoised, owner-stamped) and returns `customerId`/`tenantId`. Update `checkout/page.tsx:88,161,197`, `orders/page.tsx:47`, `gift-cards/purchase/page.tsx:40`, and the login and accept-invite pages. The server already scopes buyers via `buyerOpts`, so the client filter is presentational only. |

`signOut()` then:
1. revokes the server session with the refresh token (Phase 2)
2. clears the tokens
3. wipes the cart, B2B cart and assistant history
4. tells the SW to clear its API cache
5. handles the offline queue as in the table above
6. emits the auth-changed event

**Tests:**
- an owner mismatch resets each store
- queue entries from another user are not replayed
- legacy entries become `conflict`
- the buyer hook survives a reload or new tab

---

## Phase 6 — Guards, offline receiving, cleanup

- **Route guards** (`components/auth/require-auth.tsx`, `require-mobile-auth.tsx`, `require-marketplace-shop.tsx`):
  - check `exp`: an expired token tries `refreshTokens()` before redirecting
  - check that the role fits the surface (a buyer token can't render the `/admin` shell)
  - the server already enforces RBAC, so this is UX only
- **Offline receiving** (`pages/m/warehouse/receiving/page.tsx:35-38,56`): when the session-create call is queued offline, `sessionId` stays `null` and scans silently do nothing.
  - Short term: disable the scan input with a clear "session will start when online" message.
  - Later: client-generated temporary session IDs that replay maps to real IDs.
- **Multi-replica:** move the rate limiter, the user-state cache and session revocation to Redis before scaling horizontally (already listed in `PRODUCTION_READINESS.md`).

---

## Open questions (product decisions; not tasks yet)

1. **Same email in several tenants.** Login does `findFirst({ email })` (`auth.ts:64`), but uniqueness is `(tenantId, email)`, so a buyer who buys from two distributors lands in an arbitrary tenant. Options:
   - (a) tenant slug on the login form or subdomain
   - (b) after the password check, return the matching tenants and show a picker
   - (c) enforce global email uniqueness
2. ~~**One identity per browser, or one per surface?**~~ **Decided: one login per area.** Admin (`/admin`, `/ops`), the buyer portal (everything else) and mobile (`/m`) each keep their own login, in every environment. One browser can be admin, buyer and driver at once, which makes staging testing practical. See the implementation notes.

## Rollout order & checks

1. Phase 0: commit, check the Render env, deploy.
2. Phase 1: after confirming `JWT_REFRESH_SECRET` on Render production.
3. Phase 2, then Phase 3. Phase 2 must deploy first, or refresh still kills other devices.
4. Phase 4, Phase 5 and Phase 6 can follow in any order; Phase 4 is the highest priority of the three.

Every PR runs `npm run typecheck`, `npm run lint` and `npm run test`; tests need `apps/web/.env.local`, so run `node scripts/prepare-dev-env.mjs` first. CI does not run on PRs into `staging` today, so run these locally until it does.

---

## Implementation notes

What shipped, and where it differs from the plan above.

**Deviations**
- **`JWT_REFRESH_SECRET` (1.5):** production logs a loud error instead of refusing to start. The `typ` claim already keeps the two token kinds apart, and nobody has confirmed the variable is set on Render production yet. Make it fatal once confirmed.
- **Refresh errors:** `/auth/refresh` now answers:
  - 401 (was 403) for an invalid token
  - 429 when rate limited (120 per 5 minutes per IP)
  - 503 for any unexpected failure, such as the auth DB being down, so an outage never signs anyone out
- **Client refresh semantics:**
  - Network errors, 429 and 5xx are transient: the session is kept.
  - Any other 4xx ends the session.
  - The client also sends `userId` (decoded from the refresh token), so it still works against an older API deployment that requires the field.
- **Offline queue ownership:**
  - Only the current user's replayable work re-arms Background Sync. Another user's held entries would otherwise wake the service worker in a loop.
  - The mobile offline banner counts only the current user's items.
  - "Discard failed" never removes another user's work.
- **Buyer identity (Phase 5):** stored in owner-stamped `localStorage` (`pleros.b2bSession`), with an `/auth/me` fallback (`ensureB2bCustomerId`). This replaces the planned `useBuyerSession` hook and has the same effect with fewer call-site changes.
- **Owner stamp:** a single stamp (`pleros.dataOwner`) covers the cart, B2B cart and assistant history. Data saved before the stamp existed is adopted by the first user who signs in after the upgrade.
- **Offline receiving (Phase 6):** starting a receiving session now requires a connection. A queued "start" would have left scanning locked, and tapping again online would open a duplicate session. Scans still queue offline. Legacy queued `receiving_session_create` actions still replay.
- **Admin and mobile guards:** these send only *portal-only* buyers (role `STAFF` with no custom permissions) to `/catalog`. `VIEWER` and custom-permission accounts are not blocked, because they may hold staff permissions.
- **Transition debt:** remove the legacy paths after 7 days (one refresh TTL):
  - tokens without `typ`
  - refresh tokens without `sid`, checked against `User.refreshTokenHash`
  - then drop `User.refreshTokenHash`

**Verified**
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run test`: 214 passing. New suites:
  - `auth-sessions.test.ts` (8 tests, real SQLite)
  - `refresh-interceptor.test.ts` (6)
  - offline-queue ownership (5, including a check that held entries don't re-register sync)
- **Browser smoke test** (local, `JWT_ACCESS_TTL=3m`):
  - Login issues tokens with `sid` and `typ`.
  - A tampered access token produces one 401, one refresh, a retry, and the page stays put.
  - Proactive refresh fires before expiry with no 401.
  - The API cache is partitioned as `pleros-api-v4:<tenant>:<user>`, and the v3 caches are purged.
  - Sign-out revokes the session (the old refresh token gets 401), wipes the cart and owner stamp, and clears the API cache.
  - A buyer opening `/checkout` in a fresh tab stays on checkout. With the stored identity deleted, `/orders` recovers it from `/auth/me`.
  - Driver: after loading a route twice (so it is cached), marking a stop delivered shows DELIVERED immediately.
  - Switching user from buyer to driver wipes the buyer's cart and moves the owner stamp.
- **Not exercised in a browser:**
  - two-tab Web Locks coordination (covered by the server's 30-second grace window and unit tests)
  - the offline replay ownership UI
  - Safari without Web Locks

**Separate logins per area** (added after the plan)
- **Token keys:** `pleros.<admin|shop|mobile>.accessToken` and `.refreshToken`. The area comes from the page path (`surfaceFor`).
- **Isolation:**
  - Each area refreshes on its own (separate Web Lock and in-flight promise).
  - Each area signs out on its own.
  - Each area has its own data owner stamp (`pleros.<area>.dataOwner`).
- **Area binding:**
  - `api-mobile` is bound to the mobile login.
  - `api.ts` and `api-admin` follow the page's area, because `api-admin` is also used by `/marketplace` and shared components.
- **Area-owned data:**
  - The offline queue belongs to mobile.
  - The cart, B2B cart, buyer identity and buyer-side assistant history belong to the buyer portal.
  - Admin-side assistant history belongs to admin.
- **Invites and signup:** accept-invite signs in to the buyer portal, then moves the session to admin for staff accounts. Signup always signs in to admin.
- **Migration:** the old shared `pleros.accessToken`/`pleros.refreshToken` move once, into the area of the first page loaded after upgrade, and are then removed. They are never copied to several areas, because every copy would rotate the same refresh token and trip reuse detection.
- **Verified in the browser:**
  - Admin, buyer and driver were signed in at once in three tabs, and the server confirmed each identity.
  - Signing out of the buyer portal left admin and driver signed in.
  - The old login migrated into the area of the first page loaded.

---

## Critical bugs found in a follow-up review (same commit)

| # | Bug | Fix | Verified |
|---|-----|-----|----------|
| 1 | **Privilege escalation.** Creating an invite only needed `users.read`, which every MANAGER has, and the invite role was never checked. A manager, or any self-signup tenant admin, could invite someone as `TENANT_ADMIN` or as the Pleros-wide `SUPER_ADMIN`. That role reaches `/pleros-ops` and other tenants' KPI snapshots and expense receipts. | Sending invites requires `users.write`. Invite and role-edit roles must be in `ASSIGNABLE_ROLES` (never `SUPER_ADMIN`), and only admins can grant `TENANT_ADMIN`. Accept-invite refuses non-tenant roles, which covers invites already pending. | `role-escalation.test.ts`: fails on the old code, passes now |
| 2 | **Stored XSS through proof of delivery.** The POD body was stored as-is, and the customer and staff pages rendered `photoUrl` and called `window.open(src)` on click. A `javascript:` "photo" would run in the app origin and could read login tokens. | The server whitelists POD fields and accepts only `data:image/(jpeg\|png\|webp)` (≤3 MB) or `https:` images. Order tracking exposes only safe stored images. The client renders only safe sources and opens inline images as blob URLs. Delivered stops can't be overwritten. | `pod-validation.test.ts`; live: `javascript:` photo → 400 |
| 3 | **Duplicate orders on retry.** The checkout sent an `Idempotency-Key`, but `POST /orders` ignored it, so a retry after a timeout placed (and card-authorised) a second order. | Order creation runs at most once per (user, key). A concurrent duplicate gets 409, a later repeat gets the original order, and a failure releases the key. | `order-idempotency.test.ts` |
| 4 | **Unbounded request bodies.** The production server buffered whole API bodies with no limit, so one large request could exhaust memory. | Bodies are capped at 10 MB, with 413 on both `Content-Length` and streamed size. | live: 11 MB → 413, normal requests unaffected |
| 5 | **Cart lost on sign-out** (regression from this work). | The cart is saved per buyer (`pleros-cart-v1:<tenant>:<user>`). Sign-out switches to an empty guest cart, and sign-in restores the buyer's cart and merges guest items. The next buyer on a shared device never sees it. | `cart.store.test.ts`; live: add 2 items → sign out → sign in → both items back |

**Checked and found sound:**
- **Tenant scoping:** every update or delete by bare ID follows a tenant-scoped lookup.
- **Webhooks:** Stripe and Shopify verify signatures and fail closed when the secret is missing.
- **Buyer order list:** ignores a `customerId` supplied by the buyer.
- **Raw SQL:** none.

## Second review round (same commit)

| # | Bug | Fix | Verified |
|---|-----|-----|----------|
| 6 | **Free goods through negative quantities.** Order lines were never validated. A buyer ordered 7 stands ($315) plus −10 energy cases ($−315). The order totalled $0, was accepted as fully paid, moved to PROCESSING and reserved the stands. | `createOrder` rejects any line that isn't a whole quantity from 1 to 1,000,000 at a finite price ≥ 0. Every channel goes through it: portal, admin, POS, quotes, subscriptions, EDI and Shopify. | Live exploit returned 201 before the fix and 400 after; `money-guards.test.ts` |
| 7 | **Paid features unlocked for free.** Effective features were `{...planDefaults, ...overrides}`, and tenant admins write the overrides (the Features settings tab even offered switches above the plan). A Starter tenant could turn on POS, contract pricing, Celestial and more. | Overrides can only switch plan features off; the settings tab greys out features above the plan ("Requires upgrade"). | `money-guards.test.ts` |
| 8 | **Gift card double spend.** Redemption read the balance and then wrote back an absolute value. On Postgres, two checkouts using the same card at once both spent the full balance. | Compare-and-set update (only succeeds if the balance is unchanged), done before the ledger entry. A lost race returns 409. | Code review. SQLite serialises writes, so the race only shows on Postgres. |
| 9 | **Loyalty points double redemption.** The balance check ran outside the transaction, so parallel redemptions drove the balance negative and minted extra discount codes. Fractional points were also accepted. | Conditional decrement (`pointsBalance >= points`) inside the transaction; points must be whole numbers. | Code review |
| 10 | **Rate limits bypassable.** `clientIp` trusted the first `X-Forwarded-For` entry, which the caller controls, so a fresh fake IP per request skipped the per-IP login, signup and reset limits. | Use the entry the proxy appended (`TRUSTED_PROXY_HOPS`, default 1). | `money-guards.test.ts` |

**Checked and found sound:**
- discounts are capped at the subtotal
- credit memos validate return quantities
- uploads must be images and are re-typed on save
- CORS is suffix-restricted and auth uses bearer tokens, not cookies
- Celestial requires a customer record for buyers and scopes every tool by tenant and customer


## External security review findings

| # | Bug | Fix | Verified |
|---|-----|-----|----------|
| 11 | **Buyers could read other customers' order templates.** `GET /order-templates` took the customer from the `customerRef` query parameter before the buyer's own customer. A buyer who knew another customer's ID could list that customer's template names, SKUs and quantities (same tenant only). Staff routes only checked for a signed-in user, so a driver could create or delete any customer's templates. | Buyers always get their own customer from their login, and `customerRef` is ignored for them. Staff need `orders.read` to list and `orders.write` to create or delete, the same rights as orders. | `order-templates-access.test.ts`: fails on the old code, passes now |
| 12 | **Outbound webhooks could reach the internal network.** The URL was checked once, but `fetch` then followed redirects and looked the host name up again. A public URL that redirected (or a domain that re-resolved) to `169.254.169.254` or another internal service was requested by the server. The check also missed `100.64.0.0/10`, `198.18.0.0/15`, `::` and hex IPv4-mapped IPv6, and allowed plain `http`. Self-signup makes anyone a tenant admin, so anyone could set a webhook. | Webhooks are sent with Node's `https` client, which never follows redirects (a 3xx is a failed delivery). The address is re-checked in the socket's DNS lookup, so the IP actually connected to must be public. `net.BlockList` covers the private, link-local, CGNAT, reserved, multicast, IPv4-mapped and NAT64 ranges, and URLs must be `https`. Existing `http://` subscriptions stop delivering. | `webhooks-ssrf.test.ts`: the URL cases fail on the old check; the re-resolve and IP-literal cases cover the new transport. Redirects are checked live only: a 307 to `169.254.169.254` came back as a 307 and wasn't followed. Tested on Node 26; production runs Node 20. |
| 13 | **Reset and invite links printed to production logs.** With no email provider configured, notifications fell back to printing the whole message, including password-reset (30 min), invite (7 days, can carry the admin role) and verification links. Anyone with log access could take over accounts, and delivery was reported as successful. Outbound webhook signatures also fell back to a built-in key that is in the source. | In production, the console fallback refuses to send. It logs only the channel and template, and callers record the failure. `WEBHOOK_SIGNING_SECRET` is required in production. `.env.production.example` now lists `ENCRYPTION_KEY`, `WEBHOOK_SIGNING_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` and `TRUSTED_PROXY_HOPS`. | `production-secrets.test.ts`: the email case fails on the old code |
| 14 | **Payments could move twice, and Stripe events could be lost.** Capture, void and refund checked the status and then wrote it, so two requests at once both went through: a double-clicked $40 refund refunded $80. The admin panel sent a new Idempotency-Key per click, the order payment routes ignored the key, and the `/payments` routes stored it only after the work, so nothing caught the duplicate. A refund with no amount refunded the full original total even after a partial refund. Captured payments could be voided. Buyer (and admin) confirm reset a refunded payment to captured and counted the money again. Stripe webhooks acknowledged failures (main) or answered before processing (Connect), so a failure lost the event. Connect let a late "failed" event overwrite a captured payment, and answered 200 to a bad signature. | Every status change is a conditional update claimed before calling Stripe. A loser gets 409, and a Stripe failure undoes the claim only if nothing else changed it. Stripe calls carry idempotency keys built from the payment's state. Refunds are capped at the captured amount, and "no amount" means the rest. Only pending, authorized or failed payments can be voided. The `/payments`, order-payment and invoice card-payment routes run once per user and Idempotency-Key (the invoice route falls back to `correlationId`), and the admin panel keeps one key per attempt. Confirm only moves forward. Webhooks are processed before answering, once per event ID (new `StripeWebhookEvent` table, created by `db push` at boot); a failure answers 500 so Stripe retries. Connect sync changes are conditional, and bad signatures get 400. | `payment-safety.test.ts`. The old code double-refunded, double-captured, refunded 160 of 100 and voided a captured payment in 5 of 5 runs; the new code passes. Confirm and webhook tests cover the new code only. |

Not changed: the order's paid amount after a standalone refund. Credit-memo refunds and cancellations already lower it themselves, so lowering it in `payments.refund` would subtract twice. Whether a refund made without a credit memo should show the customer as owing again is a business decision.

Trade-off: Stripe stores the result of an idempotent request for 24 hours, errors included, and the refund/capture keys come from the payment's state. So a request Stripe rejected (say, too little balance on the connected account) returns the same error if retried unchanged within 24 hours.
