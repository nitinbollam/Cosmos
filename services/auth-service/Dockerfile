FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/auth-service ./services/auth-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cosmos/auth-service db:generate || true
RUN pnpm --filter @cosmos/auth-service build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/services/auth-service/dist ./dist
COPY --from=builder /repo/services/auth-service/node_modules ./node_modules
COPY --from=builder /repo/services/auth-service/package.json ./
COPY --from=builder /repo/services/auth-service/src/prisma ./prisma
USER cosmos
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
