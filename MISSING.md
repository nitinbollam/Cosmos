# Notes (@pleros/web)

All product code lives in **`apps/web`**. There are no Nest, Expo, or Python service folders on this branch.

| Feature | Status |
|---------|--------|
| MSA S3 upload / EDI cron | Local archive + webhook/S3 env + EDI POST + `/msa/cron` automation |
| Redis event bus | Console/webhook stub (`event-bus.ts`); wire `REDIS_URL` for production |
| Real notification providers | SendGrid/Twilio when env set; console/webhook fallback |
| POS registers | `/admin/pos` + `POST /api/v1/pos/orders` |
| Service worker offline sync | `sw.js` + queue replay + Background Sync tag |
| Postgres unified dev path | CI/production path via `env.ts`; local dev uses SQLite |
| Native PDF invoices | Print-ready HTML download (`GET /invoices/:id/pdf`) |
