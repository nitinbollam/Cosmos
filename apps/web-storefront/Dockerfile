FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER cosmos
ENV PORT=4001 HOSTNAME=0.0.0.0
EXPOSE 4001
CMD ["node", "server.js"]
