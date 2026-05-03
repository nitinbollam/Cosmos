FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 cosmos && adduser --system --uid 1001 cosmos
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER cosmos
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
