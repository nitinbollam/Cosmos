/**
 * Idempotent: add tracing-bootstrap.ts, prepend import in src/main.ts, add @cosmos/tracing workspace dep.
 * Skips auth-service (already wired).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const servicesDir = path.join(root, 'services')

for (const svc of fs.readdirSync(servicesDir)) {
  const dir = path.join(servicesDir, svc)
  if (!fs.statSync(dir).isDirectory() || svc === 'auth-service') continue

  const mainTs = path.join(dir, 'src', 'main.ts')
  const pkgJson = path.join(dir, 'package.json')
  if (!fs.existsSync(mainTs) || !fs.existsSync(pkgJson)) continue

  const tb = path.join(dir, 'src', 'tracing-bootstrap.ts')
  const tbBody =
    `import { bootstrapTelemetry } from '@cosmos/tracing'\n\nbootstrapTelemetry('${svc}')\n`
  fs.writeFileSync(tb, tbBody)

  let main = fs.readFileSync(mainTs, 'utf8')
  if (!main.includes("import './tracing-bootstrap'")) {
    main = `import './tracing-bootstrap'\n${main}`
    fs.writeFileSync(mainTs, main)
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  pkg.dependencies = pkg.dependencies ?? {}
  if (!pkg.dependencies['@cosmos/tracing']) {
    pkg.dependencies['@cosmos/tracing'] = 'workspace:*'
    fs.writeFileSync(pkgJson, JSON.stringify(pkg, null, 2) + '\n')
  }
}
