/**
 * Test-only, fail-closed database guard (Ticket #3, 3B-3 safety). Loaded with `--import` BEFORE register-paths.mjs,
 * so it sees the environment exactly as the caller set it, before `.env.local` can fill in a missing database URL
 * (which is how a test run once reached the developer databases in apps/web/.data).
 *
 * The run refuses to start unless:
 *  - PLEROS_TEST_DB_DIR names an existing, absolute directory outside this repository (so never apps/web/.data);
 *  - every database the schemas read (each `env("…_DATABASE_URL")` in prisma/*\/schema.prisma) is set explicitly;
 *  - every `*_DATABASE_URL` in the environment (including DATABASE_URL) is an absolute `file:` SQLite path inside
 *    that directory. Postgres or any other server URL is refused: it is not an isolated scratch database.
 * Nothing here runs in the application; it is only ever loaded by the test:isolated script.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(webRoot, '..', '..')

function real(p) {
  return fs.realpathSync.native(p)
}

/** Case-insensitive on Windows, where C:\X and c:\x are the same directory. */
function isInside(child, parent) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Every database URL variable the Prisma schemas read. Read from the schemas so a new database is covered. */
export function schemaDatabaseEnvNames() {
  const dir = path.join(webRoot, 'prisma')
  const names = new Set()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const schema = path.join(dir, entry.name, 'schema.prisma')
    if (!fs.existsSync(schema)) continue
    for (const m of fs.readFileSync(schema, 'utf8').matchAll(/env\("([A-Z0-9_]+)"\)/g)) names.add(m[1])
  }
  return [...names].sort()
}

/** The checks; returns the problems found (empty means safe). Exported for the guard's own tests. */
export function findTestDatabaseProblems(env = process.env) {
  const problems = []
  const dirRaw = env.PLEROS_TEST_DB_DIR?.trim()
  let approved = null
  if (!dirRaw) problems.push('PLEROS_TEST_DB_DIR is not set: name the isolated scratch directory that holds the test databases.')
  else if (!path.isAbsolute(dirRaw)) problems.push(`PLEROS_TEST_DB_DIR must be an absolute path (got ${dirRaw}).`)
  else if (!fs.existsSync(dirRaw) || !fs.statSync(dirRaw).isDirectory()) problems.push(`PLEROS_TEST_DB_DIR does not exist: ${dirRaw}`)
  else {
    approved = real(dirRaw)
    if (isInside(approved, real(repoRoot))) {
      problems.push(`PLEROS_TEST_DB_DIR is inside the repository (${approved}); use a scratch directory outside it.`)
      approved = null
    }
  }

  if (env.PLEROS_DB_PROVIDER && env.PLEROS_DB_PROVIDER !== 'sqlite') {
    problems.push(`PLEROS_DB_PROVIDER=${env.PLEROS_DB_PROVIDER}: isolated runs use fresh SQLite files only.`)
  }

  const required = schemaDatabaseEnvNames()
  if (required.length === 0) problems.push('No database URL variables were found in prisma/*/schema.prisma; refusing to guess.')
  for (const name of required) {
    if (env[name] === undefined || env[name] === '') problems.push(`${name} is not set (it would be filled from .env.local).`)
  }

  const present = Object.keys(env).filter((k) => /(^|_)DATABASE_URL$/.test(k))
  for (const name of [...new Set([...required, ...present])].sort()) {
    const url = env[name]
    if (url === undefined || url === '') continue
    if (!url.startsWith('file:')) {
      problems.push(`${name} is not a SQLite file URL (${url.replace(/\/\/[^@]*@/, '//***@')}).`)
      continue
    }
    const file = url.slice('file:'.length).split('?')[0]
    if (!path.isAbsolute(file)) {
      problems.push(`${name} must be an absolute file path (got ${file}).`)
      continue
    }
    if (!approved) continue // already reported above
    const parent = path.dirname(file)
    if (!fs.existsSync(parent)) {
      problems.push(`${name}: its directory does not exist (${parent}).`)
      continue
    }
    // Resolve links on the directory (and the file, when it already exists) so a symlink can't point back out.
    const resolved = fs.existsSync(file) ? real(file) : path.join(real(parent), path.basename(file))
    if (!isInside(resolved, approved)) problems.push(`${name} points outside PLEROS_TEST_DB_DIR: ${resolved}`)
  }
  return problems
}

export function assertIsolatedTestDatabases(stage) {
  const problems = findTestDatabaseProblems()
  if (problems.length === 0) return
  const msg = [
    `[test-db-guard] Refusing to run tests (${stage}): the databases are not all isolated scratch files.`,
    ...problems.map((p) => `  - ${p}`),
    '  Set PLEROS_TEST_DB_DIR and every *_DATABASE_URL to file: paths inside it, then push the schemas there.',
  ].join('\n')
  console.error(msg)
  process.exit(78) // EX_CONFIG: before any test file, test setup or database connection runs
}

if (!process.env.PLEROS_TEST_DB_GUARD_NO_AUTORUN) assertIsolatedTestDatabases('before .env.local is loaded')
