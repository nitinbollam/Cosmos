import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createServer as createViteServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(__dirname, '..')
const webRoot = path.resolve(clientRoot, '../web')
const port = Number(process.env.PORT ?? 4000)
const isProd = process.env.NODE_ENV === 'production'

function loadEnv() {
  const envPath = path.join(webRoot, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i <= 0) continue
    const key = trimmed.slice(0, i).trim()
    const val = trimmed.slice(i + 1).trim()
    if (process.env[key] == null) process.env[key] = val
  }
}

async function sendWebResponse(res: express.Response, response: Response) {
  res.status(response.status)
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    res.setHeader(key, value)
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream') && typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}

async function main() {
  loadEnv()
  await import('../../web/server/register-paths.mjs')
  const { handleApiRequest } = await import('../../web/server/api-router.ts')

  const app = express()
  app.disable('x-powered-by')

  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api')) return next()

    try {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v)
        } else {
          headers.set(key, value)
        }
      }
      const init: RequestInit = {
        method: req.method,
        headers,
      }
      if (chunks.length > 0) init.body = Buffer.concat(chunks)
      const response = await handleApiRequest(new Request(url, init))
      await sendWebResponse(res, response)
    } catch (e) {
      console.error('[api]', e)
      res.status(500).json({ message: 'Internal server error' })
    }
  })

  if (isProd) {
    const dist = path.join(clientRoot, 'dist')
    app.use(express.static(dist, { index: false }))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  } else {
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.listen(port, () => {
    console.log(`[cosmos] Vite + API @ http://localhost:${port}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
