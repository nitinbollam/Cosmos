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
COPY docs ./docs
COPY PLATFORM_FEATURES.md ./PLATFORM_FEATURES.md
RUN npm run db:generate -w @pleros/web

# Vite inlines import.meta.env.VITE_* at build time — these must be present
# before `npm run build -w @pleros/client`. On Render, service env vars with the
# same names are passed as Docker build-args automatically.
ARG VITE_GATEWAY_URL=/api/v1
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ARG VITE_WEB_ADMIN_ORIGIN=
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_WEB_ADMIN_ORIGIN=$VITE_WEB_ADMIN_ORIGIN

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
COPY --from=builder /repo/docs ./docs
COPY --from=builder /repo/PLATFORM_FEATURES.md ./PLATFORM_FEATURES.md
COPY --from=builder /repo/scripts ./scripts
USER pleros
EXPOSE 4000
ENV NODE_ENV=production PORT=4000 HOSTNAME=0.0.0.0 PLEROS_CLIENT_ORIGIN=http://localhost:4000
CMD ["node", "scripts/start-server.mjs"]
