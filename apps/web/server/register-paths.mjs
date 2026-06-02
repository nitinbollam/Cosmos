/** Register @/* path aliases for apps/web when running the Vite API server via tsx. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'tsconfig-paths'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

tsconfigPaths.register({
  baseUrl: webRoot,
  paths: {
    '@/*': ['./*'],
    '@src/*': ['./src/*'],
    '@/generated/prisma-auth': ['./generated/prisma-auth'],
    '@/generated/prisma-tenant': ['./generated/prisma-tenant'],
    '@/generated/prisma-inventory': ['./generated/prisma-inventory'],
    '@/generated/prisma-order': ['./generated/prisma-order'],
    '@/generated/prisma-crm': ['./generated/prisma-crm'],
    '@/generated/prisma-storefront': ['./generated/prisma-storefront'],
    '@/generated/prisma-wms': ['./generated/prisma-wms'],
    '@/generated/prisma-dispatch': ['./generated/prisma-dispatch'],
    '@/generated/prisma-purchasing': ['./generated/prisma-purchasing'],
    '@/generated/prisma-payment': ['./generated/prisma-payment'],
    '@/generated/prisma-compliance': ['./generated/prisma-compliance'],
    '@/generated/prisma-notification': ['./generated/prisma-notification'],
    '@/generated/prisma-ledger': ['./generated/prisma-ledger'],
    '@/generated/prisma-analytics': ['./generated/prisma-analytics'],
  },
})
