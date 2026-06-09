import { WEB_DATABASE_ENV_KEYS } from './env'

type DbCheck = { key: string; ok: boolean; message?: string }

export function getDatabaseProvider(): 'sqlite' | 'postgresql' {
  return process.env.COSMOS_DB_PROVIDER === 'postgres' ? 'postgresql' : 'sqlite'
}

export async function checkDatabaseConnections(): Promise<{
  provider: string
  checks: DbCheck[]
  allOk: boolean
}> {
  const provider = getDatabaseProvider()
  const checks: DbCheck[] = []

  for (const key of WEB_DATABASE_ENV_KEYS) {
    const url = process.env[key]
    checks.push({
      key,
      ok: Boolean(url?.trim()),
      message: url ? 'configured' : 'missing URL',
    })
  }

  const { authDb } = await import('./db')
  try {
    await authDb.$queryRaw`SELECT 1`
    checks.push({ key: 'auth_connectivity', ok: true, message: 'ok' })
  } catch (e) {
    checks.push({
      key: 'auth_connectivity',
      ok: false,
      message: e instanceof Error ? e.message : 'connect failed',
    })
  }

  return {
    provider,
    checks,
    allOk: checks.every((c) => c.ok),
  }
}
