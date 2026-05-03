# payment-service

Stripe-backed payments + in-house double-entry ledger.

Default port: **3012**.

Endpoints: `/api/v1/payments/{authorize,capture,void,refund}`, plus Stripe webhook at `/api/v1/payments/webhook/stripe`.
