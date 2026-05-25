#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const servicesDir = path.join(root, 'services')

for (const svc of fs.readdirSync(servicesDir)) {
  const dir = path.join(servicesDir, svc)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.tsbuildinfo')) {
      fs.unlinkSync(path.join(dir, name))
    }
  }
}

console.log('Removed stale *.tsbuildinfo under services/')
