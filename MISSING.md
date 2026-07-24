# Notes (@pleros/web)

All product code lives in **`apps/web`**. There are no Nest, Expo, or Python service folders on this branch.

| Feature | Status |
|---------|--------|
| MSA S3 upload / EDI cron | Local archive + webhook/S3 env + EDI POST + `/msa/cron` automation |
| Redis event bus | Console/webhook stub (`event-bus.ts`); wire `REDIS_URL` for production |
| Real notification providers | SendGrid/Twilio when env set; console/webhook fallback |
| POS registers | `/admin/pos` + `POST /api/v1/pos/orders` |
| Service worker offline sync | `sw.js` shell-first `/m/*` + asset precache + SWR API GETs + queue replay / Background Sync |
| Postgres unified dev path | CI/production path via `env.ts`; local dev uses SQLite |
| Native PDF invoices | `GET /invoices/:id/pdf` — native PDF via pdfkit; print preview at `/invoices/:id/html` |
