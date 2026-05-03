FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/order-service ./services/order-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cosmos/order-service db:generate || true
RUN pnpm --filter @cosmos/order-service build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/services/order-service/dist ./dist
COPY --from=builder /repo/services/order-service/node_modules ./node_modules
COPY --from=builder /repo/services/order-service/package.json ./
COPY --from=builder /repo/services/order-service/src/prisma ./prisma
USER cosmos
ENV PORT=3005
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3005/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
