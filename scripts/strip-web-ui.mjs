#!/usr/bin/env node
/** Remove UI routes from apps/web — API-only Next.js app. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web')
const app = path.join(web, 'app')

for (const name of ['(shop)', 'admin', 'm', 'login']) {
  const p = path.join(app, name)
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

for (const f of ['page.tsx', 'providers.tsx', 'globals.css', 'globals-admin.css', 'globals-shop.css']) {
  const p = path.join(app, f)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

for (const dir of ['components', 'stores']) {
  const p = path.join(web, dir)
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

const src = path.join(web, 'src')
if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true })

const lib = path.join(web, 'lib')
if (fs.existsSync(lib)) {
  for (const name of fs.readdirSync(lib)) {
    if (name === 'server') continue
    fs.rmSync(path.join(lib, name), { recursive: true, force: true })
  }
}

// Minimal root layout (required by Next App Router)
fs.writeFileSync(
  path.join(app, 'layout.tsx'),
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
`,
)

const pagePath = path.join(app, 'page.tsx')
if (fs.existsSync(pagePath)) fs.unlinkSync(pagePath)

console.log('[strip-web-ui] apps/web is API-only (app/api + lib/server, SPA in public/)')
