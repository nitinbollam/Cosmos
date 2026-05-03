FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/crm-service ./services/crm-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cosmos/crm-service build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/services/crm-service/dist ./dist
COPY --from=builder /repo/services/crm-service/node_modules ./node_modules
COPY --from=builder /repo/services/crm-service/package.json ./
USER cosmos
ENV PORT=3010
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3010/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
