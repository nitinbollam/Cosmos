#!/usr/bin/env node
/**
 * Copies UI from apps/web → apps/client and rewrites Next.js imports for Vite + React Router.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'apps', 'web')
const client = path.join(root, 'apps', 'client')

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, fn)
    else fn(p)
  }
}

function transformSource(content) {
  let s = content
  s = s.replace(/^['"]use client['"]\s*\n/gm, '')
  s = s.replace(/from ['"]next\/link['"]/g, "from 'react-router-dom'")
  s = s.replace(/import Link from 'react-router-dom'/g, "import { Link } from 'react-router-dom'")
  s = s.replace(/from ['"]next\/navigation['"]/g, "from 'react-router-dom'")
  s = s.replace(/\busePathname\b/g, 'useLocation')
  s = s.replace(/useLocation\(\)\s*\?\?\s*'[^']*'/g, (m) => m) // keep
  s = s.replace(/const pathname = useLocation\(\)/g, 'const pathname = useLocation().pathname')
  s = s.replace(/from ['"]next\/image['"]/g, "from '@/components/cosmos-img'")
  s = s.replace(/\bhref=\{/g, 'to={')
  s = s.replace(/\bhref="/g, 'to="')
  s = s.replace(/\bhref='/g, "to='")
  s = s.replace(/\buseRouter\(\)/g, 'useNavigate()')
  s = s.replace(/\bconst router = useNavigate\(\)/g, 'const navigate = useNavigate()')
  s = s.replace(/\brouter\.push\(/g, 'navigate(')
  s = s.replace(/\brouter\.replace\(/g, 'navigate(')
  s = s.replace(/\s*router\.refresh\(\)\s*/g, '')
  s = s.replace(/process\.env\.NEXT_PUBLIC_WEB_ADMIN_ORIGIN/g, 'import.meta.env.VITE_WEB_ADMIN_ORIGIN')
  s = s.replace(/import \{([^}]*)\buseRouter\b([^}]*)\} from 'react-router-dom'/g, (_, a, b) => {
    const parts = `${a}${b}`.split(',').map((x) => x.trim()).filter(Boolean)
    const set = new Set(parts)
    set.delete('useRouter')
    set.add('useNavigate')
    return `import { ${[...set].join(', ')} } from 'react-router-dom'`
  })
  return s
}

function transformFile(filePath) {
  if (!/\.(tsx?|jsx?)$/.test(filePath)) return
  const raw = fs.readFileSync(filePath, 'utf8')
  const next = transformSource(raw)
  if (next !== raw) fs.writeFileSync(filePath, next)
}

// Reset client src (keep config files)
for (const dir of ['src/pages', 'src/components', 'src/lib', 'src/stores', 'public']) {
  rmrf(path.join(client, dir))
}

copyDir(path.join(web, 'components'), path.join(client, 'src/components'))
copyDir(path.join(web, 'stores'), path.join(client, 'src/stores'))
copyDir(path.join(web, 'public'), path.join(client, 'public'))

const libSrc = path.join(web, 'lib')
const libDest = path.join(client, 'src/lib')
fs.mkdirSync(libDest, { recursive: true })
for (const name of fs.readdirSync(libSrc)) {
  if (name === 'server') continue
  const src = path.join(libSrc, name)
  const dest = path.join(libDest, name)
  if (fs.statSync(src).isDirectory()) copyDir(src, dest)
  else fs.copyFileSync(src, dest)
}

if (fs.existsSync(path.join(web, 'src/components'))) {
  copyDir(path.join(web, 'src/components'), path.join(client, 'src/components'))
}

const pagesRoot = path.join(client, 'src/pages')
fs.mkdirSync(pagesRoot, { recursive: true })

function copyPage(srcFile, destRel) {
  const dest = path.join(pagesRoot, destRel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(srcFile, dest)
}

const app = path.join(web, 'app')
copyPage(path.join(app, 'page.tsx'), 'home/page.tsx')
copyPage(path.join(app, 'login/page.tsx'), 'login/page.tsx')

const shop = path.join(app, '(shop)')
if (fs.existsSync(shop)) {
  walk(shop, (f) => {
    if (!f.endsWith(`${path.sep}page.tsx`) && !f.endsWith('/page.tsx')) return
    const rel = path.relative(shop, f)
    copyPage(f, rel)
  })
}

const admin = path.join(app, 'admin')
if (fs.existsSync(admin)) {
  walk(admin, (f) => {
    if (!f.endsWith(`${path.sep}page.tsx`) && !f.endsWith('/page.tsx')) return
    const rel = path.join('admin', path.relative(admin, f))
    copyPage(f, rel)
  })
}

const mobile = path.join(app, 'm')
if (fs.existsSync(mobile)) {
  walk(mobile, (f) => {
    if (!f.endsWith(`${path.sep}page.tsx`) && !f.endsWith('/page.tsx')) return
    const rel = path.join('m', path.relative(mobile, f))
    copyPage(f, rel)
  })
}

walk(path.join(client, 'src'), (f) => transformFile(f))

// Global styles
for (const css of ['globals.css', 'globals-admin.css', 'globals-shop.css']) {
  const src = path.join(web, 'app', css)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(client, 'src', css))
}

console.log('[sync-client] UI copied from apps/web → apps/client')

const patch = spawnSync(process.execPath, ['scripts/patch-client-after-sync.mjs'], {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
  stdio: 'inherit',
})
if (patch.status !== 0) process.exit(patch.status ?? 1)
