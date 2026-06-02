#!/usr/bin/env node
/**
 * Generates all Prisma clients for @cosmos/web (Next.js native API).
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.join(root, 'apps', 'web')

console.log('[prisma] Generating clients for @cosmos/web …')
execSync('npm run db:generate', { cwd: webDir, stdio: 'inherit' })
console.log('[prisma] Done.')
