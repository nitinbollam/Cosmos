param(
  [Parameter(Mandatory=$true)] [string]$Name,
  [Parameter(Mandatory=$true)] [int]$Port,
  [Parameter(Mandatory=$true)] [string]$Description
)

$root = Join-Path (Resolve-Path "$PSScriptRoot\..").Path "services\$Name"
New-Item -ItemType Directory -Force -Path "$root\src\health","$root\src\prisma" | Out-Null

# package.json
@"
{
  "name": "@cosmos/$Name",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "lint": "eslint src --ext .ts || true",
    "test": "jest --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "db:generate": "node ../../scripts/prisma-generate-retry.mjs src/prisma/schema.prisma",
    "db:migrate": "prisma migrate deploy --schema=src/prisma/schema.prisma"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.10",
    "@nestjs/core": "^10.3.10",
    "@nestjs/platform-express": "^10.3.10",
    "@nestjs/config": "^3.2.3",
    "@prisma/client": "^5.18.0",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "@cosmos/logger": "workspace:*",
    "@cosmos/event-bus": "workspace:*",
    "@cosmos/auth-middleware": "workspace:*",
    "@cosmos/types": "workspace:*"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.2",
    "@nestjs/testing": "^10.3.10",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.10",
    "jest": "^29.7.0",
    "prisma": "^5.18.0",
    "ts-jest": "^29.2.2",
    "typescript": "^5.5.3"
  }
}
"@ | Set-Content -Path "$root\package.json" -Encoding utf8

@'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "module": "commonjs" },
  "include": ["src/**/*"]
}
'@ | Set-Content -Path "$root\tsconfig.json" -Encoding utf8

@'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
'@ | Set-Content -Path "$root\nest-cli.json" -Encoding utf8

# main.ts
@"
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')
  const port = parseInt(process.env.PORT ?? '$Port', 10)
  await app.listen(port)
  new Logger('$Name').log('$Name listening on :' + port)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('$Name failed to start', err)
  process.exit(1)
})
"@ | Set-Content -Path "$root\src\main.ts" -Encoding utf8

# app.module.ts
@'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthController } from './health/health.controller'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
'@ | Set-Content -Path "$root\src\app.module.ts" -Encoding utf8

# health controller
@"
import { Controller, Get } from '@nestjs/common'

@Controller()
export class HealthController {
  private startedAt = Date.now()

  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: '$Name',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
"@ | Set-Content -Path "$root\src\health\health.controller.ts" -Encoding utf8

# prisma schema (datasource only — populated in follow-up session)
@'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// SCAFFOLD: models for this service have not been authored yet.
// See README.md for what needs to be implemented.
'@ | Set-Content -Path "$root\src\prisma\schema.prisma" -Encoding utf8

# Dockerfile
@"
FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/$Name ./services/$Name
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cosmos/$Name build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/services/$Name/dist ./dist
COPY --from=builder /repo/services/$Name/node_modules ./node_modules
COPY --from=builder /repo/services/$Name/package.json ./
USER cosmos
ENV PORT=$Port
EXPOSE $Port
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:$Port/api/v1/health || exit 1
CMD [`"node`", `"dist/main.js`"]
"@ | Set-Content -Path "$root\Dockerfile" -Encoding utf8

# README.md
@"
# $Name

**Status: SCAFFOLD ONLY.** $Description

This service has only:

- NestJS bootstrap + ``GET /api/v1/health``
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
*Implement ``services/$Name`` to the same depth as ``services/auth-service`` — full Prisma schema, controllers, services, DTOs, event consumers/publishers, unit tests, e2e test for the happy path.*

Default port: **$Port**.
"@ | Set-Content -Path "$root\README.md" -Encoding utf8

Write-Host "scaffolded services\$Name on :$Port"
