import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** After build, inject hashed /assets/* URLs into dist/sw.js PRECACHE_URLS. */
function injectSwPrecache(): Plugin {
  return {
    name: 'pleros-inject-sw-precache',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist')
      const swPath = path.join(dist, 'sw.js')
      if (!fs.existsSync(swPath)) return

      const shell = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/favicon-32.png',
        '/apple-touch-icon.png',
        '/pleros-icon-192.png',
        '/pleros-icon-512.png',
        '/m/login',
        '/m/warehouse',
      ]

      const assetsDir = path.join(dist, 'assets')
      const assetUrls: string[] = []
      if (fs.existsSync(assetsDir)) {
        for (const name of fs.readdirSync(assetsDir)) {
          if (/\.(js|css|woff2?)$/i.test(name)) {
            assetUrls.push(`/assets/${name}`)
          }
        }
      }

      const precache = [...shell, ...assetUrls]
      let sw = fs.readFileSync(swPath, 'utf8')
      const next = `const PRECACHE_URLS = ${JSON.stringify(precache, null, 2)}`
      const replaced = sw.replace(/const PRECACHE_URLS = \[[\s\S]*?\]/, next)
      if (replaced === sw) {
        console.warn('[pwa] Could not inject PRECACHE_URLS into sw.js')
        return
      }
      fs.writeFileSync(swPath, replaced)
      console.log(`[pwa] Injected ${precache.length} URLs into sw.js (${assetUrls.length} assets)`)
    },
  }
}

/** UI build output — served by server/index.ts (dev: Vite middleware, prod: static). */
export default defineConfig({
  plugins: [react(), injectSwPrecache()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pleros/web-gateway-client': path.resolve(
        __dirname,
        '../../packages/web-gateway-client/src/index.ts',
      ),
      '@pleros/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 4000,
    strictPort: true,
  },
})
