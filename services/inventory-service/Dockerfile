FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/inventory-service ./services/inventory-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cosmos/inventory-service db:generate || true
RUN pnpm --filter @cosmos/inventory-service build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/services/inventory-service/dist ./dist
COPY --from=builder /repo/services/inventory-service/node_modules ./node_modules
COPY --from=builder /repo/services/inventory-service/package.json ./
COPY --from=builder /repo/services/inventory-service/src/prisma ./prisma
USER cosmos
ENV PORT=3003
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
