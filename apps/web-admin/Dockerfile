FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web-admin ./apps/web-admin
RUN pnpm install --frozen-lockfile=false

FROM node:20-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo /repo
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
RUN pnpm --filter @cosmos/web-admin build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /repo/apps/web-admin/.next/standalone ./
COPY --from=builder /repo/apps/web-admin/.next/static ./apps/web-admin/.next/static
COPY --from=builder /repo/apps/web-admin/public ./apps/web-admin/public
USER cosmos
EXPOSE 4000
ENV PORT=4000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web-admin/server.js"]
