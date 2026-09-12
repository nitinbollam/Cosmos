import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'tsconfig-paths'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const envLocalPath = path.join(webRoot, '.env.local')
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim()
      if (process.env[key] === undefined) {
        process.env[key] = val
      }
    }
  }
}

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
    '@/generated/prisma-marketplace': ['./generated/prisma-marketplace'],
  },
})
