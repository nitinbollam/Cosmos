# tenant-service

**Status: SCAFFOLD ONLY.** Multi-tenant management — onboarding, plans, settings.

This service has only:

- NestJS bootstrap + `GET /api/v1/health`
- Empty Prisma datasource block (no models)
- Dockerfile

## What is missing

- Prisma data models for this domain
- Controllers, services, DTOs
- Event consumers and publishers
- Tests
- Detailed README of endpoints

## Implementing

Open a new chat session and ask:
*Implement `services/tenant-service` to the same depth as `services/auth-service` â€” full Prisma schema, controllers, services, DTOs, event consumers/publishers, unit tests, e2e test for the happy path.*

Default port: **3002**.
