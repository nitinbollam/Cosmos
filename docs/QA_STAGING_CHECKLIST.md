# Staging QA checklist (COS-12)

Use against the **staging URL**. Mark Pass / Fail / N/A. Attach this file (or a filled copy) to the Linear issue.

**Environment:** ________________  
**Tester:** ________________  
**Date:** ________________  
**Build / commit:** ________________  

Themes to verify where noted: **Obsidian** (default) and **Aurora** (toggle in header).

---

## A. Landing & auth

| # | Step | Obsidian | Aurora | Pass? | Notes |
|---|------|----------|--------|-------|-------|
| A1 | Open landing `/` — brand, CTA, no demo password leak | | | | |
| A2 | `/signup` — create tenant, Terms/Privacy checkbox required | | | | |
| A3 | Verification email / `/verify-email` — confirm or resend | | | | |
| A4 | `/admin/login` before verify → clear “verify email” UX + resend | | | | |
| A5 | After verify → login → redirected to onboarding or `/admin` | | | | |
| A6 | `/forgot-password` → email → `/reset-password` works | | | | |

---

## B. Admin dashboard

| # | Step | Obsidian | Aurora | Pass? | Notes |
|---|------|----------|--------|-------|-------|
| B1 | `/admin` dashboard loads (KPIs / modules) | | | | |
| B2 | Sidebar navigation: Inventory, Orders, Warehouse, Finance, CRM, POS, Settings | | | | |
| B3 | First-run onboarding wizard completes (if new tenant) | | | | |
| B4 | **Settings → Company** — no `PATCH /`, `GET /`, `POST /` helper text | | | | |
| B5 | Settings tabs (Users, Warehouses, Integrations, Billing, Features, Audit) readable | | | | |

---

## C. Buyer catalog & checkout

| # | Step | Obsidian | Aurora | Pass? | Notes |
|---|------|----------|--------|-------|-------|
| C1 | Buyer login `/login` → `/catalog` | | | | |
| C2 | Add SKU to cart → `/cart` | | | | |
| C3 | `/checkout` — NET terms and/or Stripe card path | | | | |
| C4 | Order confirmation; order appears under `/orders` | | | | |
| C5 | `/invoices` → open invoice → **Download PDF** is a real `.pdf` | | | | |

---

## D. Mobile field apps (phone viewport)

Use Chrome DevTools device mode or a real phone. Prefer **installed PWA** from `/m/login` if available.

| # | Step | Pass? | Notes |
|---|------|-------|-------|
| D1 | `/m/login` — sign in; install hint visible if not installed | | |
| D2 | `/m/warehouse` — tasks / receiving usable at ~390px width | | |
| D3 | `/m/delivery` — routes list + open a stop | | |
| D4 | Safe-area / sticky header doesn’t cover primary actions | | |
| D5 | Offline banner appears when network is toggled off (optional) | | |

---

## E. Billing (Settings → Billing)

Requires Stripe **test** keys on staging.

| # | Step | Pass? | Notes |
|---|------|-------|-------|
| E1 | Billing tab shows current plan / status | | |
| E2 | Start Checkout for GROWTH or ENTERPRISE → redirects to Stripe | | |
| E3 | Complete test payment → return with `?checkout=success` (or equivalent success message) | | |
| E4 | Plan / billing status updates after webhook (may take a few seconds) | | |
| E5 | Customer Portal button opens Stripe portal (if customer exists) | | |

---

## F. Copy / polish gate

| # | Check | Pass? | Notes |
|---|-------|-------|-------|
| F1 | Settings UI has **no** developer strings like `PATCH /tenants/me`, `POST /warehouses`, `GET /…` | | |
| F2 | POS header has **no** `POST /pos/orders` (customer-facing wording only) | | |
| F3 | Mixed-content / console errors on HTTPS staging | | |
| F4 | Both themes render readable contrast on landing, admin, shop, `/m/login` | | |

---

## Sign-off

- [ ] All **P0** paths green (A–C, E if Stripe configured, F1)
- [ ] Mobile D1–D3 green
- [ ] Failures logged as follow-up Linear issues: ________________

**Overall:** Pass / Fail  

**Tester signature:** ________________
