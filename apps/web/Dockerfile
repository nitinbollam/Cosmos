FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/client/package.json ./apps/client/
COPY packages/analytics-engine/package.json ./packages/analytics-engine/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/web-gateway-client/package.json ./packages/web-gateway-client/
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/client ./apps/client
COPY apps/web ./apps/web
COPY scripts ./scripts
RUN npm run db:generate -w @pleros/web
RUN npm run build -w @pleros/client

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 pleros && adduser --system --uid 1001 pleros
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/apps/client/dist ./apps/client/dist
COPY --from=builder /repo/apps/client/server ./apps/client/server
COPY --from=builder /repo/apps/client/package.json ./apps/client/package.json
COPY --from=builder /repo/apps/client/vite.config.ts ./apps/client/vite.config.ts
COPY --from=builder /repo/apps/web ./apps/web
COPY --from=builder /repo/packages ./packages
USER pleros
EXPOSE 4000
ENV NODE_ENV=production PORT=4000 HOSTNAME=0.0.0.0 PLEROS_CLIENT_ORIGIN=http://localhost:4000
CMD ["npx", "tsx", "apps/client/server/index.ts"]
