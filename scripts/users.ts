/**
 * Platform user management from the command line.
 *
 *   npm run users -- <command> [options]
 *
 * Runs wherever the app runs — locally, or inside the Railway container (`railway ssh`, then
 * `npm run users -- list`). Unlike the /ops/users web console, the CLI can create and manage
 * platform super admins, because using it already requires access to the hosting platform.
 *
 * Passwords: omit --password to get a generated temporary one (printed once). Passing one on
 * the command line leaves it in shell history.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DB_BY_SCHEMA, databaseUrlForSchema, envKeyForSchema } = require('./db-urls.mjs') as {
  DB_BY_SCHEMA: Record<string, string>
  databaseUrlForSchema: (schema: string) => string
  envKeyForSchema: (schema: string) => string
}

// Same database resolution as scripts/start-server.mjs: explicit env wins, otherwise derive
// SQLite files (local) or per-domain Postgres URLs from DATABASE_URL (Railway).
for (const schema of Object.keys(DB_BY_SCHEMA)) {
  const key = envKeyForSchema(schema)
  if (!process.env[key]?.trim()) process.env[key] = databaseUrlForSchema(schema)
}

const HELP = `Usage: npm run users -- <command> [options]

  list            [--search <text>] [--tenant <slug>]   List users (newest first)
  tenants                                               List companies
  show            --email <email> [--tenant <slug>]     Show one user
  create          --email <email> --first <name> --last <name> --role <ROLE>
                  (--tenant <slug> | --new-company "<name>" --slug <slug>) [--password <pw>]
  set-password    --email <email> [--tenant <slug>] [--password <pw>]   (signs the user out everywhere)
  reset-link      --email <email> [--tenant <slug>]     Email a password-reset link
  activate        --email <email> [--tenant <slug>]
  deactivate      --email <email> [--tenant <slug>]     (signs the user out everywhere)
  verify          --email <email> [--tenant <slug>]     Mark the email as verified
  set-role        --email <email> --role <ROLE> [--tenant <slug>]
  revoke-sessions --email <email> [--tenant <slug>]
  bootstrap       --email <email> --password <pw> [--first <name>] [--last <name>]
                  Create (or recover) a platform SUPER_ADMIN

Roles: SUPER_ADMIN, TENANT_ADMIN, MANAGER, ACCOUNTANT, WAREHOUSE_STAFF, SALES_REP, DRIVER, VIEWER, STAFF`

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv
  const opts: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    opts[arg.slice(2)] = value
    i++
  }
  return { command, opts }
}

function need(opts: Record<string, string>, key: string): string {
  const value = opts[key]?.trim()
  if (!value) throw new Error(`--${key} is required`)
  return value
}

type Row = Awaited<ReturnType<typeof import('../apps/web/lib/server/user-admin').getManagedUser>>

function printUsers(users: Row[]) {
  if (users.length === 0) return console.log('(no users)')
  console.table(
    users.map((u) => ({
      email: u.email,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role,
      company: u.tenant?.slug ?? '?',
      active: u.isActive,
      verified: u.emailVerified,
      sessions: u.activeSessions,
      lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16) : '-',
    })),
  )
}

function printTemporaryPassword(password: string | undefined) {
  if (!password) return
  console.log(`\nTemporary password (shown once — share it securely, ask them to change it):\n  ${password}\n`)
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2))
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP)
    return
  }
  const admin = await import('../apps/web/lib/server/user-admin')
  const actor = { kind: 'cli' as const, label: process.env.USER || process.env.HOSTNAME || 'cli' }
  const target = async () => (await admin.findUserByEmail(need(opts, 'email'), opts.tenant)).id

  switch (command) {
    case 'list': {
      let tenantId: string | undefined
      if (opts.tenant) {
        const tenant = (await admin.listTenants()).find((t) => t.slug === opts.tenant)
        if (!tenant) throw new Error(`No company with slug "${opts.tenant}"`)
        tenantId = tenant.id
      }
      const page = await admin.listUsers({ search: opts.search, tenantId, pageSize: 200 })
      printUsers(page.items)
      console.log(`${page.items.length} of ${page.total} user(s)`)
      return
    }
    case 'tenants':
      console.table(await admin.listTenants())
      return
    case 'show':
      printUsers([await admin.getManagedUser(await target())])
      return
    case 'create': {
      const tenantSlug = opts.tenant
      let tenantId: string | undefined
      if (tenantSlug) {
        const tenant = (await admin.listTenants()).find((t) => t.slug === tenantSlug)
        if (!tenant) throw new Error(`No company with slug "${tenantSlug}"`)
        tenantId = tenant.id
      }
      const result = await admin.createUser(
        {
          email: need(opts, 'email'),
          firstName: need(opts, 'first'),
          lastName: need(opts, 'last'),
          role: need(opts, 'role').toUpperCase(),
          password: opts.password,
          tenantId,
          newTenant: opts['new-company'] ? { companyName: opts['new-company'], slug: need(opts, 'slug') } : undefined,
        },
        actor,
      )
      printUsers([result.user])
      printTemporaryPassword(result.temporaryPassword)
      return
    }
    case 'set-password': {
      const result = await admin.setPassword(await target(), opts.password, actor)
      printUsers([result.user])
      printTemporaryPassword(result.temporaryPassword)
      return
    }
    case 'reset-link':
      await admin.emailPasswordReset(await target(), actor)
      console.log('Reset link sent (check the app logs if no email provider is configured).')
      return
    case 'activate':
    case 'deactivate':
      printUsers([await admin.setActive(await target(), command === 'activate', actor)])
      return
    case 'verify':
      printUsers([await admin.markEmailVerified(await target(), actor)])
      return
    case 'set-role':
      printUsers([await admin.setRole(await target(), need(opts, 'role').toUpperCase(), actor)])
      return
    case 'revoke-sessions':
      printUsers([await admin.revokeSessions(await target(), actor)])
      return
    case 'bootstrap': {
      const result = await admin.bootstrapSuperAdmin(
        {
          email: need(opts, 'email'),
          // The boot bootstrap passes the password via env so it never appears in a command line or log.
          password: opts.password?.trim() || process.env.PLEROS_BOOTSTRAP_ADMIN_PASSWORD?.trim() || need(opts, 'password'),
          firstName: opts.first,
          lastName: opts.last,
        },
        actor,
      )
      console.log(`Super admin ${result.status}.`)
      printUsers([result.user])
      return
    }
    default:
      throw new Error(`Unknown command "${command}"\n\n${HELP}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`users: ${message}`)
    process.exit(1)
  })
